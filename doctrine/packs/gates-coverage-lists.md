---
id: "gates-coverage-lists"
version: "1.0.0"
summary: "Coverage lists are derived per clause from the artifact, never from memory or a check run by hand."
load_when: "Phase 3–4, when a coverage list is derived from a checker or a parser."
doctrines: [49, 52, 61, 70, 71, 72]
complex: true
complex_reason: "This is one part of a locked gates sub-topic (oracles or coverage). The coarser pack exceeded 8k tokens, so the sub-topic is split further. The retro evidence is why the part still exceeds the 2k default."
targets: ["cursor-rule", "agents-md", "grokbot-skill"]
cursor:
  globs: []
  alwaysApply: false
---
## Doctrine 49

**The list you write to catch "a clause with no mutation row" is written
from the same memory that wrote the rows, so it lists exactly the clauses
that already have rows.** *(W-39 retro, 2026-08-14 — three clauses invisible
to a coverage sweep whose entire purpose is finding invisible clauses.)*
Doctrine 26's F-45 amendment promoted a good mechanism: assert coverage
against the **code sites**, not the row labels, so renaming a row cannot fake
coverage and a new rule with no row fails loudly. F-46 shipped that
mechanism. It still had three uncovered clauses.

The mechanism works exactly as designed and cannot work: `REQUIRED_SITES` is
a hand-written array. Its author enumerates the clauses they are thinking
about — which is the set they just wrote rows for. F-46's list named nine
sites and omitted the `.trim()`/type guard, the log-dedup guard, and the
defect accumulator. An adversarial lens deleted each of those three from the
source and got **a full green mutation score AND no coverage complaint**.
That second half is the serious one: a missing row is meant to be loud, and
here the loudness mechanism was itself missing the same three entries.

This is doctrine 14 one level up. Doctrine 14 says a harness inherits the
gate's blind spots; this says the **meta-check built to find the harness's
omissions inherits them too**, because it is the same author, the same
sitting, the same mental model. Adding more entries by hand does not fix it —
the next clause will be omitted by the same process.

Two fixes, in order of preference. **Derive the list mechanically** where the
shape permits: count the branch points in the function under test and require
a row per branch, so a new `if` raises the required count without anyone
remembering. Where that is impractical, **make deletion the test**: have
something delete each clause in turn and assert the harness complains — which
is what actually found this, and is the only method that does not consult the
author's memory. Cheapest version: before trusting a coverage list, delete a
clause you did NOT write a row for and check that anything at all objects.

**Sharpening — the entry a coverage list omits is systematically the HELPER
that several clauses share, because a list is written by walking clauses and
a helper is not a clause.** *(W-40 retro, 2026-08-14 — measured, in a session
that had read doctrine 49 and built the mechanism it recommends.)* F-47
shipped a `REQUIRED_SITES` list asserted against code sites, exactly as above.
It named **every clause** — the extraction state machine, the non-empty guard,
the partition, the presence check, the value comparison, the count guard, the
forbidden-value rule, the key list itself. Eight entries, no clause missed.

It omitted `f47_val`, the one function through which **both** value-bearing
clauses route every comparison. An executing review lens neutered it and
demonstrated the result: the gate reported **`102 passed, 0 failed`** against
an upstream literally containing the regression the whole item exists to
catch, because the extractor returned empty for every key so the comparison
compared empty to empty ten times and the forbidden-value rule saw a blank.
A sixteen-row table scoring 16/16 said nothing about it.

The omission is not carelessness, it is the method: you enumerate clauses
because clauses are what you wrote rows for, and a shared helper is
*infrastructure* rather than a rule, so it never appears on the walk. This is
doctrine 15's W-16 corollary approached from the other side — that one says a
test entering through the rule does not test the extraction feeding it; this
says a *coverage list* built from rules will not list that extraction either,
so neither the rows nor the meta-check notice.

