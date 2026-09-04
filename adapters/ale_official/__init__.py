"""Official ALE (ale_run) integration for Metis.

This package is intentionally separate from the legacy ``adapters/ale``
harness. It targets the official ``BaseAgentDeployer`` / sandbox executor
shape used by ``python -m ale_run run``.

Public entry points:
- ``MetisDeployer`` / ``MetisConfig`` — register via FQN or factory patch
- ``convert_metis_session_to_steps`` — JSONL → ALE-v1.0 step payloads
"""

from .config import MetisConfig
from .trajectory_convert import convert_metis_session_to_steps

__all__ = [
	"MetisConfig",
	"MetisDeployer",
	"convert_metis_session_to_steps",
]


def __getattr__(name: str):
	if name == "MetisDeployer":
		from .deployer import MetisDeployer

		return MetisDeployer
	raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
