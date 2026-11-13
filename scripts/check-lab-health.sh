#!/usr/bin/env bash
# Probe tuanliu Lab liveness under basePath.
# Exits 0 only on HTTP 200 with a JSON body that looks healthy.
#
# Usage:
#   ./scripts/check-lab-health.sh
#   LAB_BASE=https://waveworld.example.invalid/app/lab ./scripts/check-lab-health.sh
#   LAB_BASE=http://127.0.0.1:3000/app/lab ./scripts/check-lab-health.sh
#
# LAB_BASE is the public Lab root (no trailing slash required), e.g. …/app/lab.
# Health path is always ${LAB_BASE}/api/health.
#
set -euo pipefail

LAB_BASE="${LAB_BASE:-http://127.0.0.1:3000/app/lab}"
LAB_BASE="${LAB_BASE%/}"
URL="${LAB_BASE}/api/health"
TIMEOUT="${LAB_HEALTH_TIMEOUT:-10}"

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

code="$(
  curl -sS -o "$tmp" -w '%{http_code}' --max-time "$TIMEOUT" "$URL" || true
)"

if [[ "$code" != "200" ]]; then
  echo "FAIL: $URL → HTTP ${code:-curl-error}" >&2
  if [[ -s "$tmp" ]]; then
    head -c 400 "$tmp" >&2
    echo >&2
  fi
  exit 1
fi

if ! grep -q '"ok"[[:space:]]*:[[:space:]]*true' "$tmp" 2>/dev/null; then
  echo "FAIL: $URL → 200 but body missing ok:true" >&2
  head -c 400 "$tmp" >&2
  echo >&2
  exit 1
fi

echo "OK: $URL"
cat "$tmp"
echo
exit 0
