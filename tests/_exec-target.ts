// Helper module for execute.test.ts function-target cases.
// Not a *.test.ts file, so the test runner does not execute it directly.

export function echo(input: unknown): unknown {
  return input;
}

export function boom(): never {
  throw new Error("boom");
}

export const notAFunction = 42;

// --- code-evaluator targets for deterministic.test.ts ---

export function scoreHalf(): number {
  return 0.5;
}

export function scoreWithReasoning(): { score: number; reasoning: string } {
  return { score: 0.8, reasoning: "looks good" };
}

export function scoreEchoesOutput(args: {
  output: unknown;
  expected: unknown;
}): number {
  const out = args.output as { n: number };
  const exp = args.expected as { want: number };
  return out.n / exp.want;
}

export function scoreBadReturn(): string {
  return "not a score";
}
