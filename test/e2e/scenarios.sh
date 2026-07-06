#!/usr/bin/env bash
# test/e2e/scenarios.sh — offline e2e scenarios for `install`, each in a fresh
# throwaway HOME. No network. Proves the repo→machine contract end to end.
#
# Run inside the container (default entrypoint), or directly on a dev box:
#   bash test/e2e/scenarios.sh
set -uo pipefail
cd "$(dirname "$0")/../.."
REPO="$PWD"

pass=0; fail=0
chk(){ if [ "$2" = "$3" ]; then echo "  PASS $1"; pass=$((pass+1)); else echo "  FAIL $1 (want '$3' got '$2')"; fail=$((fail+1)); fi; }
scenario(){ echo; echo "── SCENARIO: $1"; }
strip(){ sed 's/\x1b\[[0-9;]*m//g'; }

# Fresh HOME seeded with local auth that must always survive install.
mkhome(){
  local d; d="$(mktemp -d)"; mkdir -p "$d/.claude"
  cat > "$d/.claude/settings.json" <<'JSON'
{ "env": { "ANTHROPIC_API_KEY": "LOCAL-KEY", "ANTHROPIC_BASE_URL": "http://127.0.0.1:9999" },
  "theme": "light", "permissions": { "allow": ["Bash(git:*)"] } }
JSON
  echo "$d"
}
run(){ local h="$1"; shift; HOME="$h" USERPROFILE="$h" node "$REPO/profile.mjs" "$@" 2>&1 | strip; }
skillcount(){ ls "$1/.claude/skills" 2>/dev/null | wc -l | tr -d ' '; }
manifestcount(){ node -e "console.log(JSON.parse(require('fs').readFileSync('$REPO/profile/manifest.json','utf8')).skills.length)"; }

echo "=== ENV ==="
. /etc/os-release 2>/dev/null && echo "OS: ${PRETTY_NAME:-unknown}"
echo "node $(node --version), git $(git --version | awk '{print $3}')"
command -v claude >/dev/null 2>&1 && echo "claude CLI: present" || echo "claude CLI: absent (marketplace step should skip gracefully)"
EXPECT=$(manifestcount)
echo "manifest skills: $EXPECT"

