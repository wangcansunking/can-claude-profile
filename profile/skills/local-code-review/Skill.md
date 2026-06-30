# Local Code Review Skill

Review changes between the current branch and master/main, generate a detailed markdown report, and create a plan to fix identified issues.

## Usage

```
/local-code-review
```

Or specify the base branch explicitly:
```
/local-code-review master
/local-code-review main
```

## What This Skill Does

1. **Detects Base Branch**: Automatically detects whether `master` or `main` is the default branch
2. **Analyzes Changes**: Gets the diff between current branch and base branch
3. **Discovers Project Conventions**: Reads CLAUDE.md files from changed file directories and ancestors
4. **Reviews Code**: Reviews each changed file against project-specific conventions
5. **Generates Markdown Report**: Creates a detailed review report at `.claude/reviews/review-{branch-name}-{timestamp}.md`
6. **Creates Fix Plan**: Generates an actionable plan to address identified issues

## Instructions

### Step 1: Determine Base Branch and Current Branch

```bash
# Get current branch name
git branch --show-current

# Check if master or main exists
git show-ref --verify --quiet refs/heads/master && echo "master" || echo "main"
```

Use the argument if provided, otherwise auto-detect.

### Step 2: Get Changed Files

```bash
# Get list of changed files
git diff {base-branch}...HEAD --name-only

# Get diff statistics
git diff {base-branch}...HEAD --stat
```

### Step 3: Discover Project Conventions

For each changed file, find and read CLAUDE.md files:

1. Start from the directory containing the changed file
2. Walk up to ancestor directories until reaching the repository root
3. Collect all CLAUDE.md files found along the path
4. Parse and extract relevant coding conventions, patterns, and requirements

**Example**: For a changed file at `apps/PortalApp/src/Components/Button.tsx`:
- Check `apps/PortalApp/src/Components/CLAUDE.md`
- Check `apps/PortalApp/src/CLAUDE.md`
- Check `apps/PortalApp/CLAUDE.md`
- Check `apps/CLAUDE.md`
- Check `CLAUDE.md` (root)

Merge conventions from all found CLAUDE.md files (more specific overrides general).

### Step 4: Review Each Changed File

For each changed file:

1. **Read the full file content** for context
2. **Get the diff** for that specific file: `git diff {base-branch}...HEAD -- {file-path}`
3. **Apply project conventions** from discovered CLAUDE.md files
4. **Check for general issues**:

| Category | What to Check |
|----------|---------------|
| **Reliability** | Null checks, undefined handling, edge cases, error boundaries |
| **Security** | Input validation, injection risks, sensitive data exposure |
| **Performance** | Inefficient loops, unnecessary operations, memory leaks |
| **Maintainability** | Code duplication, complexity, naming conventions |
| **Testing** | Missing tests for new functionality |
| **Accessibility** | ARIA labels, keyboard navigation (for UI changes) |

5. **Check project-specific conventions** from CLAUDE.md:
   - Required patterns and frameworks
   - Coding style requirements
   - i18n requirements
   - Testing requirements
   - Any other documented conventions

### Step 5: Generate Markdown Report

Create the reviews directory if needed, then create the report at `.claude/reviews/review-{branch-name}-{timestamp}.md`:

```markdown
# Code Review: {Branch Name}

**Date**: {YYYY-MM-DD HH:mm}
**Base Branch**: {master/main}
**Current Branch**: {branch-name}
**Reviewer**: Claude Code

---

## Summary

[Brief description of what the changes do]

## Project Conventions Applied

[List the CLAUDE.md files found and key conventions extracted]

## Changes Overview

| File | Lines Added | Lines Removed | Category |
|------|-------------|---------------|----------|
| [file path] | +X | -Y | [category] |

**Total**: X files changed, +Y insertions, -Z deletions

---

## File-by-File Review

### 1. `path/to/first-file.ts`

**Conventions Applied**: [List relevant conventions from CLAUDE.md]

#### Issues Found

| Severity | Line(s) | Issue | Suggested Fix |
|----------|---------|-------|---------------|
| [!!!] | 45-48 | [Description] | [Fix] |

#### Detailed Issues

##### [!!!] Critical: [Issue Title]
- **Line(s)**: X-Y
- **Description**: [What the issue is]
- **Impact**: [What could go wrong]
- **Convention Violated**: [If applicable, reference CLAUDE.md]
- **Suggested Fix**:
```
// Code suggestion
```

#### Positive Aspects
- [Good things about this file's changes]

---

### 2. `path/to/second-file.ts`

[Same format as above]

---

## Issues Summary

### Critical Issues ([!!!])
1. [File:Line] - [Brief description]

### High Priority Issues ([!!])
1. [File:Line] - [Brief description]

### Medium Priority Issues ([!])
1. [File:Line] - [Brief description]

### Suggestions ([i])
1. [File:Line] - [Brief description]

---

## Fix Plan

### Phase 1: Critical Fixes (Must Do Before Merge)

1. [ ] **[Task Title]**
   - File: `path/to/file.ts`
   - Line(s): X-Y
   - Action: [What to do]
   - Convention: [Reference if applicable]

### Phase 2: High Priority Fixes (Should Do)

[Same format]

### Phase 3: Improvements (Nice to Have)

[Same format]

---

## Checklist Before Merge

- [ ] All critical issues addressed
- [ ] All high priority issues addressed or documented
- [ ] Project conventions followed (per CLAUDE.md)
- [ ] Tests added/updated for new functionality
- [ ] No debug code or console.log left
```

### Step 6: Output Summary

After creating the report:
1. Print the path to the generated report
2. Summarize the key findings by file
3. List the most critical items from the fix plan

## Severity Indicators

| Icon | Severity | Description |
|------|----------|-------------|
| `[!!!]` | Critical | Must fix before merge, potential runtime errors or security issues |
| `[!!]` | High | Should fix, significant code quality or maintainability concerns |
| `[!]` | Medium | Should consider, minor code quality improvements |
| `[i]` | Low | Nice to have, suggestions for improvement |

## Example Output

```
Discovered CLAUDE.md files:
- ./CLAUDE.md (root conventions)
- ./apps/PortalApp/CLAUDE.md (app-specific conventions)

Review completed and saved to: .claude/reviews/review-feature-branch-2024-01-15-143022.md

Files Reviewed: 8

Summary by File:
1. src/Components/Button.tsx - 1 critical, 2 medium issues
2. src/Services/ApiService.ts - 1 high priority issue
3. src/Utils/helpers.ts - Clean, no issues
...

Top Priority Items:
1. [!!!] Button.tsx:45 - Missing null check, could cause runtime error
2. [!!] ApiService.ts:123 - Missing error handling for API call
3. [!] Button.tsx:67 - Hardcoded string violates i18n convention
```

## Related Skills

- `/ado-code-review` - Review Azure DevOps pull requests
- `/commit` - Create git commits
- `/commit-push-pr` - Commit, push, and create a PR
