import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { resolveAutodevPath, repoRoot } from "../runtime.js";
import { currentHead } from "./git.js";

const worktreeRoot = resolveAutodevPath(".worktrees");
const integrationBranch = "autodev/integration";

function sanitizeSegment(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

function resolveBaseRef() {
  const configured = process.env.AUTODEV_BASE_REF?.trim();

  if (configured) {
    return configured;
  }

  try {
    return execFileSync("git", ["symbolic-ref", "--quiet", "--short", "HEAD"], {
      cwd: repoRoot,
      encoding: "utf8",
    }).trim();
  } catch {
    return currentHead(repoRoot);
  }
}

export interface WorktreeHandle {
  branch: string;
  path: string;
  baseSha: string;
}

function branchExists(branch: string) {
  try {
    execFileSync("git", ["show-ref", "--verify", `refs/heads/${branch}`], {
      cwd: repoRoot,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

// Pins ticket worktrees to a stable integration line so dependency-ordered
// tickets build on previously accepted autodev commits.
export function ensureIntegrationBranch() {
  const baseRef = resolveBaseRef();
  const head = execFileSync("git", ["rev-parse", baseRef], {
    cwd: repoRoot,
    encoding: "utf8",
  }).trim();

  if (!branchExists(integrationBranch)) {
    execFileSync("git", ["branch", integrationBranch, baseRef], {
      cwd: repoRoot,
      stdio: "inherit",
    });
    return head;
  }

  return execFileSync("git", ["rev-parse", integrationBranch], {
    cwd: repoRoot,
    encoding: "utf8",
  }).trim();
}

// Advances the shared integration branch with a compare-and-swap update so a
// stale worker cannot silently overwrite newer integrated work.
export function advanceIntegrationBranch(previousSha: string, nextSha: string) {
  execFileSync(
    "git",
    ["update-ref", `refs/heads/${integrationBranch}`, nextSha, previousSha],
    {
      cwd: repoRoot,
      stdio: "inherit",
    },
  );
}

// Creates a disposable per-ticket worktree and branch so implementation runs
// never touch the user's primary checkout.
export function createTicketWorktree(ticketId: string): WorktreeHandle {
  fs.mkdirSync(worktreeRoot, { recursive: true });

  const baseSha = ensureIntegrationBranch();
  const suffix = Date.now().toString(36);
  const safeTicketId = sanitizeSegment(ticketId);
  const branch = `autodev/${safeTicketId}-${suffix}`;
  const targetPath = path.join(worktreeRoot, `${safeTicketId}-${suffix}`);

  execFileSync("git", ["worktree", "add", "-b", branch, targetPath, baseSha], {
    cwd: repoRoot,
    stdio: "inherit",
  });

  return { branch, path: targetPath, baseSha };
}

export function removeTicketWorktree(worktreePath: string) {
  if (!fs.existsSync(worktreePath)) {
    return;
  }

  execFileSync("git", ["worktree", "remove", "--force", worktreePath], {
    cwd: repoRoot,
    stdio: "inherit",
  });
}

export function deleteTicketBranch(branch: string) {
  execFileSync("git", ["branch", "-D", branch], {
    cwd: repoRoot,
    stdio: "inherit",
  });
}
