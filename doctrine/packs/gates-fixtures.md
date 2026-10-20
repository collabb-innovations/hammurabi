---
id: "gates-fixtures"
version: "1.0.0"
summary: "Fixtures decide what a harness can see; derive them from the threat, the shape, and the object store."
load_when: "Phase 3–4, when designing fixtures, shapes, or the input set a harness will see."
doctrines: [16, 26, 32, 45, 48, 67, 73]
complex: true
complex_reason: "The retro evidence is part of the rule, and this pack exceeds the 2k default while remaining inside the 8k complex cap."
targets: ["cursor-rule", "agents-md", "grokbot-skill"]
cursor:
  globs: []
  alwaysApply: false
---
## Doctrine 16

**A harness's setup code decides what the tests are allowed to see, and
nothing tests the setup code.** *(W-30 retro, 2026-08-06.)* F-19's promoter
refuses to write customer material into a git-tracked destination. Its
mutation P5 asserted exactly that, and passed. The guard was **inert in every
real invocation**: it probed `git -C <destination>`, which fails identically
for "missing directory" and "not a repository", and the destination never
exists yet because the promoter creates it. Customer-shaped material landed
inside the tracked repo, exit 0, success message printed.
The harness could not have caught it, because its `new_ws()` fixture builder
did `mkdir -p "$ws/raw" "$ws/work"` — **pre-creating the exact precondition
that hides the defect.** One line of convenience in a setup helper silently
guaranteed that every custody test ran against a directory that already
existed, which is the one case where the check worked.
This is not doctrine 15 (both producers *were* mutated) and not doctrine 9
(the mutation genuinely applied). It is one layer earlier: **the fixture
builder is untested code that constructs the world the assertions run in.**
Read every line of setup and ask *"does this establish a state the check
under test is supposed to reject?"* Where a check's whole job is to refuse a
condition, the harness must build that condition, not tidy it away. More
mutations do not help — they all run inside the same manufactured happy path.

## Doctrine 26

**A fixture suite where every case is the same SHAPE cannot see any rule
that is conditional on shape.** *(W-23 retro, 2026-08-09 — four survivors,
measured.)* Doctrine 14 says a harness inherits the gate's mental model;
doctrine 16 says the fixture *builder* can tidy away the condition under
test. This is a third thing, and it is about the *corpus*: F-32's checks were
nine fixtures that all shared two accidental properties — **exactly one edge**,
and **well-formed apart from the single defect under test**. Every individual
fixture was correct. The monoculture was the defect.

The adversarial completeness lens applied candidate mutations and
demonstrated **four survivors against a harness reporting `0 survived`**:

| Mutation | Why every fixture missed it |
|---|---|
| `i === 0 && …` — check only `edges[0]` | no fixture had a second edge |
| `errors.length === 0 && …` — stop once another error exists | no fixture had a second error |
| drop the `?.` after `nodeById.get()` | no fixture paired an **unresolved** ref with the new rule's trigger — the mutant *throws*, violating that module's own documented "never a stack trace" |
| gut the error message to `"invalid edge"` | the probe read only `res.ok`, never the text |

The generalisation: a rule can be made conditional on **position** (which
element), **accumulated state** (what already failed), **interaction** (a
second defect in the same input), and **output detail** (the message, not the
verdict). A corpus with no variation along an axis cannot fail along it, and
adding *more* fixtures of the same shape adds nothing. **Before calling a
check suite done, list the axes the rule could be conditional on and confirm
at least one fixture varies along each.** Cheapest version: one multi-element
input, one input with two independent defects, one assertion on the message
rather than the verdict.

**Two more axes, and a live bug behind 35 green rows: the TYPE and the SIZE
of a value, not merely which value it is.** *(W-44 retro, 2026-08-16.)* A
gate resolved an engagement type with
`String(data?.engagement?.type ?? "").trim()`. All 35 mutation rows set that
field to a **string**, because the threat everyone modelled was a typo.
`String(["technical"])` is `"technical"` — so a JSON **array** silently became
a registered type and the whole report validated **clean at exit 0**. A
number was always caught (`String(42)` is `"42"`, unregistered), which is
exactly why the gap survived: it is specific to the one JS type whose
coercion happens to *look like* a legal value.

The size axis failed the same way in the same file. The one row guarding a
redaction helper attacked with a 68-character string, so a bypass echoing
anything **short** — a private IP is 8 characters — was outside the corpus
entirely.

