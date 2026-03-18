import fs from "fs";
import path from "path";
import { execFileSync, execSync } from "child_process";
import { repoRoot } from "../runtime.js";
import type { Ticket } from "../types.js";

const CORE_CONTEXT_FILES = [
  "AGENTS.md",
  "docs/product-spec.md",
  "docs/system-architecture.md",
  "docs/phased-build-plan.md",
  "docs/data-model.md",
  "docs/mcp-tool-schema.md",
];

const STOP_WORDS = new Set([
  "and",
  "for",
  "the",
  "with",
  "from",
  "into",
  "after",
  "before",
  "under",
  "over",
  "base",
  "initial",
  "model",
]);

const contextFileLimitValue = Number(process.env.AUTODEV_CONTEXT_FILE_LIMIT ?? "10");
const CONTEXT_FILE_LIMIT = Number.isInteger(contextFileLimitValue) && contextFileLimitValue > 0
  ? contextFileLimitValue
  : 10;

const contextSnippetLinesValue = Number(process.env.AUTODEV_CONTEXT_SNIPPET_LINES ?? "20");
const CONTEXT_SNIPPET_LINES = Number.isInteger(contextSnippetLinesValue) && contextSnippetLinesValue > 0
  ? contextSnippetLinesValue
  : 20;

const contextDocLimitValue = Number(process.env.AUTODEV_CONTEXT_DOC_LIMIT ?? "3");
const CONTEXT_DOC_LIMIT = Number.isInteger(contextDocLimitValue) && contextDocLimitValue > 0
  ? contextDocLimitValue
  : 3;

const contextMaxCharsValue = Number(process.env.AUTODEV_CONTEXT_MAX_CHARS ?? "40000");
const CONTEXT_MAX_CHARS = Number.isInteger(contextMaxCharsValue) && contextMaxCharsValue > 5000
  ? contextMaxCharsValue
  : 40000;

const contextImportNeighborLimitValue = Number(process.env.AUTODEV_CONTEXT_IMPORT_NEIGHBOR_LIMIT ?? "6");
const CONTEXT_IMPORT_NEIGHBOR_LIMIT = Number.isInteger(contextImportNeighborLimitValue) && contextImportNeighborLimitValue > 0
  ? contextImportNeighborLimitValue
  : 6;

interface RetrievalPlan {
  keywords: string[];
  primaryFiles: string[];
  secondaryFiles: string[];
  contentMatches: Map<string, number[]>;
  importNeighbors: Map<string, string[]>;
}

function tokenize(text: string) {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word));
}

function unique<T>(values: T[]) {
  return Array.from(new Set(values));
}

