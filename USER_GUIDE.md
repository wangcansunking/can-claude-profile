# User Guide — can-claude-profile

Capture your personal Claude Code setup into this repo, and restore it on any machine —
each with **one command**. Microsoft / work-internal items are filtered out automatically.

Everything is a **pure Node script** (`profile.mjs`). Node ships with Claude Code, so the
exact same command works on **Windows, macOS, and Linux** — no bash, no PowerShell setup,
no `chmod`, no execution-policy tweaks.

---

## The two commands

```bash
node profile.mjs sync       # 1) export: this machine → repo
node profile.mjs install    # 2) import: repo → this machine
```

That's it. Run them from the repo root in any terminal (PowerShell, Git Bash, cmd, macOS/Linux shell).

> Prefer typing less? See [Optional: a shorter command](#optional-a-shorter-command) at the bottom.

---

## Scenario A — set up a brand-new machine

You want your skills, plugins, and settings on a fresh machine. Two ways:

### A1 — One line, no clone (via GitHub + npx)

Once this repo is on GitHub (public), install onto any machine without cloning:

```bash
npx -p github:<your-username>/can-claude-profile ccprofile-install
```

npx fetches the repo (skill content travels with it), runs the installer, and is gone.
Add `--yes` to skip the prompt. This is the closest thing to "GitHub dist" — nothing is
permanently installed, and it works the same on Windows, macOS, and Linux.

> Only **install** works remotely this way. **sync** (capturing changes back) must run from
> a local clone, because it writes into the repo and you'll want to `git commit` the result —
> and npx's copy is a throwaway, read-only cache.

### A2 — Clone, then install

```bash
git clone <this-repo> can-claude-profile
cd can-claude-profile
node profile.mjs install
```

Either way, after it finishes:

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
node profile.mjs sync
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
node profile.mjs sync --dry-run      # see what WOULD be captured
node profile.mjs install --yes       # unattended install
node profile.mjs install --force     # re-install skills, overwriting local copies
```

---

## Platform notes

All three platforms run the identical command — `node profile.mjs <sync|install>`.

- **Windows** — works in PowerShell 7, Windows PowerShell 5.1, Git Bash, and cmd. `%USERPROFILE%\.claude` is resolved automatically. No execution-policy change needed (it's a Node script, not a `.ps1`).
- **macOS / Linux** — works in any shell.
- **Requirement** — Node 18+ (bundled with Claude Code) and `git`. The `claude` CLI on PATH is only needed for the plugin-marketplace step; without it, skills and settings still install and you'll see a friendly `skip(no claude CLI)`.

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

Run `node profile.mjs sync --dry-run` after editing to confirm the kept/excluded lists look right.

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
bash test/run.sh            # quick: node+git only
bash test/run.sh --withcli  # full: also installs the real claude CLI
```

Expect `=== 13 passed, 0 failed ===`. (These test scripts stay as bash because they only
ever run inside the Linux container — your actual profile commands are pure Node.)

---

## Optional: a shorter command

If you'd rather type `can-claude-profile sync` from anywhere instead of `node profile.mjs sync`:

```bash
npm install -g .      # run once, from the repo root
```

Then, in any directory:

```bash
can-claude-profile sync
can-claude-profile install
```

This is purely a convenience alias — it runs the same `profile.mjs` under the hood.

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `! marketplace … skip(no claude CLI)` | The `claude` CLI isn't on PATH. Skills/settings still installed; install the CLI and re-run, or add marketplaces manually. |
| Plugins not active after install | **Restart Claude Code** — plugins load at startup. |
| A skill I want got excluded | It matched a filter keyword. Add its exact name to `allow` in `filter.config.json`, re-run `node profile.mjs sync`. |
| A work item leaked into the repo | Add a keyword or its exact name to `deny` in `filter.config.json`, re-run `node profile.mjs sync`. |
| Install overwrote nothing / skills already there | By design. Use `node profile.mjs install --force` to overwrite. |
| Want to undo a settings change | Restore from `~/.claude/backups/profile-install/`. |
