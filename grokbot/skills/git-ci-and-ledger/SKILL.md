---
name: "git-ci-and-ledger"
description: "Local and CI differ in invocation, channel, index state, and job topology; reproduce the one that runs. Load when: Phase 4–5, when staging, committing, rebasing, waiting on CI, or moving ledger status."
---
<!-- collabb-doctrine-pack: id=git-ci-and-ledger version=1.0.0 sha256=e07a9aaafbc9a6f1d0d70a7bc0d679b300e53e64717d4c0b88ad51cd0062a03a doctrines=20,22,34,40,42,46,51,60,65 -->
## Doctrine 20

**Reproduce the *invocation*, not just the command. Local and CI differ in
ways that silently narrow what gets checked.** *(W-15 retro, 2026-08-09 —
two independent instances in one iteration, both green locally, both red or
blind in CI.)* Doctrine 18 says to run the tool over its own output.
This is the next question: **did you run it the way the runner runs it?**

* **Shell flags.** GitHub executes `run:` steps as `/usr/bin/bash -e {0}`.
  F-28's check step captured output with a bare `out=$(cmd)` assignment —
  under `-e` that aborts the step the instant the command fails, *before*
  the line that prints the reason. The local harness invoked
  `bash script.sh`; CI invokes `bash -e script.sh`. The exit codes were all
  correct, so nothing looked wrong: green stayed green, the drift stayed
  red, and the guard still fired. What vanished was the **message** — a gate
  whose entire purpose is saying *which* clause drifted went red with zero
  output. A harness that runs the shipped bytes under a different
  interpreter is testing a different program.
* **File-set scoping.** `scripts/retired-names.sh` scans `git ls-files`.
  It was run locally and reported `clean` — while the file it was meant to
  check sat **untracked**. CI, which sees the committed tree, went red
  immediately. The local pass was doctrine 13 wearing a familiar face: a
  green result over an input set that excluded the one new thing.
  **Stage the item's files before running any gate that reads
  `git ls-files`, `git diff`, or `git grep`.**

* **Ambient config.** *(W-18 retro, 2026-08-09.)* F-31's mutation harness
  pushed its fixtures to `refs/heads/main` while letting the *initial*
  branch name come from ambient git config. The author's machine sets
  `init.defaultBranch=main`; the runner's git defaults to `master`. There,
  the bare fixture repo's HEAD pointed at a branch that was never created,
  every clone after the first came back with an unborn branch, each
  fixture's seed commit landed on no remote, and one clause fired on all of
  them — reporting **four clauses INERT that are not**. Nothing was wrong
  with the code under test; the harness was a different program on the two
  machines. **A fixture builder that reads ambient configuration is not the
  same fixture on two machines.** Pin what the fixture depends on
  (`git init -b main`), and when a harness goes red only on CI, reproduce
  the runner's *configuration* locally before touching the thing under test.

* **Utility dialect.** *(W-67 retro, 2026-08-11.)* The runner is Linux with
  GNU coreutils; the author's machine is macOS with BSD ones, and the two
  spell the same operations differently. F-37's harness used `stat -f '%Sp'`
  (BSD "print mode"; on GNU `-f` means *report on the filesystem*) and
  `sed -i ''` (BSD in-place; GNU reads the `''` as the script and edits
  nothing). Locally: 61 passed. On CI: three failures, one of them a
  *positive control* correctly reporting that its bypass produced no effect —
  the harness catching a defect in itself, which is the design working.
  The fix worth generalising is not a portability wrapper. Every failing
  assertion wanted to know **"can this be written"**, which `[ -w ]` answers
  identically everywhere; parsing a mode string was the wrong instrument for
  the question, and portability was only the symptom. **When a check reaches
  for a tool's formatted output, ask what it actually wants to know and
  whether a test operator answers it directly.** This is the fourth distinct
  axis on this list — `git`'s regex engine, shell flags, ambient git config,
  and now coreutils dialect — so treat "it passed on my machine" as evidence
  about one platform, never about the check.

The general form: a check is defined by `(code, inputs, interpreter,
environment)`, and a local run that varies any of the last three is not the
check CI runs. When a gate ships, run it once through the *real* entry point
— the workflow, the hook, the CI shell — not only through the convenient one.
Both instances above were found by CI on the shipping PR, cost one round
trip each, and neither would ever have been found by reading.

**A criterion you did not RUN before the lock can be unsatisfiable by
construction, and "I ran the other four" is how it hides.** *(W-47 retro,
2026-08-17.)* Doctrine 7's W-28 amendment says a criterion naming a command
and an expected output is a toolchain claim. W-47 obeyed it for four criteria
and skipped one: AC-10 required a `--anchors` dry pass on two mutation
harnesses, and **neither has one** — it was written from an assumption that
they did, in a spec whose acceptance section opens by citing that doctrine.

