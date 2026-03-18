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
  branch?: string;
  commitSha?: string;
  lastError?: string;
}

export interface RuntimeState {
  tickets: Record<string, RuntimeTicketState>;
}

export interface ReviewResult {
  status: "approved" | "changes_required";
  summary: string;
  issues: string[];
}
