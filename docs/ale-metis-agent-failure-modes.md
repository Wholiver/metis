# Metis agent failure modes (ALE Docker r2)

Handoff for agents changing Metis harness behavior. Evidence is from official ALE `ale_run` traces on experiment `metis_ale_docker_official_99_r2` (MetisDeployer, `openai-codex` / `gpt-5.6-luna` / `thinking=low`, `collaboration_mode: build`).

## Out of scope

Do not treat these as Metis bugs to fix in this workstream:

- Host CPU/RAM/shm caps, Docker Hub/HF network, VPN, Codex OAuth expiry
- Official evaluator host packages, sumo `+x` bits, MPC verifier parse bugs
- Missing domain binaries in the ALE image (EnergyPlus, openslide, InterProScan, matRad, …)
- Task-data staging / adapter path mapping (verified: `eval_status=success` received agent `output/`)

If a tool or library is missing, the Metis defect is **how the agent reacts**, not the missing package.

## Goal

Raise end-to-end ALE artifact quality: exact output contract, no fake completion, less governance overhead before real work.

Observed r2 completed zeros (n=32): 27 wrote files that failed the hidden grader, 3 polluted `output/` with venv/runtime, 2 left `output/` empty. Perfect scores exist (`internal_employee_agent_instance_1`, `os_log_permission_guard_v1`, `replicate_paper_1`), so the scoring path is not the bottleneck.

## Failure modes (agent-owned)

### 1. Performance-governance default on every long task

**Symptom.** Session text is dominated by 范围代理 / ROADMAP / G2 assurance / 盲验证 / 执行协调器. Spawn appears on ~96/98 tasks. `MAX_CHILDREN_EXCEEDED` on ~13 tasks (`DEFAULT_MAX_CHILDREN_PER_AGENT = 8` in `src/core/spawn-guard.ts`).

**Why it hurts.** The model spends turns coordinating personas instead of reading the task contract, running the real pipeline, and checking the required files. Child workers then fail with “mission pointer / RUN-MARKER / isolated env” and the parent fabricates an `output/` that looks complete.

**Code that teaches this.**

- `src/core/system-prompt.ts` `DEFAULT_BASE_INSTRUCTIONS` (T2/T3 → spawn; TDD/governance doctrine)
- `src/core/agent-definition.ts` coordinator / scope-coordinator / feature-coordinator prompts (ROADMAP, GATELOG, `performance_gate`)
- `src/core/performance-runtime.ts` (G0–G7, ROADMAP.md, GATELOG.md)
- ALE preset `adapters/ale_official/metis.yaml` `collaboration_mode: build` (does not disable performance-mode personas)

**Fix direction.** ALE / headless / one-shot deliverable runs should default to T0/T1: parent uses bash/read/write only. Spawn only for disjoint CPU-bound subjobs with an explicit file contract. Admission must treat “produce files for a hidden grader” as T1, not T2.

### 2. Fake-complete: contract-shaped files after a failed run

**Symptom.** Agent `exit_code=0`, filenames match the prompt, hidden `evaluate()` returns 0. The model’s own last message often admits the real check failed.

Evidence:

| Task | Agent said | What it submitted |
| --- | --- | --- |
| `computing_math/mp_checkpoint_consolidation_v2` | reference logits max error ~32.76 | `model.safetensors` anyway |
| `life_sciences/hg002_chr22_germline_variant_pipeline` | 主线被工具缺失与占位流程阻断 | 40 files under `submission/` |
| `business_finance/basel_operational_risk_bia_cn` | 执行协调器未能提供可审计实现 | three required files already in `output/` |
| `computing_math/go_game_reconstruction_1` | reconstructed SGF | wrong board/identity vs grader |
| `health_medicine/simglucose_safe_basal_control_instance_1` | 全量评测超时 | `controller.py` + metadata, missing required `report.md` |

**Fix direction.** Completion must be gated on the task’s stated checks (schema, self-metrics, public evaluator scripts in `input/` / `software/`), not on “files exist”. If a check fails, keep working or stop with a non-success agent status; do not write placeholders. Ban claiming verification from row counts / column names when the task names a numeric tolerance.

### 3. `output/` is a workspace dump, not a submission

**Symptom.** Hidden graders expect a small closed set of artifacts. Metis writes venv, uv cache, runtime, `__pycache__`, or raw downloads into the same directory ALE collects.

