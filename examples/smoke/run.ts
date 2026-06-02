import { run } from "../../src/index.js";
import type { FixtureSet, Rubric, Spec } from "../../src/schema/index.js";

const implUrl = new URL("./impl.ts", import.meta.url).href;

const spec: Spec = {
  frontmatter: {
    name: "uppercase",
    version: "0.0.1",
    description: "Converts strings to uppercase",
    target: {
      kind: "function",
      module: implUrl,
      export: "upper",
    },
  },
  body: "Returns the input string with all alphabetic characters in uppercase. Non-alphabetic characters (digits, spaces, punctuation) pass through unchanged. Empty input returns empty string.",
};

const rubric: Rubric = {
  specName: "uppercase",
  specVersion: "0.0.1",
  passThreshold: 0.5,
  criteria: [
    {
      id: "is-uppercase",
      name: "Output is uppercase",
      description:
        "All alphabetic characters in the output are uppercase. Non-alphabetic characters pass through unchanged.",
      weight: 1.0,
      scale: { kind: "pass-fail" },
    },
  ],
};

const fixtures: FixtureSet = {
  specName: "uppercase",
  specVersion: "0.0.1",
  fixtures: [
    {
      id: "happy",
      input: "hello",
      expected: "HELLO",
      tags: ["happy-path"],
    },
    {
      id: "empty",
      input: "",
      expected: "",
      tags: ["edge:empty-input"],
    },
    {
      id: "mixed",
      input: "HeLLo World 123",
      expected: "HELLO WORLD 123",
      tags: ["happy-path"],
    },
  ],
};

const judgesEnv = process.env.HAMMURABI_SMOKE_JUDGES;
const aggEnv = process.env.HAMMURABI_SMOKE_AGGREGATOR;

const judges = judgesEnv
  ? judgesEnv.split(",").map((m) => ({ model: m.trim() }))
  : undefined;
const aggregator = (aggEnv as "mean" | "median" | "min" | "max" | undefined) ??
  undefined;

const report = await run({
  spec,
  rubric,
  fixtures,
  ...(judges ? { judges } : {}),
  ...(aggregator ? { aggregator } : {}),
});

console.log(JSON.stringify(report, null, 2));
