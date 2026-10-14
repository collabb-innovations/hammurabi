#!/usr/bin/env node
import { parseArgs } from "node:util";
import { lock, postLock, verify } from "../lock/index.js";
import { HammurabiLockError } from "../lock/errors.js";
import type { SourceRef } from "../schema/lock.js";
import { exitWithError, readJson, writeOut } from "./json-io.js";

const HELP = `Usage: hammurabi-lock --proposal <proposal.json> --selection <selection.json> [options]
       hammurabi-lock --verify <lock.json>

Build a content-hashed lock, or verify one. Nothing is committed.
No prompts. JSON on stdout, diagnostics on stderr.

Options:
  --proposal <proposal.json>     Proposal being locked
  --selection <selection.json>   Selection pinned to that proposal
  --verify <lock.json>           Recompute contentHash and refuse on mismatch
  --post                         Opt-in: comment the lock hash back on the source
  --locked-by <name>             Recorded on the lock; not part of contentHash
  --out <file>                   Write JSON to a file instead of stdout
  --help                         Show this help

Exit codes:
  0  ok
  1  validation or verify failure
  2  could not run (bad args, credential or network error)
`;

async function main(): Promise<void> {
  const flags = parseFlags();
  if (flags.verify) {
    const locked = verify(await readJson(flags.verify));
    await writeOut({ ok: true, contentHash: locked.contentHash }, flags.out);
    return;
  }
  const proposal = await readJson(flags.proposal!);
  const selection = await readJson(flags.selection!);
  const locked = lock({
    proposal,
    selection,
    lockedBy: flags.lockedBy,
  });
  if (flags.post) {
    const source = sourceOf(proposal);
    const posted = await postLock(locked, source);
    if (posted.url) process.stderr.write(`posted: ${posted.url}\n`);
  }
  await writeOut(locked, flags.out);
}

function sourceOf(proposal: unknown): SourceRef {
  const source = (proposal as { source?: Partial<SourceRef> }).source;
  if (!source?.adapter || !source.ref) {
    throw new HammurabiLockError(
      "validation",
      "proposal.source is required to post the lock hash",
      1,
    );
  }
  return { adapter: source.adapter, ref: source.ref };
}

function parseFlags(): {
  verify?: string;
  proposal?: string;
  selection?: string;
  post: boolean;
  lockedBy?: string;
  out?: string;
} {
  let parsed;
  try {
    parsed = parseArgs({
      allowPositionals: false,
      options: {
        proposal: { type: "string" },
        selection: { type: "string" },
        verify: { type: "string" },
        post: { type: "boolean", default: false },
        "locked-by": { type: "string" },
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
  const verifyPath = parsed.values.verify;
  const proposal = parsed.values.proposal;
  const selection = parsed.values.selection;
  if (verifyPath && (proposal || selection || parsed.values.post)) {
    throw new HammurabiLockError(
      "bad-args",
      "--verify cannot be combined with --proposal, --selection, or --post",
      2,
    );
  }
  if (!verifyPath && (!proposal || !selection)) {
    throw new HammurabiLockError(
      "bad-args",
      "--proposal and --selection are required (or pass --verify)",
      2,
    );
  }
  return {
    verify: verifyPath,
    proposal,
    selection,
    post: Boolean(parsed.values.post),
    lockedBy: parsed.values["locked-by"],
    out: parsed.values.out,
  };
}

main().catch(exitWithError);