Running *some* criteria feels like discharging the rule, because the ones you
reach for are the ones you can picture running. The one you skip is the one
whose mechanism you assumed. The fix is mechanical and cheap: **at lock time,
execute EVERY command-shaped criterion and record what it returns today** —
which for an eval-first item is usually the RED value. A criterion that
cannot be executed at all is not a criterion yet, and it is not lockable.

The corollary bit here too: the item that *owns* the missing capability
(W-114) named two harnesses in its body, and these were a third and fourth.
An item asserting "only these lack X" is an absence claim, and doctrine 38's
W-40 sharpening applies — derive the list mechanically
(`grep -L -- --anchors scripts/*-mutations.sh`) rather than by enumeration,
because the enumeration is what goes stale.

**Executing a criterion proves the COMMAND runs. It does not prove your
EXPECTED OUTPUT is a string the program can ever emit — and the criterion
that gets this wrong is the one masking a real gap.** *(W-48 retro,
2026-08-18 — three instances, in a spec whose § 6 opens by citing this
doctrine and which executed all eighteen criteria before the lock.)*

W-47's amendment above says to run every command-shaped criterion at lock
time and record what it returns. F-57 did exactly that. Three criteria still
shipped quoting tokens their programs never produce:

| Criterion | Expected | The tool actually emits |
|---|---|---|
| AC-14 | `0 survived`, `0 errored` | `39 passed, 0 failed` — the word *survived* appears nowhere |
| AC-5 | mutation row `B1` | the shipped row is `L1` |
| AC-4 | `matches=0`, `scanned>0` | `0 leak(s)`, `scanned 377 tracked path(s)` |

Running them did not catch it, because running a criterion tells you the
command exits and prints *something*; the eye then reads the output as
agreeing with the expectation. Nothing compares the criterion's **wording**
against the program's **vocabulary**.

The compounding half is why this earns its own entry. **AC-14 was the
criterion that should have caught a missing mutation harness** — the
courtesy layer had *zero* rows, so nothing proved its clauses were
load-bearing. Because the criterion was malformed it recorded PARTIAL
("39 passed") instead of RED, and the gap stayed invisible until a review
lens found it. **A malformed criterion does not merely fail to fire; it
launders the absence it was written to detect into a plausible number.**

Cheap fix, and it is mechanical: after running a criterion, `grep` your
expected literal against the captured output and require a hit. If your
expected string is not IN the output you just captured, the criterion is
prose, not a check — regardless of what the exit code said.

## Doctrine 22

**Squash-merging the base of a stacked PR breaks the child — repair it before
the child's checks mean anything.** *(W-49 retro, 2026-08-09.)* Squashing PR A
rewrites the merge base, so a PR B stacked on A's branch goes
`CONFLICTING/DIRTY` the moment it retargets — and per the loop's own Phase 5,
**a conflicting PR runs zero checks**, which is indistinguishable from slow
CI. B may also fail to auto-retarget at all if A's branch was not deleted.
Rebase B's commits onto the new default branch, then **assert the rebased tree
is byte-identical to the tree that was actually reviewed** (`git diff <old-head>
<new-head>` → 0 lines) — a rebase is a re-application, not a move, and the
tree is the only thing acceptance ever verified. Then re-run the child's gates:
the green checks belonged to the pre-rebase head. Do the rebase in a
**separate `git worktree`**; a nested repo's working tree frequently holds the
PO's own mid-flight branch and untracked files.

## Doctrine 34

**Doctrine 20 asks whether you reproduced the INVOCATION. Ask also whether
you reproduced the CHANNEL the output travels down.** *(W-70 retro,
2026-08-11 — CI found a survivor the author's machine structurally could
not.)* A mutation reinstated a truncating write: write a large buffer, exit
immediately, lose whatever the pipe could not take. The corpus case captured
that output by **redirecting to a file** — and writes to a file are
synchronous on every platform, so the case could not observe the defect at
all. It passed locally by coincidence: this machine's longer temporary paths
pushed an *unrelated internal pipe* over the buffer.

The shipped program consumes that output through a pipe. The test used a
file. Same command, same arguments, same interpreter, same environment — and
a different program, because **where the bytes go changes which failure modes
exist.** Fixing it surfaced a second wrong idiom in the same line: capturing a
NUL-separated stream with `$(...)`, which **strips NUL bytes** and collapsed
1,200 records into one, so the count read `1` regardless of what was written.

