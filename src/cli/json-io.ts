import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { SourceRef } from "../schema/lock.js";
import { HammurabiLockError } from "../lock/errors.js";

export function parseSourceArg(raw: string): SourceRef {
  const i = raw.indexOf(":");
  if (i <= 0 || i === raw.length - 1) {
    throw new HammurabiLockError(
      "bad-args",
      `--source must be <adapter>:<ref>, got "${raw}"`,
      2,
    );
  }
  return { adapter: raw.slice(0, i), ref: raw.slice(i + 1) };
}

export async function readJson(path: string): Promise<unknown> {
  let text: string;
  try {
    text = path === "-" ? await readStdin() : await readFile(path, "utf8");
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      throw new HammurabiLockError("not-found", `no such file: ${path}`, 2);
    }
    throw new HammurabiLockError("io", `${path}: ${err.message}`, 2);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (e) {
    throw new HammurabiLockError(
      "invalid-json",
      `${path}: ${(e as Error).message}`,
      1,
    );
  }
}

export async function writeOut(value: unknown, outPath?: string): Promise<void> {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  if (!outPath) {
    process.stdout.write(text);
    return;
  }
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, text);
}

export function exitWithError(e: unknown): never {
  if (e instanceof HammurabiLockError) {
    process.stderr.write(`Error: ${e.message}\n`);
    process.exit(e.exitCode);
  }
  const message = e instanceof Error ? e.message : String(e);
  process.stderr.write(`Error: ${message}\n`);
  process.exit(2);
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}
