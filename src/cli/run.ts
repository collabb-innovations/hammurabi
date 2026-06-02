#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { loadBundle, loadReport } from "../loaders/index.js";
import { run } from "../runner/index.js";
import type { Aggregator, JudgeConfig } from "../runner/types.js";
import type { Report } from "../schema/report.js";
import { renderReportMarkdown } from "./report-md.js";

const HELP = `Usage: hammurabi-run <spec-path> [options]

Options:
  --judges <models>             Comma-separated judge model strings
                                (default: claude-haiku-4-5)
  --aggregator <mode>           mean | median | min | max (default: mean)
  --baseline <path>             Path to prior report.json for regression check
  --regression-threshold <n>    Per-fixture delta threshold (default: 0.05)
  --out <dir>                   Output directory (default: alongside spec)
  --format <fmt>                json | md | both (default: both)
  --quiet                       Suppress stdout summary
  --help                        Show this help

Exit codes:
  0  all fixtures passed, no regressions
  1  any failure or regression
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
  quiet: boolean;
}

async function main(): Promise<void> {
  const flags = await parseFlags();

  let bundle;
  try {
    bundle = await loadBundle(flags.specPath);
  } catch (e) {
    die(`could not load bundle: ${(e as Error).message}`);
  }

  let report: Report;
  try {
    report = await run({
      ...bundle!,
      judges: flags.judges,
      aggregator: flags.aggregator,
      baseline: flags.baseline,
      regressionThreshold: flags.regressionThreshold,
    });
  } catch (e) {
    die(`runner failed: ${(e as Error).message}`);
  }

  const paths = await writeReports(flags, report!);

  if (!flags.quiet) {
    process.stdout.write(formatCliSummary(report!, flags, paths));
  }

  const hasFailure =
    report!.summary.failed > 0 || report!.summary.errored > 0;
  const hasRegression = (report!.summary.regressions?.length ?? 0) > 0;
  process.exit(hasFailure || hasRegression ? 1 : 0);
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
  }

  const format = (values.format ?? "both") as string;
  if (!ALLOWED_FORMATS.includes(format as never)) {
    die(`--format must be one of ${ALLOWED_FORMATS.join("|")}`);
  }

  const outDir = values.out ? resolve(values.out) : dirname(specPath);

  return {
    specPath,
    judges,
    aggregator,
    baseline,
    regressionThreshold,
    outDir,
    format: format as ParsedFlags["format"],
    quiet: Boolean(values.quiet),
  };
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
): string {
  const s = report.summary;
  const regCount = s.regressions?.length ?? 0;
  const status =
    s.failed === 0 && s.errored === 0 && regCount === 0 ? "PASS" : "FAIL";
  const lines = [
    `${status}  ${s.passed}/${s.totalFixtures} passed  weighted ${s.weightedScore.toFixed(3)}  regressions ${regCount}`,
  ];
  if (flags.format !== "md") lines.push(`  json: ${paths.jsonPath}`);
  if (flags.format !== "json") lines.push(`  md:   ${paths.mdPath}`);
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
