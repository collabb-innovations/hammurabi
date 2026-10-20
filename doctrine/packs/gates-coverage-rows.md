---
id: "gates-coverage-rows"
version: "1.0.0"
summary: "Mutation rows prove only the checks they encode; anchors, polarities, and reconstructions can lie."
load_when: "Phase 3–4, when a mutation row is the evidence a check exists."
doctrines: [14, 28, 33, 43, 44, 47, 54]
complex: true
complex_reason: "This is one part of a locked gates sub-topic (oracles or coverage). The coarser pack exceeded 8k tokens, so the sub-topic is split further. The retro evidence is why the part still exceeds the 2k default."
targets: ["cursor-rule", "agents-md", "grokbot-skill"]
cursor:
  globs: []
  alwaysApply: false
---
## Doctrine 14

**Mutation testing proves the checks you wrote, never the checks you
omitted.** *(W-28 retro, 2026-08-05.)* F-17's harness reported 10 caught, 0
survived, 0 errored — and the gate still had five holes, including two that
let a finding's title and its cluster assignment differ between the data and
the delivered document. A harness is written from the same mental model as
the gate, so it inherits that model's blind spots exactly. What found them
was a completeness lens that **ran** candidate mutations and reported real
exit codes, rather than reasoning about coverage in prose. When an item
ships a deterministic gate, one review lens must be adversarial *and
executing*: give it the gate, the fixtures, and a temp dir, and require
demonstrated survivors rather than argued ones. Every survivor it finds then
becomes a permanent mutation (F-15's amendment), so the hole cannot reopen.

## Doctrine 28

**Ruling out A is not evidence for B. Run the mechanism you CHOSE against
the input that would expose it.** *(W-24 retro, 2026-08-10 — the defect the
item existed to fix, reintroduced by the item's own fix, and it reached a
LOCKED spec.)*

F-33 had to write a user-supplied verify command into a YAML file. The spec
ruled out `sed` by running it: an interpolated replacement corrupts on `|`
and `&`. It then prescribed `awk -v` and never ran *that* against anything
that could distinguish it. `awk` **escape-processes `-v` assignments**, so
`--verify 'find . -name \*.go -exec go test {} \;'` was written to the
config as `find . -name *.go -exec go test {} ;` — a different, broken
command, presented as the one the user typed. That is precisely the failure
class the item was filed to eliminate.

It survived a locked spec, an implementation, eight assertions and a
six-mutation harness, because **every fixture shared the property that made
the two mechanisms indistinguishable**: none contained a backslash, and the
`|`/`&` case passes under both. Doctrine 26 names the corpus problem; this
names how the corpus got that way. The evidence was *shaped by the rejected
alternative* — fixtures were chosen to demonstrate `sed`'s failure, so they
could only ever probe the axis `sed` fails on.

A second instance landed the same hour, from the same reflex. The guard
written to reject a newline was `case "$V" in *"$(printf '\n')"*)`. Command
substitution strips trailing newlines, so the pattern collapsed to `*""*` —
matching **every** value and rejecting every valid install. Written, read,
committed, and wrong; the suite caught it in seconds.

**So: when a decision rejects mechanism A in favour of B, you have tested A.
You have tested nothing about B.** Before the lock, run B against the
adversarial inputs *for B* — which are usually a different set than the ones
that killed A. Ask "what input would make my choice look identical to the
thing I rejected?" and put that input in the corpus. Cheapest version:
render one value containing every metacharacter class at once
(`| & \ $ ' "` and a newline) and diff it byte-for-byte against the input.
*(Candidate for promotion to `prod-loop` — it is about how design evidence
is selected, not about this repo.)*

**Corollary — mutation anchors rot when you reformat the target.** Three of
this item's mutation patterns silently stopped matching when the code under
them was rewrapped, in one session. Nothing was lost, because the harness
asserts a mutation applied (doctrine 9's F-16 amendment) and reported
`MUTATION DID NOT APPLY` instead of a false survivor — but a pattern needing
re-escaping every time its target is reformatted will eventually be quietly
wrong. Anchor mutations on `index($0, "<distinctive substring>")`, not on
fully-escaped whole-line regexes.

## Doctrine 33

**Fix a finding, and the mutations pointing at the code you changed are now
lying. Re-verify anchors mechanically, before paying for a suite run.**
*(W-70 retro, 2026-08-11 — six anchors rotted inside one session.)* Doctrine
28's corollary says to anchor mutations on a distinctive substring rather than
an escaped whole line, because reformatting breaks them. W-70 hit the sharper
version: the *session itself* rewrote the code its own mutations pointed at —
a batch protocol changed from newline- to NUL-separated, two writes became a
synchronous helper — and **six anchors stopped matching**.

Nothing was lost, because the applied-assertion converted every one into
`MUTATION DID NOT APPLY` rather than a false survivor. What it cost was two
full suite runs, twenty minutes each, to discover a class of problem that a
dry pass answers in under a second.

So: **a mutation harness should be able to check its own anchors without
running the gate** — apply each pattern, assert it hits exactly the intended
number of sites and changes bytes, report, and exit. Run that immediately
after any edit to a mutated file. W-70 built this as an ad-hoc script and it
paid for itself on first use, catching all six before a re-run; it belongs
*in* the harness, not beside it.

The general form, which is doctrine 9's "prove the mutation applied" moved
earlier in time: **an assertion about code is invalidated by editing that
code, and the cheapest moment to find out is before you spend twenty minutes
finding out expensively.**

**Sharpening — the ANCHOR can survive the edit while the FIXTURE stops
reaching it, and every applied-assertion in this repo passes.** *(W-44 retro,
2026-08-16.)* Doctrine 33 and its `--anchors` dry pass both answer one
question: *does this pattern still match?* W-44 hit the case where the answer
is yes and the row is dead anyway.

A row proved that `engagementTypeOf` maps an **absent** type to the default,
by mutating the single expression every input flowed through. Later in the
same session, fixing an unrelated bug split absent/null into an **early
return** above that expression. The anchor still matched one site, the
mutation still applied, the mutant still parsed — and the fixture's input now
returned before ever reaching the mutated line. The row reported `SURVIVED`
against code that was completely correct.

Nothing mechanical catches this: the anchor is fine, the bytes changed, the
site count is right. What catches it is asking, of every row whose target you
edited, **"does my fixture's input still take the path through the line I
mutate?"** — a control-flow question, not a text question. The tell is a
refactor that adds an early return, a guard clause, or a new branch *above*
a mutated line; every row whose fixture used to fall through is now suspect.
The repair is usually to split the row so each branch has a fixture that
reaches it (here: one for blank, one for absent).

**It IS mechanizable, and cheaply — assert the mutant BEHAVES differently
before scoring it.** *(W-45 retro, 2026-08-16 — the same case twice in one
item, in a session that had read the paragraph above.)* W-45 hit this on two
separate rows. Both times every existing check passed: anchor matched, one
site, bytes changed, `node --check` clean. Both times the row measured
nothing, because a guard *above* the mutated line returned first for that
fixture's input. And both times the verdict was `SURVIVED`, which reads as
"the gate has a hole" and sends you hunting for a defect that does not exist
(doctrine 50's cost, with a new cause).

The missing check is one line, and it is the mutation-testing analogue of a
positive control: **a `guard` row's mutant must produce a DIFFERENT result
than the clean run for its own fixture.** If mutant output equals clean
output, the row is not a survivor — it is unreachable, and the harness should
say `ERROR — mutation not reached by this fixture` rather than scoring it.
That converts an invisible, actively misleading survivor into a loud refusal,
and it needs no knowledge of the code's control flow: it just compares two
strings the harness already has.

Note the ordering this implies. Doctrine 33's `--anchors` dry pass answers
*"does the pattern still match"*; doctrine 9 answers *"did bytes change"*;
doctrine 41 answers *"does it still parse"*. **None of them can answer "does
my fixture reach it", because that is a runtime property, not a text one** —
so it needs a runtime check, and the run is already happening.

**The commonest way to write an inert mutation: ADD something that a later
line silently overrides.** *(W-107 retro, 2026-08-17 — the same row, inert
twice, in two different locations.)* The W-45 check above is written for a
mutation that a *guard above it* prevents reaching. There is a second shape,
and it needs no control flow at all — the mutated line executes every time
and is simply undone downstream.

A row restored a rejected `{ ...body, decidedBy: session }` spread by adding
`...draft` to the top of an object literal. The explicit `at:` key several
lines below **overrode it**, so the mutant was byte-different, single-site,
type-clean and **behaviourally identical**. Moving the code into a shared
helper later, the row was rewritten — and reproduced the same inertness in
the new location, because the same explicit key still followed the spread.

The lesson generalises past object literals to anything last-write-wins: a
later assignment to the same variable, a subsequent `set` on the same key, a
default applied after the value. **A mutation that ADDS is only real if
nothing downstream re-specifies what it added** — so the faithful
restoration had to be compound, removing the overriding key as well. And the
content of the finding is the content of the original design decision: a
spread is dangerous only for the fields the explicit ones do *not* cover,
which is exactly why the rejected `{ ...body, decidedBy: x }` was unsafe
while `{ ...body, decidedBy: x, at: y }` would not have been. **When a
mutation is inert, ask what re-specifies it, not only what returns before
it.**

## Doctrine 43

**A new rule modelled on an existing one duplicates its TEXT, and every
mutation anchored on that text now matches two sites.** *(W-37 retro,
2026-08-13 — measured, in an item that touched neither the other rule nor
its harness.)* Doctrine 33 says a mutation anchor rots when you edit the
code it points at. This is the case nobody looks for: **the anchor rots when
you edit code somewhere else.**

F-43 added a skill-registry validator to `validate-contracts.mjs`, written by
following the agent validator directly above it. Three lines came across
verbatim — `if (fm.name !== entry.name) {` and two aspect checks. F-39's
harness anchors on the first with `awk index($0,a)` asserting **exactly one
site**, so `test-agent-registry-mutations.sh` went red with `anchor did not
apply`, in an item that changed nothing it owns. The same collision hit this
item's own three anchors, caught by `--anchors` reporting `SITES 2 != 1`.

Both were caught, and only because **every anchor asserts a site count
rather than merely that bytes changed** (doctrine 9's F-16 amendment, plus
W-29's under-reaching-mutation note). Without the count they would have
silently mutated *both* rules at once and scored the result — a mutation
that tests two things and attributes the verdict to one.

Two habits, both cheap. **After adding a rule modelled on an existing one,
run every mutation harness in the repo, not only your own** — `--anchors`
dry passes make this seconds, and the harness you break is by definition one
you were not thinking about. And **when the collision is with another item's
harness, fix it on YOUR side**: a line-oriented anchor cannot express
context, so the repair is to make your line textually distinct and say in a
comment why it must stay that way. Copying a neighbouring rule is the normal
way to write a consistent one; the cost is that consistency and anchor
uniqueness are in direct tension.

## Doctrine 44

**A guard inherited from a sibling tool is not inherited by your tool. Check
what the neighbouring program already had to fix.** *(W-37 retro,
2026-08-13 — a critical finding, in the class this repo had already paid
for once.)*

F-43's registry turns a `name` into `knack/skills/<name>/skill.md` and reads
it. Both consumers used a **lexical** containment check — `path.resolve` plus
`startsWith(REPO_ROOT)` — which confines the *declared string* and says
nothing about where the path leads. A symlink at `knack/skills/<name>`
pointing anywhere on the machine was followed, and a resolved skill's whole
body is read and handed to an LLM as a system prompt. The worst target on
this machine is another customer's engagement clone under `engagements/`.

**W-36 fixed this exact class, three weeks earlier, in `generate-codemap.mjs`
— realpath confinement after a tracked symlink read outside a customer
clone.** That fix is described in this file. It was not carried across,
because the new code was modelled on `agents.json`'s validator, where
`definitionPath` is repo-internal and the question never arises.

The tell is structural and worth looking for by name: **whenever data names
a path that your code then reads, ask which other program in the repo reads
an attacker-influenced path, and go read its guards.** A lexical check is
almost always the first version, and almost always wrong — `realpathSync`
both the target and the boundary, and compare. Related, and it bit in the
same file: `fail()`/`report()` helpers that append to a list **do not
return**, so a name rule written above a path build is a *report*, not a
guard. A check that runs after the read is not a check.

## Doctrine 47

**A reconstruction that fails to reproduce a finding is not a refutation.
Run the lens's OWN artifact before disbelieving it.** *(W-38 retro,
2026-08-14 — a critical-adjacent finding was one step from being written off.)*
Doctrine 32 says the throwaway script you write to *confirm* a finding needs a
positive control, because a fixture that always says CONFIRMED launders
guesses into facts. W-38 hit the mirror image, which is worse because it feels
like diligence.

A security lens reported that an unsound memo let a merge two hops from a
denied gate be invoked. I rebuilt the graph from its description, asserted a
clean baseline first, ran it — and got the correct `skip` in both the baseline
and the attack. By every habit this repo has, that reads as a refuted finding.
It was a broken fixture: the decoy gate has to sort **after** the target, or
the walker simply resolves the decoy first and never reaches the code under
test. My decoy was named `D`, which sorts before `M2`. Running the lens's own
script reproduced it immediately, and the defect was real.

The asymmetry is the point. A false CONFIRM gets caught downstream — the fix
lands, the pin goes in, and a wrong pin usually fails loudly. A false REFUTE
is terminal: the finding is closed, no artifact survives, and nothing ever
revisits it. **So the evidentiary bar for disbelieving a lens is higher than
for believing it**, which is the opposite of the intuition that skepticism is
the safe default.

Cheapest version, and it costs one command: **a lens that reports by execution
must leave its script on disk, and refuting it means running that script, not
your description of it.** If the lens's own artifact reproduces and yours does
not, yours is the broken one — find out why before writing either verdict
down. Where a lens reports something it did *not* execute, that is a different
situation and doctrine 7 applies unchanged.

## Doctrine 54

**A mutation harness needs BOTH polarities, and the one it lacks is the one
that catches a defect nobody guarded against.** *(W-32b retro, 2026-08-14.)*
Most rows in this repo's harnesses are the same shape: plant a defect,
confirm the gate refuses it, neuter the clause, confirm the refusal stops —
*"is this guard load-bearing?"* Call that a **guard** row.

Doctrine 52's finding could not be written as one. There is nothing to plant:
the mutation *is* the defect, and the question is *"does anything notice?"*
Call that a **detect** row. F-48's harness understood only `guard`, so the two
rows covering the tautology reported `ERROR — positive control did not fire`,
which reads as a broken row rather than as a harness that cannot express the
test. Adding a polarity field took ten lines and both rows then caught.

Check both directions of the control, not just one: a `detect` row whose
assertion **already fires before** the mutation is measuring something else,
the same way a `guard` row whose assertion **does not fire before** it is.
Cheapest version: ask of each row, *"am I proving a clause is load-bearing,
or proving a defect is noticed?"* If a harness can only say the first, every
defect with no clause guarding it is invisible to it — and those are the ones
left.

**Corollary — the harness's own instrumentation is untested code.** Three of
F-48's anchors reported ROT because `count_sites()` passed the needle through
`awk -v`, which **escape-processes its assignment**: any anchor containing
`\n` (several did — they point at template-literal code) arrived as a literal
newline and could never match a line. That is doctrine 28's measured defect,
recurring inside the tool built to detect rot. A fourth failed because the row
delimiter was `|` and one anchor was `scoreOf(b) - scoreOf(a) ||`, so the
declared site count arrived **empty** and printed as `SITES 1 != `. Both look
exactly like "the code moved". **When several anchors rot at once, suspect
the reader before the code.**

