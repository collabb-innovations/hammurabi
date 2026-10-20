---
name: "gates-harness-safety"
description: "A gate is unproven until it goes red, and the harness that applies a mutation can corrupt the result. Load when: Phase 3–4, when shipping a gate or a harness that rewrites the subject."
---
<!-- collabb-doctrine-pack: id=gates-harness-safety version=1.0.0 sha256=41403883b008c08aed99d361de54ea0323cb4a5187c3bb3f3d75acfa011c2a87 doctrines=9,11,15,18,29,36,41,56,58,62,77 -->
## Doctrine 9

**A gate is not green until you have made it go red.** *(F-14 and F-15 retros
— two consecutive iterations.)* Whenever an item ships a deterministic gate,
mutation-test it: reintroduce each defect the gate claims to catch and
confirm it fails. F-15 found **seven surviving mutations**, including one
where deleting the terminal-state persist entirely left all 59 tests green.
And the sharper half, earned the hard way: **re-run the mutation AFTER
writing the fix's regression test.** F-15's first three tests for an
ungated-invocation bug passed with the guard removed — the apps they used
failed at dispatch anyway, so the tests proved nothing. A regression test
written from a real finding is still not evidence until the finding, put
back, breaks it.
**And confirm the mutation actually applied.** *(F-16 retro, 2026-08-05.)*
A scripted mutation whose pattern matches nothing changes no bytes, the suite
passes, and the runner reports SURVIVED — indistinguishable from a defect the
gate genuinely cannot see. F-16 hit this twice in one run. Assert the file
changed before drawing any conclusion; a survivor you have not proven you
created is not a survivor.
**Changing bytes is not enough — prove the mutation REACHED everything it
claims to.** *(W-29 retro, 2026-08-06.)* F-18's G2 mutation blanked the
generator's match patterns via `sed 's|match: /[^,]*/g,|…|'`. The character
class stopped at the first comma, so it silently skipped the one pattern
containing `{2,}` — that derivation path stayed alive, the check still found
entries, and the harness reported a **survivor that was really an
under-reaching mutation**. Bytes changed, so the F-16 assertion passed. A
partial mutation is the same failure wearing a passing self-test: assert the
*count* of sites you intended to hit, not merely that the file differs.
**A mutation encoding a platform-specific defect must probe the platform.**
*(W-29 retro, 2026-08-06.)* F-18's original defect was that git's `-E` engine
ignores `\b` — true on macOS git 2.55.0, false on the Ubuntu build CI uses.
The mutation asserted the collapse unconditionally and **went red on CI as a
false survivor**: the gate was fine, the mutation was untrue there. Probe the
capability first and assert only what that platform can demonstrate, printing
which case it is. Silently skipping is the other failure; say which branch ran.

## Doctrine 11

**A stub is a blind spot with a green light.** *(F-16 retro, 2026-08-05.)*
When a gate stubs an external boundary, everything the real tool would have
done *past* that boundary stops being exercised — while the suite keeps
reporting green on it. F-16's `gh` stub answered before `--jq` ever ran, so
the dependency-satisfaction filter was never executed: deleting the clause
that stops a **parked** issue from satisfying a dependency, and deleting the
clause that enforces PO acceptance, each left the whole suite green. The
stub was right to exist (CI has no auth), and the harness header even stated
the gap in writing — **documenting a blind spot is not covering it.** Name
what the stub swallows, then cover it another way: assert the un-run text
directly, log and assert the arguments the stub ignores, and put real
execution behind a `--live` flag someone actually runs.

## Doctrine 15

**A harness that tests only the checker inherits the producer's blind spots
entirely.** *(W-29 retro, 2026-08-06.)* Doctrine 14 says a harness shares the
gate's mental model. The sharper case is a harness that never looks at half
the system. F-18 ships two cooperating programs — a **producer**
(`engagement-denylist.mjs`, which derives what must not leak) and a
**checker** (`scan-engagement-egress.mjs`, which enforces it). The harness
covered the checker with ten mutations and the producer with **none**. So
when git's `-E` engine turned out to ignore `\b`, every content pattern
matched nothing, `git grep` exited 1 — its ordinary "no matches" code — and
the producer reported success with an entire category empty. **The harness
stayed green at 10/10 the whole time**, and would have stayed green shipping
a denylist that could not name a single hostname, database filename, or job
identifier. The checker was flawless and enforced nothing.
What found it was running the producer against a real repository and noticing
a zero that should not have been zero. **When an item ships a producer and a
checker, the harness must mutate both, and the producer's first test is a
positive control on real-shaped input** — a derivation that returns nothing
must be indistinguishable from a bug, never from success. A checker fed an
empty rule set is doctrine 13 with extra steps.

