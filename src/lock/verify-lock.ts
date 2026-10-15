import { hashValue } from "./jcs.js";

const LOCK_HASH = /^\s*LOCK\s+(sha256:[0-9a-f]{64})\b/m;

export interface VerifyLockResult {
  ok: boolean;
  reason: string | null;
  lockedBy: string | null;
  hash: string | null;
}

export function verifyLock(
  issue: unknown,
  allowlist: readonly string[],
): VerifyLockResult {
  const body = readBody(issue);
  const found = lastLock(issue);
  if (!found) return result(false, "missing-lock", null, null);

  const allowed = new Set(allowlist.filter((login) => typeof login === "string"));
  if (!found.lockedBy || !allowed.has(found.lockedBy)) {
    return result(false, "not-allowlisted", found.lockedBy, found.hash);
  }
  if (body === undefined || specHash(body) !== found.hash) {
    return result(false, "hash-mismatch", found.lockedBy, found.hash);
  }
  return result(true, null, found.lockedBy, found.hash);
}

function result(
  ok: boolean,
  reason: string | null,
  lockedBy: string | null,
  hash: string | null,
): VerifyLockResult {
  return { ok, reason, lockedBy, hash };
}

function specHash(body: string): string | undefined {
  try {
    return hashValue(body);
  } catch {
    return undefined;
  }
}

function readBody(issue: unknown): string | undefined {
  if (!isRecord(issue)) return undefined;
  const body = issue.body;
  if (body === null || body === undefined) return "";
  if (typeof body !== "string") return undefined;
  return body;
}

function lastLock(issue: unknown): { lockedBy: string | null; hash: string } | undefined {
  if (!isRecord(issue) || !Array.isArray(issue.comments)) return undefined;
  let found: { lockedBy: string | null; hash: string } | undefined;
  for (const comment of issue.comments) {
    if (!isRecord(comment) || typeof comment.body !== "string") continue;
    const match = LOCK_HASH.exec(comment.body);
    if (!match) continue;
    found = { lockedBy: loginOf(comment), hash: match[1] };
  }
  return found;
}

function loginOf(comment: Record<string, unknown>): string | null {
  const user = comment.user;
  if (!isRecord(user) || typeof user.login !== "string" || user.login.length === 0) {
    return null;
  }
  return user.login;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
