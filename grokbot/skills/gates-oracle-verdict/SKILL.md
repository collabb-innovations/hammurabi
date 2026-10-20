---
name: "gates-oracle-verdict"
description: "A green verdict is not evidence when the input is empty, the signal is silence, or the score is a code. Load when: Phase 3–4, when a green, a silence, or a violation code is being read as a result."
---
<!-- collabb-doctrine-pack: id=gates-oracle-verdict version=1.0.0 sha256=aab4044ad4597fd65f3ee52b2248275360efa0e09698f1bda0d8d97d9e316120 doctrines=13,35,37,39,50,55 -->
## Doctrine 13

**A green result over an empty input set is not a green result.** *(W-29
retro, 2026-08-06.)* While measuring whether four review lenses had obeyed an
output-safety instruction, the orchestrator extracted their verdicts with a
`grep` that matched nothing, produced a **0-byte file**, scanned it, and got
`OK — clean`. The measurement was vacuous and looked identical to a pass —
committed *by the author of the gate whose entire purpose is preventing
"green on a file nobody scanned"*, minutes after writing that sentence. Any
check, scan, or count over a derived input set must assert the set is
non-empty before its result means anything. This is doctrine 9's "prove the
mutation applied" pointed at the *input* rather than the mutation, and it
generalises past gates: a filter that silently matches nothing is the most
common way a verification step becomes decorative.

**An ACCEPTANCE CRITERION of the form "0 occurrences of X" needs a positive
control sitting beside it, over the same input, in the same command.**
*(W-47 retro, 2026-08-17 — it caught a totally dead gate that the criterion's
own number could not see.)* Doctrine 13 and 37 are written about gates. This
is the same failure one level out, in the thing that *checks* the gate, and
it is the commonest shape an acceptance criterion takes.

F-56's AC-5 scanned 186 tracked files and asserted `financial: 0`. Writing a
blind-spot comment, a flag name got wrapped in **backticks inside a
JavaScript template literal** — the string closed, `--` parsed as a decrement
operator, and the gate stopped loading at all. **The headline number did not
move.** `financial: 0`, byte-identical to a healthy run, because a program
that cannot load emits no findings of any kind. What moved was the
co-located count of *other* categories, collapsing 96 → 0.

Written the obvious way — `grep -c 'EGRESS financial' → 0` — that criterion
reports PASS over a gate that cannot execute a single line, and the item
ships a vocabulary nothing consumes. The fix is one extra number in the same
command: assert something that MUST be non-zero on the same input, and assert
the exit code is the one a working run produces (here `1`, never `2` — a
setup error yields `0` findings for reasons unrelated to the subject).

So: **every absence assertion carries a presence assertion.** If you cannot
name something that must be found in the same input set, you have no way to
distinguish "clean" from "did not run", and doctrine 13 says that result is
not a result. Cheapest version, and it costs one line: `X == 0 && Y > 0 &&
exit == <the working value>`.

## Doctrine 35

**A mutation score is a statement about the ORACLE before it is a statement
about the gate. If the verdict is "did it fail", a deleted rule is
indistinguishable from a redundant one.** *(W-33 retro, 2026-08-12 — two of
three reported survivors were the oracle's blind spot, not the gate's.)*
Doctrine 30 asks which *lines* a verdict can depend on, and its corollary C
asks which *dimension* it observes. This is the sharper version for any
harness whose oracle is an exit code: **a non-zero exit says something
refused, never that the right thing refused.**

F-39's harness planted a defect, deleted the rule that owns it, and scored
the mutation on whether the gate still exited non-zero. Three came back
SURVIVED. Two were false: deleting the empty-registry rule left a *different*
rule refusing the same input, and the harness could not tell the difference,
so a genuinely load-bearing guard was written off as redundant — and would
have been deletable forever after. Adding one clause, *assert the criterion
code the fixture names*, converted both to caught. Nothing about the gate
changed.

