# Peeper

Tiny dependency-free watcher for public X posts. Defaults to `@edgewallet`.

Peeper's default source is FxTwitter's public profile statuses endpoint:

```text
https://api.fxtwitter.com/2/profile/edgewallet/statuses?count=20
```

That endpoint was verified current for Edge's June 2026 posts and does not use X API credentials or xAI/Grok credits.

Peeper also keeps the older X public embedded timeline source available as an explicit fallback:

```text
https://syndication.twitter.com/srv/timeline-profile/screen-name/edgewallet
```

That means polling uses:

- no X API bearer token
- no X OAuth login
- no xAI/Grok credits
- no paid RSS bridge

These endpoints are unofficial/undocumented, so treat Peeper like a lightweight practical bridge, not a permanent platform contract.

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

Use the older syndication source explicitly:

```bash
node peeper.mjs --source syndication --limit 5
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

The cache stores the last successful public timeline response. If the public source briefly returns `429` or another transient error, the watcher falls back to the cached timeline and tries again on the next interval.

## Auto-Like Hook

Polling is credential-free. Liking is a public account action and still needs your own authenticated X tool.

For example, point the hook at a Like command you control:

```bash
node peeper.mjs --watch --interval 61 --on-new 'node scripts/like-with-xurl.mjs {id}'
```

Available command tokens:

- `{id}` - tweet ID
- `{url}` - tweet URL
- `{handle}` - watched handle

The script only marks a new tweet as seen after the hook command succeeds. If the hook fails, it will retry on the next poll.

## Edge Auto-Like

The local Edge setup lives in this project. Cron is only the timer.

```bash
npm run edge:once
```

That command:

- polls `@EdgeWallet` through the no-credit FxTwitter source
- filters to posts authored by `EdgeWallet` by default, not reposted accounts or replies
- stores seen IDs in `state/edgewallet-seen.json`
- stores the last-good response in `state/edgewallet-cache.json`
- calls `scripts/like-with-xurl.mjs` only for genuinely new tweet IDs

`scripts/like-with-xurl.mjs` uses `xurl` only for the authenticated Like write. It does not read the timeline.

Run the local like config doctor:

```bash
npm run like:doctor
```

Example cron, if you want cron to call Peeper every two minutes:

```cron
*/2 * * * * cd /path/to/peeper && /usr/bin/npm run edge:once >> /path/to/peeper/logs/edgewallet-auto-like.log 2>&1
```

Live mode requires `.env` to contain:

```text
PEEPER_MODE=live
PEEPER_LIVE_ACK=I_UNDERSTAND_THIS_LIKES_FROM_MY_X_ACCOUNT
PEEPER_XURL_WRITE_APP=your-oauth2-app
PEEPER_LIKER_USER_ID=123456789
```

Tokens are not stored in this repo; they stay inside `xurl`.

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
