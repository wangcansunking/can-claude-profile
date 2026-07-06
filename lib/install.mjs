// lib/install.mjs — apply the repo profile onto this machine.
// Non-destructive: never overwrites local auth/proxy env or unrelated settings.
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import {
  CLAUDE_DIR, CLAUDE_JSON, SETTINGS_JSON, REPO,
  readJson, writeJson, exists, C, hr, confirm, mergeClaudeMd, argListValue, readLineSync,
} from "./core.mjs";

function backup(file) {
  if (!exists(file)) return;
  const dir = path.join(CLAUDE_DIR, "backups", "profile-install");
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  fs.cpSync(file, path.join(dir, `${path.basename(file)}.${stamp}.bak`));
}

// The installable components, in apply order. Each has a stable key (used by
// --only / --skip and the interactive picker) and a human label.
const COMPONENTS = [
  { key: "skills", label: "Skills (vendored)" },
  { key: "settings", label: "settings.json (behavior prefs, local auth preserved)" },
  { key: "mcp", label: "MCP servers" },
  { key: "plugins", label: "Plugins / marketplaces" },
  { key: "claudemd", label: "Global CLAUDE.md (auto section-merge)" },
];
const COMPONENT_KEYS = COMPONENTS.map((c) => c.key);

// Decide which components to install from --only=/--skip= flags, or an
// interactive picker when neither flag is given and we have a TTY.
// Precedence: --only wins; else start from all and subtract --skip; else prompt.
function resolveComponents() {
  const only = argListValue("only");
  const skip = argListValue("skip");
  const nonInteractive =
    process.argv.includes("--yes") || process.argv.includes("-y") || process.argv.includes("--dry-run");

  if (only) {
    const bad = [...only].filter((k) => !COMPONENT_KEYS.includes(k));
    if (bad.length) console.log(C.yellow(`  (ignoring unknown --only items: ${bad.join(", ")})`));
    return new Set(COMPONENT_KEYS.filter((k) => only.has(k)));
  }
  if (skip) {
    const bad = [...skip].filter((k) => !COMPONENT_KEYS.includes(k));
    if (bad.length) console.log(C.yellow(`  (ignoring unknown --skip items: ${bad.join(", ")})`));
    return new Set(COMPONENT_KEYS.filter((k) => !skip.has(k)));
  }
  if (nonInteractive) return new Set(COMPONENT_KEYS); // default: everything

  // Interactive picker: show a numbered list; user enters numbers to toggle off,
  // or Enter to accept all.
  console.log(C.bold("\nSelect components to install") + C.dim("  (Enter = all; or type numbers to EXCLUDE, e.g. 3 5)"));
  COMPONENTS.forEach((c, i) => console.log(`  ${C.cyan(String(i + 1))}. ${c.label}`));
  process.stdout.write(C.yellow("? ") + "Exclude which? ");
  const line = readLineSync();
  if (line === null || !line.trim()) return new Set(COMPONENT_KEYS);
  const drop = new Set(
    line.split(/[,\s]+/).map((s) => parseInt(s, 10)).filter((n) => n >= 1 && n <= COMPONENTS.length)
  );
  return new Set(COMPONENTS.filter((_, i) => !drop.has(i + 1)).map((c) => c.key));
}

// CLAUDE.md — four states: absent → install; identical → skip; differs → auto
// section-merge (union, de-duplicated) with backup; merge failure → stage .incoming.
function installClaudeMd() {
  if (!exists(REPO.claudeMd)) return;
  const dest = path.join(CLAUDE_DIR, "CLAUDE.md");
  console.log(C.bold("\nCLAUDE.md:"));
  if (!exists(dest)) {
    fs.mkdirSync(CLAUDE_DIR, { recursive: true });
    fs.cpSync(REPO.claudeMd, dest);
    console.log("  " + C.green("✓ installed"));
    return;
  }
  const incoming = fs.readFileSync(REPO.claudeMd, "utf8");
  const local = fs.readFileSync(dest, "utf8");
  if (incoming.trim() === local.trim()) {
    console.log("  " + C.dim("• identical, left untouched"));
    return;
  }
  try {
    const { merged, addedSections, addedLines } = mergeClaudeMd(local, incoming);
    if (merged.trim() === local.trim()) {
      console.log("  " + C.dim("• local already covers the repo version — left untouched"));
      return;
    }
    backup(dest);
    fs.writeFileSync(dest, merged);
    console.log("  " + C.green("✓ auto-merged") + C.dim(" (union by section; local rules preserved, backup saved)"));
    for (const [h, n] of Object.entries(addedLines)) console.log(C.dim(`    + ${n} rule(s) into "${h}"`));
    for (const h of addedSections) console.log(C.dim(`    + new section "${h}"`));
  } catch (e) {
    // Never guess destructively — fall back to staging for a manual/skill merge.
    const stage = dest + ".incoming";
    fs.cpSync(REPO.claudeMd, stage);
    console.log("  " + C.yellow("! auto-merge failed (" + (e.message || "error") + ") — staged repo version"));
    console.log(C.dim(`    local:    ${dest}`));
    console.log(C.dim(`    incoming: ${stage}`));
    console.log(C.dim("    → run the can-claude-profile skill (or merge by hand), then delete the .incoming file"));
  }
}

