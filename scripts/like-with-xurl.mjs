#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, appendFileSync } from "node:fs";
import { dirname } from "node:path";

const LIVE_ACK = "I_UNDERSTAND_THIS_LIKES_FROM_MY_X_ACCOUNT";

function loadDotEnv(path = ".env") {
  if (!existsSync(path)) return;
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;
    process.env[key] = rawValue.replace(/^["']|["']$/g, "");
  }
}

function config() {
  loadDotEnv();
  return {
    mode: env("PEEPER_MODE", "dry-run"),
    liveAck: process.env.PEEPER_LIVE_ACK || "",
    xurlBin: env("PEEPER_XURL_BIN", "xurl"),
    xurlWriteApp: process.env.PEEPER_XURL_WRITE_APP || "",
    xurlWriteAuth: env("PEEPER_XURL_WRITE_AUTH", "oauth2"),
    likerUserId: process.env.PEEPER_LIKER_USER_ID || "",
    expectedLikerUsername: process.env.PEEPER_EXPECTED_LIKER_USERNAME || "",
    eventsPath: env("PEEPER_EVENTS_PATH", "state/peeper-like-events.jsonl"),
  };
}

function env(name, fallback) {
  return process.env[name] && process.env[name].trim() ? process.env[name].trim() : fallback;
}

function doctor(cfg) {
  const checks = [];
  const version = spawnSync(cfg.xurlBin, ["version"], { encoding: "utf8" });
  checks.push({
    name: "xurl binary",
    ok: version.status === 0,
    detail: version.status === 0 ? version.stdout.trim() : version.stderr.trim(),
  });
  checks.push({
    name: "mode",
    ok: ["dry-run", "live"].includes(cfg.mode),
    detail: cfg.mode,
  });
  checks.push({
    name: "live acknowledgement",
    ok: cfg.mode !== "live" || cfg.liveAck === LIVE_ACK,
    detail: cfg.mode === "live" ? "required for live likes" : "not required in dry-run",
  });
  checks.push({
    name: "OAuth2 write target",
    ok: Boolean(cfg.xurlWriteApp && cfg.xurlWriteAuth && cfg.likerUserId),
    detail: `app=${cfg.xurlWriteApp || "(missing)"} auth=${cfg.xurlWriteAuth} userId=${cfg.likerUserId || "(missing)"}`,
  });

  const ok = checks.every((check) => check.ok);
  console.log(JSON.stringify({
    ok,
    mode: cfg.mode,
    expectedLikerUsername: cfg.expectedLikerUsername || null,
    note: "Doctor intentionally avoids X read endpoints; regular Peeper polling is no-credit.",
    checks,
  }, null, 2));
  process.exitCode = ok ? 0 : 1;
}

function likeTweet(cfg, tweetId) {
  if (!/^\d+$/.test(tweetId)) throw new Error("tweet ID must be numeric");
  if (!["dry-run", "live"].includes(cfg.mode)) {
    throw new Error("PEEPER_MODE must be dry-run or live");
  }

  if (cfg.mode === "dry-run") {
    const event = { at: new Date().toISOString(), type: "would_like", tweetId };
    recordEvent(cfg.eventsPath, event);
    console.log(JSON.stringify({ ok: true, dryRun: true, tweetId }, null, 2));
    return;
  }

  if (cfg.liveAck !== LIVE_ACK) {
    throw new Error("live mode requires PEEPER_LIVE_ACK=" + LIVE_ACK);
  }
  if (!cfg.likerUserId) {
    throw new Error("live mode requires PEEPER_LIKER_USER_ID");
  }

  const args = [];
  if (cfg.xurlWriteApp) args.push("--app", cfg.xurlWriteApp);
  args.push(
    "--auth",
    cfg.xurlWriteAuth,
    "-X",
    "POST",
    "/2/users/" + cfg.likerUserId + "/likes",
    "-H",
    "Content-Type: application/json",
    "-d",
    JSON.stringify({ tweet_id: tweetId }),
  );

  const result = spawnSync(cfg.xurlBin, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    throw new Error("xurl like failed: " + (result.stderr || result.stdout));
  }

  const parsed = parseJson(result.stdout);
  recordEvent(cfg.eventsPath, {
    at: new Date().toISOString(),
    type: "liked",
    tweetId,
    result: parsed,
  });
  console.log(JSON.stringify({ ok: true, dryRun: false, tweetId, result: parsed }, null, 2));
}

function recordEvent(path, event) {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(event)}\n`);
}

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch (_error) {
    return { raw: value.trim() };
  }
}

const cfg = config();
if (process.argv.includes("--doctor")) {
  doctor(cfg);
} else {
  const tweetId = process.argv.find((arg) => /^\d+$/.test(arg));
  if (!tweetId) {
    console.error("Usage: node scripts/like-with-xurl.mjs --doctor | <tweet-id>");
    process.exit(2);
  }
  likeTweet(cfg, tweetId);
}
