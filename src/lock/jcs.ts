import { createHash } from "node:crypto";

/**
 * RFC 8785 JSON Canonicalization Scheme (JCS).
 * Numbers and strings follow ECMAScript JSON.stringify, which is the
 * serialization the RFC specifies. Object keys sort by UTF-16 code units.
 */
export function canonicalize(value: unknown): string {
  return serialize(value);
}

export function sha256Prefixed(canonical: string): string {
  const hex = createHash("sha256").update(canonical, "utf8").digest("hex");
  return `sha256:${hex}`;
}

export function hashValue(value: unknown): string {
  return sha256Prefixed(canonicalize(value));
}

function serialize(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      return serializeNumber(value);
    case "string":
      return serializeString(value);
    case "object":
      break;
    default:
      throw new TypeError(`cannot canonicalize ${typeof value}`);
  }
  if (Array.isArray(value)) {
    return `[${value.map((el) => serialize(el)).join(",")}]`;
  }
  if (!isPlainObject(value)) {
    throw new TypeError("cannot canonicalize non-plain object");
  }
  const rec = value as Record<string, unknown>;
  const keys = Object.keys(rec)
    .filter((k) => rec[k] !== undefined)
    .sort(compareUtf16);
  return `{${keys
    .map((k) => `${serializeString(k)}:${serialize(rec[k])}`)
    .join(",")}}`;
}

function serializeNumber(n: number): string {
  if (!Number.isFinite(n)) {
    throw new TypeError("cannot canonicalize non-finite number");
  }
  return JSON.stringify(n);
}

function serializeString(s: string): string {
  assertWellFormed(s);
  return JSON.stringify(s);
}

function assertWellFormed(s: string): void {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = s.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new TypeError("cannot canonicalize ill-formed string");
      }
      i++;
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      throw new TypeError("cannot canonicalize ill-formed string");
    }
  }
}

function compareUtf16(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function isPlainObject(value: object): boolean {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
