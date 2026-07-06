// lib/sync.mjs — capture machine config into the repo, filtering out Microsoft items.
// Diff-aware: computes what changed vs the repo and writes only selected changes.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  HOME, CLAUDE_DIR, CLAUDE_JSON, SETTINGS_JSON, AGENTS_LOCK, REPO, REPO_ROOT,
  readJson, writeJson, exists, loadFilter, classify, isGitWorkTree, C, hr, confirm,
  dirsEqual, diffMaps, selectItems, argListValue, argIdSet, readLineSync,
} from "./core.mjs";
import { commitAndPush, cloneToTemp } from "./git.mjs";

// settings.json env keys that are machine-local (auth/proxy) and must NOT be captured.
const ENV_DENY = new Set([
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
]);

// ---------- collectors ----------
// Every kept skill is VENDORED (content copied into the repo) so that one
// command reproduces the exact setup offline. For skills sourced from GitHub
// we also record the upstream hyperlink in the manifest as provenance —
// upstream repos get reorganized/deleted, so the link is attribution, not the
// install mechanism.
function collectSkills(filter) {
  const skillsDir = path.join(CLAUDE_DIR, "skills");
  const lock = readJson(AGENTS_LOCK, { skills: {} });
  const kept = [];       // {name, dir, source?, sourceUrl?, skillPath?}
  const excluded = [];   // {name, reason}

  if (!exists(skillsDir)) return { kept, excluded };

  for (const name of fs.readdirSync(skillsDir)) {
    const full = path.join(skillsDir, name);
    let isDir = false;
    try { isDir = fs.statSync(full).isDirectory(); } catch { continue; }
    if (!isDir) continue;

    const lockEntry = lock.skills?.[name];
    const haystack = lockEntry ? `${lockEntry.source} ${lockEntry.sourceUrl}` : "";
    const verdict = classify(name, filter, haystack);
    if (verdict.excluded) { excluded.push({ name, reason: verdict.reason }); continue; }

    kept.push({
      name,
      dir: full,
      source: lockEntry?.source,
      sourceUrl: lockEntry?.sourceUrl || (lockEntry?.source ? `https://github.com/${lockEntry.source}` : undefined),
    });
  }
  return { kept, excluded };
}

function collectPlugins(settings, filter) {
  const kept = {}, excluded = [];
  for (const [id, on] of Object.entries(settings.enabledPlugins || {})) {
    const verdict = classify(id, filter);
    if (verdict.excluded) { excluded.push({ name: id, reason: verdict.reason }); continue; }
    kept[id] = on;
  }
  const marketplaces = readJson(path.join(CLAUDE_DIR, "plugins", "known_marketplaces.json"), {});
  const keptMarkets = {};
  for (const [name, m] of Object.entries(marketplaces)) {
    const verdict = classify(name, filter, JSON.stringify(m.source || {}));
    if (verdict.excluded) { excluded.push({ name: `marketplace:${name}`, reason: verdict.reason }); continue; }
    keptMarkets[name] = m.source; // store just the source spec (repo), not local install path
  }
  return { enabledPlugins: kept, marketplaces: keptMarkets, excluded };
}

function collectMcp(filter) {
  const cj = readJson(CLAUDE_JSON, { mcpServers: {} });
  const kept = {}, excluded = [];
  for (const [name, spec] of Object.entries(cj.mcpServers || {})) {
    const verdict = classify(name, filter, JSON.stringify(spec));
    if (verdict.excluded) { excluded.push({ name, reason: verdict.reason }); continue; }
    kept[name] = spec;
  }
  return { servers: kept, excluded };
}

