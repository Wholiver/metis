from __future__ import annotations

import asyncio
import json
import logging
import os
import shutil
import textwrap
from dataclasses import dataclass, field
from pathlib import Path, PureWindowsPath
from typing import Any

import cua_bench as cb

from tasks.common_config import GeneralTaskConfig
from tasks.common_setup import BaseTaskSetup

_setup = BaseTaskSetup()

logger = logging.getLogger(__name__)

TASK_DIR = Path(__file__).resolve().parent
CATALOG_PATH = TASK_DIR / "variant_catalog.json"
SCRIPTS_DIR = TASK_DIR / "scripts"
WORKFLOW = "scene_restoration"

OS_TYPE = "windows"

REMOTE_EDITOR_CMD = os.environ.get(
    "UNREAL_TASK_REMOTE_EDITOR_CMD",
    r"C:\Program Files\Epic Games\UE_5.7\Engine\Binaries\Win64\UnrealEditor-Cmd.exe",
)
REMOTE_TEMP_ROOT = os.environ.get(
    "UNREAL_TASK_REMOTE_EVAL_ROOT",
    r"C:\Users\User\AppData\Local\Temp\agenthle_eval\unreal_scene_restoration",
)


def _remote_child(base: str, *parts: str) -> str:
    path = PureWindowsPath(base)
    for part in parts:
        if part:
            path = path / part
    return str(path)


def _remote_from_relative(task_dir: str, relpath: str) -> str:
    rel = PureWindowsPath(relpath.replace("/", "\\"))
    return _remote_child(task_dir, *rel.parts)


def _ps_quote(text: str) -> str:
    return text.replace("'", "''")


def _ps_literal(text: str) -> str:
    return f"'{_ps_quote(text)}'"


def _ps_double_quoted(text: str) -> str:
    return '"' + text.replace('"', '`"') + '"'


@dataclass(frozen=True)
class VariantSpec:
    task_tag: str
    display_name: str
    remote_task_dir_name: str
    visible_subdirs: list[str] = field(default_factory=lambda: ["input", "software"])
    engine_version: str = "Unreal Engine 5.7"
    project_relative_path: str = "input/project/SummerRiding2.uproject"
    scaffold_map_path: str = ""
    submission_map_asset_path: str = "/Game/Project/Scenes/Submission/final"
    submission_relpath: str = "output/submission/project/SummerRiding2.uproject"
    input_manifest_relpath: str = "input/manifest.json"
    scene_reference_dir_relpath: str = "input/scene_reference_images"
    camera_prefix: str = "TaskCam_"
    camera_count: int = 0
    task_summary: str = ""


def _load_variants() -> list[VariantSpec]:
    payload = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    return [VariantSpec(**entry) for entry in payload]


VARIANTS = _load_variants()
VARIANTS_BY_TAG = {variant.task_tag: variant for variant in VARIANTS}