Both were found by an executing completeness lens; neither by the suite.
**So where a field crosses a trust boundary, vary its type (string, number,
array, object, null) and its length (empty, short, oversized), not only its
content** — and look hardest wherever the code reaches for `String(x)` or any
other coercion, because coercion is what turns a malformed input into a
plausible one. A single-element array is the standard adversarial case, being
the one that coerces to something legal.

Two corollaries earned the same hour:
* **A harness header is an unverified claim like any other.** F-32's stated
  that `npx vitest run` was one of the real entry points it exercised. The
  string appeared exactly once in the file — in that sentence. Grep your own
  docstring against your own script.
* **An isolated copy of a gate may not run at all, and that looks like a
  pass.** Moving the mutation target to a temp tree to avoid mutating a
  tracked file made `validate-contracts.mjs` **exit 0 with zero output**: its
  main-module guard compares `process.argv[1]` to a realpath, and `mktemp -d`
  returns a symlink on macOS. A silent vacuous green (doctrine 13) produced
  *by the isolation measure itself*. In-place mutation plus an atomic lock, a
  byte-identity assertion inside the trap, and a baseline pass that refuses a
  dirty tree was the honest trade — the copy's failure modes are silent, the
  in-place one's are loud.
*(**Promoted** to `prod-loop` by W-27/F-35 — `playbooks/mutation-testing.md`
§5, "vary the corpus along every axis the rule can condition on".)*

**Sharpening — a design PANEL rules out alternatives, and then the judge
credits the winner with a property nobody tested.** *(W-67 retro, 2026-08-11.)*
F-37's judge did the right thing under doctrine 23: three sketches all rested
on git behaviour none had executed, so it ran six measurements instead of
scoring the prose. Those measurements were real, correctly performed, and
decisive — one of them (`GIT_DIR` outranks `-C`) killed a whole design.
Every one of them was chosen to **discriminate between the candidates**.
None probed the winner on the axis where the winner is weak. So the spec
locked saying the capability control "closes all 19 measured bypasses at the
kernel", and Phase 3's harness discovered it closes **16** — `push` writes to
the *remote*, and a clone's mode bits are irrelevant to that. The claim
survived a design panel, a judge that had just run six experiments, and a PO
lock.
The tell is that discriminating evidence and validating evidence are
different experiments, and running the first feels like having done the
second. **After choosing, list what the WINNER claims and test each claim
against the input that would falsify it** — separately from anything used to
rank the options. Cheapest version: for each bypass/case the design says it
closes, ask "by what mechanism, exactly" and run the one where the mechanism
sounds different from the others.

## Doctrine 32

**The throwaway script you write to VERIFY a review finding is a fixture
builder, and it needs a positive control like any other.** *(W-70 retro,
2026-08-11 — five findings nearly "confirmed" on evidence that proved
nothing.)* Doctrine 16 says a harness's setup code decides what the tests are
allowed to see. Doctrine 13 says a green over an empty input set is not green.
Both are written about *shipped* harnesses. The gap they leave is the
ten-minute script you write to check whether a review lens was right.

A security lens reported five bypasses of F-38's audit. The reproduction
script built five engagement fixtures and ran the audit against each. All five
reported the failing exit code, so all five looked confirmed. **The fixture
builder never locked or provisioned the clone**, so leg 1 correctly reported
every path in a fully-writable tree, and every case "detected" something
entirely unrelated to the attack under test. The tell was that all five agreed
too neatly. Rebuilt with one line — assert the baseline audit is CLEAN before
the attack — all five reproduced as genuine, so the conclusion survived. It
did not have to.

This is the more dangerous direction than a false negative: a verification
step that always says CONFIRMED launders a lens's guesses into facts, and
everything downstream — the fix, the corpus case, the spec's § on what was
found — is then built on it. **Any script written to confirm a finding must
first demonstrate the ABSENCE of the finding on the same fixture.** One
assertion, before the attack. If the baseline is not clean, the fixture is
measuring something else and every verdict it gives is noise.

## Doctrine 45

**A fixture derived from the implementation's MECHANISM tests the mechanism.
Derive it from the THREAT.** *(W-79 retro, 2026-08-13 — the item's own
headline control shipped bypassable, and its fixture passed the whole time.)*
Doctrine 14 says a harness inherits the gate's mental model. This is the
sharper case: the fixture was not merely written from the same model, it was
**reverse-engineered from the code's internals**.