// All kept skills are vendored in the repo, so install just copies them.
// Existing skills on the machine are left untouched (use --force to overwrite).
function installSkills(manifest) {
  const destRoot = path.join(CLAUDE_DIR, "skills");
  fs.mkdirSync(destRoot, { recursive: true });
  const force = process.argv.includes("--force");
  const results = [];

  for (const skill of manifest.skills || []) {
    const name = skill.name;
    const src = path.join(REPO.vendoredSkills, name);
    const dest = path.join(destRoot, name);
    if (!exists(src)) { results.push({ name, status: "error", note: "missing in repo" }); continue; }
    if (exists(dest) && !force) { results.push({ name, status: "exists" }); continue; }
    if (exists(dest)) fs.rmSync(dest, { recursive: true, force: true });
    fs.cpSync(src, dest, { recursive: true });
    results.push({ name, status: "installed" });
  }
  return results;
}

// Deep-merge repo settings into machine settings without clobbering existing
// env keys (auth/proxy stay as the machine has them).
function mergeSettings(repoSettings) {
  const machine = readJson(SETTINGS_JSON, {});
  backup(SETTINGS_JSON);
  const out = { ...machine };

  // env: repo values fill gaps; machine wins on conflict (protects local auth).
  out.env = { ...(repoSettings.env || {}), ...(machine.env || {}) };

  // enabledPlugins: union, repo turns things on.
  out.enabledPlugins = { ...(machine.enabledPlugins || {}), ...(repoSettings.enabledPlugins || {}) };

  // hooks: union by event; repo hooks appended if not already present (by matcher).
  out.hooks = { ...(machine.hooks || {}) };
  for (const [event, arr] of Object.entries(repoSettings.hooks || {})) {
    const have = out.hooks[event] || [];
    const haveMatchers = new Set(have.map((h) => h.matcher));
    out.hooks[event] = [...have, ...arr.filter((h) => !haveMatchers.has(h.matcher))];
  }
  if (!Object.keys(out.hooks).length) delete out.hooks;

  // scalar prefs: repo wins (these are the user's chosen defaults).
  for (const k of ["effortLevel", "autoUpdatesChannel", "skipDangerousModePermissionPrompt", "theme", "statusLine"]) {
    if (repoSettings[k] !== undefined) out[k] = repoSettings[k];
  }
  writeJson(SETTINGS_JSON, out);
}

function mergeMcp(repoMcp) {
  const servers = repoMcp.mcpServers || {};
  if (!Object.keys(servers).length) return { added: [], skipped: [] };
  const cj = readJson(CLAUDE_JSON, {});
  backup(CLAUDE_JSON);
  cj.mcpServers = cj.mcpServers || {};
  const added = [], skipped = [];
  for (const [name, spec] of Object.entries(servers)) {
    if (cj.mcpServers[name]) { skipped.push(name); continue; }
    cj.mcpServers[name] = spec;
    added.push(name);
  }
  writeJson(CLAUDE_JSON, cj);
  return { added, skipped };
}

