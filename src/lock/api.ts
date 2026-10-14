import { createHash } from "node:crypto";
import {
  ExplicitSelectionSchema,
  LockSchema,
  ProposalDraftSchema,
  ProposalSchema,
  SelectionSchema,
  type ExplicitSelection,
  type Lock,
  type Proposal,
  type ProposalDecision,
  type Selection,
  type SelectionChoice,
  type SourceRef,
} from "../schema/lock.js";
import { getAdapter } from "./adapters/registry.js";
import type { AdapterChoice } from "./adapters/types.js";
import { HammurabiLockError, formatIssues } from "./errors.js";
import { canonicalize, hashValue } from "./jcs.js";
import { lockEvidence } from "./tasks.js";

export interface ProposeInput {
  source: SourceRef;
  draft: unknown;
  publish?: boolean;
  now?: string;
}

export interface SelectInput {
  proposal: unknown;
  source?: SourceRef;
  explicit?: unknown;
  now?: string;
  selectedBy?: string;
}

export interface LockInput {
  proposal: unknown;
  selection: unknown;
  now?: string;
  lockedBy?: string;
}

export async function propose(input: ProposeInput): Promise<Proposal> {
  const adapter = getAdapter(input.source.adapter);
  const draft = parseSchema(ProposalDraftSchema, input.draft, "draft");
  const doc = await adapter.read(input.source.ref);
  const title = draft.title ?? doc.title.trim();
  if (!title) {
    throw new HammurabiLockError("validation", "title is empty", 1);
  }
  const body = proposalBody({
    title,
    goal: draft.goal,
    requirements: draft.requirements,
    decisions: draft.decisions.map(normalizeDecision),
    diagrams: draft.diagrams,
    evalPlan: draft.evalPlan,
  });
  const proposal = parseSchema(
    ProposalSchema,
    {
      schemaVersion: "1",
      id: draft.id ?? deriveId(input.source, body),
      source: { adapter: input.source.adapter, ref: input.source.ref },
      ...body,
      createdAt: draft.createdAt ?? input.now ?? new Date().toISOString(),
    },
    "proposal",
  );
  if (input.publish) {
    if (!adapter.publish) {
      throw new HammurabiLockError(
        "publish-unsupported",
        `adapter "${adapter.name}" does not support publish`,
        2,
      );
    }
    await adapter.publish(input.source.ref, proposal);
  }
  return proposal;
}

export async function select(input: SelectInput): Promise<Selection> {
  const proposal = asProposal(input.proposal);
  const explicit = input.explicit === undefined
    ? undefined
    : parseSchema(ExplicitSelectionSchema, input.explicit, "selection");
  assertExplicitPins(proposal, explicit);

  let fromSource: AdapterChoice[] = [];
  let evidence: { url?: string; author?: string } = {};
  if (input.source) {
    const adapter = getAdapter(input.source.adapter);
    fromSource = await adapter.readSelections(input.source.ref, proposal);
    const doc = await adapter.read(input.source.ref);
    evidence = lockEvidence([
      { body: doc.body },
      ...doc.comments.map((c) => ({ body: c.body, url: c.url, author: c.author })),
    ]);
  }

  const byId = new Map<string, string[]>();
  for (const choice of fromSource) byId.set(choice.decisionId, choice.optionIds);
  if (explicit) {
    for (const choice of explicit.choices) byId.set(choice.decisionId, [...choice.optionIds]);
  }

  const choices = normalizeChoices(proposal, byId);
  assertChoices(proposal, choices);

  const selection: Selection = {
    schemaVersion: "1",
    proposalId: proposal.id,
    proposalHash: hashProposal(proposal),
    choices,
    selectedAt: explicit?.selectedAt ?? input.now ?? new Date().toISOString(),
  };
  const selectedBy = input.selectedBy ?? explicit?.selectedBy ?? evidence.author;
  if (selectedBy) selection.selectedBy = selectedBy;
  const sourceEvidence = explicit?.sourceEvidence ?? evidence.url;
  if (sourceEvidence) selection.sourceEvidence = sourceEvidence;
  return parseSchema(SelectionSchema, selection, "selection");
}

