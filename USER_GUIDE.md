# User Guide — can-claude-profile

Capture your personal Claude Code setup into this repo, and restore it on any machine —
each with **one command**. Microsoft / work-internal items are filtered out automatically.

---

## The two commands

```bash
# 1) Update the repo FROM this machine   (export / "sync")
./sync.sh

# 2) Install the repo ONTO a machine     (import / "install")
./install.sh
```

PowerShell equivalents: `.\sync.ps1` and `.\install.ps1`.
No bash/pwsh? `node profile.mjs sync` and `node profile.mjs install` work anywhere Node does.

---

## Scenario A — set up a brand-new machine

You've cloned this repo onto a fresh laptop and want your skills, plugins, and settings.

```bash
git clone <this-repo> can-claude-profile
cd can-claude-profile
./install.sh
```

You'll see a preview, then a confirmation prompt. After it finishes:

```
✓ Install complete.  Restart Claude Code to pick up plugins & MCP servers.
```

**Then restart Claude Code.** Skills work immediately; plugins and MCP servers load on restart.

What it does — and does **not** — touch:
- ✅ Installs all skills into `~/.claude/skills/`.
- ✅ Adds plugin marketplaces and enables your plugins.
- ✅ Applies behavior settings (theme, effort, agent-teams flag, model, …).
- 🔒 **Keeps** any existing local auth on that machine (`ANTHROPIC_API_KEY`, proxy URL) — never overwritten.
- 🔒 **Keeps** skills already present (won't clobber) unless you pass `--force`.
- 💾 Backs up `settings.json` to `~/.claude/backups/profile-install/` first.

---

## Scenario B — you changed your setup; save it to the repo

You installed a new skill or toggled a plugin and want the repo to reflect it.

```bash
./sync.sh
```

You'll get a **review** like this before anything is written:

```
Skills — vendored into repo (link kept as provenance):
  ✓ caveman      ← mattpocock/skills
  ✓ tdd          ← mattpocock/skills
  ...
Plugins kept:
  ✓ frontend-design@claude-plugins-official
  ...
Excluded (Microsoft / machine-local):
  ✗ skill    ado-auto-work        (keyword "ado")
  ✗ mcp      azure                (keyword "azure")
  ✗ settings env.ANTHROPIC_API_KEY (machine-local/MS)
```

Confirm, and the repo's `profile/` is updated. Then commit:

```bash
git add -A && git commit -m "Update profile"
```

---

## Flags

| Flag | Works with | Effect |
|---|---|---|
| `--yes`, `-y` | both | Skip the confirmation prompt (for scripts/CI). |
| `--dry-run` | both | Show the preview and write **nothing**. |
| `--force` | install | Overwrite skills that already exist on the machine. |

Examples:
```bash
./sync.sh --dry-run      # see what WOULD be captured
./install.sh --yes       # unattended install
./install.sh --force     # re-install skills, overwriting local copies
```

---

## Tuning the Microsoft filter

Edit [`filter.config.json`](filter.config.json):

```json
{
  "keywords": ["microsoft","azure","ado","m365","workiq","metagraph", "..."],
  "deny":     ["validate-build"],
  "allow":    []
}
```

- **keywords** — token-matched, case-insensitive. `ado` matches `ado-auto-work` and `azure-devops`, but *not* `aradotso`. Add compound tokens (e.g. `azuredevops`) if a name jams words together.
- **deny** — exact names to always exclude, even with no telltale keyword.
- **allow** — exact names to always keep, even if a keyword matches (wins over everything).

Run `./sync.sh --dry-run` after editing to confirm the kept/excluded lists look right.

---

## What lives where (after a sync)

```
profile/
  manifest.json    skills (+ GitHub provenance links) and plugins
  settings.json    behavior/feature prefs + which plugins are enabled
  mcp.json         non-Microsoft MCP servers
  skills/          full skill content — the source of truth, works offline
  CLAUDE.md        your global CLAUDE.md (only if you have one)
```

> **Why is skill content copied in, not just linked?** Upstream skill repos get
> reorganized and things disappear. Vendoring the content guarantees a new machine
> gets *exactly* what you have today, even offline. The GitHub link is kept in
> `manifest.json` so you always know where each skill came from.

---

## Verifying it works (optional)

Reproduce the import in a throwaway Ubuntu container — your machine is untouched:

```bash
./test/run.sh            # quick: node+git only
./test/run.sh --withcli  # full: also installs the real claude CLI
```

Expect `=== 13 passed, 0 failed ===`.

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `! marketplace … skip(no claude CLI)` | The `claude` CLI isn't on PATH. Skills/settings still installed; install the CLI and re-run, or add marketplaces manually. |
| Plugins not active after install | **Restart Claude Code** — plugins load at startup. |
| A skill I want got excluded | It matched a filter keyword. Add its exact name to `allow` in `filter.config.json`, re-run `./sync.sh`. |
| A work item leaked into the repo | Add a keyword or its exact name to `deny` in `filter.config.json`, re-run `./sync.sh`. |
| Install overwrote nothing / skills already there | By design. Use `./install.sh --force` to overwrite. |
| Want to undo a settings change | Restore from `~/.claude/backups/profile-install/`. |