function buildKeywords(ticket: Ticket) {
  const words = tokenize(ticket.title);
  const bigrams: string[] = [];

  for (let index = 0; index < words.length - 1; index += 1) {
    bigrams.push(`${words[index]} ${words[index + 1]}`);
  }

  return unique([ticket.title.toLowerCase(), ...bigrams, ...words]).slice(0, 16);
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Searches the repo for lightweight content hits so we can seed context
// with exact line windows instead of full files.
function runContentSearch(keywords: string[]) {
  if (keywords.length === 0) {
    return new Map<string, number[]>();
  }

  const pattern = keywords.slice(0, 8).map(escapeRegex).join("|");

  if (!pattern) {
    return new Map<string, number[]>();
  }

  try {
    const output = execFileSync(
      "rg",
      [
        "-n",
        "-i",
        "--no-heading",
        "--glob",
        "!node_modules/**",
        "--glob",
        "!autodev/node_modules/**",
        pattern,
        ".",
      ],
      { cwd: repoRoot, encoding: "utf8", maxBuffer: 2 * 1024 * 1024 },
    );

    const matches = new Map<string, number[]>();

    for (const line of output.split("\n")) {
      if (!line) {
        continue;
      }

      const match = line.match(/^(.+?):(\d+):/);

      if (!match) {
        continue;
      }

      const file = match[1].replace(/^\.\//, "");
      const lineNumber = Number(match[2]);
      const existing = matches.get(file) ?? [];

      if (existing.length < 6) {
        existing.push(lineNumber);
      }

      matches.set(file, existing);
    }

    return matches;
  } catch (error) {
    if (error instanceof Error && "status" in error && error.status === 1) {
      return new Map<string, number[]>();
    }

    return new Map<string, number[]>();
  }
}

function scoreFile(file: string, keywords: string[], contentMatches: Map<string, number[]>) {
  const lowerFile = file.toLowerCase();
  const basename = path.basename(lowerFile);
  let score = 0;

  for (const keyword of keywords) {
    if (keyword.includes(" ")) {
      continue;
    }

    if (basename.includes(keyword)) {
      score += 10;
    }

    if (lowerFile.includes(`/${keyword}`) || lowerFile.includes(`${keyword}/`)) {
      score += 5;
    }

    if (lowerFile.includes(keyword)) {
      score += 2;
    }
  }

  if (lowerFile.startsWith("docs/")) {
    score += 1;
  }

  if (lowerFile.endsWith(".ts") || lowerFile.endsWith(".tsx")) {
    score += 2;
  }

  if (lowerFile.endsWith("package.json") || lowerFile.endsWith("tsconfig.json")) {
    score += 2;
  }

  score += Math.min((contentMatches.get(file)?.length ?? 0) * 4, 20);

  return score;
}

function readFileLines(filePath: string) {
  return fs.readFileSync(filePath, "utf8").split(/\r?\n/);
}

// Resolves one-hop relative imports into tracked repo files so retrieval can
// suggest nearby implementation surfaces without traversing the whole graph.
function tryResolveImportPath(fromFile: string, importPath: string, trackedFiles: Set<string>) {
  if (!importPath.startsWith(".")) {
    return null;
  }

  const fromDir = path.posix.dirname(fromFile);
  const normalizedBase = path.posix.normalize(path.posix.join(fromDir, importPath));
  const candidates = [
    normalizedBase,
    `${normalizedBase}.ts`,
    `${normalizedBase}.tsx`,
    `${normalizedBase}.js`,
    `${normalizedBase}.mjs`,
    `${normalizedBase}.cjs`,
    path.posix.join(normalizedBase, "index.ts"),
    path.posix.join(normalizedBase, "index.tsx"),
    path.posix.join(normalizedBase, "index.js"),
  ];

  for (const candidate of candidates) {
    if (trackedFiles.has(candidate)) {
      return candidate;
    }
  }

  return null;
}

// Builds a shallow import neighborhood around the top seed files, including
// both direct imports and reverse-importers.
function collectImportNeighbors(seedFiles: string[], trackedFiles: Set<string>) {
  const neighbors = new Map<string, string[]>();
  const reverseIndex = new Map<string, Set<string>>();

  for (const file of trackedFiles) {
    if (!/\.(ts|tsx|js|mjs|cjs)$/.test(file)) {
      continue;
    }

    const absolutePath = path.join(repoRoot, file);

    if (!fs.existsSync(absolutePath)) {
      continue;
    }

    const content = fs.readFileSync(absolutePath, "utf8");
    const matches = content.matchAll(/(?:import|export)\s+(?:[^"'`]+?\s+from\s+)?["'`]([^"'`]+)["'`]|require\(["'`]([^"'`]+)["'`]\)/g);

    for (const match of matches) {
      const importPath = match[1] ?? match[2];

      if (!importPath) {
        continue;
      }

      const resolved = tryResolveImportPath(file, importPath, trackedFiles);

      if (!resolved) {
        continue;
      }

      const importers = reverseIndex.get(resolved) ?? new Set<string>();
      importers.add(file);
      reverseIndex.set(resolved, importers);
    }
  }

  for (const seedFile of seedFiles) {
    const result = new Set<string>();
    const absolutePath = path.join(repoRoot, seedFile);

    if (fs.existsSync(absolutePath) && /\.(ts|tsx|js|mjs|cjs)$/.test(seedFile)) {
      const content = fs.readFileSync(absolutePath, "utf8");
      const matches = content.matchAll(/(?:import|export)\s+(?:[^"'`]+?\s+from\s+)?["'`]([^"'`]+)["'`]|require\(["'`]([^"'`]+)["'`]\)/g);

      for (const match of matches) {
        const importPath = match[1] ?? match[2];

        if (!importPath) {
          continue;
        }

        const resolved = tryResolveImportPath(seedFile, importPath, trackedFiles);

        if (resolved) {
          result.add(resolved);
        }
      }
    }

    for (const importer of reverseIndex.get(seedFile) ?? []) {
      result.add(importer);
    }

    neighbors.set(seedFile, Array.from(result).slice(0, CONTEXT_IMPORT_NEIGHBOR_LIMIT));
  }

  return neighbors;
}

function renderSnippet(file: string, absolutePath: string, matchedLines: number[]) {
  const lines = readFileLines(absolutePath);

  if (matchedLines.length === 0) {
    return lines
      .slice(0, CONTEXT_SNIPPET_LINES)
      .map((line, index) => `${index + 1}: ${line}`)
      .join("\n");
  }

  const windows: Array<[number, number]> = [];
  const radius = Math.max(2, Math.floor(CONTEXT_SNIPPET_LINES / 2));

  for (const matchedLine of matchedLines) {
    const start = Math.max(1, matchedLine - radius);
    const end = Math.min(lines.length, matchedLine + radius);
    const previous = windows[windows.length - 1];

    if (previous && start <= previous[1] + 2) {
      previous[1] = Math.max(previous[1], end);
    } else {
      windows.push([start, end]);
    }
  }

  return windows
    .slice(0, 3)
    .map(([start, end]) => lines
      .slice(start - 1, end)
      .map((line, index) => `${start + index}: ${line}`)
      .join("\n"))
    .join("\n...\n");
}

// Produces the initial low-token retrieval plan: top docs, top code files,
// content matches, and shallow graph neighbors for further exploration.
function buildRetrievalPlan(ticket: Ticket): RetrievalPlan {
  const files = execSync("git ls-files", { cwd: repoRoot })
    .toString()
    .split("\n")
    .filter(Boolean)
    .filter((file) => !file.startsWith("autodev/.state/") && !file.startsWith("autodev/.runs/") && !file.startsWith("autodev/.worktrees/"));
  const trackedFiles = new Set(files);

  const keywords = buildKeywords(ticket);
  const contentMatches = runContentSearch(keywords);
  const scored = files
    .map((file) => ({
      file,
      score: scoreFile(file, keywords, contentMatches),
      hasContentMatches: contentMatches.has(file),
      isCore: CORE_CONTEXT_FILES.includes(file),
      isDoc: file.startsWith("docs/"),
    }))
    .filter((entry) => entry.score > 0 || entry.isCore || entry.hasContentMatches);

  const coreDocs = scored
    .filter((entry) => entry.isCore)
    .sort((a, b) => b.score - a.score)
    .slice(0, CONTEXT_DOC_LIMIT)
    .map((entry) => entry.file);

  const primaryFiles = unique([
    "AGENTS.md",
    ...coreDocs,
    ...scored
      .filter((entry) => !entry.isCore && !entry.isDoc)
      .sort((a, b) => b.score - a.score)
      .slice(0, CONTEXT_FILE_LIMIT)
    .map((entry) => entry.file),
  ]).slice(0, 1 + CONTEXT_DOC_LIMIT + CONTEXT_FILE_LIMIT);

  const importNeighbors = collectImportNeighbors(primaryFiles, trackedFiles);

  const graphCandidates = unique(primaryFiles.flatMap((file) => importNeighbors.get(file) ?? []));

  const secondaryFiles = scored
    .filter((entry) => !primaryFiles.includes(entry.file))
    .sort((a, b) => b.score - a.score)
    .slice(0, 15)
    .map((entry) => entry.file);

  return {
    keywords,
    primaryFiles,
    secondaryFiles: unique([...graphCandidates, ...secondaryFiles]).slice(0, 20),
    contentMatches,
    importNeighbors,
  };
}

export function selectRelevantFiles(ticket: Ticket) {
  return buildRetrievalPlan(ticket);
}

// Renders a bounded context block that favors matched snippets over full-file
// dumps, while still exposing candidate files the agent can inspect later.
export function loadContext(basePath: string, plan: RetrievalPlan) {
  const sections: string[] = [];

  sections.push(`KEYWORDS: ${plan.keywords.join(", ")}`);
  sections.push(`PRIMARY FILES: ${plan.primaryFiles.join(", ")}`);

  if (plan.secondaryFiles.length > 0) {
    sections.push(`ADDITIONAL CANDIDATES: ${plan.secondaryFiles.join(", ")}`);
  }

  const importGraphLines = plan.primaryFiles
    .map((file) => {
      const neighbors = plan.importNeighbors.get(file) ?? [];

      if (neighbors.length === 0) {
        return null;
      }

      return `${file} -> ${neighbors.join(", ")}`;
    })
    .filter((line): line is string => Boolean(line));

  if (importGraphLines.length > 0) {
    sections.push(`IMPORT GRAPH CANDIDATES:\n${importGraphLines.join("\n")}`);
  }

  let totalChars = sections.join("\n\n").length;

  for (const file of plan.primaryFiles) {
    const absolutePath = path.join(basePath, file);

    if (!fs.existsSync(absolutePath)) {
      continue;
    }

    const snippet = renderSnippet(file, absolutePath, plan.contentMatches.get(file) ?? []);
    const block = `FILE: ${file}\n${snippet}`;

    if (totalChars + block.length > CONTEXT_MAX_CHARS) {
      sections.push(`TRUNCATED: context budget reached before including ${file}`);
      break;
    }

    sections.push(block);
    totalChars += block.length;
  }

  return sections.join("\n\n");
}
