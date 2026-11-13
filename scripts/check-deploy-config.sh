#!/usr/bin/env bash
# Validate WaveWorld deploy env names (P5).
# Does not print secret values. Safe to run in CI with empty env (use --list).
#
# Usage:
#   ./scripts/check-deploy-config.sh              # check process env for required host names
#   ./scripts/check-deploy-config.sh --file PATH  # check KEY=value file
#   ./scripts/check-deploy-config.sh --list       # print known names and exit 0
#   ./scripts/check-deploy-config.sh --strict-oidc  # also require W_ID_* quartet
#   ./scripts/check-deploy-config.sh --assert-examples  # fail if deploy *.example embeds secret values
#   ./scripts/check-deploy-config.sh --check-wsim-vendor   # verify pinned local W-Sim package/crate hashes
#
set -euo pipefail

LIST_ONLY=0
STRICT_OIDC=0
ASSERT_EXAMPLES=0
WSIM_CHECK=0
ENV_FILE=""

usage() {
  sed -n '2,13p' "$0" | sed 's/^# \?//'
  exit "${1:-0}"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --list) LIST_ONLY=1; shift ;;
    --strict-oidc) STRICT_OIDC=1; shift ;;
    --assert-examples) ASSERT_EXAMPLES=1; shift ;;
    --check-wsim-vendor) WSIM_CHECK=1; shift ;;
    --file)
      ENV_FILE="${2:-}"
      if [[ -z "$ENV_FILE" ]]; then
        echo "error: --file requires a path" >&2
        exit 2
      fi
      shift 2
      ;;
    -h|--help) usage 0 ;;
    *)
      echo "error: unknown arg: $1" >&2
      usage 2
      ;;
  esac
done

# Required for a production-like host (paths + runtime mode)
REQUIRED_HOST=(
  TASK_DB_PATH
)

# Strongly recommended for production (warned if missing unless --strict later)
RECOMMENDED_HOST=(
  ARTIFACT_ROOT
  NODE_ENV
)

# Optional host / feature flags (documented; never required by this script)
# Secrets (TASK_API_KEY, AGENT_REGISTRATION_KEY, W_ID_CLIENT_SECRET) must live
# in private host.env (mode 0600) — never git. This script never prints values.
OPTIONAL_HOST=(
  W_COMPUTE_ENABLED
  W_COMPUTE_API_URL
  W_COMPUTE_TOKEN
  W_COMPUTE_CLUSTER_ID
  W_COMPUTE_TEMPLATE_ID
  W_COMPUTE_CPU_MILLIS
  W_COMPUTE_MEMORY_MIB
  W_COMPUTE_MAX_WALL_TIME_MS
  W_COMPUTE_MAX_CONCURRENT
  W_COMPUTE_CURRENCY
  W_COMPUTE_MAX_HOURLY_MICROS
  W_COMPUTE_MAX_STORAGE_GIB_HOURLY_MICROS
  ARTIFACT_MAX_BYTES
  MAX_ARTIFACT_BYTES
  ARTIFACT_REQUIRE_AUTH
  TASK_API_KEY
  AGENT_REGISTRATION_KEY
  TASK_LEASE_SECONDS
  LEASE_SECONDS
  TASK_DEV_AUTH
  TASK_ALLOW_DEV_LOGIN
  WAVEWORLD_CORS_ORIGINS
  # Residual after 7290c1c: document JOB_REQUIRE_AUTH (prod-like job auth outside production)
  JOB_REQUIRE_AUTH
  BUILD_ID
  WAVEWORLD_BUILD_ID
  WAVEWORLD_REVIEW_ISSUE_URL
  GIT_SHA
  GITHUB_SHA
  AGENT_WORKSPACE
  WAVEWORLD_BIND_HOST
  PORT
  NEXT_PUBLIC_LAB_URL
  VITE_LAB_URL
  KNOWLEDGE_DB_PATH
  KNOWLEDGE_BLOBS_DIR
  WAVEWORLD_KNOWLEDGE_RELEASES_ROOT
  KNOWLEDGE_SOURCE
  KNOWLEDGE_WRITE_KEY
  KNOWLEDGE_WRITE_API_KEY
)