function collectSettings(filter) {
  const s = readJson(SETTINGS_JSON, {});
  const out = {};
  const dropped = [];

  // env: keep feature flags, drop auth/proxy.
  if (s.env) {
    out.env = {};
    for (const [k, v] of Object.entries(s.env)) {
      if (ENV_DENY.has(k)) { dropped.push(`env.${k}`); continue; }
      out.env[k] = v;
    }
  }
  // hooks: drop any whose matcher/command hits the MS filter.
  if (s.hooks) {
    out.hooks = {};
    for (const [event, arr] of Object.entries(s.hooks)) {
      const keptArr = [];
      for (const entry of arr) {
        const verdict = classify(entry.matcher || "", filter, JSON.stringify(entry));
        if (verdict.excluded) { dropped.push(`hook.${event}:${entry.matcher}`); continue; }
        keptArr.push(entry);
      }
      if (keptArr.length) out.hooks[event] = keptArr;
    }
    if (!Object.keys(out.hooks).length) delete out.hooks;
  }
  // Simple scalar/behavior prefs to carry over verbatim.
  for (const k of ["effortLevel", "autoUpdatesChannel", "skipDangerousModePermissionPrompt", "theme", "statusLine"]) {
    if (s[k] !== undefined) out[k] = s[k];
  }
  // enabledPlugins handled by collectPlugins; merged in later.
  return { settings: out, dropped };
}

// ---------- changeset ----------
// The components sync manages, in the same key vocabulary as install.
const COMPONENT_KEYS = ["skills", "plugins", "mcp", "settings", "claudemd"];

// Gather everything from the machine (already Microsoft-filtered).
function gather() {
  const filter = loadFilter();
  const skills = collectSkills(filter);
  const settingsRaw = readJson(SETTINGS_JSON, {});
  const plugins = collectPlugins(settingsRaw, filter);
  const mcp = collectMcp(filter);
  const { settings, dropped } = collectSettings(filter);
  return { skills, plugins, mcp, settings, dropped };
}

// Compare gathered machine state against what's already vendored in the repo.
// Item-level diff for skills/plugins/mcp; whole-file diff for settings/claudemd.
function buildChangeset(g) {
  // skills: identity by name; "changed" if vendored dir content differs.
  const machineSkills = Object.fromEntries(g.skills.kept.map((s) => [s.name, s]));
  const repoManifest = readJson(REPO.manifest, { skills: [] });
  const repoSkillNames = new Set((repoManifest.skills || []).map((s) => s.name));
  const skillCur = {};
  for (const n of repoSkillNames) skillCur[n] = true;
  const skillIncoming = {};
  for (const n of Object.keys(machineSkills)) skillIncoming[n] = true;
  const skills = diffMaps(skillIncoming, skillCur, (name) =>
    dirsEqual(machineSkills[name].dir, path.join(REPO.vendoredSkills, name)));

  // plugins: enabledPlugins map (id → bool).
  const repoSettings = readJson(REPO.settings, {});
  const plugins = diffMaps(g.plugins.enabledPlugins, repoSettings.enabledPlugins || {});

  // mcp: server name → spec.
  const repoMcp = readJson(REPO.mcp, { mcpServers: {} });
  const mcp = diffMaps(g.mcp.servers, repoMcp.mcpServers || {});

  // settings: whole-object compare (minus enabledPlugins, handled above).
  const { enabledPlugins: _repoEP, ...repoSettingsRest } = repoSettings;
  const incomingSettings = g.settings;
  const settingsChanged = JSON.stringify(incomingSettings) !== JSON.stringify(repoSettingsRest);

  // claudemd: byte compare of machine vs repo copy.
  const machineMd = path.join(CLAUDE_DIR, "CLAUDE.md");
  let claudemdChanged = false, claudemdState = "absent";
  if (exists(machineMd)) {
    if (!exists(REPO.claudeMd)) { claudemdChanged = true; claudemdState = "added"; }
    else {
      const a = fs.readFileSync(machineMd, "utf8"), b = fs.readFileSync(REPO.claudeMd, "utf8");
      claudemdChanged = a !== b;
      claudemdState = claudemdChanged ? "changed" : "unchanged";
    }
  }

  return { skills, plugins, mcp, settingsChanged, claudemdChanged, claudemdState };
}

// Flatten a component diff's actionable ids into prefixed ids ("skill:foo").
function actionable(kind, d) {
  return [...d.added, ...d.changed, ...d.removed].map((id) => `${kind}:${id}`);
}

