---
name: backend-implement
description: "Implement new backend services, models, and endpoints."
category: backend
tier: T1/T2
---

Root/child contract:
- Host/root owns admission, gates, and completion.
- T2: serial implementer lanes in shared cwd; do not fan out a recursive hierarchy.
- T3: spawn only admitted, dependency-ready implementer lanes with pairwise-disjoint owned paths and no shared mutable state.
- Children emit ChildResult: implement or check the assigned lane and emit one ChildResult JSON line. They do not call performance_gate and do not spawn nested workers.
- Stay on owned paths. Independent verification belongs to host/root (or a fresh named reviewer/verifier). A first draft is not completion.

# Native execution protocol: backend-implement
# Framework: backend-implement  (category backend × subsection implement · no tag · tier T1/T2)

Stay on owned paths. Independent verify uses a different agent than the producer. Children emit one ChildResult; they do not spawn nested workers. Host/root owns gates. Goal: add or change
ONE bounded backend capability (an endpoint, a rule, a job) correctly,
production-grade, with tests that prove behavior and zero regressions.

BOUNDED T1 PATH: when admission already selected T1 + this framework, root executes G4 (strict TDD) directly, then independent G5/G6. Do NOT require a prior `ROADMAP.md` item and do NOT escalate to T2 solely because no roadmap exists. OWNERSHIP CLIMB ONLY: missing ROADMAP.md, many steps, a large artifact, or preferring more agents never raises the tier. Climb to T2/T3 only when ownership splits into multiple surfaces that must run serially (T2) or can run in parallel without shared mutable state (T3).

GATE PATH (T2): an implementation-ready roadmap item goes directly to G4 IMPLEMENT(TDD) → G5 IMPL-REVIEW → G6 VERIFY(grounded) → G7 SIGN-OFF(1 juror) → GOAL-CHECK. G1 is conditional and runs only when `requiresDetailedPlan: true`, a named design fork remains unresolved, or an implementer reports `PLAN-CONFLICT`.

## Root/child contract
- Stay on owned paths for the assigned lane.
- Independent review/verify uses a different agent than the producer; a first draft is not completion.
- Children emit one ChildResult JSON line; they do not call performance_gate and do not spawn nested workers.
- Host/root owns admission, gates, and completion. T2 serializes implementer lanes; T3 spawns only admitted disjoint implementers.


## Gate path (T2)
Implementation-ready roadmap: G4 IMPLEMENT(TDD) → G5 IMPL-REVIEW →
G6 VERIFY(grounded) → G7 SIGN-OFF(1 juror) → GOAL-CHECK. Insert G1 only for
the conditional triggers above.

## THE END-TO-END WORKFLOW

### Phase 1 - CONDITIONAL PLAN (G1)
FIRST verify an executable `ROADMAP.md` item exists for this feature. If none exists,
report OUT-OF-SCOPE and escalate (**S4**) only when ownership must split into multiple surfaces; missing ROADMAP.md alone is not a climb reason. An implementation-ready item skips G1. Run
G1 only for `requiresDetailedPlan: true`, a named unresolved design fork, or
`PLAN-CONFLICT`; then brief the planner to look at the real code first and deliver: the success
criterion in the mission's terms; the ONE genuine design choice this capability
carries and the option chosen with its tradeoff (if the choice is a real
architecture fork, → **S2** hand to `plan-design`); the file-by-file change; the
**contract** (inputs, outputs, invariants, error behavior); every unhappy path
(invalid input, missing/duplicate, auth/permission, concurrency, downstream
failure); and the test strategy that proves each - not just the happy path. Coverage
target = the mission's bar (default 100% of the feature's surface); ≥95% of changed
lines is a floor, not the target.

### Phase 2 - GATE-ZERO + IMPLEMENT (G4, TDD)
First confirm the repo's OWN test command runs on untouched code (else **S1
BLOCKED**). Then TDD: write the failing tests first (happy + each unhappy path),
then the minimal correct code, within owned files only. Validate inputs at the
boundary; handle the unhappy path at the same detail as the happy path; no
swallowed errors, no scope creep. Hold the Phase-1 coverage bar (≥95% of changed lines
is the floor, not the target).

### Phase 3 - IMPL-REVIEW (G5, fresh worker)
Every implementer claim matched to a diff line (a claim with no backing diff is a
LIE → SMASH); contract honored; unhappy paths actually handled; tests assert
specific behavior, not truthiness; no scope creep, no dead code.

### Phase 4 - VERIFY EXHAUSTIVELY (G6, grounded, fresh worker)
On the REAL repo (returns reproWasRed/reproNowGreen/preExistingRegressions/
testCommand): the new behavior's tests pass; the FULL pre-existing tests of the
touched module + direct dependents stay GREEN; adversarial inputs (None, empty,
wrong type, boundary, concurrent) behave; coverage ≥95%.
**REGRESSION-IS-A-SIGNAL:** any pre-existing green→red flip means the change broke a
contract other code relied on → root-cause it and redo (**S3**); never weaken/skip
the test.

### Phase 5 - SIGN-OFF + GOAL-CHECK
One juror (would you ship it?), then a fresh default-FAIL goal-check: asks met on
opened evidence, zero open blockers → **S5** DONE.

## THE BLOCKED INVARIANT (non-negotiable)
Verification runs the REAL check in its REAL environment - NEVER fake a pass, NEVER
fabricate evidence, NEVER declare DONE over a red or un-runnable check. On ANY blocker,
STOP and report the attempt + the concrete unblock path. Children emit ChildResult and stop; host/root owns gates.

## Closed decision scenarios (each ends at ONE verdict)
- **S1 - real test suite cannot run** → BLOCKED (report attempt + unblock path).
- **S2 - the design choice is a genuine architecture fork** → hand to `plan-design`;
  do not guess it.
- **S3 - a pre-existing test flips green→red** → FAILED (regression-is-a-signal: redo);
  never weaken/skip.
- **S4 - bigger than ONE bounded capability** (spans >1 subsystem) → OUT-OF-SCOPE;
  climb a tier only when ownership splits into multiple surfaces (GATES.md ESCALATION; missing roadmap / step count / size never climbs). Never sprawl inline.
- **S5 - behavior proven + zero regressions + unhappy paths covered + juror PASS** → DONE.

## Stacking
One admitted lane. A multi-surface task is split in ROADMAP.md into disjoint features, each
its own framework as a sibling lane - `frameworks/composition.md`.
