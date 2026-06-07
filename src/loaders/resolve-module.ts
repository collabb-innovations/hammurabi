import { dirname, isAbsolute, resolve as pathResolve } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Resolve a module specifier authored in an artifact (spec target, code-scored
 * criterion) into something `import()` can load from any resolution context:
 *   - URL-scheme specifiers (file://, node:, npm:) pass through untouched.
 *   - Absolute filesystem paths become file:// URLs.
 *   - Relative/path-like specifiers resolve against the artifact's directory.
 *   - Bare npm specifiers (e.g. "lodash") pass through for normal resolution.
 */
export function resolveModuleSpecifier(
  baseFilePath: string,
  module: string,
): string {
  if (isUrlScheme(module)) return module;
  if (isAbsolute(module)) return pathToFileURL(module).href;
  if (isPathLike(module)) {
    return pathToFileURL(pathResolve(dirname(baseFilePath), module)).href;
  }
  return module;
}

function isUrlScheme(s: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(s);
}

function isPathLike(s: string): boolean {
  if (s.startsWith("./") || s.startsWith("../")) return true;
  if (/\.(c|m)?[jt]sx?$/i.test(s)) return true;
  return false;
}
