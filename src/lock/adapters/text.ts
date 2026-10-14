import { readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import type { Proposal } from "../../schema/lock.js";
import { HammurabiLockError } from "../errors.js";
import {
  listTasks,
  mergeSections,
  renderProposal,
  titleFromMarkdown,
} from "../tasks.js";
import type { AdapterChoice, SourceAdapter, SourceDoc } from "./types.js";

let cache: { ref: string; doc: SourceDoc } | undefined;

async function load(ref: string): Promise<SourceDoc> {
  if (ref === "-" && cache?.ref === "-") return cache.doc;
  const doc = await readDoc(ref);
  if (ref === "-") cache = { ref, doc };
  return doc;
}

function clearCache(): void {
  cache = undefined;
}

async function readDoc(ref: string): Promise<SourceDoc> {
  const body = ref === "-" ? await readStdin() : await readPath(ref);
  const fallback = ref === "-" ? "stdin" : basename(ref).replace(/\.[^.]+$/, "");
  return {
    title: titleFromMarkdown(body, fallback || basename(ref)),
    body,
    tasks: listTasks(body),
    comments: [],
  };
}

async function readPath(ref: string): Promise<string> {
  try {
    return await readFile(resolve(ref), "utf8");
  } catch (e) {
    throw ioError(e, ref);
  }
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function selections(doc: SourceDoc, proposal: Proposal): AdapterChoice[] {
  const sections = mergeSections([doc.body], proposal);
  const unknown = [...sections.values()].flatMap((s) => s.unknownChecked);
  if (unknown.length > 0) {
    throw new HammurabiLockError(
      "unknown-option",
      `checkbox does not match an option: ${unknown[0]}`,
      1,
    );
  }
  return [...sections.entries()].map(([decisionId, section]) => ({
    decisionId,
    optionIds: section.checked,
  }));
}

export const textAdapter: SourceAdapter = {
  name: "text",
  async read(ref) {
    return load(ref);
  },
  async readSelections(ref, proposal) {
    return selections(await load(ref), proposal);
  },
  async publish(ref, proposal) {
    if (ref === "-") {
      throw new HammurabiLockError(
        "text-stdin",
        "cannot publish a checklist to stdin",
        2,
      );
    }
    return writeAppend(ref, renderProposal(proposal), proposal);
  },
  async postComment(ref, body) {
    if (ref === "-") {
      throw new HammurabiLockError(
        "text-stdin",
        "cannot post a comment to stdin",
        2,
      );
    }
    return writeAppend(ref, body.endsWith("\n") ? body : `${body}\n`);
  },
};

async function writeAppend(
  ref: string,
  block: string,
  proposal?: Proposal,
): Promise<{ url?: string }> {
  const path = resolve(ref);
  let existing = "";
  try {
    existing = await readFile(path, "utf8");
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code !== "ENOENT") throw ioError(e, ref);
  }
  if (proposal && hasAllDecisionHeadings(existing, proposal)) {
    return { url: path };
  }
  const next = existing.length === 0 || existing.endsWith("\n")
    ? `${existing}${existing.length === 0 ? "" : "\n"}${block}`
    : `${existing}\n\n${block}`;
  try {
    await writeFile(path, next);
  } catch (e) {
    throw ioError(e, ref);
  }
  clearCache();
  return { url: path };
}

function hasAllDecisionHeadings(body: string, proposal: Proposal): boolean {
  return proposal.decisions.every((d) => body.includes(`## ${d.id} `));
}

function ioError(e: unknown, ref: string): HammurabiLockError {
  const err = e as NodeJS.ErrnoException;
  if (err.code === "ENOENT") {
    return new HammurabiLockError("not-found", `no such file: ${ref}`, 2);
  }
  return new HammurabiLockError("io", `${ref}: ${err.message ?? "read failed"}`, 2);
}
