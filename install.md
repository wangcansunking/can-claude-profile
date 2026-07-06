# install.md — for the Claude Code agent

You (Claude Code) are being asked to install the **can-claude-profile** onto this machine.
This profile is a personal Claude Code setup — skills, plugins, MCP servers, `settings.json`,
and global `CLAUDE.md`, with all Microsoft / work-internal items already filtered out.

Follow these steps. Prefer the scripted path; fall back to manual only if the script cannot run.

## What this does (say this to the user first)

- **Additive and safe.** It never overwrites local auth/proxy (`ANTHROPIC_API_KEY`,
  `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`) or unrelated settings. Existing skills are
  left untouched unless the user asks to overwrite (`--force`).
- **Backups.** Before it modifies `settings.json` or `~/.claude.json`, the previous file is
  copied to `~/.claude/backups/profile-install/`.
- Ask the user to confirm before running. If they said "just install it" / "-y", skip the prompt.

## Preferred path — run the installer (no clone needed)

Run this from any directory. It fetches the repo from GitHub, installs, and cleans up:

```bash
npx -y github:wangcansunking/can-claude-profile install --yes
```

- **Let the user choose what to install.** Before running, ask which components they want:
  **skills, settings, mcp, plugins, claudemd** (global CLAUDE.md). If they want a subset,
  pass it through — the installer accepts `--only=` and `--skip=`:
  ```bash
  npx -y github:wangcansunking/can-claude-profile install --yes --only=skills,claudemd
  npx -y github:wangcansunking/can-claude-profile install --yes --skip=plugins
  ```
  If they want everything, omit both flags. (Run without `--yes` for an interactive picker.)
- Add `--force` only if the user wants existing skills overwritten.
- **CLAUDE.md is auto-merged.** If a global `~/.claude/CLAUDE.md` already exists and differs,
  the installer does a deterministic **section-by-section union merge** — every local rule is
  kept, repo rules are added, exact duplicates are dropped, and the old file is backed up.
  Nothing is clobbered; you don't need to merge by hand unless it reports an auto-merge failure.
- If `npx` cannot reach GitHub but the repo is already cloned locally, `cd` into it and run:
  ```bash
  node profile.mjs install --yes            # or add --only= / --skip=
  ```

## If the scripted path fails — manual fallback

Only if neither `npx` nor a local clone works. Clone the repo to a temp dir and copy by hand:

```bash
git clone --depth 1 https://github.com/wangcansunking/can-claude-profile <tmp>
```

Then, from `<tmp>/profile/`, into `~/.claude/` (Windows: `%USERPROFILE%\.claude\`):

1. **Skills** — copy each folder in `profile/skills/` to `~/.claude/skills/` (skip any that already exist unless the user wants them replaced).
2. **CLAUDE.md** — if `profile/CLAUDE.md` exists: when the user has no global `~/.claude/CLAUDE.md`, copy it. If one exists and differs, **union-merge by section** — keep every local rule, add repo rules, drop exact duplicates; never clobber. Back up the old file first.
3. **settings.json** — merge `profile/settings.json` keys into `~/.claude/settings.json`. **Never** copy `env` auth keys listed above; machine values always win.
4. **MCP servers** — merge entries from `profile/mcp.json` into `~/.claude.json` additively (keep existing servers with the same name).
5. **Plugins** — for each plugin in `profile/manifest.json`, run `claude plugin marketplace add <marketplace>` then enable it. Skip with a friendly note if the `claude` CLI is not on PATH.

Back up any file before you overwrite it, into `~/.claude/backups/profile-install/`.

## Finish

Report an explicit status, then tell the user:

> **Restart Claude Code** to load plugins and MCP servers. Skills and settings take effect immediately.
