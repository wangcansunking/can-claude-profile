#!/usr/bin/env bash
# install.sh — apply the repo profile onto this machine.
set -euo pipefail
cd "$(dirname "$0")"
exec node profile.mjs install "$@"
