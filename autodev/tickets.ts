import fs from "node:fs";
import path from "node:path";
import { ticketQueue } from "./queue.js";
import { resolveAutodevPath, resolveRepoPath } from "./runtime.js";
import type { RuntimeState, RuntimeTicketState, Ticket, TicketStatus } from "./types.js";
import { logger } from "./utils/logger.js";

const ticketStatePath = resolveRepoPath("docs", "ticket-state.json");
const runtimeStateDir = resolveAutodevPath(".state");
const runtimeStatePath = path.join(runtimeStateDir, "runtime-state.json");
const runtimeStateLockDir = path.join(runtimeStateDir, "runtime-state.lock");
const runtimeStateLockInfoPath = path.join(runtimeStateLockDir, "owner.json");
const stateLockStaleMs = 5 * 60 * 1000;

function ensureRuntimeStateDir() {
  fs.mkdirSync(runtimeStateDir, { recursive: true });
}

function writeJsonAtomic(filePath: string, value: unknown) {
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(value, null, 2) + "\n", "utf8");
  fs.renameSync(tempPath, filePath);
}

function isPidAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function writeLockInfo() {
  fs.writeFileSync(
    runtimeStateLockInfoPath,
    JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() }, null, 2) + "\n",
    "utf8",
  );
}

// Clears abandoned runtime-state locks after crashes by checking lock age and
// whether the recorded owning PID is still alive.
function removeStaleLockIfNeeded() {
  if (!fs.existsSync(runtimeStateLockInfoPath)) {
    return false;
  }

  try {
    const payload = JSON.parse(fs.readFileSync(runtimeStateLockInfoPath, "utf8")) as {
      pid?: number;
      acquiredAt?: string;
    };
    const lockAgeMs = payload.acquiredAt ? Date.now() - Date.parse(payload.acquiredAt) : Number.POSITIVE_INFINITY;
    const pidAlive = typeof payload.pid === "number" ? isPidAlive(payload.pid) : false;

    if (pidAlive && lockAgeMs < stateLockStaleMs) {
      return false;
    }
  } catch {
    // Fall through and treat unreadable metadata as stale.
  }

  fs.rmSync(runtimeStateLockDir, { recursive: true, force: true });
  return true;
}

export function readTickets() {
  return JSON.parse(fs.readFileSync(ticketStatePath, "utf8")) as Ticket[];
}

export function readRuntimeState(): RuntimeState {
  ensureRuntimeStateDir();

  if (!fs.existsSync(runtimeStatePath)) {
    return { tickets: {} };
  }

  return JSON.parse(fs.readFileSync(runtimeStatePath, "utf8")) as RuntimeState;
}

export function writeRuntimeState(state: RuntimeState) {
  ensureRuntimeStateDir();
  writeJsonAtomic(runtimeStatePath, state);
}

// Serializes runtime-state updates through a filesystem lock so controller and
// worker processes do not clobber each other's ticket transitions.
function acquireStateLock() {
  ensureRuntimeStateDir();

  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      fs.mkdirSync(runtimeStateLockDir);
      writeLockInfo();
      return;
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") {
        throw error;
      }

      if (removeStaleLockIfNeeded()) {
        continue;
      }

      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
  }

  throw new Error(
    "Timed out acquiring autodev runtime-state lock; if the system was interrupted, remove autodev/.state/runtime-state.lock and retry",
  );
}

function releaseStateLock() {
  if (fs.existsSync(runtimeStateLockDir)) {
    fs.rmSync(runtimeStateLockDir, { recursive: true, force: true });
  }
}

function withStateLock<T>(fn: () => T) {
  acquireStateLock();

  try {
    return fn();
  } finally {
    releaseStateLock();
  }
}

export function resolveTicketStatus(ticket: Ticket, runtime: RuntimeState): TicketStatus {
  return runtime.tickets[ticket.id]?.status ?? ticket.status;
}

export function setRuntimeTicketState(ticketId: string, state: Omit<RuntimeTicketState, "updatedAt">) {
  withStateLock(() => {
    const runtime = readRuntimeState();
    runtime.tickets[ticketId] = {
      ...state,
      updatedAt: new Date().toISOString(),
    };
    writeRuntimeState(runtime);
  });
}

export function getTicketById(ticketId: string) {
  return readTickets().find((ticket) => ticket.id === ticketId) ?? null;
}

export function getRunnableTickets() {
  const tickets = readTickets();
  const runtime = readRuntimeState();

  return tickets.filter((ticket) => {
    if (resolveTicketStatus(ticket, runtime) !== "todo") {
      return false;
    }

    return ticket.dependencies.every((dependencyId) => {
      const dependency = tickets.find((candidate) => candidate.id === dependencyId);

      if (!dependency) {
        return false;
      }

      return resolveTicketStatus(dependency, runtime) === "done";
    });
  });
}

export async function enqueueRunnableTickets() {
  const runnable = getRunnableTickets();
  const enqueued: string[] = [];

  for (const ticket of runnable) {
    await ticketQueue.add(
      "process-ticket",
      { ticketId: ticket.id },
      { jobId: `ticket:${ticket.id}` },
    );
    enqueued.push(ticket.id);
  }

  if (enqueued.length > 0) {
    logger.info("Enqueued runnable tickets", {
      ticketIds: enqueued,
      count: enqueued.length,
    });
  }

  return enqueued;
}

// Rebuilds a safe runtime view after restarts by blocking tickets that were
// left in-progress without a live BullMQ job behind them.
export async function reconcileRuntimeState() {
  const runtime = readRuntimeState();

  for (const [ticketId, state] of Object.entries(runtime.tickets)) {
    if (state.status !== "in_progress") {
      continue;
    }

    const job = await ticketQueue.getJob(`ticket:${ticketId}`);

    if (!job) {
      logger.warn("Reconciling stale in-progress ticket without queue job", { ticketId });
      setRuntimeTicketState(ticketId, {
        ...state,
        status: "blocked",
        lastError: "Recovered stale in-progress ticket with no queue job; manual inspection required",
      });
      continue;
    }

    const jobState = await job.getState();

    if (!["waiting", "active", "delayed", "prioritized"].includes(jobState)) {
      logger.warn("Reconciling stale in-progress ticket with unexpected BullMQ state", {
        ticketId,
        jobState,
      });
      setRuntimeTicketState(ticketId, {
        ...state,
        status: "blocked",
        lastError: `Recovered stale in-progress ticket in BullMQ state '${jobState}'; manual inspection required`,
      });
    }
  }
}
