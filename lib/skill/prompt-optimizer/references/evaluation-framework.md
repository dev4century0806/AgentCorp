# Prompt Design Evaluation Framework

## Rubric Dimensions

Evaluate prompts against the following 5 dimensions:

| Dimension | Evaluation Criteria | Weight |
|:---|:---|:---:|
| **1. Role Definition** | Is the persona, background, and tone unambiguously specified? | 20% |
| **2. Skill Granularity** | Are the capabilities broken into actionable, specific sub-skills? | 20% |
| **3. Constraint Robustness** | Are negative constraints explicit? Does it guard against hallucinations? | 25% |
| **4. Workflow Sequencing** | Is the step-by-step pipeline ordered and free from cyclical dependencies? | 20% |
| **5. Output Contract** | Is the expected output format defined with concrete schema or examples? | 15% |

## Evaluation Scoring
- **Grade A (90-100%)**: Production-ready, deterministic, fully guarded against edge cases.
- **Grade B (75-89%)**: Solid structure, minor ambiguities in negative constraints or error handling.
- **Grade C (<75%)**: Ambiguous role, missing constraints, or relies too heavily on model inference.
