---
name: frontend-build
description: "Build a whole new UI surface, page, SVG, animation, or client flow from scratch."
category: frontend
tier: T1/T2
---

Root/child contract:
- Host/root owns admission, gates, and completion.
- T2: serial implementer lanes in shared cwd; do not fan out a recursive hierarchy.
- T3: spawn only admitted, dependency-ready implementer lanes with pairwise-disjoint owned paths and no shared mutable state.
- Children emit ChildResult: implement or check the assigned lane and emit one ChildResult JSON line. They do not call performance_gate and do not spawn nested workers.
- Stay on owned paths. Independent verification belongs to host/root (or a fresh named reviewer/verifier). A first draft is not completion.

# Native execution protocol: frontend-build
# Framework: frontend-build  (category frontend × subsection build · tag user-facing · tier T1/T2/T3)

Stay on owned paths. Independent verify uses a different agent than the producer. Children emit one ChildResult; they do not spawn nested workers. Host/root owns gates. Goal: build a WHOLE
NEW UI surface/flow from scratch - every screen/state, the journey end-to-end,
wired and genuinely usable (including standalone SVG/HTML/Canvas assets).

BOUNDED T1 PATH: when admission already selected T1 + this framework, root executes G4 directly, then independent G5 review and G6 verification. Do NOT require a prior `ROADMAP.md` item, do NOT escalate to T2 solely because no roadmap exists, and do NOT invent code-coverage TDD when the oracle is structural/visual. OWNERSHIP CLIMB ONLY: missing ROADMAP.md, many steps, a large artifact, or preferring more agents never raises the tier. Climb to T2/T3 only when ownership splits into multiple surfaces that must run serially (T2) or can run in parallel without shared mutable state (T3).

GATE PATH (T2): an executable roadmap item goes directly to G4 IMPLEMENT → G5 IMPL-REVIEW → G6 VERIFY(grounded + usability) → G7 SIGN-OFF → GOAL-CHECK. G1 is conditional and runs only when `requiresDetailedPlan: true`, a named design fork remains unresolved, or an implementer reports `PLAN-CONFLICT`. T3 uses 3 unanimous jurors.

## Root/child contract
- Stay on owned paths for the assigned lane.
- Independent review/verify uses a different agent than the producer; a first draft is not completion.
- Children emit one ChildResult JSON line; they do not call performance_gate and do not spawn nested workers.
- Host/root owns admission, gates, and completion. T2 serializes implementer lanes; T3 spawns only admitted disjoint implementers.


## Gate path
Executable roadmap: G4 IMPLEMENT(TDD) → G5 IMPL-REVIEW →
G6 VERIFY(grounded + usability) → G7 SIGN-OFF → GOAL-CHECK. Insert G1 only for
the conditional triggers above. T3 uses 3 unanimous jurors.

## THE END-TO-END WORKFLOW

### Phase 1 - ROADMAP / CONDITIONAL PLAN (G1)
On admitted T1, skip this phase and go to G4 (see BOUNDED T1 PATH). On T2/T3, FIRST verify an executable `ROADMAP.md` item exists for this surface; if none exists,
report OUT-OF-SCOPE and escalate (**S4**) only when ownership must split into multiple surfaces; missing ROADMAP.md alone is not a climb reason. An implementation-ready item skips G1. Run
G1 only for `requiresDetailedPlan: true`, a named unresolved design fork, or
`PLAN-CONFLICT`; a genuine design fork routes through **S2** and `plan-design`. When G1
runs, map the screens and states, end-to-end journey, data/state wiring, responsive and
accessibility requirements, and build order. Name
the first-run/empty/error states explicitly - a surface that only handles the happy
path is not done.

### Phase 2 - GATE-ZERO + BUILD piece by piece (G4, TDD)
Confirm the project's OWN test/build setup runs (else **S1 BLOCKED**). Build each
screen/piece TDD within owned files; sequence parallel pieces for genuinely parallel pieces.
Honor framework + a11y contracts. Coverage to the mission's bar (default 100% of the
feature's surface) - ≥95% of changed lines is a floor, not the target.

### Phase 3 - WIRE THE FLOW (explicit step) + IMPL-REVIEW (G5)
Wire the journey across pieces as a deliberate step (routing, shared state,
transitions). Then a fresh reviewer: claims vs diff, all states present, a11y
intact, no piece stubbed, no scope creep.

### Phase 4 - VERIFY WHOLE-FLOW (G6, grounded + usability, fresh worker)
On the REAL project (returns reproWasRed/reproNowGreen/preExistingRegressions/
testCommand): the surface's tests pass; pre-existing tests of touched modules +
dependents stay GREEN; coverage ≥95%; PLUS a real usability pass on the rendered
FLOW - a persona completes the whole journey across states. Usability blocker →
**S3-USABILITY**.
**REGRESSION-IS-A-SIGNAL:** any green→red flip → root-cause and redo the owning
piece; never weaken/skip.

### Phase 5 - SIGN-OFF + GOAL-CHECK → **S5** DONE.

## THE BLOCKED INVARIANT (non-negotiable)
Verification runs the REAL check in its REAL environment - NEVER fake a pass, NEVER
fabricate evidence, NEVER declare DONE over a red or un-runnable check. On ANY blocker,
STOP and report the attempt + the concrete unblock path. Children emit ChildResult and stop; host/root owns gates.

## Closed decision scenarios (each ends at ONE verdict)
- **S1 - real test/build setup cannot run** → BLOCKED.
- **S2 - design genuinely undecided** → hand to `plan-design` for the blueprint first.
- **S3 - a pre-existing test flips green→red** → FAILED (regression-is-a-signal: redo).
  **S3-USABILITY - rendered flow fails the usability pass** → back to G4 with friction named.
- **S4 - a piece proves bigger/cross-cutting than scoped** → OUT-OF-SCOPE; climb a tier only when ownership splits into multiple surfaces (GATES.md ESCALATION; missing roadmap / step count / size never climbs). The host/root splits into sibling lanes; no self-split.
- **S5 - every piece built + flow wired + zero regressions + usability pass +
  sign-off PASS** → DONE.

## Stacking
One admitted lane (internal sequencing for parallel pieces). A multi-surface mission is
split in ROADMAP.md into disjoint features, each its own framework as a sibling lane -
`frameworks/composition.md`.
