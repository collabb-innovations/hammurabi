---
name: "change-strategy"
description: "Delete first, migrate callers, and leave each unit in a state you can check. Load when: Load when refactoring, migrating, debugging, or sequencing a multi-step change."
---
<!-- collabb-doctrine-pack: id=change-strategy version=1.0.0 sha256=c3b6648f892d31b208600ddeb829357b6f49b34b6046dec2e4b01f1770c3b6b0 doctrines=83,84,85,86,87,88,89 -->
# Change strategy

Seven rules for how a change lands. They assume the shape rules (78 through 82) and do not restate them.

## Doctrine 83

Laziness protocol

Bias toward deletion and the smallest change that solves the problem.

- Consolidate a decision. Do not repeat the same choice in several places. Put it behind one source of truth and pass the result as a simple flag.
- Minimize the diff. Fewer lines beat elegant boilerplate.

## Doctrine 84

Subtract before you add

When evolving a system, remove complexity first, then build. Default to subtraction. Leave the design slightly simpler, and at least as capable, behind the same or a smaller surface.

- Sequence removal before construction.
- Cut before you polish. Reach the minimum before investing in finish.
- Design for observed usage, not speculative edge cases.
- Do not add a validator, parser, or guard the spec does not demand.
- When a reference has no novel content, delete it. Do not leave a stub.

## Doctrine 85

Migrate callers, then delete the legacy API

When a new internal API replaces an old one, migrate the callers and delete the old API in the same wave. Update tests to the new contract. Delete tests that only protect pre-refactor implementation details.

This applies when no external user depends on the old contract, the project can absorb a coordinated break, and the new API is part of a simplification. If an external contract still depends on the old API, this rule does not authorize deleting it.

Do not leave a compatibility layer that exists only so both APIs stay callable. Two ways to do one task is how the old way grows new callers.

## Doctrine 86

Outcome-oriented execution

Optimize for the intended end state, not for a smooth intermediate state.

Keeping every intermediate step fully supported creates temporary compatibility code that becomes debt. Converge on the target and prove correctness at explicit verification boundaries.

- End-state integrity outranks transitional stability.
- Breakage inside a planned unit is acceptable when it is scoped and reversible.
- Use this for planned rewrites and migrations with explicit phase boundaries.
- Say where temporary breakage is acceptable.
- Keep high-signal checks on the code you are touching while migrating.
- Require the full check at the end of the plan.

This does not mean the next unit starts on a red check. Rule 87 names the boundary. Inside the unit, do not spend a compatibility shim just to keep the half-migrated state looking supported.

## Doctrine 87

Sequence verifiable units

Order work as small units. Each unit ends in a state you can check. Do not start the next unit until the current check is green.

A break caught at the unit that caused it is cheap to localize. A break caught after a batch is buried, and later work sits on a broken base.

In a sweep, a migration, or a run of similar edits, check each change before the next. The bracket is a known-good state, one change, the check, then proceed. Rebase onto clean trunk first so the check measures against the real baseline. Run the check the plan names. Do not substitute a proxy, a file timestamp, or a self-report for that check. The gates that define a real check stay in force. This rule only orders the units.

Stack commits and reviews in the order that proves the work. A failing test, then the fix. A subtraction, then the reshape. A baseline, then the treatment. The scaffold, then the feature. Each commit stands on its own, and the sequence reads as an argument.

## Doctrine 88

Make operations idempotent

Design an operation so it converges to the correct state no matter how many times it runs or where the previous run stopped. Every state-mutating command, lifecycle step, and processing loop should answer two questions. What happens if this runs twice? What happens if the previous run crashed halfway?

Derive each step from the state that exists, not from what the previous run meant to do. Read the current state, compare it to the goal, and apply only the difference. A repeat then finds nothing left to do.

Anything a run leaves behind (a lock, a temporary file, a half-written record, a claimed job) must be recognizable as stale by the next run. Judge staleness by evidence that stays true wherever the previous run could have stopped. A marker the next run cannot judge turns every crash into manual cleanup. Write to a temporary path and rename it into place, or compare artifacts by content instead of creation order.

If any answer is "it depends on what state was left behind", the operation needs a reconciliation step.

## Doctrine 89

Fix root causes

Fix the fault, not the place where it surfaced. The symptom is where a wrong state became visible. The root cause is the first place the system did something it should not do, or failed to handle a state it should handle.

A symptom fix hides the evidence and leaves the fault free to surface somewhere else. The code then carries a workaround for a bug nobody named.

- Reproduce first.
- Ask why at each step until the answer is a wrong decision in the code, not a consequence of an earlier one.
- When stuck, instrument. Read the actual error and the actual state. Do not guess.
- Ask whether the state that triggered the symptom is legitimate. If the system may be in that state, handling it there is the fix. If the state should never exist, a check where it broke hides the bug. Find what produced the state. Guards, retries, swallowed errors, clamped values, and discarded state are the usual hiding places.
- When something fails only after a restart, suspect persisted state first. Config, caches, lock files, serialized state.
- Check for the pattern, not only the instance. Find every place with the same fault and fix them.
- If a workaround needs a paragraph to justify it, the code is wrong. Fix the code.
- If the deciding fact took a deep dig, propose the cheap signal that would have shown it at first look.
