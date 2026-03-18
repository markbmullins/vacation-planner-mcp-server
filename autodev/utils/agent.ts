import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { PIPELINE } from "../pipeline.js";
import { resolveAutodevPath } from "../runtime.js";
import type { ReviewResult, Ticket } from "../types.js";
import { logger } from "./logger.js";
import { buildAgentUsageRecord, recordTicketUsage, usageWarningThreshold } from "./usage.js";

export interface AgentRunArtifacts {
  promptPath: string;
  stdoutPath: string;
  stderrPath: string;
}

export class AgentExecutionError extends Error {
  readonly agent: string;
  readonly model?: string;
  readonly promptChars: number;
  readonly promptTokensEstimate: number;
  readonly stderr: string;
  readonly stdout: string;
  readonly exitStatus?: number | null;
  readonly artifacts?: AgentRunArtifacts;

  constructor(options: {
    causeMessage: string;
    agent: string;
    model?: string;
    promptChars: number;
    promptTokensEstimate: number;
    stderr: string;
    stdout: string;
    exitStatus?: number | null;
    artifacts?: AgentRunArtifacts;
  }) {
    super(options.causeMessage);
    this.name = "AgentExecutionError";
    this.agent = options.agent;
    this.model = options.model;
    this.promptChars = options.promptChars;
    this.promptTokensEstimate = options.promptTokensEstimate;
    this.stderr = options.stderr;
    this.stdout = options.stdout;
    this.exitStatus = options.exitStatus;
    this.artifacts = options.artifacts;
  }
}

const OPENCODE = process.env.AUTODEV_OPENCODE_URL ?? "http://localhost:4096";
const IMPLEMENT_MODEL = process.env.AUTODEV_IMPLEMENT_MODEL;
const REVIEW_MODEL = process.env.AUTODEV_REVIEW_MODEL;
const IMPLEMENT_AGENT = process.env.AUTODEV_IMPLEMENT_AGENT ?? "backend-engineer";
const REVIEW_AGENT = process.env.AUTODEV_REVIEW_AGENT ?? "production-readiness-reviewer";

const implementPromptTemplate = fs.readFileSync(resolveAutodevPath("prompts", "implement.txt"), "utf8");
const reviewPromptTemplate = fs.readFileSync(resolveAutodevPath("prompts", "review.txt"), "utf8");
const testFailurePromptTemplate = fs.readFileSync(resolveAutodevPath("prompts", "testFailure.txt"), "utf8");

function createAgentArtifacts(runDir: string, stage: string, attempt: number): AgentRunArtifacts {
  return {
    promptPath: path.join(runDir, `${stage}-${attempt}-prompt.txt`),
    stdoutPath: path.join(runDir, `${stage}-${attempt}-stdout.txt`),
    stderrPath: path.join(runDir, `${stage}-${attempt}-stderr.txt`),
  };
}

