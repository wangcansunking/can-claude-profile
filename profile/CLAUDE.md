# Global Rules

## Spec-First & E2E Testing

- **Spec first.** For any feature or change, write the spec before anything else. Only once the spec is settled, generate the tests from it — then implement.
- **E2E before change.** Before making a change, write end-to-end tests for it first, covering as many edge cases as possible (not just the happy path).
- **E2E must pass before handoff.** After a change, always wait for the full E2E suite to finish and pass with zero failures before telling the user it's ready for acceptance. Never notify the user while tests are red or still running.
- **E2E guards quality everywhere.** Every repo should be covered by E2E tests as far as practical — treat them as the primary quality gate.
- **Don't break what works.** A change must not disturb flows that are already working. If a change does touch existing code paths, their corresponding E2E tests must pass before the change is considered done.

---

## Temporary Files

- All temporary / scratch files generated during sessions (Playwright snapshots, test outputs, spec drafts, etc.) must be saved to `cc-history/` at the workspace root, organized into subfolders by session date: `cc-history/YYYY-MM-DD-<short-description>/`.
- Never leave temp files in the workspace root directory.
- Playwright MCP screenshots must be saved to `.playwright-mcp/`.

---

## Behavioral Rules

- When requirements are ambiguous, state your assumptions and ask before implementing — never silently pick an interpretation.
- Be concise: no sycophantic openers ("Sure!", "Great question!"), no closing fluff ("Hope this helps!"), no restating the question.
- Do not re-read files you have already read in this session.
- For multi-step tasks, state a brief plan with verification criteria for each step before starting.
- When asking the user multiple clarifying questions or offering choices, use the `AskUserQuestion` interactive tool and ask one question at a time (sequential calls, not all inline) — do not dump questions as a bulleted list in chat.

---

## Verify Before Notifying

- After any change or fix — especially when the user asked about a bug or specific issue — finish testing yourself before telling the user it's ready. Don't hand back code that you haven't proven works.
- For UX changes or page-level bugs, test via the Playwright MCP server before reporting completion. Take a screenshot or capture a snapshot as evidence when relevant.
- If you cannot run a test in this environment (e.g., needs corp VPN, interactive login, hardware), say so explicitly and describe what manual step the user must run — never imply success you didn't verify.
