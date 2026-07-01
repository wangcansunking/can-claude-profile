#!/usr/bin/env node
// profile.mjs — single entry point. Usage: node profile.mjs <sync|install> [--yes] [--dry-run]
import { runSync } from "./lib/sync.mjs";
import { runInstall } from "./lib/install.mjs";
import { C } from "./lib/core.mjs";

const cmd = process.argv[2];

if (cmd === "sync") {
  runSync();
} else if (cmd === "install") {
  runInstall();
} else {
  console.log(`${C.bold("can-claude-profile")} — capture & restore your Claude Code setup

${C.bold("Usage:")}
  node profile.mjs sync       ${C.dim("# machine → repo  (capture this machine's config, filter out Microsoft)")}
  node profile.mjs install    ${C.dim("# repo → machine  (apply the repo profile here, preserving local auth)")}

${C.bold("Run remotely without cloning (via GitHub):")}
  npx -p github:wangcansunking/can-claude-profile ccprofile-install   ${C.dim("# one-line install")}
  npx -p github:wangcansunking/can-claude-profile ccprofile-sync      ${C.dim("# one-line capture")}

${C.bold("Flags:")}
  --yes, -y     ${C.dim("skip confirmation prompts")}
  --dry-run     ${C.dim("preview only, write nothing")}
  --force       ${C.dim("(install) overwrite skills that already exist")}

${C.dim("Pure Node — runs the same on Windows, macOS, and Linux. Node ships with Claude Code.")}`);
  process.exit(cmd ? 1 : 0);
}