@dataclass
class UnrealSceneRestorationTaskConfig(GeneralTaskConfig):
    variant: VariantSpec = field(default_factory=lambda: VARIANTS[0])
    DOMAIN_NAME: str = "visual_media"

    TASK_NAME: str = "scene_restoration"
    VARIANT_NAME: str = ""

    def __post_init__(self) -> None:
        self.VARIANT_NAME = self.variant.task_tag

    @property
    def task_dir(self) -> str:
        return _remote_child(
            self.REMOTE_ROOT_DIR,
            self.DOMAIN_NAME,
            self.TASK_NAME,
            self.variant.remote_task_dir_name,
        )

    @property
    def input_dir(self) -> str:
        return _remote_child(self.task_dir, "input")

    @property
    def input_project_dir(self) -> str:
        rel = PureWindowsPath(self.variant.project_relative_path)
        return _remote_child(self.task_dir, *rel.parent.parts)

    @property
    def input_project_file(self) -> str:
        rel = PureWindowsPath(self.variant.project_relative_path)
        return _remote_child(self.task_dir, *rel.parts)

    @property
    def input_manifest(self) -> str:
        rel = PureWindowsPath(self.variant.input_manifest_relpath)
        return _remote_child(self.task_dir, *rel.parts)

    @property
    def scene_reference_dir(self) -> str:
        rel = PureWindowsPath(self.variant.scene_reference_dir_relpath)
        return _remote_child(self.task_dir, *rel.parts)

    @property
    def output_submission_dir(self) -> str:
        rel = PureWindowsPath(self.variant.submission_relpath)
        return _remote_child(self.task_dir, *rel.parent.parts)

    @property
    def output_submission_map(self) -> str:
        rel = PureWindowsPath(self.variant.submission_relpath)
        return _remote_child(self.task_dir, *rel.parts)

    @property
    def reference_manifest(self) -> str:
        return _remote_child(self.reference_dir, "manifest.json")

    @property
    def reference_camera_manifest(self) -> str:
        return _remote_child(self.reference_dir, "metadata", "camera_manifest.json")

    @property
    def reference_render_config(self) -> str:
        return _remote_child(self.reference_dir, "metadata", "render_config.json")

    @property
    def reference_scene_dir(self) -> str:
        return _remote_child(self.reference_dir, "images", "scene")

    @property
    def reference_evaluation_config(self) -> str:
        return _remote_child(self.reference_dir, "evaluation_config.json")

    @property
    def task_description(self) -> str:
        camera_line = (
            f"- Fixed camera set available in the project: `{self.variant.camera_prefix}*` ({self.variant.camera_count} views)"
            if self.variant.camera_count
            else f"- Fixed camera set available in the project: `{self.variant.camera_prefix}*`"
        )
        summary = (
            self.variant.task_summary
            or "Restore the removed scene region using existing Unreal project assets."
        )
        return textwrap.dedent(f"""\
            You are a technical level artist working in {self.variant.engine_version}.

            Your task is partial scene restoration, not asset authoring from scratch.

            Task:
            - {summary}

            Agent-visible files:
            - Scene reference images: `{self.scene_reference_dir}`
            - Input manifest: `{self.input_manifest}`
            - Input Unreal project: `{self.input_project_file}`

            Scene entry:
            - Open the scaffold project and load map `{self.variant.scaffold_map_path}`

            Requirements:
            - Reuse assets that already exist in the visible Unreal project.
            - Restore the removed scene region so the scene matches the provided reference views.
            - Preserve the visible environment outside the removed region unless a local adjustment is required to integrate the restoration cleanly.
            - Keep the fixed task cameras available for preview.
            {camera_line}

            Submission contract:
            - Submit a complete Unreal project at `{self.output_submission_map}`
            - The submitted project must contain the restored map asset at `{self.variant.submission_map_asset_path}`
            """)

    def to_metadata(self) -> dict[str, Any]:
        data = super().to_metadata()
        data.update(
            {
                "workflow": WORKFLOW,
                "display_name": self.variant.display_name,
                "remote_task_dir_name": self.variant.remote_task_dir_name,
                "task_dir": self.task_dir,
                "input_dir": self.input_dir,
                "input_project_dir": self.input_project_dir,
                "input_project_file": self.input_project_file,
                "input_manifest": self.input_manifest,
                "scene_reference_dir": self.scene_reference_dir,
                "output_submission_dir": self.output_submission_dir,
                "output_submission_map": self.output_submission_map,
                "reference_manifest": self.reference_manifest,
                "reference_camera_manifest": self.reference_camera_manifest,
                "reference_render_config": self.reference_render_config,
                "reference_scene_dir": self.reference_scene_dir,
                "reference_evaluation_config": self.reference_evaluation_config,
                "scaffold_map_path": self.variant.scaffold_map_path,
                "submission_map_asset_path": self.variant.submission_map_asset_path,
                "camera_prefix": self.variant.camera_prefix,
                "camera_count": self.variant.camera_count,
                "task_summary": self.variant.task_summary,
                "visible_subdirs": list(self.variant.visible_subdirs),
            }
        )
        return data


