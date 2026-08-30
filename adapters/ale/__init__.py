"""
Agents' Last Exam (ALE-CLI) Metis Adapter and Runner.
"""

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from adapters.ale.metis_adapter import ALEMetisAdapter, ALEResult, evaluate_task
    from adapters.ale.runner import (
        ALERunner,
        ALETask,
        format_duration,
        format_tokens,
        load_default_ale_tasks,
        load_tasks_from_file_or_dir,
    )


def __getattr__(name: str):
    if name in ("ALEMetisAdapter", "ALEResult", "evaluate_task"):
        import adapters.ale.metis_adapter as ma

        return getattr(ma, name)
    if name in (
        "ALERunner",
        "ALETask",
        "format_duration",
        "format_tokens",
        "load_default_ale_tasks",
        "load_tasks_from_file_or_dir",
    ):
        import adapters.ale.runner as r

        return getattr(r, name)
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


__all__ = [
    "ALEMetisAdapter",
    "ALEResult",
    "ALERunner",
    "ALETask",
    "evaluate_task",
    "format_duration",
    "format_tokens",
    "load_default_ale_tasks",
    "load_tasks_from_file_or_dir",
]
