#!/usr/bin/env bash
# 构建 tuanliu-agent 真二进制（Node SEA + Dawn 原生库）
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
exec node scripts/build-agent.mjs
