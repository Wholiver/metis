---
name: plan-scope
description: "Decompose complex mission into disjoint bounded lanes and roadmaps."
category: planning
tier: T1/T2
---

Root/child contract:
- Host/root owns admission, gates, and completion.
- T2: serial implementer lanes in shared cwd; do not fan out a recursive hierarchy.
- T3: spawn only admitted, dependency-ready implementer lanes with pairwise-disjoint owned paths and no shared mutable state.
- Children emit ChildResult: implement or check the assigned lane and emit one ChildResult JSON line. They do not call performance_gate and do not spawn nested workers.
- Stay on owned paths. Independent verification belongs to host/root (or a fresh named reviewer/verifier). A first draft is not completion.

# Native execution protocol: plan-scope
# Framework: plan-scope  (category plan × subsection scope · no tag · tier T2/T3)

Stay on owned paths. The first useful worker opens the real repository, classifies scope, and writes one executable `ROADMAP.md`. Independent verify uses a different agent than the producer. Children emit one ChildResult; they do not spawn nested workers. Host/root owns gates. Goal: turn a mission into a dependency-ordered feature roadmap that covers
the WHOLE deliverable at 100%. Also owns pure documentation output
(README/quickstart/onboarding). Owns no production code.

GATE PATH: bounded scope uses exactly 3 agents, 2 rounds: AUTHOR → REVIEW + FRESH-VERIFY(default-FAIL) → DONE. Multi-surface scope uses exactly 5 agents, 3 rounds: AUTHOR → TWO SCOUTS(concurrent) → REVIEW + FRESH-VERIFY(concurrent) → DONE. Unusually-large scope may add themed scouts or synthesis only with a concrete recorded escalation reason.

## Root/child contract
- Stay on owned paths for the assigned lane.
- Independent review/verify uses a different agent than the producer; a first draft is not completion.
- Children emit one ChildResult JSON line; they do not call performance_gate and do not spawn nested workers.
- Host/root owns admission, gates, and completion. T2 serializes implementer lanes; T3 spawns only admitted disjoint implementers.


## THE END-TO-END WORKFLOW

### Phase 1 - EXPAND to real ambition
Read the mission as intent, not literal minimum. If the target is UNKNOWN/needs
discovery → **S1** hand to `plan-research` first. Otherwise establish what a senior
owner would consider genuinely complete and ready-to-use for this deliverable.

### Phase 2 - AUTHOR one executable roadmap
The first useful worker inspects the real repository (preferring localized grep/find within relevant project subdirectories) and writes the complete roadmap:
repository intelligence, framework/tool decisions, feature boundaries, dependencies,
launch groups, integration lane, implementation steps, positive and unhappy-path
acceptance criteria, tests to write first, real verification, and the ≥95% changed-line
and touched-module coverage floor. It classifies the mission as bounded, multi-surface,
or unusually-large and records concrete evidence for any escalation.

### Phase 3 - ADD only justified repository intelligence
A bounded roadmap proceeds directly to assurance. Multi-surface scope dispatches exactly
two complementary scouts concurrently, retains their path/hash/byte evidence, and folds
their findings into the existing roadmap without a redundant synthesis worker. Only an
unusually-large classification with a concrete recorded reason may exceed six agents or
add a dedicated synthesizer.

### Phase 4 - REVIEW + FRESH-VERIFY (default-FAIL)
An independent reviewer + a blind fresh verifier run concurrently and confirm the roadmap
covers the whole deliverable end-to-end at 100% - a thin/MVP-stub scope, dropped aspect,
or time estimate is a REJECT (**S2**). A rejection names affected items; valid evidence
and accepted items survive targeted repair. On pass the roadmap is frozen and its features
become the build wave → **S5** DONE.

## THE BLOCKED INVARIANT (non-negotiable)
Verification runs the REAL check in its REAL environment - NEVER fake a pass, NEVER
fabricate evidence, NEVER declare DONE over a red or un-runnable check. On ANY blocker,
STOP and report the attempt + the concrete unblock path. Children emit ChildResult and stop; host/root owns gates.

## Closed decision scenarios (each ends at ONE verdict)
- **S1 - the target is UNKNOWN / needs discovery** → hand to `plan-research` before scoping.
- **S2 - the roadmap is a thin/MVP stub, drops an aspect, or carries time estimates**
  → REJECT; repair only the named roadmap items and retain accepted evidence.
- **S3 - an item needs a real architecture decision** → that item hands to `plan-design`;
  the rest proceeds.
- **S4 - pure documentation output** (README/quickstart/onboarding) → produce it here;
  verify it is accurate against the real artifact, not invented.
- **S5 - roadmap covers the whole deliverable end-to-end, dependency-ordered,
  review + fresh-verify PASS** → DONE.

## Stacking
ONE adaptive scope track. The approved roadmap feeds the build frameworks as downstream
tracks - `frameworks/composition.md`.