# W-ID OIDC (required only with --strict-oidc)
OIDC_REQUIRED=(
  W_ID_ISSUER
  W_ID_CLIENT_ID
  W_ID_CLIENT_SECRET
  W_ID_REDIRECT_URI
)

OIDC_OPTIONAL=(
  W_ID_AUTHORIZATION_ENDPOINT
  W_ID_TOKEN_ENDPOINT
  W_ID_USERINFO_ENDPOINT
  W_ID_SCOPES
  W_ID_POST_LOGIN_REDIRECT
  W_ID_COOKIE_SECURE
  W_ID_COOKIE_SAMESITE
  W_ID_DEV_CALLBACK_STUB
)

# Agent worker
AGENT_NAMES=(
  TASK_API_URL
  AGENT_TOKEN
  TUANLIU_ROOT
  TUANLIU_DATA
  DAWN_NODE_PATH
  DEBUG_DAWN
  W_SIM_BACKEND
  W_SIM_CUDA_PATH
  W_SIM_NATIVE_TIMEOUT_MS
  W_SIM_JOB_TIMEOUT_MS
)

# Keys that must never hold real values in git-tracked *.example files.
# Residual after 0434093: include knowledge write keys (same class as TASK_API_KEY).
SECRET_KEYS=(
  W_COMPUTE_TOKEN
  TASK_API_KEY
  AGENT_REGISTRATION_KEY
  W_ID_CLIENT_SECRET
  AGENT_TOKEN
  KNOWLEDGE_WRITE_KEY
  KNOWLEDGE_WRITE_API_KEY
)

# Browser Host API addresses are owned by same-origin ingress. This retired
# build-time value must not silently keep a second cross-origin connection path.
RETIRED_CLIENT_ENV=(VITE_HOST_API_URL)

if [[ "$LIST_ONLY" -eq 1 ]]; then
  echo "# required host"
  printf '%s\n' "${REQUIRED_HOST[@]}"
  echo "# recommended host"
  printf '%s\n' "${RECOMMENDED_HOST[@]}"
  echo "# optional host"
  printf '%s\n' "${OPTIONAL_HOST[@]}"
  echo "# oidc (required for SSO)"
  printf '%s\n' "${OIDC_REQUIRED[@]}"
  echo "# oidc optional"
  printf '%s\n' "${OIDC_OPTIONAL[@]}"
  echo "# agent"
  printf '%s\n' "${AGENT_NAMES[@]}"
  echo "# retired client config (must be unset)"
  printf '%s\n' "${RETIRED_CLIENT_ENV[@]}"
  echo "# secrets (never in git examples)"
  printf '%s\n' "${SECRET_KEYS[@]}"
  exit 0
fi

# Resolve repo root (script lives in scripts/)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# --check-wsim-vendor verifies the immutable local bundle before installation.
if [[ "$WSIM_CHECK" -eq 1 ]]; then
  node "$SCRIPT_DIR/verify-wsim-vendor.mjs"
  echo "wsim-vendor: ok"
  if [[ -z "$ENV_FILE" && "$STRICT_OIDC" -eq 0 && "$ASSERT_EXAMPLES" -eq 0 ]]; then
    exit 0
  fi
fi

