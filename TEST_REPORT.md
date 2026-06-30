# Test Report — can-claude-profile

**Date:** 2026-06-30
**Scope:** Verify two-way one-command sync — export (this machine → repo) and import (repo → fresh machine) — with the Microsoft filter applied. Functionality complete, tests pass, UX clean.

---

## Summary

| Test | Environment | Result |
|---|---|---|
| Export capture + filter | Host (Windows, real `~/.claude`) | ✅ Pass |
| Export fidelity (round-trip) | Host | ✅ 24 machine skills → 4 MS filtered → 20 in repo, exact match |
| Import (no claude CLI) | Ubuntu 24.04 container | ✅ 13/13 checks, exit 0 |
| Import (with real claude CLI) | Ubuntu 24.04 container | ✅ 13/13 checks, marketplaces added, exit 0 |
| Local-auth preservation | Both containers | ✅ Local API key & proxy survive import |
| Microsoft filtering | All | ✅ 0 MS skills / MCP / hooks leak through |

**Overall: PASS.** No known defects.

---

## How it was tested

### Export (machine → repo)
Run on the host against the real `~/.claude`:

```bash
node profile.mjs sync --yes
```

- Captured **20 non-Microsoft skills** (vendored, with multi-file content intact — e.g. `tdd/mocking.md`, `diagnose/scripts/hitl-loop.template.sh`).
- Captured **16 plugins** + 3 marketplaces, **settings** (behavior/feature prefs), and **0 MCP servers** (all 4 are Microsoft → correctly filtered).
- **Round-trip fidelity check:** machine has 24 skill dirs; 4 are Microsoft (`ado-auto-work`, `ado-code-review`, `ado-create-pr`, `validate-build`); repo contains exactly the other 20. Sets match exactly.

### Import (repo → fresh machine)
Run in a **clean Ubuntu 24.04 Docker container** (nothing pre-installed but node + git), seeded with a fake local auth key to prove non-clobber:

```bash
./test/run.sh            # minimal env — no claude CLI
./test/run.sh --withcli  # full env — real claude CLI installed
```

13 automated assertions (`test/verify.sh`):

```
PASS 20 skills installed (20)
PASS caveman present (lost upstream, survived via vendor)
PASS write-a-skill present
PASS zoom-out present
PASS local ANTHROPIC_API_KEY preserved
PASS local ANTHROPIC_BASE_URL preserved
PASS repo AGENT_TEAMS flag applied
PASS repo model applied
PASS user permissions untouched
PASS 16 plugins enabled
PASS no Microsoft skill (ado-*)
PASS no validate-build skill
PASS backup created

=== 13 passed, 0 failed ===
```

With the real `claude` CLI present, the marketplace step additionally reported:

```
✓ marketplace claude-plugins-official added
✓ marketplace claude-code-plugins added
✓ marketplace claude-hud added
```

and the registration was confirmed in the container's `~/.claude/plugins/known_marketplaces.json` (3 entries, 3 plugin dirs fetched).

---

## Key findings & decisions

### 1. Link-only skill install is unreliable — vendoring was required
The original plan recorded each skill's GitHub source and re-fetched on import. Testing against the live `mattpocock/skills` repo showed it had been **reorganized**: `caveman`, `write-a-skill`, `zoom-out` were gone and `diagnose` was renamed to `diagnosing-bugs`. A link-only import would have **silently lost 3 skills you use**.

**Resolution:** vendor full skill content into `profile/skills/` as the source of truth; keep the GitHub link in `manifest.json` as provenance only. The container tests explicitly assert the three "lost-upstream" skills survive.

### 2. Token-boundary filtering prevents false positives
A naïve substring filter for `ado` excluded `ui-ux-pro-max-skill` because its source is `ar**ado**tso/trending-skills`. Switched to token-boundary matching (`ado` matches `ado-auto-work` and `azure-devops`, not `aradotso`). The pre-write **review** in `sync` is what surfaced this.

### 3. Non-clobbering import protects local auth
Your machines use a local proxy (`ANTHROPIC_BASE_URL=127.0.0.1`, a local key). Import merges so that **machine `env` values always win** — verified in-container: the seeded `CONTAINER-LOCAL-KEY` and proxy URL survived, while repo-only behavior flags (agent-teams, model) were applied and unrelated user settings (`permissions`) were untouched.

### 4. UX polish
- `sync`/`install` print a full **review** (kept vs. excluded with reasons) and confirm before writing; `--yes`, `--dry-run`, `--force` supported.
- Missing `claude` CLI is reported as a friendly `! skip(no claude CLI)` rather than a scary error — skills and settings still apply.
- `settings.json` and `~/.claude.json` are backed up to `~/.claude/backups/profile-install/` before any change.

---

## What reviewers should check manually

1. **The exclusion list matches your intent** — see `sync` output / [USER_GUIDE.md](USER_GUIDE.md). Currently excluded: skills `ado-*` + `validate-build`; MCP `workiq`, `azure`, `azure-devops`, `metagraph`; env `ANTHROPIC_BASE_URL`/`ANTHROPIC_API_KEY`; the `metagraph` hook.
2. **Plugin load after restart** — import writes `enabledPlugins` and adds marketplaces, but Claude Code must be **restarted** to load them. (Containers can't run interactive Claude, so this is the one step not auto-verified.)
3. **Reproduce it yourself:** `./test/run.sh --withcli`.

---

## Environment

- Host: Windows 11, Node (system), Docker 29.5.3
- Container: `ubuntu:24.04`, Node 18.19.1, git 2.43.0, claude-code 2.1.196 (withcli variant)
