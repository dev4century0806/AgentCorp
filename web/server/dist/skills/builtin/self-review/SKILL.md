---
name: self-review
description: Review your own changes before finishing. Check for debug code, verify tests, and write a summary.
---

# Self-Review

Before you finish any task, run through this checklist:

## 1. Re-read your diff

Review every file you changed:
```
git diff HEAD~1..HEAD
```
Or if you haven't committed yet:
```
git diff
```

## 2. Remove leftover debug code

Search for and remove:
- `console.log` statements added for debugging
- Commented-out code blocks
- `TODO` or `FIXME` comments you added
- Hardcoded test values or credentials
- `debugger` statements

## 3. Verify tests

- If you changed behavior, confirm tests were added or updated
- If you deleted code, confirm related tests were removed or updated
- Run the test suite to make sure everything passes

## 4. Check for common issues

- No trailing whitespace or mixed indentation
- Imports are used and sorted
- No unused variables or functions
- Error handling is in place
- Types are correct (no `any` where it can be avoided)

## 5. Record lessons

If you found a repo convention or gotcha, or the user corrected you on something that applies beyond this ticket, save it with the office's `remember` tool so the next worker gets it.

## 6. Write your summary

Before marking the work done, write a brief summary including:

```
## What changed
<One or two sentences describing the change>

## What was tested
<How you verified the change works>

## Anything I'm unsure about
<Questions for review, or "None">
```

This summary goes in your final message so the user and any reviewer can quickly understand your work.