The failure is not "too few mutations" and more of them do not help: every
extra mutation is scored by the same blunt verdict. **Whenever a fixture
asserts more than the exit status — a code, a message, a named criterion —
the mutation verdict must assert the same thing, or every mutation that
changes *which* rule fires is unkillable by construction.** Cheapest version:
if your fixture greps for `X`, your mutation check greps for `X` too.

**Corollary — a mutation that cannot compile tests nothing, and it fails in
the reassuring direction.** Three of the same harness's mutations deleted a
line out of a multi-line call, leaving code that would not parse. The
interpreter threw, the process exited non-zero, and the harness read that as
"the rule still fired." Bytes changed and the applied-assertion passed, so
doctrine 9's checks all held. Require the oracle to see the program's *own*
report — not merely a non-zero status — before scoring anything, and prefer
single-line, syntactically-valid mutations (neuter a condition to `false`,
delete a whole statement) over deleting fragments of an expression.

## Doctrine 37

**A checker that reports by EMITTING matches cannot tell "found nothing" from
"failed to run" — and silence is scored as clean.** *(W-34 retro, 2026-08-12 —
a full gate run passed over a log that literally contained the defect.)*
Doctrine 13 says a green over an empty *input set* is not a green. This is the
same shape one layer over: the input was fine, the **checker itself was dead**.

F-40's gate proves adopt mode invokes no git write verb. The check reads
`[ -n "$(git_write_verbs "$GIT_LOG")" ]`, where the helper is an `awk` program
that prints each write subcommand it finds. The program assigned to `sub` — an
awk **built-in function** — which is a syntax error. So awk died on every call,
printed a parse error to stderr that nothing read, and emitted nothing. The
caller saw an empty string and reported **PASS**, over a log containing
`add -A`. Every assertion of that property was decorative for an entire gate
run, at 96 green.

Three things make this worth its own entry rather than a footnote to 13.
It was introduced **by the fix for a different checker bug**, minutes earlier,
in the session that wrote the surrounding warnings. No assertion could have
caught it: a dead extractor and a clean repository produce byte-identical
output, so the gate is *structurally* incapable of distinguishing them. And it
was found only because the mutation harness plants a real write verb and asks
whether anything notices — the one instrument whose question is "does this
checker still fire", not "does this checker still pass".

**So: any helper whose result is consumed as presence-or-absence must fail
LOUDLY, never emptily.** One clause does it — `awk '…' "$f" || echo
"CHECKER-FAILED"` — and it converts an invisible pass into a visible failure.
Apply it to every `$(...)` whose emptiness means "all clear": greps with a
computed pattern, `jq` filters, awk extractors, `find` predicates. The tell to
look for: *if this command exited 2 right now, would my check say PASS?*

## Doctrine 39

**"Present" is not "loadable". An existence check is not a runnability check —
and fixing one existence check with another repeats the defect one layer
down.** *(W-35 retro, 2026-08-12 — the same defect three times in one hour,
each time inside the fix for the last one.)*

F-41's gate validated an eval bundle. Dry-running the playbook **in order**
(Phase 4.5) showed step 7 reporting CLEAN on a bundle that step 8 could not
run: no `spec.md`, no `target.mjs`. Fixed by rule `R7` — *check those files
exist*. Then the real runner refused the bundle anyway, because the `spec.md`
was written from the authoring doc's **paraphrase** rather than the schema and
was missing required keys. Fixed again — *check the required keys exist*. Then
the runner refused it a **third** time, for cross-file `specVersion`
disagreement, which no per-file check can see at all.

Each fix was an existence assertion standing in for the question actually
being asked, which is *"will the next consumer accept this?"* Only the consumer
answers that. The tell is a check whose subject is a file and whose purpose is
another program's behaviour.

