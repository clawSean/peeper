# Peeper

Tiny dependency-free watcher for public X posts. Defaults to `@edgewallet`.

Peeper keeps an eye on X's public embedded timeline endpoint, not the paid X API:

```text
https://syndication.twitter.com/srv/timeline-profile/screen-name/edgewallet
```

That means polling uses:

- no X API bearer token
- no X OAuth login
- no xAI/Grok credits
- no paid RSS bridge

The endpoint is undocumented, so treat it like a lightweight practical bridge, not a permanent platform contract.

## Requirements

- Node.js 18+
- `curl`

No npm install is needed.

## One-Time Check

```bash
node peeper.mjs --limit 5
```

JSON output:

```bash
node peeper.mjs --limit 5 --json
```

## Watch Every 61 Seconds

```bash
node peeper.mjs --watch --interval 61
```

The first watch run seeds the local state file and does not emit old tweets. After that, only newly observed tweets are printed.

Default state/cache files:

```text
.edgewallet-seen.json
.edgewallet-cache.json
```

The cache stores the last successful public timeline response. If the syndication endpoint briefly returns `429`, the watcher falls back to the cached timeline and tries again on the next interval.

## Auto-Like Hook

Polling is credential-free. Liking is a public account action and still needs your own authenticated X tool.

With `xurl` configured:

```bash
node peeper.mjs --watch --interval 61 --on-new 'xurl like {id}'
```

Available command tokens:

- `{id}` - tweet ID
- `{url}` - tweet URL
- `{handle}` - watched handle

The script only marks a new tweet as seen after the hook command succeeds. If the hook fails, it will retry on the next poll.

## Watch A Different Account

```bash
node peeper.mjs --handle somehandle --watch --interval 61
```

The default state file changes with the handle, for example:

```text
.somehandle-seen.json
```

## Smoke Test

```bash
npm run smoke
```

The smoke command tries one public timeline fetch and verifies that the response did not use auth, X API, or xAI. If the endpoint rate-limits during the check, it falls back to a tiny committed last-good cache fixture and prints `PASS cache`.

## Operational Notes

- Keep the interval at 61 seconds or slower. The endpoint advertises short cache/rate-limit windows and does not need aggressive polling.
- This is for discovering tweet IDs. Any Like, repost, reply, or bookmark action should be explicit and authenticated separately.
- If the endpoint changes or keeps returning `429`, back off and retry later rather than increasing frequency.
