#!/usr/bin/env node
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { loadBundle, loadReport } from "../loaders/index.js";
import type { Bundle } from "../loaders/index.js";
import { run } from "../runner/index.js";
import { formatPreflightFailures, preflightImports } from "../runner/preflight.js";
import type { Aggregator, JudgeConfig } from "../runner/types.js";
import type { Report } from "../schema/report.js";
import { baselinePathFor } from "./baseline.js";
import { diffAgainstBaseline } from "./baseline-diff.js";
import { renderReportMarkdown } from "./report-md.js";

const HELP = `Usage: hammurabi-run <spec-path> [options]

Options:
  --judges <models>             Comma-separated judge model strings
                                (default: claude-haiku-4-5)
  --aggregator <mode>           mean | median | min | max (default: mean)
  --baseline <path>             Path to prior report.json for regression check
                                (default: auto-discover <base>.baseline.report.json)
  --no-baseline                 Skip auto-discovery of a sibling baseline
  --update-baseline             Write this run as the committed baseline and exit 0
  --regression-threshold <n>    Per-fixture delta threshold (default: 0.05)
  --out <dir>                   Output directory (default: alongside spec)
  --format <fmt>                json | md | both (default: both)
  --filter <ids>                Comma-separated fixture ids to run (subset)
  --limit <n>                   Run only the first N fixtures
  --no-preflight                Skip the import-resolution preflight
  --quiet                       Suppress stdout summary
  --help                        Show this help

Exit codes:
  0  no NEW failures and no regressions (baselined failures are warnings)
  1  any new failure or regression
  2  could not run (bad args, malformed bundle, runner error)
`;

const ALLOWED_AGGREGATORS = ["mean", "median", "min", "max"] as const;
const ALLOWED_FORMATS = ["json", "md", "both"] as const;

interface ParsedFlags {
  specPath: string;
  judges: JudgeConfig[] | undefined;
  aggregator: Aggregator | undefined;
  baseline: Report | undefined;
  regressionThreshold: number | undefined;
  outDir: string;
  format: (typeof ALLOWED_FORMATS)[number];
  filter: string[] | undefined;
  limit: number | undefined;
  updateBaseline: boolean;
  noPreflight: boolean;
  quiet: boolean;
}

async function main(): Promise<void> {
  const flags = await parseFlags();

  let bundle: Bundle;
  try {
    bundle = await loadBundle(flags.specPath);
  } catch (e) {
    die(`could not load bundle: ${(e as Error).message}`);
  }

  if (flags.updateBaseline && (flags.filter || flags.limit !== undefined)) {
    die("--update-baseline cannot be combined with --filter/--limit (it would bless a partial suite)");
  }

  if (!flags.noPreflight) {
    const failures = await preflightImports(bundle!.spec, bundle!.rubric, flags.specPath);
    if (failures.length > 0) {
      die(`preflight: unresolved import(s)\n${formatPreflightFailures(failures)}`);
    }
  }

  bundle = { ...bundle!, fixtures: applyFixtureFilter(bundle!.fixtures, flags) };

  let report: Report;
  try {
    report = await run({
      ...bundle,
      judges: flags.judges,
      aggregator: flags.aggregator,
      baseline: flags.baseline,
      regressionThreshold: flags.regressionThreshold,
    });
  } catch (e) {
    die(`runner failed: ${(e as Error).message}`);
  }

  const paths = await writeReports(flags, report!);
  const diff = diffAgainstBaseline(report!, flags.baseline);

  if (!flags.quiet) {
    process.stdout.write(formatCliSummary(report!, flags, paths, diff));
  }

  if (flags.updateBaseline) {
    const blessPath = baselinePathFor(flags.specPath);
    await writeFile(blessPath, JSON.stringify(report!, null, 2));
    if (!flags.quiet) {
      process.stdout.write(`  baseline updated: ${blessPath}\n`);
    }
    process.exit(0);
  }

  // New-failures (not in baseline) and regressions break the gate; baselined
  // failures stay quiet — see issue #12 for the policy rationale.
  const hasNewFailure = diff.newFailures.length > 0;
  const hasErrored = report!.summary.errored > 0;
  const hasRegression = (report!.summary.regressions?.length ?? 0) > 0;
  process.exit(hasNewFailure || hasErrored || hasRegression ? 1 : 0);
}

