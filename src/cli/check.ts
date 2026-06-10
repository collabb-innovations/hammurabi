#!/usr/bin/env node
import { existsSync } from "node:fs";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { loadBundle, loadReport } from "../loaders/index.js";
import { run } from "../runner/index.js";
import { formatPreflightFailures, preflightImports } from "../runner/preflight.js";
import type { Report } from "../schema/report.js";
import { baselinePathFor } from "./baseline.js";
import { diffAgainstBaseline } from "./baseline-diff.js";
import {
  bundleEntryForCombined,
  exitCode,
  formatSummary,
  type BundleOutcome,
} from "./check-helpers.js";
import { renderReportMarkdown } from "./report-md.js";

const HELP = `Usage: hammurabi-check <dir> [options]

Discovers every *.spec.md under <dir>, runs each bundle (spec + rubric +
fixtures) against its committed baseline, and aggregates the result. The judge
panel for each bundle comes from its own spec eval block.

Options:
  --update-baseline             Re-bless every bundle's baseline; exit 0
  --no-baseline                 Skip baseline auto-discovery (no regression check)
  --no-preflight                Skip the import-resolution preflight
  --regression-threshold <n>    Per-fixture delta threshold (default: 0.05)
  --out <dir>                   Where to write check-report.json (default: cwd)
  --quiet                       Suppress per-bundle stdout
  --help                        Show this help

Exit codes:
  0  no NEW failures and no regressions (baselined failures are warnings)
  1  any new failure or regression
  2  a bundle could not be loaded or run
`;

async function main(): Promise<void> {
  const {
    dir,
    updateBaseline,
    noBaseline,
    noPreflight,
    regressionThreshold,
    outDir,
    quiet,
  } = parseFlags();

  const specs = await discoverSpecs(dir);
  if (specs.length === 0) {
    fail(`no *.spec.md found under ${dir}`, 2);
  }

  const outcomes: BundleOutcome[] = [];
  for (const specPath of specs) {
    outcomes.push(
      await runBundle(specPath, {
        updateBaseline,
        noBaseline,
        noPreflight,
        regressionThreshold,
      }),
    );
  }

  await writeCombined(outDir, outcomes);
  if (!quiet) process.stdout.write(formatSummary(outcomes, updateBaseline));

  if (updateBaseline) process.exit(0);
  process.exit(exitCode(outcomes));
}

async function runBundle(
  specPath: string,
  opts: {
    updateBaseline: boolean;
    noBaseline: boolean;
    noPreflight: boolean;
    regressionThreshold: number | undefined;
  },
): Promise<BundleOutcome> {
  try {
    const bundle = await loadBundle(specPath);
    if (!opts.noPreflight) {
      const failures = await preflightImports(bundle.spec, bundle.rubric, specPath);
      if (failures.length > 0) {
        return {
          specPath,
          error: `preflight: unresolved import(s)\n${formatPreflightFailures(failures)}`,
        };
      }
    }
    let baseline: Report | undefined;
    if (!opts.noBaseline && !opts.updateBaseline) {
      const auto = baselinePathFor(specPath);
      if (existsSync(auto)) baseline = await loadReport(auto);
    }
    const report = await run({
      ...bundle,
      baseline,
      regressionThreshold: opts.regressionThreshold,
    });
    // Per-bundle reports land next to the spec, matching hammurabi-run.
    const base = specPath.replace(/\.spec\.md$/i, "").replace(/\.md$/i, "");
    await writeFile(`${base}.report.json`, JSON.stringify(report, null, 2));
    await writeFile(`${base}.report.md`, renderReportMarkdown(report));
    if (opts.updateBaseline) {
      await writeFile(baselinePathFor(specPath), JSON.stringify(report, null, 2));
    }
    const diff = diffAgainstBaseline(report, baseline);
    return { specPath, specName: report.specName, report, baseline, diff };
  } catch (e) {
    return { specPath, error: (e as Error).message };
  }
}

async function discoverSpecs(dir: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(d: string): Promise<void> {
    const entries = await readdir(d, { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name.startsWith(".")) continue;
        await walk(join(d, e.name));
      } else if (e.isFile() && e.name.endsWith(".spec.md")) {
        out.push(join(d, e.name));
      }
    }
  }
  await walk(dir);
  return out.sort();
}

async function writeCombined(
  outDir: string,
  outcomes: BundleOutcome[],
): Promise<void> {
  await mkdir(outDir, { recursive: true });
  const combined = {
    checkedAt: new Date().toISOString(),
    bundles: outcomes.map(bundleEntryForCombined),
  };
  await writeFile(
    join(outDir, "check-report.json"),
    JSON.stringify(combined, null, 2),
  );
}

function parseFlags(): {
  dir: string;
  updateBaseline: boolean;
  noBaseline: boolean;
  noPreflight: boolean;
  regressionThreshold: number | undefined;
  outDir: string;
  quiet: boolean;
} {
  let parsed;
  try {
    parsed = parseArgs({
      allowPositionals: true,
      options: {
        "update-baseline": { type: "boolean", default: false },
        "no-baseline": { type: "boolean", default: false },
        "no-preflight": { type: "boolean", default: false },
        "regression-threshold": { type: "string" },
        out: { type: "string" },
        quiet: { type: "boolean", default: false },
        help: { type: "boolean", default: false },
      },
    });
  } catch (e) {
    process.stderr.write(`Error: ${(e as Error).message}\n\n${HELP}`);
    process.exit(2);
  }
  const { positionals, values } = parsed;
  if (values.help) {
    process.stdout.write(HELP);
    process.exit(0);
  }
  if (positionals.length !== 1) {
    process.stderr.write(`Error: expected exactly one positional (a directory)\n\n${HELP}`);
    process.exit(2);
  }

  let regressionThreshold: number | undefined;
  if (values["regression-threshold"] !== undefined) {
    regressionThreshold = Number(values["regression-threshold"]);
    if (!Number.isFinite(regressionThreshold) || regressionThreshold < 0) {
      fail(`--regression-threshold must be a non-negative number`, 2);
    }
  }

  return {
    dir: resolve(positionals[0]),
    updateBaseline: Boolean(values["update-baseline"]),
    noBaseline: Boolean(values["no-baseline"]),
    noPreflight: Boolean(values["no-preflight"]),
    regressionThreshold,
    outDir: values.out ? resolve(values.out) : process.cwd(),
    quiet: Boolean(values.quiet),
  };
}

function fail(message: string, code: 1 | 2): never {
  process.stderr.write(`Error: ${message}\n`);
  process.exit(code);
}

main().catch((e: unknown) => {
  process.stderr.write(`Error: ${(e as Error).message}\n`);
  process.exit(2);
});