Two habits. **Capture the way the caller captures** — if the product reads
through a pipe, the test must read through a pipe, and a convenience redirect
to a file is a different experiment. And **when a check depends on an
environmental property, probe it and print which branch ran** rather than
reasoning about it: W-70's first explanation blamed a platform difference in
the runtime's I/O semantics, asserted from memory and written into a locked
spec. The probe measured both platforms behaving identically. The explanation
was wrong; only the measurement was worth keeping.

## Doctrine 40

**Your own verification command can report a different exit code than the
thing you are verifying — and a denied batch drops the innocent files
silently.** *(W-35 retro, 2026-08-12, two measured instances.)* Doctrine 37 is
about a checker that dies and reads as clean. This is the orchestrator doing
the same thing to itself, twice, in one session.

* **`$?` after a pipeline is the LAST element's.** Checking a gate with
  `bash gate.sh 2>&1 | tail -3; echo "RC=$?"` prints `tail`'s status. Measured:
  `spec-ref-hygiene.sh` **exited 1** on a real unresolved reference, and the
  session printed `RC=0` — a red gate reported as green by the command written
  to check it. Redirect to a file and read `$?` immediately
  (`bash gate.sh >/tmp/out 2>&1; echo $?`), or use `${PIPESTATUS[0]}` in the
  same command. Any `RC=` line you print is itself a toolchain claim.
* **A guard-denied batch fails atomically and says nothing about the rest.**
  A `git add <blocked-path> <innocent-path>` was denied for the first path;
  the second — a playbook fix — was never staged, and its absence surfaced
  only in the final sweep, hours later. The denial message names the offending
  path, so it reads like a targeted refusal rather than a dropped batch.
  **Stage the item's files one purpose per command**, and re-run `git status`
  after any denial rather than assuming only the named file was affected.

Both instances share a shape worth naming: the failure was in the
*instrumentation*, not the thing instrumented, and instrumentation is the one
layer nothing else is watching.

**Third instance, and it is inside a mutation harness's VERDICT — where the
same trap silently converts a working gate into a reported hole.** *(W-44
retro, 2026-08-16, two rows at once.)* A harness running under `pipefail`
scored two rows with `elif node "$GATE" "$MD" 2>&1 | grep -qF "<value>"`.
Under `pipefail` a pipeline's status is the **first** non-zero, so the
pipeline reports the *gate's* exit code — and the gate is **legitimately red
in every one of these fixtures**, because a mutation row plants a defect on
purpose. So the condition read false no matter how well `grep` matched, and
both rows printed `SURVIVED` against a gate with no defect at all.

Two things make this worse than the earlier instances. The verdict is
inverted in the **reassuring-looking direction that is actually alarming**:
`SURVIVED` sends you hunting for a gate hole that does not exist, which is
doctrine 50's cost with a new cause. And a *third* row in the same file
escaped it purely by accident of style — it happened to capture output to a
variable first, which is the fix, applied for no stated reason.

**So, mechanically: a harness verdict never pipes the program under test into
a matcher.** Capture, then match the variable —
`out="$(node "$GATE" "$MD" 2>&1)"; printf '%s' "$out" | grep -qF …` — and
assert the capture is non-empty while you are there (doctrine 13). The tell
to grep for in any harness: `| grep -q` on the same line as the thing being
tested. It is correct only when the program is expected to exit 0, which in a
mutation row is exactly never.

## Doctrine 42

**A polling predicate written as "not the bad state" passes on every state
you did not enumerate — and an early exit looks exactly like completion.**
*(W-36 retro, 2026-08-13 — three self-inflicted instances in one session.)*
Doctrine 40 says the failure is often in the instrumentation, which nothing
else is watching. Waiting is where that bites hardest, because a wait that
ends too early is indistinguishable from a wait that succeeded.

Measured, waiting on CI:
* `all(.[]; .state != "PENDING")` over an **empty** array returns `true`.
  jq's `all` is vacuously true on no input, so a momentary empty response
  ended the wait immediately. Doctrine 13 at a poll loop.
* The same predicate then returned `true` for `IN_PROGRESS`, because the
  real value was never `PENDING` — the field is `bucket`, not `state`. The
  condition was written as a negation of the one bad value I had guessed at,
  so **every value I had not thought of counted as done.**

Both times the loop exited in seconds and printed a still-running check, and
both times the tell was that the answer arrived implausibly fast.

**Assert the state you WANT, from the field the tool documents, and assert
the input set is non-empty.** `all(.[]; .bucket == "pass" or .bucket ==
"fail" or .bucket == "skipping")` with a length guard says what it means;
`!= "PENDING"` says only "not the thing I typed". Cheapest habit: after any
wait returns, print the state you observed rather than assuming the wait
proved it — if the printed state is not one you can name, the predicate was
wrong, not the tool.

