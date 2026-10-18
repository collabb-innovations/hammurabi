import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { fileURLToPath } from "node:url";

const esbuild = fileURLToPath(
  new URL("../node_modules/esbuild/bin/esbuild", import.meta.url),
);
const outfile = "/tmp/hammurabi-worker.js";
const metafile = "/tmp/hammurabi-worker-meta.json";

const proc = spawnSync(
  esbuild,
  [
    "src/worker.ts",
    "--bundle",
    "--platform=neutral",
    "--conditions=workerd,worker",
    "--format=esm",
    `--outfile=${outfile}`,
    `--metafile=${metafile}`,
  ],
  { stdio: "inherit" },
);

if (proc.status !== 0) {
  process.exit(proc.status ?? 1);
}

const builtins = new Set(builtinModules);
for (const name of builtinModules) {
  builtins.add(name.startsWith("node:") ? name.slice(5) : `node:${name}`);
}

const problems = [];
const js = readFileSync(outfile, "utf8");
if (/\bnode:[\w/.-]+/.test(js)) problems.push("bundle contains a node: import");
if (/process\.env/.test(js)) problems.push("bundle contains process.env");
if (/\bimport\s*\(/.test(js)) problems.push("bundle contains a dynamic import");
if (/\brequire\s*\(/.test(js)) problems.push("bundle contains require()");

const meta = JSON.parse(readFileSync(metafile, "utf8"));
const files = new Set([
  ...Object.keys(meta.inputs ?? {}),
  ...Object.values(meta.outputs ?? {}).flatMap((output) =>
    Object.keys(output.inputs ?? {}),
  ),
]);

function isBuiltin(specifier) {
  if (!specifier) return false;
  if (specifier.startsWith("node:")) return true;
  return builtins.has(specifier);
}

function checkImport(owner, imp) {
  const specifier = imp.path || imp.original || "";
  if (isBuiltin(specifier) || isBuiltin(imp.original)) {
    problems.push(`${owner} imports builtin ${imp.original || specifier}`);
  }
  if (imp.external) {
    problems.push(`${owner} has unresolved import ${imp.original || specifier}`);
  }
  if (imp.kind === "dynamic-import") {
    problems.push(`${owner} has dynamic import ${imp.original || specifier}`);
  }
}

for (const [file, info] of Object.entries(meta.inputs ?? {})) {
  for (const imp of info.imports ?? []) checkImport(file, imp);
  const text = readFileSync(file, "utf8");
  if (/node:[\w/.-]+/.test(text)) problems.push(`${file} contains node:`);
  if (/process\.env/.test(text)) problems.push(`${file} contains process.env`);
}

for (const [file, info] of Object.entries(meta.outputs ?? {})) {
  for (const imp of info.imports ?? []) checkImport(file, imp);
}

if (problems.length) {
  console.error("worker bundle is not workerd-safe:");
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}

console.log(
  `ok — worker bundle (${files.size} inputs) has no node builtins, process.env, or dynamic imports`,
);
