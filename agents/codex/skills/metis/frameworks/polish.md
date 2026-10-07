---
name: polish
description: "Visual/copy/detail polish pass over an existing working surface; T1 retains independent G5/G6."
category: polish
tier: T0/T1
---

Root/child contract:
- Host/root owns admission, gates, and completion.
- T2: serial implementer lanes in shared cwd; do not fan out a recursive hierarchy.
- T3: spawn only admitted, dependency-ready implementer lanes with pairwise-disjoint owned paths and no shared mutable state.
- Children emit ChildResult: implement or check the assigned lane and emit one ChildResult JSON line. They do not call performance_gate and do not spawn nested workers.
- Stay on owned paths. Independent verification belongs to host/root (or a fresh named reviewer/verifier). A first draft is not completion.

# Native execution protocol: polish
# Framework: polish  (overlay-leaf · category frontend × subsection polish · tag polish · tier T1/T2)

Stay on owned paths. Independent verify uses a different agent than the producer. Children emit one ChildResult; they do not spawn nested workers. Host/root owns gates. Goal: a visual/copy/
detail polish pass over an EXISTING working surface - the last-mile quality that
makes it feel finished. It pairs with `frontend-review` findings; it does NOT add new
capability (that is `frontend-implement`) and it does NOT fix broken behavior (that is
`frontend-fix`).

GATE PATH (T2): G4 IMPLEMENT(TDD, owned files) → G5 IMPL-REVIEW → G6 VERIFY(grounded + rendered) → G7 SIGN-OFF(1 juror, the `polish` gate) → GOAL-CHECK. An implementation-ready executable roadmap item goes directly to G4. G1 is conditional only for a named unresolved polish-inventory fork, `requiresDetailedPlan: true`, or implementer-reported PLAN-CONFLICT. T1 omits G7 but retains independent G5 review and G6 verification.

## Root/child contract
- Stay on owned paths for the assigned lane.
- Independent review/verify uses a different agent than the producer; a first draft is not completion.
- Children emit one ChildResult JSON line; they do not call performance_gate and do not spawn nested workers.
- Host/root owns admission, gates, and completion. T2 serializes implementer lanes; T3 spawns only admitted disjoint implementers.


## THE END-TO-END WORKFLOW

### Conditional PLAN the polish inventory (G1)
Run only for a named unresolved inventory fork, `requiresDetailedPlan: true`, or
implementer-reported PLAN-CONFLICT. Inspect the rendered surface and resolve the named
fork across states, responsiveness, microcopy, motion, and accessibility. Otherwise
the executable roadmap inventory dispatches directly to G4. A missing state or behavior
bug is not polish → **S2** route to `frontend-implement`/`frontend-fix`.

### Phase 1 - GATE-ZERO + IMPLEMENT (G4, TDD)
Confirm the project's OWN test/build setup runs (else **S1 BLOCKED**). Apply the
polish within owned files only; where a change has testable behavior (a state now
renders, copy now shows), add/keep a test. Honor framework + a11y contracts; coverage
to the mission's bar (default 100% of the feature's surface) - ≥95% of changed lines is
a floor, not the target. This is a light touch - no capability added, no refactor.

### Phase 3 - IMPL-REVIEW (G5, fresh worker)
Compare the inventory and implementation claims against the real diff. Confirm every
listed polish item landed, no behavior or capability change slipped in, tests assert the
changed states and copy, and owned-path boundaries were respected. Any mismatch returns
to G4 before verification.

### Phase 4 - VERIFY (G6, grounded + rendered, fresh worker)
On the REAL project (returns reproWasRed/reproNowGreen/preExistingRegressions/
testCommand): tests pass; the FULL pre-existing tests of touched modules + dependents
stay GREEN; coverage ≥95%; PLUS a real look at the RENDERED artifact confirming each
polish item landed across its states (not a source read).
**REGRESSION-IS-A-SIGNAL:** any green→red flip → root-cause and redo; never weaken/skip.

### Phase 5 - SIGN-OFF (G7, the `polish` gate) + GOAL-CHECK
One juror asks "does this feel finished?" on the rendered evidence, then a fresh
default-FAIL goal-check confirms every planned polish item landed with zero
regressions → **S5** DONE.

## THE BLOCKED INVARIANT (non-negotiable)
Verification runs the REAL check in its REAL environment - NEVER fake a pass, NEVER
fabricate evidence, NEVER declare DONE over a red or un-runnable check. On ANY blocker,
STOP and report the attempt + the concrete unblock path. Children emit ChildResult and stop; host/root owns gates.

## Closed decision scenarios (each ends at ONE verdict)
- **S1 - real test/build setup cannot run** → BLOCKED (report attempt + unblock path).
- **S2 - an item is a missing STATE or a behavior BUG, not polish** → route it to
  `frontend-implement` / `frontend-fix`; polish covers only the finished-feel pass.
- **S3 - a pre-existing test flips green→red** → FAILED (regression-is-a-signal: redo);
  never weaken/skip.
- **S4 - the "polish" is really a redesign/new capability** → OUT-OF-SCOPE; climb a tier only when ownership splits into multiple surfaces (GATES.md ESCALATION; missing roadmap / step count / size never climbs) or route to `frontend-build`.
- **S5 - every planned polish item landed across its states + zero regressions +
  juror PASS** → DONE.

## Stacking
A VERTICAL overlay in practice (it reshapes only G7 as the `polish` tag), but a
standalone polish task runs as One admitted lane. Pairs with `frontend-review` findings
and stacks over `frontend-implement`/`frontend-build` - `frameworks/composition.md`.
