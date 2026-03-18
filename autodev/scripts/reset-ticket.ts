import { ticketQueue } from "../queue.js";
import { readRuntimeState, writeRuntimeState } from "../tickets.js";

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

  if (runtime.tickets[ticketId]) {
    delete runtime.tickets[ticketId];
    writeRuntimeState(runtime);
    console.log(`Cleared runtime state for ${ticketId}`);
  } else {
    console.log(`No runtime state found for ${ticketId}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
