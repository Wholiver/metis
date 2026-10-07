---
name: apply
description: "Mechanically apply a fully specified change without design decisions."
category: any
tier: T0/T1
---

Root/child contract:
- Host/root owns admission, gates, and completion.
- T2: serial implementer lanes in shared cwd; do not fan out a recursive hierarchy.
- T3: spawn only admitted, dependency-ready implementer lanes with pairwise-disjoint owned paths and no shared mutable state.
- Children emit ChildResult: implement or check the assigned lane and emit one ChildResult JSON line. They do not call performance_gate and do not spawn nested workers.
- Stay on owned paths. Independent verification belongs to host/root (or a fresh named reviewer/verifier). A first draft is not completion.

# Native execution protocol: apply
# Framework: apply  (category any × subsection apply · no tag · tier T0/T1)

Stay on owned paths. Independent verify uses a different agent than the producer. Children emit one ChildResult; they do not spawn nested workers. Host/root owns gates. Goal: mechanically APPLY
a change whose WHAT is already FULLY specified - a frozen spec, an explicit
instruction ("rename X to Y everywhere"), a scaffold emission, a config change, a
dependency bump. There is NO design decision left and NOTHING to discover. This is the
PROPORTIONAL-GATES minimal path: no plan gate, no fresh-verify, no juror - just apply
the known change and prove it green.

GATE PATH: T0 closes APPLY → VERIFY inside the G4 receipt (no spawn, no separate G5/G6). T1 runs APPLY → independent DIFF-REVIEW (G5) → VERIFY-GREEN (G6). No G1 PLAN, no G7 SIGN-OFF.

## Root/child contract
- Stay on owned paths for the assigned lane.
- Independent review/verify uses a different agent than the producer. On T0 the mechanical check lives in the G4 receipt; on T1 G5/G6 are fresh workers. A first draft is not completion.
- Children emit one ChildResult JSON line; they do not call performance_gate and do not spawn nested workers.
- Host/root owns admission, gates, and completion. T2 serializes implementer lanes; T3 spawns only admitted disjoint implementers.


## THE END-TO-END WORKFLOW

### Phase 0 - ADMISSION CHECK (before APPLY) - falsifiable, not a vibe
The mission MUST literally carry an exact diff OR an explicit command/edit list you can
apply verbatim - point at it. If no such artifact is in hand, or any real decision
remains (what the shape should be, which option to pick, where a thing should live),
apply is INELIGIBLE → **S2** route to a heavier framework
(`frontend-build`/`docs`/`<category>-implement`/`plan-design`). Apply never self-declares "spec complete"; only
a named diff/command list admits it.

### Phase 1 - APPLY (G4-minimal)
Confirm the repo's OWN test command runs on untouched code first (else **S1
BLOCKED**). Then apply the specified change mechanically within owned files only -
the rename across all sites, the config edit, the dependency bump, the scaffold
emission - exactly as specified, nothing more. No refactor, no opportunistic cleanup,
no scope creep. On T0, record mechanical verification evidence in the G4 receipt and stop.

### Phase 2 - DIFF-REVIEW (T1 only - a fresh worker)
On T1, a fresh reviewer confirms the diff EQUALS the specified change: every specified edit
is present, no unspecified edit sneaked in, no site of the rename/change was missed.
A diff that adds or omits anything vs the spec is **S3 DIFF-MISMATCH** → redo. T0 skips this spawn.

### Phase 3 - VERIFY-GREEN (grounded)
On T0 the verify evidence is part of G4. On T1 a fresh worker runs on the REAL repo
(returns preExistingRegressions/testCommand): the repo's test suite
runs and the FULL pre-existing tests stay GREEN - ZERO green→red flips. For a change
that has its own assertion (a config value now in effect, a new dep importable),
prove that too. Pure mechanical apply asserts zero regressions — do not invent coverage metrics.
**REGRESSION-IS-A-SIGNAL:** any green→red flip means the "mechanical" change had a
real effect that broke something → this is no longer an apply; ESCALATE to a heavier
FRAMEWORK (**S4**), never weaken/skip.

## THE BLOCKED INVARIANT (non-negotiable)
Verification runs the REAL check in its REAL environment - NEVER fake a pass, NEVER
fabricate evidence, NEVER declare DONE over a red or un-runnable check. On ANY blocker,
STOP and report the attempt + the concrete unblock path. Children emit ChildResult and stop; host/root owns gates.

## Closed decision scenarios (each ends at ONE verdict)
- **S1 - real test suite cannot run** → BLOCKED (report attempt + unblock path).
- **S2 - the change is NOT fully specified (a real decision remains)** → wrong
  framework; route to `<category>-implement` / `plan-design`. Apply never guesses.
- **S3 - the diff does not equal the specified change** (extra or missing edits) →
  DIFF-MISMATCH; redo to match the spec exactly.
- **S4 - a pre-existing test flips green→red** → FAILED (regression-is-a-signal: the
  mechanical change had a real effect). It is NOT an apply anymore → ESCALATE to a
  heavier FRAMEWORK (`<category>-fix` for the regression, else `<category>-implement`),
  not merely a higher tier; never weaken/skip, never blindly redo inside `apply`.
- **S5 - diff equals the spec + zero regressions + green** → DONE.

## Stacking
One admitted lane. A multi-part mechanical change is split in ROADMAP.md into disjoint-ownership
apply features, each its own track - `frameworks/composition.md`.
