export function upper(input: unknown): string {
  if (typeof input !== "string") return "";
  return input.toUpperCase();
}
