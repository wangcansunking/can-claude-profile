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

// ---------- diff / changeset helpers (used by sync) ----------
// Recursively compare two directory trees for byte-identical file content.
// Returns true when both hold the same set of files with identical bytes.
export function dirsEqual(a, b) {
  const walk = (root) => {
    const out = new Map();
    const rec = (dir, rel) => {
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        const full = path.join(dir, e.name);
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) rec(full, r);
        else out.set(r, full);
      }
    };
    rec(root, "");
    return out;
  };
  if (!exists(a) || !exists(b)) return false;
  const fa = walk(a), fb = walk(b);
  if (fa.size !== fb.size) return false;
  for (const [rel, pa] of fa) {
    const pb = fb.get(rel);
    if (!pb) return false;
    let ba, bb;
    try { ba = fs.readFileSync(pa); bb = fs.readFileSync(pb); } catch { return false; }
    if (ba.length !== bb.length || !ba.equals(bb)) return false;
  }
  return true;
}

// Diff two keyed maps into { added, changed, removed, unchanged } id-lists.
// `eq(id, left, right)` decides equality for ids present in both (default: deep
// JSON compare). "left" = incoming (machine), "right" = current (repo).
export function diffMaps(incoming, current, eq) {
  const equal = eq || ((_, l, r) => JSON.stringify(l) === JSON.stringify(r));
  const added = [], changed = [], removed = [], unchanged = [];
  for (const id of Object.keys(incoming)) {
    if (!(id in current)) added.push(id);
    else if (equal(id, incoming[id], current[id])) unchanged.push(id);
    else changed.push(id);
  }
  for (const id of Object.keys(current)) {
    if (!(id in incoming)) removed.push(id);
  }
  return {
    added: added.sort(), changed: changed.sort(),
    removed: removed.sort(), unchanged: unchanged.sort(),
  };
}

// Apply --pick= / --drop= item selection to a changeset's actionable ids
// (added ∪ changed ∪ removed). Ids are prefixed by kind, e.g. "skill:foo",
// "plugin:bar", "mcp:baz". --pick restricts to the listed ids (others dropped);
// --drop removes the listed ids. Returns the Set of ids to actually apply.
export function selectItems(actionableIds, pick, drop) {
  let ids = new Set(actionableIds);
  if (pick && pick.size) ids = new Set([...ids].filter((id) => pick.has(id)));
  if (drop && drop.size) ids = new Set([...ids].filter((id) => !drop.has(id)));
  return ids;
}

// Read a raw (case/punctuation-preserving) list flag, e.g. --pick=skill:Foo,mcp:bar.
// Unlike argListValue this keeps ids intact for exact matching. Returns Set|null.
export function argIdSet(flag) {
  const pre = `--${flag}=`;
  const arg = process.argv.find((a) => a.startsWith(pre));
  if (arg === undefined) return null;
  const items = arg.slice(pre.length).split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
  return new Set(items);
}

// ---------- CLAUDE.md section-aware merge ----------
// Split markdown into a preamble (text before the first `## ` heading) and a
// list of { heading, body } sections. `# ` H1 titles stay in the preamble.
function splitSections(md) {
  const lines = md.split(/\r?\n/);
  const preamble = [];
  const sections = [];
  let cur = null;
  for (const line of lines) {
    if (/^##\s+/.test(line)) {
      if (cur) sections.push(cur);
      cur = { heading: line.replace(/\s+$/, ""), body: [] };
    } else if (cur) {
      cur.body.push(line);
    } else {
      preamble.push(line);
    }
  }
  if (cur) sections.push(cur);
  return { preamble, sections };
}

// Normalize a body line for duplicate detection (trim, collapse ws, lowercase,
// drop leading bullet/`-`/`*` markers). Blank lines and horizontal rules ignored.
function normLine(line) {
  const t = line.trim().replace(/^[-*]\s+/, "").replace(/\s+/g, " ").toLowerCase();
  return t === "---" ? "" : t;
}

