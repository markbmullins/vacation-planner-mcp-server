const parsePositiveInt = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 1) {
    return fallback;
  }

  return parsed;
};

const parsePositiveMs = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed < 1000) {
    return fallback;
  }

  return Math.floor(parsed);
};

export const PIPELINE = {
  queueName: "autodev-ticket-pipeline",
  workerConcurrency: parsePositiveInt(process.env.AUTODEV_WORKER_CONCURRENCY, 1),
  maxReviewRounds: parsePositiveInt(process.env.AUTODEV_MAX_REVIEW_ROUNDS, 3),
  maxTestFixRounds: parsePositiveInt(process.env.AUTODEV_MAX_TEST_FIX_ROUNDS, 2),
  maxAgentAttempts: parsePositiveInt(process.env.AUTODEV_MAX_AGENT_ATTEMPTS, 6),
  agentTimeoutMs: parsePositiveMs(process.env.AUTODEV_AGENT_TIMEOUT_MS, 20 * 60 * 1000),
  testTimeoutMs: parsePositiveMs(process.env.AUTODEV_TEST_TIMEOUT_MS, 15 * 60 * 1000),
  agentHeartbeatMs: parsePositiveMs(process.env.AUTODEV_AGENT_HEARTBEAT_MS, 30 * 1000),
  activeJobStaleMs: parsePositiveMs(process.env.AUTODEV_ACTIVE_JOB_STALE_MS, 2 * 60 * 1000),
  maxReviewDriftRounds: parsePositiveInt(process.env.AUTODEV_MAX_REVIEW_DRIFT_ROUNDS, 2),
};

if (PIPELINE.workerConcurrency !== 1) {
  throw new Error(
    `AUTODEV_WORKER_CONCURRENCY=${String(PIPELINE.workerConcurrency)} is unsupported; set it to 1 for serialized integration-branch processing`,
  );
}
