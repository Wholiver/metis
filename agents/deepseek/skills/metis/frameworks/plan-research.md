---
name: plan-research
description: "Ground truth discovery, dependency analysis, and exploration."
category: planning
tier: T1/T2
---

Root/child contract:
- Host/root owns admission, gates, and completion.
- T2: serial implementer lanes in shared cwd; do not fan out a recursive hierarchy.
- T3: spawn only admitted, dependency-ready implementer lanes with pairwise-disjoint owned paths and no shared mutable state.
- Children emit ChildResult: implement or check the assigned lane and emit one ChildResult JSON line. They do not call performance_gate and do not spawn nested workers.
- Stay on owned paths. Independent verification belongs to host/root (or a fresh named reviewer/verifier). A first draft is not completion.

# Native execution protocol: plan-research
# Framework: plan-research  (category plan × subsection research · tag research · tier T2)

Stay on owned paths. Independent verify uses a different agent than the producer. Children emit one ChildResult; they do not spawn nested workers. Host/root owns gates. Goal: find/define an UNKNOWN target via real research-with-receipts
and output a defensible thesis + ranked shortlist. Owns no production code.

GATE PATH (T2): FRAME + DIVIDE(≤3 themes) → RESEARCH per theme(bounded live batch + reconciled receipts + materialized output) → SYNTHESIZE(thesis + shortlist) → FRESH-VERIFY(default-FAIL) → DONE.

## Root/child contract
- Stay on owned paths for the assigned lane.
- Independent review/verify uses a different agent than the producer; a first draft is not completion.
- Children emit one ChildResult JSON line; they do not call performance_gate and do not spawn nested workers.
- Host/root owns admission, gates, and completion. T2 serializes implementer lanes; T3 spawns only admitted disjoint implementers.


## THE END-TO-END WORKFLOW

### Phase 1 - FRAME + DIVIDE
Restate the question precisely and decompose it into at most 3 disjoint themes. Name the usable artifact each theme must materialize: table rows, catalog entries, a manifest, a comparison, or a decision memo. Broad landscape coverage is not a license to open more themes before the first outputs land.

### Phase 2 - RESEARCH per theme (bounded queries, receipts, output)
Dispatch ONE researcher per theme. Each gets one bounded batch of at most 6 WebSearch and 6 WebFetch calls. Every claimed call and usable inspection must reconcile exactly to an inspectable receipt. Each theme must write its named materialized output before it can report progress. If live search is unavailable → **S1 BLOCKED**. If the batch ends with zero output items → **S2 NO-USEFUL-OUTPUT** and stop that lane; do not re-dispatch the same research. A residual gap may open one targeted follow-up only after accepted output exists.

### Phase 3 - SYNTHESIZE
One synthesizer merges the theme artifacts into a thesis + a ranked shortlist, each
claim traceable to a receipt, with the tradeoffs that separate the top candidates
and a clear recommendation with its rationale.

### Phase 4 - FRESH-VERIFY (default-FAIL)
A fresh agent confirms every material claim has a live receipt, competitors were
actually analyzed, and the shortlist genuinely answers the mission → **S5** DONE.

## THE BLOCKED INVARIANT (non-negotiable)
Verification runs the REAL check in its REAL environment - NEVER fake a pass, NEVER
fabricate evidence, NEVER declare DONE over a red or un-runnable check. On ANY blocker,
STOP and report the attempt + the concrete unblock path. Children emit ChildResult and stop; host/root owns gates.

## Closed decision scenarios (each ends at ONE verdict)
- **S1 - live search unavailable** → BLOCKED (report attempt; never fabricate sources).
- **S2 - zero materialized output or receipts do not reconcile** → stop the lane and return the concrete residual; never pay for the same broad wave again.
- **S3 - the target is actually KNOWN and needs a design** → hand to `plan-design`.
- **S4 - findings imply build features** → hand to `plan-scope`.
- **S5 - thesis + shortlist, every claim has a live receipt, mission answered** → DONE.

## Stacking
One admitted lane (its parallelism is YOU dispatching sibling researchers per theme). A
mission needing research THEN build is split in ROADMAP.md - research feeds the build
framework - `frameworks/composition.md`.
