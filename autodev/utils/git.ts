import { execFileSync } from "node:child_process";

function runGit(cwd: string, args: string[]) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

export function currentHead(cwd: string) {
  return runGit(cwd, ["rev-parse", "HEAD"]);
}

export function hasChanges(cwd: string) {
  return runGit(cwd, ["status", "--porcelain"]).length > 0;
}

export function trackedDiff(cwd: string, baseRef: string) {
  return runGit(cwd, ["diff", "--stat", `${baseRef}..HEAD`]);
}

export function workingTreeStatus(cwd: string) {
  return runGit(cwd, ["status", "--short"]);
}

export function workingTreeDiff(cwd: string) {
  return runGit(cwd, ["diff", "--", "."]);
}

export function commitTicket(cwd: string, ticketId: string, title: string) {
  execFileSync("git", ["add", "-A"], { cwd, stdio: "inherit" });
  execFileSync("git", ["commit", "-m", `${ticketId} ${title}`], { cwd, stdio: "inherit" });
  return currentHead(cwd);
}