@cb.tasks_config(split="train")
def load():
    tasks = []
    for variant in VARIANTS:
        cfg = UnrealSceneRestorationTaskConfig(variant=variant)
        tasks.append(
            cb.Task(
                description=cfg.task_description,
                metadata=cfg.to_metadata(),
                computer={"provider": "computer", "setup_config": {"os_type": "windows"}},
            )
        )
    return tasks


@cb.setup_task(split="train")
async def start(task_cfg, session: cb.DesktopSession):
    await _setup(task_cfg, session)


def _read_script(name: str) -> str:
    return (SCRIPTS_DIR / name).read_text(encoding="utf-8")


def _load_local_render_eval():
    from tasks.visual_media.scene_restoration.scripts.local_render_eval import \
        run_local_soft_eval

    return run_local_soft_eval


async def _upload_scripts(session: cb.DesktopSession, remote_scripts_dir: str) -> None:
    await session.interface.create_dir(remote_scripts_dir)
    for name in [
        "build_camera_sequences.py",
        "render_candidate_views.ps1",
        "runtime_executor.py",
        "runtime_init_unreal.py",
    ]:
        await session.write_file(_remote_child(remote_scripts_dir, name), _read_script(name))


async def _ensure_render_plugins_enabled(
    session: cb.DesktopSession,
    project_path: str,
) -> None:
    required_plugins = (
        "MovieRenderPipeline",
        "PythonScriptPlugin",
        "SequencerScripting",
    )
    try:
        raw = (await session.read_bytes(project_path)).decode("utf-8")
        payload = json.loads(raw)
    except Exception:
        logger.warning(
            "Failed to read or parse Unreal project file: %s", project_path, exc_info=True
        )
        return

    plugins = payload.setdefault("Plugins", [])
    if not isinstance(plugins, list):
        logger.warning("Unexpected Plugins payload in Unreal project file: %s", project_path)
        return

    existing_names = {
        item.get("Name")
        for item in plugins
        if isinstance(item, dict) and isinstance(item.get("Name"), str)
    }
    changed = False
    for plugin_name in required_plugins:
        if plugin_name in existing_names:
            continue
        plugins.append({"Name": plugin_name, "Enabled": True})
        changed = True

    if not changed:
        return

    await session.write_file(
        project_path,
        json.dumps(payload, indent=4).encode("utf-8"),
    )
    logger.info("Enabled required Unreal render plugins in %s", project_path)


async def _launch_remote_render_job(
    session: cb.DesktopSession,
    *,
    remote_scripts_dir: str,
    submission_project: str,
    render_config: str,
    output_dir: str,
    temp_render_dir: str,
    report_path: str,
) -> None:
    ps_script = _remote_child(remote_scripts_dir, "render_candidate_views.ps1")
    stdout_path = _remote_child(remote_scripts_dir, "job_stdout.txt")
    stderr_path = _remote_child(remote_scripts_dir, "job_stderr.txt")
    prep = (
        "$ErrorActionPreference='Stop'; "
        f"$wd={_ps_literal(remote_scripts_dir)}; "
        f"$stdout={_ps_literal(stdout_path)}; "
        f"$stderr={_ps_literal(stderr_path)}; "
        "Set-Location -LiteralPath $wd; "
        "if (Test-Path -LiteralPath $stdout) { Remove-Item -LiteralPath $stdout -Force -ErrorAction SilentlyContinue }; "
        "if (Test-Path -LiteralPath $stderr) { Remove-Item -LiteralPath $stderr -Force -ErrorAction SilentlyContinue }"
    )
    await session.run_command(f'powershell -NoProfile -Command "{prep}"', check=False)

    cmd = " ".join(
        [
            "powershell",
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            _ps_double_quoted(ps_script),
            "-SubmissionProject",
            _ps_double_quoted(submission_project),
            "-RenderConfigPath",
            _ps_double_quoted(render_config),
            "-OutputDir",
            _ps_double_quoted(output_dir),
            "-TempRenderDir",
            _ps_double_quoted(temp_render_dir),
            "-ReportPath",
            _ps_double_quoted(report_path),
            "-EngineCmd",
            _ps_double_quoted(REMOTE_EDITOR_CMD),
            "1>",
            _ps_double_quoted(stdout_path),
            "2>",
            _ps_double_quoted(stderr_path),
        ]
    )
    await session.run_command(cmd, check=False)


