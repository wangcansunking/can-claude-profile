# can-claude-profile

One-command capture and restore of my personal Claude Code setup — skills, plugins,
MCP servers, and `settings.json` — with **all Microsoft / work-internal items filtered out**.

Two directions, two commands:

| Command | Direction | What it does |
|---|---|---|
| **sync**    | machine → repo | Capture this machine's Claude config into the repo, filtering out Microsoft items. Shows a review before writing. |
| **install** | repo → machine | Apply the repo profile onto a machine. **Never** overwrites local auth/proxy or unrelated settings. |

```bash
# Pure Node — identical on Windows, macOS, and Linux (Node ships with Claude Code)
node profile.mjs sync       # capture current machine into the repo
node profile.mjs install    # set up a machine from the repo
```

**Install by prompt** — paste this into Claude Code and let the agent do it:

```text
Set up my Claude Code profile from github:wangcansunking/can-claude-profile —
read its install.md and run the install.
```

Claude reads [`install.md`](install.md), runs the installer (preferring the scripted path,
falling back to manual copy), and tells you to restart when done. No commands to remember.

**One line, no clone** (once this repo is on GitHub, public):

```bash
npx github:wangcansunking/can-claude-profile install     # set up this machine
npx github:wangcansunking/can-claude-profile sync --push # capture this machine → GitHub
```

npx fetches the repo — skill content travels with it — runs, and is gone. `sync --push`
clones to a temp dir, captures, commits, and pushes for you (the machine needs git push auth).

Flags: `--yes`/`-y` (skip prompts), `--dry-run` (preview, write nothing), `--force` (install: overwrite existing skills), `--only=`/`--skip=` (install & sync: pick components — `skills,settings,mcp,plugins,claudemd`), `--pick=`/`--drop=`/`--json` (sync: item-level diff selection).

**Pick what to install.** Run `install` interactively (no `--yes`) and it shows a numbered menu to exclude components. Or be explicit:

```bash
node profile.mjs install --only=skills,claudemd   # only these
node profile.mjs install --skip=plugins           # everything except plugins
```

**Sync is diff-aware and selectable.** `sync` compares the machine against the repo and writes **only what changed** — no churn on a no-op. Scope it by component, or pick individual changed items:

```bash
node profile.mjs sync --json                       # print the machine↔repo changeset (for agents)
node profile.mjs sync --only=skills                # capture only skill changes
node profile.mjs sync --pick=skill:foo,mcp:bar     # capture only these diff items
node profile.mjs sync --drop=plugin:baz --push     # capture everything except that plugin, then push
```

Run `sync` in a terminal with no flags and it shows the diff, then a **checkbox list** of the changed items (all checked; ↑/↓, space to toggle, `a` all/none, Enter to apply) — untick anything you don't want to push. Or ask Claude to "sync my setup, let me choose what to push" and it runs `--json`, presents the diff via a multi-select prompt, and applies exactly your selection.

**CLAUDE.md auto-merges.** If a global `~/.claude/CLAUDE.md` already exists and differs, install does a deterministic **section-by-section union** — every local rule is kept, repo rules are added, exact duplicates dropped, the old file backed up. No blind overwrite, no manual merge on the normal path.

Optional local alias: `npm install -g .` once, then `can-claude-profile sync` / `can-claude-profile install` from anywhere.

---

## What's captured

- **Skills** — every skill in `~/.claude/skills/` is **vendored** (content copied into [`profile/skills/`](profile/skills)) so a new machine reproduces them exactly, offline. For skills originally from GitHub, the upstream link is recorded in [`profile/manifest.json`](profile/manifest.json) as provenance.
  > Why vendor instead of re-fetching from GitHub? Upstream repos get reorganized. At build time, `mattpocock/skills` had already moved/removed `caveman`, `write-a-skill`, `zoom-out` and renamed `diagnose` — a link-only install would have silently lost them. Vendoring is the source of truth; the link is attribution.
- **Plugins** — enabled plugins + their marketplaces ([`profile/manifest.json`](profile/manifest.json)). Install runs `claude plugin marketplace add` and writes `enabledPlugins`.
- **MCP servers** — non-Microsoft global servers from `~/.claude.json` ([`profile/mcp.json`](profile/mcp.json)). *(Currently empty — all of my MCP servers are Microsoft.)*
- **settings.json** — behavior/feature prefs ([`profile/settings.json`](profile/settings.json)): `effortLevel`, `theme`, `statusLine`, `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`, model, auto-compact, etc.
- **CLAUDE.md** — global `~/.claude/CLAUDE.md`, if one exists.

## What's filtered out

The Microsoft filter ([`filter.config.json`](filter.config.json)) excludes:

- **Keywords** (token-matched, case-insensitive): `microsoft`, `azure`, `ado`, `m365`, `o365`, `office`, `workiq`, `metagraph`, `foundry`, `substrate`, `outlook`, `exchange`.
- **Denylist** (exact names with no telltale keyword): `validate-build`.
- **Always machine-local** (never captured): `ANTHROPIC_BASE_URL`, `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, and any hook whose matcher hits the filter (e.g. the `metagraph` confirm-write hook).

Token matching means `ado` filters `ado-auto-work` and `azure-devops` but **not** `aradotso/trending-skills` (the `ui-ux-pro-max-skill` source). Tune anytime by editing `filter.config.json`:

- `allow` — exact names to keep even if a keyword matches (highest priority).
- `deny` — exact names to always drop.
- `keywords` — add compound tokens (e.g. `azuredevops`) if a vendor concatenates words.

`sync` always prints a full **review** of kept vs. excluded items and waits for confirmation, so a false match never slips through silently.

## Safety properties

- **install never clobbers local auth.** Machine `env` values win over repo values, so a new machine's `ANTHROPIC_API_KEY` / proxy URL are preserved. Repo only *fills gaps* and sets behavior prefs.
- **install is additive for skills.** Existing skills are left untouched unless you pass `--force`.
- **Backups.** Before modifying `settings.json` or `~/.claude.json`, the previous file is copied to `~/.claude/backups/profile-install/`.
- **MCP merge is additive.** Existing servers with the same name are kept, not overwritten.

## Repo layout

```
profile.mjs            entry point  (sync | install) — pure Node, cross-platform
filter.config.json     Microsoft filter (keywords / deny / allow)
lib/
  core.mjs             paths, filter logic, JSON I/O, prompts
  sync.mjs             machine → repo
  install.mjs          repo → machine
profile/               the captured profile (committed)
  manifest.json        skills (+ provenance links) & plugins
  settings.json        behavior/feature prefs + enabledPlugins
  mcp.json             non-MS MCP servers
  skills/              vendored skill content (source of truth)
  CLAUDE.md            global CLAUDE.md, if present
```

## Requirements

Node 18+ (ships with Claude Code) and `git`. The `claude` CLI on PATH is only needed for the plugin-marketplace step. Being a pure Node script, it runs identically on Windows (PowerShell, Git Bash, or cmd), macOS, and Linux — no shell or execution-policy setup.
