---
description: Refine a spec via Q&A, then generate a rubric and fixtures for review
argument-hint: "<path-to-spec.md>"
---

Drive a spec through Hammurabi's 4-step authoring flow. Each step gates on user approval before moving on.

**Target spec:** $ARGUMENTS

If no argument is provided, ask the user for a path to a markdown spec (or offer to scaffold a blank one at `./hammurabi/<name>.spec.md`).

## Step 1: Read the spec

Read the target file. Confirm it has frontmatter with at minimum `name`, `version`, `description`, `target`. If frontmatter is missing or malformed, propose a corrected version and confirm before continuing.

## Step 2: Push back via Q&A

Identify the weakest points in the spec — vague success criteria, missing edge cases, unclear target, scope ambiguity, conflicting requirements. Surface them as a single `AskUserQuestion` round (3–4 questions max, batched). Don't enumerate trivial nits; pick the gaps that would let bad output sneak past evaluation.

Apply the user's answers as edits to the spec file. Show the diff. Confirm acceptance before continuing.

## Step 3: Generate rubric

From the refined spec, produce `<spec-name>.rubric.json` matching the `Rubric` type from `hammurabi/schema`:

- 3–7 criteria. Each has: `id` (kebab-case), `name`, `description`, `weight` (sums to 1.0), `scale` (pass-fail or ordinal min/max), optional `judgePrompt`.
- Set `passThreshold` based on the spec's tolerance for failure.

Show the rubric to the user. Ask: which criteria are missing? Which weights are wrong? Iterate until accepted.

## Step 4: Generate fixtures

From the refined spec + accepted rubric, produce `<spec-name>.fixtures.jsonl`:

- **JSONL header** on the first non-blank line: `{"specName": "<name>", "specVersion": "<version>"}` matching the spec's frontmatter exactly. This is required by Hammurabi's loader and is how bundle cross-validation works.
- Each subsequent non-blank line is one `Fixture` object matching the `Fixture` type.
- 6–12 fixtures covering: happy path, named edge cases from the spec, adversarial inputs that target the spec's stated risks, and at least one "this should refuse / fail gracefully" case if applicable.
- Tag fixtures by what they exercise (e.g., `["happy-path"]`, `["edge:empty-input"]`, `["adversarial:injection"]`).
- Include `notes` on fixtures where the judge needs context.

Show the fixtures to the user. Ask: what scenario is missing? Iterate until accepted.

## Step 5: Report

Final output — list the three artifacts and their paths:

| Artifact | Path |
|----------|------|
| Spec (refined) | path |
| Rubric | path |
| Fixtures | path |

Remind the user: running these against a target is `hammurabi.run({ spec, rubric, fixtures })` (or the `/hammurabi-run` command once implemented).
