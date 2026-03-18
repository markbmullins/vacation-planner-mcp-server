import fs from "node:fs";
import path from "node:path";
import { Worker } from "bullmq";
import { execSync } from "node:child_process";
import { PIPELINE } from "../pipeline.js";
import { connection } from "../queue.js";
import { resolveAutodevPath } from "../runtime.js";
import { enqueueRunnableTickets, getTicketById, reconcileRuntimeState, setRuntimeTicketState, touchRuntimeTicket } from "../tickets.js";
import type { ReviewResult, Ticket } from "../types.js";
import { AgentExecutionError, buildImplementPrompt, buildRepairPrompt, buildTestFailurePrompt, parseReviewResult, runImplementAgent, runReviewAgent } from "../utils/agent.js";
import { loadContext, selectRelevantFiles } from "../utils/context.js";
import { commitTicket, hasChanges, workingTreeDiff, workingTreeStatus } from "../utils/git.js";
import { logger } from "../utils/logger.js";
import { advanceIntegrationBranch, createTicketWorktree, deleteTicketBranch, removeTicketWorktree } from "../utils/worktree.js";

const TEST_CMD = process.env.AUTODEV_TEST_COMMAND ?? "npm test";
const runRoot = resolveAutodevPath(".runs");

function ensureRunDir(ticketId: string) {
  const ticketRunDir = path.join(runRoot, ticketId);
  fs.mkdirSync(ticketRunDir, { recursive: true });
  return ticketRunDir;
}

function writeArtifact(runDir: string, name: string, content: string) {
  fs.writeFileSync(path.join(runDir, name), content, "utf8");
}

function writeAgentFailureArtifacts(runDir: string, error: AgentExecutionError) {
  writeArtifact(runDir, "agent-failure-stderr.txt", error.stderr);
  writeArtifact(runDir, "agent-failure-stdout.txt", error.stdout);
}

// Runs the configured test command with a hard timeout and distinguishes
// between ordinary test failures and hung test processes.
function runTests(cwd: string) {
  try {
    const output = execSync(TEST_CMD, {
      cwd,
      encoding: "utf8",
      stdio: "pipe",
      maxBuffer: 10 * 1024 * 1024,
      timeout: PIPELINE.testTimeoutMs,
    });

    return { ok: true, output };
  } catch (error) {
    if (
      error instanceof Error
      && (("code" in error && error.code === "ETIMEDOUT")
        || ("signal" in error && error.signal === "SIGTERM")
        || error.message.includes("ETIMEDOUT"))
    ) {
      throw new Error(`Test command timed out after ${PIPELINE.testTimeoutMs}ms`);
    }

    const stdout = error instanceof Error && "stdout" in error ? String(error.stdout ?? "") : "";
    const stderr = error instanceof Error && "stderr" in error ? String(error.stderr ?? "") : "";

    return {
      ok: false,
      output: `${stdout}${stderr}`.trim(),
    };
  }
}

function blockTicket(ticketId: string, message: string, branch?: string, commitSha?: string) {
  setRuntimeTicketState(ticketId, {
    status: "blocked",
    stage: "blocked",
    lastError: message,
    branch,
    commitSha,
  });
}

// Persists enough local git state to debug a failed ticket even after the
// isolated worktree has been cleaned up.
function captureFailureArtifacts(runDir: string, worktreePath: string) {
  try {
    writeArtifact(runDir, "failure-status.txt", workingTreeStatus(worktreePath));
  } catch (error) {
    writeArtifact(runDir, "failure-status.txt", `Unable to capture git status: ${String(error)}`);
  }

  try {
    writeArtifact(runDir, "failure-diff.patch", workingTreeDiff(worktreePath));
  } catch (error) {
    writeArtifact(runDir, "failure-diff.patch", `Unable to capture git diff: ${String(error)}`);
  }
}

