import fs from "node:fs";
import path from "node:path";
import { resolveAutodevPath } from "../runtime.js";

export interface AgentUsageRecord {
  agent: string;
  model?: string;
  promptChars: number;
  promptTokensEstimate: number;
  outputChars: number;
  outputTokensEstimate: number;
  totalTokensEstimate: number;
  promptHash: string;
  createdAt: string;
}

export interface TicketUsageSummary {
  ticketId: string;
  calls: number;
  promptTokensEstimate: number;
  outputTokensEstimate: number;
  totalTokensEstimate: number;
  updatedAt: string;
}

const usageDir = resolveAutodevPath(".state");
const usagePath = path.join(usageDir, "usage.json");

function ensureUsageDir() {
  fs.mkdirSync(usageDir, { recursive: true });
}

function estimateTokens(text: string) {
  if (text.length === 0) {
    return 0;
  }

  return Math.ceil(text.length / 4);
}

function stableHash(text: string) {
  let hash = 0;

  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(index)) | 0;
  }

  return `h${Math.abs(hash)}`;
}

function readUsageState() {
  ensureUsageDir();

  if (!fs.existsSync(usagePath)) {
    return { tickets: {} as Record<string, TicketUsageSummary> };
  }

  return JSON.parse(fs.readFileSync(usagePath, "utf8")) as {
    tickets: Record<string, TicketUsageSummary>;
  };
}

function writeUsageState(state: { tickets: Record<string, TicketUsageSummary> }) {
  ensureUsageDir();
  fs.writeFileSync(usagePath, JSON.stringify(state, null, 2) + "\n", "utf8");
}

export function buildAgentUsageRecord(agent: string, model: string | undefined, prompt: string, output: string): AgentUsageRecord {
  const promptTokensEstimate = estimateTokens(prompt);
  const outputTokensEstimate = estimateTokens(output);

  return {
    agent,
    model,
    promptChars: prompt.length,
    promptTokensEstimate,
    outputChars: output.length,
    outputTokensEstimate,
    totalTokensEstimate: promptTokensEstimate + outputTokensEstimate,
    promptHash: stableHash(prompt),
    createdAt: new Date().toISOString(),
  };
}

// Tracks approximate per-ticket model spend even when the CLI does not expose
// exact provider token accounting.
export function recordTicketUsage(ticketId: string, record: AgentUsageRecord) {
  const state = readUsageState();
  const summary = state.tickets[ticketId] ?? {
    ticketId,
    calls: 0,
    promptTokensEstimate: 0,
    outputTokensEstimate: 0,
    totalTokensEstimate: 0,
    updatedAt: new Date().toISOString(),
  };

  summary.calls += 1;
  summary.promptTokensEstimate += record.promptTokensEstimate;
  summary.outputTokensEstimate += record.outputTokensEstimate;
  summary.totalTokensEstimate += record.totalTokensEstimate;
  summary.updatedAt = new Date().toISOString();

  state.tickets[ticketId] = summary;
  writeUsageState(state);

  return summary;
}

export function usageWarningThreshold() {
  const value = Number(process.env.AUTODEV_USAGE_WARN_TOKENS ?? "250000");

  if (!Number.isFinite(value) || value < 1) {
    return 250000;
  }

  return Math.floor(value);
}