async function runOpenCodeAgent(
  ticketId: string,
  cwd: string,
  agent: string,
  model: string | undefined,
  prompt: string,
  runDir: string,
  stage: string,
  attempt: number,
  onHeartbeat?: () => void,
) {
  const args = ["run", "--attach", OPENCODE, "--dir", cwd, "--agent", agent];

  if (model) {
    args.push("--model", model);
  }

  args.push(prompt);

  const startedAt = Date.now();
  const artifacts = createAgentArtifacts(runDir, stage, attempt);
  fs.writeFileSync(artifacts.promptPath, prompt, "utf8");
  const stdoutStream = fs.createWriteStream(artifacts.stdoutPath, { flags: "w" });
  const stderrStream = fs.createWriteStream(artifacts.stderrPath, { flags: "w" });

  logger.info("Starting OpenCode agent call", {
    ticketId,
    agent,
    model,
    stage,
    attempt,
    promptChars: prompt.length,
    promptTokensEstimate: Math.ceil(prompt.length / 4),
    promptPath: artifacts.promptPath,
    stdoutPath: artifacts.stdoutPath,
    stderrPath: artifacts.stderrPath,
  });

  const output = await new Promise<string>((resolve, reject) => {
    const child = spawn("opencode", args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let finished = false;

    const heartbeat = setInterval(() => {
      onHeartbeat?.();
      logger.info("OpenCode agent call still running", {
        ticketId,
        agent,
        model,
        stage,
        attempt,
        elapsedMs: Date.now() - startedAt,
        stdoutChars: stdout.length,
        stderrChars: stderr.length,
      });
    }, PIPELINE.agentHeartbeatMs);

    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
    }, PIPELINE.agentTimeoutMs);

    const finalize = (handler: () => void) => {
      if (finished) {
        return;
      }

      finished = true;
      clearInterval(heartbeat);
      clearTimeout(timeout);
      stdoutStream.end();
      stderrStream.end();
      handler();
    };

    child.stdout.on("data", (chunk: Buffer | string) => {
      const text = String(chunk);
      stdout += text;
      stdoutStream.write(text);
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      const text = String(chunk);
      stderr += text;
      stderrStream.write(text);
    });

    child.on("error", (error) => {
      finalize(() => {
        reject(new AgentExecutionError({
          causeMessage: error.message,
          agent,
          model,
          promptChars: prompt.length,
          promptTokensEstimate: Math.ceil(prompt.length / 4),
          stderr,
          stdout,
          artifacts,
        }));
      });
    });

    child.on("close", (code, signal) => {
      if (code === 0) {
        finalize(() => resolve(stdout));
        return;
      }

      const timedOut = signal === "SIGTERM" && Date.now() - startedAt >= PIPELINE.agentTimeoutMs;

      finalize(() => {
        reject(new AgentExecutionError({
          causeMessage: timedOut
            ? `OpenCode agent call timed out after ${PIPELINE.agentTimeoutMs}ms`
            : `OpenCode agent exited with code ${String(code)}${signal ? ` and signal ${signal}` : ""}`,
          agent,
          model,
          promptChars: prompt.length,
          promptTokensEstimate: Math.ceil(prompt.length / 4),
          stderr,
          stdout,
          exitStatus: code,
          artifacts,
        }));
      });
    });
  }).catch((error) => {
    if (error instanceof AgentExecutionError) {
      logger.error("OpenCode agent call failed", {
        ticketId,
        agent,
        model,
        stage,
        attempt,
        durationMs: Date.now() - startedAt,
        promptChars: error.promptChars,
        promptTokensEstimate: error.promptTokensEstimate,
        exitStatus: error.exitStatus,
        stderrPreview: error.stderr.slice(0, 1000),
        stdoutPreview: error.stdout.slice(0, 500),
        promptPath: artifacts.promptPath,
        stdoutPath: artifacts.stdoutPath,
        stderrPath: artifacts.stderrPath,
      });
    }

    throw error;
  });

  const usage = buildAgentUsageRecord(agent, model, prompt, output);
  const summary = recordTicketUsage(ticketId, usage);

  logger.info("Completed OpenCode agent call", {
    ticketId,
    agent,
    model,
    stage,
    attempt,
    durationMs: Date.now() - startedAt,
    promptTokensEstimate: usage.promptTokensEstimate,
    outputTokensEstimate: usage.outputTokensEstimate,
    totalTokensEstimate: usage.totalTokensEstimate,
    cumulativeTicketTokensEstimate: summary.totalTokensEstimate,
    cumulativeCalls: summary.calls,
    promptPath: artifacts.promptPath,
    stdoutPath: artifacts.stdoutPath,
    stderrPath: artifacts.stderrPath,
  });

  if (summary.totalTokensEstimate >= usageWarningThreshold()) {
    logger.warn("Ticket estimated token usage crossed warning threshold", {
      ticketId,
      cumulativeTicketTokensEstimate: summary.totalTokensEstimate,
      warningThreshold: usageWarningThreshold(),
      cumulativeCalls: summary.calls,
    });
  }

  return output;
}

