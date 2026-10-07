---
name: backend-build
description: "Build a whole new backend component, service surface, or wired seams from scratch."
category: backend
tier: T1/T2
---

Root/child contract:
- Host/root owns admission, gates, and completion.
- T2: serial implementer lanes in shared cwd; do not fan out a recursive hierarchy.
- T3: spawn only admitted, dependency-ready implementer lanes with pairwise-disjoint owned paths and no shared mutable state.
- Children emit ChildResult: implement or check the assigned lane and emit one ChildResult JSON line. They do not call performance_gate and do not spawn nested workers.
- Stay on owned paths. Independent verification belongs to host/root (or a fresh named reviewer/verifier). A first draft is not completion.

# Native execution protocol: backend-build
# Framework: backend-build  (category backend × subsection build · no tag* · tier T1/T2/T3)

Stay on owned paths. Independent verify uses a different agent than the producer. Children emit one ChildResult; they do not spawn nested workers. Host/root owns gates. Goal: build a WHOLE
NEW backend component/surface from scratch - data model, the rules/endpoints/jobs,
and the SEAMS that wire it - production-grade and proven end-to-end.
\*An `external-target` overlay applies where it joins an external system
(recon → tool-select → build → prove against the real target; PLAYBOOKS.md).

BOUNDED T1 PATH: when admission already selected T1 + this framework, root executes G4 (strict TDD) directly, then independent G5/G6. Do NOT require a prior `ROADMAP.md` item and do NOT escalate to T2 solely because no roadmap exists. OWNERSHIP CLIMB ONLY: missing ROADMAP.md, many steps, a large artifact, or preferring more agents never raises the tier. Climb to T2/T3 only when ownership splits into multiple surfaces that must run serially (T2) or can run in parallel without shared mutable state (T3).

GATE PATH (T2): an executable roadmap item goes directly to G4 IMPLEMENT(TDD) → G5 IMPL-REVIEW → G6 VERIFY → G7 SIGN-OFF → GOAL-CHECK. G1 is conditional and runs only when `requiresDetailedPlan: true`, a named architecture fork remains unresolved, or an implementer reports `PLAN-CONFLICT`. T3 uses 3 unanimous jurors.

## Root/child contract
- Stay on owned paths for the assigned lane.
- Independent review/verify uses a different agent than the producer; a first draft is not completion.
- Children emit one ChildResult JSON line; they do not call performance_gate and do not spawn nested workers.
- Host/root owns admission, gates, and completion. T2 serializes implementer lanes; T3 spawns only admitted disjoint implementers.


## Gate path
Executable roadmap: G4 IMPLEMENT(TDD) → G5 IMPL-REVIEW → G6 VERIFY →
G7 SIGN-OFF → GOAL-CHECK. Insert G1 only for the conditional triggers above.
T3 uses 3 unanimous jurors.

## THE END-TO-END WORKFLOW

### Phase 1 - ROADMAP / CONDITIONAL PLAN (G1)
FIRST verify an executable `ROADMAP.md` item exists for this component; if none exists,
report OUT-OF-SCOPE and escalate (**S4**) only when ownership must split into multiple surfaces; missing ROADMAP.md alone is not a climb reason. An implementation-ready item skips G1. Run
G1 only for `requiresDetailedPlan: true`, a named unresolved architecture fork, or
`PLAN-CONFLICT`; a genuine architecture fork routes through **S2** and `plan-design`.
When G1 runs, the planner maps the component's pieces (data model, rules/endpoints/
jobs), the SEAMS that wire them, and the build order. State each
piece's contract and the cross-cutting concerns a real owner would not ship without:
input validation at every boundary, authn/authz, error handling, idempotency/
retries, observability, migrations. Integration is its OWN piece.

### Phase 2 - GATE-ZERO + BUILD piece by piece (G4, TDD)
Confirm the repo's OWN test command runs (else **S1 BLOCKED**). Build each piece
TDD (tests first, then code), within its owned files; the implementer may sequence parallel pieces for genuinely parallel pieces. Coverage to the mission's bar (default 100% of
the feature's surface) - ≥95% of changed lines is a floor, not the target.

### Phase 3 - WIRE THE SEAMS (explicit step) + IMPL-REVIEW (G5)
Wire the pieces together as a deliberate step - the seams are where it fails. Then
a fresh reviewer: claims vs diff, contracts honored across the seams, no piece
left stubbed, unhappy paths handled, no scope creep.

### Phase 4 - VERIFY END-TO-END (G6, grounded, fresh worker)
On the REAL repo (returns reproWasRed/reproNowGreen/preExistingRegressions/
testCommand): the component's tests pass; the seams work end-to-end (exercise the
real path, not just unit pieces); the FULL pre-existing tests of every touched
module + dependents stay GREEN; adversarial inputs behave; coverage ≥95%. For an
external-target build, prove it against the real target, not a demo.
**REGRESSION-IS-A-SIGNAL:** any green→red flip → root-cause and redo the owning
piece (**S3**); never weaken/skip.

### Phase 5 - SIGN-OFF + GOAL-CHECK → **S5** DONE.

## THE BLOCKED INVARIANT (non-negotiable)
Verification runs the REAL check in its REAL environment - NEVER fake a pass, NEVER
fabricate evidence, NEVER declare DONE over a red or un-runnable check. On ANY blocker,
STOP and report the attempt + the concrete unblock path. Children emit ChildResult and stop; host/root owns gates.

## Closed decision scenarios (each ends at ONE verdict)
- **S1 - real test suite cannot run** → BLOCKED (report attempt + unblock path).
- **S2 - architecture genuinely undecided** → hand to `plan-design` for the blueprint
  before building; never improvise a design mid-build.
- **S3 - a pre-existing test flips green→red** → FAILED (regression-is-a-signal: redo
  the owning piece); never weaken/skip.
- **S4 - a piece proves bigger/cross-cutting than scoped** → OUT-OF-SCOPE; climb a tier only when ownership splits into multiple surfaces (GATES.md ESCALATION; missing roadmap / step count / size never climbs). The host/root splits into sibling lanes; children do not self-split by spawning.
- **S5 - every piece built + seams wired + zero regressions + end-to-end proven +
  sign-off PASS** → DONE.

## Stacking
One admitted lane (its internal sequencing for parallel pieces is internal). A
multi-surface mission is split in ROADMAP.md into disjoint features, each its own
framework as a sibling lane - `frameworks/composition.md`.