// Deterministic union merge of two CLAUDE.md files, by `## ` section.
// - Sections in only one file are kept as-is.
// - Sections in both: local body kept, then any incoming body line whose
//   normalized form isn't already present is appended (union, de-duplicated).
// - Local section order preserved; genuinely new incoming sections appended.
// - Preamble: local kept; if local has none, incoming preamble is used.
// Returns { merged: string, addedSections: [], addedLines: {heading: count} }.
export function mergeClaudeMd(localMd, incomingMd) {
  const A = splitSections(localMd);
  const B = splitSections(incomingMd);
  const byHeadingB = new Map(B.sections.map((s) => [s.heading.trim().toLowerCase(), s]));
  const usedB = new Set();
  const addedSections = [];
  const addedLines = {};

  const preamble = A.preamble.join("\n").trim() ? A.preamble : B.preamble;

  const outSections = [];
  for (const sec of A.sections) {
    const key = sec.heading.trim().toLowerCase();
    const match = byHeadingB.get(key);
    if (!match) { outSections.push(sec); continue; }
    usedB.add(key);
    const present = new Set(sec.body.map(normLine).filter(Boolean));
    const mergedBody = [...sec.body];
    let added = 0;
    for (const line of match.body) {
      const n = normLine(line);
      if (n && !present.has(n)) { mergedBody.push(line); present.add(n); added++; }
    }
    if (added) addedLines[sec.heading.trim()] = added;
    outSections.push({ heading: sec.heading, body: mergedBody });
  }
  // Append incoming-only sections in their original order.
  for (const sec of B.sections) {
    const key = sec.heading.trim().toLowerCase();
    if (usedB.has(key)) continue;
    outSections.push(sec);
    addedSections.push(sec.heading.trim());
  }

  const parts = [];
  const pre = preamble.join("\n").replace(/\n+$/, "");
  if (pre.trim()) parts.push(pre);
  for (const sec of outSections) {
    const body = sec.body.join("\n").replace(/\n+$/, "");
    parts.push(sec.heading + (body ? "\n" + body : ""));
  }
  return { merged: parts.join("\n\n") + "\n", addedSections, addedLines };
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

// Read one line from fd 0 synchronously. Returns null if stdin can't be read
// (e.g. no TTY / closed pipe), so callers can fall back to a default.
export function readLineSync() {
  try {
    const buf = Buffer.alloc(1);
    let s = "";
    while (true) {
      const n = fs.readSync(0, buf, 0, 1, null);
      if (n === 0) break;
      const ch = buf.toString("utf8");
      if (ch === "\n") break;
      if (ch === "\r") continue;
      s += ch;
    }
    return s;
  } catch {
    return null;
  }
}

// Synchronous y/n prompt via /dev/stdin fallback to readline.
export function confirm(question, defaultYes = false) {
  if (process.argv.includes("--yes") || process.argv.includes("-y")) return true;
  if (process.argv.includes("--dry-run")) return false;
  const suffix = defaultYes ? " [Y/n] " : " [y/N] ";
  process.stdout.write(C.yellow("? ") + question + suffix);
  const line = readLineSync();
  if (line === null) return defaultYes;
  const answer = line.trim().toLowerCase();
  if (!answer) return defaultYes;
  return answer === "y" || answer === "yes";
}

// Read a comma/space-separated flag value from argv, e.g. --only=skills,mcp.
// Returns a normalized Set (lowercased, punctuation stripped) or null if absent.
export function argListValue(flag) {
  const pre = `--${flag}=`;
  const arg = process.argv.find((a) => a.startsWith(pre));
  if (arg === undefined) return null;
  const items = arg
    .slice(pre.length)
    .split(/[,\s]+/)
    .map((s) => s.toLowerCase().replace(/[^a-z0-9]/g, ""))
    .filter(Boolean);
  return new Set(items);
}