## Doctrine 46

**The git index persists between commands. "Stage explicit paths" is not
enough — read `--cached` immediately before every commit.** *(W-79 retro,
2026-08-13.)* CLAUDE.md already forbids `git add -A` because the PO writes
drafts into the tree while a session runs. W-79 found a second door into the
same room, and it does not involve `-A` at all.

A mutation harness refuses to run against a dirty target (it cannot prove it
restored anything otherwise), so the session staged its two scripts to satisfy
that guard — several times, across several edit-and-rerun cycles. Later, a
deliberately scoped `git add docs/reqs/F-44-….md` was followed by a commit
whose message described only the spec. **The commit contained three files**,
because the two scripts had been sitting in the index for an hour.

Nothing was lost here — all three belonged to the item, and the untracked
files in the tree stayed untracked — so the cost was one amended message. The
same sequence with a PO draft staged for any reason is the F-15 incident again.

`git status` is not the check; it shows the working tree and buries the index
in a section people skim. **The check is `git diff --cached --name-only`, run
as its own step immediately before `git commit`**, and the habit is to read
its output rather than glance at it. Staging is a side effect that other
tools' preconditions will cause you to perform, so the discipline cannot live
at the `git add` call — it has to live at the commit.

## Doctrine 51

**`git diff --cached --name-only` tells you WHICH FILES are staged, never
WHICH VERSION — so doctrine 46's own check cannot see a stale index entry.**
*(W-39 retro, 2026-08-14 — a harness shipped to `main` missing four mutation
rows and a concurrency lock, under a PR claiming both.)*

Doctrine 46 says the git index persists between commands and the discipline
has to live at the commit: read `--cached --name-only` as its own step before
every `git commit`. W-39 did exactly that, read a four-line list containing
the harness, and committed a **fourteen-minutes-older revision of it**.

The sequence is ordinary and will recur: stage a file early to satisfy some
tool's precondition (here, a mutation harness that refuses a dirty target),
keep editing it, then `git add` some *other* files. The index still holds the
old blob. `--name-only` prints the path either way, so the output of a
correctly-performed doctrine-46 check is **identical** in the good case and
the bad one. The commit then merged, and the PR body and iteration log both
asserted numbers that were true of the working tree and false of `main`.

The fix is one character: **`git diff --cached --stat`**, or plain
`git diff --cached`. A stale entry shows a smaller diff than the work you
just did, and a file that is fully staged shows the whole change. Where a
claim in the commit message or PR depends on file *content* — a row count, a
gate's score, a flag existing — **assert that content out of the index, not
out of the working tree**: `git show :<path> | grep -c …`. Doctrine 7's W-28
amendment says a criterion naming a command and an expected output is a
toolchain claim; this is the same rule pointed at the index, which is the one
surface where the working tree stops being evidence.

Two habits close it. Prefer `git add` immediately before `git commit` rather
than early; and after any commit whose message makes a checkable claim,
**verify the claim against the pushed branch** rather than against the
directory you have been editing in. W-39's follow-up was found that way and
would otherwise have been found by the PO at the acceptance gate — which is
the gate working, but a round trip later than free.

## Doctrine 60

**A read-strip-set is DESTRUCTIVE when the value read equals the value
written — and the row then falls out of every bucket, which reads as "no
such item" rather than as an error.** *(W-48 acceptance gate, 2026-08-18 —
reproduced on the live ledger, and it came within one query of costing the
item entirely.)*

The `github-issues` adapter sets status by reading the current `loop:<status>`
label into `cur`, then issuing `--remove-label "$cur" --add-label
"loop:<target>"`. Its own text calls this **"idempotent and self-healing"**.
With `cur` == target the add is a no-op — the label is already there, so
GitHub emits no `labeled` event — and the remove then fires. The issue is
left carrying the umbrella label and **no status at all**.

It happened to W-48: `loop:shipped` at 15:23:31Z, then a bare `unlabeled
loop:shipped` at 15:58:18Z with no paired `labeled` event, when a second
iteration-log entry was written and `setStatus` was defensively called again.
Reproduced deliberately on collabb#188 with a baseline asserted first
(doctrine 32): `loop,loop:pending` → same-status call → `loop`.

Three silent failures at once, and none of them prints anything:

