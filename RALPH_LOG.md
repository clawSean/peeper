# RALPH LOG

## Iteration 1 - 2026-06-05T23:23Z

### Slice
- Tested unauthenticated public timeline sources for `@edgewallet`.

### Verification
- Command/check: `curl -sS -D - -L https://syndication.twitter.com/srv/timeline-profile/screen-name/edgewallet`
- Result: pass
- Evidence: HTTP 200 from `syndication.twitter.com`, HTML contained `__NEXT_DATA__` with 100 timeline entries.

### Learnings
- The public syndication timeline endpoint exposes embedded timeline data without X API credentials or xAI.
- Public Nitter RSS was empty from `nitter.net`; `publish.x.com/oembed` only returns embed metadata, not posts.

### Next
- Wrap the syndication parse in a repeatable smoke script.

## Iteration 2 - 2026-06-05T23:26Z

### Slice
- Added `poll-edgewallet.mjs` to fetch the syndication timeline and parse tweet IDs, timestamps, text, and URLs.

### Verification
- Command/check: `node poll-edgewallet.mjs --limit 5`
- Result: pass
- Evidence: Returned 100 parsed tweets, showing latest five from `@edgewallet`.

- Command/check: `node poll-edgewallet.mjs --limit 1 --json | node -e '<assert source/auth flags and tweet id>'`
- Result: pass
- Evidence: `PASS no-auth syndication poll 1983949604896043057 Thu Oct 30 17:30:20 +0000 2025`

### Learnings
- Node built-in `fetch` hit HTTP 429 on this endpoint, while `curl` succeeded from the same host. The proof script uses `curl` transport.
- The endpoint advertises `cache-control: must-revalidate, max-age=60` and rate-limit headers; production polling should cache and poll no more than once per minute, preferably every 5-15 minutes.

### Next
- DONE for proof. Next implementation slice would be dedupe state + authenticated Like action.
