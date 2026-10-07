---
name: refactor
description: "Restructure existing code safely with invariant protection."
category: refactoring
tier: T1/T2
---

Root/child contract:
- Host/root owns admission, gates, and completion.
- T2: serial implementer lanes in shared cwd; do not fan out a recursive hierarchy.
- T3: spawn only admitted, dependency-ready implementer lanes with pairwise-disjoint owned paths and no shared mutable state.
- Children emit ChildResult: implement or check the assigned lane and emit one ChildResult JSON line. They do not call performance_gate and do not spawn nested workers.
- Stay on owned paths. Independent verification belongs to host/root (or a fresh named reviewer/verifier). A first draft is not completion.

# Native execution protocol: refactor
# Framework: refactor  (category backend/frontend × subsection refactor · no tag · tier T1/T2)

Stay on owned paths. Independent verify uses a different agent than the producer. Children emit one ChildResult; they do not spawn nested workers. Host/root owns gates. Goal: behavior-preserving
restructuring - reshape the code, remove dead code, improve the seams - with PROVEN
zero behavior change. Not a fix (no bug is being corrected), not an implement (no new
capability is being added). If behavior must change, this is the wrong framework.

GATE PATH (T1/T2): G0 CHARACTERIZE(pin current behavior) → G4 IMPLEMENT(reshape under the pinned tests) → G5 IMPL-REVIEW(zero behavior delta) → G6 VERIFY(grounded, characterization + full suite GREEN) → GOAL-CHECK. An implementation-ready executable roadmap item goes directly from characterization to G4. G1 is conditional only for a named unresolved reshape fork, `requiresDetailedPlan: true`, or implementer-reported PLAN-CONFLICT. Both tiers retain independent review and verification.

## Root/child contract
- Stay on owned paths for the assigned lane.
- Independent review/verify uses a different agent than the producer; a first draft is not completion.
- Children emit one ChildResult JSON line; they do not call performance_gate and do not spawn nested workers.
- Host/root owns admission, gates, and completion. T2 serializes implementer lanes; T3 spawns only admitted disjoint implementers.


## THE END-TO-END WORKFLOW

### Phase 0 - GATE-ZERO + CHARACTERIZE: pin the CURRENT behavior first
Confirm the repo's OWN test command runs on untouched code (else **S1 BLOCKED**).
Then write CHARACTERIZATION tests that capture the current observable behavior of the
code to be reshaped - including the quirks, before touching anything. These tests must
pass GREEN on the UNTOUCHED code (they describe what IS, not what should be). This is
the safety net; a refactor without a characterization net is flying blind → not
allowed. If current behavior cannot be pinned (untestable seam) → widen the net or
**S1**.

### Conditional PLAN the reshape (G1)
Run only for a named unresolved reshape fork, `requiresDetailedPlan: true`, or
implementer-reported PLAN-CONFLICT. Resolve the named structural choice file-by-file
while keeping the observable contract identical. Otherwise the executable roadmap
already supplies the reshape and dispatch proceeds from characterization directly to
G4. If the plan smuggles a behavior change, it is the wrong framework → **S3**.

### Phase 1 - IMPLEMENT the reshape (G4, under the pinned net)
Reshape within owned files only, keeping the characterization tests GREEN at every
step. Remove the enumerated dead code. Do NOT change observable behavior; do NOT add
tests for new behavior (there is none). Coverage to the mission's bar (default 100% of
the feature's surface) - ≥95% of changed lines is a floor, not the target.

### Phase 3 - IMPL-REVIEW (G5, fresh worker)
Claims vs diff; the reshape matches the plan; the characterization tests are UNCHANGED
(a modified characterization test is a red flag - it means behavior changed → SMASH);
dead code actually removed; no scope creep, no smuggled behavior change.

### Phase 4 - VERIFY ZERO BEHAVIOR CHANGE (G6, grounded, fresh worker)
On the REAL repo (returns reproWasRed/reproNowGreen/preExistingRegressions/
testCommand): every characterization test stays GREEN (unchanged); the FULL
pre-existing tests of touched modules + dependents stay GREEN - ZERO green→red flips;
coverage ≥95% on changed lines.
**REGRESSION-IS-A-SIGNAL:** here a green→red flip is the whole point of the net - it
proves behavior CHANGED, which a refactor must not do → root-cause and redo (**S2**);
never weaken/skip/rewrite the characterization test to make it pass.

### Phase 5 - GOAL-CHECK → **S5** DONE
A fresh default-FAIL goal-check confirms the structure improved, the dead code is
gone, and behavior is provably identical (characterization + suite GREEN) → DONE.

## THE BLOCKED INVARIANT (non-negotiable)
Verification runs the REAL check in its REAL environment - NEVER fake a pass, NEVER
fabricate evidence, NEVER declare DONE over a red or un-runnable check. On ANY blocker,
STOP and report the attempt + the concrete unblock path. Children emit ChildResult and stop; host/root owns gates.

## Closed decision scenarios (each ends at ONE verdict)
- **S1 - real test suite cannot run OR current behavior cannot be pinned** → BLOCKED
  (report attempt + unblock path).
- **S2 - a characterization or pre-existing test flips green→red** → BEHAVIOR-CHANGED;
  the reshape altered behavior → root-cause and redo. Never rewrite the test to pass.
- **S3 - the task actually needs a behavior change** (a fix or a new capability) →
  wrong framework: route to `<category>-fix` / `<category>-implement`.
- **S4 - the reshape spans subsystems beyond the owned scope** → OUT-OF-SCOPE; climb a tier only when ownership splits into multiple surfaces (GATES.md ESCALATION; missing roadmap / step count / size never climbs).
- **S5 - structure improved + dead code removed + characterization & suite GREEN +
  zero behavior change** → DONE.

## Stacking
One admitted lane. A cross-surface refactor is split in ROADMAP.md into disjoint-ownership
features, each its own refactor track - `frameworks/composition.md`.
