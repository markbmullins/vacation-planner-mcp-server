import { Queue } from "bullmq";
import { PIPELINE } from "./pipeline.js";

const redisPort = Number(process.env.AUTODEV_REDIS_PORT ?? "6379");

export const connection = {
  host: process.env.AUTODEV_REDIS_HOST ?? "127.0.0.1",
  port: Number.isNaN(redisPort) ? 6379 : redisPort,
  username: process.env.AUTODEV_REDIS_USERNAME || undefined,
  password: process.env.AUTODEV_REDIS_PASSWORD || undefined,
  db: process.env.AUTODEV_REDIS_DB ? Number(process.env.AUTODEV_REDIS_DB) : undefined,
};

export const ticketQueue = new Queue(PIPELINE.queueName, {
  connection,
  defaultJobOptions: {
    removeOnComplete: true,
    removeOnFail: false,
  },
});

export async function closeQueue() {
  await ticketQueue.close();
}
