#!/usr/bin/env bash
# test/merge.sh — E2E for install's CLAUDE.md three-state handling (absent / identical / differ).
# Runs against throwaway HOMEs; never touches the real ~/.claude.
set -uo pipefail
cd "$(dirname "$0")/.."
REPO="$PWD"
pass=0; fail=0
chk(){ if [ "$2" = "$3" ]; then echo "PASS $1"; pass=$((pass+1)); else echo "FAIL $1 (want '$3' got '$2')"; fail=$((fail+1)); fi; }

mkhome(){ local d; d="$(mktemp -d)"; mkdir -p "$d/.claude"; echo '{"env":{}}' > "$d/.claude/settings.json"; echo "$d"; }

# --- State 1: absent → installed ---
H1="$(mkhome)"
HOME="$H1" USERPROFILE="$H1" node "$REPO/profile.mjs" install --yes >/dev/null 2>&1
[ -f "$H1/.claude/CLAUDE.md" ] && s1=yes || s1=no
chk "absent → CLAUDE.md installed" "$s1" "yes"
[ -f "$H1/.claude/CLAUDE.md.incoming" ] && i1=yes || i1=no
chk "absent → no .incoming created" "$i1" "no"
rm -rf "$H1"

# --- State 2: identical → skipped, no .incoming ---
H2="$(mkhome)"
cp "$REPO/profile/CLAUDE.md" "$H2/.claude/CLAUDE.md"
out2="$(HOME="$H2" USERPROFILE="$H2" node "$REPO/profile.mjs" install --yes 2>&1)"
echo "$out2" | grep -q "identical" && id2=yes || id2=no
chk "identical → reported identical" "$id2" "yes"
[ -f "$H2/.claude/CLAUDE.md.incoming" ] && i2=yes || i2=no
chk "identical → no .incoming created" "$i2" "no"
rm -rf "$H2"

# --- State 3: differs → local kept, repo staged as .incoming ---
H3="$(mkhome)"
printf '# Global Rules\n\n## My Local Rule\n\n- Keep this machine-specific rule.\n' > "$H3/.claude/CLAUDE.md"
localbefore="$(cat "$H3/.claude/CLAUDE.md")"
out3="$(HOME="$H3" USERPROFILE="$H3" node "$REPO/profile.mjs" install --yes 2>&1)"
localafter="$(cat "$H3/.claude/CLAUDE.md")"
chk "differs → local CLAUDE.md untouched" "$localafter" "$localbefore"
[ -f "$H3/.claude/CLAUDE.md.incoming" ] && i3=yes || i3=no
chk "differs → repo staged as .incoming" "$i3" "yes"
# .incoming must equal the repo version
if diff -q "$H3/.claude/CLAUDE.md.incoming" "$REPO/profile/CLAUDE.md" >/dev/null 2>&1; then eq3=yes; else eq3=no; fi
chk "differs → .incoming equals repo CLAUDE.md" "$eq3" "yes"
echo "$out3" | grep -q "differs from local" && msg3=yes || msg3=no
chk "differs → prints merge cue" "$msg3" "yes"
rm -rf "$H3"

# --- The merge skill must be vendored & in the manifest ---
[ -f "$REPO/profile/skills/can-claude-profile/SKILL.md" ] && sk=yes || sk=no
chk "merge skill vendored in repo" "$sk" "yes"
node -e "const m=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')); process.exit(m.skills.some(s=>s.name==='can-claude-profile')?0:1)" "$REPO/profile/manifest.json" && mf=yes || mf=no
chk "merge skill in manifest" "$mf" "yes"

echo
echo "=== $pass passed, $fail failed ==="
[ "$fail" -eq 0 ]
