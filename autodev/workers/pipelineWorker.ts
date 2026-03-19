import fs from "node:fs";
import path from "node:path";
import { Worker } from "bullmq";
import { execSync } from "node:child_process";
import { shouldStopAfterCurrentTicket } from "../control.js";
import { PIPELINE } from "../pipeline.js";
import { connection } from "../queue.js";
import { resolveAutodevPath } from "../runtime.js";
import { enqueueRunnableTickets, getRuntimeTicketState, getTicketById, readRuntimeState, reconcileRuntimeState, setRuntimeTicketState, touchRuntimeTicket } from "../tickets.js";
import type { ReviewResult, RuntimeTicketState, Ticket } from "../types.js";
import { AgentExecutionError, buildImplementPrompt, buildRepairPrompt, buildResumeImplementPrompt, buildTestFailurePrompt, parseReviewResult, runImplementAgent, runReviewAgent } from "../utils/agent.js";
import { loadContext, selectRelevantFiles } from "../utils/context.js";
import { appendDeferredFollowup, hasDeferredFollowup } from "../utils/followups.js";
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

function isTerminalError(message: string) {
  return [
    "Exceeded maximum agent attempts",
    "Review rejected changes after",
    "Tests failed after",
    "Pipeline reached approval with no file changes",
  ].some((prefix) => message.includes(prefix));
}

function reviewSeverity(issue: string) {
  if (issue.startsWith("BLOCKER:")) return "blocker";
  if (issue.startsWith("MAJOR:")) return "major";
  if (issue.startsWith("MINOR:")) return "minor";
  return "unknown";
}