Two things follow. **Run the real consumer against the artifact, once, as part
of the item** — it cost three round trips here and would have cost one. And
where the consumer genuinely cannot be a dependency (here `hammurabi/` is a
gitignored nested repo, absent in CI, so importing its loader would make the
gate unrunnable exactly where it is needed), **say in the gate's own text
which subset it re-implements**, so nobody reads its green as "the runner will
accept this". F-41's gate now names that limit in its header and its blind-spot
block.

## Doctrine 50

**A mutation can apply, hit exactly the intended site, parse cleanly, and
still encode no defect at all — and it fails in the reassuring direction.**
*(W-39 retro, 2026-08-14 — one row of a 15-row table was measuring nothing.)*
Doctrine 9's F-16 amendment says prove the mutation applied; W-29's says
prove it reached every site; doctrine 41 says refuse a mutant that will not
parse; doctrine 35's corollary says prefer single-line valid mutations. F-46
satisfied all four and still shipped a row that tested nothing.

The row meant to prove the write guard refuses **before** the storage write.
Its replacement appended `return` after the write — in a method that already
returned there. Bytes changed, site count matched, `node --check` passed, and
the mutant was **behaviourally identical to the original**. It duly reported
SURVIVED, which reads as "the gate is blind here" rather than "this row is
meaningless", and the first instinct is to go looking for a hole in the gate.

The tell is available for free and nobody looks for it: **a mutation that
encodes a real defect must change behaviour on SOME input, so ask what input
distinguishes mutant from original before writing the row.** If the answer is
"none", the row is decoration. For a guard the question is almost always
ordering or negation — the defect for "refuses before writing" is
*write-then-refuse*, so the replacement has to contain the write, not merely
sit near it.

And the diagnostic rule that follows: **when a mutation survives, check the
mutation before you check the gate.** Three of F-46's four first-round
survivors were genuine corpus holes and the fourth was this; time spent
hunting for a gate hole that does not exist is the cost of assuming the
harness is the trustworthy half.

## Doctrine 55

**Scoring a mutation on a violation CODE is not scoring it on the defect —
a fix that converts a silent pass into a DIFFERENT failure on the same code
makes the row survive, and the survivor is the fix working.** *(W-32c retro,
2026-08-14 — measured twice in one session, in the harness built by the
session that had just read doctrine 35.)*

Doctrine 35 says assert the criterion the fixture names, because an
exit-code oracle cannot tell a deleted rule from a redundant one. W-32c
obeyed it — every row scored on a named code like `[AC-3]` rather than on
exit status — and still hit the same failure one level in.

A review lens found that `AC-3` compared repo slugs only on one branch. The
fix made every branch dispose of the entry. Immediately, **two rows that had
been catching went SURVIVED**: their mutants no longer passed silently, they
failed with a *different message under the same code*, and `grep '\[AC-3\]'`
is satisfied by either. Both were repaired by scoring on the specific
sentence the defect destroys (`has no row in CLAUDE`, `versioned in THIS
repo`). Nothing about the gate was wrong; the rows were measuring the code,
and the code is a category, not a claim.

Two habits follow, and the second is the load-bearing one:

* **Score on the narrowest text that only the correct behaviour produces.**
  If a rule can fail two ways, the code is shared and the message is not.
* **When a mutation starts surviving right after you FIXED something, suspect
  the row's granularity before the gate.** This is doctrine 50's "check the
  mutation before you check the gate" with a specific trigger attached — a
  fix that adds a failure path is the commonest way a coarse row silently
  stops measuring anything. The reassuring reading ("my fix opened a hole")
  sends you hunting for a defect that does not exist.

**Corollary — the expect pattern is a text grep, so it matches your own
commentary too.** A row scoring on `AC-3` was satisfied by a **self-test
whose NAME contains "AC-3"**, printed on every run, so that row could never
fail. Doctrine 30's corollary B says a harness's applied-assertion must not
match its own prose; the same is true of its *expect*. Grep your expect
patterns against a clean run's full output before trusting any score — if
the pattern already appears when nothing is planted, the row is decoration.

