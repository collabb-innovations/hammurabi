import { z } from "zod";

export const JudgeResponseSchema = z.object({
  scores: z.array(
    z.object({
      criterionId: z.string(),
      score: z.number(),
      reasoning: z.string(),
    }),
  ),
});
