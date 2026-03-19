import fs from "node:fs";
import path from "node:path";
import { resolveAutodevPath } from "./runtime.js";

interface ControlState {
  stopAfterCurrentTicket: boolean;
  updatedAt: string;
}

const stateDir = resolveAutodevPath(".state");
const controlPath = path.join(stateDir, "control.json");

function ensureStateDir() {
  fs.mkdirSync(stateDir, { recursive: true });
}

function writeControlState(state: ControlState) {
  ensureStateDir();
  fs.writeFileSync(controlPath, JSON.stringify(state, null, 2) + "\n", "utf8");
}

export function readControlState(): ControlState {
  ensureStateDir();

  if (!fs.existsSync(controlPath)) {
    return {
      stopAfterCurrentTicket: false,
      updatedAt: new Date().toISOString(),
    };
  }

  return JSON.parse(fs.readFileSync(controlPath, "utf8")) as ControlState;
}

export function shouldStopAfterCurrentTicket() {
  return readControlState().stopAfterCurrentTicket;
}

export function requestStopAfterCurrentTicket() {
  writeControlState({
    stopAfterCurrentTicket: true,
    updatedAt: new Date().toISOString(),
  });
}

export function clearStopAfterCurrentTicket() {
  writeControlState({
    stopAfterCurrentTicket: false,
    updatedAt: new Date().toISOString(),
  });
}
