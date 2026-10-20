---
id: "review-and-correct"
version: "1.0.0"
summary: "Review adversarially, then make repeated mistakes and leftover comments impossible."
load_when: "Load when challenging a diff, when the same mistake has happened twice, or when comments are standing in for structure."
doctrines: [95, 96, 97]
complex: true
complex_reason: "The verdict procedure, the review rubric, and the correct and comment ladders are one decision and do not split cleanly."
targets: ["cursor-rule", "agents-md", "grokbot-skill"]
cursor:
  globs: []
  alwaysApply: false
---
# Review and correct

Three rules. Review does not edit. Correction makes the next mistake fail the build. Comments are the last encoding, not the first.

An unlocked product choice stays an open question. State intent from the spec, the commits, and the diff. Do not invent a product decision the spec does not lock, and do not stop the review of the diff to ask permission to read it. Irreversible actions still wait for confirmation.

## Doctrine 95

Interrogate

Adversarial review by independent reviewers. The signal is independence, not a persona and not a vendor. The deliverable is a synthesized verdict. Do not auto-apply changes.

### Scope

Review what the caller pointed at. A named file or diff, otherwise the branch diff against the base, otherwise the files the request names. Package the diff with the surrounding context a reviewer needs.

### Intent

Before reviewers start, state the intent in one paragraph from the request, the commits, the review description, and the code. If a product choice is not locked, mark it open in that paragraph.

### Fan-out

Obey subagents-and-fleets. Launch the reviewer panel in one wave. Panel size and membership come from the fleet configuration, not from a hardcoded roster. Do not name a model vendor or a model slug.

Each reviewer is read-only, gets the same brief, and does not edit the tree. The brief is the intent, the diff, the rubric below, and the code-quality lens below. Reviewers do not see each other's notes. The parent owns the verdict and writes it. Do not pass a reviewer's words through as the answer. A rerun is a fresh reviewer with the rejection named, not a resume of the reviewer that failed.

### Synthesize

Merge findings that describe the same issue, and note which reviewers raised each one. Findings two or more reviewers raised independently are the highest signal. Read a lone finding, and weight it lower. If one reviewer flags something and another says the opposite, that disagreement is context for the verdict.

### Lead judgment

You are the lead, a pragmatic senior engineer, not a neutral aggregator. Put every finding in one bucket, with the reviewers who raised it and a one-line rationale.

- Act on. Real issues affecting correctness, security, or maintainability given the actual goals. They would block a real review.
- Consider. Legitimate, but you are not sure they outweigh the cost of addressing them now.
- Noted. Technically valid and not actionable. Context-dependent, premature, or low-impact at this stage.
- Dismissed. Wrong, nitpicky, or missing context, with a brief reason.

Nitpick gravity. Reviewers fill the review. If they find nothing critical, they inflate nits. If every finding is a nit or a style preference, say the code is probably fine.

Hypothetical versus actual. "What if someone passes null?" is a finding only if a caller can pass null. Trace the call. If the boundary or the type prevents it, dismiss it.

Premature abstraction. A suggestion to extract, add an interface, or invent an abstraction needs a second way the code must change. If there is no second way, the abstraction is premature. Simple inline code that works beats a clean abstraction the scope does not need.

Preference is not a defect. "I would have done it differently" is not a bug unless the reviewer shows a concrete problem with the current approach. Dismiss it, and say why.

Missing context. Suggestions to change code the author did not touch, flags on patterns that match the rest of the codebase, and approaches that conflict with a known constraint are honest mistakes from a narrow view. Dismiss them.

Do not dismiss a finding because it is uncomfortable. Consensus, a concrete execution path, a gap in your model of the code, and a finding you read and recognize are reasons to act. Security findings and correctness bugs deserve scrutiny even from a single reviewer.

### What a finding contains

Severity is critical, warning, or nit. Critical would cause a bug, data loss, a security issue, or broken behavior. Warning is a design, maintainability, or correctness risk that is not immediately broken. Nit is style, naming, or a minor improvement.

