---
description: Run a comprehensive code review on specified files or recent changes
allowed-tools: Task, Read, Glob, Grep, Bash
---

# Review: $ARGUMENTS

Run a thorough code review on:

> **$ARGUMENTS**

If no specific files are mentioned, review all uncommitted changes (`git diff` and `git diff --staged`).

## Instructions

### Step 1: Identify Scope
- If files specified: review those files
- If "recent" or "latest": review changes since last commit
- If "branch" or PR-related: review diff against main/master
- Run: `git diff --name-only` to see all changed files

### Step 2: Parallel Review
Launch the **code-reviewer** subagent to review for:
- Code quality, bugs, and best practices
- Crypto-specific security (keys, funds, approvals, slippage)
- Type safety and error handling

In parallel, launch the **codebase-explorer** subagent to:
- Check if changes are consistent with existing patterns in the codebase
- Identify if any other files need to be updated (imports, tests, docs)

### Step 3: Synthesize
Combine findings into a single report:

1. **🔴 Critical Issues** (must fix)
2. **🟠 High Priority** (should fix)
3. **🟡 Medium Issues** (fix soon)
4. **🔵 Suggestions** (nice to have)
5. **✅ What's Good** (acknowledge quality work)

### Step 4: Actionable Summary
- Total issues by severity
- Estimated effort to fix
- Recommended fix order
- Any tests that should be added

## Rules
- Be thorough but fair — acknowledge good work
- Every issue must have a concrete fix suggestion
- Explain WHY for each issue (learning context)
- Check that tests exist for changed code — flag if missing
