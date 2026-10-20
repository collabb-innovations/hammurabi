---
name: "gates-oracle-indistinguishable"
description: "Identical mutant behavior, a non-zero exit, and a shared root cause can hide a dead row or a real hole. Load when: Phase 3–4, when a row's pass and its failure look the same."
---
<!-- collabb-doctrine-pack: id=gates-oracle-indistinguishable version=1.0.0 sha256=cae841f87e7173dc5006439bb23d5defa6aa9f20cd2c8c10535739b5637a37e7 doctrines=68,74,75,76 -->
## Doctrine 68

**"The mutant behaved identically" has TWO causes, and a harness cannot tell
them apart. One means the row is dead; the other means the row found a real
hole.** *(W-111 retro, 2026-08-19 — three rows, both causes, same verdict.)*

Doctrine 45's W-45 amendment made a genuine advance: before scoring a row,
compare the mutant's output against the clean run's, and if they are equal
report `ERROR — not reached by this fixture` rather than `SURVIVED`. That
converts an invisible, actively misleading survivor into a loud refusal, and
it needs no knowledge of control flow.

W-111 shipped that check and immediately hit its blind spot. Three rows
returned identical output, for two completely different reasons:

| Row | Why the output was identical | What it meant |
|---|---|---|
| M4 | the fixture genuinely does not reach the changed behaviour | the row is **inert** — withdrawn |
| M9 | the line ran, but no assertion observed the value it changed | a **real coverage gap** |
| M10 | same | a **real coverage gap** |

M9 swapped `existing` for `state` in a refusal message, so the error reported
the **losing** request's own timestamp back to itself. M10 swapped the two
slots in the same template. Both are genuine defects in the operator-facing
deliverable, and both produced byte-identical evidence to a row that tests
nothing — because every assertion reaching that string matched only a fixed
prefix.

**So the runtime check answers "did anything change", never "is this row
worth having".** Its verdict is a prompt to triage, and the triage question
is one line: *does any assertion look at the value I just changed?* If no,
the row is real and the FIXTURE is the defect. If the mutated line is not on
the path at all, the row is the defect.

Two habits. Say this in the harness header, next to the check, so the next
reader meets the ambiguity where they meet the mechanism — a verdict whose
two meanings are opposite is worse than no verdict if it is read as one.
And when the triage says "unobserved", the repair is **position-sensitive**:
M10 survives an assertion that merely checks the changed value *appears*,
because a slot swap leaves both values present. Assert the composed string.

The general form, and it is doctrine 30's corollary C arriving from the other
side: doctrine 30 asks what the oracle can observe. This says that when a
mutation appears to do nothing, the answer is *usually* that the oracle is
not looking — not that there was nothing to see.

**Corollary — when you find one criterion of a broken SHAPE, sweep the table
for that shape rather than fixing the instance.** *(Same retro, and it is
doctrine 67's second half pointed at acceptance criteria instead of call
sites.)* F-62 § 6.0 documents, at length, that `vitest -t <filter>` exits 0
with everything skipped when nothing matches, and that `0 failed` is a string
vitest never emits. **AC-4, one criterion later in the same table, expected
`0 failed` and `0 skipped`.** Measured: both appear zero times. Two more rows
in the same table carried the same class of error (`8 checked`, unreachable by
the harness's own arithmetic; a bare `2` where `git grep -c` prints
`<path>:2`).

Writing the warning did not prevent the failure — that is doctrine 21's W-27
note, now on its fourth receipt, and it is not the useful part. The useful
part is that all three were caught by **re-executing every criterion at the
gate**, and none by reading. So the rule is mechanical: the moment a § is
written explaining a criterion-shaped trap, that § ends by re-checking every
other criterion in the table against the same shape, and the check is running
them, not scanning them.

## Doctrine 74

**A row whose PASS condition is "the subject exited non-zero" cannot tell
"the rule fired" from "the fixture was never built" — and every setup failure
is scored as a catch.** *(W-78 retro, 2026-09-04 — four consecutive false
successes while building one row.)*

