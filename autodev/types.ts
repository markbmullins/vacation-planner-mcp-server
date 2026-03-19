export type TicketStatus = "todo" | "in_progress" | "done" | "blocked";

export interface Ticket {
  id: string;
  title: string;
  status: TicketStatus;
  dependencies: string[];
}

export interface RuntimeTicketState {
  status: TicketStatus;
  updatedAt: string;
  stage?: "queued" | "implementing" | "reviewing" | "testing" | "committing" | "cleanup" | "done" | "blocked";
  attempt?: number;
  reviewRounds?: number;
  testFixRounds?: number;
  runDir?: string;
  worktreePath?: string;
  baseSha?: string;
  branch?: string;
  commitSha?: string;
  lastError?: string;
  pendingReviewSummary?: string;
  pendingReviewIssues?: string[];
  pendingTestOutputPath?: string;
  deferredFollowupId?: string;
}

export interface RuntimeState {
  tickets: Record<string, RuntimeTicketState>;
}

export interface ReviewResult {
  status: "approved" | "changes_required";
  summary: string;
  issues: string[];
}