export function lock(input: LockInput): Lock {
  const proposal = asProposal(input.proposal);
  const selection = parseSchema(SelectionSchema, input.selection, "selection");
  if (selection.proposalId !== proposal.id) {
    throw new HammurabiLockError(
      "proposal-mismatch",
      `selection proposalId ${selection.proposalId} does not match ${proposal.id}`,
      1,
    );
  }
  if (selection.proposalHash !== hashProposal(proposal)) {
    throw new HammurabiLockError(
      "proposal-mismatch",
      "selection proposalHash does not match the proposal",
      1,
    );
  }
  assertChoices(proposal, selection.choices);
  const spec = resolveSpec(proposal, selection.choices);
  const preimage = {
    schemaVersion: "1" as const,
    proposalHash: selection.proposalHash,
    selectionHash: hashSelection(selection),
    spec,
  };
  const draftLock = {
    ...preimage,
    contentHash: `sha256:${"0".repeat(64)}`,
    lockedAt: input.now ?? new Date().toISOString(),
    ...(input.lockedBy ? { lockedBy: input.lockedBy } : {}),
  };
  const parsed = parseSchema(LockSchema, draftLock, "lock");
  const contentHash = hashValue(lockPreimage(parsed));
  return parseSchema(LockSchema, { ...parsed, contentHash }, "lock");
}

export function verify(doc: unknown): Lock {
  const locked = parseSchema(LockSchema, doc, "lock");
  const expected = hashValue(lockPreimage(locked));
  if (expected !== locked.contentHash) {
    throw new HammurabiLockError(
      "hash-mismatch",
      "contentHash does not match the locked spec",
      1,
    );
  }
  return locked;
}

export async function postLock(
  locked: Lock,
  source: SourceRef,
): Promise<{ url?: string }> {
  const adapter = getAdapter(source.adapter);
  if (!adapter.postComment) {
    throw new HammurabiLockError(
      "publish-unsupported",
      `adapter "${adapter.name}" does not support lock comments`,
      2,
    );
  }
  return adapter.postComment(source.ref, `LOCK ${locked.contentHash}\n`);
}

export function hashProposal(proposal: Proposal): string {
  return hashValue(normalizeProposal(proposal));
}

export function hashSelection(selection: Selection): string {
  return hashValue(selection);
}

export function lockPreimage(
  locked: Pick<Lock, "schemaVersion" | "proposalHash" | "selectionHash" | "spec">,
) {
  return {
    schemaVersion: locked.schemaVersion,
    proposalHash: locked.proposalHash,
    selectionHash: locked.selectionHash,
    spec: locked.spec,
  };
}

export function normalizeProposal(proposal: Proposal): Proposal {
  return parseSchema(
    ProposalSchema,
    {
      schemaVersion: proposal.schemaVersion,
      id: proposal.id,
      source: { adapter: proposal.source.adapter, ref: proposal.source.ref },
      ...proposalBody({
        title: proposal.title,
        goal: proposal.goal,
        requirements: proposal.requirements,
        decisions: proposal.decisions.map(normalizeDecision),
        diagrams: proposal.diagrams,
        evalPlan: proposal.evalPlan,
      }),
      createdAt: proposal.createdAt,
    },
    "proposal",
  );
}

function asProposal(data: unknown): Proposal {
  return normalizeProposal(parseSchema(ProposalSchema, data, "proposal"));
}

function assertExplicitPins(proposal: Proposal, explicit: ExplicitSelection | undefined): void {
  if (!explicit) return;
  if (explicit.proposalId && explicit.proposalId !== proposal.id) {
    throw new HammurabiLockError(
      "proposal-mismatch",
      `selection proposalId ${explicit.proposalId} does not match ${proposal.id}`,
      1,
    );
  }
  if (explicit.proposalHash && explicit.proposalHash !== hashProposal(proposal)) {
    throw new HammurabiLockError(
      "proposal-mismatch",
      "selection proposalHash does not match the proposal",
      1,
    );
  }
}

