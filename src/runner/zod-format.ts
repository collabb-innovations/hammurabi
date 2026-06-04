import type { AutoParseableOutputFormat } from "@anthropic-ai/sdk";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — deep import; SDK does not publicly re-export the transform.
import { transformJSONSchema } from "@anthropic-ai/sdk/lib/transform-json-schema.js";
import { z } from "zod/v4";

export function zodOutputFormatV4<S extends z.ZodType>(
  schema: S,
): AutoParseableOutputFormat<z.infer<S>> {
  const raw = z.toJSONSchema(schema, { reused: "ref" }) as Record<string, unknown>;
  const transformed = transformJSONSchema(raw) as Record<string, unknown>;
  return {
    type: "json_schema",
    schema: transformed,
    parse: (content: string) => {
      const parsed = JSON.parse(content);
      const result = schema.safeParse(parsed);
      if (!result.success) {
        throw new Error(
          `Failed to parse structured output: ${result.error.message}`,
        );
      }
      return result.data;
    },
  };
}
