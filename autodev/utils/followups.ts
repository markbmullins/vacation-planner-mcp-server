import fs from "node:fs";
import path from "node:path";
import { repoRoot } from "../runtime.js";
import type { ReviewResult, Ticket } from "../types.js";

const backlogPath = path.join(repoRoot, "docs", "delivery-backlog.md");
const followupSectionHeader = "## Deferred Autodev Follow-ups";

function sanitizeSlug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function nextFollowupId(content: string, ticketId: string) {
  const prefix = `FUP-${ticketId}-`;
  const matches = Array.from(content.matchAll(new RegExp(`${prefix}(\\d+)`, "g")));
  const nextNumber = matches.reduce((max, match) => Math.max(max, Number(match[1])), 0) + 1;
  return `${prefix}${String(nextNumber).padStart(2, "0")}`;
}

function ensureSection(content: string) {
  if (content.includes(followupSectionHeader)) {
    return content;
  }

  return `${content.trimEnd()}\n\n${followupSectionHeader}\n\n`;
}

export function appendDeferredFollowup(ticket: Ticket, review: ReviewResult) {
  const current = fs.readFileSync(backlogPath, "utf8");
  const withSection = ensureSection(current);
  const followupId = nextFollowupId(withSection, ticket.id);
  const slug = sanitizeSlug(ticket.title);
  const body = [
    `- **${followupId} Deferred follow-up for ${ticket.id} ${ticket.title}**`,
    `  - Objective: Address deferred review findings discovered while implementing \`${ticket.id}\`.`,
    `  - Key implementation notes: Keep scope limited to the issues below. Original ticket: \`${ticket.id}\`. Suggested slug: \`${slug}\`.`,
    "  - Deferred review findings:",
    ...review.issues.map((issue) => `    - ${issue}`),
    "  - Dependencies: Schedule after the original ticket's parent flow is complete.",
    "  - Acceptance criteria:",
    "    - Deferred review findings are addressed without expanding scope.",
    "    - Existing behavior from the original ticket remains intact.",
    "",
  ].join("\n");

  fs.writeFileSync(backlogPath, `${withSection.trimEnd()}\n\n${body}`, "utf8");
  return followupId;
}

export function hasDeferredFollowup(followupId: string) {
  const current = fs.readFileSync(backlogPath, "utf8");
  return current.includes(`**${followupId} `);
}
