import { z } from "zod/v4";

const HASH = /^sha256:[0-9a-f]{64}$/;

export const SourceRefSchema = z
  .object({
    adapter: z.string().min(1),
    ref: z.string().min(1),
  })
  .strict();

export const ProposalOptionSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    detail: z.string().min(1).optional(),
  })
  .strict();

export const ProposalDecisionSchema = z
  .object({
    id: z.string().min(1),
    question: z.string().min(1),
    multi: z.boolean().optional(),
    options: z.array(ProposalOptionSchema).min(1),
  })
  .strict()
  .superRefine((decision, ctx) => {
    uniqueIds(
      decision.options.map((o) => o.id),
      ["options"],
      "option",
      ctx,
    );
  });

export const ProposalRequirementSchema = z
  .object({
    id: z.string().min(1),
    text: z.string().min(1),
  })
  .strict();

export const ProposalDiagramSchema = z
  .object({
    id: z.string().min(1),
    lang: z.string().min(1),
    text: z.string(),
  })
  .strict();

export const EvalPlanSchema = z
  .object({
    criteria: z.array(z.string().min(1)).min(1),
    fixtures: z.string().min(1).optional(),
  })
  .strict();

export const ProposalSchema = z
  .object({
    schemaVersion: z.literal("1"),
    id: z.string().min(1),
    source: SourceRefSchema,
    title: z.string().min(1),
    goal: z.array(z.string().min(1)).min(1),
    requirements: z.array(ProposalRequirementSchema),
    decisions: z.array(ProposalDecisionSchema).min(1),
    diagrams: z.array(ProposalDiagramSchema).optional(),
    evalPlan: EvalPlanSchema.optional(),
    createdAt: z.iso.datetime(),
  })
  .strict()
  .superRefine((proposal, ctx) => {
    uniqueIds(
      proposal.requirements.map((r) => r.id),
      ["requirements"],
      "requirement",
      ctx,
    );
    uniqueIds(
      proposal.decisions.map((d) => d.id),
      ["decisions"],
      "decision",
      ctx,
    );
  });

export const ProposalDraftSchema = z
  .object({
    id: z.string().min(1).optional(),
    title: z.string().min(1).optional(),
    goal: z.array(z.string().min(1)).min(1),
    requirements: z.array(ProposalRequirementSchema),
    decisions: z.array(ProposalDecisionSchema).min(1),
    diagrams: z.array(ProposalDiagramSchema).optional(),
    evalPlan: EvalPlanSchema.optional(),
    createdAt: z.iso.datetime().optional(),
  })
  .strict()
  .superRefine((draft, ctx) => {
    uniqueIds(
      draft.requirements.map((r) => r.id),
      ["requirements"],
      "requirement",
      ctx,
    );
    uniqueIds(
      draft.decisions.map((d) => d.id),
      ["decisions"],
      "decision",
      ctx,
    );
  });

export const SelectionChoiceSchema = z
  .object({
    decisionId: z.string().min(1),
    optionIds: z.array(z.string().min(1)).min(1),
  })
  .strict();

export const SelectionSchema = z
  .object({
    schemaVersion: z.literal("1"),
    proposalId: z.string().min(1),
    proposalHash: z.string().regex(HASH),
    choices: z.array(SelectionChoiceSchema).min(1),
    selectedBy: z.string().min(1).optional(),
    selectedAt: z.iso.datetime(),
    sourceEvidence: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((selection, ctx) => {
    uniqueIds(
      selection.choices.map((c) => c.decisionId),
      ["choices"],
      "decision",
      ctx,
    );
  });

export const ExplicitSelectionSchema = z
  .object({
    schemaVersion: z.literal("1").optional(),
    proposalId: z.string().min(1).optional(),
    proposalHash: z.string().regex(HASH).optional(),
    choices: z.array(SelectionChoiceSchema).min(1),
    selectedBy: z.string().min(1).optional(),
    selectedAt: z.iso.datetime().optional(),
    sourceEvidence: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((selection, ctx) => {
    uniqueIds(
      selection.choices.map((c) => c.decisionId),
      ["choices"],
      "decision",
      ctx,
    );
  });

export const LockSchema = z
  .object({
    schemaVersion: z.literal("1"),
    proposalHash: z.string().regex(HASH),
    selectionHash: z.string().regex(HASH),
    spec: ProposalSchema,
    contentHash: z.string().regex(HASH),
    lockedAt: z.iso.datetime(),
    lockedBy: z.string().min(1).optional(),
  })
  .strict();

export const proposalJsonSchema = z.toJSONSchema(ProposalSchema);
export const selectionJsonSchema = z.toJSONSchema(SelectionSchema);
export const lockJsonSchema = z.toJSONSchema(LockSchema);

export type SourceRef = z.infer<typeof SourceRefSchema>;
export type ProposalOption = z.infer<typeof ProposalOptionSchema>;
export type ProposalDecision = z.infer<typeof ProposalDecisionSchema>;
export type ProposalRequirement = z.infer<typeof ProposalRequirementSchema>;
export type ProposalDiagram = z.infer<typeof ProposalDiagramSchema>;
export type EvalPlan = z.infer<typeof EvalPlanSchema>;
export type Proposal = z.infer<typeof ProposalSchema>;
export type ProposalDraft = z.infer<typeof ProposalDraftSchema>;
export type SelectionChoice = z.infer<typeof SelectionChoiceSchema>;
export type Selection = z.infer<typeof SelectionSchema>;
export type ExplicitSelection = z.infer<typeof ExplicitSelectionSchema>;
export type Lock = z.infer<typeof LockSchema>;

function uniqueIds(
  ids: string[],
  path: (string | number)[],
  label: string,
  ctx: z.RefinementCtx,
): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) {
      ctx.addIssue({
        code: "custom",
        message: `duplicate ${label} id "${id}"`,
        path,
      });
      return;
    }
    seen.add(id);
  }
}
