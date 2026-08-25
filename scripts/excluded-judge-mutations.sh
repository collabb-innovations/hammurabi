#!/usr/bin/env bash
#
# excluded-judge-mutations.sh — mutation harness for F-71 / W-56.
#
# Mutates tracked files IN PLACE. Single-writer (do not background; do not
# edit the targets while this runs). Refuses a dirty tree. Restores through
# one function that refuses a missing/empty backup.
#
# Usage:
#   bash scripts/excluded-judge-mutations.sh           # full run
#   bash scripts/excluded-judge-mutations.sh --anchors # dry: apply, count, restore
#
# Exit: 0 all caught / anchors ok · 1 survivor · 2 usage/setup
#
# Spec: collabb-innovations/collabb docs/reqs/F-71-hammurabi-excluded-judge-warning.md

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
cd "$ROOT"

ANCHORS_ONLY=0
if [ "${1:-}" = "--anchors" ]; then
  ANCHORS_ONLY=1
elif [ -n "${1:-}" ]; then
  echo "usage: $0 [--anchors]" >&2
  exit 2
fi

EXCL="src/runner/excluded-judges.ts"
JUDGE="src/runner/judge.ts"
INDEX="src/runner/index.ts"

for f in "$EXCL" "$JUDGE" "$INDEX"; do
  [ -f "$f" ] || { echo "missing $f" >&2; exit 2; }
done

# Dirty-tree refusal — we restore these three files and nothing else.
if ! git diff --quiet -- "$EXCL" "$JUDGE" "$INDEX" \
  || [ -n "$(git diff --cached --name-only -- "$EXCL" "$JUDGE" "$INDEX")" ]; then
  echo "refusing: targets are dirty" >&2
  exit 2
fi

WORK="$(mktemp -d)"
[ -n "$WORK" ] && [ -d "$WORK" ] || { echo "mktemp failed" >&2; exit 2; }

restore_target() {
  local file="$1"
  local src="$WORK/pristine/$(basename "$file")"
  if [ ! -s "$src" ]; then
    echo "restore_target: missing backup for $file" >&2
    return 1
  fi
  cat "$src" > "$file" || return 1
}

restore_all() {
  restore_target "$EXCL" || return 1
  restore_target "$JUDGE" || return 1
  restore_target "$INDEX" || return 1
}

mkdir -p "$WORK/pristine" || exit 2
cp "$EXCL" "$WORK/pristine/$(basename "$EXCL")" || exit 2
cp "$JUDGE" "$WORK/pristine/$(basename "$JUDGE")" || exit 2
cp "$INDEX" "$WORK/pristine/$(basename "$INDEX")" || exit 2
[ -s "$WORK/pristine/$(basename "$EXCL")" ] || { echo "empty backup excl" >&2; exit 2; }
[ -s "$WORK/pristine/$(basename "$JUDGE")" ] || { echo "empty backup judge" >&2; exit 2; }
[ -s "$WORK/pristine/$(basename "$INDEX")" ] || { echo "empty backup index" >&2; exit 2; }

trap 'restore_all; rm -rf "$WORK"' EXIT

# Positive-control the validity checker (tsc on .ts is the one that can fail;
# node --check type-strips and exits 0 on garbage).
printf 'const x: number = "nope";\n' > "$WORK/bad.ts"
if npx tsc --noEmit --pretty false --strict "$WORK/bad.ts" >/dev/null 2>&1; then
  echo "ERROR — tsc --noEmit accepted deliberate garbage; oracle is vacuous" >&2
  exit 2
fi

apply_once() {
  local file="$1"
  local needle="$2"
  local repl="$3"
  python3 - "$file" "$needle" "$repl" <<'PY'
import sys
path, needle, repl = sys.argv[1], sys.argv[2], sys.argv[3]
text = open(path, encoding="utf-8").read()
count = text.count(needle)
if count != 1:
    sys.stderr.write(f"SITES {count} != 1 for {needle!r}\n")
    sys.exit(3)
open(path, "w", encoding="utf-8").write(text.replace(needle, repl, 1))
PY
}

count_sites() {
  local file="$1"
  local needle="$2"
  python3 - "$file" "$needle" <<'PY'
import sys
path, needle = sys.argv[1], sys.argv[2]
print(open(path, encoding="utf-8").read().count(needle))
PY
}

# id applied below via run_row. No unused table — each row is a call.

oracle() {
  npx tsx --test tests/run-excluded-judges.test.ts tests/judge.test.ts >"$WORK/oracle.out" 2>&1
}

PASS=0
FAIL=0
ERR=0

run_row() {
  local id="$1" file="$2" needle="$3" repl="$4"
  local sites
  sites="$(count_sites "$file" "$needle")"
  if [ "$sites" != "1" ]; then
    echo "ERROR $id — SITES $sites != 1" >&2
    ERR=$((ERR + 1))
    restore_all || exit 2
    return
  fi
  if ! apply_once "$file" "$needle" "$repl"; then
    echo "ERROR $id — MUTATION DID NOT APPLY" >&2
    ERR=$((ERR + 1))
    restore_all || exit 2
    return
  fi
  if cmp -s "$file" "$WORK/pristine/$(basename "$file")"; then
    echo "ERROR $id — bytes unchanged" >&2
    ERR=$((ERR + 1))
    restore_all || exit 2
    return
  fi
  if [ "$ANCHORS_ONLY" = "1" ]; then
    echo "anchor  $id  SITES 1"
    PASS=$((PASS + 1))
    restore_all || exit 2
    return
  fi
  if ! npx tsc --noEmit --pretty false >/dev/null 2>&1; then
    echo "ERROR $id — mutant does not typecheck" >&2
    ERR=$((ERR + 1))
    restore_all || exit 2
    return
  fi
  if oracle; then
    # Mutant stayed green — guard row survived.
    echo "SURVIVED  $id" >&2
    FAIL=$((FAIL + 1))
  else
    echo "caught   $id"
    PASS=$((PASS + 1))
  fi
  restore_all || exit 2
}

echo "== baseline =="
if ! oracle; then
  echo "ERROR — clean baseline failed" >&2
  cat "$WORK/oracle.out" >&2
  exit 2
fi
echo "baseline ok"

run_row W1 "$EXCL" "console.warn(" "void (0 && console.warn("
# Replace only the throw in refuseMissingJudgeKeys: the distinctive string sits
# inside that throw, so swapping the throw keyword+constructor is the refusal.
run_row R1 "$EXCL" "throw new Error(" "return; void ("
run_row P1 "$JUDGE" "excludedJudges: excludedJudgesOf(perJudge)" "excludedJudges: []"
run_row D1 "$EXCL" "if (seen.has(key)) continue;" "if (false && seen.has(key)) continue;"
run_row S1 "$EXCL" "return judgesWereDeclared(spec, override) || rubricNeedsLlmPanel(rubric);" "return false;"

echo "== $PASS caught, $FAIL survived, $ERR errored =="
if [ "$FAIL" -gt 0 ] || [ "$ERR" -gt 0 ]; then
  exit 1
fi
exit 0
