# RALPH

## Goal
- Prove a repeatable way to poll `@edgewallet` posts without spending X API or xAI credits.

## Done Means
- [x] Fetches recent `@edgewallet` posts without credentials or `api.twitter.com`.
- [x] Extracts tweet IDs, timestamps, text, and status URLs.
- [x] Smoke check proves the script can run from this host.

## Constraints
- No X API bearer/OAuth for polling.
- No xAI/Grok calls.
- No paid RSS bridge.
- Do not perform any public Like action during proof.

## Checks
- `node peeper.mjs --limit 5`

## Current Slice
- Build and verify Peeper as an unauthenticated syndication timeline watcher.

## Status
- Iteration: 3/6
- State: done
- Blocker: none
