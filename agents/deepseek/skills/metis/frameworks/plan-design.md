---
name: plan-design
description: "System design, interfaces, tradeoffs, and structural planning."
category: planning
tier: T1/T2
---

Root/child contract:
- Host/root owns admission, gates, and completion.
- T2: serial implementer lanes in shared cwd; do not fan out a recursive hierarchy.
- T3: spawn only admitted, dependency-ready implementer lanes with pairwise-disjoint owned paths and no shared mutable state.
- Children emit ChildResult: implement or check the assigned lane and emit one ChildResult JSON line. They do not call performance_gate and do not spawn nested workers.
- Stay on owned paths. Independent verification belongs to host/root (or a fresh named reviewer/verifier). A first draft is not completion.

# Native execution protocol: plan-design
# Framework: plan-design  (category plan × subsection design · no tag · tier T2)

Stay on owned paths. Independent verify uses a different agent than the producer. Children emit one ChildResult; they do not spawn nested workers. Host/root owns gates. Goal: produce an architecture/design DECISION for a
KNOWN target - the buildable blueprint a build framework consumes. Owns no production code.

GATE PATH (T2): FRAME the decision → ENUMERATE options → DECIDE + write the BLUEPRINT → FRESH-VERIFY(default-FAIL) → DONE.

## Root/child contract
- Stay on owned paths for the assigned lane.
- Independent review/verify uses a different agent than the producer; a first draft is not completion.
- Children emit one ChildResult JSON line; they do not call performance_gate and do not spawn nested workers.
- Host/root owns admission, gates, and completion. T2 serializes implementer lanes; T3 spawns only admitted disjoint implementers.


## THE END-TO-END WORKFLOW

### Phase 1 - FRAME the decision
State the KNOWN target, its real constraints (performance, scale, compatibility,
team, deadline-independent quality bar), and the forks that must be decided for a
builder to proceed without guessing. If the target is actually UNKNOWN → **S1** hand
to `plan-research`. If it is really "build it now" not "decide it" → **S3** hand to
the matching build framework.

### Phase 2 - ENUMERATE options honestly
For each fork, lay out the genuine options with their real tradeoffs (not a straw-man
+ a favorite). Look at the actual code/system the design must fit; cite how each
option interacts with existing seams.

### Phase 3 - DECIDE + write the BLUEPRINT
Pick each option with a stated reason. Emit a buildable blueprint: the interfaces,
the data flow, the seams, the error/edge behavior, and - explicitly - every fork
RESOLVED. No "TBD", no "decide at build time" on a load-bearing choice.

### Phase 4 - FRESH-VERIFY (default-FAIL)
A fresh agent confirms the blueprint actually DECIDES every fork (no hand-waving)
and is buildable as written → **S5** DONE.

## THE BLOCKED INVARIANT (non-negotiable)
Verification runs the REAL check in its REAL environment - NEVER fake a pass, NEVER
fabricate evidence, NEVER declare DONE over a red or un-runnable check. On ANY blocker,
STOP and report the attempt + the concrete unblock path. Children emit ChildResult and stop; host/root owns gates.

## Closed decision scenarios (each ends at ONE verdict)
- **S1 - the target is actually UNKNOWN** → hand to `plan-research`; never invent a
  target to design against.
- **S2 - a load-bearing fork is left undecided** → REJECT; re-dispatch DESIGN to close it.
- **S3 - the work is really to BUILD now** → hand to the matching build framework with
  this blueprint as input.
- **S4 - it spans many features needing ordering** → hand to `plan-scope`.
- **S5 - every fork decided with tradeoffs + buildable + fresh-verify PASS** → DONE.

## Stacking
One admitted lane. Typical flow: `plan-design` produces the blueprint, then a build
framework consumes it as a sequenced track - `frameworks/composition.md`.
