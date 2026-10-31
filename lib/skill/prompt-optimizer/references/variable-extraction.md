# AI Variable Extraction Reference

## Objective
Automatically detect, isolate, and parameterize change points within prompts to turn hardcoded examples into generic templates.

## Extraction Criteria

1. **Variability**: Any piece of text likely to change across different user invocations (e.g., product names, programming languages, user roles, text lengths, datasets).
2. **Reusability**: Turning fixed values into named parameters allows the prompt to be called programmatically or plugged into agent chains.

## Granularity Levels

- **Fine-grained**: Single terms or parameters:
  - `{{language}}`, `{{target_word_count}}`, `{{user_name}}`
- **Medium-grained**: Context blocks or constraints:
  - `{{input_context}}`, `{{custom_rules}}`, `{{reference_examples}}`

## Formatting Syntax
- Always enclose variables in double curly braces: `{{variable_name}}`.
- Use snake_case for clear readability and programmatic templating.
- Provide sensible defaults or brief type descriptions in comments when presenting the template.
