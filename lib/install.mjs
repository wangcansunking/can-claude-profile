// lib/install.mjs — apply the repo profile onto this machine.
// Non-destructive: never overwrites local auth/proxy env or unrelated settings.
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import {
  CLAUDE_DIR, CLAUDE_JSON, SETTINGS_JSON, REPO,
  readJson, writeJson, exists, C, hr, confirm,
} from "./core.mjs";

function backup(file) {
  if (!exists(file)) return;
  const dir = path.join(CLAUDE_DIR, "backups", "profile-install");
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  fs.cpSync(file, path.join(dir, `${path.basename(file)}.${stamp}.bak`));
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

  console.log("\n" + hr("INSTALL PREVIEW  (repo → machine)"));
  console.log(C.dim(`  skills: ${(manifest.skills?.length || 0)} (vendored in repo)`));
  console.log(C.dim(`  plugins: ${Object.keys(manifest.plugins?.enabled || {}).length}, marketplaces: ${Object.keys(manifest.plugins?.marketplaces || {}).length}`));
  console.log(C.dim(`  mcp servers: ${Object.keys(repoMcp.mcpServers || {}).length}`));
  console.log(C.dim(`  settings.json: merged (local auth/env preserved)`));
  console.log("\n" + hr());
  if (!confirm("Apply this profile to the current machine?", true)) {
    console.log(C.dim("Aborted. Nothing changed."));
    return;
  }

  console.log(C.bold("\nSkills:"));
  const skillResults = installSkills(manifest);
  for (const r of skillResults) {
    const mark = r.status === "error" ? C.red("✗") : r.status === "exists" ? C.dim("•") : C.green("✓");
    console.log(`  ${mark} ${r.name} ${C.dim(r.status)}${r.note ? C.dim(" — " + r.note) : ""}`);
  }

  console.log(C.bold("\nSettings:"));
  mergeSettings(repoSettings);
  console.log("  " + C.green("✓ ") + "merged into ~/.claude/settings.json " + C.dim("(backup saved)"));

  const mcpRes = mergeMcp(repoMcp);
  if (mcpRes.added.length || mcpRes.skipped.length) {
    console.log(C.bold("\nMCP:"));
    mcpRes.added.forEach((n) => console.log("  " + C.green("✓ ") + n + C.dim(" added")));
    mcpRes.skipped.forEach((n) => console.log("  " + C.dim("• " + n + " already present")));
  }

  console.log(C.bold("\nPlugins / marketplaces:"));
  const pluginResults = [];
  installMarketplaces(manifest, pluginResults);
  if (!pluginResults.length) console.log(C.dim("  (none)"));
  for (const [kind, name, status] of pluginResults) {
    const mark = status === "error" ? C.red("✗") : status.startsWith("skip") ? C.yellow("!") : C.green("✓");
    console.log(`  ${mark} ${C.dim(kind)} ${name} ${C.dim(status)}`);
  }
  console.log(C.dim("  enabledPlugins written to settings.json; restart Claude Code to load them."));

  // CLAUDE.md — three states: absent → install; identical → skip; differs → stage for merge.
  if (exists(REPO.claudeMd)) {
    const dest = path.join(CLAUDE_DIR, "CLAUDE.md");
    console.log(C.bold("\nCLAUDE.md:"));
    if (!exists(dest)) {
      fs.cpSync(REPO.claudeMd, dest);
      console.log("  " + C.green("✓ installed"));
    } else {
      const a = fs.readFileSync(REPO.claudeMd, "utf8");
      const b = fs.readFileSync(dest, "utf8");
      if (a.trim() === b.trim()) {
        console.log("  " + C.dim("• identical, left untouched"));
      } else {
        // Don't guess — stage the repo version next to the local one and let
        // the `can-claude-profile` skill do a content-aware merge.
        const incoming = dest + ".incoming";
        fs.cpSync(REPO.claudeMd, incoming);
        console.log("  " + C.yellow("! differs from local — staged repo version for merge"));
        console.log(C.dim(`    local:    ${dest}`));
        console.log(C.dim(`    incoming: ${incoming}`));
        console.log(C.dim("    → run the can-claude-profile skill (or merge by hand), then delete the .incoming file"));
      }
    }
  }

  console.log(C.green("\n✓ Install complete.") + C.dim("  Restart Claude Code to pick up plugins & MCP servers."));
}