**So: after listing every clause, ask what code ALL of them call, and list
that too.** The tell is a function used by two or more entries already on the
list. It is also the highest-value single mutation in the table, because
everything downstream of it fails silently and in the reassuring direction.

*Third measured instance, in a different language and shape — the rule is
not about extraction functions specifically.* **(W-32c retro, 2026-08-14.)**
F-49's Tier-2 auditor has three findings (unmapped repo, unignored repo,
stale nested clone) and all three route through one shell helper that
classifies a directory against the map. The harness had a row per finding —
each neutering that finding's own output line — and **none** for the
classifier. An executing lens replaced its body with a constant: all three
findings vanished and the tool printed `clean` and exited 0, against a suite
reporting **15 caught / 0 survived**. Per-branch rows prove each output line
is load-bearing *given a working classifier*, which is precisely the
assumption the classifier's own mutation would test. The tell is unchanged
and mechanical — **a function called by two or more rows that has no row of
its own** — so it is worth running as a literal check over the table rather
than a habit of mind.

## Doctrine 52

**Consolidating a derivation into one shared implementation can DELETE a
check, and the check keeps passing.** *(W-32b retro, 2026-08-14 — two
demonstrated survivors against a fully green suite, in the item that created
them.)* This repo argues for shared implementations constantly and is right
to: `registry/discovery-table.mjs` is one parser for a gate and a resolver
precisely so the two cannot disagree. F-48 did the same thing, moving
`scoreOf`/`quadrantOf` into a module the renderer and the gate both import.

It was correct, and it silently removed a control. **Before** that change the
Score and Quadrant columns were typed by a human and the gate's X3 compared
them against the gate's own computation — *two independent sources*. **After**,
the renderer emits those columns *from* `scoreOf` and X3 compares them
*against* `scoreOf`. That is `f(x) === f(x)`, which is true for every `f`.
An executing lens replaced `scoreOf`'s body with `() => 1`, re-rendered, and
the gate printed `OK` with every finding's score wrong; collapsing
`quadrantOf` relabelled a finding from *Watch* to *Quick win* in the
customer-facing quadrant chart, also green.

**No mutation score could have found this.** Doctrine 30 asks which lines the
oracle reaches and doctrine 15 asks whether both producer and checker were
mutated — this suite did both, at 11/11. The defect is that mutating *either*
side moves *both*, so the comparison agrees on the wrong answer. The
instrument and the subject became the same object.

**So: when a refactor makes one function the source for two things that used
to be compared, ask what that comparison was FOR.** If both of a check's
inputs now come from the same code, the check is decoration. The fix is an
oracle that is not the shared module — F-48's is a 16-row truth table
transcribed by hand from the spec, the only place in the gate where the
expected values are literals. Cheapest version: for every equality assertion,
name the two sources out loud and confirm they are actually two.

## Doctrine 61

**A COVERAGE LIST paired with a check that only compares it to another list
by the same author is not a control — it is doctrine 49 wearing a passing
self-test. Derive the list from the artifact.** *(W-50 retro, 2026-08-18 —
8 of 14 clauses invisible, behind a green meta-check.)*

Doctrine 49 says a hand-written `REQUIRED_SITES` lists exactly the clauses
its author was already thinking about, and recommends deriving it
mechanically or making deletion the test. F-58 read that, quoted it in the
spec, and shipped the defect anyway — because it added a *meta-check* that
felt like the fix: `anchor_report` asserted **`rows == required_sites`**.

That check can never fail for the reason it exists. Both lists are written in
the same sitting by the same process — walk the clauses you are writing rows
for — so they agree **by construction**. It reported clean while the gate had
**14 refusal clauses and only 6 of them were named anywhere**. An executing
review lens neutered three of the missing eight and demonstrated each: a `gh`
failure at the head-SHA lookup was silently reclassified as "the workflow
legitimately never ran", i.e. the exact conflation the gate was written to
eliminate, reintroduced inside the gate, invisible to a 15/15 suite.

