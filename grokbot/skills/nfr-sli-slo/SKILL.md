---
name: "nfr-sli-slo"
description: "Feature specs locked after this pack declare SLIs, SLOs, PostHog catalog events, and an error budget. Load when: Phase 2–3, when drafting or reviewing a feature spec's NFR section."
---
<!-- collabb-doctrine-pack: id=nfr-sli-slo version=1.0.0 sha256=1316ef5eb778e9ff3baf4ad126e6df3d7165960aa4889307b242a19af2ff3dba doctrines=102 -->
## Doctrine 102

**A feature spec locked after this pack merges declares SLIs, numerical SLOs, PostHog events from the typed catalog, and error-budget behavior; a missing NFR section fails review.**

This pack is issue 537. It applies to a feature spec locked after the merge that adds the pack. A spec that is already LOCKED stays as written. There is no backfill.

### NFR section

The NFR section names four SLIs: availability, latency p95, error rate, and feature success rate.

Each SLI states a numerical SLO and a window with a stated length. Availability, error rate, and feature success rate each name a numerator and a denominator. Latency p95 names the duration it measures and a numerical threshold.

Each SLI names the PostHog events that measure it. Every event name is an entry in the typed event catalog from issue 534. This pack does not add that catalog. A name that is not in the catalog fails review.

The error-rate numerator counts system faults. User denial, budget, and missing_connection are separate counts. Those three stay out of the system-fault numerator and do not spend the system error budget. The spec may state a rate for each of them.

Event properties contain no personally identifiable information and no secrets.

The error budget is the failure allowance the SLO leaves over the window. The spec states that allowance as a count or a fraction, and it states what the team does when the allowance is spent.

Review fails when a feature spec locked after this pack is missing the NFR section, a number, a window, a catalog event name, or the spent-budget behavior. The fixture for a spec with no NFR section runs with the review check. This pack does not wire that check.
