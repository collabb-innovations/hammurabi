# Authoring guide

This guide is for the moment after you've written your first Hammurabi spec
and before you write the rubric. The patterns here come from real bundles
audited adversarially — each anti-pattern produced a green gate over
non-conformant output. They sound obvious in hindsight; they were not
obvious to skilled engineers in the moment.

If you only read three things in this doc, read the three sections that
start with **#1**, **#2**, **#3**. Everything else is supporting material.

---

## #1 — Import the contract. Never re-encode it.

If your target produces output against a documented contract — a JSON
schema, a TypeScript type, an OpenAPI spec, a function signature — your
evaluator must **import that contract**. Hand-copying any part of it into
the evaluator (a `requiredKeys` array, a discriminator list, a regex of
allowed values) guarantees drift the first time the target changes, and
the drift is silent: the rubric continues to report green for output that
no longer conforms.

### Anti-pattern

```ts
// In evaluators.ts — hand-copied from the schema at authoring time
const REQUIRED_KEYS = ["id", "title", "status", "createdAt"];

export function shapeCheck({ output }) {
  const missing = REQUIRED_KEYS.filter((k) => !(k in (output as object)));
  return missing.length === 0 ? 1 : 0;
}
```

Two weeks later the schema gains a `priority` field. The evaluator doesn't
know. Outputs missing `priority` continue to score 1.

### Pattern

```ts
import schema from "../target/lib/response.schema.json" with { type: "json" };
import Ajv from "ajv";

const ajv = new Ajv({ strict: false, formats: { ... } });
const validate = ajv.compile(schema);

export function shapeCheck({ output }) {
  return validate(output) ? 1 : 0;
}
```

The contract is one import away from the production source of truth. When
the schema changes, the evaluator changes with it.

If the contract lives in a sibling repo or service, vendor it (git submodule,
generated types from OpenAPI, npm-published package) rather than retyping.
You only get the gate's guarantee if the gate's vocabulary matches the
target's.

---

## #2 — Mirror the production validator. Library *and* config.

If the spec's `target` is "produce output that passes our production
validator," your evaluator's validator must match production's **major
version** and **config**. Common form of the trap: production runs `ajv 6`
with `formats: false`; the evaluator uses `ajv 8` with `formats: true`.
Both pass test suites in isolation. They disagree on `format: "uri"`,
`format: "email"`, integer coercion, `$ref` resolution semantics, additional
properties handling, and more.

### Checklist before you write a validator-mirroring criterion

- What library does production use? (ajv / zod / joi / yup / valibot / arktype / …)
- What major version? (Lock it. Don't `^` it.)
- What config flags? (`strict`, `coerceTypes`, `useDefaults`, `removeAdditional`, `formats`)
- What custom keywords or formats does production register? (Mirror them.)
- What custom error messages does production use? (Match the failure surface if your evaluator reports it.)

When in doubt, **import the actual validator instance** from production code
rather than reconstructing the config. If production exports
`buildValidator()`, call it. Same gate, by construction.

---

## #3 — A bundle that imports external deps is an installed package.

`hammurabi-check evals/` is meant to run anywhere — your laptop, your CI
runner, a fresh clone in a sandbox. A bundle whose evaluator does:

```ts
import Ajv from "ajv";
```

…depends on `ajv` resolving from the bundle directory's `node_modules` (or
a transitive one). If your bundle directory has no `package.json` declaring
`ajv`, the dep resolves only by **incidental hoisting** from a parent
project — and that hoisting is not stable. You may resolve to a wrong major
in dev (silently passing the wrong gate); you will resolve to nothing in
a fresh checkout (the bundle errors mid-scoring, after the report header
is already written, with `Cannot find module 'ajv'`).

### Pattern

Every bundle that imports external deps has its own `package.json`:

```json
{
  "name": "evals-response-contract",
  "private": true,
  "type": "module",
  "dependencies": {
    "ajv": "8.17.1"
  }
}
```

The package is installable (`npm install` inside the bundle directory just
works). The bundle directory is portable.

Since 0.1.1, both CLI bins **preflight** every dynamic import before
scoring. Unresolved deps exit code 2 with a precise message naming the
criterion and the missing module. That catches the symptom loudly. The
root cause is still the missing `package.json`.

