#!/usr/bin/env bash
# sync.sh — capture this machine's Claude config into the repo.
set -euo pipefail
cd "$(dirname "$0")"
exec node profile.mjs sync "$@"
