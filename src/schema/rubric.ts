export interface Criterion {
  id: string;
  name: string;
  description: string;
  weight: number;
  scale: CriterionScale;
  judgePrompt?: string;
  /**
   * How this criterion is scored. Omitted ⇒ `{ kind: "llm" }` (the judge
   * panel scores it). `{ kind: "code" }` scores it deterministically by
   * importing `module` and calling `export(args)` — no judge call, perfectly
   * reproducible. Use for things code can check exactly (recall, presence,
   * format, latency) and reserve the panel for judgment calls.
   */
  evaluator?: CriterionEvaluator;
  /**
   * Restrict this criterion to fixtures carrying at least one of these tags.
   * Omitted ⇒ the criterion applies to every fixture (the existing default).
   *
   * This expresses "does not apply", which is NOT the same as "cannot be
   * evaluated". Omission — a judge declining to score — is modelled as a
   * malfunction: it is excluded from the aggregate, and a criterion no judge
   * scored errors the fixture. That loudness is correct for a real failure and
   * wrong for a criterion that was never meant to speak, so the two need
   * different mechanisms.
   *
   * Without this, a rubric whose target emits variant outputs (a success shape
   * and an error shape; several ops behind one CLI) has no good option. Asking
   * a judge to abstain in prose is unreliable — judges intermittently score 0
   * while their own reasoning says the rule calls for a pass. Not asking means
   * the criterion grades output it has nothing to say about, consistently low.
   *
   * Inapplicable criteria are dropped before scoring: no judge call is made,
   * and the fixture's weighted score is renormalised over the criteria that do
   * apply, so a fixture is never divided by weight that was never in play.
   * They are listed in `FixtureResult.inapplicable` so the report shows a
   * criterion sat out rather than silently vanishing.
   */
  appliesTo?: string[];
}

export type CriterionEvaluator =
  | { kind: "llm" }
  | { kind: "code"; module: string; export: string };

export type CriterionScale =
  | { kind: "pass-fail" }
  | { kind: "ordinal"; min: number; max: number };

export interface Rubric {
  specName: string;
  specVersion: string;
  criteria: Criterion[];
  passThreshold: number;
}
