# Metis Quality Gates Contract (G0 - G7)

Generated from `contracts/gates.json`. Roles must match Performance runtime gate closers.

Every Metis workflow executes across defined quality gates. Bypassing gates or claiming unearned completion is prohibited.

## Gate Definitions

### G0: Characterize
- **Stage**: characterize
- **Role**: implementer
- **Standard**: Pin current observable behavior with characterization tests on untouched code before refactoring. On T1, root may close this gate without spawning.

### G1: Plan
- **Stage**: plan
- **Role**: planner
- **Standard**: Inspect real repository; produce success criteria, file-by-file changes, unhappy paths at happy-path detail, and a verification strategy matching the deliverable (strict TDD + coverage argument for code-behavior work; structural/visual/docs oracle otherwise). On T1, root may close this gate without spawning.

### G2: Roadmap Acceptance
- **Stage**: roadmap
- **Role**: scope-coordinator
- **Standard**: Accept canonical executable ROADMAP.md before dispatching build lanes. Alternate closer: scoper. Follow-on G2-review uses reviewer; G2-verify uses fresh-verifier. On T2/T3, root closes this gate because scope-coordinator is not in the spawn allowlist.

### G3.5: Defect Depth-Lock
- **Stage**: depth-lock
- **Role**: depth-prober
- **Standard**: Derive deepest-cause function from issue text alone, blind to proposed fix; require adversarial RED reproduction test on unpatched code. On T1, root closes this gate (depth-prober is not in T1 spawn allowlist).

### G4: Implement
- **Stage**: implement
- **Role**: implementer
- **Standard**: Implement within owned boundaries. Code-behavior frameworks use strict TDD (failing test first, minimal code to green, coverage >=95% on changed lines). Visual/structure, docs, and mechanical-apply work use their declared oracle instead of inventing coverage metrics. On T0/T1, root closes G4.

### G5: Review
- **Stage**: review
- **Role**: reviewer
- **Standard**: Independent claim-vs-diff verification; reject unbacked claims, stubbed code, regressions, or scope creep; binary PASS or SMASH.

### G6: Verify
- **Stage**: verify
- **Role**: verifier
- **Standard**: Grounded verification on real runners or renders. Code-behavior work: prove RED->GREEN, pre-existing tests stay GREEN, measured coverage >=95%. Visual/structure, docs accuracy, and mechanical-apply work: prove the declared oracle with real command/render evidence — do not invent coverage. Alternate closer: fresh-verifier.

### G7: Sign-off
- **Stage**: sign-off
- **Role**: juror
- **Standard**: Independent juror shipping readiness sign-off. Alternate closer: arbiter. T3 does not spawn jurors.

### sweep: Neighborhood Sweep
- **Stage**: sweep
- **Role**: sweeper
- **Standard**: Scan adjacent files and components for same-class defects.

### goal-check: Goal Check
- **Stage**: goal-check
- **Role**: goal-checker
- **Standard**: Independent adversarial verification re-deriving all asks from original mission; DONE requires 0 open findings and usability verified. Coverage >=95% applies only when the admitted framework's oracle is code-behavior TDD. On T3, root closes goal-check (goal-checker is not in T3 spawn allowlist).

---

## Compiled State-Machine Execution Graphs

### Leaf Nodes (States)
- `characterize` (G0): implementer pins untouched behavior; on T1 root may close.
- `plan` (G1): planner produces grounded plan; on T1 root may close.
- `roadmap` (G2): canonical closer is scope-coordinator (or scoper); G2-review=`reviewer`, G2-verify=`fresh-verifier`. On T2/T3 root closes because scope-coordinator is not in the spawn allowlist.
- `depth-lock` (G3.5): depth-prober proves adversarial RED repro; on T1 root closes (not spawnable).
- `implement` (G4): implementer TDD within owned boundaries; on T0/T1 root closes.
- `review` (G5): reviewer claim-vs-diff audit.
- `verify` (G6): verifier/fresh-verifier grounded execution.
- `sign-off` (G7): juror shipping acceptance (T2 only; T3 does not spawn jurors).
- `sweep`: sweeper neighborhood scan (T3).
- `goal-check`: goal-checker on T2; root closes on T3 (goal-checker not in T3 allowlist).

### Graph Transitions (Edges)
- `G2` -> lane work [after roadmap acceptance on T2/T3]
- `G0` -> `G1` or `G4` [on CHARACTERIZED]
- `G1` -> `G3.5` [on debug / `*-fix`] else `G4`
- `G3.5` -> `G4` [on DEPTH_LOCKED & RED_PROVEN]; `G3.5` -> `G1` [on DEPTH_MISS & retry <= 2]
- `G4` -> complete [T0 with evidence in G4 receipt]
- `G4` -> `G5` -> `G6` [T1]; then complete (no juror / goal-check)
- `G2` -> `G4` -> `G5` -> `G6` -> `G7` -> `goal-check` [T2]
- `G2` -> parallel `G4` -> `G5` -> `G6` -> `sweep` -> root `goal-check` [T3; no juror]
- Negative verdicts backtrack to `G4` (or `G1` for architectural / depth miss) with max 2 repairs.

### Max Transitions Budget (Anti-Runaway)
- `T0 (Mechanical Apply)`: 6 transitions max
- `T1 (Bounded Feature)`: 12 transitions max
- `debug (Defect Repair)`: 16 transitions max
- `T2 (Serial Multi-Surface Feature)`: 24 transitions max
- `T3 (Multi-Surface Fleet)`: 40 transitions max

---

## Bounded Recovery Protocol & Failure Fingerprints

Infinite repair loops are mechanically prevented:
1. **Maximum 2 Repairs**: On gate rejection (SMASH, REGRESSION, DEPTH_MISS), a maximum of 2 repair attempts is permitted.
2. **Failure Fingerprint**: Each rejection generates a fingerprint `${gateId}:${failureCode}:${targetFileOrSymbol}`.
3. **Progress Invariant**: If after repair `nextFingerprint === lastFingerprint`, execution must HALT immediately with `BLOCKED: NO_PROGRESS_FINGERPRINT`.
4. **Concrete Escalation**: The agent reports the exact attempt, verbatim error, and concrete unblock action rather than hallucinating success or looping.
