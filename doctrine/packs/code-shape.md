---
id: "code-shape"
version: "1.0.0"
summary: "Shape code at the boundary, in the types, and for the reader who has to trace it."
load_when: "Load when adding validation, types, domain state, a module boundary, or a layer a reader would have to trace."
doctrines: [78, 79, 80, 81, 82]
complex: false
targets: ["cursor-rule", "agents-md", "grokbot-skill"]
cursor:
  globs: []
  alwaysApply: false
---
# Code shape

Five rules for the shape of the code. They govern structure, not the order of a migration and not the words in a doc.

## Doctrine 78

Boundary discipline

Put validation, narrowing, and error handling at system boundaries. Trust internal code. Business logic lives in pure functions. The shell stays thin and mechanical.

Scattered checks are noisy, redundant, and feel safer than they are. Logic mixed into framework wiring cannot be tested without the framework.

At a boundary (CLI args, config, external APIs, network protocols, RPC payloads, database rows): validate, return errors, and handle the failure. Inside the system: typed data, error propagation, no second validation. Across the boundary, expose domain concepts, not the boundary's private representation. Keep general mechanism inside and special-purpose policy at the edge.

- Validate config when it is parsed, not inside business logic.
- Parse raw data into domain types at the boundary.
- Do not re-export transport, storage, framework, or wire types through the public surface.
- Do not repeat a nil check deep in a call chain when the boundary already rejected that nil.

Parse functions are pure transforms from raw bytes to typed state. Prompt construction is structured state in, string out. Scoring is a pure transform from state to a result.

Two tests. Is this data crossing a system boundary right now? If not, the check is redundant. Can this be a pure function the shell calls? If yes, extract it.

## Doctrine 79

Type system discipline

Make the compiler reject impossible states, mismatched primitives, and unhandled variants. Prefer defining an error out of existence over adding another handler.

- Brand semantic primitives. A user id and an order id may both be strings and still must not be interchangeable. Give each its own type. Validate once at creation, then trust the type. If two arguments share a primitive type and mean different things, brand them.
- External data is untyped until parsed. Payloads, messages, CLI args, config, environment, and database rows get a parse function at the boundary that turns unstructured input into the typed model. Where that parse lives is rule 78.
- Derive types from the file that owns the shape. A protocol definition, an API schema, a migration, or a token file is the source. Do not hand-write a parallel type next to it.
- Exhaust variants. A new case should fail the build until every consumer handles it.

## Doctrine 80

Model the domain

Encode the domain in a data structure instead of scattering it across conditionals. A structure that matches the domain makes invalid states unrepresentable and deletes branches. Choosing it while writing is cheap. Recovering it later reads as a refactor and gets deferred.

Reach for a state machine instead of scattered booleans, phases, or lifecycle checks. Reach for a typed model instead of loose parameters repeated across files. Reach for a map, a registry, a lookup table, or a discriminated union instead of a branch copied into several files. Reach for a reducer or a command model instead of ad hoc mutation. Organize a module around one body of domain knowledge, not around the sequence load, validate, transform, save. Execution order is not ownership. A queue, cache, index, graph, tree, or normalized collection is right when the access pattern calls for it.

When none of those fits, name what the code must never allow and how the data is read, then pick the structure that encodes exactly that.

Do not force an abstraction. Prefer boring code when the current shape is already clear, local, and unlikely to grow. Reject an abstraction that adds indirection and does not remove a branch, a duplicated rule, an invalid state, or a lifecycle risk.

The sign you skipped this is a feature that grows an if-chain by one more branch, or a second boolean that must stay in sync with the first. Phase-named modules that repeat the same domain rule are the other sign.

## Doctrine 81

Foundational thinking

Structural decisions protect option value. Code-level decisions protect simplicity.

Get the data shape right before writing logic. Define the core types early, trace every access pattern, and choose structures that match the dominant paths. At code level, dry the structure, not every line. Types and data models should converge. Three similar statements still beat a premature abstraction. Prefer explicit over clever. Test behavior and edge cases, not line counts.

Before sharing state between actors, ask what happens if another actor modifies it concurrently. If the answer is not "nothing", isolate the state. One owner writes it.

If something helps every later phase, do it first. Ask whether every subsequent phase benefits from this existing. Shared types, the check command, and the project skeleton are scaffold. Sequence for option value: setup before features. Keep each increment a coherent abstraction, or a deepening of one that exists. Do not spread a new capability across callers as special-case coordination.

Subtraction comes before scaffolding. Remove dead code first, then lay the foundation. Rule 84 owns the subtraction. This rule owns the sequence.

## Doctrine 82

Minimize reader load

Maintainability is the work a reader does to understand the code. Track two axes. Layers to trace: indirections between the question and the answer. State to hold: hidden or mutable context the reader must keep in mind. Line count and cyclomatic complexity are proxies. Reader load is the thing that matters. The axes are independent. A flat file with many globals can be as hard as a deep adapter stack. Guard both.

- Collapse a layer that costs more than it saves. A wrapper with one caller, an adapter with no second implementation, and speculative indirection that was never needed should be inlined.
- Adjacent layers must change the abstraction. A layer that repeats the same methods and arguments adds load and no compression. Collapse pass-through layers.
- Demand interface compression. A wide interface that hides little complexity makes the reader learn the surface and the implementation. Prefer a boundary that hides a real decision.
- Shrink state scope. Prefer a return over a mutation, a local over a field, a field over module state, and module state over a global. Derive instead of syncing a copy.
- Name the invariant at the boundary, not in every consumer, so the reader learns it once.
- Before adding a layer or a piece of state, ask whether it reduces reader load elsewhere by at least as much.

The test: can a new reader answer "where does X come from?" and "what can change X?" quickly? If not, cut layers or cut state.