---

## Supporting practice — generate near-miss fixtures

Once the three patterns above are in place, the next class of failure is
the *under-covered rubric*: a criterion that's "right" in the
contract-aligned sense but never actually exercised by any fixture.
Generate near-miss fixtures: outputs that are correct in every dimension
except one, one per criterion. If a fixture targeting criterion C passes
the gate at the same score as the canonical-correct fixture, criterion C
isn't doing any work.

A future Hammurabi version (#7 on the issue tracker) will offer this as a
first-class self-test mode. Today it's a manual practice — but a high-value
one for any bundle whose gate carries weight.

---

## Per-fixture applicability — `appliesTo` (since 0.4.0)

Not every criterion applies to every fixture. A rubric that grades
"does the security finding avoid restating the secret" against a fixture
with nothing sensitive in it is asking an unanswerable question, and an
unanswerable question does not produce a neutral result — it produces a
score, which is worse.

**The workaround this replaced, and why it was a footgun.** Authors used to
have the criterion return `1.0` when it did not apply. That is
indistinguishable from a criterion that applied and passed, so it silently
inflated every weighted score and hid criteria that were doing no work at
all. Scoring `0` instead is no better: it is indistinguishable from a
criterion that applied and failed.

**Use `appliesTo`.** Tag the fixtures, scope the criterion:

```jsonc
{
  "id": "security-no-secret-leak",
  "name": "...",
  "judgePrompt": "...",
  "weight": 0.15,
  "scale": { "kind": "pass-fail" },
  "appliesTo": ["area:security"]   // only fixtures carrying this tag
}
```

Three properties worth knowing before you rely on it:

- **A criterion with no `appliesTo` applies to everything.** That is the
  existing behaviour and stays the default, so adding the field to one
  criterion is a drop-in change.
- **The match is "at least one tag", not "all".** `appliesTo` reads as a
  list of contexts the criterion is valid in, not a conjunction of
  requirements.
- **A criterion that sits out is recorded, not merely absent.** It appears
  in `FixtureResult.inapplicable`, so a criterion silently applying to
  nothing is visible in the report rather than invisible. A criterion whose
  `appliesTo` matches **no fixture in the suite** is a load-time error, not
  a warning — that state is always an authoring mistake.

**The arithmetic consequence, which is the new thing to get right.** A
fixture's score is renormalised over the weight *actually in play*. A
fixture where 3 of 6 criteria apply is scored out of those 3, not divided by
weight that was never scored. For a rubric whose weights sum to 1 this is
exactly the previous arithmetic.

It stops being exactly the previous arithmetic if your weights do **not**
sum to 1. The runner warns:

```
[hammurabi] rubric for spec '<name>' has criterion weights summing to <n>
(expected 1.0) — fixture scores are renormalised over the weight actually
scored, so thresholds apply to a different scale than the weights suggest.
```

Read that warning as an error in practice: your `passThreshold` no longer
means what the weights imply.

## Related issues & deeper material

- **#7** — Self-test + mutation testing. The framework-level version of
  "exercise every criterion." Coming in a future release.
- **#10** — `gate: all-pass` aggregation mode. For conformance gates where
  any single criterion at zero should fail the fixture without weight
  arithmetic.

---

## Missing judge keys refuse the run

A panel you cannot staff is a config error, not a quality score. If a
resolved judge's key env is unset (`FIREWORKS_API_KEY`, `OPENAI_API_KEY`,
…), `run()` throws before any fixture executes. A mass-zero / still-green
run is **not** how a missing key looks any more. A judge that errors later
(timeout, 529, parse) stays excluded from the aggregate and the runner
warns that it was `excluded from the aggregate`.

---

## Where these patterns came from

Five rounds of adversarial review of `hook.`'s first eval-driven bundle
(continuum#248, June 2026). The first three rounds surfaced #1, #2, and
#3 above; rounds 4 and 5 surfaced under-coverage and the silent N/A
footgun. Under-coverage is still open as #7; the N/A footgun was closed
by `appliesTo` in 0.4.0 — see "Per-fixture applicability" above. Eight authoring footguns total — three
preventable with this guide alone.
