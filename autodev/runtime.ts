import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const autodevEntry = fileURLToPath(import.meta.url);

export const autodevRoot = path.dirname(autodevEntry);
export const repoRoot = path.resolve(autodevRoot, "..");

dotenv.config({ path: path.join(autodevRoot, ".env") });

export function resolveAutodevPath(...segments: string[]) {
  return path.join(autodevRoot, ...segments);
}

export function resolveRepoPath(...segments: string[]) {
  return path.join(repoRoot, ...segments);
}