The tell is precise and worth grepping for: **a completeness check whose two
operands are both authored artifacts.** `len(rows) == len(sites)`,
`keys(expected) == keys(actual)` where you wrote both, a fixture count
matching a case count. None of them touch the thing under test, so none can
discover anything.

The fix is one line of extraction and it is not "add more entries" — the next
clause is omitted by the same process that omitted these. **Derive the list
from the SOURCE**: F-58 now extracts every `refuse "<message>"` out of the
gate and requires some row's `expect` to assert it, so a refusal clause added
later with no row fails loudly with nobody remembering a list. Genuinely
unreachable entries go in an `UNREACHABLE_REFUSALS` set **with a written
reason**, so "no fixture reaches this" is argued rather than assumed —
otherwise nothing distinguishes defensive depth from dead code. And
positive-control the derivation itself: delete a row and confirm it reports
`UNCOVERED` (doctrine 13 — the extractor is a scan, and a scan that resolves
nothing must not read as clean).

The uncomfortable half, and it is the third consecutive iteration to record
it: **reading a doctrine immediately before doing the work does not prevent
the doctrine's failure, and building a mechanism against it can actively
conceal it.** The 15/15 score was never the problem. The *authority* of the
score was, and the meta-check is what manufactured it.

## Doctrine 70

**A parser's contract must cover the CONTAINER's structural rules, not only
the fields it declares. Every guard checked a value; none checked a file that
declared that value TWICE.** *(W-58 retro, 2026-08-19 — a total gate bypass,
invisible to 12/12 mutations and 23 unit tests.)*

F-64 ships a dependency-free PNG decoder. Its header promises, in writing, to
"refuse anything it cannot decode faithfully rather than degrade", because a
decoder that guessed would emit "a confident verdict about nothing". It
checked `bitDepth`, `colorType`, `interlace`, the signature, the inflated
length, and a dimension ceiling — **every field a well-formed file declares.**

PNG requires IHDR exactly once, as the first chunk. The chunk walk assigned
header fields on *every* IHDR, so the **last one won**. A file carrying a
second IHDR sized to the head of the IDAT stream presents one canvas to every
spec-compliant crawler and a tiny cherry-picked one to the gate. Measured:

```
declared IHDR#1 = 100x100; decodePng() actually used = 4x4
og-image-lint OK — OG palette matches DESIGN.md ... 100.0000% of 16 px
```

**OK over a file it had never really read.** Not wrong pixels — a complete
bypass of the only control the item exists to provide.

Why nothing caught it is the useful part. Doctrine 26 lists the axes a corpus
must vary — position, accumulated state, interaction, output detail, and
W-44's type and size. Every one of those is a property of **a rule's inputs**.
"How many times does the container repeat this section" is not on the list,
and cannot be, because it is a property of the **format**, not the value. The
fixtures varied filter type, header *values* and truncation depth; chunk
*count* was outside the space anyone was sampling.

So: **whenever code reads a field out of a self-describing format — PNG
chunks, YAML keys, JSON objects, HTTP headers, multipart parts, TLV records,
zip entries — ask what happens if the format declares that field twice.** The
answers that matter are last-wins (this defect), first-wins, and silent merge.
Then ask the same about ordering, about trailing data after the terminator,
and about a section appearing where the spec forbids it. A parser that
validates parameters and not structure has an untested axis, and it is
precisely the axis an attacker chooses because it leaves every declared field
looking legitimate.

Cheap version, and it is one line per rule: for each structural constraint the
format's own spec states as "exactly once", "first", or "last", write the
refusal. The spec already did the enumeration; nobody had read it as a
checklist.

**Corollary — when an oracle cannot OBSERVE a thing, the fix is a new ORACLE,
not another row.** Doctrine 30's W-42 note says the observable a harness
forgets is almost always the output a human reads, and concludes that it
"needs a row". W-58 measured the case where a row cannot help.

