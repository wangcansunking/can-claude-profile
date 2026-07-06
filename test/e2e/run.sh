#!/usr/bin/env bash
# test/e2e/run.sh — build the e2e image and run the scenario suite in a fresh
# container. Mirrors the machine an agent installs onto: nothing but node+git.
#
#   ./test/e2e/run.sh                # offline scenarios, no claude CLI  (fast)
#   ./test/e2e/run.sh --withcli      # offline scenarios + real claude CLI (marketplace step)
#   ./test/e2e/run.sh --online       # offline scenarios THEN online tier (network + npx)
#   ./test/e2e/run.sh --online-only  # just the online regression tier
#
# The --online tier reproduces the paste-a-prompt path and guards the
# default-branch 404. It needs network access and pulls from GitHub.
set -euo pipefail
cd "$(dirname "$0")/../.."

WITHCLI=0; ONLINE=0; ONLINE_ONLY=0
for a in "$@"; do
  case "$a" in
    --withcli) WITHCLI=1 ;;
    --online) ONLINE=1; WITHCLI=1 ;;         # online tier needs npm/npx → withcli image
    --online-only) ONLINE_ONLY=1; ONLINE=1; WITHCLI=1 ;;
    *) echo "unknown arg: $a" >&2; exit 2 ;;
  esac
done

TAG="ccprofile-e2e$([ "$WITHCLI" = 1 ] && echo "-cli" || echo "")"
echo "Building e2e image ($TAG, WITHCLI=$WITHCLI)…"
docker build -f test/e2e/Dockerfile --build-arg "WITHCLI=$WITHCLI" -t "$TAG" . >/dev/null

rc=0
if [ "$ONLINE_ONLY" = 0 ]; then
  echo; echo "▶ OFFLINE SCENARIOS"
  docker run --rm "$TAG" || rc=$?
fi
if [ "$ONLINE" = 1 ]; then
  echo; echo "▶ ONLINE TIER"
  docker run --rm --entrypoint bash "$TAG" /work/test/e2e/online.sh || rc=$?
fi

echo
if [ "$rc" = 0 ]; then echo "✓ e2e suite passed"; else echo "✗ e2e suite failed (rc=$rc)"; fi
exit "$rc"
