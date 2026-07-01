#!/usr/bin/env node
// bin/ccprofile-install.mjs — dedicated entry so `npx github:…/repo ccprofile-install` works.
// (npx treats the first arg as a bin name, so a subcommand-style `... install` is ambiguous;
//  a named bin per action removes that ambiguity.)
import { runInstall } from "../lib/install.mjs";
runInstall();
