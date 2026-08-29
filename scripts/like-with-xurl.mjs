#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, appendFileSync, writeFileSync } from "node:fs";
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
    pendingPath: env("PEEPER_PENDING_PATH", "state/peeper-pending-likes.json"),
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
    detail: version.status === 0
      ? (version.stdout || "").trim()
      : (version.stderr || version.error?.message || "xurl unavailable").trim(),
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
    ok: Boolean(cfg.xurlWriteApp && cfg.xurlWriteAuth === "oauth2" && cfg.likerUserId),
    detail: `app=${cfg.xurlWriteApp || "(missing)"} auth=${cfg.xurlWriteAuth} userId=${cfg.likerUserId || "(missing)"}`,
  });

  if (version.status === 0 && cfg.mode === "live" && cfg.xurlWriteApp) {
    const authStatus = spawnSync(cfg.xurlBin, ["auth", "status"], { encoding: "utf8" });
    const oauth2User = authStatus.status === 0
      ? oauth2UserForApp(authStatus.stdout || "", cfg.xurlWriteApp)
      : null;
    checks.push({
      name: "OAuth2 user",
      ok: authStatus.status === 0
        && Boolean(oauth2User)
        && (!cfg.expectedLikerUsername || oauth2User === cfg.expectedLikerUsername),
      detail: authStatus.status !== 0
        ? (authStatus.stderr || authStatus.error?.message || "xurl auth status failed").trim()
        : `app=${cfg.xurlWriteApp} user=${oauth2User || "(missing)"}`,
    });
  }

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

function oauth2UserForApp(rawStatus, appName) {
  const cleanStatus = rawStatus.replace(/\x1b\[[0-9;]*m/g, "");
  let currentApp = null;
  for (const line of cleanStatus.split(/\r?\n/)) {
    const heading = line.match(/^\s*(?:▸\s*)?([A-Za-z0-9._-]+)\s+\[/);
    if (heading) {
      currentApp = heading[1];
      continue;
    }
    const oauth2 = line.match(/oauth2:\s*([A-Za-z0-9._-]+)/);
    if (currentApp === appName && oauth2 && oauth2[1] !== "none") {
      return oauth2[1];
    }
  }
  return null;
}

function likeTweet(cfg, tweetId) {
  if (!/^\d+$/.test(tweetId)) throw new Error("tweet ID must be numeric");
  if (!["dry-run", "live"].includes(cfg.mode)) {
    throw new Error("PEEPER_MODE must be dry-run or live");
  }

  if (cfg.mode === "dry-run") {
    const event = { at: new Date().toISOString(), type: "would_like", tweetId };
    recordEvent(cfg.eventsPath, event);
    removePending(cfg.pendingPath, tweetId);
    return { ok: true, dryRun: true, tweetId };
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
    const failure = classifyXurlFailure(result.stderr || result.stdout);
    const event = {
      at: new Date().toISOString(),
      type: failure.pending ? "pending" : "failed",
      tweetId,
      status: result.status,
      title: failure.title,
      detail: failure.detail,
      resetDate: failure.resetDate,
      nextAttemptAt: failure.nextAttemptAt,
      raw: failure.raw,
    };
    recordEvent(cfg.eventsPath, event);

    if (failure.pending) {
      upsertPending(cfg.pendingPath, {
        tweetId,
        title: failure.title,
        detail: failure.detail,
        resetDate: failure.resetDate,
        nextAttemptAt: failure.nextAttemptAt,
      });
      return {
        ok: false,
        pending: true,
        tweetId,
        title: failure.title,
        resetDate: failure.resetDate,
        nextAttemptAt: failure.nextAttemptAt,
        detail: failure.detail,
      };
    }

    upsertPending(cfg.pendingPath, {
      tweetId,
      title: failure.title,
      detail: failure.detail,
      resetDate: failure.resetDate,
      nextAttemptAt: retryAfterHours(1),
    });

    throw new Error("xurl like failed: " + failure.raw);
  }

  const parsed = parseJson(result.stdout);
  removePending(cfg.pendingPath, tweetId);
  recordEvent(cfg.eventsPath, {
    at: new Date().toISOString(),
    type: "liked",
    tweetId,
    result: parsed,
  });
  return { ok: true, dryRun: false, tweetId, result: parsed };
}

function classifyXurlFailure(rawValue) {
  const raw = String(rawValue || "").trim();
  const parsed = parseFirstJsonObject(raw);
  const title = parsed?.title || "";
  const detail = parsed?.detail || raw;
  const type = parsed?.type || "";
  const resetDate = parsed?.reset_date || null;
  const spendCapReached = title === "SpendCapReached"
    || type.includes("/credits")
    || /spend cap/i.test(detail);

  if (!spendCapReached) {
    return {
      pending: false,
      title: title || "XurlFailure",
      detail,
      resetDate,
      nextAttemptAt: null,
      raw,
    };
  }

  return {
    pending: true,
    title: title || "SpendCapReached",
    detail,
    resetDate,
    nextAttemptAt: spendCapRetryAt(resetDate),
    raw,
  };
}

function retryPending(cfg) {
  const state = loadPending(cfg.pendingPath);
  const now = new Date();
  const due = state.pending.filter((item) => {
    if (!item.nextAttemptAt) return true;
    return new Date(item.nextAttemptAt).getTime() <= now.getTime();
  });

  const results = [];
  for (const item of due) {
    try {
      results.push(likeTweet(cfg, item.tweetId));
    } catch (error) {
      results.push({ ok: false, pending: true, tweetId: item.tweetId, error: error.message });
      upsertPending(cfg.pendingPath, {
        tweetId: item.tweetId,
        title: "RetryFailed",
        detail: error.message,
        resetDate: null,
        nextAttemptAt: retryAfterHours(1),
      });
    }
  }

  const remaining = loadPending(cfg.pendingPath).pending;
  return {
    ok: true,
    checkedAt: now.toISOString(),
    attempted: due.length,
    pending: remaining.length,
    nextAttemptAt: remaining
      .map((item) => item.nextAttemptAt)
      .filter(Boolean)
      .sort()[0] || null,
    results,
  };
}

function recordEvent(path, event) {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(event)}\n`);
}

function loadPending(path) {
  if (!existsSync(path)) return { pending: [] };
  const raw = readFileSync(path, "utf8").trim();
  if (!raw) return { pending: [] };
  const parsed = JSON.parse(raw);
  if (Array.isArray(parsed)) return { pending: parsed };
  return { pending: parsed.pending || [] };
}

function savePending(path, pending) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({
    updatedAt: new Date().toISOString(),
    pending,
  }, null, 2)}\n`);
}

