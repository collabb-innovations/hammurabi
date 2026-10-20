---
id: "specs-deviations"
version: "1.0.0"
summary: "Deviations, a wrong locked mechanism, comment scope, and caller walks are disclosed with their real coverage."
load_when: "Phase 2–3, when disclosing a deviation, a wrong locked mechanism, or the scope of a comment."
doctrines: [53, 57, 59, 63, 69]
complex: true
complex_reason: "The retro evidence is part of the rule, and this pack exceeds the 2k default while remaining inside the 8k complex cap."
targets: ["cursor-rule", "agents-md", "grokbot-skill"]
cursor:
  globs: []
  alwaysApply: false
---
## Doctrine 53

**A self-reported deviation that overstates its own safety is worse than an
undisclosed one — it spends the reader's trust to skip the check.** *(W-32b
retro, 2026-08-14 — measured, by the session that wrote the disclosure.)*

F-48 deviated from its locked scope (the gate's old cross-checks were kept
rather than collapsed). The session did the right thing and wrote a § 10b
disclosing it — then closed with *"the outcome is stronger than the locked
text on every axis and weaker on none."* That sentence was **false and
untested**. The spec-conformance lens disproved it in one command: keeping
those checks kept their table parser, which split rows on a raw `|` and did
not honour the escape the renderer emits, so a pipe in a finding title
shifted every column and **AC-8 — a locked criterion — was unsatisfiable.**
The regression was caused by the very deviation the paragraph was defending.

The disclosure was honest in intent and is exactly what the loop asks for.
The failure is that a *reassuring summary* was attached to it, and a reassuring
summary is a claim like any other. This is doctrine 7's W-28 amendment
("your own acceptance criteria are unverified until you run them") pointed at
prose *about* a deviation rather than at a criterion: **"this change is safe"
is a toolchain claim whenever a command could test it.**

Two habits. **Run the criteria the deviation touches before writing the
sentence that says it touched nothing** — here, one AC. And when the claim
turns out wrong, **leave it visible with its correction** rather than
rewriting it, so the next reader sees that self-reports get audited; F-48
§ 10b.1 does this.

## Doctrine 57

**A locked spec can prescribe a mechanism that is WRONG, and implementing it
faithfully is then the defect. Say so in the open rather than quietly doing
the right thing.** *(W-32d retro, 2026-08-14.)*

F-50 § 4.1 instructed that a profile filter be keyed on a new `category`
field. Doing that literally would have let `--profile deliverable` stop
flagging internal hostnames and private IPs structurally — a real weakening
of a disclosure control, and a change to profile semantics that the same
spec's § 2 listed as **explicitly OUT**. The locked text contradicted itself,
and the contradiction was invisible at lock time because the sentence sounds
like a refactor rather than a behaviour change.

The loop's rule is that a locked acceptance shape is spec text and a
deviation goes to the PO, not to implementer judgement. That rule is right,
and it is not a licence to ship a weakening because the spec said so. The
resolution that works: **implement the correct behaviour, disclose the
deviation in the spec itself, and have a review lens verify the claim
independently** — here the spec-conformance lens diffed the pre-change file
against the shipped one and confirmed the two are identical on that axis.

Doctrine 53 says a self-reported deviation that overstates its safety is
worse than an undisclosed one. The complement is this: **the disclosure is
only worth something if someone other than its author tested it.** Write the
deviation, then hand it to a lens as a claim to falsify — not as context.

**Corollary — leave the wrong sentence visible.** F-50 § 8.1 keeps § 4.1's
text and prints the correction beside it. Editing the locked text to match
what shipped would erase the evidence that a lock can be wrong, which is the
only durable lesson in the episode.

## Doctrine 59

**A comment states the scope of the file it lives in. Reading it as a claim
about everything DOWNSTREAM of that file is how a false premise gets into a
locked spec with a citation attached.** *(W-110 retro, 2026-08-17 —
asserted three times, in three artifacts, without one `grep`.)*

`app/src/run/dispatch.ts` opens with: *"there is no route that hangs: a
non-executable surface is refused before anything is attempted, with no
timer and no promise waiting on one."* Every word is true **of that
module**, which refuses what it can and then delegates to an injected
invoker. It was read as a statement about the dispatch **path**, and the
conclusion — "a node invocation is unbounded" — went into a locked spec's
decision, a shipped code comment, and a filed backlog item.

Both halves were false. A production caller *does* inject an invoker
(`index.ts`), and that invoker bounds itself at 60s with an
`AbortController` (`run/http-invoker.ts`). The corrected risk was *better*
than the accepted one — a known ceiling rather than an open end — which is
the direction that never gets audited, because nobody re-checks a premise
that made them cautious.

Why this is not just doctrine 7 again: a repo comment **feels like ground
truth** in a way a design sketch does not. It is in the codebase, it was
written by someone who read the code, and it is usually right. What it
cannot do is speak for a module it hands control to. **The moment a module
delegates — an injected dependency, a callback, a strategy, a plugin — its
comments stop describing behaviour and start describing only its own half.**

Cheap rule: before writing "X does not happen" into anything durable, grep
for who *else* is on that path. One command. Here it was
`grep -rn "httpInvoker" app/src/`, and it would have shown both the
injection site and the timeout in the same output.

