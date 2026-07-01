// lib/git.mjs — git helpers for `sync --push` and the npx (detached) sync flow.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { REPO_ROOT, repoUrl, C } from "./core.mjs";

function git(args, cwd, opts = {}) {
  return execFileSync("git", args, { cwd, stdio: opts.stdio || "pipe", encoding: "utf8" }).trim();
}

// Commit any changes under profile/ and push. Returns a short status string.
export function commitAndPush(repoDir = REPO_ROOT, message) {
  // Stage the captured profile (and CLAUDE.md if present).
  git(["add", "-A", "profile"], repoDir);
  // Anything staged?
  const staged = git(["diff", "--cached", "--name-only"], repoDir);
  if (!staged) {
    return { changed: false, note: "no changes to commit" };
  }
  const msg = message || `profile: sync ${new Date().toISOString()}`;
  git(["commit", "-q", "-m", msg], repoDir);
  const sha = git(["rev-parse", "--short", "HEAD"], repoDir);
  git(["push", "origin", "HEAD"], repoDir, { stdio: "pipe" });
  return { changed: true, sha, files: staged.split("\n").length };
}

// Clone the repo into a temp dir, hand back its path + a cleanup fn.
// Used when sync runs from the read-only npx cache (no local clone available).
export function cloneToTemp() {
  const url = repoUrl();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ccprofile-sync-"));
  const target = path.join(dir, "repo");
  console.log(C.dim(`  cloning ${url} …`));
  execFileSync("git", ["clone", "--depth", "1", "--quiet", url, target], { stdio: "pipe" });
  return { dir: target, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}
