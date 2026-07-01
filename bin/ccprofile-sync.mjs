#!/usr/bin/env node
// bin/ccprofile-sync.mjs — dedicated entry so `npx github:…/repo ccprofile-sync` works.
import { runSync } from "../lib/sync.mjs";
runSync();
