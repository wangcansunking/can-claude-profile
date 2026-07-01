// lib/core.mjs — shared brain for sync (machine -> repo) and install (repo -> machine).
// Pure Node, no external deps. Works under Git Bash, PowerShell, cmd.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import process from "node:process";

// ---------- paths ----------
export const HOME = os.homedir();
export const CLAUDE_DIR = path.join(HOME, ".claude");
export const CLAUDE_JSON = path.join(HOME, ".claude.json"); // global mcpServers live here
export const SETTINGS_JSON = path.join(CLAUDE_DIR, "settings.json");
export const AGENTS_LOCK = path.join(HOME, ".agents", ".skill-lock.json");

// Repo root = parent of this file's dir.
export const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
export const REPO = {
  root: REPO_ROOT,
  manifest: path.join(REPO_ROOT, "profile", "manifest.json"),
  settings: path.join(REPO_ROOT, "profile", "settings.json"),
  mcp: path.join(REPO_ROOT, "profile", "mcp.json"),
  claudeMd: path.join(REPO_ROOT, "profile", "CLAUDE.md"),
  vendoredSkills: path.join(REPO_ROOT, "profile", "skills"),
  filterConfig: path.join(REPO_ROOT, "filter.config.json"),
};

// Is REPO_ROOT a real git work tree we can commit into? (npx runs from a
// read-only, non-git package cache, where this is false.)
export function isGitWorkTree(dir = REPO_ROOT) {
  return exists(path.join(dir, ".git"));
}

// The canonical git URL to clone/push when running detached (from npx cache).
export function repoUrl() {
  const pkg = readJson(path.join(REPO_ROOT, "package.json"), {});
  const raw = pkg.repository?.url || "";
  return raw.replace(/^git\+/, "").replace(/\.git$/, "") + ".git";
}

// ---------- json io ----------
export function readJson(file, fallback = undefined) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));  } catch (e) {
    if (fallback !== undefined) return fallback;
    throw new Error(`Cannot read JSON ${file}: ${e.message}`);
  }
}

export function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 2) + "\n");
}

export function exists(p) {
  try { fs.accessSync(p); return true; } catch { return false; }
}

// ---------- filter ----------
export function loadFilter() {
  const cfg = readJson(REPO.filterConfig, { keywords: [], deny: [], allow: [] });
  const keywords = (cfg.keywords || []).map((k) => k.toLowerCase());
  const deny = new Set(cfg.deny || []);
  const allow = new Set(cfg.allow || []);
  return { keywords, deny, allow };
}

// Returns { excluded: bool, reason: string }
// Keywords match on token boundaries (split on non-alphanumerics), so "ado"
// matches "ado-auto-work" / "azure-devops" but NOT "aradotso" or "adobe".
// Add compound forms (e.g. "azuredevops") to filter.config if a vendor
// concatenates words into a single token.
export function classify(name, filter, extraHaystack = "") {
  if (filter.allow.has(name)) return { excluded: false, reason: "allow-listed" };
  if (filter.deny.has(name)) return { excluded: true, reason: "deny-listed" };
  const tokens = new Set((name + " " + extraHaystack).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  for (const kw of filter.keywords) {
    if (tokens.has(kw)) return { excluded: true, reason: `keyword "${kw}"` };
  }
  return { excluded: false, reason: "" };
}

// ---------- console helpers ----------
export const C = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

export function hr(label = "") {
  const line = "─".repeat(Math.max(4, 56 - label.length));
  return label ? `${C.dim("──")} ${C.bold(label)} ${C.dim(line)}` : C.dim("─".repeat(60));
}

// Synchronous y/n prompt via /dev/stdin fallback to readline.
export function confirm(question, defaultYes = false) {
  if (process.argv.includes("--yes") || process.argv.includes("-y")) return true;
  if (process.argv.includes("--dry-run")) return false;
  const suffix = defaultYes ? " [Y/n] " : " [y/N] ";
  process.stdout.write(C.yellow("? ") + question + suffix);
  let answer = "";
  try {
    const buf = Buffer.alloc(1);
    let s = "";
    // Read a line from fd 0 synchronously.
    while (true) {
      const n = fs.readSync(0, buf, 0, 1, null);
      if (n === 0) break;
      const ch = buf.toString("utf8");
      if (ch === "\n") break;
      if (ch === "\r") continue;
      s += ch;
    }
    answer = s.trim().toLowerCase();
  } catch {
    return defaultYes;
  }
  if (!answer) return defaultYes;
  return answer === "y" || answer === "yes";
}
