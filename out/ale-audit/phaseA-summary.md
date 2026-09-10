# ALE-99 r2 Audit + Monitor Handoff

## Phase A（审计 @ 2026-09-07 ~18:31 CST）

服务 `ale-metis-99-r2.service`：**active (running)**，自 12:55 起。
进度：**20/98 terminal**（@19:15）；当前跑 `computing_math__k3_abelian_extensions`（Mem ~1.65/2Gi）。

### 分类（以 runner `done:` + 最新有效 attempt 为准）

| 类别 | 数量 | 说明 |
| --- | --- | --- |
| completed score>0 | 14 | 正常完成 |
| completed score=0（模型错） | 6 | `error: null`，评测给出 0 分 |
| timeout | 0 | — |
| OOM/resource | 0 | 尚无；主机 3.8G、容器接近 2g 上限需盯 |
| docker/sandbox/provision | 0 | — |
| Metis/auth/agent crash | 0 | — |
| evaluator missing dependency | 0 | — |
| other env | 0 | — |
| in_progress | 1 | k3_abelian_extensions |
| queued placeholders | ~77 | 仅 `run_started`+`provision_wait`，非失败 |

### timeout / env 失败 task IDs
无。

### score=0（模型，非基建）
1. `business_finance__basel_operational_risk_bia_cn` — score=0, error=null  
2. `business_finance__ff5_public_reconstruction` — score=0, error=null  
3. `business_finance__legal_ma_consistency_audit_01` — `reason=missing_required_targets`  
4. `computing_math__clustered_cyclic_code_circuit_level_simulation` — score=0, error=null  
5. `computing_math__go_game_reconstruction_1` — score=0, error=null  
6. `computing_math__ising_post_measurement_1` — score=0, error=null  

### 历史 stub vs 最新有效
- 早波 `20260907_0252*`：resume 跳过的 4 个**有效完成**（american / basel / ab_test / audience_segmentation），含 `run.json`+`eval_result.json`。
- r2 波 `20260907_0455*`：后续任务；其中 ~80 个目录仅为编排预建 placeholder。
- 日志里 `OpenTelemetry … No module named 'opentelemetry.exporter'` 仅为 host 遥测 WARNING，**不是**任务失败原因。

### 代表摘录（已脱敏）
- `done: status=completed score=0.0 … error: null`
- legal_ma: `reason: missing_required_targets`
- otel: `No module named 'opentelemetry.exporter'`（可忽略）

## Phase B
继续 30–60 分钟间隔监视，直到 98/98 或重大基建 blocker。仅修 infra。Todo `run-r2` 完成前保持 in progress。