function hasComponentChange(cs, key) {
  if (key === "skills") return cs.skills.added.length || cs.skills.changed.length || cs.skills.removed.length;
  if (key === "plugins") return cs.plugins.added.length || cs.plugins.changed.length || cs.plugins.removed.length;
  if (key === "mcp") return cs.mcp.added.length || cs.mcp.changed.length || cs.mcp.removed.length;
  if (key === "settings") return cs.settingsChanged;
  if (key === "claudemd") return cs.claudemdChanged;
  return false;
}

// Resolve which components are in scope from --only=/--skip= (default: all).
function resolveComponents() {
  const only = argListValue("only");
  const skip = argListValue("skip");
  if (only) return new Set(COMPONENT_KEYS.filter((k) => only.has(k)));
  if (skip) return new Set(COMPONENT_KEYS.filter((k) => !skip.has(k)));
  return new Set(COMPONENT_KEYS);
}

// ---------- review + write ----------
export function runSync() {
  const wantPush = process.argv.includes("--push");
  const wantJson = process.argv.includes("--json");

  // Detached case: `sync --push` from the npx cache (read-only, not a git work
  // tree). Clone the repo to a temp dir and re-run sync THERE so writes land in
  // a pushable clone. REPO_ROOT is derived from the script path, so invoking the
  // temp clone's profile.mjs retargets everything automatically.
  if (wantPush && !isGitWorkTree()) {
    console.log(hr("REMOTE SYNC  (machine → GitHub)"));
    const { dir, cleanup } = cloneToTemp();
    try {
      const passthru = ["--yes", "-y", "--dry-run", "--push", "--json"];
      const flags = process.argv.filter(
        (a) => passthru.includes(a) || /^--(only|skip|pick|drop)=/.test(a));
      execFileSync(process.execPath, ["profile.mjs", "sync", ...flags], { cwd: dir, stdio: "inherit" });
    } finally {
      cleanup();
    }
    return;
  }

  const g = gather();
  const cs = buildChangeset(g);
  const components = resolveComponents();

  // Item-level selection over actionable ids across in-scope components.
  const allActionable = [];
  if (components.has("skills")) allActionable.push(...actionable("skill", cs.skills));
  if (components.has("plugins")) allActionable.push(...actionable("plugin", cs.plugins));
  if (components.has("mcp")) allActionable.push(...actionable("mcp", cs.mcp));
  const pick = argIdSet("pick");
  const drop = argIdSet("drop");
  const selected = selectItems(allActionable, pick, drop);
  const isSel = (kind, id) => selected.has(`${kind}:${id}`);

  // ----- JSON changeset (for agent-driven interactive selection) -----
  if (wantJson) {
    const proj = (kind, d) => ({
      added: d.added, changed: d.changed, removed: d.removed, unchanged: d.unchanged,
    });
    console.log(JSON.stringify({
      components: [...components],
      skills: components.has("skills") ? proj("skill", cs.skills) : null,
      plugins: components.has("plugins") ? proj("plugin", cs.plugins) : null,
      mcp: components.has("mcp") ? proj("mcp", cs.mcp) : null,
      settings: components.has("settings") ? { changed: cs.settingsChanged } : null,
      claudemd: components.has("claudemd") ? { changed: cs.claudemdChanged, state: cs.claudemdState } : null,
      actionable: [...selected].sort(),
    }, null, 2));
    return;
  }

  // ----- print diff review -----
  console.log("\n" + hr("SYNC PREVIEW  (machine → repo, diff only)"));
  const line = (mark, s) => console.log("  " + mark + " " + s);
  const showItems = (title, kind, d, on) => {
    if (!on) { console.log(C.bold(`\n${title}:`) + C.dim("  (skipped)")); return; }
    console.log(C.bold(`\n${title}:`));
    let any = false;
    d.added.forEach((n) => { any = true; line(isSel(kind, n) ? C.green("+") : C.dim("·"), n + C.dim("  new")); });
    d.changed.forEach((n) => { any = true; line(isSel(kind, n) ? C.yellow("~") : C.dim("·"), n + C.dim("  changed")); });
    d.removed.forEach((n) => { any = true; line(isSel(kind, n) ? C.red("-") : C.dim("·"), n + C.dim("  removed from machine")); });
    if (!any) console.log(C.dim("  (no changes)"));
    else if (d.unchanged.length) console.log(C.dim(`  …and ${d.unchanged.length} unchanged`));
  };
  showItems("Skills", "skill", cs.skills, components.has("skills"));
  showItems("Plugins", "plugin", cs.plugins, components.has("plugins"));
  showItems("MCP servers", "mcp", cs.mcp, components.has("mcp"));
  console.log(C.bold("\nsettings.json:") + " " + (
    !components.has("settings") ? C.dim("(skipped)") :
    cs.settingsChanged ? C.yellow("~ changed") : C.dim("• unchanged")));
  console.log(C.bold("CLAUDE.md:") + " " + (
    !components.has("claudemd") ? C.dim("(skipped)") :
    cs.claudemdChanged ? C.yellow(`~ ${cs.claudemdState}`) : C.dim("• unchanged")));

  if (g.dropped.length) {
    console.log(C.bold(C.red("\nExcluded (Microsoft / machine-local):")));
    g.dropped.forEach((d) => console.log("  " + C.red("✗ ") + C.dim("settings  ") + d));
  }

  // Decide if there is anything to write at all.
  const willWriteSkills = components.has("skills") &&
    [...cs.skills.added, ...cs.skills.changed, ...cs.skills.removed].some((n) => isSel("skill", n));
  const willWritePlugins = components.has("plugins") &&
    [...cs.plugins.added, ...cs.plugins.changed, ...cs.plugins.removed].some((n) => isSel("plugin", n));
  const willWriteMcp = components.has("mcp") &&
    [...cs.mcp.added, ...cs.mcp.changed, ...cs.mcp.removed].some((n) => isSel("mcp", n));
  const willWriteSettings = components.has("settings") && cs.settingsChanged;
  const willWriteClaudemd = components.has("claudemd") && cs.claudemdChanged;
  const nothing = !(willWriteSkills || willWritePlugins || willWriteMcp || willWriteSettings || willWriteClaudemd);

  console.log("\n" + hr());
  if (nothing) {
    console.log(C.green("✓ Repo already matches the machine (for the selected scope). Nothing to write."));
    if (wantPush) console.log(C.dim("  Nothing to push."));
    return;
  }
  if (!confirm("Write the selected changes into the repo?", true)) {
    console.log(C.dim("Aborted. Nothing written."));
    return;
  }

  applyChangeset(g, cs, { isSel, components,
    willWriteSkills, willWritePlugins, willWriteMcp, willWriteSettings, willWriteClaudemd });

  // ----- optional: commit & push -----
  if (wantPush) {
    console.log(C.bold("\nPushing to GitHub:"));
    try {
      const r = commitAndPush(REPO_ROOT);
      if (!r.changed) console.log("  " + C.dim("• " + r.note + " — nothing to push"));
      else console.log("  " + C.green("✓ ") + `committed ${r.files} file(s) (${r.sha}) and pushed`);
    } catch (e) {
      console.log("  " + C.red("✗ ") + "push failed: " + (e.message || "").split("\n")[0]);
      console.log(C.dim("    Profile is written locally; commit/push manually."));
    }
  }
}

