---
name: docs
description: "Author, update, and audit technical documentation."
category: docs
tier: T0/T1
---

Root/child contract:
- Host/root owns admission, gates, and completion.
- T2: serial implementer lanes in shared cwd; do not fan out a recursive hierarchy.
- T3: spawn only admitted, dependency-ready implementer lanes with pairwise-disjoint owned paths and no shared mutable state.
- Children emit ChildResult: implement or check the assigned lane and emit one ChildResult JSON line. They do not call performance_gate and do not spawn nested workers.
- Stay on owned paths. Independent verification belongs to host/root (or a fresh named reviewer/verifier). A first draft is not completion.

# Native execution protocol: docs
# Framework: docs  (category plan × subsection docs · no tag · tier T0/T1/T2)

Stay on owned paths. Independent verify uses a different agent than the producer. Children emit one ChildResult; they do not spawn nested workers. Host/root owns gates. Goal: a documentation deliverable (README, API docs, guide,
onboarding) that is ACCURATE against the real code and USABLE by its real audience -
with at least one example that actually runs. Owns no production code.

GATE PATH: T0 is only for a fully specified one-line docs edit (exact replacement) closed in the G4 receipt with zero spawn. Substantive authoring is T1+ and runs `G4 WRITE → G5 DOC-REVIEW → G6 ACCURACY-VERIFY` (T2 may add GOAL-CHECK). An implementation-ready executable roadmap item goes directly to G4. G1 is conditional only when the item names an unresolved audience/outline design fork, sets `requiresDetailedPlan: true`, or the writer returns PLAN-CONFLICT. Do not claim T0 still runs independent G5/G6 workers.

## Root/child contract
- Stay on owned paths for the assigned lane.
- Independent review/verify uses a different agent than the producer; a first draft is not completion.
- Children emit one ChildResult JSON line; they do not call performance_gate and do not spawn nested workers.
- Host/root owns admission, gates, and completion. T2 serializes implementer lanes; T3 spawns only admitted disjoint implementers.


## THE END-TO-END WORKFLOW

### Conditional PLAN: audience + outline (G1)
Run only for a named unresolved audience/outline fork, `requiresDetailedPlan: true`,
or writer-reported PLAN-CONFLICT. Name the real audience and what they need to
accomplish, then identify the claims that need code verification. Otherwise the
executable roadmap already supplies this contract and dispatch proceeds directly to G4.
If the thing to document is UNKNOWN/undiscovered → **S1** hand to `plan-research`.

### Phase 1 - WRITE (G4)
Write to the outline against the REAL code - read the actual signatures, flags,
routes, config, and behaviors as you write; do not paraphrase from memory. Every
runnable claim (install step, API call, CLI command) is written as a concrete example
a reader can copy. At least ONE end-to-end example must be included that genuinely
runs against the real artifact.

### Phase 3 - DOC-REVIEW (G5, fresh worker, every tier)
A fresh reviewer checks: audience fit (does it answer the reader's real questions),
completeness against the outline, tone/clarity, and no drift from the code. A claim
with no backing in the real artifact is a defect → **S2**.

### Phase 4 - ACCURACY-VERIFY (G6, grounded, fresh worker)
The GATE that separates docs from fiction. On the REAL artifact: every documented
signature/flag/path/command/config key is CHECKED against the code and matches; and
the example(s) are actually EXECUTED and produce the documented result. A doc claim
that does not match the code, or an example that does not run, is the doc analog of a
red test → **S2 INACCURATE** / **S3 EXAMPLE-BROKEN**; fix the doc (or the example) and
re-verify. Never ship a doc claim you did not check against code.

### Phase 5 - GOAL-CHECK → **S5** DONE
A fresh default-FAIL goal-check confirms the audience's needs are met, every claim was
verified against the real code, and at least one example ran → DONE.

## THE BLOCKED INVARIANT (non-negotiable)
Verification runs the REAL check in its REAL environment - NEVER fake a pass, NEVER
fabricate evidence, NEVER declare DONE over a red or un-runnable check. On ANY blocker,
STOP and report the attempt + the concrete unblock path. Children emit ChildResult and stop; host/root owns gates.

## Closed decision scenarios (each ends at ONE verdict)
- **S1 - the thing to document is UNKNOWN / undiscovered** → hand to `plan-research` first.
- **S2 - a documented claim does not match the code** → INACCURATE; correct the doc
  against the real code and re-verify. Never ship the mismatch.
- **S3 - a documented example does not run** → EXAMPLE-BROKEN; fix the example (or the
  doc) until it runs, then re-verify. Never ship an example you did not execute.
- **S4 - the "docs" task is really scoping a whole deliverable's roadmap** → hand to
  `plan-scope`; docs covers the documentation artifact itself.
- **S5 - audience needs met + every claim verified against code + example ran** → DONE.

## Stacking
One admitted lane. Docs for a multi-surface deliverable are split in ROADMAP.md into
disjoint-ownership doc features - `frameworks/composition.md`.