F-44's novel control refuses a draft that copies a long literal span from the
customer's clone. The implementation scanned the draft line by line, carrying
the previous line forward — so it bridged exactly **two** lines. The fixture
written to prove it, `reflowed`, split a copied span across exactly **two
lines**, using `cut -c1-80` and `cut -c81-160`. It passed. It was the only
shape the implementation could possibly handle, and it was chosen *because*
that is how the code worked.

Measured, with a clean baseline asserted first: the same customer algorithm
copied verbatim onto one line was refused, and **the identical text with one
word per line was promoted, intact**. Any editor's word-wrap reproduces it by
accident. Nineteen mutations, twenty-four assertions and a green CI run all
sat on top of a control that a `fold` command defeats.

The tell is answerable in one question, before writing the fixture: **"am I
describing the attack, or am I describing what the code does?"** A fixture for
"a copied span must be caught" is *the span, reflowed every way a human might
reflow it*. A fixture that mirrors the implementation's window size, its
buffer, or its loop structure is a unit test of that structure wearing a
threat's name — and it will keep passing for exactly as long as the structure
stays wrong.

**The mechanical tell, because "describe the threat" is hard to act on at
3pm: a fixture for "value A hides value B" must vary the SEPARATOR, since
adjacency is what an implementation keys on.** *(W-47 retro, 2026-08-17 — the
same defect, in an item whose spec quotes doctrine 45.)* F-56 shipped a test
proving a checksum-failing decoy cannot hide a real card on the same line. It
passed. It separated its two values with the **word** "and" — which breaks
digit adjacency, and was chosen because the implementation was a `matchAll`
loop and that is the case a loop fails.

The real threat is a decoy *digit* one space away, and there the shape's
greedy `[ -]?` swallowed both into one match, ran Luhn over the merge, and
failed it for 9 of the 10 possible decoy digits. **The checksum — the thing
that made the shape shippable — had become the bypass**, and the fixture
could not see it because it was derived from the mechanism, not the threat.

So when a fixture asserts "A does not mask B", enumerate what can sit between
them: nothing, a space, a hyphen, a word, a newline. The implementation is
almost always sensitive to exactly one of those, and it is almost never the
one that reads most naturally in a test.

The corollary for design panels, which is where this started: F-44's judge did
the right thing under doctrine 23 and ran eight measurements — but all eight
were chosen to **discriminate between sketches**. None probed the winner on
the axis where the winner was weak. That is doctrine 26's W-67 sharpening,
recurring one iteration later in a session that had read it. Discriminating
evidence and validating evidence are different experiments, and running the
first still feels like having done the second.

## Doctrine 48

**A disjunction is only covered when each disjunct has a fixture where it is
TRUE ALONE.** *(W-38 retro, 2026-08-14 — two independent instances, both
surviving a fully green suite.)* Doctrine 26 says a fixture suite whose cases
all share a shape cannot see a rule conditional on shape, and lists the axes
to vary. This is the specific, mechanical version for the commonest shape a
guard actually takes: `A || B`.

Measured twice in one item:

| Clause | Why the corpus could not see it |
|---|---|
| `decision === "denied" \|\| status === "failed"` | every fixture's driver marked a denied gate `failed` too, so both disjuncts were always true together — **either one was deletable** |
| propagation's `some(refused)` over inbound edges | every propagating node had exactly **one** inbound edge, and over a singleton array `some` and `every` are the same function |

Both survived a suite that was green, and the second was a live gate bypass.
Neither is exotic: the first came from a *test driver* being realistic (a
denied gate really is marked failed in production), and the second from
fixtures being minimal.

The rule generalises past `||`. **Any operator with more than one way to be
satisfied needs a case per way** — `some`/`every` need a multi-element input
or they are indistinguishable, `A && B` needs a case failing each conjunct
alone, and a three-arm `if/else if` needs an input reaching each arm with the
others false. Write the truth table, then ask which row you have a fixture
for. It is usually one row, and it is usually the one where everything is
true at once.

Corollary worth its own line: **when two conditions are always co-present in
reality, that is an argument for a hand-built fixture, not against testing
it.** The denied-and-failed case needed a state the walk driver cannot
produce; refusing to build it by hand is what left the clause untested.

## Doctrine 67

**A mutation row can stop measuring anything because the WORLD changed, not
the code — and rows aimed at live project state are the ones it happens to.**
*(W-52 third rework, 2026-08-19 — 4 of 19 rows inert at once, one of them
reporting SURVIVED.)*

Doctrine 33 covers an anchor that stops matching when you edit the target.
Doctrine 45 covers a fixture whose input no longer reaches the mutated line
because a guard was added above it. Both are about **code** moving. This is a
third cause and nothing in the harness can see it: the code was untouched and
the *subject matter* moved.

