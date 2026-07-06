---
name: can-claude-profile
description: "Use when installing, syncing, or merging a can-claude-profile Claude Code setup (skills, plugins, MCP, settings, global CLAUDE.md) onto or from a machine — especially when a CLAUDE.md conflict needs an intelligent, content-aware merge rather than a blind overwrite."
---

# can-claude-profile

Capture and restore a personal Claude Code setup with one command, filtering out
Microsoft/work-internal items. The heavy lifting is a pure-Node script
(`profile.mjs`); your job is to run it, react to what it reports, and handle the one
thing a script shouldn't guess at: **merging CLAUDE.md when it differs**.

Repo: https://github.com/wangcansunking/can-claude-profile

## Two directions

```bash
node profile.mjs install    # repo → this machine  (apply the profile here)
node profile.mjs sync       # this machine → repo  (capture; add --push to commit+push)
```

- Run from a local clone. Or remotely, no clone:
  `npx github:wangcansunking/can-claude-profile install`
- Flags: `--yes` (skip prompts), `--dry-run` (preview only), `--force` (install: overwrite existing skills), `--push` (sync: commit + push), `--only=`/`--skip=` (install & sync: pick components), `--pick=`/`--drop=`/`--json` (sync: item-level diff selection).
- If `claude` isn't on PATH the marketplace step prints `skip(no claude CLI)`; skills and settings still install. Install the CLI and re-run to add marketplaces.

## Letting the user pick what to install

Install applies five components: **skills, settings, mcp, plugins, claudemd**. By default all are applied. To install a subset, pass either flag (comma-separated keys):

```bash
node profile.mjs install --only=skills,claudemd   # ONLY these
node profile.mjs install --skip=plugins,mcp       # everything EXCEPT these
```

Run interactively (no `--yes`) and the installer prints a numbered menu so the user can exclude components by number. When a user asks to "just install the skills" or "don't touch my settings", translate that to the right `--only`/`--skip` flag rather than editing files by hand.

## Prompt-triggered selective sync (machine → repo)

`sync` is **diff-aware**: it compares the machine against what's already vendored in the repo and writes **only what changed**, so re-running it produces no churn. It takes the same `--only=`/`--skip=` component flags as install, plus **item-level** selection.

When a user asks to "sync / capture / save my setup" — especially with any hint of choosing what to push ("only the new skills", "don't push MCP") — drive it like this:

1. **Compute the diff as JSON** (never write yet):
   ```bash
   node profile.mjs sync --json
   ```
   The output has per-component `added` / `changed` / `removed` / `unchanged` lists and a flat `actionable` array of prefixed ids (`skill:foo`, `plugin:bar`, `mcp:baz`).
2. **If nothing is actionable**, tell the user the repo already matches — done.
3. **Otherwise present the diff and let the user choose**, using the `AskUserQuestion` tool (multi-select) with one option per actionable item (or per component when the list is long). Ask about one component at a time; don't dump everything inline.
4. **Apply exactly their choice** by passing the selected ids:
   ```bash
   node profile.mjs sync --yes --pick=skill:foo,mcp:baz      # ONLY these diff items
   node profile.mjs sync --yes --drop=plugin:bar             # all diff items EXCEPT these
   node profile.mjs sync --yes --only=skills                 # whole component only
   ```
   Add `--push` to commit + push in the same run.

Rules:
- `--pick` and `--drop` take the exact prefixed ids from the `--json` `actionable` list. `--pick` restricts to the listed ids; `--drop` subtracts them; `--only`/`--skip` scope whole components first.
- Item selection is available for **skills, plugins, mcp**. `settings` and `claudemd` are whole-file, toggled at the component level via `--only`/`--skip`.
- Never hand-edit files under `profile/` to capture machine state — always go through `sync` so filtering, vendoring, and the manifest stay consistent.
- Running `sync` with no selection flags (interactively) shows the diff preview, then prints a **numbered menu of the changed items** so the user can exclude any by number (Enter = keep all) before a final write confirmation — the same pick-by-number UX as install's component menu, but at item level. Use flags (`--pick`/`--drop`/`--only`) for unattended runs.

## What install merges automatically (don't redo these by hand)

- **settings.json** — deep-merged. Machine `env` wins over repo (local auth/proxy preserved); repo sets behavior prefs and `enabledPlugins`. Backed up first.
- **Skills** — additive. Existing skills untouched unless `--force`.
- **MCP servers** — additive; same-named servers kept.
- **CLAUDE.md** — absent → installed; identical → skipped; **differs → auto section-merge** (union by `## ` heading; every local rule kept, repo rules added, exact duplicates dropped, old file backed up). No manual step needed on the normal path.

## CLAUDE.md: only step in if auto-merge fails

The installer now merges `~/.claude/CLAUDE.md` automatically and deterministically. You only
intervene in the rare case it prints **`! auto-merge failed … — staged repo version`** and
leaves a `~/.claude/CLAUDE.md.incoming` file. Then do a content-aware merge by hand:

1. Read both files fully: `~/.claude/CLAUDE.md` (local) and `~/.claude/CLAUDE.md.incoming` (repo).
2. Merge by **section** (`## Heading`), not by line:
   - Keep every section that exists in only one file.
   - For sections in both, union the bullet rules and **de-duplicate** ones that say the same thing. When two bullets conflict in wording, prefer the incoming (repo) phrasing — it's the curated source — unless the local one is clearly more specific to this machine.
   - Preserve the local file's section order; append genuinely new sections at the end.
3. Never drop a rule the user added locally just because it isn't in the repo. Merge is a **union**, not a replace.
4. Show the user a short diff summary (which sections/bullets you added, which you dropped as duplicates) and confirm before writing.
5. Write the merged result to `~/.claude/CLAUDE.md`, then delete `~/.claude/CLAUDE.md.incoming`.
6. Offer to sync the merged file back: if the machine's now-merged CLAUDE.md should become the new source of truth, run `node profile.mjs sync` (it captures `~/.claude/CLAUDE.md` into the repo), else leave the repo as-is.

If there is no `.incoming` file, there is no conflict — nothing to merge.

## Installing prerequisites

Node ships with Claude Code, so `profile.mjs` always runs. Only two optional tools matter:

- **git** — needed for `sync --push` and for `npx github:` installs. If missing, install it (winget/apt/brew) and retry.
- **claude CLI** — needed only to add plugin marketplaces. If `skip(no claude CLI)` appears and the user wants plugins active, install `@anthropic-ai/claude-code` globally and re-run install.

Don't install anything the current task doesn't need. If a step reports a missing tool, name the one-line install command for the user's platform and proceed with what does work.

## Tuning the Microsoft filter

`sync` excludes Microsoft/work items via `filter.config.json` (`keywords` / `deny` / `allow`, token-matched). If the user says something was wrongly excluded or leaked, edit that file and re-run `node profile.mjs sync --dry-run` to confirm the kept/excluded lists before writing.

## After install

Tell the user to **restart Claude Code** — plugins and MCP servers load at startup; skills and CLAUDE.md apply on next session.