async def _wait_for_file(
    session: cb.DesktopSession,
    path: str,
    *,
    timeout_sec: float = 7200.0,
    poll_sec: float = 10.0,
) -> bool:
    deadline = asyncio.get_event_loop().time() + timeout_sec
    while asyncio.get_event_loop().time() < deadline:
        try:
            if (await session.file_exists(path) or await session.directory_exists(path)):
                return True
        except Exception:
            pass
        await asyncio.sleep(poll_sec)
    return False


async def _read_text_if_exists(session: cb.DesktopSession, path: str) -> str:
    try:
        if not (await session.file_exists(path) or await session.directory_exists(path)):
            return ""
        return (await session.read_bytes(path)).decode("utf-8", errors="replace")
    except Exception:
        return ""


def _submission_map_file_for_project(project_path: str, submission_map_asset_path: str) -> str:
    normalized = submission_map_asset_path.strip().replace("\\", "/")
    if normalized.startswith("/Game/"):
        normalized = normalized[len("/Game/") :]
    normalized = normalized.strip("/")
    parts = [part for part in normalized.split("/") if part]
    if not parts:
        raise ValueError(f"Invalid submission map asset path: {submission_map_asset_path}")
    leaf = parts[-1].split(".", 1)[0]
    project_root = str(PureWindowsPath(project_path).parent)
    return _remote_child(project_root, "Content", *parts[:-1], f"{leaf}.umap")


async def _reset_remote_eval_dirs(
    session: cb.DesktopSession,
    *,
    remote_results_dir: str,
    remote_temp_renders: str,
) -> None:
    for path in (remote_results_dir, remote_temp_renders):
        await session.run_command(
            f'cmd /c if exist "{path}" rmdir /s /q "{path}"',
            check=False,
        )
        await session.interface.create_dir(path)


async def _materialize_render_dirs(
    session: cb.DesktopSession,
    *,
    task_dir: str,
    camera_manifest_path: str,
    candidate_dir: str,
    local_tmp_dir: Path,
) -> tuple[Path, Path, list[dict[str, str]]]:
    payload = json.loads((await session.read_bytes(camera_manifest_path)).decode("utf-8"))
    cameras = payload.get("cameras", [])
    reference_dir = local_tmp_dir / "reference"
    candidate_local_dir = local_tmp_dir / "candidate"
    shutil.rmtree(reference_dir, ignore_errors=True)
    shutil.rmtree(candidate_local_dir, ignore_errors=True)
    reference_dir.mkdir(parents=True, exist_ok=True)
    candidate_local_dir.mkdir(parents=True, exist_ok=True)
    frame_pairs: list[dict[str, str]] = []
    for idx, camera in enumerate(cameras):
        label = camera.get("name", f"camera_{idx:02d}")
        sequence_name = camera.get("sequence_name") or f"LS_{label}"
        reference_image_relpath = camera.get("reference_image")
        if not reference_image_relpath:
            reference_image_relpath = f"reference/images/scene/{sequence_name}.png"
        reference_remote = _remote_from_relative(task_dir, reference_image_relpath)
        reference_local = reference_dir / f"{sequence_name}.png"
        reference_local.write_bytes(await session.read_bytes(reference_remote))
        candidate_remote = _remote_child(candidate_dir, f"{sequence_name}.png")
        candidate_local = candidate_local_dir / f"{sequence_name}.png"
        if (await session.file_exists(candidate_remote) or await session.directory_exists(candidate_remote)):
            candidate_local.write_bytes(await session.read_bytes(candidate_remote))
        frame_pairs.append(
            {
                "view": label,
                "reference_image": str(reference_local),
                "candidate_image": str(candidate_local),
            }
        )
    return reference_dir, candidate_local_dir, frame_pairs


