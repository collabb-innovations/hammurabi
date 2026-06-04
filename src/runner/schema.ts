import { z } from "zod/v4";

export const JudgeResponseSchema = z.object({
  scores: z.array(
    z.object({
      criterionId: z.string(),
      score: z.number(),
      reasoning: z.string(),
    }),
  ),
});
