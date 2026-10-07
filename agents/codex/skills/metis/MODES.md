# Metis Work Structures & Routes

Generated from `contracts/routes.json`. There is no fallback or unmanaged route.

## fast-path (Conversational Fast-Path)
- Description: Direct textual answer for greetings, explanations, questions, and non-mutating requests; no subagent dispatch.
- Sequence: (none)
- Notes: Root session answers directly. No gates, no roles.
- path= mapping: n/a (conversational)

## T0 (Mechanical Apply)
- Description: Mechanically apply a fully specified change without design decisions. Root closes G4 with independent evidence in the G4 receipt.
- Sequence: G4
- Notes: Skip G5/G6/G7 and goal-check. Evidence lives in the G4 receipt. Root closes G4; no spawn.
- path= mapping: direct

## T1 (Bounded TDD Feature/Fix)
- Description: Exactly one ownership surface: root implements G4, then fresh G5 review and G6 verification. Many steps or files inside that one surface stay T1.
- Sequence: G4 -> G5 -> G6
- Notes: Spawn only reviewer and verifier/fresh-verifier. No juror, no goal-check. Debug inserts G0/G1/G3.5 closed by root before G4. Step count, file count, difficulty, or wanting more agents never raises this to T2/T3.
- path= mapping: light

## T2 (Serial Multi-Surface Feature)
- Description: At least two ownership surfaces that must run serially (shared mutable state, overlapping paths, or ordered dependencies), then independent review/verify, one juror, and goal-check.
- Sequence: G2 -> G4 -> G5 -> G6 -> G7 -> goal-check
- Notes: Requires ≥2 lanes. One lane is never T2. G2 closed by root (scope-coordinator is not in the T2 spawn allowlist). Conditional G1 planner for design forks. Debug may spawn depth-prober for G3.5. After G6: one juror, then goal-checker.
- path= mapping: roadmap

## T3 (Multi-Surface Fleet)
- Description: At least two pairwise-disjoint ownership surfaces with no shared mutable state that can run in parallel, then integrated G5/G6, sweep, and root goal-check.
- Sequence: G2 -> G4 -> G5 -> G6 -> sweep -> goal-check
- Notes: G2 executed by root. Implementer lanes are workspace directories with non-overlapping owned paths; a missing directory is not a lane. Overlap or shared mutable state downgrades to T2; a single surface downgrades to T1. wide changes the batch cap, not the lane count. Then reviewer, verifier, sweeper. goal-check executed by root. No planner, juror, or goal-checker spawn.
- path= mapping: roadmap

## debug (Defect Repair Overlay)
- Description: Root-cause bug fix overlay: G0 characterize, G1 plan, G3.5 depth-lock before implementation on the selected tier.
- Sequence: G0 -> G1 -> G3.5
- Notes: Inserted before the selected tier's G4. On T1 and T3 these gates are closed by root. On T2, G3.5 may be closed by depth-prober; G7 + goal-check follow G6.
- path= mapping: overlay on selected tier

## Concurrency controls
- `tokensaver`: at most 6 ready independent implementer lanes at once (T3).
- `wide`: start every ready independent lane up to the host limit.
- `custom --max-subs N`: cap parallel implementer lanes at N.
- Non-implementer gates always run serially.
