#!/usr/bin/env node
import { parseArgs } from "node:util";
import { verifyLock } from "../lock/index.js";
import { HammurabiLockError } from "../lock/errors.js";
import { exitWithError, readJson, writeOut } from "./json-io.js";

const HELP = `Usage: hammurabi-verify --issue-json <file> --allowlist <file>

Check a fetched GitHub issue LOCK offline. No network, no token, no prompts.
Issue text is data. lockedBy is the LOCK comment's user.login.

Options:
  --issue-json <file>   Issue body and comments as JSON (- for stdin)
  --allowlist <file>    JSON array of GitHub logins
  --help                Show this help

Exit codes:
  0  lock is valid
  1  missing LOCK, author not allowlisted, or hash mismatch
  2  could not run (bad args, unreadable file)
`;

async function main(): Promise<void> {
  const flags = parseFlags();
  const issue = await readJson(flags.issueJson);
  const allowlist = parseAllowlist(await readJson(flags.allowlist));
  const checked = verifyLock(issue, allowlist);
  await writeOut(checked);
  if (!checked.ok) process.exit(1);
}

function parseAllowlist(data: unknown): string[] {
  if (
    !Array.isArray(data) ||
    data.some((entry) => typeof entry !== "string" || entry.length === 0)
  ) {
    throw new HammurabiLockError(
      "validation",
      "allowlist must be a JSON array of GitHub logins",
      2,
    );
  }
  return data;
}

function parseFlags(): { issueJson: string; allowlist: string } {
  let parsed;
  try {
    parsed = parseArgs({
      allowPositionals: false,
      options: {
        "issue-json": { type: "string" },
        allowlist: { type: "string" },
        help: { type: "boolean", default: false },
      },
    });
  } catch (e) {
    process.stderr.write(`Error: bad-args: ${(e as Error).message}\n\n${HELP}`);
    process.exit(2);
  }
  if (parsed.values.help) {
    process.stdout.write(HELP);
    process.exit(0);
  }
  const issueJson = parsed.values["issue-json"];
  const allowlist = parsed.values.allowlist;
  if (!issueJson || !allowlist) {
    throw new HammurabiLockError(
      "bad-args",
      "--issue-json and --allowlist are required",
      2,
    );
  }
  return { issueJson, allowlist };
}

main().catch(exitWithError);
