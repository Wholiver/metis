# Metis Skill

Explicit-only Metis orchestration skill for Codex, OpenCode, and DeepSeek Harness.

## Overview

`metis-skill` provides host-agnostic orchestration across supported coding agent hosts:
- **Codex**: Full contract projection, guidelines, rules, playbooks, and external controller envelope parser.
- **OpenCode**: Environment variable injection (`METIS_ORCHESTRATOR=opencode`), launcher wrappers (`launch-opencode.sh`, `launch-opencode.ps1`), config generator (`metis.opencode.json`), and doctor diagnostics.
- **DeepSeek Harness**: Cordis bridge integration (`metis_structured_output`, `metis_claim_chunk`, `metis_heartbeat`, `metis_gate_evaluation`), headless runner patch (`headless.patch.yml`), agent preset (`agent-preset/agent.cordis.yml`), and structured result capture.

## Installation

```bash
npm install -g metis-skill
metis-plugin
```

Or install for a specific host without interactive prompts:

```bash
metis-plugin install codex
metis-plugin install opencode
metis-plugin install deepseek
```

## System Check

```bash
metis-plugin doctor
```

## Activation

```bash
metis-plugin activate codex --target /absolute/project -- "your mission"
metis-plugin activate opencode --target /absolute/project -- "your mission"
metis-plugin activate deepseek --target /absolute/project -- "your mission"
```

## License

MIT