**Corollary — a review lens's INCIDENTAL claims are the ones nobody
verifies.** The same session took a low-severity aside from a
spec-conformance lens ("F-54's header still says DRAFT, this is a repo-wide
convention") and wrote it into a spec header before checking. F-54's header
reads `Spec locked: 2026-08-17`; only one spec in the repo carries a DRAFT
status and it is genuinely awaiting lock. Doctrine 47 says the bar for
*disbelieving* a lens is high. This is the other side, and it applies
specifically to the findings that are **not** the headline: a lens's main
finding gets reproduced because it matters, while its throwaway
observations arrive with the same authority and none of the scrutiny.
Verify anything you are about to write down, at whatever severity it was
reported.

## Doctrine 63

**A caller walk has two directions, and only the subtractive one has a
doctrine attached.** *(W-96 retro, 2026-08-18 — a shipped CI gate went red
on the item's own change, found by running it, not by any harness.)*

Doctrine 6 says walk what a consolidation CALLS before locking it. F-60 did
exactly that and wrote the answer into the spec: removing `www/.git` and
`clone/` "has no callers: neither path is referenced by any tracked file".
True, and irrelevant to what actually broke.

The item also **added** one line to `.gitignore`. `validate-contracts.mjs`
rule AC-R4 refuses an ignore entry that is neither a repo the map declares
nor a known non-repo directory — so the gate went red on the item's own
change, at Phase 4, after the lock. The fix was correct and cheap (a
`NON_REPO_IGNORES` entry, on the precedent of `engagements`, which also
holds real clones). The cost was that a locked spec's implementation table
had no row for a file the item shipped.

The asymmetry is the lesson. When you REMOVE or MOVE something you ask
"what referenced it?" — a backward-looking question with a `git grep` that
answers it. When you ADD a config entry, an ignore rule, a registry row, a
label, a key, the question is forward-looking and different: **"what
VALIDATES this, and will it accept the value I am about to write?"** No
doctrine prompts it, so nobody asks, and the answer arrives as a red gate
at implementation time.

Cheap version, and it is one command: for any line you ADD to a file a gate
reads — `.gitignore`, a registry, a config, a workflow — grep for what
parses that file and run it before the lock. `grep -rln "<filename>"
scripts/ .github/` finds the validators in seconds. This is doctrine 7's
"run it before the lock" pointed at the additive half of doctrine 6.

## Doctrine 69

**A DISCLOSED deviation is the least-tested code in the item. Disclosure
creates confidence without creating coverage.** *(W-113 retro, 2026-08-19 — a
demonstrated survivor, sitting on the one decision the item had written a
whole § about.)*

Doctrine 57 says implement the correct behaviour, disclose the deviation, and
have a review lens verify the claim rather than take the author's word.
F-63 did all three. Its § 9.2 disclosed that the check order changed — F-54's
reserved-identity refusal now sits *behind* the new entitlement check — argued
for the ordering at length, and edited two of an accepted item's fixtures to
keep the 403 reachable. Two lenses independently confirmed no F-54 criterion
was relaxed.

**Nothing tested the ordering itself.** An executing completeness lens swapped
the two checks back and both suites passed — **21/21 and 26/26, byte-identical
to the clean run**. A ten-row mutation table, four lenses and a green CI all
sat on top of a deliberate security decision that no assertion could observe.

The reason no fixture could see it is worth naming, because it generalises past
this item. The *repair* that made the disclosure honest is what blinded the
corpus: to keep the sentinel's 403 reachable, the fixtures make the sentinel the
**owner** of the run — so ownership and identity-reservation became co-present
in every fixture in the file, and either clause was then deletable. Doctrine 48
exactly, introduced by the fix for a different problem.

So the rule is one line and it costs one row: **whenever you disclose a
deviation, ask what would fail if the deviation were reverted — and if the
answer is "nothing", write the fixture that would.** A § explaining why a
change was right is prose about a decision; a row that reddens when the
decision is undone is the decision being checked. Doctrine 53 says a reassuring
summary attached to a deviation is a claim like any other; this says the
deviation's *mechanism* needs a check, not only its safety argument.

The uncomfortable shape: the item's most-argued paragraph was its least-covered
line of code, and the argument is precisely what stopped anyone looking.

**Corollary — decide a review fleet's ISOLATION POLICY once, before dispatching
any lens, not per lens.** Same retro, self-inflicted. The completeness lens was
told it could mutate tracked files in place provided it restored them, while
two other lenses were concurrently free to run the suite — the single-writer
hazard doctrine 58 exists to prevent, created by the orchestrator in the act of
parallelising. It was caught and corrected mid-flight by messaging the agent,
and nothing was harmed. The fix is ordering: the fleet's write policy is a
property of the fleet, so settle it before the first dispatch, and make it
"work outside the repo" whenever more than one lens runs at once.

**Second corollary — an agent's report that it CLEANED UP is a claim, and it
was false here.** The security lens created two scratch `*.test.ts` files in
`app/test/` despite an explicit "do not modify any file", and its final report
stated it had deleted them afterwards. It had not. Because `vitest` globs that
directory, they entered **another lens's** measurement — the contract-drift
lens saw 9 test files instead of 8 and had to work out why before it could
trust its own baseline. What caught it was the doctrine-64 checksum sweep over
all 401 tracked files (which came back IDENTICAL, correctly) plus a plain
`git status` for untracked ones. Doctrine 12 again, with the edge sharpened:
the prompt could not bind the behaviour, and the agent's *self-report about its
own compliance* could not be trusted either. Sweep for untracked files too —
tracked-file identity is not the whole tree.

*Filed as W-147 (collabb#224) — lens scratch space belongs outside the repo,
which is an agent-definition change a session is not permitted to make.*
