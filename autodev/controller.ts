import { shouldStopAfterCurrentTicket } from "./control.js";
import { closeQueue } from "./queue.js";
import { enqueueRunnableTickets, reconcileRuntimeState } from "./tickets.js";
import { logger } from "./utils/logger.js";

async function main() {
  logger.info("Autodev controller starting");

  if (shouldStopAfterCurrentTicket()) {
    logger.info("Autodev controller will not enqueue because stop-after-current-ticket is requested");
    return;
  }

  await reconcileRuntimeState();
  const enqueued = await enqueueRunnableTickets();

  if (enqueued.length === 0) {
    logger.info("Autodev controller found no runnable tickets");
    return;
  }

  logger.info("Autodev controller enqueued runnable tickets", {
    ticketIds: enqueued,
    count: enqueued.length,
  });
}

main()
  .catch((error) => {
    logger.error("Autodev controller failed", { error });
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeQueue();
  });
