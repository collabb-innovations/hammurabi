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
