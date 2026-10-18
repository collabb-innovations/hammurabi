import type { SpecTarget } from "../schema/spec.js";

export interface ExecuteResult {
  output: unknown;
  error?: string;
}

export interface ExecuteAdapters {
  cli?: (command: string, input: unknown) => Promise<ExecuteResult>;
  importModule?: (specifier: string) => Promise<Record<string, unknown>>;
}

export async function executeFixtureWith(
  target: SpecTarget,
  input: unknown,
  executeCallback: ((input: unknown) => Promise<unknown>) | undefined,
  adapters: ExecuteAdapters | undefined,
): Promise<ExecuteResult> {
  try {
    switch (target.kind) {
      case "cli":
        if (!adapters?.cli) {
          return {
            output: null,
            error: `cli target is unsupported without an injected cli implementation (command: ${target.command})`,
          };
        }
        return await adapters.cli(target.command, input);
      case "function":
        return await executeFunction(
          target.module,
          target.export,
          input,
          adapters?.importModule,
        );
      case "http":
        return await executeHttp(target.url, target.method ?? "POST", input);
      case "free-form":
        if (!executeCallback) {
          return {
            output: null,
            error: `free-form target requires options.execute callback (target: ${target.description})`,
          };
        }
        return { output: await executeCallback(input) };
    }
  } catch (e) {
    return { output: null, error: e instanceof Error ? e.message : String(e) };
  }
}

async function executeFunction(
  modulePath: string,
  exportName: string,
  input: unknown,
  importModule: ExecuteAdapters["importModule"],
): Promise<ExecuteResult> {
  if (!importModule) {
    return {
      output: null,
      error: `function target is unsupported without an injected importModule implementation (module: ${modulePath})`,
    };
  }
  const mod = await importModule(modulePath);
  const fn = mod[exportName];
  if (typeof fn !== "function") {
    return {
      output: null,
      error: `Export '${exportName}' is not a function in '${modulePath}'`,
    };
  }
  const output = await (fn as (input: unknown) => unknown)(input);
  return { output };
}

async function executeHttp(
  url: string,
  method: string,
  input: unknown,
): Promise<ExecuteResult> {
  const response = await fetch(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    return {
      output: null,
      error: `HTTP ${response.status} ${response.statusText}`,
    };
  }
  const text = await response.text();
  return { output: tryParseJson(text) };
}

export function tryParseJson(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return trimmed;
  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
}
