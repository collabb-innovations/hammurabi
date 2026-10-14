#!/usr/bin/env node
import { parseArgs } from "node:util";
import { select } from "../lock/index.js";
import { HammurabiLockError } from "../lock/errors.js";
import { exitWithError, parseSourceArg, readJson, writeOut } from "./json-io.js";

const HELP = `Usage: hammurabi-select --proposal <proposal.json> [options]

Read checkbox selections from a source and optional explicit file.
The explicit file overrides parsed checkboxes per decision.
No prompts. JSON on stdout, diagnostics on stderr.

Options:
  --proposal <proposal.json>   Proposal to select against
  --source <adapter>:<ref>     github-issues:owner/repo#N or text:<path> or text:-
  --selection <file>           Explicit choices; overrides checkboxes per decision
  --selected-by <name>         Recorded on the selection
  --out <file>                 Write the selection to a file instead of stdout
  --help                       Show this help

Exit codes:
  0  ok
  1  validation failure (undecided, over-selected, proposal mismatch)
  2  could not run (bad args, missing source, credential or network error)
`;

async function main(): Promise<void> {
  const flags = parseFlags();
  const proposal = await readJson(flags.proposal);
  const explicit = flags.selection ? await readJson(flags.selection) : undefined;
  const result = await select({
    proposal,
    source: flags.source,
    explicit,
    selectedBy: flags.selectedBy,
  });
  await writeOut(result, flags.out);
}

function parseFlags(): {
  proposal: string;
  source?: ReturnType<typeof parseSourceArg>;
  selection?: string;
  selectedBy?: string;
  out?: string;
} {
  let parsed;
  try {
    parsed = parseArgs({
      allowPositionals: false,
      options: {
        proposal: { type: "string" },
        source: { type: "string" },
        selection: { type: "string" },
        "selected-by": { type: "string" },
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
  if (!parsed.values.proposal) {
    throw new HammurabiLockError("bad-args", "--proposal is required", 2);
  }
  if (!parsed.values.source && !parsed.values.selection) {
    throw new HammurabiLockError(
      "bad-args",
      "--source or --selection is required",
      2,
    );
  }
  return {
    proposal: parsed.values.proposal,
    source: parsed.values.source ? parseSourceArg(parsed.values.source) : undefined,
    selection: parsed.values.selection,
    selectedBy: parsed.values["selected-by"],
    out: parsed.values.out,
  };
}

main().catch(exitWithError);
