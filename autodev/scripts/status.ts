import { closeQueue } from "../queue.js";
import { ticketQueue } from "../queue.js";
import { readRuntimeState, readTickets } from "../tickets.js";

async function main() {
  const tickets = readTickets();
  const runtime = readRuntimeState();

  const rows = await Promise.all(tickets.map(async (ticket) => {
    const runtimeTicket = runtime.tickets[ticket.id];
    const job = await ticketQueue.getJob(`ticket-${ticket.id}`);
    const queueState = job ? await job.getState() : "none";

    return {
      id: ticket.id,
      configured: ticket.status,
      runtime: runtimeTicket?.status ?? "todo",
      stage: runtimeTicket?.stage ?? "idle",
      attempt: runtimeTicket?.attempt ?? 0,
      queue: queueState,
      updatedAt: runtimeTicket?.updatedAt ?? "-",
      branch: runtimeTicket?.branch ?? "-",
      runDir: runtimeTicket?.runDir ?? "-",
      error: runtimeTicket?.lastError ? runtimeTicket.lastError.slice(0, 140) : "-",
    };
  }));

  const active = rows.filter((row) => row.runtime === "in_progress" || row.queue === "active" || row.queue === "waiting");

  console.log("Autodev Status\n");

  if (active.length > 0) {
    console.log("Active / queued:");
    for (const row of active) {
      console.log(`- ${row.id} | runtime=${row.runtime} | stage=${row.stage} | attempt=${row.attempt} | queue=${row.queue}`);
      console.log(`  updated=${row.updatedAt}`);
      if (row.runDir !== "-") console.log(`  runDir=${row.runDir}`);
      if (row.branch !== "-") console.log(`  branch=${row.branch}`);
      if (row.error !== "-") console.log(`  error=${row.error}`);
    }
    console.log("");
  }

  const blocked = rows.filter((row) => row.runtime === "blocked");
  if (blocked.length > 0) {
    console.log("Blocked:");
    for (const row of blocked) {
      console.log(`- ${row.id} | queue=${row.queue} | updated=${row.updatedAt}`);
      console.log(`  error=${row.error}`);
    }
    console.log("");
  }

  const done = rows.filter((row) => row.runtime === "done");
  if (done.length > 0) {
    console.log("Done:");
    for (const row of done) {
      console.log(`- ${row.id} | updated=${row.updatedAt}`);
    }
    console.log("");
  }

  const untouched = rows.filter((row) => row.runtime === "todo" && row.queue === "none");
  if (untouched.length > 0) {
    console.log("Todo:");
    for (const row of untouched.slice(0, 15)) {
      console.log(`- ${row.id}`);
    }
    if (untouched.length > 15) {
      console.log(`- ... and ${untouched.length - 15} more`);
    }
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
