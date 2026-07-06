#!/usr/bin/env bash
# test/merge.sh — E2E for install's CLAUDE.md handling (absent / identical / auto-merge)
# plus selective install (--only / --skip). Runs against throwaway HOMEs; never
# touches the real ~/.claude.
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

# --- State 3: differs → auto section-merge (local kept + repo merged in, no .incoming) ---
H3="$(mkhome)"
printf '# Global Rules\n\n## My Local Rule\n\n- Keep this machine-specific rule.\n' > "$H3/.claude/CLAUDE.md"
out3="$(HOME="$H3" USERPROFILE="$H3" node "$REPO/profile.mjs" install --yes 2>&1)"
merged3="$(cat "$H3/.claude/CLAUDE.md")"
echo "$merged3" | grep -q "Keep this machine-specific rule." && keep3=yes || keep3=no
chk "differs → local rule preserved after merge" "$keep3" "yes"
echo "$merged3" | grep -q "My Local Rule" && sec3=yes || sec3=no
chk "differs → local section preserved" "$sec3" "yes"
# repo content must now be present (Completion Status is a repo-only section)
echo "$merged3" | grep -q "Completion Status" && repo3=yes || repo3=no
chk "differs → repo sections merged in" "$repo3" "yes"
[ -f "$H3/.claude/CLAUDE.md.incoming" ] && i3=yes || i3=no
chk "differs → no .incoming on clean auto-merge" "$i3" "no"
echo "$out3" | grep -q "auto-merged" && msg3=yes || msg3=no
chk "differs → prints auto-merged cue" "$msg3" "yes"
ls "$H3/.claude/backups/profile-install/" 2>/dev/null | grep -q "CLAUDE.md" && bk3=yes || bk3=no
chk "differs → backup of old CLAUDE.md saved" "$bk3" "yes"
rm -rf "$H3"

# --- State 4: selective install (--only / --skip) ---
H4="$(mkhome)"
before4="$(cat "$H4/.claude/settings.json")"
HOME="$H4" USERPROFILE="$H4" node "$REPO/profile.mjs" install --yes --only=skills >/dev/null 2>&1
after4="$(cat "$H4/.claude/settings.json")"
chk "--only=skills → settings.json untouched" "$after4" "$before4"
[ -d "$H4/.claude/skills" ] && [ "$(ls "$H4/.claude/skills" 2>/dev/null | wc -l)" -gt 0 ] && sk4=yes || sk4=no
chk "--only=skills → skills installed" "$sk4" "yes"
[ -f "$H4/.claude/CLAUDE.md" ] && cm4=yes || cm4=no
chk "--only=skills → CLAUDE.md skipped" "$cm4" "no"
rm -rf "$H4"

H5="$(mkhome)"
HOME="$H5" USERPROFILE="$H5" node "$REPO/profile.mjs" install --yes --skip=skills >/dev/null 2>&1
[ -d "$H5/.claude/skills" ] && sk5=yes || sk5=no
chk "--skip=skills → skills not installed" "$sk5" "no"
[ -f "$H5/.claude/CLAUDE.md" ] && cm5=yes || cm5=no
chk "--skip=skills → CLAUDE.md still installed" "$cm5" "yes"
rm -rf "$H5"

# --- The merge skill must be vendored & in the manifest ---
[ -f "$REPO/profile/skills/can-claude-profile/SKILL.md" ] && sk=yes || sk=no
chk "merge skill vendored in repo" "$sk" "yes"
node -e "const m=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')); process.exit(m.skills.some(s=>s.name==='can-claude-profile')?0:1)" "$REPO/profile/manifest.json" && mf=yes || mf=no
chk "merge skill in manifest" "$mf" "yes"

echo
echo "=== $pass passed, $fail failed ==="
[ "$fail" -eq 0 ]
