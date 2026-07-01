---
name: effort-bench
description: Run a fixed reasoning benchmark to compare Claude effort levels. Use when the user wants to test or compare the difference between effort settings (low/medium/high/max), benchmark reasoning depth, or says "run effort-bench". Designed to be run in the same session across different effort settings and compared.
---

# Effort Benchmark

A fixed set of 6 reasoning problems with objectively checkable answers, used to
compare behavior across Claude `effort` levels. Run once per effort level, then
compare the scorecards.

## Why this exists

Effort differences only show up on problems that (a) require multi-step reasoning
and (b) have a single objectively-correct answer. Trivial tasks look identical at
every level. These problems are tuned so that low effort can plausibly miss some.

## Procedure (follow exactly)

1. **Record the effort level.** State which effort level is currently active
   (the user sets it with `/effort`). If you don't know it, ask before starting.

2. **Read the problems** from `problems.md` in this skill directory. Do NOT open
   `answers.md` yet.

3. **Solve all 6 problems from scratch**, in order, in a single pass. For each:
   - Show your reasoning briefly (2-4 lines max — do not pad).
   - State a final answer on its own line as `ANSWER N: <value>`.
   - Do not look ahead to the answer key. Solve honestly.

4. **Self-grade.** Only AFTER all 6 answers are written, open `answers.md` and
   compare. Mark each ✅ / ❌. Be strict: a near-miss is ❌.

5. **Report a scorecard** in exactly this format so runs are comparable:

   ```
   === EFFORT-BENCH SCORECARD ===
   Effort level: <low|medium|high|max>
   Score: <X>/6
   Per-problem: 1:<✅/❌> 2:<✅/❌> 3:<✅/❌> 4:<✅/❌> 5:<✅/❌> 6:<✅/❌>
   Notes: <one line — which problems were hardest / where reasoning broke>
   ```

6. **Do not change the problems or answers between runs.** The whole point is a
   fixed test. If the user asks to compare, line up two scorecards and note
   differences in score, which problems flipped, and any difference in answer
   quality or verbosity.

## Honesty rules

- No peeking at `answers.md` before step 4. If you've already seen it this
  session, say so — the run is contaminated and should be re-done in a fresh
  session.
- Report the real score even if it's low. A low score at low effort is the
  signal we're looking for, not a failure.
