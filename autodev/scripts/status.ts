import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { closeQueue, ticketQueue } from "../queue.js";
import { readControlState } from "../control.js";
import { readRuntimeState, readTickets } from "../tickets.js";

interface Pm2Process {
  name?: string;
  pm2_env?: { status?: string };
}

function pm2Processes() {
  try {
    const output = execFileSync("pm2", ["jlist"], { encoding: "utf8" });
    return JSON.parse(output) as Pm2Process[];
  } catch {
    return [];
  }
}

function pm2Status(name: string) {
  const process = pm2Processes().find((entry) => entry.name === name);
  return process?.pm2_env?.status ?? "offline";
}

function latestRunArtifacts(runDir: string) {
  if (!fs.existsSync(runDir)) {
    return [] as string[];
  }

  return fs.readdirSync(runDir)
    .map((entry) => ({
      entry,
      mtimeMs: fs.statSync(path.join(runDir, entry)).mtimeMs,
    }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, 5)
    .map((item) => item.entry);
}

function worktreeGitStatus(worktreePath: string) {
  try {
    return execFileSync("git", ["status", "--short"], { cwd: worktreePath, encoding: "utf8" }).trim();
  } catch (error) {
    return `ERROR: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function main() {
  const tickets = readTickets();
  const runtime = readRuntimeState();
  const control = readControlState();

  console.log("Autodev Status\n");
  console.log(`Control stop-after-current: ${control.stopAfterCurrentTicket ? "requested" : "off"}`);
  console.log(`Control updated: ${control.updatedAt}`);
  console.log(`PM2 autodev-opencode: ${pm2Status("autodev-opencode")}`);
  console.log(`PM2 autodev-workers: ${pm2Status("autodev-workers")}`);
  console.log(`PM2 autodev-controller: ${pm2Status("autodev-controller")}\n`);

  for (const ticket of tickets) {
    const runtimeTicket = runtime.tickets[ticket.id];
    const job = await ticketQueue.getJob(`ticket-${ticket.id}`);
    const queueState = job ? await job.getState() : "none";

    const interesting = runtimeTicket || queueState !== "none";

    if (!interesting) {
      continue;
    }

    console.log(`${ticket.id} - ${ticket.title}`);
    console.log(`  runtime_status: ${runtimeTicket?.status ?? "none"}`);
    console.log(`  runtime_stage: ${runtimeTicket?.stage ?? "none"}`);
    console.log(`  attempt: ${runtimeTicket?.attempt ?? 0}`);
    console.log(`  queue_state: ${queueState}`);
    console.log(`  updated_at: ${runtimeTicket?.updatedAt ?? "-"}`);

    if (runtimeTicket?.branch) {
      console.log(`  branch: ${runtimeTicket.branch}`);
    }

    if (runtimeTicket?.worktreePath) {
      const exists = fs.existsSync(runtimeTicket.worktreePath);
      console.log(`  worktree_exists: ${exists}`);
      console.log(`  worktree_path: ${runtimeTicket.worktreePath}`);

      if (exists) {
        const gitStatus = worktreeGitStatus(runtimeTicket.worktreePath);
        console.log(`  worktree_git_status: ${gitStatus || "clean"}`);
      }
    }

    if (runtimeTicket?.runDir) {
      const exists = fs.existsSync(runtimeTicket.runDir);
      console.log(`  run_dir_exists: ${exists}`);
      console.log(`  run_dir: ${runtimeTicket.runDir}`);

      if (exists) {
        console.log(`  latest_artifacts: ${latestRunArtifacts(runtimeTicket.runDir).join(", ") || "none"}`);
      }
    }

    if (runtimeTicket?.pendingReviewIssues?.length) {
      console.log(`  pending_review_issues: ${runtimeTicket.pendingReviewIssues.length}`);
    }

    if (runtimeTicket?.pendingTestOutputPath) {
      console.log(`  pending_test_output: ${runtimeTicket.pendingTestOutputPath}`);
    }

    if (runtimeTicket?.deferredFollowupId) {
      console.log(`  deferred_followup: ${runtimeTicket.deferredFollowupId}`);
    }

    if (runtimeTicket?.lastError) {
      console.log(`  last_error: ${runtimeTicket.lastError.slice(0, 220)}`);
    }

    const warnings: string[] = [];

    if (runtimeTicket?.status === "in_progress" && queueState === "none") {
      warnings.push("runtime says in_progress but there is no queue job");
    }

    if (runtimeTicket?.status === "in_progress" && runtimeTicket.worktreePath && !fs.existsSync(runtimeTicket.worktreePath)) {
      warnings.push("runtime says in_progress but referenced worktree is missing");
    }

    if (!runtimeTicket && queueState !== "none") {
      warnings.push("queue job exists without runtime state");
    }

    if (warnings.length > 0) {
      console.log(`  warnings: ${warnings.join(" | ")}`);
    }

    console.log("");
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeQueue();
  });
