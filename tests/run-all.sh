#!/usr/bin/env bash
# Runs every end-to-end suite against a running app (BASE_URL, default http://localhost:3100),
# resetting the local database before each one. Requires DB_LOCAL=1 and Playwright with Chromium.
set -u
export OUT="${OUT:-test-results}"
mkdir -p "$OUT/shots"
fail=0
for suite in smoke agents day3 day4 day5 phase-a phase-b phase-c phase-d phase-e phase-f phase-g links; do
  npm run -s db:reset >/dev/null 2>&1 || { echo "db reset failed"; exit 1; }
  log=$(node "tests/e2e/$suite.cjs" "$OUT" 2>&1)
  code=$?
  if [ $code -ne 0 ] || echo "$log" | grep -qE "FAIL |PAGEERROR|TimeoutError|ERRORS \[" ; then echo "✗ $suite"; echo "$log" | grep -E "FAIL |PAGEERROR|Error|ERRORS" | head -8; fail=1; else echo "✓ $suite"; fi
done
exit $fail