| Layer | What it does with a status-less item |
|---|---|
| `listAwaitingAcceptance()` | queries `--label loop:shipped`; matches nothing, so nobody is asked to accept |
| `orient()` | buckets into rework/inFlight/awaiting, **all keyed on status**; the item is in no bucket |
| dependents | satisfied only by closed + `loop:accepted`; W-116 (#185) declares a hard dep on #71 and would have been blocked **forever** |

The generalisable half is the bucketing, not the label. **A query that sorts
rows into named buckets and has no catch-all cannot distinguish "this row is
corrupt" from "this row does not exist"** — doctrine 13's vacuous-green with
the emptiness moved from the input set to the *classifier*. Every bucketing
orient needs an "unbucketed" arm whose non-emptiness is an error, for the
same reason every absence assertion needs a presence assertion (doctrine 13's
W-47 amendment).

Note what did *not* save it. `ledger-hygiene.sh` check 3 catches this exactly
— it selects issues whose `loop:`-label count is not 1 and renders the empty
case as `[none]`. But `repo-gates.yml` fires on `pull_request` and `push`
only, with **no scheduled run**, and the corruption landed at 15:58:18Z,
*after* the merge push at 15:54:51Z. Between iterations this repo receives no
pushes at all. **A detector that exists, is correct, and runs only on a
trigger the defect arrives after is not a control** — it is a control for a
different window. When a corruption can occur outside your trigger's window,
the honest fix is a trigger that covers the window, not a better detector.

Two cheap habits follow. **Before a read-modify-write on a mutually-exclusive
field, exclude the target from the strip set and skip the write when nothing
needs stripping**, so a same-value call is a genuine no-op rather than a
destructive one. And treat a documented claim of *idempotent* or
*self-healing* as the sentence most likely to stop anyone checking — it is
doctrine 59's "a comment states the scope of the file it lives in" pointed at
a property claim rather than a behaviour claim. Filed as W-119 (#189).

## Doctrine 65

**A gate that is red BY DESIGN is a job-topology decision, not a step
decision — and every check behind it in the same job silently stops
running.** *(W-52 rework at the acceptance gate, 2026-08-19 — 20 gates
suppressed, reported as passed.)*

F-61's whole purpose is a forcing function: a currency gate that goes red
when a guardrail patch sits unapplied past a 3-day SLA, and **stays** red
until the PO applies it. The spec's § 3 D5 decided that redness deliberately
and the workflow comment says so in plain words. It shipped as step 24 of 36
in the `gates` job.

GitHub Actions stops a job at its first failing step. This workflow carries
**zero** `if: always()` — measured. So the designed red suppressed the 20
steps behind it, every one reported `skipped`, including the item's *own*
`hook-patch-currency-anchors`, which the iteration log recorded as **passed**.
Since the SLA breach is the designed steady state, those 20 gates would have
stopped running repo-wide for the entire window — the index-leak backstop,
the quarantine gate, the capability gate, the codemap gates, all of it.

**Every layer that looks reads it as clean.** `gh pr checks` renders "20 never
executed" and "20 green" as the same single `gates fail` line. Loop Phase 5's
CI-coverage record asks that a run **exists** at the head SHA and concluded —
it did. `scripts/pr-gate-coverage.sh` asks the same question and is satisfied
in both worlds. This is doctrine 13's vacuous green sitting one level *below*
the gate this repo built specifically to catch vacuous greens, and the
granularity mismatch is the whole reason: the presence assertion is written
about **workflows**, and the truncation happens between **steps**.

Two habits, and the first is nearly free:

* **When an item ships a check that is expected to fail, ask what is behind
  it in the same job — before deciding where to put it.** The unit that
  governs failure propagation is the job, and nothing in the spec template,
  the plan table, or the gate classification has a slot for it. F-61's § 4
  row said "One step" (corrected once, to "two"); the number that mattered
  was neither.
* **A CI presence assertion must reach step granularity.** `[steps[] |
  select(.conclusion=="skipped") | .name]` should be an explicit, short,
  *expected* list — here exactly `["pr-gate-coverage"]`, which is
  legitimately push-gated. Anything else in that array is a check nobody ran
  and everybody counted.

The fix that shipped is a separate job with no `needs:` in either direction.
`if: always()` on the tail was rejected on doctrine 62's grounds: it closes
this instance and leaves the property to be re-applied by hand on every step
added afterwards — a safety check that is a property of a call site instead
of a property of the structure.

And the uncomfortable half, which is doctrine 30's W-42 note earning a second
receipt: **the acceptance gate is a discovery instrument.** Nothing shipped
could have found this. Three review lenses, a design panel, 16/16 mutations,
39 harness rows and a green `--anchors` pass all ran on top of it. What found
it was re-executing one checklist line from a cleared context and reading the
*step list* rather than the job's verdict.
