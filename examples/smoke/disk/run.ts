import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { loadBundle, run } from "../../../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const specPath = resolve(here, "uppercase.spec.md");

const bundle = await loadBundle(specPath);

const judgesEnv = process.env.HAMMURABI_SMOKE_JUDGES;
const aggEnv = process.env.HAMMURABI_SMOKE_AGGREGATOR;

const judges = judgesEnv
  ? judgesEnv.split(",").map((m) => ({ model: m.trim() }))
  : undefined;
const aggregator = (aggEnv as "mean" | "median" | "min" | "max" | undefined) ??
  undefined;

const report = await run({
  ...bundle,
  ...(judges ? { judges } : {}),
  ...(aggregator ? { aggregator } : {}),
});

console.log(JSON.stringify(report, null, 2));
