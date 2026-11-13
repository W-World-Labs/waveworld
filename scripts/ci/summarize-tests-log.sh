#!/usr/bin/env bash
# summarize-tests-log.sh — convert a tee'd CI test log into the cargo-style
# `test result:` lines radar-ci-report.sh parses for tests_failed.
#
# Usage: bash scripts/ci/summarize-tests-log.sh <tee'd-log> <out-file>
#
# WaveWorld suites emit three real formats — this script only TRANSLATES
# counts that were actually printed; it never invents a zero:
#   node:test (tsx --test) : "# pass N" / "# fail N"   (TAP summary)
#   vitest                  : "Tests  A failed | B passed" or "Tests  N passed"
#   playwright              : "N passed"/"N failed" inside the run summary
# Counts a format we don't recognize contribute nothing — missing evidence
# stays missing (metric fails closed) rather than reporting a fake 0.
set -u
IN="${1:?input log required}"
OUT="${2:?output file required}"

python3 - "$IN" "$OUT" <<'PY'
import re, sys

src, dst = sys.argv[1], sys.argv[2]
try:
    text = open(src, encoding='utf-8', errors='replace').read()
except OSError as e:
    sys.exit(f"summarize-tests-log: cannot read {src}: {e}")

passed = failed = ignored = 0

# node:test TAP summary lines: "# pass 354" / "# fail 0"
for m in re.finditer(r'^#\s+pass\s+(\d+)', text, re.M):
    passed += int(m.group(1))
for m in re.finditer(r'^#\s+fail\s+(\d+)', text, re.M):
    failed += int(m.group(1))
for m in re.finditer(r'^#\s+skipped\s+(\d+)', text, re.M):
    ignored += int(m.group(1))

# vitest: "Tests  2 failed | 72 passed (74)" or "Tests  74 passed (74)"
for m in re.finditer(r'^\s*Tests\s+(?:(\d+)\s+failed(?:\s*\|\s*)?)?(?:(\d+)\s+passed)?\s*\(', text, re.M):
    if m.group(1): failed += int(m.group(1))
    if m.group(2): passed += int(m.group(2))

# playwright summary: "  5 passed (30s)" / "  1 failed"
for m in re.finditer(r'^\s+(\d+)\s+passed\s*\(\d+', text, re.M):
    passed += int(m.group(1))
for m in re.finditer(r'^\s+(\d+)\s+failed\s*$', text, re.M):
    failed += int(m.group(1))
for m in re.finditer(r'^\s+(\d+)\s+skipped\s*$', text, re.M):
    ignored += int(m.group(1))

with open(dst, 'w', encoding='utf-8') as f:
    if passed or failed or ignored:
        # cargo-format line the report script's awk understands.
        f.write(f"test result: ok. {passed} passed; {failed} failed; {ignored} ignored;\n")
print(f"summarize-tests-log: passed={passed} failed={failed} ignored={ignored} -> {dst}")
PY