function proposalBody(input: {
  title: string;
  goal: string[];
  requirements: Proposal["requirements"];
  decisions: ProposalDecision[];
  diagrams?: Proposal["diagrams"];
  evalPlan?: Proposal["evalPlan"];
}): Omit<Proposal, "schemaVersion" | "id" | "source" | "createdAt"> {
  return {
    title: input.title,
    goal: input.goal,
    requirements: input.requirements,
    decisions: input.decisions,
    ...(input.diagrams && input.diagrams.length > 0
      ? { diagrams: input.diagrams.map((d) => ({ ...d })) }
      : {}),
    ...(input.evalPlan ? { evalPlan: { ...input.evalPlan } } : {}),
  };
}

function normalizeDecision(decision: ProposalDecision): ProposalDecision {
  const out: ProposalDecision = {
    id: decision.id,
    question: decision.question,
    options: decision.options.map((option) => {
      const next: ProposalDecision["options"][number] = {
        id: option.id,
        label: option.label,
      };
      if (option.detail) next.detail = option.detail;
      return next;
    }),
  };
  if (decision.multi === true) out.multi = true;
  return out;
}

function normalizeChoices(
  proposal: Proposal,
  byId: Map<string, string[]>,
): SelectionChoice[] {
  for (const id of byId.keys()) {
    if (!proposal.decisions.some((d) => d.id === id)) {
      throw new HammurabiLockError(
        "unknown-decision",
        `selection names unknown decision "${id}"`,
        1,
      );
    }
  }
  const choices: SelectionChoice[] = [];
  for (const decision of proposal.decisions) {
    const picked = byId.get(decision.id);
    if (!picked || picked.length === 0) continue;
    const order = new Map(decision.options.map((o, i) => [o.id, i]));
    const optionIds = [...new Set(picked)].sort(
      (a, b) => (order.get(a) ?? Number.MAX_SAFE_INTEGER) - (order.get(b) ?? Number.MAX_SAFE_INTEGER),
    );
    choices.push({ decisionId: decision.id, optionIds });
  }
  return choices;
}

function assertChoices(proposal: Proposal, choices: SelectionChoice[]): void {
  const byId = new Map(choices.map((c) => [c.decisionId, c.optionIds]));
  const undecided: string[] = [];
  const over: string[] = [];
  for (const decision of proposal.decisions) {
    const optionIds = byId.get(decision.id) ?? [];
    const known = new Set(decision.options.map((o) => o.id));
    for (const optionId of optionIds) {
      if (!known.has(optionId)) {
        throw new HammurabiLockError(
          "unknown-option",
          `${decision.id} option "${optionId}" is not in the proposal`,
          1,
        );
      }
    }
    const unique = [...new Set(optionIds)];
    if (unique.length === 0) undecided.push(decision.id);
    else if (decision.multi !== true && unique.length > 1) over.push(decision.id);
  }
  if (undecided.length > 0) {
    throw new HammurabiLockError(
      "undecided",
      `${undecided.join(", ")} has no selected option`,
      1,
    );
  }
  if (over.length > 0) {
    throw new HammurabiLockError(
      "over-selected",
      `${over.join(", ")} is single-choice but selected more than one option`,
      1,
    );
  }
}

function resolveSpec(proposal: Proposal, choices: SelectionChoice[]): Proposal {
  const byId = new Map(choices.map((c) => [c.decisionId, new Set(c.optionIds)]));
  return normalizeProposal({
    ...proposal,
    decisions: proposal.decisions.map((decision) => {
      const chosen = byId.get(decision.id) ?? new Set<string>();
      return {
        ...decision,
        options: decision.options.filter((option) => chosen.has(option.id)),
      };
    }),
  });
}

function deriveId(
  source: SourceRef,
  body: Omit<Proposal, "schemaVersion" | "id" | "source" | "createdAt">,
): string {
  const hex = createHash("sha256")
    .update(canonicalize({ source, body }), "utf8")
    .digest("hex");
  return `p_${hex.slice(0, 16)}`;
}

function parseSchema<T>(
  schema: {
    safeParse: (data: unknown) =>
      | { success: true; data: T }
      | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } };
  },
  data: unknown,
  what: string,
): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new HammurabiLockError(
      "validation",
      `${what}: ${formatIssues(result.error.issues)}`,
      1,
    );
  }
  return result.data;
}