A finding names a location, states what is wrong, and shows evidence. A suggestion is optional and only when a concrete alternative exists. A good finding references specific code, separates "this is broken" from "I would have done it differently", and respects the stated intent. Do not restate the code without a problem. Do not praise it. An empty review is a valid outcome.

### Output

Intent, as stated. Then one line per reviewer with a finding count, and no vendor name. Then Act on, Consider, Noted, and Dismissed. Then an agreement map: where reviewers agreed, where they diverged, and what that pattern says. Stop. Do not apply the patch.

### Review rubric

Use the lenses that apply. A simple bug fix does not need paragraphs about architectural integrity.

Correctness. Does the code do what the intent says? Empty inputs, nil, boundary values, concurrent access. Errors caught, propagated, or swallowed. Off-by-one, coercion, overflow, encoding. Races, stale closures, dangling references. The happy path and the sad path. Idempotency: what happens if this runs twice, or the previous run crashed halfway? If the answer depends on leftover state, a reconciliation step is missing. If several actors can touch the same mutable state, is access serialized by structure or by a convention that will not hold? Trace the execution path. Do not flag "this could be nil" without the call chain that makes it nil.

Root cause versus symptom. Is this the fault, or a cover? Read callers, callees, types, and siblings before judging the layer. Guard clauses that mask a broken invariant, retries that hide a broken contract, casts that silence a modeling error, and a workaround whose proper fix lives in another module's contract are symptom fixes. If the fix is a comment that says "do not do X", or a convention someone must remember, ask whether a type, a lint, or a check could make the wrong thing impossible.

Structural integrity. Validation at the boundary, or scattered through business logic? Orchestration mixed with low-level detail? New coupling that makes the next change harder? Data structures that do not match the access pattern? A requirement bolted on, rather than integrated as if it had been there from the start? A new API beside the old one, with no external consumer? Migrate callers and delete the old path in the same wave. Do not penalize simple code for lacking abstraction. Premature abstraction is worse than duplication.

Verification. Are there tests, and do they test behavior or implementation details? Would an assertion catch a regression? A bug fix needs a test for the bug. An integration boundary needs the full path tested. Checking liveness via a file timestamp or a cache, instead of the actual value, is a gap. Delegated or async work must verify the output artifact, not a self-report.

Complexity budget. Code that could be simpler without losing correctness. An abstraction with one call site. Configuration for a case that does not exist. Dead code, unused imports, vestigial parameters. "Just in case" paths with no caller. Compatibility kept alive after the migration is done. Every feature, control, and option earns its place. Half-finished features are worse than missing ones. Simpler is better unless simpler is wrong.

Security. Trace the input path. Untrusted input into a query, a shell, an evaluator, or markup without a boundary. Authentication or authorization gaps on a new endpoint. Secrets in code, logs, or error messages. Time-of-check against time-of-use on a security-critical path.

### Code-quality lens

Be ambitious about structure. Do not stop at local cleanup. Look for a restructuring that preserves behavior and makes the implementation simpler, smaller, and more direct. If you can delete complexity rather than rearrange it, push for that.

- Do not let a change push a file from under a thousand lines to over a thousand without a strong reason. Prefer a real extraction. Waive only when the resulting file stays clearly organized.
- Do not allow new ad-hoc conditionals, scattered special cases, or one-off branches in an unrelated flow. That is a design problem. Push the logic into a helper, a state machine, or a module.
- If behavior can stay the same while the structure gets meaningfully cleaner, push for the cleaner version. Prefer removing a moving piece over spreading the same complexity around.
- Prefer direct, boring code. Be skeptical of a generic mechanism that hides a simple data shape, and of a thin wrapper that adds indirection without clarity.
- Question unnecessary optionality, an untyped escape, or a cast when a clearer type boundary could exist. If a branch uses a silent fallback to paper over an invariant, ask whether the boundary should be explicit.
- Keep logic in the canonical layer. Reuse an existing helper. Call out feature logic leaking into a shared path, or a detail leaking through an API.
- Treat needless sequential orchestration and non-atomic updates as design smells when the cleaner structure is obvious. Do not chase micro-optimizations. Do flag orchestration that makes the code brittle.