**Corollary: a unit test that calls the rule directly does not test the
caller that feeds it.** *(W-16 retro, 2026-08-09.)* F-30's checker has an
extraction layer (pull class/style/attribute values out of a file) and a
rule layer (judge one value). Its unit tests called the rule layer directly
and passed. The extraction layer was splitting class attributes on commas as
well as whitespace, which shredded `bg-[rgb(255,0,0)]` into three fragments
matching no rule — so the arbitrary-value route walked straight through the
gate built to stop it, **while the rule's own test stayed green**. What
found it was the mutation harness's *baseline*, before any mutation was
applied, because the harness planted a real file and invoked the real CLI.
Where a checker has extraction and rules, at least one test per rule must
enter through extraction — a fixture on disk, not a function argument.

## Doctrine 18

**Run the tool over its own output. The mutation suite will not find this
for you.** *(W-31 retro, 2026-08-06 — measured, not argued.)* W-31 ran the
shipped Project Audit end to end against a repository nobody had anticipated
and hit **14 procedural breaks. The mutation suites found zero of them.**
They stayed green at 20/0/0 and 24/0/0 throughout — while the denylist
generator was poisoning every engagement with the word `source`, while the
egress gate was making the customer's own report unwritable, and while the
*fix* for the first had silently re-created it one step over.
What found them: **executing the documented procedure in order** (8 breaks)
and **pointing each shipped program at the artifacts the run itself
produced** (3 breaks, including the two most consequential). Neither is a
test. Both are nearly free.
This is doctrine 14 with a number attached. A harness written from the same
mental model as the tool inherits that model's blind spots *exactly*, so it
is an instrument of **regression**, never of **discovery**. Both W-31
suites are worth having — they now pin all three defects so none can reopen
— but a green harness is evidence about yesterday's bugs only.
**So: whenever an item ships a program that consumes or produces artifacts,
one acceptance criterion is that the program was run over the run's own
output, including our own committed artifacts.** F-20's gate refused its own
attestation and its own run journal; that refusal was the finding. A tool
that has never been aimed at itself has an untested axis, and it is usually
the axis where "we chose this value ourselves" meets "we treat it as
customer data".
*(**Promoted** to `prod-loop` by W-27/F-35 — it is now the second bullet of
Phase 4.5's delivery walk, the sibling of that step's procedure dry-run.
Note the step number: F-35 inserted a new Phase 4 step 4, so the delivery
walk that used to be 4.4 is now 4.5.)*

## Doctrine 29

**A harness's setup code does not only hide defects — it can destroy the
repository.** *(W-24 retro, 2026-08-10.)* Doctrine 16 says the fixture
builder is untested code that constructs the world the assertions run in,
and that its convenience can tidy away the very condition under test. W-24
found the sharper edge: the same untested setup can be actively
**destructive**.

W-24's mutation harness mutates tracked files **in place** (the honest trade
— doctrine 26 records that an isolated copy's failure modes are silent). Its
safety story was: save pristine copies, restore in an EXIT trap, assert
byte-identity. Every word true, and resting on one unchecked call —
`WORK="$(mktemp -d)"`. A review lens shadowed `mktemp` to fail: `WORK`
became empty, `mkdir -p "$WORK/pristine"` became `mkdir -p /pristine`, all
three `cp` calls failed silently (the script sets `-u` and `pipefail` but
deliberately not `-e`), and the harness proceeded to mutate real tracked
files **with no backup in existence**. Restoration is
`cat <pristine> > "$file"` — and the shell truncates the destination before
discovering the source is missing. The files were not left mutated; they
were **wiped to zero bytes**.

Two rules follow, and both are one line each:
* **Check every step that establishes a safety net, not just the steps under
  test.** A backup you did not verify exists is not a backup, and a harness
  that proceeds without one has silently changed category from "mutates and
  restores" to "mutates and destroys".
