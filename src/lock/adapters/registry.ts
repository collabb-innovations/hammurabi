import { HammurabiLockError } from "../errors.js";
import type { SourceAdapter } from "./types.js";

const adapters = new Map<string, SourceAdapter>();

export function registerAdapter(adapter: SourceAdapter): void {
  if (!adapter.name) {
    throw new HammurabiLockError("bad-args", "adapter name is empty", 2);
  }
  adapters.set(adapter.name, adapter);
}

export function getAdapter(name: string): SourceAdapter {
  const adapter = adapters.get(name);
  if (!adapter) {
    throw new HammurabiLockError(
      "unknown-adapter",
      `no source adapter registered for "${name}"`,
      2,
    );
  }
  return adapter;
}
