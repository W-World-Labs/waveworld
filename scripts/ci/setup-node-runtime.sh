#!/usr/bin/env bash
set -euo pipefail

node_bin="$(command -v node || true)"
shopt -s nullglob
node22_candidates=(/opt/hostedtoolcache/node/22.*/x64/bin/node)
shopt -u nullglob

# Native runtime artifacts are built for the production Node 22 module ABI.
if [[ ${#node22_candidates[@]} -gt 0 ]]; then
  node_bin="${node22_candidates[${#node22_candidates[@]} - 1]}"
fi

if [[ -z "$node_bin" || ! -x "$node_bin" ]]; then
  echo 'No compatible Node runtime is available in the runner image' >&2
  exit 1
fi

node_dir="$(dirname "$node_bin")"
export PATH="$node_dir:$PATH"
node_major="$(node -p 'Number(process.versions.node.split(".")[0])')"
node_abi="$(node -p 'process.versions.modules')"
if [[ "$node_major" != 22 || "$node_abi" != 127 ]]; then
  echo "Waveworld release CI requires Node 22 ABI 127; runner provided Node $node_major ABI $node_abi" >&2
  exit 1
fi

if [[ -n "${GITHUB_PATH:-}" ]]; then
  printf '%s\n' "$node_dir" >> "$GITHUB_PATH"
fi

node --version
npm --version
