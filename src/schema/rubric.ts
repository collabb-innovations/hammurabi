export interface Criterion {
  id: string;
  name: string;
  description: string;
  weight: number;
  scale: CriterionScale;
  judgePrompt?: string;
}

export type CriterionScale =
  | { kind: "pass-fail" }
  | { kind: "ordinal"; min: number; max: number };

export interface Rubric {
  specName: string;
  specVersion: string;
  criteria: Criterion[];
  passThreshold: number;
}
