#!/usr/bin/env bash
# test/run.sh — build & run the import test in fresh Ubuntu containers.
#   ./test/run.sh           # minimal env (no claude CLI) — fast
#   ./test/run.sh --withcli # full env incl. real claude CLI — proves marketplace add
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ "${1:-}" == "--withcli" ]]; then
  DF=test/Dockerfile.withcli; TAG=ccprofile-test-withcli
  echo "Building full image (node+git+claude CLI)…"
else
  DF=test/Dockerfile.nocli; TAG=ccprofile-test
  echo "Building minimal image (node+git)…"
fi

docker build -f "$DF" -t "$TAG" . >/dev/null
echo "Running import test in fresh Ubuntu container…"
echo
docker run --rm "$TAG"