* **Never redirect from a source that might not exist.**
  `cat missing > tracked` destroys `tracked`. Guard with `[ -s "$src" ]` and
  refuse loudly; restoring from an absent backup annihilates the one file it
  exists to rescue.

And the general form, worth carrying past this instance: **when a tool's
safety argument is a chain, the weakest link is usually an unchecked exit
code in the setup, not a flaw in the logic everyone reviewed.**

## Doctrine 36

**The gate you write will find its first defect in itself. Let it.** *(W-33
retro, 2026-08-12.)* F-39's grant rule was meant to stop a review lens
holding `Write`. Its first version keyed on the name shape — `/-lens$/` —
and the first real run flagged `conventions-lens`, which holds `Write` for a
legitimate reason and is not a review lens at all. **Keying a check on the
shape of an identifier rather than on what the thing IS is doctrine 31's
defect**, and it was sitting in the gate that registers the very lens written
to hunt it. The fix was to declare a `role` and check resolved state.

Two things worth carrying. **The reflex to reach for a name pattern is
strong enough to survive writing the warning against it minutes earlier** —
the same shape as doctrine 21's W-27 note about reading a doctrine not
preventing its failure. And the tell is cheap: a first run that flags
something you know is fine is not noise to special-case, it is the check
telling you it is measuring the wrong property. **Ask what the flagged thing
has in common with the target beyond its name.**

## Doctrine 41

**The thing that APPLIES a mutation is untested code that rewrites the
subject, and its failure mode is to corrupt the program and score the
corruption as a catch.** *(W-36 retro, 2026-08-13 — a reported 20/22 was
really 18/22, hiding four real holes.)* Doctrine 16 says the fixture builder
is untested code. Doctrine 29 says the safety chain is. This is the third
such layer and the one closest to the verdict: the **applicator**.

F-42's harness applied every mutation with `awk`. The gate's source carried
a **literal NUL byte** as a similarity-cache separator, and macOS `awk`
truncates a line at NUL — so every mutation silently cut the file off
mid-function. The mutants did not parse, the suite went red because the
program was destroyed rather than because the defect was noticed, and the
harness scored them **caught**. Doctrine 9's byte-change assertion passed
(bytes certainly changed). The site-count assertion passed. Two compounds
reported SURVIVED, which is what finally exposed it — a syntax error fails
*every* assertion at once, so no single named assertion could be attributed.

Three fixes, in increasing order of generality:
* **Never apply a mutation with a line-based text utility** when the subject
  may contain bytes that utility treats specially. Node reads and writes
  UTF-8 with no line-terminator semantics and is the same program on both
  platforms — doctrine 20's utility-dialect axis, answered by not using the
  utility. (`sed`/`awk`/`tr` all have this class of problem; NUL is only the
  loudest member.)
* **Refuse to score a mutant that is not a well-formed program of its kind**
  — `node --check`, `bash -n`, `python -m py_compile`. This is doctrine 35's
  corollary promoted from advice to a mechanical step, and it converts an
  invisible false-catch into a loud ERROR.
  **But POSITIVE-CONTROL the validity checker itself, because one of the
  three named above is VACUOUS on the file type you will most want it for.**
  *(W-107 retro, 2026-08-17.)* `node --check` on a **`.ts`** file exits **0
  on deliberate garbage** — measured by appending `this is ( not valid
  syntax {` to a TypeScript source and watching it pass. Node type-strips
  rather than parses, so the obvious instrument for a TS mutation harness is
  a check that can never fail, which is doctrine 37 inside the mechanism
  built to prevent doctrine 41. `tsc --noEmit` costs about 1.3s and exits 2
  on the same input. The general rule is one line and applies to every
  validity checker you adopt: **feed it something broken and confirm it
  complains, before you trust it to tell you a mutant is sound.**
* **Prefer single-line, syntactically-valid mutations.** Deleting one line
  out of a multi-line call leaves unparseable code; neutering a condition to
  `false` or replacing a whole statement does not.

And the uncomfortable part: a literal NUL in source is *also* a defect, and
nothing flagged it. **If a file is going to be mutated, it should be free of
bytes that make it hostile to ordinary tooling** — write NUL as ` `.

## Doctrine 56

**Introducing a relative import turns every "copy the program somewhere
isolated" harness into one that CANNOT LOAD — and a program that cannot load
exits non-zero for every input, which a mutation harness scores as a catch.**
*(W-32d retro, 2026-08-14 — three instances in one session, in three
different harnesses, two of them owned by other items.)*

