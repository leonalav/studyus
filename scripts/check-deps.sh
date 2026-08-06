#!/usr/bin/env bash
# Dependency-rule enforcement — the web adaptation of §6/§9 Law 9.
#
# 1. All pedagogy lives in src/core (+ the content pack in src/pack). These
#    modules must not import React, ReactDOM, or any DOM/UI machinery —
#    frontends are thin bindings over the session API, never the reverse.
# 2. No HTTP client may appear anywhere in the workspace (§18, Law 10).
#    Ingestion is local-only; there is no telemetry path at all.
set -euo pipefail
cd "$(dirname "$0")/.."

fail=0

echo "── Law 9: pedagogy modules must be UI-free ──"
if grep -RnE "from ['\"]react|from ['\"]react-dom|require\(['\"]react|document\.|window\." src/core src/pack; then
  echo "FAIL: UI/DOM imports found inside pedagogy modules (src/core, src/pack)"
  fail=1
else
  echo "OK: src/core and src/pack contain no UI or DOM imports"
fi

echo "── §18: no HTTP client anywhere in the workspace ──"
if grep -nE "\"(axios|node-fetch|isomorphic-fetch|got|superagent|ky|undici)\"" package.json; then
  echo "FAIL: HTTP client dependency present in package.json"
  fail=1
else
  echo "OK: package.json declares no HTTP client"
fi
if grep -RnE "from ['\"](axios|node-fetch|isomorphic-fetch|got|superagent|ky)['\"]|fetch\(['\"]https?://" src --include='*.ts' --include='*.tsx'; then
  echo "FAIL: HTTP call found in src/"
  fail=1
else
  echo "OK: no HTTP calls in src/"
fi

exit $fail