`pct()` formats every percentage in the success banner and every refusal;
`describe()` names which token role an offending colour collides with. **Both
gate on nothing** — every comparison uses the raw numeric fraction — so a
review lens replaced `pct()`'s body with a constant and got

```
og-image-lint OK — ... WRONG-VALUE-999% of 756000 px
```

at exit 0, with 12/12 mutations and the entire unit suite unchanged. No row
scored on an **exit code** (the CLI oracle) or on a **thrown message** (the
fixture-driver oracle) can ever see a formatter, because a formatter changes
neither. Adding rows to those two oracles buys exactly zero.

The fix was a **third oracle** — rows scored on `node --test` — plus
assertions on the banner's actual numbers. The generalisable step is the
question, asked before adding rows: *"is this invisible because I have no row,
or because no oracle I own can observe it?"* If the second, more rows is the
wrong instrument, and the harness needs a new kind of verdict rather than more
of the ones it has.

This bites hardest exactly where it did here: the numbers an acceptance
criterion tells a human to eyeball. F-64's AC-0 and AC-1 both instruct the PO
to compare printed figures against a table — and until the third oracle existed,
those figures were the least-checked output in the item.

## Doctrine 71

**A derived coverage list is only as honest as its GRANULARITY. Derive per
CLAUSE, because the source is written per clause and a CODE is a category.**
*(W-80 retro, 2026-08-19 — the mechanism built against doctrine 49 laundering
doctrine 49's omission, found by a lens after the mechanism reported OK.)*

Doctrine 61 says a coverage list checked only against another list by the same
author agrees by construction, and prescribes deriving it from the source.
F-65 did exactly that: it extracted every rule code the gates can emit and
required a fixture to assert each one. It reported
`OK — all N derived rule code(s) are asserted`.

The gate has **four** `die(1, "SBC-EMPTY: …")` sites — zero results, zero
criteria, zero judges, no fixtureId strings. The extractor collapsed them into
one string, `SBC-EMPTY`, so covering the results branch marked the other three
covered. Measured after the repair: **6 codes had unreached clauses**, among
them 6 `SBC-SHAPE` sites with 1 assertion and 3 `SBC-USAGE` sites with 1.

The derivation was real, mechanical, and from the source. It was still a
fiction, because a **code is a category and a clause is a claim** — the same
distinction doctrine 55 draws for mutation *verdicts*, arriving one layer out
at coverage. Deriving the right thing at the wrong resolution is
indistinguishable from deriving it correctly, and it reads as rigour.

Two habits. **Count SITES, not distinct codes** — extract each `die()`/`raise`/
`refuse` separately and require a fixture assertion per site, keyed on a
fragment only that site's message contains. And where a site genuinely cannot
be reached, **declare it by COUNT with a written reason** (`SBC-SHAPE 1`, "the
JSON.parse branch the container walker refuses ahead of"), never by exempting
the whole code — a code with four sites can have three reachable ones, and
waiving all four to excuse one is how the list starts lying again.

The tell is cheap and worth grepping for: **any coverage check whose unit is a
name rather than a location.** If two different guards can produce the same
key, the check cannot see the second one.

**Corollary — doctrine 69 settles the FLEET's write policy. Nothing settles
the ORCHESTRATOR's, and that is the one that bit.** *(Same retro,
self-inflicted, correctly reported by the agent it affected.)* The fleet's
isolation policy was decided once before the first dispatch, every lens was
read-only, and the post-fleet sweep found no lens-created file. Then, while
the completeness lens was still running, the orchestrator **edited two of the
three programs under review** — applying the security lens's confirmed fixes.

The lens noticed the file change mid-review, flagged it as a doctrine-58
concurrency signal, and reported findings against a revision that no longer
existed. Nothing was harmed (it worked on copies, and every finding was
re-verified against the final code), but the cost was real: an entire lens's
output had to be re-attributed by hand, and a finding it *would* have found in
the new code could not have appeared.

Doctrine 58 forbids editing a harness's targets while the harness runs. The
same reasoning covers a review fleet and nobody had written it down: **a lens
is reading a snapshot, so the diff must hold still until the fleet reports.**
Apply confirmed fixes in a batch after the last lens returns — the fixes are
not more urgent than the review, and a review of code that no longer exists is
worth less than the round trip saved.

**Corollary — `grep -i` defeats doctrine 20's W-48 amendment, and it is the
natural reflex.** That amendment says: after running a criterion, grep your
expected literal against the captured output and require a hit. F-65's
acceptance sweep did that for all nineteen criteria and reported them green.
A lens then showed AC-3's expected literal — `rubric`, lowercase — appears
**zero** times in the program's output for that case; only the all-caps rule
code `SBC-RUBRIC` did. The sweep had used `grep -qi`.

Case-insensitivity is the reflex because you are checking your own work and
"close enough" feels like the point. It is not: the criterion is a *literal*,
and a rule code is not the word. **Grep the expected literal exactly as
written, case-sensitively** — and when it misses, ask doctrine 21's question
before weakening the check. Here the right repair was the **program**: an
operator told their rubric is incomparable should read the word "rubric", so
the message gained it and the criterion stayed as locked.

**Corollary — doctrine 38's failure mode is not "no precedent exists", it is
"the precedent exists, is written down WITH ITS REASON, and you wrote a
weaker mechanism anyway".** Two instances in one function in one session,
both shipped, both found by review:
* `registry/skill-paths.mjs` parses frontmatter **top-level scalars only** and
  says why in a comment — "a leading space would make it a nested key, and
  matching those would let some other block answer for the document's own
  name." The new provenance check matched `^[ \t]*source:`, so a `source:`
  indented under an unrelated key satisfied the rule that exists to require
  provenance.
* `scripts/engagement-contract.schema.json` declares itself "the single source"
  for the engagement-slug grammar. The new check hardcoded a *different*
  regex — `SKILL_NAME_RE`, the grammar for a skill NAME — and its own comment
  attributed it to a doc that defines no slug grammar at all. The schema
  accepts `a--b`; the copy refused it, so a legitimately-issued slug would
  have had every promotion refused with a message reading "you forgot the
  field".
Both were written while reading the neighbouring rule, which is exactly how
it happens: you copy the shape of the code beside you and re-derive the
predicate. **Before writing a predicate over a value some other file owns,
grep for who validates that value today and READ it rather than re-deriving
it — and prefer reading the authority at runtime to restating it**, which is
what makes drift impossible rather than merely detectable.

## Doctrine 72

**A check you ran BY HAND is not coverage, and it is the one you are most
certain is covered.** *(W-53 retro, 2026-08-21 — a harness reporting 21/21
had never executed one of the three programs its own header named.)*

Doctrine 9's F-15 amendment says every survivor becomes a permanent
mutation. W-53 did the finding half and skipped the pinning half, and the
gap is instructive because nothing about it feels like an omission at the
time. Seven allowlist mutations and two planted leaks were run by hand
during implementation, against `knack-egress-scan.sh`. Every one behaved
correctly. None became a row. **Three independent review lenses then found
that the program was never executed by the suite at all** — neutering its
main refusal clause produced a clean exit 0 over a real planted leak with
the score unmoved.

Two things make this worse than an ordinary coverage hole. Running a check
by hand produces the same *feeling* as a passing row and none of the
durability, so the author's confidence is highest exactly where the record
is thinnest. And the score **launders** it: `21/21` reads as "this item is
covered" when it only ever meant "the rows I wrote pass", and the rows you
write are the ones for the clauses you were already thinking about
(doctrine 49, one level out).

The tell is mechanical and worth grepping your own session for: **any
command you ran against the thing under test that does not appear in the
harness.** At the end of implementation, walk them and require each to be a
row or to be declared unreachable *with a reason* (doctrine 61). "I checked
that manually and it worked" is a statement about yesterday.

