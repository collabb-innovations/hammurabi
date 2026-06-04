import type { AutoParseableOutputFormat } from "@anthropic-ai/sdk";
import { zodOutputFormat as sdkZodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod/v4";

// SDK's public helper imports `zod/v4` internally and accepts v4 schemas at
// runtime, but its published `.d.ts` still references zod v3's `ZodType`. The
// cast bridges the type gap; runtime is correct and the helper's JSON-schema
// sanitization (which strips unsupported keywords like `minimum`/`maximum`
// on numbers) is preserved.
export function zodOutputFormatV4<S extends z.ZodType>(
  schema: S,
): AutoParseableOutputFormat<z.infer<S>> {
  return sdkZodOutputFormat(schema as never) as AutoParseableOutputFormat<
    z.infer<S>
  >;
}
