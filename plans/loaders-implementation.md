# Hammurabi On-Disk Loaders — Implementation Plan

## Context

The runner (v0.0.2 in flight) takes already-parsed `Spec`, `Rubric`, and `FixtureSet` objects. Today, callers must construct them in TypeScript — the smoke test does this, and any consumer would too. That's a barrier to the actual workflow Hammurabi is designed for: edit a `*.spec.md` in your editor, edit a `*.rubric.json`, edit a `*.fixtures.jsonl`, run them.

This plan adds the on-disk → in-memory conversion layer so the next plan (the `/hammurabi-run` slash command) can do `loadBundle("foo.spec.md")` and feed the result straight into `run()`. Loaders are also load-bearing for Knack's consumption pattern — Knack will parse Hammurabi artifacts on disk, not synthesize them in code.

## Output target

After approval, copy this plan to `/Users/mustermania/collabb/hammurabi/plans/loaders-implementation.md` on the `feat/next-plans` branch.

## Architecture

```
src/loaders/
├── spec.ts         # Spec Zod schema, parseSpec(content), loadSpec(path)
├── rubric.ts       # Rubric Zod schema, parseRubric(content), loadRubric(path)
├── fixtures.ts     # Fixture/FixtureSet schemas, parseFixtures(content), loadFixtures(path)
├── bundle.ts       # loadBundle(specPath), loadAll(specPath, rubricPath, fixturesPath)
└── index.ts        # Re-exports
```

**Why a separate `loaders/` namespace and not folded into `schema/`**: `src/schema/` is currently zero-runtime-deps (pure type definitions). Adding Zod schemas there would force every `hammurabi/schema` consumer to pull Zod at runtime even if they only use types. Loaders are the right home for the Zod validation layer — anyone using loaders has already opted into the runtime dependency.

## Decisions (committed in this plan)

