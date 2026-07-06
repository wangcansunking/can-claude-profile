#!/usr/bin/env bash
# test/e2e/sync.sh — e2e for diff-aware, selectable sync. Operates on a THROWAWAY
# copy of the repo and a fake HOME, so neither the real repo nor ~/.claude is touched.
set -uo pipefail
cd "$(dirname "$0")/../.."
SRC="$PWD"

pass=0; fail=0
chk(){ if [ "$2" = "$3" ]; then echo "  PASS $1"; pass=$((pass+1)); else echo "  FAIL $1 (want '$3' got '$2')"; fail=$((fail+1)); fi; }
scenario(){ echo; echo "── SCENARIO: $1"; }
strip(){ sed 's/\x1b\[[0-9;]*m//g'; }

# A throwaway repo copy (only the bits sync reads/writes) + fake machine HOME.
# We seed the machine skills/settings/mcp FROM the repo's own vendored profile so
# a baseline sync is a genuine no-op, then mutate the machine to create diffs.
setup(){
  local root; root="$(mktemp -d)"
  local repo="$root/repo" home="$root/home"
  mkdir -p "$repo/lib" "$repo/profile" "$home/.claude/skills"
  cp "$SRC"/profile.mjs "$repo/"
  cp "$SRC"/lib/*.mjs "$repo/lib/"
  cp "$SRC"/filter.config.json "$repo/" 2>/dev/null || true
  cp "$SRC"/package.json "$repo/" 2>/dev/null || true
  cp -r "$SRC"/profile/. "$repo/profile/"
  # Seed machine skills = repo's vendored skills (baseline identical).
  cp -r "$SRC"/profile/skills/. "$home/.claude/skills/"
  # Seed machine settings.json = repo settings + a local auth key that must be filtered.
  node -e '
    const fs=require("fs"),p=process.argv;
    const s=JSON.parse(fs.readFileSync(p[1],"utf8"));
    const out=Object.assign({},s);
    out.env=Object.assign({ANTHROPIC_API_KEY:"LOCAL"},s.env||{});
    fs.writeFileSync(p[2],JSON.stringify(out,null,2));
  ' "$SRC/profile/settings.json" "$home/.claude/settings.json"
  # Seed machine .claude.json mcp = repo mcp.
  node -e '
    const fs=require("fs"),p=process.argv;
    const m=JSON.parse(fs.readFileSync(p[1],"utf8"));
    fs.writeFileSync(p[2],JSON.stringify({mcpServers:m.mcpServers||{}},null,2));
  ' "$SRC/profile/mcp.json" "$home/.claude.json"
  # known_marketplaces + agents lock (empty-ish) so collectors don't error.
  mkdir -p "$home/.claude/plugins"; echo '{}' > "$home/.claude/plugins/known_marketplaces.json"
  mkdir -p "$home/.agents"; echo '{"skills":{}}' > "$home/.agents/.skill-lock.json"
  cp "$SRC/profile/CLAUDE.md" "$home/.claude/CLAUDE.md" 2>/dev/null || true
  echo "$root"
}
sync(){ local home="$1" repo="$2"; shift 2; HOME="$home" USERPROFILE="$home" node "$repo/profile.mjs" sync "$@" 2>&1 | strip; }

# ── 1. Baseline: machine mirrors repo → sync is a no-op ─────────────────────
scenario "no diff → nothing to write"
R="$(setup)"; H="$R/home"; RE="$R/repo"
out="$(sync "$H" "$RE" --yes)"
chk "reports already matches" "$(echo "$out" | grep -c 'already matches')" "1"
# profile/ in the throwaway repo must be byte-identical to source profile/
if diff -rq "$SRC/profile" "$RE/profile" >/dev/null 2>&1; then eq=yes; else eq=no; fi
chk "repo profile untouched" "$eq" "yes"
rm -rf "$R"

# ── 2. JSON changeset shape on a no-op ──────────────────────────────────────
scenario "--json emits a changeset with empty actionable on no-op"
R="$(setup)"; H="$R/home"; RE="$R/repo"
js="$(sync "$H" "$RE" --json)"
chk "actionable is empty []" "$(echo "$js" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).actionable.length))')" "0"
chk "has components list" "$(echo "$js" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).components.length))')" "5"
rm -rf "$R"

# ── 3. New machine skill → shows as added, only that item written ───────────
scenario "add one machine skill → diff shows 1 added; sync vendors only it"
R="$(setup)"; H="$R/home"; RE="$R/repo"
mkdir -p "$H/.claude/skills/zzz-new-skill"
printf -- '---\nname: zzz-new-skill\ndescription: test\n---\nbody\n' > "$H/.claude/skills/zzz-new-skill/SKILL.md"
js="$(sync "$H" "$RE" --json)"
chk "zzz-new-skill in added" "$(echo "$js" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).skills.added.includes("zzz-new-skill")))')" "true"
sync "$H" "$RE" --yes >/dev/null
chk "new skill vendored into repo" "$([ -f "$RE/profile/skills/zzz-new-skill/SKILL.md" ] && echo yes || echo no)" "yes"
chk "manifest lists new skill" "$(node -e 'const m=require(process.argv[1]);console.log(m.skills.some(x=>x.name==="zzz-new-skill"))' "$RE/profile/manifest.json")" "true"
# an unrelated vendored skill stays byte-identical (no churn)
some="$(ls "$SRC/profile/skills" | head -1)"
if diff -rq "$SRC/profile/skills/$some" "$RE/profile/skills/$some" >/dev/null 2>&1; then eq=yes; else eq=no; fi
chk "unrelated skill unchanged (no churn)" "$eq" "yes"
rm -rf "$R"

# ── 4. --pick applies only the chosen item of several ───────────────────────
scenario "two new skills, --pick one → only that one is written"
R="$(setup)"; H="$R/home"; RE="$R/repo"
for n in aaa-skill bbb-skill; do
  mkdir -p "$H/.claude/skills/$n"; printf -- '---\nname: %s\n---\nx\n' "$n" > "$H/.claude/skills/$n/SKILL.md"
done
sync "$H" "$RE" --yes --pick=skill:aaa-skill >/dev/null
chk "picked skill written" "$([ -d "$RE/profile/skills/aaa-skill" ] && echo yes || echo no)" "yes"
chk "unpicked skill NOT written" "$([ -d "$RE/profile/skills/bbb-skill" ] && echo yes || echo no)" "no"
rm -rf "$R"

# ── 5. --only=skills ignores an MCP-only change ─────────────────────────────
scenario "--only=skills leaves mcp.json untouched even when machine mcp changed"
R="$(setup)"; H="$R/home"; RE="$R/repo"
# add a machine mcp server AND a skill; scope to skills only
node -e 'const fs=require("fs"),p=process.argv[1];const j=JSON.parse(fs.readFileSync(p,"utf8"));j.mcpServers=j.mcpServers||{};j.mcpServers["new-server"]={command:"x"};fs.writeFileSync(p,JSON.stringify(j,null,2))' "$H/.claude.json"
mkdir -p "$H/.claude/skills/ccc-skill"; printf -- '---\nname: ccc-skill\n---\ny\n' > "$H/.claude/skills/ccc-skill/SKILL.md"
before="$(cat "$RE/profile/mcp.json")"
sync "$H" "$RE" --yes --only=skills >/dev/null
chk "skill written under --only=skills" "$([ -d "$RE/profile/skills/ccc-skill" ] && echo yes || echo no)" "yes"
chk "mcp.json untouched under --only=skills" "$(cat "$RE/profile/mcp.json")" "$before"
rm -rf "$R"

# ── 6. Microsoft/local items never captured on a real diff ──────────────────
scenario "local ANTHROPIC_API_KEY never lands in repo settings"
R="$(setup)"; H="$R/home"; RE="$R/repo"
# force a settings change so settings.json is rewritten
node -e 'const fs=require("fs"),p=process.argv[1];const s=JSON.parse(fs.readFileSync(p,"utf8"));s.theme="dark";fs.writeFileSync(p,JSON.stringify(s,null,2))' "$H/.claude/settings.json"
sync "$H" "$RE" --yes --only=settings >/dev/null
chk "repo settings has no API key" "$(node -e 'const s=require(process.argv[1]);console.log(!!(s.env&&s.env.ANTHROPIC_API_KEY))' "$RE/profile/settings.json")" "false"
chk "theme change captured" "$(node -e 'console.log(require(process.argv[1]).theme)' "$RE/profile/settings.json")" "dark"
rm -rf "$R"

# ── 7. Non-TTY safe fallback: piped stdin (no TTY) keeps all changed items ──
# The interactive checkbox needs a real TTY; when stdin is piped, sync falls
# back to "keep all" so unattended/piped runs never silently drop changes.
scenario "non-TTY stdin → all changed items written (safe fallback)"
R="$(setup)"; H="$R/home"; RE="$R/repo"
for n in aaa-skill bbb-skill; do
  mkdir -p "$H/.claude/skills/$n"; printf -- '---\nname: %s\n---\nx\n' "$n" > "$H/.claude/skills/$n/SKILL.md"
done
echo "" | HOME="$H" USERPROFILE="$H" node "$RE/profile.mjs" sync >/dev/null 2>&1
chk "aaa-skill written" "$([ -d "$RE/profile/skills/aaa-skill" ] && echo yes || echo no)" "yes"
chk "bbb-skill written" "$([ -d "$RE/profile/skills/bbb-skill" ] && echo yes || echo no)" "yes"
rm -rf "$R"

# ── 8. Item exclusion via --drop (the unattended way to deselect) ───────────
scenario "--drop excludes one changed item, keeps the rest"
R="$(setup)"; H="$R/home"; RE="$R/repo"
for n in ccc-skill ddd-skill; do
  mkdir -p "$H/.claude/skills/$n"; printf -- '---\nname: %s\n---\nx\n' "$n" > "$H/.claude/skills/$n/SKILL.md"
done
sync "$H" "$RE" --yes --drop=skill:ccc-skill >/dev/null
chk "dropped item NOT written" "$([ -d "$RE/profile/skills/ccc-skill" ] && echo yes || echo no)" "no"
chk "kept item written" "$([ -d "$RE/profile/skills/ddd-skill" ] && echo yes || echo no)" "yes"
rm -rf "$R"

echo
echo "=== SYNC E2E: $pass passed, $fail failed ==="
[ "$fail" -eq 0 ]
