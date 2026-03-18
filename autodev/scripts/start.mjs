import net from "node:net";
import { execFileSync, spawnSync } from "node:child_process";

const host = process.env.AUTODEV_REDIS_HOST ?? "127.0.0.1";
const portValue = Number(process.env.AUTODEV_REDIS_PORT ?? "6379");
const port = Number.isNaN(portValue) ? 6379 : portValue;
const isLocalRedis = host === "127.0.0.1" || host === "localhost" || host === "::1";
const opencodeUrl = new URL(process.env.AUTODEV_OPENCODE_URL ?? "http://localhost:4096");
const opencodeHost = opencodeUrl.hostname;
const opencodePort = Number(opencodeUrl.port || (opencodeUrl.protocol === "https:" ? "443" : "80"));

function canConnect() {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });

    const finish = (result) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(1000);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

function runCommand(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  return result.status === 0;
}

function canConnectTo(targetHost, targetPort) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: targetHost, port: targetPort });

    const finish = (result) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(1000);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

function ensureRedisInstalledOnMac() {
  if (process.platform !== "darwin") {
    throw new Error(`Redis is not reachable at ${host}:${port}. Start it manually on this platform.`);
  }

  if (!isLocalRedis) {
    throw new Error(`Redis is configured for ${host}:${port}. Auto-start only supports local Redis on macOS.`);
  }

  const startedWithBrew = runCommand("brew", ["services", "start", "redis"])
    || runCommand("brew", ["services", "start", "redis-stack"]);

  if (startedWithBrew) {
    return;
  }

  const startedDirectly = runCommand("redis-server", ["--daemonize", "yes"]);

  if (!startedDirectly) {
    throw new Error("Unable to auto-start Redis. Install Redis with Homebrew or start it manually.");
  }
}

async function ensureRedis() {
  if (await canConnect()) {
    console.log(JSON.stringify({ ts: new Date().toISOString(), level: "info", msg: "Redis already running", host, port }));
    return;
  }

  console.log(JSON.stringify({ ts: new Date().toISOString(), level: "warn", msg: "Redis not reachable; attempting startup", host, port }));
  ensureRedisInstalledOnMac();

  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (await canConnect()) {
      console.log(JSON.stringify({ ts: new Date().toISOString(), level: "info", msg: "Redis is ready", host, port }));
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`Redis still unavailable at ${host}:${port} after auto-start.`);
}

async function ensureOpenCodeServer() {
  if (await canConnectTo(opencodeHost, opencodePort)) {
    console.log(JSON.stringify({ ts: new Date().toISOString(), level: "info", msg: "OpenCode server already running", host: opencodeHost, port: opencodePort }));
    return;
  }

  console.log(JSON.stringify({ ts: new Date().toISOString(), level: "info", msg: "Starting PM2 OpenCode server", host: opencodeHost, port: opencodePort }));
  execFileSync("pm2", ["start", "ecosystem.config.cjs", "--only", "autodev-opencode"], { stdio: "inherit" });

  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (await canConnectTo(opencodeHost, opencodePort)) {
      console.log(JSON.stringify({ ts: new Date().toISOString(), level: "info", msg: "OpenCode server is ready", host: opencodeHost, port: opencodePort }));
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`OpenCode server still unavailable at ${opencodeUrl.toString()} after startup.`);
}

async function main() {
  await ensureRedis();
  await ensureOpenCodeServer();
  console.log(JSON.stringify({ ts: new Date().toISOString(), level: "info", msg: "Starting PM2 autodev processes" }));
  execFileSync("pm2", ["start", "ecosystem.config.cjs", "--only", "autodev-workers,autodev-controller"], { stdio: "inherit" });
}

main().catch((error) => {
  console.error(JSON.stringify({ ts: new Date().toISOString(), level: "error", msg: "Autodev start failed", error: error instanceof Error ? error.message : String(error) }));
  process.exit(1);
});
