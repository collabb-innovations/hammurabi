import type { FixtureResult, Report } from "../schema/report.js";

export function renderReportMarkdown(report: Report): string {
  const sections = [
    `# Eval Report — ${cell(report.specName)} v${cell(report.specVersion)}`,
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
  const judgeModels = report.judges.map((j) => cell(j.model)).join(", ");
  return [
    `- **Run ID**: ${cell(report.runId)}`,
    `- **Started**: ${cell(report.startedAt)}`,
    `- **Judges**: ${judgeModels}`,
    `- **Aggregator**: ${cell(report.aggregator)}`,
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
    const tags = r.tags?.map(cell).join(", ") ?? "";
    return `| ${cell(r.fixtureId)} | ${tags} | ${r.weightedScore.toFixed(2)} | ${statusIcon(r)} |`;
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
      `### ${cell(r.fixtureId)} — ${statusIcon(r)} errored`,
      "",
      `Error: ${inlineCode(r.error)}`,
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
    return `| ${cell(s.criterionId)} | ${weight} | ${s.score.toFixed(2)} | ${notes} |`;
  });

  // Criteria that sat this fixture out. Shown, not omitted: a criterion missing
  // from the table is how a silently-disabled one looks too.
  const inapplicableRows = (r.inapplicable ?? []).map((id) => {
    const c = report.criteria.find((cr) => cr.id === id);
    const weight = c ? c.weight.toFixed(2) : "?";
    return `| ${cell(id)} | ${weight} | — | does not apply to this fixture |`;
  });

  const voteSections = r.scores
    .map((s) => {
      const lines = s.judgeVotes
        .map((v) => {
          const errSuffix = v.error
            ? ` _(judge errored: ${detailsBody(v.error)})_`
            : "";
          return `- **${detailsBody(v.model)}** (${v.score.toFixed(2)}): ${detailsBody(v.reasoning)}${errSuffix}`;
        })
        .join("\n");
      return `**Criterion: ${detailsBody(s.criterionId)}**\n${lines}`;
    })
    .join("\n\n");

  return [
    `### ${cell(r.fixtureId)} — ${statusIcon(r)} (weighted ${r.weightedScore.toFixed(2)})`,
    "",
    "| Criterion | Weight | Score | Notes |",
    "|---|---:|---:|---|",
    ...criterionRows,
    ...inapplicableRows,
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
      `| ${cell(r.fixtureId)} | ${r.baselineScore.toFixed(2)} | ${r.currentScore.toFixed(2)} | ${r.delta >= 0 ? "+" : ""}${r.delta.toFixed(2)} |`,
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

// Escape helpers — defang user/judge-controlled text against markdown breakage.

function cell(value: unknown): string {
  // Table cells: pipes break columns, newlines break rows. Collapse both.
  return String(value).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function inlineCode(value: unknown): string {
  // Single-backtick code span. Embed any backticks would close the span;
  // swap to a longer fence when the content contains them.
  const s = String(value);
  if (!s.includes("`")) return "`" + s.replace(/\r?\n/g, " ") + "`";
  return "`` " + s.replace(/`/g, "​`​").replace(/\r?\n/g, " ") + " ``";
}

function detailsBody(value: unknown): string {
  // Inside a <details> block, a literal </details> or </summary> would
  // close the block prematurely. Inject a zero-width space so the text
  // still reads correctly but the HTML parser sees a different tag.
  return String(value).replace(
    /<\/(details|summary)>/gi,
    (_, tag: string) => `</​${tag}>`,
  );
}