Doctrine 13 says a green over an empty input set is not green. This is the
same failure moved one step earlier, into the code that CONSTRUCTS the input,
and it is nastier because the harness's own success condition disguises it.

F-97 added row N11: *"the phase-3 checker refuses a self-contradictory plan."*
Refusal means a non-zero exit, so the row passes when the subject exits
non-zero. Building its fixture required a code-map, and `generate-codemap.mjs`
refuses — non-zero — on each of:

| Refusal | Because |
|---|---|
| the clone is not a git repository | it derives its file set from `git ls-files` (doctrine 73) |
| the clone is writable | line pointers are only valid while the tree cannot change |
| the clone is dirty | a staged index is not enough; it needs a real commit |
| the clone has no Python symbols | v1 extracts Python only, and refuses a zero-symbol derivation |
| the codemap has zero groups | `--check-plan` refuses an empty rule set |

Five preconditions, each exiting non-zero, against a row that reads non-zero
as success. The first four were hit in sequence, and **every one of them would
have been reported as `caught`** had the row not been written with an explicit
ERROR arm. The row would have shipped green, forever, having never once
reached the rule it names.

The tell is structural and worth checking directly: **does my PASS condition
have the same shape as my setup's FAILURE condition?** Whenever it does — a
refusal gate, a non-zero exit, an empty result, a thrown exception — the setup
and the subject are indistinguishable to the oracle.

Three things fix it, and the first is not optional:

1. **An ERROR arm that refuses to score.** Assert the fixture was built —
   the artifact exists and is non-empty — and report ERROR, not a verdict,
   when it was not. A row that cannot tell must say so.
2. **A positive control on the same fixture.** N11 runs the same plan with the
   contradiction removed and requires it to PASS. "Refuses everything" then
   cannot score the row, which is doctrine 54's both-polarities rule aimed at
   the setup rather than at the rule.
3. **Score the DISTINCTIVE message, never the exit code** (doctrine 35). N11
   greps for the matched entry's own path; a fixture that failed to build
   cannot produce it.

This generalises past mutation harnesses. Any check whose green is "the thing
refused" — a guard test, a negative fixture, a deny-by-default assertion —
inherits it. Cost of the check: one existence assertion per fixture. Cost of
skipping it: a row that has never executed the rule it is named after, sitting
inside a suite reporting 100%.

---

## Doctrine 75

**A checker that enumerates the BAD forms is doctrine 49 wearing a new costume:
the list of spellings to reject is written from the same memory that wrote the
one spelling you had in mind. Invert it — allowlist the known-safe forms, so an
unrecognised one is a finding by default.**

W-190 / F-99, 2026-09-05. The item funnelled every "mark this node failed" write
through one function, and shipped a source-text gate asserting no other site
could write that status. The gate was mutation-tested and reported 17 caught, 0
survived. Its acceptance criterion said, unqualified: *a sixth site added later
fails the gate instead of silently regressing.*

A review lens planted a sixth site:

```js
Object.assign(state.nodeStatus, { [node.id]: "failed" });
```

guarded behind a value no fixture reached. The full gate stayed green and the
typechecker was clean.

**Both defences failed for reasons that look unrelated and are not.** The
runtime invariant ("every failed node carries a cause") only observes paths some
test actually drives, and this one was deliberately unreachable. The textual
check was keyed to bracket assignment, because bracket assignment is what the
five real sites used — so it encoded the author's inventory of spellings, not the
language's. `Object.assign`, a spread reassignment (`x = { ...x, [k]: v }`) and
an alias (`const ns = x; ns[k] = v`) are three members of an **open set**, and
the author of the checker is exactly the person who will not think of the fourth.

This is doctrine 49's mechanism — *the list you write to catch a gap is written
from the same memory that produced the gap* — relocated from mutation rows to
syntax. It is also doctrine 69's shape: the deviation had been disclosed, the
disclosure was detailed and honest about each layer's individual limits, and the
confidence that produced was **not** matched by coverage of their union.

