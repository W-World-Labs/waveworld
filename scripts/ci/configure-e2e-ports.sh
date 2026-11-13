#!/usr/bin/env bash
set -euo pipefail

: "${GITHUB_RUN_ID:?GITHUB_RUN_ID is required}"
: "${GITHUB_ENV:?GITHUB_ENV is required}"

if [[ ! "$GITHUB_RUN_ID" =~ ^[0-9]+$ ]]; then
  echo "GITHUB_RUN_ID must be numeric" >&2
  exit 2
fi

# Gitea runs Actions containers with host networking. Derive two ports from the
# unique run id so push + pull_request jobs for the same commit cannot collide.
run_slot=$((GITHUB_RUN_ID % 10000))

# A derived port can still be held by a leaked dev server or an unrelated
# process on the shared host network — probe LISTEN and walk forward a few
# candidates rather than failing at the E2E webServer bind (run 1246 flake).
port_in_use() {
  local p="$1"
  if command -v ss >/dev/null 2>&1; then
    ss -ltn "sport = :$p" | tail -n +2 | grep -q .
  else
    (exec 3<>"/dev/tcp/127.0.0.1/$p") 2>/dev/null && { exec 3>&- 3<&-; return 0; } || return 1
  fi
}

pick_free_port() {
  local base="$1" p off
  for off in 0 1 2 3 4 5 6 7 8 9; do
    p=$((base + off))
    if ! port_in_use "$p"; then
      printf '%s\n' "$p"
      return 0
    fi
  done
  echo "no free E2E port in $base..$((base + 9))" >&2
  return 1
}

preview_port=$(pick_free_port $((20000 + run_slot)))
lab_port=$(pick_free_port $((40000 + run_slot)))

printf '%s\n' \
  "E2E_PORT=$preview_port" \
  "E2E_LAB_PORT=$lab_port" \
  "VITE_LAB_URL=http://127.0.0.1:$lab_port" \
  >> "$GITHUB_ENV"

printf 'job-scoped E2E ports: preview=%s lab=%s\n' "$preview_port" "$lab_port"
