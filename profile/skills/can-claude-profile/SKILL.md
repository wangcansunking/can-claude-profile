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
- Flags: `--yes` (skip prompts), `--dry-run` (preview only), `--force` (install: overwrite existing skills), `--push` (sync: commit + push).
- If `claude` isn't on PATH the marketplace step prints `skip(no claude CLI)`; skills and settings still install. Install the CLI and re-run to add marketplaces.

## What install merges automatically (don't redo these by hand)

- **settings.json** — deep-merged. Machine `env` wins over repo (local auth/proxy preserved); repo sets behavior prefs and `enabledPlugins`. Backed up first.
- **Skills** — additive. Existing skills untouched unless `--force`.
- **MCP servers** — additive; same-named servers kept.
- **CLAUDE.md** — installed only if absent; if identical, skipped.

## The one thing you handle: a CLAUDE.md conflict

When install finds a **different** `~/.claude/CLAUDE.md`, it does NOT overwrite. It writes
the repo version to `~/.claude/CLAUDE.md.incoming` and prints `! differs from local`.
That's your cue to do a **content-aware merge** — the whole point of using this skill
instead of a blind `cp`.

Merge procedure:

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
