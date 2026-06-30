# Code Review Fix Loop Skill

Automated code review, fix, and PR comment resolution loop. Reviews local changes, fixes issues, and resolves PR comments until the code is clean.

## Usage

```
/code-review-fix-loop
```

Or specify options:
```
/code-review-fix-loop --pr 4879754
/code-review-fix-loop --base main
/code-review-fix-loop --skip-pr-comments
```

## What This Skill Does

This skill automates the entire code review and fix workflow:

1. **Local Code Review** - Analyze changes against master/main
2. **Fix Issues** - Address high and medium priority issues
3. **Commit Fixes** - Create a commit with the fixes
4. **Loop** - Repeat steps 1-3 until no high priority issues remain
5. **Push to PR** - Push changes to the remote branch
6. **Wait** - Allow time for PR bots/checks to run
7. **Resolve PR Comments** - Reply to and resolve addressed comments
8. **Commit & Push** - If new fixes were made, commit and push
9. **Loop** - Repeat steps 5-8 until all comments are resolved

## Instructions

### Phase 1: Local Review and Fix Loop

#### Step 1.1: Run Local Code Review

```bash
# Get current branch and base branch
git branch --show-current
git show-ref --verify --quiet refs/heads/master && echo "master" || echo "main"

# Get changed files and diff
git diff {base-branch}...HEAD --name-only
git diff {base-branch}...HEAD --stat
```

For each changed file:
1. Read the full file content
2. Get the diff for that file
3. Review for issues:
   - **[!!!] Critical**: Runtime errors, security vulnerabilities
   - **[!!] High**: Significant bugs, missing error handling
   - **[!] Medium**: Code quality, maintainability
   - **[i] Low**: Suggestions, nice-to-have improvements

#### Step 1.2: Fix High Priority Issues

For each high priority issue ([!!!] or [!!]):
1. Read the file containing the issue
2. Apply the fix using Edit tool
3. Verify the fix doesn't break other code

Common fixes:
- Add null checks
- Add pagination for large queries
- Use explicit type comparisons (e.g., `DateTime.MinValue` instead of `default`)
- Add documentation for non-obvious code
- Add error handling

#### Step 1.3: Commit Fixes

```bash
# Stage fixed files
git add {file1} {file2} ...

# Commit with descriptive message
git commit -m "$(cat <<'COMMITEOF'
Address code review feedback

- [List of fixes applied]

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
COMMITEOF
)"
```

#### Step 1.4: Loop Check

Run local code review again:
- If high priority issues ([!!!] or [!!]) remain → Go to Step 1.2
- If no high priority issues → Proceed to Phase 2

### Phase 2: Push and PR Comment Resolution Loop

#### Step 2.1: Push Changes

```bash
git push
```

#### Step 2.2: Wait for PR Bots

Wait approximately 60 seconds for:
- Build validation
- Policy checks
- Automated bot comments (ownership, security, etc.)

```bash
# Simple wait
sleep 60
```

#### Step 2.3: Fetch PR Comments

Use Azure DevOps MCP tools:

```
mcp__azure-devops__repo_list_pull_request_threads
- repositoryId: {repo-id}
- pullRequestId: {pr-id}
- status: Active
```

#### Step 2.4: Process Each Comment Thread

For each active thread (excluding automated bot threads like ownership-bot):

1. **Analyze the comment** - Determine if it's been addressed by recent commits
2. **If addressed**:
   - Reply with fix details: "Fixed in commit {hash}. {description of fix}"
   - Update thread status to "Fixed"
3. **If not addressed but can be fixed**:
   - Apply the fix
   - Track that new fixes were made
4. **If cannot be addressed** (e.g., design decision, out of scope):
   - Reply explaining why
   - Update thread status to "WontFix" or "ByDesign"

```
mcp__azure-devops__repo_reply_to_comment
- repositoryId: {repo-id}
- pullRequestId: {pr-id}
- threadId: {thread-id}
- content: {reply message}

mcp__azure-devops__repo_update_pull_request_thread
- repositoryId: {repo-id}
- pullRequestId: {pr-id}
- threadId: {thread-id}
- status: Fixed|WontFix|ByDesign|Closed
```

#### Step 2.5: Commit and Push New Fixes

If new fixes were made in Step 2.4:

```bash
git add {fixed-files}
git commit -m "Address PR review comments

- [List of additional fixes]

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
git push
```

#### Step 2.6: Loop Check

- If new fixes were committed → Go to Step 2.2 (wait and check for new comments)
- If active comment threads remain that need code changes → Go to Step 2.4
- If all threads resolved or only bot threads remain → Done

### Phase 3: Final Summary

Output a summary:
```
## Code Review Fix Loop Complete

### Local Reviews
- Reviews performed: X
- Issues fixed: Y
- Final status: No high priority issues

### PR Comments
- Comments resolved: X
- Status: Fixed (Y), WontFix (Z), ByDesign (W)

### Commits
1. {hash} - {message}
2. {hash} - {message}

PR URL: {url}
```

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `--pr` | PR ID to resolve comments on | Auto-detect from branch |
| `--base` | Base branch for comparison | `master` or `main` (auto-detect) |
| `--skip-pr-comments` | Only do local review/fix loop | `false` |
| `--max-iterations` | Maximum review iterations | `5` |

## Thread Status Guide

| Status | When to Use |
|--------|-------------|
| `Fixed` | Issue was addressed in code |
| `WontFix` | Valid concern but won't change (with explanation) |
| `ByDesign` | Intentional behavior (with explanation) |
| `Closed` | Informational thread, no action needed |

## Automated Bot Threads to Skip

Don't try to resolve these (they require manual action or are informational):
- `ownership-bot` - Requires manual ownership assignment
- `MerlinBot` - Automated security/compliance checks
- Policy status updates - System-generated

## Example Output

```
Starting Code Review Fix Loop...

=== Phase 1: Local Review Loop ===

Iteration 1:
- Found 3 high priority issues
- Fixed: Service Bus documentation, pagination, DateTime comparison
- Committed: abc1234

Iteration 2:
- Found 0 high priority issues
- Local review passed!

=== Phase 2: PR Comment Resolution ===

Pushed changes to origin...
Waiting 60 seconds for PR checks...

Found 5 active threads:
- Thread 123: Service Bus Queue [Code Comment] → Fixed
- Thread 124: Pagination [Code Comment] → Fixed
- Thread 125: DateTime [Code Comment] → Fixed
- Thread 126: Timer Schedule [Code Comment] → Fixed
- Thread 127: Code Ownership [Bot] → Skipped (requires manual action)

All code review comments resolved!

=== Summary ===
- Local review iterations: 2
- Issues fixed: 4
- PR comments resolved: 4
- PR URL: https://dev.azure.com/.../pullrequest/4879754
```

## Related Skills

- `/local-code-review` - Run local code review only
- `/ado-code-review` - Review and comment on a PR
- `/ado-create-pr` - Create a new PR
- `/commit` - Create a git commit
