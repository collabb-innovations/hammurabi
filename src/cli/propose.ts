#!/usr/bin/env node
import { parseArgs } from "node:util";
import { propose } from "../lock/index.js";
import { HammurabiLockError } from "../lock/errors.js";
import { exitWithError, parseSourceArg, readJson, writeOut } from "./json-io.js";

const HELP = `Usage: hammurabi-propose --source <adapter>:<ref> --in <draft.json> [options]

Validate a caller-supplied draft, read the source, and write a Proposal.
No prompts. JSON on stdout, diagnostics on stderr.

Options:
  --source <adapter>:<ref>   github-issues:owner/repo#N or text:<path> or text:-
  --in <draft.json>          Draft decisions and options (- for stdin)
  --publish                  Opt-in write: render the checklist back to the source
  --out <file>               Write the proposal to a file instead of stdout
  --help                     Show this help

Exit codes:
  0  ok
  1  validation failure
  2  could not run (bad args, missing source, credential or network error)
`;

async function main(): Promise<void> {
  const flags = parseFlags();
  if (flags.source.ref === "-" && flags.inPath === "-") {
    throw new HammurabiLockError(
      "bad-args",
      "stdin can feed --source text:- or --in -, not both",
      2,
    );
  }
  const draft = await readJson(flags.inPath);
  const proposal = await propose({
    source: flags.source,
    draft,
    publish: flags.publish,
  });
  await writeOut(proposal, flags.out);
}

function parseFlags(): {
  source: ReturnType<typeof parseSourceArg>;
  inPath: string;
  publish: boolean;
  out?: string;
} {
  let parsed;
  try {
    parsed = parseArgs({
      allowPositionals: false,
      options: {
        source: { type: "string" },
        in: { type: "string" },
        publish: { type: "boolean", default: false },
        out: { type: "string" },
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
  if (!parsed.values.source || !parsed.values.in) {
    throw new HammurabiLockError(
      "bad-args",
      "--source and --in are required",
      2,
    );
  }
  return {
    source: parseSourceArg(parsed.values.source),
    inPath: parsed.values.in,
    publish: Boolean(parsed.values.publish),
    out: parsed.values.out,
  };
}

main().catch(exitWithError);
