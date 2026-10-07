---
name: composition
description: "Multi-module architecture, service wiring, and cross-cutting concerns."
category: architecture
tier: T2/T3
---

Root/child contract:
- Host/root owns admission, gates, and completion.
- T2: serial implementer lanes in shared cwd; do not fan out a recursive hierarchy.
- T3: spawn only admitted, dependency-ready implementer lanes with pairwise-disjoint owned paths and no shared mutable state.
- Children emit ChildResult: implement or check the assigned lane and emit one ChildResult JSON line. They do not call performance_gate and do not spawn nested workers.
- Stay on owned paths. Independent verification belongs to host/root (or a fresh named reviewer/verifier). A first draft is not completion.

# Native execution protocol: composition
# How frameworks COMPOSE (stack and run simultaneously)

Host/root owns multi-lane composition. Spawn only admitted disjoint implementer lanes. Children emit ChildResult; they do not spawn nested workers. It adds NO new scheduler/gate/level. Use the existing admission split, per-lane sequencing, TOKENSAVER/BILLIONAIRE modes, and the run-global budget (cited by name, never restated).

## Two modes
- **HORIZONTAL STACK - N frameworks, simultaneous.** A task spanning disjoint
  surfaces is split into N disjoint-ownership sub-tasks; the README §3 selector
  runs once per sub-task → N frameworks, each becomes one admitted implementer lane.
  WIDE runs them parallel (no per-lane numeric cap, bounded by MAX_CONCURRENT);
  TOKENSAVER in a small ≤6 wave.
- **VERTICAL LAYER - one track + an overlay.** A single track's primary framework
  may carry ONE playbook-tag overlay (`debug`/`research`/`user-facing`/`polish`/
  `external-target` - never a category). The overlay reshapes only its tag's gate
  (G1/G6 for most; **G7** for `polish`). The `polish` pass is also a standalone leaf
  (`frameworks/polish.md`) when it is the whole task; as an overlay it applies that
  leaf's G7 sign-off gate over another track. Same gates run, same single track.

## The algorithm (host/root runs this - zero judgment)
1. **DECOMPOSE** the task from the executable `ROADMAP.md` into atomic sub-tasks,
   each with a SINGLE owned-file-set and no file in two sets. One sub-task → **S5**.
2. **SELECT** per sub-task: run README §3 once each → a STACK = list of
   `(framework, owned-file-set)`. A sub-task that returns `FRAMEWORK: MISS` (no confident
   seeded match) routes to the GENERATOR (`frameworks/generation.md`,
   HRN-1→HRN-4): a novel sub-surface stacks a GENERATED `gen-<axis-signature>` sibling
   leaf - never a silent backend-implement. A cross-cutting CONCERN outside the closed 5
   playbook tags is handled by a tiny `gen-overlay-<concern>` (a VERTICAL layer reshaping
   only G1/G6/G7, validated by `validateOverlay`), not a new category track.
3. **CHECK DISJOINTNESS:** every pairwise file-set intersection is empty. Any
   overlap → **S1**.
4. **MOUNT:** the host/root builds one host→implementer handoff per row and dispatches each
   as a sibling lane (mission verbatim + nonce + that framework). Over budget → **S4**.

## The invariant (deterministic)
Two frameworks STACK only if their owned file sets are DISJOINT. Empty intersection
→ mount. Overlap → the host/root re-splits; if they can't be made disjoint they
are ONE feature/one track, not two. A parallel WRITE to a shared file is NEVER
permitted.

## Worked examples
- **Horizontal - "fix the backend bug AND polish the landing page":** decompose →
  A=`src/api/orders.py` (→ `backend-fix`), B=`web/landing/*` (→ `frontend-implement`
  + `polish` overlay, `frameworks/polish.md`). Disjoint → two sibling lanes; parallel in BILLIONAIRE.
- **Vertical - "build a new landing flow, polished":** one owned-file-set → one
  track = `frontend-build` + `polish` overlay (the overlay adds the `frameworks/polish.md`
  G7 judge loop). One track, not a stack.

## Closed scenarios (each → ONE action)
- **S1 - two frameworks share a file** → host/root re-splits to disjoint, else COLLAPSE to
  one track. Never a parallel write to a shared file.
- **S2 - a "sub-task" is really two** → decompose further before selecting.
- **S3 - an overlay would be a CATEGORY, not a tag** → reject; route it as its own
  sibling lane (a category is a track, never a vertical layer).
- **S4 - the stack exceeds the run-global budget** (GATES.md "RUN-GLOBAL SUBAGENT
  BUDGET"; max-concurrent base 200) → queue/serialize the overflow; never spawn past
  the ceiling.
- **S5 - one sub-task (degenerate)** → no stack; One admitted lane (a vertical overlay
  may still apply).
- **S6 - two tracks have a gate-order dependency** → serialize by the edge; only
  independent tracks run in parallel.

## Alignment (point at, don't restate)
GATES.md "FAN-OUT IS THE EXCEPTION" (composition is the MANAGER dispatching sibling
tracks, never a child spawning nested workers) + "RUN-GLOBAL SUBAGENT BUDGET"; MODES.md Axis 1/2 +
max-concurrent; PLAYBOOKS.md host→implementer split + playbook tags; README §3.
