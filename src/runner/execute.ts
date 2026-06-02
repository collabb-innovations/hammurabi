import { spawn } from "node:child_process";
import type { SpecTarget } from "../schema/spec.js";

export interface ExecuteResult {
  output: unknown;
  error?: string;
}

export async function executeFixture(
  target: SpecTarget,
  input: unknown,
  executeCallback?: (input: unknown) => Promise<unknown>,
): Promise<ExecuteResult> {
  try {
    switch (target.kind) {
      case "cli":
        return await executeCli(target.command, input);
      case "function":
        return await executeFunction(target.module, target.export, input);
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

function executeCli(command: string, input: unknown): Promise<ExecuteResult> {
  return new Promise((resolve) => {
    const proc = spawn(command, [], { shell: true });
    let stdout = "";
    let stderr = "";
    proc.stdout?.on("data", (d) => (stdout += d.toString()));
    proc.stderr?.on("data", (d) => (stderr += d.toString()));
    proc.on("error", (err) =>
      resolve({ output: null, error: `spawn failed: ${err.message}` }),
    );
    proc.on("close", (code) => {
      if (code !== 0) {
        resolve({
          output: tryParseJson(stdout),
          error: `cli exited ${code}: ${stderr.trim()}`,
        });
        return;
      }
      resolve({ output: tryParseJson(stdout) });
    });
    proc.stdin?.write(JSON.stringify(input));
    proc.stdin?.end();
  });
}

async function executeFunction(
  modulePath: string,
  exportName: string,
  input: unknown,
): Promise<ExecuteResult> {
  const mod = (await import(modulePath)) as Record<string, unknown>;
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

function tryParseJson(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return trimmed;
  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
}