@cb.evaluate_task(split="train")
async def evaluate(task_cfg, session: cb.DesktopSession) -> list[float]:
    meta = task_cfg.metadata
    submission_project = meta["output_submission_map"]
    if not (await session.file_exists(submission_project) or await session.directory_exists(submission_project)):
        return [0.0]
    submission_map_file = _submission_map_file_for_project(
        submission_project,
        meta["submission_map_asset_path"],
    )
    if not (await session.file_exists(submission_map_file) or await session.directory_exists(submission_map_file)):
        logger.error("[%s] Submission map missing: %s", meta["variant_name"], submission_map_file)
        return [0.0]

    remote_eval_dir = _remote_child(REMOTE_TEMP_ROOT, meta["variant_name"])
    remote_scripts_dir = _remote_child(remote_eval_dir, "scripts")
    remote_results_dir = _remote_child(remote_eval_dir, "results")
    remote_candidate_dir = _remote_child(remote_results_dir, "candidate_renders")
    remote_temp_renders = _remote_child(remote_eval_dir, "scratch")
    remote_report = _remote_child(remote_results_dir, "render_report.json")

    await session.interface.create_dir(remote_eval_dir)
    await _reset_remote_eval_dirs(
        session,
        remote_results_dir=remote_results_dir,
        remote_temp_renders=remote_temp_renders,
    )
    await _upload_scripts(session, remote_scripts_dir)
    await _ensure_render_plugins_enabled(session, submission_project)
    await _launch_remote_render_job(
        session,
        remote_scripts_dir=remote_scripts_dir,
        submission_project=submission_project,
        render_config=meta["reference_render_config"],
        output_dir=remote_candidate_dir,
        temp_render_dir=remote_temp_renders,
        report_path=remote_report,
    )

    if not await _wait_for_file(session, remote_report):
        stderr = await _read_text_if_exists(
            session, _remote_child(remote_scripts_dir, "job_stderr.txt")
        )
        stdout = await _read_text_if_exists(
            session, _remote_child(remote_scripts_dir, "job_stdout.txt")
        )
        logger.error(
            "[%s] Timed out waiting for render report. stdout=%s stderr=%s",
            meta["variant_name"],
            stdout,
            stderr,
        )
        return [0.0]

    render_report = json.loads((await session.read_bytes(remote_report)).decode("utf-8-sig"))
    local_tmp_dir = TASK_DIR / ".tmp_eval" / meta["variant_name"]
    local_tmp_dir.mkdir(parents=True, exist_ok=True)
    run_local_soft_eval = _load_local_render_eval()

    _reference_dir, _candidate_dir, frame_pairs = await _materialize_render_dirs(
        session,
        task_dir=meta["task_dir"],
        camera_manifest_path=meta["reference_camera_manifest"],
        candidate_dir=remote_candidate_dir,
        local_tmp_dir=local_tmp_dir,
    )

    soft_result = run_local_soft_eval(
        task_tag=meta["variant_name"],
        task_summary=meta.get("task_summary", ""),
        frame_pairs=frame_pairs,
        local_tmp_dir=local_tmp_dir / "soft_eval",
    )
    final_score = float(soft_result) if soft_result is not None else 0.0

    summary = {
        "variant_name": meta["variant_name"],
        "render_report": render_report,
        "frame_pair_count": len(frame_pairs),
        "final_score": final_score,
    }
    (local_tmp_dir / "final_eval_summary.json").write_text(
        json.dumps(summary, indent=2), encoding="utf-8"
    )
    logger.info(
        "[%s] unreal scene restoration eval final=%.4f",
        meta["variant_name"],
        final_score,
    )
    return [float(final_score)]


if __name__ == "__main__":
    print(
        json.dumps(
            {"workflow": WORKFLOW, "variants": [item.task_tag for item in VARIANTS]}, indent=2
        )
    )