function normalizeIssueFingerprint(issue: string) {
  return issue
    .toLowerCase()
    .replace(/`[^`]+`/g, "")
    .replace(/[a-z0-9_./-]+:\d+(?::\d+)?/g, "")
    .replace(/\b[0-9]{2,}\b/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

function reviewLooksLikeDrift(previousIssues: string[] | undefined, nextIssues: string[]) {
  if (!previousIssues || previousIssues.length === 0 || nextIssues.length === 0) {
    return false;
  }

  const previous = new Set(previousIssues.map(normalizeIssueFingerprint));
  const next = new Set(nextIssues.map(normalizeIssueFingerprint));
  let overlap = 0;

  for (const fingerprint of next) {
    if (previous.has(fingerprint)) {
      overlap += 1;
    }
  }

  return overlap === 0;
}

function shouldAutoApproveReview(review: ReviewResult, reviewRounds: number) {
  if (reviewRounds < 2) {
    return false;
  }

  return review.issues.every((issue) => {
    const severity = reviewSeverity(issue);
    return severity === "minor" || severity === "unknown";
  });
}

function resumePromptFromRuntime(ticket: Ticket, runtimeTicket: RuntimeTicketState | null, context: string) {
  if (!runtimeTicket) {
    return buildImplementPrompt(ticket, context);
  }

  if (runtimeTicket.pendingReviewSummary || runtimeTicket.pendingReviewIssues?.length) {
    return buildRepairPrompt(ticket, {
      status: "changes_required",
      summary: runtimeTicket.pendingReviewSummary ?? "Address the stored review feedback.",
      issues: runtimeTicket.pendingReviewIssues ?? [],
    });
  }

  if (runtimeTicket.pendingTestOutputPath && fs.existsSync(runtimeTicket.pendingTestOutputPath)) {
    return buildTestFailurePrompt(ticket, fs.readFileSync(runtimeTicket.pendingTestOutputPath, "utf8"));
  }

  if (runtimeTicket.stage === "implementing" || runtimeTicket.stage === "queued") {
    return buildResumeImplementPrompt(ticket, context, runtimeTicket.lastError);
  }

  return buildImplementPrompt(ticket, context);
}

function persistProgress(ticketId: string, state: Omit<RuntimeTicketState, "updatedAt">) {
  setRuntimeTicketState(ticketId, state);
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

function blockTicket(ticketId: string, message: string, branch?: string, commitSha?: string, worktreePath?: string, baseSha?: string, runDir?: string) {
  setRuntimeTicketState(ticketId, {
    status: "blocked",
    stage: "blocked",
    lastError: message,
    runDir,
    worktreePath,
    baseSha,
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
  const runtimeTicket = getRuntimeTicketState(ticket.id);
  const runDir = runtimeTicket?.runDir ?? ensureRunDir(ticket.id);
  const worktree = runtimeTicket?.worktreePath && runtimeTicket.branch && runtimeTicket.baseSha && fs.existsSync(runtimeTicket.worktreePath)
    ? { path: runtimeTicket.worktreePath, branch: runtimeTicket.branch, baseSha: runtimeTicket.baseSha }
    : createTicketWorktree(ticket.id);

  if (runtimeTicket?.worktreePath && runtimeTicket.branch && runtimeTicket.baseSha && fs.existsSync(runtimeTicket.worktreePath)) {
    ticketLogger.info("Resuming existing ticket worktree", {
      branch: worktree.branch,
      worktreePath: worktree.path,
      baseSha: worktree.baseSha,
      runDir,
      stage: runtimeTicket.stage,
      attempt: runtimeTicket.attempt,
    });
  } else {
    ticketLogger.info("Created isolated ticket worktree", {
      branch: worktree.branch,
      worktreePath: worktree.path,
      baseSha: worktree.baseSha,
      runDir,
    });
  }

  persistProgress(ticket.id, {
    status: "in_progress",
    stage: runtimeTicket?.stage ?? "queued",
    attempt: runtimeTicket?.attempt ?? 0,
    reviewRounds: runtimeTicket?.reviewRounds ?? 0,
    testFixRounds: runtimeTicket?.testFixRounds ?? 0,
    runDir,
    worktreePath: worktree.path,
    baseSha: worktree.baseSha,
    branch: worktree.branch,
    commitSha: runtimeTicket?.commitSha,
    lastError: runtimeTicket?.lastError,
    pendingReviewSummary: runtimeTicket?.pendingReviewSummary,
    pendingReviewIssues: runtimeTicket?.pendingReviewIssues,
    pendingTestOutputPath: runtimeTicket?.pendingTestOutputPath,
  });

  let commitSha: string | undefined = runtimeTicket?.commitSha;

  try {
    const retrievalPlan = selectRelevantFiles(ticket);
    const context = loadContext(worktree.path, ticket, retrievalPlan);
    let nextPrompt = resumePromptFromRuntime(ticket, runtimeTicket, context);
    let reviewRounds = runtimeTicket?.reviewRounds ?? 0;
    let testFixRounds = runtimeTicket?.testFixRounds ?? 0;
    let attempts = runtimeTicket?.attempt ?? 0;
    let stage = runtimeTicket?.stage ?? "implementing";

    if (stage === "reviewing" || stage === "testing" || stage === "committing" || stage === "cleanup") {
      ticketLogger.info("Resuming ticket from persisted stage", { stage, attempt: attempts });
    }

    if (stage === "cleanup" && commitSha) {
      removeTicketWorktree(worktree.path);
      deleteTicketBranch(worktree.branch);
      persistProgress(ticket.id, {
        status: "done",
        stage: "done",
        attempt: attempts,
        reviewRounds,
        testFixRounds,
        runDir,
        worktreePath: worktree.path,
        baseSha: worktree.baseSha,
        branch: worktree.branch,
        commitSha,
      });
      return;
    }

    while (attempts < PIPELINE.maxAgentAttempts) {
      if (stage === "queued" || stage === "implementing") {
        attempts += 1;
        touchRuntimeTicket(ticket.id);
        persistProgress(ticket.id, {
          status: "in_progress",
          stage: "implementing",
          attempt: attempts,
          reviewRounds,
          testFixRounds,
          runDir,
          worktreePath: worktree.path,
          baseSha: worktree.baseSha,
          branch: worktree.branch,
          commitSha,
          pendingReviewSummary: undefined,
          pendingReviewIssues: undefined,
          pendingTestOutputPath: undefined,
        });
        ticketLogger.info("Starting implementation attempt", { attempt: attempts });
        const implementOutput = await runImplementAgent(ticket.id, worktree.path, nextPrompt, runDir, attempts, () => touchRuntimeTicket(ticket.id));
        writeArtifact(runDir, `implement-${attempts}.txt`, implementOutput);
        ticketLogger.info("Implementation attempt completed", {
          attempt: attempts,
          artifactPath: path.join(runDir, `implement-${attempts}.txt`),
        });
        stage = "reviewing";
      }

      if (stage === "reviewing") {
        touchRuntimeTicket(ticket.id);
        persistProgress(ticket.id, {
          status: "in_progress",
          stage: "reviewing",
          attempt: attempts,
          reviewRounds,
          testFixRounds,
          runDir,
          worktreePath: worktree.path,
          baseSha: worktree.baseSha,
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
        const currentRuntimeState = getRuntimeTicketState(ticket.id);
        const priorReviewIssues = currentRuntimeState?.pendingReviewIssues;

        if (review.status === "changes_required") {
          if (shouldAutoApproveReview(review, reviewRounds)) {
            ticketLogger.warn("Auto-approving review after repeated minor-only feedback", {
              attempt: attempts,
              reviewSummary: review.summary,
              issues: review.issues,
            });
          } else {
          ticketLogger.warn("Review requested changes", {
            attempt: attempts,
            reviewSummary: review.summary,
            issues: review.issues,
          });
          }

          if (reviewLooksLikeDrift(priorReviewIssues, review.issues) && reviewRounds >= PIPELINE.maxReviewDriftRounds) {
            throw new Error(`Review drift detected after ${reviewRounds + 1} rounds; manual review required: ${formatReviewIssues(review)}`);
          }

          if (shouldAutoApproveReview(review, reviewRounds)) {
            persistProgress(ticket.id, {
              status: "in_progress",
              stage: "testing",
              attempt: attempts,
              reviewRounds,
              testFixRounds,
              runDir,
              worktreePath: worktree.path,
              baseSha: worktree.baseSha,
              branch: worktree.branch,
              commitSha,
              pendingReviewSummary: undefined,
              pendingReviewIssues: undefined,
            });
            stage = "testing";
            continue;
          }

          reviewRounds += 1;

          if (reviewRounds > PIPELINE.maxReviewRounds) {
            const existingDeferredFollowupId = currentRuntimeState?.deferredFollowupId;
            const deferredFollowupId = existingDeferredFollowupId && hasDeferredFollowup(existingDeferredFollowupId)
              ? existingDeferredFollowupId
              : appendDeferredFollowup(ticket, review);
            ticketLogger.warn("Deferred remaining review issues into follow-up ticket after review round cap", {
              attempt: attempts,
              deferredFollowupId,
              reviewSummary: review.summary,
              issues: review.issues,
            });
            persistProgress(ticket.id, {
              status: "in_progress",
              stage: "testing",
              attempt: attempts,
              reviewRounds,
              testFixRounds,
              runDir,
              worktreePath: worktree.path,
              baseSha: worktree.baseSha,
              branch: worktree.branch,
              commitSha,
              pendingReviewSummary: undefined,
              pendingReviewIssues: undefined,
              deferredFollowupId,
            });
            stage = "testing";
            continue;
          }

          nextPrompt = buildRepairPrompt(ticket, review);
          persistProgress(ticket.id, {
            status: "in_progress",
            stage: "implementing",
            attempt: attempts,
            reviewRounds,
            testFixRounds,
            runDir,
            worktreePath: worktree.path,
            baseSha: worktree.baseSha,
            branch: worktree.branch,
            commitSha,
            pendingReviewSummary: review.summary,
            pendingReviewIssues: review.issues,
            deferredFollowupId: currentRuntimeState?.deferredFollowupId,
          });
          stage = "implementing";
          continue;
        }

        persistProgress(ticket.id, {
          status: "in_progress",
          stage: "testing",
          attempt: attempts,
          reviewRounds,
          testFixRounds,
          runDir,
          worktreePath: worktree.path,
          baseSha: worktree.baseSha,
          branch: worktree.branch,
          commitSha,
          pendingReviewSummary: undefined,
          pendingReviewIssues: undefined,
          deferredFollowupId: currentRuntimeState?.deferredFollowupId,
        });
        stage = "testing";
      }

      if (stage === "testing") {
        const testResult = runTests(worktree.path);
        touchRuntimeTicket(ticket.id);
        const testOutputPath = path.join(runDir, `test-${attempts}.txt`);
        writeArtifact(runDir, `test-${attempts}.txt`, testResult.output);
        ticketLogger.info("Test command completed", {
          attempt: attempts,
          ok: testResult.ok,
          artifactPath: testOutputPath,
        });

        if (!testResult.ok) {
          ticketLogger.warn("Tests failed; requesting repair", { attempt: attempts });
          testFixRounds += 1;

          if (testFixRounds > PIPELINE.maxTestFixRounds) {
            throw new Error(`Tests failed after ${PIPELINE.maxTestFixRounds} repair rounds`);
          }

          nextPrompt = buildTestFailurePrompt(ticket, testResult.output);
          persistProgress(ticket.id, {
            status: "in_progress",
            stage: "implementing",
            attempt: attempts,
            reviewRounds,
            testFixRounds,
            runDir,
            worktreePath: worktree.path,
            baseSha: worktree.baseSha,
            branch: worktree.branch,
            commitSha,
            pendingTestOutputPath: testOutputPath,
            deferredFollowupId: getRuntimeTicketState(ticket.id)?.deferredFollowupId,
          });
          stage = "implementing";
          continue;
        }
      }

      if (!hasChanges(worktree.path)) {
        throw new Error("Pipeline reached approval with no file changes in isolated worktree");
      }

      persistProgress(ticket.id, {
        status: "in_progress",
        stage: "committing",
        attempt: attempts,
        reviewRounds,
        testFixRounds,
        runDir,
        worktreePath: worktree.path,
        baseSha: worktree.baseSha,
        branch: worktree.branch,
        commitSha,
        deferredFollowupId: getRuntimeTicketState(ticket.id)?.deferredFollowupId,
      });
      commitSha = commitTicket(worktree.path, ticket.id, ticket.title);
      ticketLogger.info("Created ticket commit", { commitSha, branch: worktree.branch });
      advanceIntegrationBranch(worktree.baseSha, commitSha);
      ticketLogger.info("Advanced integration branch", {
        previousSha: worktree.baseSha,
        nextSha: commitSha,
      });
      persistProgress(ticket.id, {
        status: "in_progress",
        stage: "cleanup",
        attempt: attempts,
        reviewRounds,
        testFixRounds,
        runDir,
        worktreePath: worktree.path,
        baseSha: worktree.baseSha,
        branch: worktree.branch,
        commitSha,
        deferredFollowupId: getRuntimeTicketState(ticket.id)?.deferredFollowupId,
      });
      removeTicketWorktree(worktree.path);
      deleteTicketBranch(worktree.branch);
      persistProgress(ticket.id, {
        status: "done",
        stage: "done",
        attempt: attempts,
        reviewRounds,
        testFixRounds,
        runDir,
        worktreePath: worktree.path,
        baseSha: worktree.baseSha,
        branch: worktree.branch,
        commitSha,
        deferredFollowupId: getRuntimeTicketState(ticket.id)?.deferredFollowupId,
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

    const latestState = getRuntimeTicketState(ticket.id);

    if (isTerminalError(message)) {
      blockTicket(ticket.id, message, worktree.branch, commitSha, worktree.path, worktree.baseSha, runDir);
      ticketLogger.warn("Ticket blocked after terminal failure; worktree preserved for recovery", {
        branch: worktree.branch,
        worktreePath: worktree.path,
        commitSha,
        reason: message,
        runDir,
      });
      throw error;
    }

    persistProgress(ticket.id, {
      status: "in_progress",
      stage: latestState?.stage ?? "implementing",
      attempt: latestState?.attempt ?? 0,
      reviewRounds: latestState?.reviewRounds ?? 0,
      testFixRounds: latestState?.testFixRounds ?? 0,
      runDir,
      worktreePath: worktree.path,
      baseSha: worktree.baseSha,
      branch: worktree.branch,
      commitSha,
      lastError: message,
      pendingReviewSummary: latestState?.pendingReviewSummary,
      pendingReviewIssues: latestState?.pendingReviewIssues,
      pendingTestOutputPath: latestState?.pendingTestOutputPath,
      deferredFollowupId: latestState?.deferredFollowupId,
    });
    ticketLogger.warn("Ticket failed at a resumable step; worktree preserved for automatic retry", {
      branch: worktree.branch,
      worktreePath: worktree.path,
      commitSha,
      reason: message,
      stage: latestState?.stage,
      attempt: latestState?.attempt,
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

let worker: Worker | null = null;

void reconcileRuntimeState().catch((error) => {
  logger.error("Autodev worker failed to reconcile runtime state", { error });
});

async function pauseWorkerForGracefulStop(reason: string) {
  if (!worker) {
    return;
  }

  logger.warn("Pausing autodev worker for graceful stop", { reason });
  await worker.pause(true);
}

if (shouldStopAfterCurrentTicket()) {
  logger.warn("Autodev worker starting in paused mode because stop-after-current-ticket is requested");
}

worker = new Worker(
  PIPELINE.queueName,
  async (job) => {
    if (shouldStopAfterCurrentTicket()) {
      await pauseWorkerForGracefulStop("stop requested before starting next ticket");
      return;
    }

    if (job.name !== "process-ticket") {
      throw new Error(`Unexpected job name: ${job.name}`);
    }

    const ticket = getTicketById(String(job.data.ticketId));

    if (!ticket) {
      throw new Error(`Unknown ticket ${String(job.data.ticketId)}`);
    }

    const runtime = readRuntimeState();
    const currentRuntimeStatus = runtime.tickets[ticket.id]?.status ?? ticket.status;
    const otherInProgressTickets = Object.entries(runtime.tickets)
      .filter(([ticketId, state]) => ticketId !== ticket.id && state.status === "in_progress")
      .map(([ticketId]) => ticketId);

    if (currentRuntimeStatus === "todo" && otherInProgressTickets.length > 0) {
      logger.warn("Skipping lower-priority ticket because another ticket must resume first", {
        ticketId: ticket.id,
        blockedBy: otherInProgressTickets,
      });
      await job.remove();
      return;
    }

    logger.info("Worker picked up ticket job", {
      ticketId: ticket.id,
      title: ticket.title,
      jobId: job.id,
    });

    try {
      await processTicket(ticket);
    } finally {
      if (shouldStopAfterCurrentTicket()) {
        await pauseWorkerForGracefulStop(`current ticket ${ticket.id} finished`);
      } else {
        await enqueueRunnableTickets();
      }
    }
  },
  {
    connection,
    concurrency: PIPELINE.workerConcurrency,
  },
);

if (shouldStopAfterCurrentTicket()) {
  void pauseWorkerForGracefulStop("startup stop request");
}
