#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

const DEFAULT_INTERVAL_SECONDS = 121;
const MAX_SLEEP_MS = 65_000;

const intervalSeconds = positiveNumber(
  process.env.PEEPER_EDGE_INTERVAL_SECONDS,
  DEFAULT_INTERVAL_SECONDS,
);
const intervalMs = intervalSeconds * 1000;
const statePath = process.env.PEEPER_EDGE_SCHEDULE_STATE || "state/edgewallet-schedule.json";
const lockPath = process.env.PEEPER_EDGE_SCHEDULE_LOCK || "state/edgewallet-schedule.lock";

async function main() {
  const lock = acquireLock(lockPath);
  if (!lock) return;

  try {
    const state = loadJson(statePath);
    const nowMs = Date.now();
    const dueAtMs = Number.isFinite(Date.parse(state.nextRunAt))
      ? Date.parse(state.nextRunAt)
      : nowMs;
    const waitMs = dueAtMs - nowMs;

    if (waitMs > MAX_SLEEP_MS) return;
    if (waitMs > 0) await sleep(waitMs);

    const startedAt = new Date();
    const nextRunAt = new Date(startedAt.getTime() + intervalMs);
    writeScheduleState({
      ...state,
      intervalSeconds,
      lastRunStartedAt: startedAt.toISOString(),
      nextRunAt: nextRunAt.toISOString(),
    });

    console.log(
      `${startedAt.toISOString()} scheduler firing; interval=${intervalSeconds}s next=${nextRunAt.toISOString()}`,
    );

    const result = spawnSync(
      process.execPath,
      [
        "peeper.mjs",
        "--source",
        "fx",
        "--handle",
        "EdgeWallet",
        "--once",
        "--state",
        "state/edgewallet-seen.json",
        "--cache",
        "state/edgewallet-cache.json",
        "--on-new",
        "node scripts/like-with-xurl.mjs {id}",
      ],
      { encoding: "utf8", stdio: "inherit" },
    );

    const finishedAt = new Date();
    writeScheduleState({
      ...loadJson(statePath),
      intervalSeconds,
      lastRunStartedAt: startedAt.toISOString(),
      lastRunFinishedAt: finishedAt.toISOString(),
      lastRunExitCode: result.status ?? 1,
      nextRunAt: nextRunAt.toISOString(),
    });
    process.exitCode = result.status ?? 1;
  } finally {
    releaseLock(lock);
  }
}

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function acquireLock(path) {
  mkdirSync(dirname(path), { recursive: true });

  try {
    const fd = openSync(path, "wx");
    writeFileSync(fd, `${process.pid} ${new Date().toISOString()}\n`);
    return { fd, path };
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    if (isStaleLock(path)) {
      unlinkSync(path);
      return acquireLock(path);
    }
    return null;
  }
}

function isStaleLock(path) {
  try {
    const ageMs = Date.now() - statSync(path).mtimeMs;
    return ageMs > intervalMs + MAX_SLEEP_MS + 30_000;
  } catch (_error) {
    return true;
  }
}

function releaseLock(lock) {
  try {
    closeSync(lock.fd);
  } catch (_error) {
    // Nothing useful to do during cron cleanup.
  }
  try {
    unlinkSync(lock.path);
  } catch (_error) {
    // A stale-lock cleanup path may have already removed it.
  }
}

function loadJson(path) {
  if (!existsSync(path)) return {};
  const raw = readFileSync(path, "utf8").trim();
  return raw ? JSON.parse(raw) : {};
}

function writeScheduleState(state) {
  mkdirSync(dirname(statePath), { recursive: true });
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error(`edge scheduler failed: ${error.message}`);
  process.exitCode = 1;
});
