import { basename, dirname, join } from "node:path";

/**
 * The committed baseline for a bundle lives next to its spec as
 * `<base>.baseline.report.json`. `hammurabi-run` / `hammurabi-check`
 * auto-discover it for regression detection, and `--update-baseline`
 * (re)writes it once a new result is blessed.
 */
export function baselinePathFor(specPath: string): string {
  const base = basename(specPath)
    .replace(/\.spec\.md$/i, "")
    .replace(/\.md$/i, "");
  return join(dirname(specPath), `${base}.baseline.report.json`);
}