export function buildImplementPrompt(ticket: Ticket, context: string) {
  return implementPromptTemplate
    .replace("{{ticket}}", JSON.stringify(ticket, null, 2))
    .replace("{{context}}", context);
}

export function buildRepairPrompt(ticket: Ticket, review: ReviewResult) {
  return [
    "The previous implementation did not pass review.",
    "Address every blocking issue below, keep the changes scoped to the ticket, and do not commit.",
    `Ticket:\n${JSON.stringify(ticket, null, 2)}`,
    `Review Summary:\n${review.summary}`,
    `Blocking Issues:\n${review.issues.map((issue, index) => `${index + 1}. ${issue}`).join("\n")}`,
  ].join("\n\n");
}

export function buildTestFailurePrompt(ticket: Ticket, testOutput: string) {
  return testFailurePromptTemplate
    .replace("{{ticket}}", JSON.stringify(ticket, null, 2))
    .replace("{{testOutput}}", testOutput);
}

export function buildResumeImplementPrompt(ticket: Ticket, context: string, lastError?: string) {
  return [
    "Resume work on the following ticket from the current worktree state.",
    "The previous run was interrupted or failed before the ticket completed.",
    "Inspect the existing files in the worktree, keep all valid progress, and continue without restarting from scratch.",
    lastError ? `Last pipeline error:\n${lastError}` : "",
    `Ticket:\n${JSON.stringify(ticket, null, 2)}`,
    `Relevant Context:\n${context}`,
  ].filter(Boolean).join("\n\n");
}

export function runImplementAgent(
  ticketId: string,
  cwd: string,
  prompt: string,
  runDir: string,
  attempt: number,
  onHeartbeat?: () => void,
) {
  return runOpenCodeAgent(ticketId, cwd, IMPLEMENT_AGENT, IMPLEMENT_MODEL, prompt, runDir, "implement", attempt, onHeartbeat);
}

export function runReviewAgent(cwd: string, ticket: Ticket, runDir: string, attempt: number, onHeartbeat?: () => void) {
  const prompt = reviewPromptTemplate.replace("{{ticket}}", JSON.stringify(ticket, null, 2));
  return runOpenCodeAgent(ticket.id, cwd, REVIEW_AGENT, REVIEW_MODEL, prompt, runDir, "review", attempt, onHeartbeat);
}

export function parseReviewResult(output: string): ReviewResult {
  const match = output.match(/AUTODEV_REVIEW_JSON_START\s*([\s\S]*?)\s*AUTODEV_REVIEW_JSON_END/);

  if (!match) {
    throw new Error("Review output did not include AUTODEV_REVIEW_JSON markers");
  }

  let parsed: Partial<ReviewResult>;

  try {
    parsed = JSON.parse(match[1]) as Partial<ReviewResult>;
  } catch {
    throw new Error(`Review output contained invalid JSON: ${match[1].slice(0, 500)}`);
  }

  if (parsed.status !== "approved" && parsed.status !== "changes_required") {
    throw new Error("Review output contained an invalid status");
  }

  if (typeof parsed.summary !== "string") {
    throw new Error("Review output summary must be a string");
  }

  if (!Array.isArray(parsed.issues)) {
    throw new Error("Review output issues must be an array");
  }

  const normalizedIssues = parsed.issues.map((issue) => {
    if (typeof issue === "string") {
      return issue;
    }

    if (issue && typeof issue === "object") {
      const structuredIssue = issue as { severity?: unknown; title?: unknown; details?: unknown };
      const severity = typeof structuredIssue.severity === "string" ? structuredIssue.severity.toUpperCase() : "ISSUE";
      const title = typeof structuredIssue.title === "string" ? structuredIssue.title : "Untitled issue";
      const details = typeof structuredIssue.details === "string" ? structuredIssue.details : JSON.stringify(issue);
      return `${severity}: ${title} - ${details}`;
    }

    return String(issue);
  });

  return {
    status: parsed.status,
    summary: parsed.summary,
    issues: normalizedIssues,
  };
}
