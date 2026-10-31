# Iterative Prompt Refinement Reference

## Overview
When iterating an existing prompt based on user feedback or changed requirements, it is essential to prevent "prompt drift" (where fixing one behavior inadvertently breaks another).

## Golden Rules of Iteration

1. **Maintain Core Intent**: Keep the foundational persona and objectives intact unless explicitly requested otherwise.
2. **Never Execute During Optimization**: You are modifying the prompt, not responding to the prompt's instructions.
3. **Preserve Variable Placeholders**:
   - Retain existing `{{variable}}` syntax verbatim.
   - Do not rename or delete placeholders unless the user explicitly requests removal.
4. **Targeted Constraint Integration**:
   - Add new requirements under existing headings (`## Rules` or `## Workflows`).
   - If resolving an edge case, add a specific negative constraint.

## Step-by-Step Refinement Process

1. **Diff Analysis**: Identify what the original prompt does vs. what new behavior is desired.
2. **Conflict Check**: Check if new requirements conflict with existing rules.
3. **Surgical Edit**: Modify or add only the minimum necessary clauses to achieve the desired outcome.
4. **Summary of Changes**: Briefly report what was added, modified, or preserved.
