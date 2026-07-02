# Global Rules

## Spec-First & E2E Testing

- **Spec first.** For any feature or change, write the spec before anything else. Only once the spec is settled, generate the tests from it — then implement.
- **E2E before change.** Before making a change, write end-to-end tests for it first, covering as many edge cases as possible (not just the happy path).
- **E2E must pass before handoff.** After a change, always wait for the full E2E suite to finish and pass with zero failures before telling the user it's ready for acceptance. Never notify the user while tests are red or still running.
- **E2E guards quality everywhere.** Every repo should be covered by E2E tests as far as practical — treat them as the primary quality gate.
- **Don't break what works.** A change must not disturb flows that are already working. If a change does touch existing code paths, their corresponding E2E tests must pass before the change is considered done.
- **Pick the right E2E tooling.** For backend/service changes, prefer testing in Docker. For frontend/UX changes, prefer the browser-harness skill; if it isn't available, fall back to the Playwright MCP server.

---

## Temporary Files

- All temporary / scratch files generated during sessions (Playwright snapshots, test outputs, spec drafts, etc.) must be saved to `.claude/history/` at the workspace root, organized into subfolders by session date: `.claude/history/YYYY-MM-DD-<short-description>/`.
- Never leave temp files in the workspace root directory.
- Playwright MCP screenshots must be saved to `.claude/playwright-mcp/`.

---

## Behavioral Rules

- When requirements are ambiguous, state your assumptions and ask before implementing — never silently pick an interpretation.
- Be concise: no sycophantic openers ("Sure!", "Great question!"), no closing fluff ("Hope this helps!"), no restating the question.
- Do not re-read files you have already read in this session.
- For multi-step tasks, state a brief plan with verification criteria for each step before starting.
- When asking the user multiple clarifying questions or offering choices, use the `AskUserQuestion` interactive tool and ask one question at a time (sequential calls, not all inline) — do not dump questions as a bulleted list in chat.

---

## Engineering Discipline

- **Search before building.** Before writing a utility, helper, or library, check for something that already solves it. Prefer standard library → an established popular library → custom code. Only write custom when the conventional approach genuinely doesn't fit — and document why.
- **Surgical changes.** Make the smallest change that solves the problem. Don't refactor unrelated code, rename things, or reformat files you aren't actively working on. Keep the diff focused on the task.
- **Name worktree sessions.** After checking out a git worktree, rename the session to give it a descriptive name (so parallel worktree sessions are easy to tell apart).

---

## Verify Before Notifying

- After any change or fix — especially when the user asked about a bug or specific issue — finish testing yourself before telling the user it's ready. Don't hand back code that you haven't proven works.
- For UX changes or page-level bugs, test via the Playwright MCP server before reporting completion. Take a screenshot or capture a snapshot as evidence when relevant.
- If you cannot run a test in this environment (e.g., needs corp VPN, interactive login, hardware), say so explicitly and describe what manual step the user must run — never imply success you didn't verify.
- **Understanding, not just green tests.** Passing tests is not the same as understanding. Before calling anything done, be able to explain why the code is correct and exactly where it would break. If you can't walk the failure modes, you're guessing — keep going.

---

## Completion Status

- End each task with an explicit status: **DONE** (all steps complete, with evidence for each claim), **BLOCKED** (state what's blocking and what you already tried), or **NEEDS_CONTEXT** (state exactly what information is missing).
- "Partially done" is not a status. Either it's finished (DONE) or it isn't (BLOCKED / NEEDS_CONTEXT). Honesty about incompleteness beats pretending.