**The fix is to invert the polarity of the question.** Instead of *"does this
text match a form I consider dangerous?"*, ask *"does every mention of this
identifier match a form I have explicitly certified safe?"* An unrecognised form
is then an offender that a human must classify, and the failure mode moves from
silent-miss to noisy-and-wrong — which is the direction a gate is allowed to
fail in. Applied here, the check immediately flagged two legitimate usages the
author had not enumerated, which is the mechanism working rather than a cost.

**State the residual, because inverting does not make it complete.** A text
checker reads one file and is not a type system: an alias created across a
function boundary, or a write from another module, remains outside its reach.
The criterion's honest form carries that limit — *a sixth site fails the gate
PROVIDED it is written in the file the checker reads* — and the structural fix
(making the field unwritable except through the funnel) is a different item.

Cost of the inversion: one afternoon and two allowlist entries. Cost of skipping
it: a completeness check that reports clean while blind, which is strictly worse
than no check, because it is the artifact everyone points at.

---

## Doctrine 76

**A fail-CLOSED defect and a fail-OPEN one can share one root cause, and the
throw that makes the loud half visible is the only thing reporting the quiet
half at all. Relax the throw and you have converted the safe bug into the unsafe
one.** *(W-192 / F-100, measured 2026-09-05.)*

Indexing a plain `{}` with an author-chosen node id broke the run in two
opposite directions at once:

- **M1, fail-open.** Assigning a *string* to `"__proto__"` hits Annex B's legacy
  prototype setter and silently no-ops. The node never enters the walker's
  pending set, so the run terminates `succeeded` having invoked nothing. Measured
  end to end: a human approved a confirmation gate, the app behind it never ran,
  and the run reported success — an authorised action that did not happen,
  recorded as done.
- **M2, fail-closed.** An *empty* map still answers for every member of
  `Object.prototype` with an inherited function, so `if (gateDecisions[id])` reads
  absence as presence. A gate named `toString` throws
  `"was already decided"` and can never be approved. Its run wedges forever.

Only M2 is *visible*. It throws, it is in the log, someone files it. M1 is
byte-identical in outcome to a healthy run. So the defect that gets reported is
the harmless one, and the obvious repair — loosen that throw, it is clearly
wrong — deletes the only signal the corruption produces and leaves M1 untouched.
The bug report and the correct fix point in opposite directions.

**The trap has a second layer, and it is the one that nearly landed.** The
natural repair is to build the maps with `Object.create(null)` so there is
nothing to inherit. Two of three design sketches proposed exactly that, and one
asserted it closes M1 and M2 together. Measured through real Durable Object
storage, it does not:

```
BEFORE put  Object.create(null)  own=true  proto=null
AFTER  get  Object.create(null)  own=true  proto=Object.prototype   ← erased
```

Own-ness survives persistence; a null prototype does not. So the container fix
holds for M1 — the real property it creates round-trips — and evaporates for M2,
where the map is empty and has no own property to protect it. Driving the
"fixed" build through storage, all four reserved gate ids still wedged, and
`__proto__` had newly *joined* M2. **A fix that closes the loud half and reopens
it one layer down looks exactly like a fix that worked.**

What to do instead: make the colliding id **illegal** rather than safe, at the
authoring gate and again at ingress. One rule, derived from
`Object.getOwnPropertyNames(Object.prototype)` rather than typed out — a
hand-written list reaches for `"prototype"`, which is not a member and behaves
normally, while omitting `__lookupGetter__` and friends that are.

And leave the throw where it is, with a comment saying why. `graph-run-do.ts`
carries one, because the next person to meet the wedge will arrive with a
stack trace and a strong urge to make it stop.

*Corollary for harnesses.* A guard that fires at module load cannot be scored on
a named test — nothing collects, and a named-test oracle scores the guard
**working** as a survivor. `scripts/reserved-node-ids-mutations.sh` grew a
message-scored row for exactly this. Doctrine 30 asks which LINES an oracle can
reach; doctrine 31 asks which INVOCATION FORMS; this asks which *lifecycle
phase*.

---