Doctrine 26's corollary already records that an isolated copy of a gate may
not run at all and that this looks like a pass. W-32d found the sharper and
more common version: it is not the isolation *technique* that breaks, it is
an ordinary refactor **somewhere else** that breaks every existing isolation
technique at once. Moving shared data into `scripts/lib/leak-shapes.mjs` and
importing it relatively did all of this in one commit:

| Harness | Symptom | What it looked like |
|---|---|---|
| `scan-engagement-egress-mutations.sh` PR3 | copy in `$WORK` could not resolve `./lib/` | **false SURVIVED** — "the mutant refused too" |
| `audit-pipeline-mutations.sh` | staged `scripts/` without `scripts/lib/` | exit 2, in an item that owns neither file |
| a new row written the same hour | ran after a prior row emptied the module | **false SURVIVED**, guard had nothing to iterate |

The first is the dangerous one. `SURVIVED` reads as *"the gate has a hole"*,
so it sends you hunting for a defect that does not exist — doctrine 50's
"check the mutation before you check the gate", with a specific trigger:
**suspect the loader whenever a survivor appears in a harness you did not
touch, right after you changed a module's import graph.**

Two mechanical fixes, both cheap and both now shipped here. **Stage the
dependency** wherever a harness copies a program. And more importantly,
**give every copied-program harness a positive control on the copy itself**:
before believing any verdict derived from a mutant, run it on a CLEAN input
and require exit 0. A mutant that refuses everything is a broken fixture, and
one line separates that from a finding. This is doctrine 32's
"demonstrate the absence of the finding first" pointed at the *program under
mutation* rather than at the fixture.

The general form, and the reason it is worth its own entry: **an import is a
coupling that every harness in the repo silently depends on, and no harness
tests it.** After adding one, run every harness that copies a program, not
only the ones for the files you edited.

## Doctrine 58

**An in-place mutation harness is safe only while it is the ONLY writer.
Run one concurrently with anything else in the same checkout and its
"mutates and restores" contract silently becomes "mutates, and reverts
whatever you did meanwhile".** *(W-110 retro, 2026-08-17 — twice in one
session, in both directions.)*

This repo deliberately mutates tracked files in place rather than working on
a copy, and doctrine 26 and 56 both record why: a copy's failure modes are
silent, the in-place one's are loud. Every such harness therefore refuses a
dirty target, takes a verified pristine copy, restores in a trap, and
asserts byte-identity. That machinery is correct and it held perfectly here.
It is also **single-writer by unstated assumption**, and nothing says so.

| Instance | What happened |
|---|---|
| A harness was backgrounded while the session kept working | a concurrent `vitest run` read the deliberately-mutated tree and reported **12 failures in a file the item never touched**. They read exactly like a regression |
| A review lens ran the harness while the session edited the same file | the harness's pristine copy predated the edit, so its restore **reverted a committed-pending fix**, and the file on disk carried a live mutation for the duration |

Neither is a defect in the harness. The restore did precisely what it
promises — return the file to the state it found. The failure is that
"the state it found" is a snapshot, and a snapshot is only a safe thing to
restore if nobody else writes in between.

Three rules, all cheap:
* **Never background an in-place mutation harness.** Run it in the
  foreground and do nothing else in that checkout until it exits. The
  20 minutes are not saved by overlapping them; they are spent twice
  diagnosing a phantom regression.
* **Never edit a harness's target while any harness that mutates it may be
  running.** If a lens has been dispatched with a Bash grant, assume it will
  run every harness it can find — mine did, unprompted and correctly.
* **Say so in the harness header**, next to the dirty-target refusal, so the
  next person meets the constraint where they meet the mechanism.

The tell, and it is worth recognising fast: **failures concentrated in a
file your diff does not touch, immediately after you started something in
the background.** Check `git status` on the harness's target before
diagnosing anything.

## Doctrine 62

**Applying a safety guard at ONE of N call sites is not applying it. Funnel
the dangerous operation through one function.** *(W-50 retro, 2026-08-18 —
demonstrated: the harness wiped its own tracked target to zero bytes.)*

Doctrine 29 says never redirect from a source that might not exist, because
`cat missing > tracked` truncates the destination **before** discovering the
source is gone. F-58's mutation harness knew this — its restore carried the
`[ -s "$WORK/pristine" ]` guard, and a comment citing doctrine 29 sat right
next to it.