async function parseFlags(): Promise<ParsedFlags> {
  let parsed;
  try {
    parsed = parseArgs({
      allowPositionals: true,
      options: {
        judges: { type: "string" },
        aggregator: { type: "string" },
        baseline: { type: "string" },
        "regression-threshold": { type: "string" },
        out: { type: "string" },
        format: { type: "string", default: "both" },
        filter: { type: "string" },
        limit: { type: "string" },
        "no-baseline": { type: "boolean", default: false },
        "no-preflight": { type: "boolean", default: false },
        "update-baseline": { type: "boolean", default: false },
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
    process.stderr.write(
      `Error: expected exactly one positional argument (spec path)\n\n${HELP}`,
    );
    process.exit(2);
  }

  const specPath = resolve(positionals[0]);

  const judges: JudgeConfig[] | undefined = values.judges
    ? values.judges.split(",").map((m) => ({ model: m.trim() }))
    : undefined;

  let aggregator: Aggregator | undefined;
  if (values.aggregator !== undefined) {
    if (!ALLOWED_AGGREGATORS.includes(values.aggregator as never)) {
      die(`--aggregator must be one of ${ALLOWED_AGGREGATORS.join("|")}`);
    }
    aggregator = values.aggregator as Aggregator;
  }

  let regressionThreshold: number | undefined;
  if (values["regression-threshold"] !== undefined) {
    regressionThreshold = Number(values["regression-threshold"]);
    if (!Number.isFinite(regressionThreshold) || regressionThreshold < 0) {
      die(
        `--regression-threshold must be a non-negative finite number (got ${values["regression-threshold"]})`,
      );
    }
  }

  let baseline: Report | undefined;
  if (values.baseline !== undefined) {
    const baselinePath = resolve(values.baseline);
    try {
      baseline = await loadReport(baselinePath);
    } catch (e) {
      die((e as Error).message);
    }
  } else if (!values["no-baseline"] && !values["update-baseline"]) {
    // Auto-discover a committed sibling baseline for regression detection.
    const auto = baselinePathFor(specPath);
    if (existsSync(auto)) {
      try {
        baseline = await loadReport(auto);
      } catch (e) {
        die(`auto-discovered baseline ${auto} is invalid: ${(e as Error).message}`);
      }
    }
  }

  const format = (values.format ?? "both") as string;
  if (!ALLOWED_FORMATS.includes(format as never)) {
    die(`--format must be one of ${ALLOWED_FORMATS.join("|")}`);
  }

  const outDir = values.out ? resolve(values.out) : dirname(specPath);

  const filter = values.filter
    ? values.filter
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined;

  let limit: number | undefined;
  if (values.limit !== undefined) {
    limit = Number(values.limit);
    if (!Number.isInteger(limit) || limit < 1) {
      die(`--limit must be a positive integer (got ${values.limit})`);
    }
  }

  return {
    specPath,
    judges,
    aggregator,
    baseline,
    regressionThreshold,
    outDir,
    format: format as ParsedFlags["format"],
    filter,
    limit,
    updateBaseline: Boolean(values["update-baseline"]),
    noPreflight: Boolean(values["no-preflight"]),
    quiet: Boolean(values.quiet),
  };
}

function applyFixtureFilter(
  fixtures: Bundle["fixtures"],
  flags: ParsedFlags,
): Bundle["fixtures"] {
  let selected = fixtures.fixtures;
  if (flags.filter) {
    const wanted = new Set(flags.filter);
    selected = selected.filter((f) => wanted.has(f.id));
  }
  if (flags.limit !== undefined) {
    selected = selected.slice(0, flags.limit);
  }
  if (selected.length === 0) {
    die("no fixtures matched --filter/--limit");
  }
  return { ...fixtures, fixtures: selected };
}

async function writeReports(
  flags: ParsedFlags,
  report: Report,
): Promise<{ jsonPath: string; mdPath: string }> {
  await mkdir(flags.outDir, { recursive: true });
  const base = basename(flags.specPath)
    .replace(/\.spec\.md$/i, "")
    .replace(/\.md$/i, "");
  const jsonPath = `${flags.outDir}/${base}.report.json`;
  const mdPath = `${flags.outDir}/${base}.report.md`;
  if (flags.format !== "md") {
    await writeFile(jsonPath, JSON.stringify(report, null, 2));
  }
  if (flags.format !== "json") {
    await writeFile(mdPath, renderReportMarkdown(report));
  }
  return { jsonPath, mdPath };
}

function formatCliSummary(
  report: Report,
  flags: ParsedFlags,
  paths: { jsonPath: string; mdPath: string },
  diff: { newFailures: string[]; knownFailures: string[]; improvements: string[] },
): string {
  const s = report.summary;
  const regCount = s.regressions?.length ?? 0;
  const newFails = diff.newFailures.length;
  const knownFails = diff.knownFailures.length;
  const imps = diff.improvements.length;
  const status =
    newFails === 0 && s.errored === 0 && regCount === 0 ? "PASS" : "FAIL";
  const annotations: string[] = [
    `${s.passed}/${s.totalFixtures} passed`,
    `weighted ${s.weightedScore.toFixed(3)}`,
    `regressions ${regCount}`,
  ];
  if (newFails > 0) annotations.push(`new-fail ${newFails}`);
  if (knownFails > 0) annotations.push(`known-fail ${knownFails}`);
  if (imps > 0) annotations.push(`improvement ${imps}`);
  const lines = [`${status}  ${annotations.join("  ")}`];
  if (flags.format !== "md") lines.push(`  json: ${paths.jsonPath}`);
  if (flags.format !== "json") lines.push(`  md:   ${paths.mdPath}`);
  if (imps > 0) {
    lines.push(
      `  ❍ baselined failures now passing — re-bless with --update-baseline`,
    );
  }
  return lines.join("\n") + "\n";
}

function die(message: string): never {
  process.stderr.write(`Error: ${message}\n`);
  process.exit(2);
}

main().catch((e: unknown) => {
  process.stderr.write(`Error: ${(e as Error).message}\n`);
  process.exit(2);
});