function installMarketplaces(manifest, results) {
  const entries = Object.entries(manifest.plugins?.marketplaces || {});
  if (!entries.length) return;
  // If the claude CLI isn't on PATH, skip gracefully (skills/settings still apply).
  let hasClaude = true;
  try { execSync("claude --version", { stdio: "pipe" }); } catch { hasClaude = false; }
  if (!hasClaude) {
    for (const [name] of entries) results.push(["marketplace", name, "skip(no claude CLI)"]);
    return;
  }
  for (const [name, source] of entries) {
    if (!source || source.source !== "github") { results.push(["marketplace", name, "skip(non-github)"]); continue; }
    try {
      // execSync (shell) so Windows resolves the `claude` shell-script shim on PATH.
      execSync(`claude plugin marketplace add ${source.repo}`, { stdio: "pipe" });
      results.push(["marketplace", name, "added"]);
    } catch (e) {
      const msg = (e.stderr?.toString() || e.message || "").split("\n")[0];
      results.push(["marketplace", name, /already|exists/i.test(msg) ? "exists" : "error"]);
    }
  }
}

export function runInstall() {
  if (!exists(REPO.manifest)) {
    console.log(C.red("No profile found in repo. Run sync first."));
    return;
  }
  const manifest = readJson(REPO.manifest);
  const repoSettings = readJson(REPO.settings, {});
  const repoMcp = readJson(REPO.mcp, { mcpServers: {} });

  const picked = resolveComponents();
  const on = (k) => picked.has(k);
  const mark = (k) => (on(k) ? C.green("✓") : C.dim("·"));

  console.log("\n" + hr("INSTALL PREVIEW  (repo → machine)"));
  console.log(`  ${mark("skills")} skills: ${(manifest.skills?.length || 0)} (vendored in repo)`);
  console.log(`  ${mark("plugins")} plugins: ${Object.keys(manifest.plugins?.enabled || {}).length}, marketplaces: ${Object.keys(manifest.plugins?.marketplaces || {}).length}`);
  console.log(`  ${mark("mcp")} mcp servers: ${Object.keys(repoMcp.mcpServers || {}).length}`);
  console.log(`  ${mark("settings")} settings.json: merged (local auth/env preserved)`);
  console.log(`  ${mark("claudemd")} CLAUDE.md: auto section-merge`);
  if (picked.size === 0) {
    console.log("\n" + C.yellow("Nothing selected. Nothing to do."));
    return;
  }
  console.log("\n" + hr());
  if (!confirm("Apply the selected components to the current machine?", true)) {
    console.log(C.dim("Aborted. Nothing changed."));
    return;
  }

  if (on("skills")) {
    console.log(C.bold("\nSkills:"));
    const skillResults = installSkills(manifest);
    for (const r of skillResults) {
      const m = r.status === "error" ? C.red("✗") : r.status === "exists" ? C.dim("•") : C.green("✓");
      console.log(`  ${m} ${r.name} ${C.dim(r.status)}${r.note ? C.dim(" — " + r.note) : ""}`);
    }
  }

  if (on("settings")) {
    console.log(C.bold("\nSettings:"));
    mergeSettings(repoSettings);
    console.log("  " + C.green("✓ ") + "merged into ~/.claude/settings.json " + C.dim("(backup saved)"));
  }

  if (on("mcp")) {
    const mcpRes = mergeMcp(repoMcp);
    if (mcpRes.added.length || mcpRes.skipped.length) {
      console.log(C.bold("\nMCP:"));
      mcpRes.added.forEach((n) => console.log("  " + C.green("✓ ") + n + C.dim(" added")));
      mcpRes.skipped.forEach((n) => console.log("  " + C.dim("• " + n + " already present")));
    }
  }

  if (on("plugins")) {
    console.log(C.bold("\nPlugins / marketplaces:"));
    const pluginResults = [];
    installMarketplaces(manifest, pluginResults);
    if (!pluginResults.length) console.log(C.dim("  (none)"));
    for (const [kind, name, status] of pluginResults) {
      const m = status === "error" ? C.red("✗") : status.startsWith("skip") ? C.yellow("!") : C.green("✓");
      console.log(`  ${m} ${C.dim(kind)} ${name} ${C.dim(status)}`);
    }
    console.log(C.dim("  enabledPlugins written to settings.json; restart Claude Code to load them."));
  }

  if (on("claudemd")) installClaudeMd();

  console.log(C.green("\n✓ Install complete.") + C.dim("  Restart Claude Code to pick up plugins & MCP servers."));
}