1. **Validation via Zod, strict (no unknown fields).** Risk-sensitive teams catch authoring typos early. Forward-compatibility (lenient parsing) is the wrong default for an eval framework — silent acceptance of a misspelled `judegePrompt` would degrade trust. Strict is the safer floor.
2. **Frontmatter via gray-matter** (`^4.0.3`, matches Knack's pin). YAML frontmatter is the standard; gray-matter pulls js-yaml transitively, which is acceptable since Knack already trusts it.
3. **Per-file loaders are dumb (shape-only).** They validate that *this* file is well-formed. They do not check cross-file consistency. Cross-file checks belong in `loadBundle` / `loadAll`.
4. **`loadBundle(specPath)` derives sibling paths**: strip `.spec.md` if present, else strip `.md`, then append `.rubric.json` and `.fixtures.jsonl`. So `foo.spec.md` → `foo.rubric.json` + `foo.fixtures.jsonl`; `foo.md` → `foo.rubric.json` + `foo.fixtures.jsonl`. Bundle is **strict** — missing rubric or fixtures throws. For partial states (mid-authoring), use the per-file loaders.
5. **`loadAll(specPath, rubricPath, fixturesPath)` for explicit paths.** Both `loadBundle` and `loadAll` perform cross-validation: rubric's `specName`/`specVersion` and fixtures' `specName`/`specVersion` must equal the spec's `frontmatter.name`/`frontmatter.version`. Mismatch throws a clear error pointing at the file + field.
6. **JSONL = one JSON value per line.** Blank lines tolerated. **No comment lines** (no `#` or `//`). Sticks to JSONL spec; keeps parsing predictable.
7. **Both `parseX(content: string)` and `loadX(path: string)` exposed.** Pure parsers for callers that already have content in memory (e.g., a future MCP server); file loaders are async sugar around `fs/promises.readFile` + parse.
8. **Errors throw, not return.** Match Knack's style. Error messages include file path and field path (e.g., `Invalid spec at foo.spec.md: frontmatter.target.kind must be one of cli|function|http|free-form`).

## Implementation

### `src/loaders/spec.ts`

```ts
import { readFile } from "node:fs/promises";
import matter from "gray-matter";
import { z } from "zod";
import type { Spec } from "../schema/spec.js";

const SpecTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("cli"), command: z.string() }).strict(),
  z.object({ kind: z.literal("function"), module: z.string(), export: z.string() }).strict(),
  z.object({ kind: z.literal("http"), url: z.string(), method: z.string().optional() }).strict(),
  z.object({ kind: z.literal("free-form"), description: z.string() }).strict(),
]);

export const SpecFrontmatterSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  description: z.string(),
  target: SpecTargetSchema,
}).strict();

export function parseSpec(content: string, source = "<inline>"): Spec {
  const { data, content: body } = matter(content);
  const parsed = SpecFrontmatterSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error(`Invalid spec at ${source}: ${formatZodIssues(parsed.error.issues)}`);
  }
  return { frontmatter: parsed.data, body: body.trim() };
}

export async function loadSpec(path: string): Promise<Spec> {
  const content = await readFile(path, "utf8");
  return parseSpec(content, path);
}
```

`formatZodIssues` is a small shared helper (lives in `src/loaders/errors.ts`) that flattens Zod issues into a one-line `path: message; path: message` string.

### `src/loaders/rubric.ts`

```ts
const CriterionScaleSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("pass-fail") }).strict(),
  z.object({ kind: z.literal("ordinal"), min: z.number(), max: z.number() }).strict(),
]);

const CriterionSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  description: z.string(),
  weight: z.number().min(0).max(1),
  scale: CriterionScaleSchema,
  judgePrompt: z.string().optional(),
}).strict();

export const RubricSchema = z.object({
  specName: z.string().min(1),
  specVersion: z.string().min(1),
  criteria: z.array(CriterionSchema).min(1),
  passThreshold: z.number().min(0).max(1),
}).strict();

export function parseRubric(content: string, source = "<inline>"): Rubric {
  let json: unknown;
  try { json = JSON.parse(content); }
  catch (e) { throw new Error(`Invalid rubric JSON at ${source}: ${(e as Error).message}`); }
  const parsed = RubricSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`Invalid rubric at ${source}: ${formatZodIssues(parsed.error.issues)}`);
  }
  return parsed.data;
}

export async function loadRubric(path: string): Promise<Rubric> { /* readFile + parse */ }
```

Also warns (via `console.warn`, not throws) if weights don't sum to 1.0 (matches `src/runner/score.ts` warning behavior).

### `src/loaders/fixtures.ts`

```ts
export const FixtureSchema = z.object({
  id: z.string().min(1),
  input: z.unknown(),
  expected: z.unknown().optional(),
  tags: z.array(z.string()).optional(),
  notes: z.string().optional(),
}).strict();

// FixtureSet on disk is a JSONL file with one Fixture per line PLUS a header line
// (line 0) that is a JSON object containing { specName, specVersion }.
// See "JSONL header convention" below.
```

**JSONL header convention**: the first non-blank line of a `*.fixtures.jsonl` file MUST be a header object `{ "specName": "...", "specVersion": "..." }`. All subsequent non-blank lines are Fixtures. This avoids requiring a wrapper JSON file (which would defeat the streaming-friendly JSONL choice) while still carrying the cross-link metadata.

Parser:
1. Split content by `\n`, filter blank lines
2. First line: parse as JSON, validate as `{ specName, specVersion }` (strict object)
3. Remaining lines: parse each as JSON, validate via `FixtureSchema`. Bad line → error with line number.
4. Return `{ specName, specVersion, fixtures }`

### `src/loaders/bundle.ts`

```ts
export async function loadBundle(specPath: string): Promise<{ spec: Spec; rubric: Rubric; fixtures: FixtureSet }> {
  const base = specPath.replace(/\.spec\.md$/i, "").replace(/\.md$/i, "");
  return loadAll(specPath, `${base}.rubric.json`, `${base}.fixtures.jsonl`);
}

export async function loadAll(specPath: string, rubricPath: string, fixturesPath: string) {
  const [spec, rubric, fixtures] = await Promise.all([
    loadSpec(specPath),
    loadRubric(rubricPath),
    loadFixtures(fixturesPath),
  ]);
  assertConsistency(spec, rubric, fixtures);
  return { spec, rubric, fixtures };
}

function assertConsistency(spec: Spec, rubric: Rubric, fixtures: FixtureSet): void {
  const errors: string[] = [];
  if (rubric.specName !== spec.frontmatter.name) errors.push(`rubric.specName "${rubric.specName}" != spec.name "${spec.frontmatter.name}"`);
  if (rubric.specVersion !== spec.frontmatter.version) errors.push(`rubric.specVersion "${rubric.specVersion}" != spec.version "${spec.frontmatter.version}"`);
  if (fixtures.specName !== spec.frontmatter.name) errors.push(`fixtures.specName "${fixtures.specName}" != spec.name "${spec.frontmatter.name}"`);
  if (fixtures.specVersion !== spec.frontmatter.version) errors.push(`fixtures.specVersion "${fixtures.specVersion}" != spec.version "${spec.frontmatter.version}"`);
  if (errors.length) throw new Error(`Bundle inconsistency:\n  - ${errors.join("\n  - ")}`);
}
```

### `src/loaders/index.ts` and `src/index.ts`

Re-export all public functions and Zod schemas from `src/loaders/index.ts`. Update `src/index.ts` to add `export * from "./loaders/index.js"`.

Add a new subpath export to `package.json`:
```json
"./loaders": {
  "types": "./dist/loaders/index.d.ts",
  "import": "./dist/loaders/index.js"
}
```

### `package.json` dependency

Add `gray-matter: ^4.0.3` to dependencies (matches Knack's pin).

### Update slash command

`commands/hammurabi.md` Step 3 / Step 4 currently say "produce `<spec-name>.rubric.json`" — clarify the JSONL header convention for fixtures so authoring writes valid files from day one:

> `*.fixtures.jsonl` is JSONL: the first non-blank line is a header `{"specName": ..., "specVersion": ...}` and each subsequent non-blank line is a `Fixture` object.

## Smoke update

Add `examples/smoke/disk/`:
- `uppercase.spec.md` (with frontmatter pointing at sibling `impl.ts` via `../impl.ts` relative module)
- `uppercase.rubric.json`
- `uppercase.fixtures.jsonl`
- `run.ts` — calls `loadBundle("./uppercase.spec.md")`, then `run({ ...bundle })`, prints report

Keep the existing `examples/smoke/run.ts` (inline-object smoke) as the simpler reference; the new disk smoke proves the loader path end-to-end.

## Verification

1. `npm install` — gray-matter pulls in clean
2. `npm run build` — clean compile
3. `npm run typecheck` — clean
4. **Loader-level**: write a malformed `*.spec.md` (e.g., `target.kind: "cli"` but no `command`). `loadSpec` throws with a path-prefixed error.
5. **Cross-validation**: write a valid spec + rubric where `rubric.specName` is wrong. `loadBundle` throws listing the mismatch.
6. **Disk smoke**: `tsx examples/smoke/disk/run.ts` — runs the same uppercase eval as the inline smoke, identical report shape, identical cost (~$0.02).
7. **JSONL edge**: header missing → clear error. Trailing newline OK. Blank intermediate line OK. Trailing-line typo → error with line number.

## Out of scope (deferred)

- Writers (the inverse: `Spec` → `*.spec.md` on disk). Out of scope for v0.0.2 — the slash command writes spec files directly via the `Write` tool.
- Hot reload / file watching.
- A "find all bundles in a directory" utility (`loadAllBundles(dir)`) — easy follow-up if needed.
- Lenient parsing mode (`{ strict: false }` option) — only add when there's a concrete consumer asking for forward-compat tolerance.
- Schema migration helpers across spec versions.
