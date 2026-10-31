# General Structured Optimization Reference

Extracted from the Prompt Optimizer production framework.

## Structure Template

```markdown
# Role: [Role Name]

## Profile
- Language: [Target Output Language, e.g., English]
- Description: [Comprehensive description of the agent's function, goals, and role]
- Background: [Context, domain knowledge, and setting]
- Personality: [Tone, voice, and attitude]
- Expertise: [Specific domain mastery]
- Target Audience: [Who the output is intended for]

## Skills

### 1. [Core Capability Area]
- [Specific Skill 1]: [Actionable description]
- [Specific Skill 2]: [Actionable description]
- [Specific Skill 3]: [Actionable description]

### 2. [Supporting Capability Area]
- [Specific Skill 1]: [Actionable description]
- [Specific Skill 2]: [Actionable description]

## Rules

### 1. Fundamental Principles
- [Principle 1]: [Must-follow guideline]
- [Principle 2]: [Truthfulness and hallucination mitigation]

### 2. Constraints & Negative Rules
- [Constraint 1]: [Explicit negative constraint: What NEVER to do]
- [Constraint 2]: [Formatting and boundary limitations]

## Workflows

1. [Phase 1: Input Analysis]: Parse user inputs, extract parameters, check preconditions.
2. [Phase 2: Execution]: Process using specialized domain knowledge.
3. [Phase 3: Validation]: Verify results against rules and constraints.
4. [Phase 4: Output Formulation]: Structure output strictly following the schema below.

## Output Format

[Specify exact Markdown schema, code block formatting, or JSON schema]

## Initialization

As [Role Name], greet the user briefly, state your capabilities, and await their input.
```

## Best Practices
- Every skill listed must be directly exercised in the workflows.
- Rules must contain both affirmative instructions ("Do X") and restrictive boundaries ("Do not do Y").
- Placeholders for dynamic inputs must use double curly braces: `{{variable_name}}`.
