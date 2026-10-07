---
name: frontend-review
description: "Visual, accessibility, performance, and code quality review for UI."
category: frontend
tier: T1/T2
---

Root/child contract:
- Host/root owns admission, gates, and completion.
- T2: serial implementer lanes in shared cwd; do not fan out a recursive hierarchy.
- T3: spawn only admitted, dependency-ready implementer lanes with pairwise-disjoint owned paths and no shared mutable state.
- Children emit ChildResult: implement or check the assigned lane and emit one ChildResult JSON line. They do not call performance_gate and do not spawn nested workers.
- Stay on owned paths. Independent verification belongs to host/root (or a fresh named reviewer/verifier). A first draft is not completion.

# Native execution protocol: frontend-review
# Framework: frontend-review  (category frontend × subsection review · tag user-facing · tier T1/T2/T3)

Stay on owned paths. Independent verify uses a different agent than the producer. Children emit one ChildResult; they do not spawn nested workers. Host/root owns gates. Goal: subject a RUNNING
UI to a multi-persona live review - real users visiting the real site, capturing
screenshots, and reporting bugs, visual defects, UX friction, copy problems, and
customer-engagement/conversion observations - into ONE deduped review artifact whose
actionable P0/P1s route back as fix lanes.

GATE PATH (T2): G0 SURFACE-PROBE → G1 PLAN(personas + journeys) → PERSONA-FANOUT(N live visits, screenshots) → DEDUPE(one artifact) → G6 REVIEW-VERIFY(grounded) → ROUTE-FIXES → GOAL-CHECK. T1 drops the juror; T3 adds SCOPE-AND-ROADMAP + 3-juror sign-off.

## Root/child contract
- Stay on owned paths for the assigned lane.
- Independent review/verify uses a different agent than the producer; a first draft is not completion.
- Children emit one ChildResult JSON line; they do not call performance_gate and do not spawn nested workers.
- Host/root owns admission, gates, and completion. T2 serializes implementer lanes; T3 spawns only admitted disjoint implementers.


## THE END-TO-END WORKFLOW

### Phase 0 - SURFACE-PROBE (GATE-ZERO): prove a RUNNING surface + browser tooling
PROBE, do not assume. Find how the app runs (dev server / preview build) and what
browser tooling exists - Playwright MCP, or `npx playwright` if the project has it,
or a headless driver already wired. Confirm a real user agent can load a real route
and take a real screenshot on the UNTOUCHED app. If a running surface exists AND a
browser is available → live review. If a surface runs but NO browser is available →
**S1-DEGRADE** static walkthrough (below), never a faked screenshot. If nothing
renders at all and none can be stood up → **S1 BLOCKED**.

### Phase 1 - PLAN the personas + journeys (G1)
Pick N distinct personas that stress different truths of the surface - first-time
visitor, power user, mobile user, skeptical buyer, accessibility-dependent user (add
domain-specific ones the mission implies). For each, name the real user journey
(entry → key screens → the conversion/goal action) they will actually walk. One
bounded surface - a whole product audit across unrelated apps is **S4**.

### Phase 2 - PERSONA-FANOUT: N live visits (each a fresh worker)
Assign one worker per persona. Each VISITS the running app in character, navigates its
journey, and CAPTURES A SCREENSHOT AT EACH STEP. Each reports, with the screenshot as
evidence and a severity (P0/P1/P2/P3): bugs and broken behavior; visual defects
(layout, spacing, contrast, overflow, broken images); UX friction (dead ends,
confusing flows, missing states); copy problems (unclear, wrong, off-tone); and
conversion / customer-engagement observations (where trust drops, where the CTA is
weak, where a real buyer would bounce) - plus a concrete improvement suggestion per
finding. A persona that only read source and took no screenshot did NOT review → redo.

### Phase 3 - DEDUPE into ONE review artifact
The deduper merges all persona reports into a single artifact: findings deduped
(same defect seen by 3 personas = one entry, personas noted), severity-ranked, each
with its screenshot evidence and improvement suggestion. Nothing a persona surfaced
is silently dropped. Customer-engagement observations get their own section.

### Phase 4 - REVIEW-VERIFY (G6, grounded, fresh worker)
A fresh worker confirms, on the REAL running surface, that each P0/P1 reproduces as
described (loads the route, sees the defect) and that every finding carries real
screenshot evidence - not a prose claim. A finding that cannot be reproduced on the
live surface is downgraded or dropped; an artifact with invented/unreproducible
findings is a THIN-REVIEW **S2** redo.

### Phase 5 - ROUTE-FIXES + GOAL-CHECK
Each actionable P0/P1 is emitted as a fix lane (a `frontend-fix` feature per defect,
or `frontend-implement`/`polish` for improvements) into the run's build wave; P2/P3
are appended as non-blocking follow-up rows in `GATELOG.md`. A fresh default-FAIL goal-check confirms every persona journey was
walked with screenshots and every finding is evidence-backed → **S5** DONE.

## GRACEFUL DEGRADATION (mandatory - never fake a screenshot)
No browser available → **S1-DEGRADE**: personas do a STATIC walkthrough of the
routes/components/styles (read the route tree, component states, copy strings, CSS)
and report the SAME finding shape, but EVERY such finding is explicitly marked
**UNVERIFIED-VISUALLY**. Never emit a fabricated screenshot, never claim a visual was
seen that was not. The artifact states up front that it ran degraded and which
findings are unverified.

## THE BLOCKED INVARIANT (non-negotiable)
Verification runs the REAL check in its REAL environment - NEVER fake a pass, NEVER
fabricate evidence, NEVER declare DONE over a red or un-runnable check. On ANY blocker,
STOP and report the attempt + the concrete unblock path. Children emit ChildResult and stop; host/root owns gates.

## Closed decision scenarios (each ends at ONE verdict)
- **S1 - no running surface can be stood up at all** → BLOCKED (report attempt + unblock path).
  **S1-DEGRADE - surface renders but no browser tooling** → static walkthrough, every
  finding marked UNVERIFIED-VISUALLY; never a faked screenshot.
- **S2 - the review is thin / findings don't reproduce on the live surface** → THIN-REVIEW;
  re-dispatch personas with the gap named. Never invent findings.
- **S3 - a P0 found is really a code bug to fix now** → route it as a `frontend-fix`
  lane; the review proceeds and completes.
- **S4 - bigger than ONE bounded surface** (unrelated apps / a whole product audit) →
  OUT-OF-SCOPE; climb a tier only when ownership splits into multiple surfaces (GATES.md ESCALATION; missing roadmap / step count / size never climbs).
- **S5 - every persona journey walked with screenshots + one deduped evidence-backed
  artifact + P0/P1s routed + goal-check PASS** → DONE.

## Stacking
One admitted lane (internal sequencing is the persona set). The fix lanes it emits become
downstream sibling lanes - `frameworks/composition.md`.