On **one of nine** call sites. The EXIT trap was guarded; the eight mid-loop
and final restores redirected raw. A security lens deleted `$WORK/pristine`
mid-run and `scripts/pr-gate-coverage.sh` was left at **0 bytes** — with the
byte-identity assertion then correctly reporting a corruption it could no
longer undo. Every element of the safety story was present and the outcome
was total data loss on a tracked file.

This is not carelessness, it is how guards get written: you fix the site you
were looking at when you thought of the hazard, and the other sites were
written before or after that moment. Grep discipline does not scale either —
the next edit adds a ninth.

**So: when an operation can destroy something, give it exactly one entry
point and make every caller use it.** F-58's `restore_target()` refuses loudly
and returns non-zero; the raw redirect now appears exactly once in the file,
which is a property you can assert (`grep -c` → 1) instead of a habit you have
to maintain. Verify with a baseline first (doctrine 32): pristine captured at
N bytes, deleted mid-run, target still N bytes.

General form, and it applies well beyond harnesses: **a safety check is a
property of a CALL SITE until you make it a property of a FUNCTION.** Count
the call sites before believing any guard is in force.

## Doctrine 77

**A harness that scores a mutation TWICE — with your change and without it — is
making a claim about a suite it RECONSTRUCTED, and the reconstruction is
untested code that can pin the differential at zero while reading as a
measurement.**

*Retro: W-83 (collabb#137), 2026-09-07. The item's spec and harness are
named on that issue; this entry deliberately cites the LEDGER ITEM rather than
the spec id, because the spec landed in a different pull request and a doctrine
that cannot resolve until some other branch merges is a doctrine that blocks its
own retro.*

The item was a regression pin, so the question that decided whether it was worth
shipping was not "do the fixtures go red" but "do they catch anything the
pre-existing suite does not". The harness answered that by scoring every
producer mutation against the full suite and again against the suite with the
new work removed — RED in both means a pin, RED only in the first means new
detection. It reported **0 rows caught only by the new fixtures**, twice, with
every row green and exit 0.

The zero was an artifact. The removal step was wrong in two independent ways,
and both are in the harness's *setup*, which nothing tested (doctrine 16):

1. It rewrote the new block's `describe(` to `describe.skip(`, which left the
   item's other
   contribution — a row added to a pre-existing all-shapes sweep in a *different*
   block — still present. The "pre-existing" suite still contained new work.
2. Removing that row then dropped the sweep below a floor the item had *raised*,
   so the reconstructed suite carried a **guaranteed red**. A row can only be
   scored "new detection" when the without-run is GREEN. It never could be.

So the metric was zero **by construction**. Nothing in the output distinguished
that from a real finding: the rows were caught, the anchors were clean, the exit
code was 0, and the summary line printed a number.

The fix needed two independent controls, because the two defects were
independent:

1. **Prove the reconstruction removes every new detection contribution.** The
   without-arm must be derived from the item's actual diff, not from the first
   obvious new block: remove the new block, remove any sweep rows or other edits
   made inside pre-existing blocks, and adjust any example floors the item raised.
2. **Then require a clean GREEN reconstructed baseline before scoring any row.**
   With that in place the number moved 0 -> 1 and identified the row that
   justified the item — a *shape-conditional* mutation invisible to every
   pre-existing fixture.

Two generalisations worth carrying:

- **A differential metric needs a positive control on its baseline, not only on
  its subject.** Doctrine 13 says a green over an empty input set is not a green;
  this is its sibling — *a difference measured against a broken baseline is not a
  difference.* Ask what the without-arm would have to look like for a non-zero
  answer to be *possible*, before believing a zero.
- **Removal is not the inverse of addition.** An item that touches N places needs
  all N undone. The reconstruction step must enumerate the item's own diff, not
  the one edit that is easy to see.

*Corollary, and the reason the first defect surfaced at all.* The same run
correctly reported a **survivor** — a row whose mutation reddened the suite but
not the test the row named. That only happened because the oracle scored the
**failing test's NAME** rather than "the suite exited non-zero" (doctrine 74).
An exit-code oracle would have scored that row a catch, and the mis-aimed row,
the broken reconstruction, and the fake zero would all have shipped green
together.