F-61's suite pointed four rows at the real patch queue. `G3` empties the
queue glob; `P2`/`P3`/`P4` corrupt real patch headers. The PO then applied and
retired the queue — the item's whole purpose — and:

| Check | Result |
|---|---|
| anchor still matches | yes |
| exactly one site | yes |
| bytes changed | yes |
| mutant parses | yes |
| **row measures anything** | **no** |

`G3` emptied a glob that was already empty. `P2`/`P3`/`P4` corrupted headers
the `applied/` loop does not validate. Two reported `ERROR-unreached` — the
doctrine-45 runtime check working — and **one reported `SURVIVED`**, which
reads as a gate hole and sends you hunting for a defect that does not exist
(doctrine 50's cost, third distinct cause).

The tell is a property of the row, available when you write it: **does this
row's fixture point at a synthetic artifact the harness builds, or at live
project state the project is expected to change?** A row aimed at
`docs/proposed-hooks/*.patch`, at an open issue, at whatever is currently on
`main`, is hostage to a state nobody promised to hold still — and the moment
the project succeeds at changing it, the row goes quiet. Prefer a synthetic
fixture for the *proposition*, and keep the live-state row only when
"the real thing is in this shape" is itself the claim.

The corollary is the cheap version: **when several rows go inert at once,
ask what changed in the world before you look at the code.** All four here
were repointed at a still-queued fixture, preserving the proposition rather
than dropping it.

**And the sibling finding, which is doctrine 62 with a number: a call-site
repair is never done, and the count keeps growing after you believe it.**
"Detect the clause is live first, rebuild a patched copy only as a fallback"
was applied at **three** sites in one rework, a **fourth** in the next (with
§ 12.3 noting the three-of-four miss), and CI then found a **fifth** — a
harness with no live branch at all. Each repair was believed complete by an
author who had just read doctrine 62.

Enumeration is what produced five partial repairs, so stop enumerating:
**after fixing a call-site class, sweep mechanically for the resource and
record the count** — `git grep -ln '<the path/token>'` over the tracked tree,
then account for every hit. One command, and it is the only step in the
sequence that does not consult the author's memory.

## Doctrine 73

**The INPUT SET is a rule, and it is the one layer with no adversary. When
the subject is a git repository, derive it from the OBJECT STORE, not from
the filesystem.** *(W-53 retro, 2026-08-21 — five demonstrated P1 bypasses,
one cause.)*

Doctrine 15's W-16 corollary says a unit test calling the rule directly does
not test the extraction feeding it. This is that corollary at the scale of a
whole gate, and with a specific, repeatable answer.

W-53's content scan built its input with `git archive | tar x` followed by
`find -type f` — the **filesystem's** notion of a file. Four classes of
tracked content fell out of it, each for a different reason and each reading
as clean:

| Lost | Why |
|---|---|
| symlinks | `find -type f` excludes type `l` — and a symlink's entire content IS a path, the exact subject of the rules |
| `export-ignore`d paths | `git archive` honours the gitattribute; the file stays fully tracked |
| binary-classified blobs | the sibling gate's `git grep -I` skips them |
| names containing a space | the list was passed unquoted and word-split |

Measured on a five-entry fixture, that construction saw **three**. Every
rule was correct throughout. A 21-row mutation suite was green throughout,
because a mutation asks *"if I break this line, does something notice"* and
never *"does anything reach this line at all"*.

`git ls-tree` + `cat-file` fixes all four at once, because it stops asking
the filesystem what a file is: no notion of entry type, no gitattribute
filtering, no argv. A symlink's target becomes ordinary scannable text,
which is what it always should have been.

So, before trusting any coverage number, ask the question a mutation cannot:
**what can exist in the subject that never reaches my rules at all?** Then
assert the count — W-53's scan now refuses unless materialised blobs equal
the tree's blob count, which is doctrine 13 pointed at the *construction*
rather than the result.

**Corollary — a query over LOCAL refs is not a query over what EXISTS.**
Same retro. `git rev-list --all` counts remote-tracking refs for branches
already deleted upstream and never pruned, so "commits reachable outside the
default branch" measured **8** where the live answer was **1**. That number
reached a locked spec's premise section — the one titled *re-verification* —
and was copied into a follow-up item before anyone checked. This is doctrine
20's local-vs-CI axis pointed at git refs: the authoritative source is the
forge (`gh api .../branches`), and `--prune` is what stops the divergence
recurring rather than merely correcting the number.

---

