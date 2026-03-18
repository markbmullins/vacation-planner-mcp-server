import { closeQueue } from "../queue.js";
import { ticketQueue } from "../queue.js";
import { readRuntimeState, writeRuntimeState } from "../tickets.js";
import { deleteTicketBranch, removeTicketWorktree } from "../utils/worktree.js";

async function main() {
  const ticketId = process.argv[2];

  if (!ticketId) {
    throw new Error("Usage: npm run reset-ticket -- <TICKET_ID>");
  }

  const jobId = `ticket-${ticketId}`;
  const job = await ticketQueue.getJob(jobId);

  if (job) {
    try {
      await job.remove();
      console.log(`Removed BullMQ job ${jobId}`);
    } catch (error) {
      console.log(`Could not remove BullMQ job ${jobId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  } else {
    console.log(`No BullMQ job found for ${jobId}`);
  }

  const runtime = readRuntimeState();
  const runtimeTicket = runtime.tickets[ticketId];

  if (runtimeTicket?.worktreePath) {
    try {
      removeTicketWorktree(runtimeTicket.worktreePath);
      console.log(`Removed worktree ${runtimeTicket.worktreePath}`);
    } catch (error) {
      console.log(`Could not remove worktree ${runtimeTicket.worktreePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (runtimeTicket?.branch) {
    try {
      deleteTicketBranch(runtimeTicket.branch);
      console.log(`Deleted branch ${runtimeTicket.branch}`);
    } catch (error) {
      console.log(`Could not delete branch ${runtimeTicket.branch}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (runtime.tickets[ticketId]) {
    delete runtime.tickets[ticketId];
    writeRuntimeState(runtime);
    console.log(`Cleared runtime state for ${ticketId}`);
  } else {
    console.log(`No runtime state found for ${ticketId}`);
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
