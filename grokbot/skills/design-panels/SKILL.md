---
name: "design-panels"
description: "Design-sketch convergence and design evidence are fixtures, and an unrepresentative fixture cannot fail. Load when: Phase 2, when running or judging a design-sketch panel."
---
<!-- collabb-doctrine-pack: id=design-panels version=1.0.0 sha256=28d93d35066dab11392f93688762d2fc8be60fc76a7b6c8a9ed70fc480cefb9c doctrines=23,24 -->
## Doctrine 23

**When every independent sketch carries the same artifact they all flagged
as uncertain, that artifact is the design problem — not a cost to accept.**
*(W-16 retro, 2026-08-09.)* F-30's design panel ran three sketches from
genuinely distinct priors (minimal-diff, contract-first, built-output). All
three needed a hand-transcribed **148-entry CSS named-colour list**, and all
three volunteered, unprompted, that it was the one thing in their design
they could not verify against anything on disk. Convergence across distinct
priors *reads* as confirmation — three independent designers agreed, so it
must be necessary. It was not necessary at all: at a site already known to
hold a colour, a bare identifier that is not an allowed keyword is illegal
**whether or not it names a real colour**, so `red`, `tomato` and `nonsense`
fail through one path and the list disappears. With it went the entire
false-positive risk against marketing prose, which two sketches had
separately built machinery to manage.

The tell is specific, and worth looking for by name at judging time:
**unanimity plus self-declared uncertainty**. Sketches converge on a shared
assumption because they share a framing, not because they checked; and the
hedge is each sketch telling you where its framing hurt. Ordinary
unanimity is weak evidence of correctness. Unanimity on something everyone
flagged is a pointer at the premise nobody questioned. Ask what the item
would look like if that artifact were simply not allowed to exist.

Doctrine 7 says the panel is a source to verify, never a source to quote.
This is the other half: **verify what the panel agreed on, hardest of all.**
*(Candidate for promotion to `prod-loop` — it is about design panels in
general, not this repo.)*

**Sharpening — when the panel converges on a mechanism the ITEM BODY already
named, that is not convergence at all. It is your own prompt coming back.**
*(W-119 retro, 2026-08-18 — three sketches, one wrong mechanism, zero
independent derivations.)*

Doctrine 23 says sketches converge because they share a framing. W-119 found
where that framing usually comes from: **the orchestrator hands it to them.**

W-119's item body prescribed the fix in its Scope section — *"exclude the
target from the strip set, and skip the edit entirely when nothing needs
stripping."* That sentence went into all three sketch prompts as context, and
**all three reproduced it.** It is wrong: an already-corrupt item has an
*empty* strip set, so the write is skipped, the label is never added, and the
item is stranded permanently — the exact corruption the item existed to end,
re-created by its own fix. The correct rule needs **two** independent
questions (anything to strip? target absent?), and no sketch found the second.

Three sketches agreeing looked like strong evidence. It was one assertion,
quoted three times, wearing three different priors as costume. The tell is
available for free: **diff the panel's shared mechanism against the words in
the prompt.** If it is a paraphrase, you have measured nothing.

Two habits. **Strip the item's prescribed mechanism from the sketch prompt**
— give the panel the *defect and its reproduction*, not the proposed fix; a
body that says "the fix is X" makes X unfalsifiable for every downstream
reader. And where the mechanism must be included (it is often load-bearing
context), **name it as a candidate to attack** and require each sketch to say
explicitly whether it derived the same answer independently or adopted it.

This is doctrine 8's mirror at the design stage: doctrine 8 says a deferral in
an accepted spec is a promise the ledger has to keep, and this says **a
mechanism named in an item body is a hypothesis the panel has to test**, not a
requirement it inherits. An item body is written before the work; it is the
least-verified prose in the entire loop, and it is the text the panel trusts
most.

## Doctrine 24

**Design evidence is a fixture too, and an unrepresentative one cannot fail.**
*(W-18 retro, 2026-08-09.)* Doctrine 16 says a harness's setup code decides
what the tests are allowed to see. The same is true one stage earlier, of the
evidence a PO *locks a decision on*.

F-31 chose its history-import mechanism by measuring both candidates in
throwaway repositories. The measurement was real, the commands were run, the
output was quoted accurately — and the recommendation was wrong, because the
throwaway destination contained **no filenames colliding with the source**.
The real destination had six. Applied for real, `git subtree add` lost blame
entirely on all six (`DESIGN.md`, `CLAUDE.md`, `README.md`, ...), because git
blame's rename detection matches `www/<name>` against the destination's own
`<name>` in the first parent. The fixture could not reproduce the defect, so
the experiment could never have failed, so its green meant nothing.

A second error rode along: the rejected alternative was described as needing
`git-filter-repo`, "a new toolchain dependency". The probe checked for the
wrong binary — `git filter-branch` is built in and does the job. So the
losing option was penalised for a cost that did not exist, on top of the
winning option being credited with a property it did not have.

**Before locking a decision on a measured comparison, ask what property of
the REAL target the fixture does not reproduce** — scale, name collisions,
existing content, permissions, history depth — and either reproduce it or
say plainly that the measurement does not cover it. Cheapest version: run
the candidate against the actual target once, in a throwaway worktree, and
check it with the gate you are about to ship.

What saved this item was that the gate existed **before** the implementation
(loop Phase 3, eval-first): the blame gate was written and made RED, then the
locked mechanism was applied, and the gate went red for real. Had the gate
been written afterwards, it would have been written to describe whatever the
import produced — and would have passed. *(Candidate for promotion to
`prod-loop`: it is an argument for eval-first, not a fact about this repo.)*
