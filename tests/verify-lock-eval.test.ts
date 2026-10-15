import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyLock } from "../src/lock/index.js";
import { hashValue } from "../src/lock/jcs.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const fixtures = join(root, "tests/fixtures/verify-lock");
const cases = ["valid", "not-allowlisted", "edited", "forged", "missing"] as const;

function childEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.GITHUB_TOKEN;
  delete env.HAMMURABI_GITHUB_API;
  return env;
}

function runCli(args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", "src/cli/verify.ts", ...args], {
      cwd: root,
      env: childEnv(),
      stdio: ["ignore", "pipe", "pipe"],
      signal: AbortSignal.timeout(20000),
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (d) => {
      stdout += d;
    });
    child.stderr.on("data", (d) => {
      stderr += d;
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

for (const name of cases) {
  test(`verify-lock fixture: ${name}`, async () => {
    const issue = JSON.parse(await readFile(join(fixtures, `${name}.json`), "utf8")) as {
      body?: string;
    };
    const allowlist = JSON.parse(await readFile(join(fixtures, "allowlist.json"), "utf8")) as string[];
    const expected = JSON.parse(await readFile(join(fixtures, `${name}.expected.json`), "utf8"));
    const checked = verifyLock(issue, allowlist);
    assert.deepEqual(checked, expected);
    if (name === "valid") assert.equal(checked.hash, hashValue(issue.body));
    if (name === "edited") assert.notEqual(hashValue(issue.body), checked.hash);
    if (name === "forged") assert.equal(checked.lockedBy, "mallory");

    const cli = await runCli([
      "--issue-json",
      join(fixtures, `${name}.json`),
      "--allowlist",
      join(fixtures, "allowlist.json"),
    ]);
    assert.equal(cli.code, expected.ok ? 0 : 1);
    assert.equal(cli.stderr, "");
    assert.deepEqual(JSON.parse(cli.stdout), expected);

    if (name === "forged") {
      const flagged = await runCli([
        "--issue-json",
        join(fixtures, "forged.json"),
        "--allowlist",
        join(fixtures, "allowlist.json"),
        "--locked-by",
        "justin",
      ]);
      assert.equal(flagged.code, 2);
      assert.equal(flagged.stdout, "");
      assert.match(flagged.stderr, /bad-args/);
    }
  });
}
