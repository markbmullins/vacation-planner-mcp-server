import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { PIPELINE } from "../pipeline.js";
import { resolveAutodevPath } from "../runtime.js";
import type { ReviewResult, Ticket } from "../types.js";
import { logger } from "./logger.js";
import { buildAgentUsageRecord, recordTicketUsage, usageWarningThreshold } from "./usage.js";

const OPENCODE = process.env.AUTODEV_OPENCODE_URL ?? "http://localhost:4096";
const IMPLEMENT_MODEL = process.env.AUTODEV_IMPLEMENT_MODEL;
const REVIEW_MODEL = process.env.AUTODEV_REVIEW_MODEL;
const IMPLEMENT_AGENT = process.env.AUTODEV_IMPLEMENT_AGENT ?? "backend-engineer";
const REVIEW_AGENT = process.env.AUTODEV_REVIEW_AGENT ?? "production-readiness-reviewer";

const implementPromptTemplate = fs.readFileSync(resolveAutodevPath("prompts", "implement.txt"), "utf8");
const reviewPromptTemplate = fs.readFileSync(resolveAutodevPath("prompts", "review.txt"), "utf8");
const testFailurePromptTemplate = fs.readFileSync(resolveAutodevPath("prompts", "testFailure.txt"), "utf8");

function runOpenCodeAgent(ticketId: string, cwd: string, agent: string, model: string | undefined, prompt: string) {
  const args = ["run", "--attach", OPENCODE, "--agent", agent];

  if (model) {
    args.push("--model", model);
  }

  args.push(prompt);

  const startedAt = Date.now();

  logger.info("Starting OpenCode agent call", {
    ticketId,
    agent,
    model,
    promptChars: prompt.length,
    promptTokensEstimate: Math.ceil(prompt.length / 4),
  });

  const output = execFileSync("opencode", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    timeout: PIPELINE.agentTimeoutMs,
  });

  const usage = buildAgentUsageRecord(agent, model, prompt, output);
  const summary = recordTicketUsage(ticketId, usage);

  logger.info("Completed OpenCode agent call", {
    ticketId,
    agent,
    model,
    durationMs: Date.now() - startedAt,
    promptTokensEstimate: usage.promptTokensEstimate,
    outputTokensEstimate: usage.outputTokensEstimate,
    totalTokensEstimate: usage.totalTokensEstimate,
    cumulativeTicketTokensEstimate: summary.totalTokensEstimate,
    cumulativeCalls: summary.calls,
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

export function runImplementAgent(ticketId: string, cwd: string, prompt: string) {
  return runOpenCodeAgent(ticketId, cwd, IMPLEMENT_AGENT, IMPLEMENT_MODEL, prompt);
}

export function runReviewAgent(cwd: string, ticket: Ticket) {
  const prompt = reviewPromptTemplate.replace("{{ticket}}", JSON.stringify(ticket, null, 2));
  return runOpenCodeAgent(ticket.id, cwd, REVIEW_AGENT, REVIEW_MODEL, prompt);
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

  if (!Array.isArray(parsed.issues) || parsed.issues.some((issue) => typeof issue !== "string")) {
    throw new Error("Review output issues must be an array of strings");
  }

  return {
    status: parsed.status,
    summary: parsed.summary,
    issues: parsed.issues,
  };
}
