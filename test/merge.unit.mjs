// test/merge.unit.mjs — unit tests for the CLAUDE.md section-merge and flag parsing.
// Pure Node, no deps, no filesystem side effects. Run: node test/merge.unit.mjs
import { mergeClaudeMd } from "../lib/core.mjs";

let pass = 0, fail = 0;
const chk = (name, cond) => { console.log((cond ? "PASS " : "FAIL ") + name); cond ? pass++ : fail++; };

// 1. Union of bullets within a shared section, de-duplicating identical rules.
{
  const local = `# Title\n\n## Rules\n\n- keep local rule\n- shared rule\n`;
  const incoming = `# Title\n\n## Rules\n\n- shared rule\n- new repo rule\n`;
  const { merged, addedLines } = mergeClaudeMd(local, incoming);
  chk("keeps local-only bullet", merged.includes("keep local rule"));
  chk("keeps incoming-only bullet", merged.includes("new repo rule"));
  chk("de-dupes shared bullet (appears once)", merged.split("shared rule").length - 1 === 1);
  chk("reports 1 added line into Rules", addedLines["## Rules"] === 1);
}

// 2. Sections in only one file are preserved; new incoming sections appended.
{
  const local = `## A\n\n- a1\n`;
  const incoming = `## A\n\n- a1\n\n## B\n\n- b1\n`;
  const { merged, addedSections } = mergeClaudeMd(local, incoming);
  chk("local section A kept", merged.includes("## A"));
  chk("new section B appended", merged.includes("## B") && merged.includes("b1"));
  chk("addedSections lists B", addedSections.includes("## B"));
  chk("A appears before B (local order first)", merged.indexOf("## A") < merged.indexOf("## B"));
}

// 3. Identical inputs → no changes, no added sections/lines.
{
  const md = `# T\n\n## Rules\n\n- one\n- two\n`;
  const { merged, addedSections, addedLines } = mergeClaudeMd(md, md);
  chk("identical merge adds nothing", addedSections.length === 0 && Object.keys(addedLines).length === 0);
  chk("identical merge preserves both rules", merged.includes("one") && merged.includes("two"));
}

// 4. Never drops a local rule missing from the repo (union, not replace).
{
  const local = `## Rules\n\n- local only rule\n`;
  const incoming = `## Rules\n\n- repo rule\n`;
  const { merged } = mergeClaudeMd(local, incoming);
  chk("local-only rule survives", merged.includes("local only rule"));
  chk("repo rule added too", merged.includes("repo rule"));
}

// 5. Bullet marker / whitespace differences count as duplicates (normalized).
{
  const local = `## Rules\n\n-   Same  Rule\n`;
  const incoming = `## Rules\n\n* same rule\n`;
  const { addedLines } = mergeClaudeMd(local, incoming);
  chk("whitespace+marker+case variants treated as duplicate", addedLines["## Rules"] === undefined);
}

// 6. Local preamble preserved; local section order stable across a real-ish doc.
{
  const local = `# Global Rules\n\nintro line\n\n## Behavioral\n\n- be concise\n\n## Temp Files\n\n- use tmp\n`;
  const incoming = `# Global Rules\n\n## Behavioral\n\n- be concise\n- state assumptions\n\n## Testing\n\n- write e2e\n`;
  const { merged } = mergeClaudeMd(local, incoming);
  chk("preamble 'intro line' kept", merged.includes("intro line"));
  chk("new bullet merged into Behavioral", merged.includes("state assumptions"));
  chk("local-only Temp Files kept", merged.includes("## Temp Files"));
  chk("incoming-only Testing appended", merged.includes("## Testing"));
  chk("Behavioral stays before Temp Files", merged.indexOf("## Behavioral") < merged.indexOf("## Temp Files"));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