// Executes the full unattended ticket lifecycle inside an isolated worktree:
// retrieve context, implement, review, test, commit, integrate, and clean up.
async function processTicket(ticket: Ticket) {
  const ticketLogger = logger.child({ ticketId: ticket.id, title: ticket.title });
  const runDir = ensureRunDir(ticket.id);
  const worktree = createTicketWorktree(ticket.id);

  ticketLogger.info("Created isolated ticket worktree", {
    branch: worktree.branch,
    worktreePath: worktree.path,
    baseSha: worktree.baseSha,
    runDir,
  });

  setRuntimeTicketState(ticket.id, {
    status: "in_progress",
    stage: "queued",
    attempt: 0,
    runDir,
    branch: worktree.branch,
  });

  let commitSha: string | undefined;

  try {
    const retrievalPlan = selectRelevantFiles(ticket);
    const context = loadContext(worktree.path, ticket, retrievalPlan);
    let nextPrompt = buildImplementPrompt(ticket, context);
    let reviewRounds = 0;
    let testFixRounds = 0;
    let attempts = 0;

    while (attempts < PIPELINE.maxAgentAttempts) {
      attempts += 1;
      touchRuntimeTicket(ticket.id);
      setRuntimeTicketState(ticket.id, {
        status: "in_progress",
        stage: "implementing",
        attempt: attempts,
        runDir,
        branch: worktree.branch,
        commitSha,
      });
      ticketLogger.info("Starting implementation attempt", { attempt: attempts });
      const implementOutput = await runImplementAgent(ticket.id, worktree.path, nextPrompt, runDir, attempts, () => touchRuntimeTicket(ticket.id));
      writeArtifact(runDir, `implement-${attempts}.txt`, implementOutput);
      ticketLogger.info("Implementation attempt completed", {
        attempt: attempts,
        artifactPath: path.join(runDir, `implement-${attempts}.txt`),
      });

      touchRuntimeTicket(ticket.id);
      setRuntimeTicketState(ticket.id, {
        status: "in_progress",
        stage: "reviewing",
        attempt: attempts,
        runDir,
        branch: worktree.branch,
        commitSha,
      });
      const reviewOutput = await runReviewAgent(worktree.path, ticket, runDir, attempts, () => touchRuntimeTicket(ticket.id));
      writeArtifact(runDir, `review-${attempts}.txt`, reviewOutput);
      ticketLogger.info("Review completed", {
        attempt: attempts,
        artifactPath: path.join(runDir, `review-${attempts}.txt`),
      });

      const review = parseReviewResult(reviewOutput);

      if (review.status === "changes_required") {
        ticketLogger.warn("Review requested changes", {
          attempt: attempts,
          reviewSummary: review.summary,
          issues: review.issues,
        });
        reviewRounds += 1;

        if (reviewRounds > PIPELINE.maxReviewRounds) {
          throw new Error(`Review rejected changes after ${PIPELINE.maxReviewRounds} rounds: ${formatReviewIssues(review)}`);
        }

        nextPrompt = buildRepairPrompt(ticket, review);
        continue;
      }

      setRuntimeTicketState(ticket.id, {
        status: "in_progress",
        stage: "testing",
        attempt: attempts,
        runDir,
        branch: worktree.branch,
        commitSha,
      });
      const testResult = runTests(worktree.path);
      touchRuntimeTicket(ticket.id);
      writeArtifact(runDir, `test-${attempts}.txt`, testResult.output);
      ticketLogger.info("Test command completed", {
        attempt: attempts,
        ok: testResult.ok,
        artifactPath: path.join(runDir, `test-${attempts}.txt`),
      });

      if (!testResult.ok) {
        ticketLogger.warn("Tests failed; requesting repair", { attempt: attempts });
        testFixRounds += 1;

        if (testFixRounds > PIPELINE.maxTestFixRounds) {
          throw new Error(`Tests failed after ${PIPELINE.maxTestFixRounds} repair rounds`);
        }

        nextPrompt = buildTestFailurePrompt(ticket, testResult.output);
        continue;
      }

      if (!hasChanges(worktree.path)) {
        throw new Error("Pipeline reached approval with no file changes in isolated worktree");
      }

      setRuntimeTicketState(ticket.id, {
        status: "in_progress",
        stage: "committing",
        attempt: attempts,
        runDir,
        branch: worktree.branch,
        commitSha,
      });
      commitSha = commitTicket(worktree.path, ticket.id, ticket.title);
      ticketLogger.info("Created ticket commit", { commitSha, branch: worktree.branch });
      advanceIntegrationBranch(worktree.baseSha, commitSha);
      ticketLogger.info("Advanced integration branch", {
        previousSha: worktree.baseSha,
        nextSha: commitSha,
      });
      setRuntimeTicketState(ticket.id, {
        status: "in_progress",
        stage: "cleanup",
        attempt: attempts,
        runDir,
        branch: worktree.branch,
        commitSha,
      });
      removeTicketWorktree(worktree.path);
      deleteTicketBranch(worktree.branch);
      setRuntimeTicketState(ticket.id, {
        status: "done",
        stage: "done",
        attempt: attempts,
        runDir,
        branch: worktree.branch,
        commitSha,
      });
      ticketLogger.info("Ticket completed successfully", {
        branch: worktree.branch,
        commitSha,
      });
      return;
    }

    throw new Error(`Exceeded maximum agent attempts (${PIPELINE.maxAgentAttempts})`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (error instanceof AgentExecutionError) {
      writeAgentFailureArtifacts(runDir, error);
    }

    captureFailureArtifacts(runDir, worktree.path);
    ticketLogger.error("Ticket processing failed", {
      error: error instanceof AgentExecutionError
        ? {
          name: error.name,
          message: error.message,
          agent: error.agent,
          model: error.model,
          promptChars: error.promptChars,
          promptTokensEstimate: error.promptTokensEstimate,
          exitStatus: error.exitStatus,
        }
        : error,
      branch: worktree.branch,
      runDir,
      failureStatusPath: path.join(runDir, "failure-status.txt"),
      failureDiffPath: path.join(runDir, "failure-diff.patch"),
      agentFailureStderrPath: error instanceof AgentExecutionError ? path.join(runDir, "agent-failure-stderr.txt") : undefined,
      agentFailureStdoutPath: error instanceof AgentExecutionError ? path.join(runDir, "agent-failure-stdout.txt") : undefined,
    });

    try {
      removeTicketWorktree(worktree.path);
      deleteTicketBranch(worktree.branch);
    } catch (cleanupError) {
      ticketLogger.error("Failed to clean up ticket worktree or branch", {
        error: cleanupError,
        branch: worktree.branch,
        worktreePath: worktree.path,
      });
      blockTicket(
        ticket.id,
        `${message}; also failed to remove worktree cleanly: ${String(cleanupError)}`,
        worktree.branch,
        commitSha,
      );
      throw error;
    }

    blockTicket(ticket.id, message, worktree.branch, commitSha);
    ticketLogger.warn("Ticket blocked after failure", {
      branch: worktree.branch,
      commitSha,
      reason: message,
      runDir,
    });
    throw error;
  }
}

function formatReviewIssues(review: ReviewResult) {
  if (review.issues.length === 0) {
    return review.summary;
  }

  return review.issues.join("; ");
}

void reconcileRuntimeState().catch((error) => {
  logger.error("Autodev worker failed to reconcile runtime state", { error });
});

new Worker(
  PIPELINE.queueName,
  async (job) => {
    if (job.name !== "process-ticket") {
      throw new Error(`Unexpected job name: ${job.name}`);
    }

    const ticket = getTicketById(String(job.data.ticketId));

    if (!ticket) {
      throw new Error(`Unknown ticket ${String(job.data.ticketId)}`);
    }

    logger.info("Worker picked up ticket job", {
      ticketId: ticket.id,
      title: ticket.title,
      jobId: job.id,
    });

    try {
      await processTicket(ticket);
    } finally {
      await enqueueRunnableTickets();
    }
  },
  {
    connection,
    concurrency: PIPELINE.workerConcurrency,
  },
);