// Apply ONLY the selected changes. Skills are vendored incrementally (add/replace
// selected, remove selected-removed); manifest/settings/mcp are rebuilt from the
// resulting repo state so they stay internally consistent. generatedAt is only
// bumped when something actually changed.
function applyChangeset(g, cs, sel) {
  const machineSkills = Object.fromEntries(g.skills.kept.map((s) => [s.name, s]));

  // ----- skills: incremental vendor -----
  if (sel.willWriteSkills) {
    fs.mkdirSync(REPO.vendoredSkills, { recursive: true });
    for (const n of [...cs.skills.added, ...cs.skills.changed]) {
      if (!sel.isSel("skill", n)) continue;
      const dest = path.join(REPO.vendoredSkills, n);
      fs.rmSync(dest, { recursive: true, force: true });
      fs.cpSync(machineSkills[n].dir, dest, { recursive: true, dereference: true });
    }
    for (const n of cs.skills.removed) {
      if (!sel.isSel("skill", n)) continue;
      fs.rmSync(path.join(REPO.vendoredSkills, n), { recursive: true, force: true });
    }
  }

  // ----- manifest: reflect the vendored dirs actually present now -----
  // Start from existing manifest, apply selected skill add/change/remove.
  const prevManifest = readJson(REPO.manifest, { skills: [] });
  const skillMeta = new Map((prevManifest.skills || []).map((s) => [s.name, s]));
  if (sel.willWriteSkills) {
    for (const n of [...cs.skills.added, ...cs.skills.changed]) {
      if (!sel.isSel("skill", n)) continue;
      const s = machineSkills[n];
      skillMeta.set(n, { name: n, source: s.source, sourceUrl: s.sourceUrl });
    }
    for (const n of cs.skills.removed) {
      if (sel.isSel("skill", n)) skillMeta.delete(n);
    }
  }
  const skillsList = [...skillMeta.values()].sort((a, b) => a.name.localeCompare(b.name));

  // ----- plugins/enabledPlugins: apply selected plugin changes onto repo state -----
  const repoSettings = readJson(REPO.settings, {});
  const enabledPlugins = { ...(repoSettings.enabledPlugins || {}) };
  if (sel.willWritePlugins) {
    for (const id of [...cs.plugins.added, ...cs.plugins.changed]) {
      if (sel.isSel("plugin", id)) enabledPlugins[id] = g.plugins.enabledPlugins[id];
    }
    for (const id of cs.plugins.removed) {
      if (sel.isSel("plugin", id)) delete enabledPlugins[id];
    }
  }

  // ----- mcp: apply selected server changes onto repo state -----
  const repoMcp = readJson(REPO.mcp, { mcpServers: {} });
  const mcpServers = { ...(repoMcp.mcpServers || {}) };
  if (sel.willWriteMcp) {
    for (const id of [...cs.mcp.added, ...cs.mcp.changed]) {
      if (sel.isSel("mcp", id)) mcpServers[id] = g.mcp.servers[id];
    }
    for (const id of cs.mcp.removed) {
      if (sel.isSel("mcp", id)) delete mcpServers[id];
    }
  }

  // Manifest marketplaces: only refresh when plugins are in-scope and changed.
  const marketplaces = sel.willWritePlugins ? g.plugins.marketplaces : (prevManifest.plugins?.marketplaces || {});

  // Preserve generatedAt unless something changed (it did, since we got here).
  const manifest = {
    generatedAt: new Date().toISOString(),
    skills: skillsList,
    plugins: { marketplaces, enabled: enabledPlugins },
  };
  writeJson(REPO.manifest, manifest);

  // settings.json: whole-object only when in scope + changed.
  const baseSettings = sel.willWriteSettings ? g.settings : (() => {
    const { enabledPlugins: _ep, ...rest } = repoSettings; return rest;
  })();
  writeJson(REPO.settings, { ...baseSettings, enabledPlugins });
  writeJson(REPO.mcp, { mcpServers });

  // CLAUDE.md: copy only when selected + changed.
  if (sel.willWriteClaudemd) {
    const machineMd = path.join(CLAUDE_DIR, "CLAUDE.md");
    if (exists(machineMd)) fs.cpSync(machineMd, REPO.claudeMd);
  }

  console.log(C.green("\n✓ Selected changes written to repo."));
  const n = (arr, k) => arr.filter((x) => sel.isSel(k, x)).length;
  const parts = [];
  if (sel.willWriteSkills) parts.push(`skills +${n(cs.skills.added,"skill")}/~${n(cs.skills.changed,"skill")}/-${n(cs.skills.removed,"skill")}`);
  if (sel.willWritePlugins) parts.push(`plugins +${n(cs.plugins.added,"plugin")}/~${n(cs.plugins.changed,"plugin")}/-${n(cs.plugins.removed,"plugin")}`);
  if (sel.willWriteMcp) parts.push(`mcp +${n(cs.mcp.added,"mcp")}/~${n(cs.mcp.changed,"mcp")}/-${n(cs.mcp.removed,"mcp")}`);
  if (sel.willWriteSettings) parts.push("settings");
  if (sel.willWriteClaudemd) parts.push("CLAUDE.md");
  console.log(C.dim("  " + (parts.join(", ") || "no item changes")));
}
