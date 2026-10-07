---
name: frontend-implement
description: "Build responsive UI components, state management, and user interactions."
category: frontend
tier: T1/T2
---

Root/child contract:
- Host/root owns admission, gates, and completion.
- T2: serial implementer lanes in shared cwd; do not fan out a recursive hierarchy.
- T3: spawn only admitted, dependency-ready implementer lanes with pairwise-disjoint owned paths and no shared mutable state.
- Children emit ChildResult: implement or check the assigned lane and emit one ChildResult JSON line. They do not call performance_gate and do not spawn nested workers.
- Stay on owned paths. Independent verification belongs to host/root (or a fresh named reviewer/verifier). A first draft is not completion.

# Native execution protocol: frontend-implement
# Framework: frontend-implement  (category frontend × subsection implement · tag user-facing · tier T1/T2)

Stay on owned paths. Independent verify uses a different agent than the producer. Children emit one ChildResult; they do not spawn nested workers. Host/root owns gates. Goal: add or change
ONE bounded UI/client piece - correct, tested, AND genuinely usable on a real render.

BOUNDED T1 PATH: when admission already selected T1 + this framework, root executes G4 directly, then independent G5/G6. Do NOT require a prior `ROADMAP.md` item and do NOT escalate to T2 solely because no roadmap exists. OWNERSHIP CLIMB ONLY: missing ROADMAP.md, many steps, a large artifact, or preferring more agents never raises the tier. Climb to T2/T3 only when ownership splits into multiple surfaces that must run serially (T2) or can run in parallel without shared mutable state (T3).

GATE PATH (T2): an implementation-ready roadmap item goes directly to G4 IMPLEMENT(TDD) → G5 IMPL-REVIEW → G6 VERIFY(grounded + usability) → G7 SIGN-OFF(1 juror) → GOAL-CHECK. G1 is conditional and runs only when `requiresDetailedPlan: true`, a named design fork remains unresolved, or an implementer reports `PLAN-CONFLICT`.

## Root/child contract
- Stay on owned paths for the assigned lane.
- Independent review/verify uses a different agent than the producer; a first draft is not completion.
- Children emit one ChildResult JSON line; they do not call performance_gate and do not spawn nested workers.
- Host/root owns admission, gates, and completion. T2 serializes implementer lanes; T3 spawns only admitted disjoint implementers.


## Gate path (T2)
Implementation-ready roadmap: G4 IMPLEMENT(TDD) → G5 IMPL-REVIEW →
G6 VERIFY(grounded + usability) → G7 SIGN-OFF(1 juror) → GOAL-CHECK. Insert G1
only for the conditional triggers above.

## THE END-TO-END WORKFLOW

### Phase 1 - CONDITIONAL PLAN (G1)
FIRST verify an executable `ROADMAP.md` item exists for this feature; if none exists,
report OUT-OF-SCOPE and escalate (**S4**) only when ownership must split into multiple surfaces; missing ROADMAP.md alone is not a climb reason. An implementation-ready item skips G1. Run
G1 only for `requiresDetailedPlan: true`, a named unresolved design fork, or
`PLAN-CONFLICT`; then the planner looks at the real UI first and delivers: the success criterion in user
terms; the change file-by-file; ALL the states the piece must handle (loading /
empty / error / populated / overflow / disabled); the responsive + accessibility
requirements (keyboard, screen-reader roles/labels, focus); and how a real user
reaches and completes the interaction. One bounded piece - not a whole flow (else
**S4**). A genuine design fork → **S2** hand to `plan-design`.

### Phase 2 - GATE-ZERO + IMPLEMENT (G4, TDD)
Confirm the project's OWN test/build setup runs (else **S1 BLOCKED**). TDD: failing
tests first (behavior + each state), then minimal correct code, owned files only.
Honor framework contracts (effect deps, controlled inputs, key stability, a11y
roles). Coverage to the mission's bar (default 100% of the feature's surface) - ≥95%
of changed lines is a floor, not the target.

### Phase 3 - IMPL-REVIEW (G5, fresh worker)
Claims vs diff; all states implemented; tests assert real behavior; a11y not
dropped; no scope creep.

### Phase 4 - VERIFY (G6, grounded + USABILITY, fresh worker)
On the REAL project (returns reproWasRed/reproNowGreen/preExistingRegressions/
testCommand): the piece's tests pass; the FULL pre-existing tests of touched
modules + dependents stay GREEN; coverage ≥95%; PLUS a real usability pass on the
RENDERED artifact - a persona actually uses it across states (not a source read).
A usability blocker (a real user can't complete the task) → **S3-USABILITY**.
**REGRESSION-IS-A-SIGNAL:** any green→red flip → root-cause and redo; never weaken/skip.

### Phase 5 - SIGN-OFF + GOAL-CHECK → **S5** DONE.

## THE BLOCKED INVARIANT (non-negotiable)
Verification runs the REAL check in its REAL environment - NEVER fake a pass, NEVER
fabricate evidence, NEVER declare DONE over a red or un-runnable check. On ANY blocker,
STOP and report the attempt + the concrete unblock path. Children emit ChildResult and stop; host/root owns gates.

## Closed decision scenarios (each ends at ONE verdict)
- **S1 - real test/build setup cannot run** → BLOCKED (report attempt + unblock path).
- **S2 - genuine design fork** → hand to `plan-design`; do not guess it.
- **S3 - a pre-existing test flips green→red** → FAILED (regression-is-a-signal: redo).
  **S3-USABILITY - rendered piece fails the usability pass** → back to G4 with the
  friction named; not DONE until a real user can complete the task.
- **S4 - bigger than ONE bounded piece** (a whole flow / spans subsystems) →
  OUT-OF-SCOPE; climb a tier only when ownership splits into multiple surfaces (GATES.md ESCALATION; missing roadmap / step count / size never climbs).
- **S5 - piece proven + zero regressions + usability pass + juror PASS** → DONE.

## Stacking
One admitted lane. A multi-surface task is split in ROADMAP.md into disjoint features, each
its own framework as a sibling lane - `frameworks/composition.md`.
