# Autodev PM2 Commands

## Start

Start both processes from the repository root:

```bash
npm run autodev:start
```

Start directly with PM2 from `autodev/`:

```bash
pm2 start ecosystem.config.cjs
```

Start only the controller from `autodev/`:

```bash
pm2 start ecosystem.config.cjs --only autodev-controller
```

Start only the workers from `autodev/`:

```bash
pm2 start ecosystem.config.cjs --only autodev-workers
```

## Restart

Restart the controller:

```bash
pm2 restart autodev-controller
```

Restart the workers:

```bash
pm2 restart autodev-workers
```

Restart both:

```bash
pm2 restart autodev-controller autodev-workers
```

## Stop

Request a graceful stop after the current active ticket finishes:

```bash
npm run stop-after-current
```

Clear the graceful stop flag so autodev can continue scheduling work:

```bash
npm run resume
```

Stop both processes from the repository root:

```bash
npm run autodev:stop
```

Stop with PM2 directly:

```bash
pm2 delete autodev-controller autodev-workers
```

Stop just one process:

```bash
pm2 delete autodev-controller
pm2 delete autodev-workers
```

## Status

Show a human-readable autodev summary:

```bash
npm run status
```

List PM2 processes:

```bash
pm2 list
```

Show details for the controller:

```bash
pm2 show autodev-controller
```

Show details for the workers:

```bash
pm2 show autodev-workers
```

## Logs

Tail all PM2 logs:

```bash
pm2 logs
```

Tail controller logs:

```bash
pm2 logs autodev-controller
```

Tail worker logs:

```bash
pm2 logs autodev-workers
```

Tail with a larger history window:

```bash
pm2 logs autodev-controller --lines 100
pm2 logs autodev-workers --lines 100
```

## Recovery

Reset one stuck ticket so it can be retried cleanly:

```bash
npm run reset-ticket -- E1-T1
```

Recommended recovery flow:

```bash
npm run status
npm run reset-ticket -- E1-T1
pm2 restart autodev-controller
```

## PM2 Maintenance

If PM2 says the in-memory daemon is out of date:

```bash
pm2 update
```

Save the current PM2 process list:

```bash
pm2 save
```

## Notes

- Run PM2 commands from `autodev/` when using `ecosystem.config.cjs` directly.
- The controller is one-shot and may stop after enqueueing runnable tickets; that is expected.
- `npm run status` is the authoritative reconciled view across PM2, BullMQ, runtime state, worktrees, and run artifacts.
- `npm run stop-after-current` tells autodev to finish the current ticket, then pause without starting another one.
- `npm run resume` clears that pause flag; restart workers/controller afterward if you want processing to continue.
- Each in-progress ticket now shows its current stage, attempt number, branch, and run directory in runtime state.
- Use `pm2 logs autodev-controller` to confirm enqueue activity and failures.
- Use `pm2 logs autodev-workers` to watch ticket execution, review/test flow, and estimated AI token usage.