Do not approve merely because behavior seems correct. Presumptive blockers, unless the author can justify them: incidental complexity a deletion would remove, a file crossing a thousand lines, ad-hoc branching that tangles an existing flow, feature checks scattered across shared code, an unnecessary wrapper or a cast-heavy contract, a duplicated helper, or logic in the wrong layer when a canonical home is clear. Be direct about a maintainability problem. Do not soften a structural issue into a rename.

## Doctrine 96

Correct

The same mistake keeps getting corrected. Change the repo so the next contributor cannot make it. Assume that contributor sees only the files they opened, copies the nearest example, and takes the shortest path that compiles. Design the repo so a change that looks right from one file is right for the whole repo.

Find the classes. Read recent commits, reverts, review comments, instruction files, and comments that explain workarounds. Group the mistakes. A class counts once it has happened twice.

Fix each class at the highest level that works.

1. Eliminate it with architecture. One owner per piece of state. One supported way per task. Hide internals so the wrong import fails. Replace a hand-synced list with one source of truth. Delete the old way and the dead code a contributor would copy.
2. Enforce it with types so the bad state cannot be written. If bad code still compiles, add a lint or a check whose error names the file, type, or function to use instead. If the pattern is already common, fail only when a change adds more.
3. Test the behavior. Fix or delete a test that still passes when the behavior breaks, or that fails when only the internals change.
4. Write docs or instruction text last, and only for a judgment call. Nothing fails when a contributor skips them.

Fix the most frequent classes now, one commit each. Prove each new check fails on a real past mistake. Run the same command locally and in the check pipeline. An exception sits on the offending line with a reason, an expiry date, and a person's approval.

Keep a table in the instruction file that pairs each rule with what enforces it. When you are corrected, fix the mistake and add the rule. If the rule was already there and nothing enforces it, that is a repeat. Fix it at the highest level in the same change. Drop a rule once its mistake cannot happen.

Reply with each class, its evidence, the level you picked, and why a higher level did not work.

## Doctrine 97

No comments

A comment that restates the code does not survive. A comment survives only for a constraint the code cannot express, and the first move is still to encode that constraint.

Scope is the caller's files or diff, otherwise the current diff against the base, including the working tree.

Review the comments in scope with one fresh read-only pass. Obey subagents-and-fleets: the pass does not edit, and a rejected pass is rerun fresh with the failure named, not resumed. Reject application-code edits, scope escapes, and a deletion that a real exception protects. A flag that treats kept intentional code as guilty is a bad flag. A surprise in the code under review stays actionable. Do not restore a comment that only restates the code. A keep survives only with proof it is about something this change cannot change. A suppression of a correctness or safety check stays actionable. Restore a deletion only with the exact exception and scoped proof. If a kill or a keep is ambiguous, read the symbol's role and history before deciding. If a kill is still ambiguous, do not restore the comment. If a keep is refuted or still ambiguous, delete it. A second rejected pass fails the comment sweep. Report it open.

Fix a trivial accepted flag directly. Delete a dead path, drop a parameter, or call the real API. If a fix needs a new shape, sketch types once for the accepted set and stop at the sketch, then implement. The implementation is the smallest root-cause fix inside the fence. Remove every named workaround. If the root cause is out of scope, land the smallest in-scope fix and report the rest open. Do not widen the fence, and do not bolt on a symptom guard.

A constraint comment says "do not remove", "do not change this wording", or "talk to someone before changing this". Leave a keep about a thing this change cannot change. Offer the cheapest in-scope encoding: a type, a runtime check, a test, or a lint. If you can encode it in scope, encode it and delete the comment. If you cannot, leave the comment and report the encoding as open. Do not delete an unencoded constraint just to stay unblocked. Sketch any out-of-scope work. Do not do it in this change.

Report the deletion count, restored comments, reruns, the sketch, the fixes, the encodings, the unenforced constraints, and the other open work.