# ── 1. Full install onto a fresh machine ────────────────────────────────────
scenario "fresh full install preserves local auth, applies profile"
H="$(mkhome)"
out="$(run "$H" install --yes)"
chk "all $EXPECT skills installed" "$(skillcount "$H")" "$EXPECT"
node -e '
const fs=require("fs"),p=process.argv[1];
const s=JSON.parse(fs.readFileSync(p+"/.claude/settings.json","utf8"));
const ok=(n,c)=>console.log((c?"  PASS ":"  FAIL ")+n);
ok("local ANTHROPIC_API_KEY preserved", s.env.ANTHROPIC_API_KEY==="LOCAL-KEY");
ok("local base URL preserved", s.env.ANTHROPIC_BASE_URL==="http://127.0.0.1:9999");
ok("user permissions untouched", JSON.stringify(s.permissions)===JSON.stringify({allow:["Bash(git:*)"]}));
ok("repo enabledPlugins applied", Object.keys(s.enabledPlugins||{}).length>0);
' "$H"
# count the node PASS/FAIL lines into the tally
np=$(node -e '
const fs=require("fs"),p=process.argv[1];
const s=JSON.parse(fs.readFileSync(p+"/.claude/settings.json","utf8"));
let f=0;
if(s.env.ANTHROPIC_API_KEY!=="LOCAL-KEY")f++;
if(s.env.ANTHROPIC_BASE_URL!=="http://127.0.0.1:9999")f++;
if(JSON.stringify(s.permissions)!==JSON.stringify({allow:["Bash(git:*)"]}))f++;
if(Object.keys(s.enabledPlugins||{}).length===0)f++;
console.log(f);
' "$H")
pass=$((pass+4-np)); fail=$((fail+np))
chk "CLAUDE.md installed (was absent)" "$([ -f "$H/.claude/CLAUDE.md" ] && echo yes || echo no)" "yes"
chk "backup dir created" "$([ -d "$H/.claude/backups/profile-install" ] && echo yes || echo no)" "yes"
rm -rf "$H"

# ── 2. Microsoft items filtered out ─────────────────────────────────────────
scenario "no Microsoft/work items leak into a fresh machine"
H="$(mkhome)"; run "$H" install --yes >/dev/null
ms=$(ls "$H/.claude/skills" 2>/dev/null | grep -cE '^(ado-|.*validate-build)' || true)
chk "no ado-* / validate-build skills" "$ms" "0"
rm -rf "$H"

# ── 3. Idempotency: second install changes nothing destructive ──────────────
scenario "install is idempotent (re-run leaves skills intact, no dupes)"
H="$(mkhome)"; run "$H" install --yes >/dev/null
first=$(skillcount "$H")
out2="$(run "$H" install --yes)"
chk "skill count stable on re-run" "$(skillcount "$H")" "$first"
chk "re-run reports existing skills" "$(echo "$out2" | grep -c 'exists')" "$( [ "$first" -gt 0 ] && echo "$first" || echo 0 )"
rm -rf "$H"

# ── 4. CLAUDE.md state: identical → skipped ─────────────────────────────────
scenario "CLAUDE.md identical → left untouched, no .incoming"
H="$(mkhome)"; cp "$REPO/profile/CLAUDE.md" "$H/.claude/CLAUDE.md"
out="$(run "$H" install --yes --only=claudemd)"
chk "reports identical" "$(echo "$out" | grep -c identical)" "1"
chk "no .incoming" "$([ -f "$H/.claude/CLAUDE.md.incoming" ] && echo yes || echo no)" "no"
rm -rf "$H"

# ── 5. CLAUDE.md state: differs → deterministic auto section-merge ───────────
scenario "CLAUDE.md differs → union merge keeps local rules, adds repo rules"
H="$(mkhome)"
printf '# Global Rules\n\n## Behavioral Rules\n\n- MY LOCAL RULE\n\n## Local Only\n\n- machine quirk\n' > "$H/.claude/CLAUDE.md"
out="$(run "$H" install --yes --only=claudemd)"
merged="$(cat "$H/.claude/CLAUDE.md")"
chk "local rule preserved" "$(echo "$merged" | grep -c 'MY LOCAL RULE')" "1"
chk "local-only section preserved" "$(echo "$merged" | grep -c 'Local Only')" "1"
chk "repo section merged in" "$(echo "$merged" | grep -c 'Completion Status')" "1"
chk "no stray .incoming (clean auto-merge)" "$([ -f "$H/.claude/CLAUDE.md.incoming" ] && echo yes || echo no)" "no"
chk "prints auto-merged cue" "$(echo "$out" | grep -c 'auto-merged')" "1"
chk "old CLAUDE.md backed up" "$(ls "$H/.claude/backups/profile-install/" 2>/dev/null | grep -c 'CLAUDE.md')" "1"
rm -rf "$H"

# ── 6. Selective install: --only=skills ─────────────────────────────────────
scenario "--only=skills installs skills, touches nothing else"
H="$(mkhome)"; before="$(cat "$H/.claude/settings.json")"
run "$H" install --yes --only=skills >/dev/null
chk "skills installed" "$([ "$(skillcount "$H")" -gt 0 ] && echo yes || echo no)" "yes"
chk "settings.json untouched" "$(cat "$H/.claude/settings.json")" "$before"
chk "CLAUDE.md not written" "$([ -f "$H/.claude/CLAUDE.md" ] && echo yes || echo no)" "no"
rm -rf "$H"

# ── 7. Selective install: --skip=skills ─────────────────────────────────────
scenario "--skip=skills applies everything except skills"
H="$(mkhome)"; run "$H" install --yes --skip=skills >/dev/null
chk "skills skipped" "$([ -d "$H/.claude/skills" ] && echo yes || echo no)" "no"
chk "CLAUDE.md still installed" "$([ -f "$H/.claude/CLAUDE.md" ] && echo yes || echo no)" "yes"
rm -rf "$H"

# ── 8. Unknown component key is warned, not fatal ───────────────────────────
scenario "--only=skills,bogus warns and still completes"
H="$(mkhome)"; out="$(run "$H" install --yes --only=skills,bogus)"
chk "warns about unknown key" "$(echo "$out" | grep -c 'ignoring unknown')" "1"
chk "still completes" "$(echo "$out" | grep -c 'Install complete')" "1"
rm -rf "$H"

# ── 9. --dry-run writes nothing ─────────────────────────────────────────────
scenario "--dry-run previews without writing"
H="$(mkhome)"; run "$H" install --dry-run >/dev/null
chk "no skills written" "$([ -d "$H/.claude/skills" ] && echo yes || echo no)" "no"
chk "no CLAUDE.md written" "$([ -f "$H/.claude/CLAUDE.md" ] && echo yes || echo no)" "no"
rm -rf "$H"

# ── 10. --force overwrites an existing skill ────────────────────────────────
scenario "--force overwrites a pre-existing skill dir"
H="$(mkhome)"
mkdir -p "$H/.claude/skills/caveman"; echo "STALE" > "$H/.claude/skills/caveman/SKILL.md"
run "$H" install --yes --only=skills --force >/dev/null
if grep -q STALE "$H/.claude/skills/caveman/SKILL.md" 2>/dev/null; then stale=yes; else stale=no; fi
chk "stale skill overwritten" "$stale" "no"
rm -rf "$H"

echo
echo "=== OFFLINE SCENARIOS: $pass passed, $fail failed ==="
[ "$fail" -eq 0 ]
