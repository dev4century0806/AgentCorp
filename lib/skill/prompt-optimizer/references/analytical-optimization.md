# Analytical Structured Optimization Reference

Extracted from Prompt Optimizer analytical frameworks.

## Purpose
Used for complex multi-turn reasoning, mathematical logic, code architecture, or domain-specific analysis where failure modes must be eliminated upfront.

## Key Sections

### 1. Goal & Attention Directive
- State the stakes and high-leverage objective.
- Explicitly emphasize accuracy over speed or verbosity.

### 2. Constraints & Edge Cases
- **Ambiguity Handling**: If the input is ambiguous or incomplete, state what the agent should ask rather than guessing.
- **Strict Guardrails**: Disallow assumptions that are not backed by input context.
- **Step-by-step Thinking**: Require deliberate intermediate chain-of-thought when needed.

### 3. Example Few-Shot Demonstrations
Include input-output pairs demonstrating:
- A standard valid scenario.
- An edge case or error scenario demonstrating how negative constraints trigger properly.

### 4. Self-Correction / Verification Loop
Before producing the final response, the prompt must mandate an internal verification step:
- Check 1: Did the response violate any negative constraint?
- Check 2: Are all required fields present?
- Check 3: Is formatting valid according to the contract?
