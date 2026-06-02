import type { FixtureResult, Report } from "../schema/report.js";

export function renderReportMarkdown(report: Report): string {
  const sections = [
    `# Eval Report — ${report.specName} v${report.specVersion}`,
    "",
    renderHeader(report),
    renderFixtureTable(report),
    renderPerFixtureDetail(report),
  ];
  if (report.summary.regressions && report.summary.regressions.length > 0) {
    sections.push(renderRegressions(report));
  }
  return sections.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

function renderHeader(report: Report): string {
  const s = report.summary;
  const regCount = s.regressions?.length ?? 0;
  const regSuffix =
    s.regressions === undefined ? " (no baseline)" : " (vs baseline)";
  const judgeModels = report.judges.map((j) => j.model).join(", ");
  return [
    `- **Run ID**: ${report.runId}`,
    `- **Started**: ${report.startedAt}`,
    `- **Judges**: ${judgeModels}`,
    `- **Aggregator**: ${report.aggregator}`,
    `- **Overall**: ${s.passed}/${s.totalFixtures} passed (weighted **${s.weightedScore.toFixed(3)}**)`,
    `- **Regressions**: ${regCount}${regSuffix}`,
    "",
  ].join("\n");
}

function statusIcon(r: FixtureResult): string {
  if (r.error) return "⚠";
  return r.passed ? "✓" : "✗";
}

function renderFixtureTable(report: Report): string {
  const rows = report.results.map((r) => {
    const tags = r.tags?.join(", ") ?? "";
    return `| ${r.fixtureId} | ${tags} | ${r.weightedScore.toFixed(2)} | ${statusIcon(r)} |`;
  });
  return [
    "## Fixtures",
    "",
    "| ID | Tags | Score | Status |",
    "|---|---|---:|:---:|",
    ...rows,
    "",
  ].join("\n");
}

function renderPerFixtureDetail(report: Report): string {
  const sections = report.results.map((r) => renderFixtureDetail(report, r));
  return ["## Per-fixture detail", "", ...sections].join("\n");
}

function renderFixtureDetail(report: Report, r: FixtureResult): string {
  if (r.error) {
    return [
      `### ${r.fixtureId} — ${statusIcon(r)} errored`,
      "",
      `Error: \`${r.error}\``,
      "",
      "(no scores — the target failed or the fixture could not be executed)",
      "",
    ].join("\n");
  }

  const criterionRows = r.scores.map((s) => {
    const c = report.criteria.find((cr) => cr.id === s.criterionId);
    const weight = c ? c.weight.toFixed(2) : "?";
    const judgeCount = s.judgeVotes.length;
    const notes = `${judgeCount} judge${judgeCount === 1 ? "" : "s"}`;
    return `| ${s.criterionId} | ${weight} | ${s.score.toFixed(2)} | ${notes} |`;
  });

  const voteSections = r.scores
    .map((s) => {
      const lines = s.judgeVotes
        .map((v) => {
          const errSuffix = v.error
            ? ` _(judge errored: ${v.error})_`
            : "";
          return `- **${v.model}** (${v.score.toFixed(2)}): ${v.reasoning}${errSuffix}`;
        })
        .join("\n");
      return `**Criterion: ${s.criterionId}**\n${lines}`;
    })
    .join("\n\n");

  return [
    `### ${r.fixtureId} — ${statusIcon(r)} (weighted ${r.weightedScore.toFixed(2)})`,
    "",
    "| Criterion | Weight | Score | Notes |",
    "|---|---:|---:|---|",
    ...criterionRows,
    "",
    "<details>",
    "<summary>Judge votes</summary>",
    "",
    voteSections,
    "",
    "</details>",
    "",
  ].join("\n");
}

function renderRegressions(report: Report): string {
  const rows = report.summary.regressions!.map(
    (r) =>
      `| ${r.fixtureId} | ${r.baselineScore.toFixed(2)} | ${r.currentScore.toFixed(2)} | ${r.delta >= 0 ? "+" : ""}${r.delta.toFixed(2)} |`,
  );
  return [
    "## Regressions",
    "",
    "| Fixture | Baseline | Current | Δ |",
    "|---|---:|---:|---:|",
    ...rows,
    "",
  ].join("\n");
}
