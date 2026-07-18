#!/usr/bin/env bash
# Smoke-test a running instance. Usage: BASE_URL=http://localhost:5000 scripts/smoke.sh
set -euo pipefail
BASE_URL="${BASE_URL:-http://localhost:5000}"

echo "health:"
curl -fsS "$BASE_URL/healthz"; echo

echo "speech token:"
curl -fsS "$BASE_URL/api/speech/token" | head -c 200; echo

echo "chat:"
curl -fsS -X POST "$BASE_URL/api/chat" \
  -H 'Content-Type: application/json' \
  -d '{"sessionId":"smoke-1","text":"When are you open?"}'; echo
