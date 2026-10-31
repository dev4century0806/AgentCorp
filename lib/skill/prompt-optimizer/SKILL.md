---
name: prompt-optimizer
description: >-
  MANDATORY: Load and read this skill using read_file before creating, reviewing,
  refining, evaluating, or optimizing system prompts, agent instructions, persona definitions,
  or multi-turn LLM templates. Contains structured optimization frameworks and guidelines.
metadata:
  category: "prompt-engineering"
  tags: "Prompt Engineering, LLM Optimization, System Prompts, Structured Outputs"
---

# Prompt Optimizer Skill

A comprehensive skill for designing, analyzing, structuring, and iterating production-grade system prompts and LLM instructions based on the Prompt Optimizer framework.

## When to Use This Skill

- Designing new system prompts, agent personas, or role guidelines.
- Structuring ambiguous user prompts into production-grade templates with clear constraints.
- Iterating and refining existing prompts without breaking core intent.
- Extracting parameterizable variables and placeholders (`{{variable}}`).
- Evaluating prompt design quality against structured rubrics.

---

## Core Optimization Workflows

### 1. General Structured Optimization
Converts raw prompts into a formal role profile with distinct sections:
- **Role & Profile**: Author, version, target audience, tone, and professional domain.
- **Skills**: Core capability domains and granular specific skills.
- **Rules & Constraints**: Basic principles and behavioral boundaries.
- **Workflows**: Ordered execution pipelines.
- **Output Format**: Exact JSON schema, Markdown format, or contract.

> Read the full guide: [General Optimization Reference](references/general-optimization.md)

### 2. Analytical Structured Optimization
Applies rigorous semantic and natural language constraints designed for complex reasoning tasks.
- Injects explicit negative constraints ("What NOT to do").
- Enforces strict boundary verification and context validation.

> Read the full guide: [Analytical Optimization Reference](references/analytical-optimization.md)

### 3. Iterative Refinement
Modifies an existing prompt based on new requirements without losing existing functionality.
- Preserves template variables (e.g., `{{variable}}`).
- Integrates new constraints cleanly into existing sections.
- Never executes the prompt during the optimization phase.

> Read the full guide: [Iterative Refinement Reference](references/iterative-refinement.md)

### 4. Dynamic Variable Extraction
Identifies dynamic change points across prompts to turn static prompts into reusable templates.
- **Fine-grained**: Single entities, parameters, thresholds.
- **Medium-grained**: Conditions, rules, examples.
- Standardizes placeholder formatting (`{{variable_name}}`).

> Read the full guide: [Variable Extraction Reference](references/variable-extraction.md)

### 5. Evaluation & Rubric Framework
Evaluates prompt quality across clarity, constraint robustness, edge-case resilience, and structure before deployment.

> Read the full guide: [Evaluation Framework](references/evaluation-framework.md)

---

## Standard Execution Steps

When optimizing a prompt:
1. **Analyze Input**: Identify user intent, target model capabilities, and missing constraints.
2. **Select Framework**: Choose between *General*, *Analytical*, or *Iterative* workflow.
3. **Draft Structured Template**: Populate `# Role`, `## Profile`, `## Skills`, `## Rules`, `## Workflows`, and `## Output Format`.
4. **Identify Variables**: Parameterize dynamic elements using `{{variable}}` syntax.
5. **Verify Constraints**: Ensure instructions eliminate ambiguity and guard against common LLM hallucinations or drift.
