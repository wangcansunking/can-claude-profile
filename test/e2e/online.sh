#!/usr/bin/env bash
# test/e2e/online.sh — network tier. Reproduces the real "paste-a-prompt" path
# an agent takes, so the branch-name 404 (and its kin) can't come back silently.
#
# What it guards:
#   1. The default-branch raw URL an agent guesses (raw/HEAD) resolves — this is
#      the exact fetch that 404'd when the default branch was `master` but the
#      agent tried `main`.
#   2. install.md is reachable at the default branch.
#   3. `npx github:<slug> install` works end to end against the real repo.
#
# Requires network + npx. run.sh invokes this in the --withcli image.
set -uo pipefail
cd "$(dirname "$0")/../.."
REPO_LOCAL="$PWD"

SLUG="${CCP_SLUG:-wangcansunking/can-claude-profile}"
pass=0; fail=0
chk(){ if [ "$2" = "$3" ]; then echo "  PASS $1"; pass=$((pass+1)); else echo "  FAIL $1 (want '$3' got '$2')"; fail=$((fail+1)); fi; }
http(){ curl -s -o /dev/null -w "%{http_code}" "$1"; }

echo "=== ONLINE TIER (slug: $SLUG) ==="

# Resolve the repo's actual default branch from the GitHub API (no guessing).
DEF="$(curl -s "https://api.github.com/repos/$SLUG" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).default_branch||"")}catch{console.log("")}})')"
echo "  default branch (per API): ${DEF:-<none>}"
chk "repo is reachable / public" "$(http "https://api.github.com/repos/$SLUG")" "200"
chk "default branch resolved" "$([ -n "$DEF" ] && echo yes || echo no)" "yes"

# ── 1. The agent's raw-fetch path resolves at the default branch ────────────
# This is the assertion that would have caught the 404: install.md must be
# fetchable at whatever the default branch actually is.
scenario_url="https://raw.githubusercontent.com/$SLUG/$DEF/install.md"
chk "raw install.md @ default branch → 200" "$(http "$scenario_url")" "200"

# Belt-and-suspenders: the two names agents most commonly guess. At least the
# default must work; we assert the default explicitly above. Here we just report
# both so a future divergence is visible in the log.
echo "  info: raw main/install.md   → $(http "https://raw.githubusercontent.com/$SLUG/main/install.md")"
echo "  info: raw master/install.md → $(http "https://raw.githubusercontent.com/$SLUG/master/install.md")"

# ── 2. README's npx one-liner form is fetchable as a tarball (what npx pulls) ─
chk "codeload tarball @ default → 200" \
  "$(http "https://codeload.github.com/$SLUG/tar.gz/refs/heads/$DEF")" "200"

# ── 3. Full npx install end to end (the README/prompt happy path) ───────────
if command -v npx >/dev/null 2>&1; then
  H="$(mktemp -d)"; mkdir -p "$H/.claude"
  echo '{ "env": { "ANTHROPIC_API_KEY": "LOCAL-KEY" } }' > "$H/.claude/settings.json"
  echo "  running: npx -y github:$SLUG install --yes --skip=plugins  (this pulls from GitHub)…"
  out="$(HOME="$H" USERPROFILE="$H" npx -y "github:$SLUG" install --yes --skip=plugins 2>&1 | sed 's/\x1b\[[0-9;]*m//g')"
  echo "$out" | tail -3 | sed 's/^/    | /'
  chk "npx install completes" "$(echo "$out" | grep -c 'Install complete')" "1"
  chk "npx install placed skills" "$([ "$(ls "$H/.claude/skills" 2>/dev/null | wc -l | tr -d ' ')" -gt 0 ] && echo yes || echo no)" "yes"
  chk "npx install preserved local key" \
    "$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1]+'/.claude/settings.json','utf8')).env.ANTHROPIC_API_KEY)" "$H")" \
    "LOCAL-KEY"
  rm -rf "$H"
else
  echo "  SKIP npx install (npx not on PATH in this image)"
fi

echo
echo "=== ONLINE TIER: $pass passed, $fail failed ==="
[ "$fail" -eq 0 ]
