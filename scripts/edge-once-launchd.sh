#!/bin/zsh
set -euo pipefail

readonly project_dir="/Users/Sean/projects/clawSean/peeper"
readonly lock_dir="${TMPDIR:-/tmp}/com.clawsean.peeper-edge-auto-like.lock"

if ! mkdir "$lock_dir" 2>/dev/null; then
  exit 0
fi
trap 'rmdir "$lock_dir" 2>/dev/null || true' EXIT INT TERM

export PATH="/Users/Sean/.local/bin:/Users/Sean/.npm-global/bin:/opt/homebrew/bin:/usr/bin:/bin"
cd "$project_dir"

while true; do
  if ! /Users/Sean/.local/bin/npm run edge:once; then
    print -u2 -- "$(date -u +%Y-%m-%dT%H:%M:%SZ) edge:once failed; retrying in 120 seconds"
  fi
  sleep 120
done
