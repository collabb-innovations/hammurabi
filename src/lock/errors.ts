export class HammurabiLockError extends Error {
  readonly reason: string;
  readonly exitCode: 1 | 2;

  constructor(reason: string, message: string, exitCode: 1 | 2) {
    super(`${reason}: ${message}`);
    this.name = "HammurabiLockError";
    this.reason = reason;
    this.exitCode = exitCode;
  }
}

export function formatIssues(
  issues: { path: PropertyKey[]; message: string }[],
): string {
  return issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "<root>";
      return `${path}: ${issue.message}`;
    })
    .join("; ");
}
