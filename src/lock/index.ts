import { registerAdapter } from "./adapters/registry.js";
import { createGitHubIssuesAdapter } from "./adapters/github.js";
import { textAdapter } from "./adapters/text.js";

registerAdapter(textAdapter);
registerAdapter(createGitHubIssuesAdapter());

export { propose, select, lock, verify, postLock, hashProposal, hashSelection, lockPreimage, normalizeProposal } from "./api.js";
export type { ProposeInput, SelectInput, LockInput } from "./api.js";
export { registerAdapter, getAdapter } from "./adapters/registry.js";
export { createGitHubIssuesAdapter } from "./adapters/github.js";
export { textAdapter } from "./adapters/text.js";
export type { SourceAdapter, SourceDoc, AdapterChoice } from "./adapters/types.js";
export { HammurabiLockError } from "./errors.js";
export { canonicalize, hashValue } from "./jcs.js";
