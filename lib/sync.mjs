// lib/sync.mjs — capture machine config into the repo, filtering out Microsoft items.
import fs from "node:fs";
import path from "node:path";
import {
  HOME, CLAUDE_DIR, CLAUDE_JSON, SETTINGS_JSON, AGENTS_LOCK, REPO,
  readJson, writeJson, exists, loadFilter, classify, C, hr, confirm,
} from "./core.mjs";

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

// ---------- review + write ----------
export function runSync() {
  const filter = loadFilter();

  const skills = collectSkills(filter);
  const settingsRaw = readJson(SETTINGS_JSON, {});
  const plugins = collectPlugins(settingsRaw, filter);
  const mcp = collectMcp(filter);
  const { settings, dropped } = collectSettings(filter);

  // ----- print review -----
  console.log("\n" + hr("SYNC PREVIEW  (machine → repo)"));
  console.log(C.bold("\nSkills — vendored into repo (link kept as provenance):"));
  skills.kept.forEach((s) =>
    console.log("  " + C.green("✓ ") + s.name + (s.source ? C.dim(`  ← ${s.source}`) : C.dim("  (local)"))));
  console.log(C.bold("\nPlugins kept:"));
  Object.keys(plugins.enabledPlugins).forEach((p) => console.log("  " + C.green("✓ ") + p));
  console.log(C.bold("\nMCP servers kept:"));
  const mcpNames = Object.keys(mcp.servers);
  if (mcpNames.length) mcpNames.forEach((m) => console.log("  " + C.green("✓ ") + m));
  else console.log(C.dim("  (none — all filtered out)"));

  console.log(C.bold(C.red("\nExcluded (Microsoft / machine-local):")));
  const allExcluded = [
    ...skills.excluded.map((e) => ["skill", e.name, e.reason]),
    ...plugins.excluded.map((e) => ["plugin", e.name, e.reason]),
    ...mcp.excluded.map((e) => ["mcp", e.name, e.reason]),
    ...dropped.map((d) => ["settings", d, "machine-local/MS"]),
  ];
  allExcluded.forEach(([kind, name, reason]) =>
    console.log("  " + C.red("✗ ") + `${C.dim(kind.padEnd(8))} ${name}  ${C.dim("(" + reason + ")")}`));

  console.log("\n" + hr());
  if (!confirm("Write this profile into the repo?", true)) {
    console.log(C.dim("Aborted. Nothing written."));
    return;
  }

  // ----- vendor all kept skills (content is the source of truth) -----
  fs.rmSync(REPO.vendoredSkills, { recursive: true, force: true });
  for (const s of skills.kept) {
    const dest = path.join(REPO.vendoredSkills, s.name);
    fs.cpSync(s.dir, dest, { recursive: true, dereference: true });
  }

  // ----- build manifest -----
  const manifest = {
    generatedAt: new Date().toISOString(),
    skills: skills.kept.map((s) => ({ name: s.name, source: s.source, sourceUrl: s.sourceUrl })),
    plugins: {
      marketplaces: plugins.marketplaces,
      enabled: plugins.enabledPlugins,
    },
  };
  writeJson(REPO.manifest, manifest);
  writeJson(REPO.settings, { ...settings, enabledPlugins: plugins.enabledPlugins });
  writeJson(REPO.mcp, { mcpServers: mcp.servers });

  // ----- CLAUDE.md (only if it exists on machine) -----
  const machineMd = path.join(CLAUDE_DIR, "CLAUDE.md");
  if (exists(machineMd)) fs.cpSync(machineMd, REPO.claudeMd);

  console.log(C.green("\n✓ Profile written to repo."));
  console.log(C.dim(`  ${skills.kept.length} skills vendored, ${Object.keys(plugins.enabledPlugins).length} plugins, ${mcpNames.length} mcp servers`));
}
