---
name: frontend-fix
description: "Diagnose and fix UI/UX bugs, layout breaks, and client state issues."
category: frontend
tier: T1/T2
---

Root/child contract:
- Host/root owns admission, gates, and completion.
- T2: serial implementer lanes in shared cwd; do not fan out a recursive hierarchy.
- T3: spawn only admitted, dependency-ready implementer lanes with pairwise-disjoint owned paths and no shared mutable state.
- Children emit ChildResult: implement or check the assigned lane and emit one ChildResult JSON line. They do not call performance_gate and do not spawn nested workers.
- Stay on owned paths. Independent verification belongs to host/root (or a fresh named reviewer/verifier). A first draft is not completion.

# Native execution protocol: frontend-fix
# Framework: frontend-fix  (category frontend × subsection fix · tag debug · tier T1/T2)

Stay on owned paths. Independent verify uses a different agent than the producer. Children emit one ChildResult; they do not spawn nested workers. Host/root owns gates. Goal: the *correct*
root-cause fix to a broken UI/client behavior, proven on the RENDERED surface, with
zero regressions - not just "the repro stopped erroring".

GATE PATH (debug): G1 PLAN → G3.5 DEPTH-LOCK → G4 IMPLEMENT(TDD) → G5 IMPL-REVIEW → G6 VERIFY(grounded) → GOAL-CHECK. T2 adds a 1-juror SIGN-OFF after G6.

## Root/child contract
- Stay on owned paths for the assigned lane.
- Independent review/verify uses a different agent than the producer; a first draft is not completion.
- Children emit one ChildResult JSON line; they do not call performance_gate and do not spawn nested workers.
- Host/root owns admission, gates, and completion. T2 serializes implementer lanes; T3 spawns only admitted disjoint implementers.


## Gate path
Debug: G1 PLAN → G3.5 DEPTH-LOCK → G4 IMPLEMENT(TDD) → G5 IMPL-REVIEW →
G6 VERIFY(grounded) → GOAL-CHECK. T2 adds a 1-juror SIGN-OFF after G6.

## THE END-TO-END DEBUGGING WORKFLOW

### Phase 0 - GATE-ZERO: the project's REAL UI test/build setup runs
Find and run the project's own runner on untouched code - the real one
(Playwright/jest/vitest/cypress), or render the artifact via the dev server / a
build + curl/WebFetch against it. Report it executed. If it cannot run → **S1 BLOCKED**.
A UI bug is verified on a real render, never on a source read.

### Phase 1 - REPRODUCE: a captured RED on the RENDERED surface
Reproduce the broken behavior against the actual rendered UI (the state/route/
interaction that triggers it), capture the verbatim failure - the assertion, the
console error, the wrong DOM/visual state. That test is the regression test. If it
will not fail on unpatched code → **S2** (widen: viewport, data state, async timing).

### Phase 2 - ROOT-CAUSE, not symptom
- Scope search operations (`grep`, `find`) within specific subdirectories or relative project paths (e.g. '.', 'src/', 'test/') rather than full disk to keep execution fast.
- Trace from the visible symptom to the cause: which component/handler/selector/
  state transition is wrong, with file:line.
- Read the component's contract and its callers; enumerate the cause space - state
  management, props/data flow, async/effect timing & races, event handling, CSS/
  layout, accessibility tree, browser/viewport differences, empty/loading/error
  states, i18n. Name the true root and why it violates intended behavior.

### Phase 2.5 - DEPTH-LOCK (G3.5)
A fresh depth-prober derives the deepest-cause function from the issue text, blind to
the proposed fix layer, and proves an adversarial repro RED on unpatched code. A layer
mismatch or missing RED repro rejects to G1; never implement over a depth miss.

### Phase 3 - DESIGN THE CORRECT FIX
- **Honor framework & platform contracts.** Effect dependency arrays, key
  stability, controlled-vs-uncontrolled inputs, idempotent renders, event-handler
  identity, a11y roles/labels - a fix that ignores these passes one repro and
  breaks another render. Fix the contract, not the one symptom.
- **Cover every state, not just the reported one.** loading / empty / error /
  populated / overflow / mobile - the fix must be correct across them.
- **Root, not band-aid.** Prefer fixing the wrong state/flow over a one-off
  conditional that hides it for a single case.
- **Minimal, complete scope**, within owned files only.

### Phase 4 - IMPLEMENT (TDD)
Failing render-level repro first → the fix → green. Coverage to the mission's bar
(default 100% of the feature's surface) - ≥95% of changed lines is a floor, not the target.

### Phase 4.5 - IMPL-REVIEW (G5, fresh worker)
Compare the frozen plan and root-cause contract against the diff, render-level tests,
all UI states, accessibility behavior, and owned boundary. SMASH returns to G1/G4.

### Phase 5 - VERIFY EXHAUSTIVELY (G6, grounded, fresh worker)
On the REAL project (returns reproWasRed/reproNowGreen/preExistingRegressions/
testCommand): repro flips RED→GREEN on a real render; the full pre-existing tests
of touched modules + dependents stay GREEN; adversarial states (empty/error/mobile/
rapid interaction) behave; coverage ≥95%.
**REGRESSION-IS-A-SIGNAL:** any green→red flip means the fix is semantically wrong
(broke a contract another render relied on) → re-root-cause and redo (**S3**); never
weaken/skip the test.

### Phase 6 - NEIGHBORHOOD SWEEP
Same-class bugs in sibling components become `GATELOG.md` follow-up rows (P0/P1 re-enter). Then GOAL-CHECK
(default-FAIL) confirms the asks on opened evidence → **S5**.

## THE BLOCKED INVARIANT (non-negotiable)
Verification runs the REAL check in its REAL environment - NEVER fake a pass, NEVER
fabricate evidence, NEVER declare DONE over a red or un-runnable check. On ANY blocker,
STOP and report the attempt + the concrete unblock path. Children emit ChildResult and stop; host/root owns gates.

## Closed decision scenarios (each ends at ONE verdict)
- **S1 - real test/build setup cannot run** → BLOCKED (report attempt + unblock path).
- **S2 - behavior will not reproduce RED** → NOT-REPRODUCIBLE (widen once, then report).
- **S3 - a pre-existing test flips green→red** → FAILED (regression-is-a-signal: redo).
- **S4 - root cause outside the owned file/scope** → OUT-OF-SCOPE; climb a tier only when ownership splits into multiple surfaces (missing roadmap / step count / size never climbs).
- **S5 - repro GREEN + zero regressions + adversarial states pass + asks met** → DONE.

## Stacking
One admitted lane. A cross-surface task is split in ROADMAP.md into disjoint features, each
its own framework as a sibling lane - `frameworks/composition.md`.