function upsertPending(path, item) {
  const state = loadPending(path);
  const now = new Date().toISOString();
  const existing = state.pending.find((entry) => entry.tweetId === item.tweetId);
  if (existing) {
    existing.lastAttemptAt = now;
    existing.attempts = Number(existing.attempts || 0) + 1;
    existing.title = item.title;
    existing.detail = item.detail;
    existing.resetDate = item.resetDate;
    existing.nextAttemptAt = item.nextAttemptAt;
  } else {
    state.pending.push({
      tweetId: item.tweetId,
      firstSeenAt: now,
      lastAttemptAt: now,
      attempts: 1,
      title: item.title,
      detail: item.detail,
      resetDate: item.resetDate,
      nextAttemptAt: item.nextAttemptAt,
    });
  }
  savePending(path, state.pending);
}

function removePending(path, tweetId) {
  if (!existsSync(path)) return;
  const state = loadPending(path);
  const next = state.pending.filter((item) => item.tweetId !== tweetId);
  if (next.length !== state.pending.length) savePending(path, next);
}

function parseFirstJsonObject(value) {
  const start = value.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < value.length; i += 1) {
    const char = value[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === "\"") inString = false;
      continue;
    }
    if (char === "\"") inString = true;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return parseJson(value.slice(start, i + 1));
    }
  }
  return null;
}

function retryAfterHours(hours) {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

function spendCapRetryAt(resetDate) {
  if (!resetDate) return retryAfterHours(6);
  const resetAt = new Date(`${resetDate}T00:05:00.000Z`);
  if (Number.isNaN(resetAt.getTime())) return retryAfterHours(6);
  if (resetAt.getTime() > Date.now() + 60 * 1000) return resetAt.toISOString();
  return retryAfterHours(1);
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
} else if (process.argv.includes("--retry-pending")) {
  console.log(JSON.stringify(retryPending(cfg), null, 2));
} else {
  const tweetId = process.argv.find((arg) => /^\d+$/.test(arg));
  if (!tweetId) {
    console.error("Usage: node scripts/like-with-xurl.mjs --doctor | --retry-pending | <tweet-id>");
    process.exit(2);
  }
  console.log(JSON.stringify(likeTweet(cfg, tweetId), null, 2));
}
