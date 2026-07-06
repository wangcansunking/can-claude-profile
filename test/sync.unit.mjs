// test/sync.unit.mjs — unit tests for diff/selection helpers (pure, no fs writes).
// Run: node test/sync.unit.mjs
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { diffMaps, selectItems, dirsEqual } from "../lib/core.mjs";

let pass = 0, fail = 0;
const chk = (name, cond) => { console.log((cond ? "PASS " : "FAIL ") + name); cond ? pass++ : fail++; };
const eqArr = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// 1. diffMaps: added / changed / removed / unchanged partitioning.
{
  const incoming = { a: 1, b: 2, c: 3 };   // machine
  const current = { b: 2, c: 99, d: 4 };   // repo
  const d = diffMaps(incoming, current);
  chk("added = [a]", eqArr(d.added, ["a"]));
  chk("changed = [c]", eqArr(d.changed, ["c"]));
  chk("removed = [d]", eqArr(d.removed, ["d"]));
  chk("unchanged = [b]", eqArr(d.unchanged, ["b"]));
}

// 2. diffMaps: identical maps → everything unchanged, nothing actionable.
{
  const m = { x: { deep: [1, 2] }, y: "s" };
  const d = diffMaps(m, JSON.parse(JSON.stringify(m)));
  chk("no adds/changes/removes when identical", !d.added.length && !d.changed.length && !d.removed.length);
  chk("all ids unchanged", eqArr(d.unchanged, ["x", "y"]));
}

// 3. diffMaps: custom eq (e.g. dir-content comparator) governs changed vs unchanged.
{
  const incoming = { foo: "IGNORED", bar: "IGNORED" };
  const current = { foo: "IGNORED", bar: "IGNORED" };
  // eq says foo equal, bar not — regardless of values.
  const d = diffMaps(incoming, current, (id) => id === "foo");
  chk("custom eq: foo unchanged", d.unchanged.includes("foo"));
  chk("custom eq: bar changed", d.changed.includes("bar"));
}

// 4. selectItems: no flags → all actionable selected.
{
  const ids = ["skill:a", "plugin:b", "mcp:c"];
  const sel = selectItems(ids, null, null);
  chk("no flags selects all", sel.size === 3 && ids.every((i) => sel.has(i)));
}

// 5. selectItems: --pick restricts to listed ids.
{
  const ids = ["skill:a", "skill:b", "mcp:c"];
  const sel = selectItems(ids, new Set(["skill:a", "mcp:c"]), null);
  chk("pick keeps only listed", sel.has("skill:a") && sel.has("mcp:c") && !sel.has("skill:b"));
}

// 6. selectItems: --drop removes listed ids.
{
  const ids = ["skill:a", "skill:b", "mcp:c"];
  const sel = selectItems(ids, null, new Set(["skill:b"]));
  chk("drop removes listed", !sel.has("skill:b") && sel.has("skill:a") && sel.has("mcp:c"));
}

// 7. selectItems: pick then drop (drop wins on overlap).
{
  const ids = ["skill:a", "skill:b", "skill:c"];
  const sel = selectItems(ids, new Set(["skill:a", "skill:b"]), new Set(["skill:b"]));
  chk("pick∩ then drop", sel.has("skill:a") && !sel.has("skill:b") && !sel.has("skill:c"));
}

// 8. dirsEqual: identical trees equal; a byte change makes them differ.
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "de-"));
  const a = path.join(root, "a"), b = path.join(root, "b");
  fs.mkdirSync(path.join(a, "sub"), { recursive: true });
  fs.mkdirSync(path.join(b, "sub"), { recursive: true });
  fs.writeFileSync(path.join(a, "f.txt"), "hello");
  fs.writeFileSync(path.join(b, "f.txt"), "hello");
  fs.writeFileSync(path.join(a, "sub", "g.txt"), "world");
  fs.writeFileSync(path.join(b, "sub", "g.txt"), "world");
  chk("identical trees equal", dirsEqual(a, b) === true);
  fs.writeFileSync(path.join(b, "sub", "g.txt"), "WORLD");
  chk("byte change → not equal", dirsEqual(a, b) === false);
  fs.writeFileSync(path.join(b, "sub", "g.txt"), "world");
  fs.writeFileSync(path.join(b, "extra.txt"), "x");
  chk("extra file → not equal", dirsEqual(a, b) === false);
  fs.rmSync(root, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
