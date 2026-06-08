import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRubric } from "../src/loaders/rubric.js";

const valid = {
  specName: "foo",
  specVersion: "1.0.0",
  passThreshold: 0.5,
  criteria: [
    {
      id: "is-correct",
      name: "Is correct",
      description: "Output is correct",
      weight: 1.0,
      scale: { kind: "pass-fail" },
    },
  ],
};

test("parseRubric accepts a valid rubric", () => {
  const r = parseRubric(JSON.stringify(valid));
  assert.equal(r.specName, "foo");
  assert.equal(r.criteria.length, 1);
});

test("parseRubric rejects missing specName", () => {
  const r = { ...valid } as Partial<typeof valid>;
  delete r.specName;
  assert.throws(() => parseRubric(JSON.stringify(r)), /specName/);
});

test("parseRubric rejects empty criteria array", () => {
  assert.throws(
    () => parseRubric(JSON.stringify({ ...valid, criteria: [] })),
    /criteria/,
  );
});

test("parseRubric rejects weight > 1", () => {
  assert.throws(
    () =>
      parseRubric(
        JSON.stringify({
          ...valid,
          criteria: [{ ...valid.criteria[0], weight: 1.5 }],
        }),
      ),
    /weight/,
  );
});

test("parseRubric rejects ordinal scale with max <= min", () => {
  const ordinalBad = {
    ...valid,
    criteria: [
      {
        ...valid.criteria[0],
        scale: { kind: "ordinal", min: 5, max: 5 },
      },
    ],
  };
  assert.throws(() => parseRubric(JSON.stringify(ordinalBad)), /max.*min/);
});

test("parseRubric rejects passThreshold > 1", () => {
  assert.throws(
    () => parseRubric(JSON.stringify({ ...valid, passThreshold: 1.5 })),
    /passThreshold/,
  );
});

test("parseRubric rejects malformed JSON", () => {
  assert.throws(() => parseRubric("{ not json"), /Invalid rubric JSON/);
});

test("parseRubric accepts a code-scored criterion evaluator", () => {
  const withCode = {
    ...valid,
    criteria: [
      {
        ...valid.criteria[0],
        evaluator: { kind: "code", module: "./evaluators.ts", export: "recall" },
      },
    ],
  };
  const r = parseRubric(JSON.stringify(withCode));
  assert.equal(r.criteria[0].evaluator?.kind, "code");
});

test("parseRubric rejects a code evaluator missing its export", () => {
  const bad = {
    ...valid,
    criteria: [
      {
        ...valid.criteria[0],
        evaluator: { kind: "code", module: "./evaluators.ts" },
      },
    ],
  };
  assert.throws(() => parseRubric(JSON.stringify(bad)), /export/);
});

test("parseRubric warns (does not throw) when weights drift from 1.0", () => {
  const drifted = {
    ...valid,
    criteria: [
      { ...valid.criteria[0], weight: 0.3 },
      {
        ...valid.criteria[0],
        id: "second",
        weight: 0.3,
        scale: { kind: "pass-fail" },
      },
    ],
  };
  const originalWarn = console.warn;
  const captured: string[] = [];
  console.warn = (msg: string) => {
    captured.push(msg);
  };
  try {
    const r = parseRubric(JSON.stringify(drifted));
    assert.equal(r.criteria.length, 2);
    assert.ok(
      captured.some((m) => m.includes("weights summing to")),
      "expected weight-drift warning",
    );
  } finally {
    console.warn = originalWarn;
  }
});