# Scan KEY=value lines; report secret keys with non-empty values (never print values).
# Returns count of violations via stdout number; messages on stderr.
scan_example_secrets() {
  local file="$1"
  local bad=0
  local line key val
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%%#*}"
    line="${line#"${line%%[![:space:]]*}"}"
    line="${line%"${line##*[![:space:]]}"}"
    [[ -z "$line" ]] && continue
    if [[ "$line" =~ ^([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
      key="${BASH_REMATCH[1]}"
      val="${BASH_REMATCH[2]}"
      if [[ "$val" =~ ^\"(.*)\"$ ]]; then val="${BASH_REMATCH[1]}"; fi
      if [[ "$val" =~ ^\'(.*)\'$ ]]; then val="${BASH_REMATCH[1]}"; fi
      for sk in "${SECRET_KEYS[@]}"; do
        if [[ "$key" == "$sk" && -n "$val" ]]; then
          echo "error: example file embeds secret key $sk (non-empty value): $file" >&2
          bad=$((bad + 1))
        fi
      done
    fi
  done <"$file"
  printf '%s' "$bad"
}

if [[ "$ASSERT_EXAMPLES" -eq 1 ]]; then
  example_bad=0
  while IFS= read -r -d '' ex; do
    n="$(scan_example_secrets "$ex")"
    example_bad=$((example_bad + n))
  done < <(find "$REPO_ROOT/deploy" -type f \( -name '*.example' -o -name 'env.example' \) -print0 2>/dev/null)
  echo "check-deploy-config: --assert-examples scanned deploy/**/*.example"
  if [[ "$example_bad" -gt 0 ]]; then
    echo "MISSING: $example_bad secret embedding(s) in example files (values never printed)"
    exit 1
  fi
  echo "examples: ok (no non-empty secret keys)"
  echo "note: WaveWorld Lab is a preview (#53 tracker) — Host ok/ready must not claim Lab fully usable"
  # When only asserting examples, exit success (other modes can combine with --file)
  if [[ -z "$ENV_FILE" && "$STRICT_OIDC" -eq 0 ]]; then
    exit 0
  fi
fi

# Load KEY=value from file into a nameref map without exporting secrets to children
declare -A FILE_ENV=()
if [[ -n "$ENV_FILE" ]]; then
  if [[ ! -f "$ENV_FILE" ]]; then
    echo "error: env file not found: $ENV_FILE" >&2
    exit 2
  fi
  while IFS= read -r line || [[ -n "$line" ]]; do
    # strip comments and blank lines
    line="${line%%#*}"
    line="${line#"${line%%[![:space:]]*}"}"
    line="${line%"${line##*[![:space:]]}"}"
    [[ -z "$line" ]] && continue
    if [[ "$line" =~ ^([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
      key="${BASH_REMATCH[1]}"
      val="${BASH_REMATCH[2]}"
      # strip optional surrounding quotes
      if [[ "$val" =~ ^\"(.*)\"$ ]]; then val="${BASH_REMATCH[1]}"; fi
      if [[ "$val" =~ ^\'(.*)\'$ ]]; then val="${BASH_REMATCH[1]}"; fi
      FILE_ENV["$key"]="$val"
    fi
  done <"$ENV_FILE"
fi

get_val() {
  local key="$1"
  if [[ -n "$ENV_FILE" ]]; then
    if [[ -v "FILE_ENV[$key]" ]]; then
      printf '%s' "${FILE_ENV[$key]}"
      return 0
    fi
    return 1
  fi
  if [[ -n "${!key+x}" ]]; then
    printf '%s' "${!key}"
    return 0
  fi
  return 1
}

is_set_nonempty() {
  local key="$1"
  local val
  if val="$(get_val "$key")"; then
    [[ -n "$val" ]]
    return $?
  fi
  return 1
}

missing_req=()
missing_rec=()
missing_oidc=()
warnings=()
retired_config=()

for key in "${RETIRED_CLIENT_ENV[@]}"; do
  if is_set_nonempty "$key"; then
    retired_config+=("$key is retired; remove it and use same-origin /api")
  fi
done

for key in "${REQUIRED_HOST[@]}"; do
  if ! is_set_nonempty "$key"; then
    missing_req+=("$key")
  fi
done

for key in "${RECOMMENDED_HOST[@]}"; do
  if ! is_set_nonempty "$key"; then
    missing_rec+=("$key")
  fi
done

if [[ "$STRICT_OIDC" -eq 1 ]]; then
  for key in "${OIDC_REQUIRED[@]}"; do
    if ! is_set_nonempty "$key"; then
      missing_oidc+=("$key")
    fi
  done
fi

# Soft warnings for dangerous prod combos
if is_set_nonempty TASK_DEV_AUTH; then
  tda="$(get_val TASK_DEV_AUTH || true)"
  if [[ "$tda" == "1" || "$tda" == "true" ]]; then
    warnings+=("TASK_DEV_AUTH is enabled — do not use on public production")
  fi
fi

if is_set_nonempty TASK_ALLOW_DEV_LOGIN; then
  tdl="$(get_val TASK_ALLOW_DEV_LOGIN || true)"
  if [[ "$tdl" == "1" || "$tdl" == "true" ]]; then
    warnings+=("TASK_ALLOW_DEV_LOGIN is enabled — do not use on public production")
  fi
fi

if is_set_nonempty NODE_ENV; then
  ne="$(get_val NODE_ENV || true)"
  if [[ "$ne" == "production" ]] && ! is_set_nonempty ARTIFACT_ROOT; then
    warnings+=("NODE_ENV=production but ARTIFACT_ROOT unset (default relative path may be wrong)")
  fi
fi

# Lab URL bake: never loopback for public; Host/Atlas pair must match when both set.
# WaveWorld Lab preview (#53) → path live ≠ Lab fully usable (see Host /api/health.lab).
lab_pair_error=0
next_lab=""
vite_lab=""
if is_set_nonempty NEXT_PUBLIC_LAB_URL; then
  next_lab="$(get_val NEXT_PUBLIC_LAB_URL || true)"
  next_lab="${next_lab%/}"
  if [[ "$next_lab" =~ 127\.0\.0\.1|localhost|\[::1\]|::1 ]]; then
    warnings+=("NEXT_PUBLIC_LAB_URL looks loopback — never bake loopback into public Host builds")
    lab_pair_error=1
  fi
fi
if is_set_nonempty VITE_LAB_URL; then
  vite_lab="$(get_val VITE_LAB_URL || true)"
  vite_lab="${vite_lab%/}"
  if [[ "$vite_lab" =~ 127\.0\.0\.1|localhost|\[::1\]|::1 ]]; then
    warnings+=("VITE_LAB_URL looks loopback — never bake loopback into public Atlas builds")
    lab_pair_error=1
  fi
fi
if [[ -n "$next_lab" && -n "$vite_lab" && "$next_lab" != "$vite_lab" ]]; then
  warnings+=("NEXT_PUBLIC_LAB_URL and VITE_LAB_URL differ — Host/Atlas Lab bases must be identical")
  lab_pair_error=1
fi

echo "check-deploy-config: source=${ENV_FILE:-process environment}"

if [[ ${#missing_req[@]} -gt 0 ]]; then
  echo "MISSING required:"
  printf '  - %s\n' "${missing_req[@]}"
else
  echo "required: ok (${#REQUIRED_HOST[@]} names)"
fi

if [[ ${#missing_rec[@]} -gt 0 ]]; then
  echo "MISSING recommended:"
  printf '  - %s\n' "${missing_rec[@]}"
else
  echo "recommended: ok"
fi

if [[ "$STRICT_OIDC" -eq 1 ]]; then
  if [[ ${#missing_oidc[@]} -gt 0 ]]; then
    echo "MISSING OIDC (--strict-oidc):"
    printf '  - %s\n' "${missing_oidc[@]}"
  else
    echo "oidc: ok"
  fi
else
  oidc_set=0
  for key in "${OIDC_REQUIRED[@]}"; do
    if is_set_nonempty "$key"; then oidc_set=$((oidc_set + 1)); fi
  done
  echo "oidc: $oidc_set/${#OIDC_REQUIRED[@]} set (use --strict-oidc to require all)"
fi

if [[ ${#warnings[@]} -gt 0 ]]; then
  echo "warnings:"
  printf '  - %s\n' "${warnings[@]}"
fi
if [[ ${#retired_config[@]} -gt 0 ]]; then
  echo "UNSUPPORTED config:"
  printf '  - %s\n' "${retired_config[@]}"
fi

# Lab honesty note (always): host process health ≠ Lab fully usable while preview
echo "note: WaveWorld Lab is a preview (#53 tracker) — Host ok/ready must not claim Lab fully usable (health.lab.claimFullyUsable=false)"
echo "note: metrics gauges waveworld_lab_claim_fully_usable=0 / lab_blocker_open=1 / lab_blocker_issue=53 / lab_path_live_not_fully_usable=1 while Lab is a preview"
echo "note: metrics 401/503 also Cache-Control: no-store; error text must not echo secret env values"
echo "note: readiness 503 + metrics 503 use safeOperationalErrorMessage; auth/config no-store + labClaimFullyUsable=false"
echo "note: residual after 59a3fa3: auth/config labBlockerIssue=49 pins; readiness ready=; PROBE_NO_STORE_HEADERS; string-throw redaction"
echo "note: residual after 6d08a42: readiness readyScope=task-db; PROBE_NO_STORE private/must-revalidate/Pragma; metrics label redactOperationalSecrets"
echo "note: residual after 1b367e7: health okScope=process; jobs/stats no-store + labClaimFullyUsable=false; PROBE_NO_STORE Expires:0"
echo "note: residual after aabd0bf: shared sameSecret (metrics/jobs-stats/job-sharing/jobs list); PROBE Surrogate-Control:no-store"
echo "note: residual after 7290c1c: agents/register sameSecret; probe Surrogate-Control pin; JOB_REQUIRE_AUTH listed optional"
echo "note: residual after 6d2ecaa: agents/register no-store (PROBE_NO_STORE on 401/201 token); JOB_REQUIRE_AUTH closes dev-open; WAVEWORLD_BIND_HOST/PORT listed"
echo "note: residual after f8da984: register configured-key-always + JOB_REQUIRE_AUTH; jobs/stats JOB_REQUIRE_AUTH; share token min-length"
echo "note: residual after c72cf29: share base64url+max; shares POST no-store token; CORS x-waveworld-share"
echo "note: residual after wave30: share TTL clamp MIN=300 MAX=1y DEFAULT=30d (NaN→default); applied expiresInSeconds; revoke DELETE no-store"
echo "note: residual after wave31: shares POST/DELETE all-path PROBE_NO_STORE + safeOperationalErrorMessage; normalizeShareExpiresInSeconds (JSON string TTL); title clamp; SHARE_JOBS_MAX"
echo "note: residual after wave32: isPlausibleShareId (UUID) on DELETE — numeric/garbage path ids → 400 invalid share id (not dishonest 404)"
echo "note: residual after wave33: normalizeShareJobIds on shares POST — non-array/non-UUID jobIds → 400 invalid job id (not char-spread or dishonest 404)"
echo "note: residual after wave34: publications POST reuses normalizeShareJobIds — garbage jobIds → 400 (not dishonest 404 not-found/not-publishable)"
echo "note: residual after wave35: isPlausiblePublicId + normalizePublicationVersion on publications detail/download/reviews — garbage publicId / invalid version → 400 (not dishonest 404)"
echo "note: residual after wave36: isPlausibleJobId on jobs/[id] GET + result + cancel — garbage path ids → 400 invalid job id (not dishonest 404 Job not found)"
echo "note: residual after wave37: normalizeJobId on jobs/[id]/* (GET/result/cancel + audit + agent claim/complete/fail/heartbeat/progress) + shareAllowsJob jobId gate — garbage → 400 (not dishonest 404/409)"
echo "note: residual after wave38: normalizeShareId on shares DELETE; normalizeProjectId on projects/[id] + projects/[id]/jobs; normalizeJobId on attach body.jobId — garbage → 400 (not dishonest 404)"
echo "note: residual after wave39: normalizeProjectId on projects/[id]/members (+ [userId]) + projects/[id]/models (+ [modelId]); normalizeModelId on model DELETE; invalid principal userId → 400 (not dishonest 404)"
echo "note: residual after wave40: normalizeArtifactId/EvidenceId/ComparisonId on artifacts|evidence|comparisons/[id] GET; normalizeJobId on artifacts POST body.jobId — garbage → 400 (not dishonest 404)"
echo "note: residual after wave41: comparisons POST normalizeShareJobIds; artifacts POST/GET projectId + GET jobId; evidence import projectId — garbage → 400 (not dishonest 404/403)"
echo "note: never embed secret values in git examples; materialize to /etc/waveworld/host.env mode 0600"

# If checking a tracked example file, fail closed on non-empty secret keys (never print values).
example_secret_error=0
if [[ -n "$ENV_FILE" && ( "$ENV_FILE" == *.example || "$(basename "$ENV_FILE")" == "env.example" ) ]]; then
  n="$(scan_example_secrets "$ENV_FILE")"
  if [[ "$n" -gt 0 ]]; then
    example_secret_error=1
    echo "examples: FAIL ($n secret key(s) with non-empty value in example file)"
  else
    echo "examples: ok (no non-empty secret keys in checked example file)"
  fi
fi

if [[ ${#missing_req[@]} -gt 0 || ${#missing_oidc[@]} -gt 0 || "$lab_pair_error" -ne 0 || "$example_secret_error" -ne 0 || ${#retired_config[@]} -gt 0 ]]; then
  exit 1
fi

# recommended-only missing → exit 0 but message already printed
exit 0
