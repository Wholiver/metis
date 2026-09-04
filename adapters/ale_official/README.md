# Official ALE + Metis integration (ale_run)

This directory is the **new** official integration. Do **not** use legacy
`adapters/ale/*`, `scripts/colab_*`, or historical eval results.

## What it provides

| Piece | Role |
| --- | --- |
| `MetisDeployer` / `MetisConfig` | ALE `BaseAgentDeployer` for in-sandbox Metis CLI |
| `extension/cua_tools.ts` | Metis Extension: TypeBox tools wrapping ALE `cua_mcp_server` |
| `trajectory_convert.py` | Metis session JSONL → ALE-v1.0 step payloads |
| `metis.yaml` | Agent preset (`openai-codex` / `gpt-5.6-luna` / `thinking=low`) |
| `factory_patch.py` | Optional `_AGENT_FQNS["metis"]` registration |

## Wire into ALE

1. Clone this Metis snapshot branch on the Colab host.
2. Clone ALE (`rdi-berkeley/agents-last-exam`) at a pinned commit.
3. Put Metis on `PYTHONPATH`:

```bash
export PYTHONPATH="/path/to/metis:${PYTHONPATH}"
```

4. Either use the FQN harness directly:

```yaml
agents:
  - /path/to/metis/adapters/ale_official/metis.yaml
```

(`harness: adapters.ale_official.deployer.MetisDeployer`)

Or apply the optional shortcut:

```bash
python /path/to/metis/adapters/ale_official/factory_patch.py --ale-root /path/to/agents-last-exam
```

5. Point `config.metis_git_ref` at this snapshot branch and set
   `config.auth_json_path` to a **temporary** host file with Metis
   `auth.json` contents (from Colab Secrets / one-shot upload — never commit).

6. Use official Docker environment + `selected_tasks/docker_support.txt`.

## Fixed model

- Provider: `openai-codex`
- Model: `gpt-5.6-luna`
- Thinking: `low`

## Security

- Never write HF tokens, Codex auth, or API keys into git, notebooks, Drive
  logs, or commit messages.
- `auth_json_content` is embedded into the serialized config for sandbox
  install only; do not print it.
