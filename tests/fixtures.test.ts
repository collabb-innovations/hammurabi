import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFixtures } from "../src/loaders/fixtures.js";

const header = `{"specName":"foo","specVersion":"1.0.0"}`;
const f1 = `{"id":"a","input":"hello"}`;
const f2 = `{"id":"b","input":"world","tags":["t"]}`;

test("parseFixtures accepts a valid JSONL set", () => {
  const set = parseFixtures(`${header}\n${f1}\n${f2}\n`);
  assert.equal(set.specName, "foo");
  assert.equal(set.specVersion, "1.0.0");
  assert.equal(set.fixtures.length, 2);
  assert.equal(set.fixtures[0].id, "a");
});

test("parseFixtures tolerates trailing newline", () => {
  const set = parseFixtures(`${header}\n${f1}\n\n`);
  assert.equal(set.fixtures.length, 1);
});

test("parseFixtures tolerates blank lines between entries", () => {
  const set = parseFixtures(`${header}\n\n${f1}\n\n${f2}\n`);
  assert.equal(set.fixtures.length, 2);
});

test("parseFixtures rejects empty content", () => {
  assert.throws(() => parseFixtures(""), /empty/);
});

test("parseFixtures rejects header-only file", () => {
  assert.throws(
    () => parseFixtures(`${header}\n`),
    /header present but no fixture lines/,
  );
});

test("parseFixtures rejects missing specName in header", () => {
  assert.throws(
    () => parseFixtures(`{"specVersion":"1.0.0"}\n${f1}\n`),
    /specName/,
  );
});

test("parseFixtures rejects malformed JSON on a fixture line, with line number", () => {
  const content = `${header}\n${f1}\n{ broken\n`;
  assert.throws(
    () => parseFixtures(content, "foo.fixtures.jsonl"),
    /foo\.fixtures\.jsonl:3/,
  );
});

test("parseFixtures rejects fixture missing id, with line number", () => {
  const content = `${header}\n{"input":"no-id"}\n`;
  assert.throws(
    () => parseFixtures(content, "foo.fixtures.jsonl"),
    /foo\.fixtures\.jsonl:2/,
  );
});

test("parseFixtures rejects header line that is not valid JSON", () => {
  assert.throws(
    () => parseFixtures("not json\n" + f1 + "\n", "foo.fixtures.jsonl"),
    /header at foo\.fixtures\.jsonl:1/,
  );
});