Evidence:

- `life_sciences/rgi_mcr1_colistin_v2`: 1345 files, `.venv/` at output root
- `life_sciences/cell_translocation_analysis`: ~14k files including `.venv` (real CSVs/json also present)
- `life_sciences/spatial_transcriptomics_spatial_domain_identification`: `.venv` beside `manifest.json`
- `computing_math/particle_filter_nonlinear_tracking`: `.agent_runtime*` mixed with npz
- `health_medicine/limited_angle_ct_dps_reconstruction`: `.runtime/` venv next to `reconstruction.npy`
- `health_medicine/healthcare_tcga_luad_survival_kras`: truncated GDC `tar.gz` instead of `cohort.csv` / `cox_results.json`

**Fix direction.** Treat `REMOTE_OUTPUT_DIR` / task `output/` as a publish directory: only files named in the prompt. Create venvs under `/tmp` or `work/`, never under `output/`. After the last write, list `output/` and delete anything not in the contract. Headless deployer can enforce this even if the model forgets.

### 4. Isolated child workspaces break the only environment that matters

**Symptom.** Children report missing scipy / pytest / task pointer / `performance-mode-RUN-MARKER`. Parent then “directly implements” in the real tree, often without re-running the child’s failed command.

**Why it is a harness issue.** `spawn_agent` supports `worktree` isolation (`src/core/tools/spawn_agent.ts`, `src/core/worktree.ts`). Child prompts in `agent-definition.ts` require RUN-MARKER and mission pointer. On ALE the mission is the staged task prompt + `output/` contract, not a git ROADMAP. Isolation drops the task venv and `software/` wrappers.

**Fix direction.** Default spawn on ALE to parent cwd, no worktree. Child prompt must receive absolute `input/`, `output/`, `software/` paths. If a child cannot see those paths, the spawn should fail closed, not invite the parent to invent files.

### 5. Weak self-check vs hidden grader

**Symptom.** Models announce “验证通过：N 行、列齐全、目录仅此文件”. Grader still zeros: `ff5_public_reconstruction`, `crf_sdtm_mapping_1`, `obermeyer_bias_reproduction`, `ising_post_measurement_1` (arrays present, values wrong).

**Fix direction.** System/tooling should prefer: run any bundled `scripts/verify_*.py` or public checks in the task folder; compare hashes/metrics the prompt names; never equate “parseable output” with score. Optional: a submit-time tool `assert_output_contract(files[], forbidden_globs=[".venv/**", ".uv-cache/**"])`.

### 6. Prompt stack fights the benchmark

ALE tasks are long-horizon professional workflows with a **file contract and hidden tests**. Metis default instructions optimize for **repo TDD, coverage, ROADMAP, two-sided oracles on unit tests**.

That mismatch produces: extra governance files, pytest cargo-cult (`ranking_node_feature_parity_recovery_instance_1`: wrong pytest path, then workaround), and “I will not forge output” followed by cache dumps (`merfish_image_decoding_segmentation_1`).

**Fix direction.** Headless/ALE system prompt: one agent, read the prompt, use provided `software/` wrappers, write only contract files, verify with the task’s own public checks. Keep performance-mode behind an explicit user/skill invocation, not the default for `collaboration_mode: build`.

## Suggested implementation order

1. ALE/headless preset: disable performance-mode auto-start; cap spawn; no isolated worktree.
2. Output hygiene in deployer or a last-step tool: allowlist + purge `.venv`, `.uv-cache`, `.runtime`, `__pycache__`, `*.tar.gz` unless named.
3. Completion policy: failed self-check ⇒ keep going or non-zero; no placeholder trees.
4. Child briefs: inject real task paths; drop RUN-MARKER requirement outside performance-mode.
5. Only then tune persona text. Prompt-only edits will not stop venv pollution if write() is unrestricted.

## Evidence pointers (remote, read-only)

- Runs: `/home/oliver/ale-bench/logs/ale/metis_ale_docker_official_99_r2/`
- Per task: `run.json`, `eval_result.json`, `output/`, `origin_log/metis/_result.json`, `origin_log/metis/transcript.jsonl`
- Preset: `adapters/ale_official/metis.yaml`

Do not rerun the 98-task eval to start this work. Use the traces above. Any harness change needs a small fixture: one polluted-output task + one missing-file task + one “logits self-check failed but files written” task.
