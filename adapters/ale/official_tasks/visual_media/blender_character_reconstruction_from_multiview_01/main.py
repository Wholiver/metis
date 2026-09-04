"""AgentHLE task: blender_character_reconstruction_from_multiview_01."""

from __future__ import annotations

import asyncio
import json
import logging
import math
import os
import textwrap
from io import BytesIO
from pathlib import Path, PureWindowsPath
from typing import Any

import cua_bench as cb
import numpy as np
from PIL import Image
from scipy.spatial import cKDTree
from skimage.metrics import structural_similarity

from tasks.common_config import GeneralTaskConfig
from tasks.common_setup import BaseTaskSetup

logger = logging.getLogger(__name__)

TASK_ID = "visual_media/blender_character_reconstruction_from_multiview_01"
TASK_NAME = "blender_character_reconstruction_from_multiview_01"
VARIANT_NAME = "base"
TASK_DIR = Path(__file__).resolve().parent
EVAL_TMP_DIR = r"C:\Users\User\AppData\Local\Temp\agenthle_eval\blender_character_reconstruction_from_multiview_01"
APPROVED_BLENDER_VERSION = "5.0.1"
APPROVED_BLENDER_50_PREFIX = "Blender 5.0"
DEV_FALLBACK_BLENDER_51_PREFIX = "Blender 5.1"
PREFERRED_BLENDER_INSTALL_DIR = r"C:\Softwares\Blender-5.0.1"
BLENDER_JOB_TIMEOUT_SEC = 3600.0
BLENDER_JOB_POLL_SEC = 10.0
BACKGROUND_GRAY = 0.52
MASK_THRESHOLD = 0.06
OBJ_SAMPLE_LIMIT_DEFAULT = 6000


def _remote_child(base: str, *parts: str) -> str:
    path = PureWindowsPath(base)
    for part in parts:
        if part:
            path = path / part
    return str(path)


def _ps_quote(text: str) -> str:
    return text.replace("'", "''")


def _as_text(value: Any) -> str:
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="ignore")
    return str(value)


def _clamp01(value: float) -> float:
    return float(max(0.0, min(1.0, value)))


async def _run_command(
    session: cb.DesktopSession,
    command: str,
    *,
    timeout: float | None = None,
    check: bool = False,
) -> dict[str, Any]:
    try:
        if timeout is not None:
            return await session.run_command(command, timeout=timeout, check=check)
        return await session.run_command(command, check=check)
    except TypeError:
        return await session.run_command(command, check=check)


async def _read_bytes(session: cb.DesktopSession, path: str) -> bytes:
    try:
        data = await session.read_bytes(path)
        if isinstance(data, bytes):
            return data
        return bytes(data)
    except Exception:
        data = await session.read_file(path)
        if isinstance(data, bytes):
            return data
        return data.encode("utf-8")


async def _read_json(session: cb.DesktopSession, path: str) -> dict[str, Any]:
    return json.loads((await _read_bytes(session, path)).decode("utf-8"))


async def _remote_file_size(session: cb.DesktopSession, path: str) -> int | None:
    ps = (
        f"$p = '{_ps_quote(path)}'; "
        "if (Test-Path -LiteralPath $p) { "
        "(Get-Item -LiteralPath $p).Length "
        "} else { "
        "Write-Output '__MISSING__' "
        "}"
    )
    result = await _run_command(session, f'powershell -NoProfile -Command "{ps}"', check=False)
    stdout = _as_text(result.get("stdout", "")).strip()
    if not stdout or "__MISSING__" in stdout:
        return None
    for line in reversed(stdout.splitlines()):
        line = line.strip()
        if line.isdigit():
            return int(line)
    return None


def _load_gray_image(raw: bytes) -> np.ndarray:
    image = Image.open(BytesIO(raw)).convert("L")
    return np.asarray(image, dtype=np.float32) / 255.0


def _foreground_mask(gray: np.ndarray) -> np.ndarray:
    return np.abs(gray - BACKGROUND_GRAY) > MASK_THRESHOLD


def _mask_iou(mask_a: np.ndarray, mask_b: np.ndarray) -> float:
    intersection = float(np.logical_and(mask_a, mask_b).sum())
    union = float(np.logical_or(mask_a, mask_b).sum())
    if union <= 0.0:
        return 1.0
    return intersection / union


def _render_similarity(reference_png: bytes, candidate_png: bytes) -> dict[str, float]:
    ref = _load_gray_image(reference_png)
    cand = _load_gray_image(candidate_png)
    if ref.shape != cand.shape:
        raise RuntimeError(f"render shape mismatch: reference={ref.shape} candidate={cand.shape}")
    ssim = float(structural_similarity(ref, cand, data_range=1.0))
    iou = _mask_iou(_foreground_mask(ref), _foreground_mask(cand))
    combined = (0.7 * ssim) + (0.3 * iou)
    return {
        "ssim": ssim,
        "mask_iou": iou,
        "combined": float(combined),
    }


def _sample_vertices(vertices: np.ndarray, limit: int) -> np.ndarray:
    if len(vertices) <= limit:
        return vertices
    step = max(1, len(vertices) // limit)
    sampled = vertices[::step]
    return sampled[:limit]


def _parse_obj_vertices(raw: bytes) -> np.ndarray:
    vertices: list[tuple[float, float, float]] = []
    for line in raw.decode("utf-8", errors="ignore").splitlines():
        if not line.startswith("v "):
            continue
        parts = line.split()
        if len(parts) < 4:
            continue
        try:
            vertices.append((float(parts[1]), float(parts[2]), float(parts[3])))
        except ValueError:
            continue
    if not vertices:
        raise RuntimeError("OBJ has no readable vertices")
    return np.asarray(vertices, dtype=np.float64)


def _bbox_diagonal(vertices: np.ndarray) -> float:
    mins = np.min(vertices, axis=0)
    maxs = np.max(vertices, axis=0)
    return float(np.linalg.norm(maxs - mins))


def _geometry_similarity(
    reference_obj: bytes,
    candidate_obj: bytes,
    sample_limit: int,
) -> dict[str, float]:
    ref_vertices = _sample_vertices(_parse_obj_vertices(reference_obj), sample_limit)
    cand_vertices = _sample_vertices(_parse_obj_vertices(candidate_obj), sample_limit)
    reference_scale = max(_bbox_diagonal(ref_vertices), 1e-6)
    ref_tree = cKDTree(ref_vertices)
    cand_tree = cKDTree(cand_vertices)
    ref_to_cand = cand_tree.query(ref_vertices, k=1)[0]
    cand_to_ref = ref_tree.query(cand_vertices, k=1)[0]
    chamfer = float((ref_to_cand.mean() + cand_to_ref.mean()) * 0.5)
    normalized = chamfer / reference_scale
    score = float(math.exp(-14.0 * normalized))
    return {
        "sample_limit": float(sample_limit),
        "reference_scale": reference_scale,
        "mean_chamfer": chamfer,
        "normalized_chamfer": normalized,
        "score": score,
    }


def _bbox_similarity(scale_guide: dict[str, Any], metrics: dict[str, Any]) -> dict[str, float]:
    ref_box = scale_guide["computed_bounding_box"]
    ref_center = np.asarray(ref_box["center"], dtype=np.float64)
    ref_extent = np.asarray(ref_box["extent"], dtype=np.float64)
    cand_center = np.asarray(metrics["bbox_center"], dtype=np.float64)
    cand_extent = np.asarray(metrics["bbox_extent"], dtype=np.float64)
    center_offset = float(np.linalg.norm(cand_center - ref_center))
    center_limit = float(
        scale_guide["allowed_bounding_box_ranges"]["max_center_offset_world_units"]
    )
    center_score = _clamp01(1.0 - (center_offset / max(center_limit * 4.0, 1e-6)))

    extent_ratios = cand_extent / np.maximum(ref_extent, 1e-6)
    extent_scores = [_clamp01(1.0 - (abs(float(ratio) - 1.0) / 0.35)) for ratio in extent_ratios]
    score = (0.4 * center_score) + (0.6 * (sum(extent_scores) / len(extent_scores)))
    return {
        "center_offset": center_offset,
        "center_score": center_score,
        "extent_ratio_x": float(extent_ratios[0]),
        "extent_ratio_y": float(extent_ratios[1]),
        "extent_ratio_z": float(extent_ratios[2]),
        "score": float(score),
    }


async def _find_first_existing_path(
    session: cb.DesktopSession, candidates: list[str]
) -> str | None:
    for candidate in candidates:
        if (await session.file_exists(candidate) or await session.directory_exists(candidate)):
            return candidate
    return None


def _dedupe_paths(candidates: list[str]) -> list[str]:
    deduped: list[str] = []
    for candidate in candidates:
        if candidate and candidate not in deduped:
            deduped.append(candidate)
    return deduped


def _blender_version_rank(version_line: str) -> int | None:
    line = version_line.strip()
    if line.startswith(APPROVED_BLENDER_50_PREFIX):
        return 0
    if line.startswith(DEV_FALLBACK_BLENDER_51_PREFIX):
        return 1
    return None


async def _blender_version_line(session: cb.DesktopSession, blender_exe: str) -> str:
    command = f'cmd /c ""{blender_exe}" --version"'
    result = await _run_command(session, command, timeout=120.0, check=False)
    output = (_as_text(result.get("stdout", "")) + "\n" + _as_text(result.get("stderr", ""))).strip()
    for line in output.splitlines():
        stripped = line.strip()
        if stripped.startswith("Blender "):
            return stripped
    return output.splitlines()[0].strip() if output else ""


async def _discover_blender_exes(session: cb.DesktopSession) -> list[str]:
    discovered: list[str] = []
    listing_commands = (
        r'for /d %D in ("C:\Program Files\Blender Foundation\*") do @if exist "%D\blender.exe" echo %D\blender.exe',
        r'for /d %D in ("C:\Softwares\Blender-*") do @if exist "%D\blender.exe" echo %D\blender.exe',
        r'for /d %D in ("D:\Blender\Blender *") do @if exist "%D\blender.exe" echo %D\blender.exe',
    )
    for command in listing_commands:
        result = await _run_command(session, f"cmd /c {command}", check=False)
        for line in (_as_text(result.get("stdout", ""))).splitlines():
            candidate = line.strip()
            if candidate.lower().endswith("blender.exe") and candidate not in discovered:
                discovered.append(candidate)
    return discovered


async def _resolve_blender_exe(
    session: cb.DesktopSession,
    candidates: list[str],
) -> str:
    existing: list[str] = []
    for candidate in _dedupe_paths(candidates):
        if await session.file_exists(candidate):
            existing.append(candidate)
    for candidate in await _discover_blender_exes(session):
        if candidate not in existing:
            existing.append(candidate)

    best_exe: str | None = None
    best_rank = 999
    best_version = ""
    for blender_exe in existing:
        version_line = await _blender_version_line(session, blender_exe)
        rank = _blender_version_rank(version_line)
        if rank is None:
            logger.warning(
                "Skipping unsupported Blender runtime at %s (version=%r)",
                blender_exe,
                version_line,
            )
            continue
        if rank < best_rank:
            best_rank = rank
            best_exe = blender_exe
            best_version = version_line

    if best_exe is None:
        searched = _dedupe_paths(candidates + await _discover_blender_exes(session))
        raise RuntimeError(
            "Blender runtime unavailable on VM. "
            f"Need {APPROVED_BLENDER_50_PREFIX}.x (preferred) or "
            f"{DEV_FALLBACK_BLENDER_51_PREFIX}.x (dev fallback). "
            f"Searched: {searched}"
        )

    if best_rank > 0:
        logger.warning(
            "Using non-canonical Blender runtime %s at %s; fixture scores were calibrated on %s.",
            best_version,
            best_exe,
            APPROVED_BLENDER_VERSION,
        )
    else:
        logger.info("Resolved Blender runtime %s at %s", best_version, best_exe)
    return best_exe


async def _read_text_if_exists(session: cb.DesktopSession, path: str) -> str:
    try:
        if not await session.file_exists(path):
            return ""
        return (await _read_bytes(session, path)).decode("utf-8", errors="replace")
    except Exception:
        return ""


async def _launch_detached_bat(session: cb.DesktopSession, bat_path: str) -> None:
    """Launch a .bat detached via wmic so CUA does not hold a long-lived shell."""
    await session.run_command(
        f'wmic process call create "cmd /c \\"{bat_path}\\""',
        check=False,
    )


async def _wait_for_log_marker(
    session: cb.DesktopSession,
    *,
    log_path: str,
    marker: str,
    timeout_sec: float = BLENDER_JOB_TIMEOUT_SEC,
    poll_sec: float = BLENDER_JOB_POLL_SEC,
) -> tuple[bool, str]:
    deadline = asyncio.get_event_loop().time() + timeout_sec
    last_log = ""
    while asyncio.get_event_loop().time() < deadline:
        last_log = await _read_text_if_exists(session, log_path)
        if marker in last_log:
            return True, last_log
        await asyncio.sleep(poll_sec)
    return False, last_log


async def _wait_for_paths(
    session: cb.DesktopSession,
    paths: list[str],
    *,
    timeout_sec: float = BLENDER_JOB_TIMEOUT_SEC,
    poll_sec: float = BLENDER_JOB_POLL_SEC,
) -> bool:
    deadline = asyncio.get_event_loop().time() + timeout_sec
    while asyncio.get_event_loop().time() < deadline:
        if all([await session.file_exists(path) for path in paths]):
            return True
        await asyncio.sleep(poll_sec)
    return False


async def _blend_can_open(
    session: cb.DesktopSession,
    *,
    blender_exe: str,
    blend_path: str,
) -> tuple[bool, str]:
    await session.interface.create_dir(EVAL_TMP_DIR)
    log_path = _remote_child(EVAL_TMP_DIR, "blend_open.log")
    bat_path = _remote_child(EVAL_TMP_DIR, "blend_open.bat")
    await session.run_command(f'del /f /q "{log_path}" 2>nul', check=False)
    bat_content = (
        "@echo off\r\n"
        f"\"{blender_exe}\" --background --factory-startup \"{blend_path}\" "
        "--python-expr \"print('BLEND_OPEN_CHECK_OK')\" "
        f"> \"{log_path}\" 2>&1\r\n"
    )
    await session.write_file(bat_path, bat_content)
    await _launch_detached_bat(session, bat_path)
    ok, log = await _wait_for_log_marker(
        session,
        log_path=log_path,
        marker="BLEND_OPEN_CHECK_OK",
    )
    return ok, log.strip()


async def _run_blender_eval_submission(
    session: cb.DesktopSession,
    *,
    blender_exe: str,
    helper_path: str,
    submission_obj: str,
    views_config_path: str,
    metrics_path: str,
    render_dir: str,
    expected_render_names: list[str],
) -> tuple[bool, str, str]:
    stdout_path = _remote_child(EVAL_TMP_DIR, "eval_stdout.txt")
    stderr_path = _remote_child(EVAL_TMP_DIR, "eval_stderr.txt")
    bat_path = _remote_child(EVAL_TMP_DIR, "run_eval.bat")
    for path in (metrics_path, stdout_path, stderr_path):
        await session.run_command(f'del /f /q "{path}" 2>nul', check=False)
    bat_content = (
        "@echo off\r\n"
        f"\"{blender_exe}\" --background --factory-startup "
        f"--python \"{helper_path}\" "
        f"-- --submission-obj \"{submission_obj}\" "
        f"--views-config \"{views_config_path}\" "
        f"--output-json \"{metrics_path}\" "
        f"--render-dir \"{render_dir}\" "
        f"1> \"{stdout_path}\" 2> \"{stderr_path}\"\r\n"
    )
    await session.write_file(bat_path, bat_content)
    await _launch_detached_bat(session, bat_path)
    expected_paths = [metrics_path] + [
        _remote_child(render_dir, name) for name in expected_render_names
    ]
    ready = await _wait_for_paths(session, expected_paths)
    stdout = await _read_text_if_exists(session, stdout_path)
    stderr = await _read_text_if_exists(session, stderr_path)
    return ready, stdout, stderr


class BlenderCharacterTaskConfig(GeneralTaskConfig):
    def __init__(
        self,
        *,
        REMOTE_OUTPUT_DIR: str | None = None,
        REMOTE_ROOT_DIR: str | None = None,
        DOMAIN_NAME: str = "visual_media",
        TASK_NAME: str = TASK_NAME,
        OS_TYPE: str = "windows",
    ) -> None:
        super().__init__(
            REMOTE_OUTPUT_DIR=REMOTE_OUTPUT_DIR or os.environ.get("REMOTE_OUTPUT_DIR", "output"),
            REMOTE_ROOT_DIR=REMOTE_ROOT_DIR or os.environ.get("REMOTE_ROOT_DIR", r"E:\agenthle"),
            DOMAIN_NAME=DOMAIN_NAME,
            TASK_NAME=TASK_NAME,
            OS_TYPE=OS_TYPE,
            VARIANT_NAME=VARIANT_NAME,
        )

    @property
    def input_dir(self) -> str:
        return _remote_child(self.task_dir, "input")

    @property
    def output_submission_dir(self) -> str:
        return _remote_child(self.remote_output_dir, "submission")

    @property
    def output_blend(self) -> str:
        return _remote_child(self.output_submission_dir, "final.blend")

    @property
    def output_glb(self) -> str:
        return _remote_child(self.output_submission_dir, "reconstructed_character.glb")

    @property
    def output_obj(self) -> str:
        return _remote_child(self.output_submission_dir, "reconstructed_character.obj")

    @property
    def output_report(self) -> str:
        return _remote_child(self.output_submission_dir, "modeling_report.md")

    @property
    def reference_blend(self) -> str:
        return _remote_child(self.reference_dir, "final.blend")

    @property
    def reference_glb(self) -> str:
        return _remote_child(self.reference_dir, "reconstructed_character.glb")

    @property
    def reference_obj(self) -> str:
        return _remote_child(self.reference_dir, "reconstructed_character.obj")

    @property
    def reference_report(self) -> str:
        return _remote_child(self.reference_dir, "modeling_report.md")

    @property
    def scale_guide(self) -> str:
        return _remote_child(self.reference_dir, "scale_orientation_guide.json")

    @property
    def validation_views(self) -> str:
        return _remote_child(self.reference_dir, "validation_views.json")

    @property
    def evaluation_config(self) -> str:
        return _remote_child(self.reference_dir, "evaluation_config.json")

    @property
    def software_launcher(self) -> str:
        return _remote_child(self.software_dir, "open_blender.bat")

    @property
    def blender_exe_candidates(self) -> list[str]:
        env_candidates = [
            os.environ.get("BLENDER_TASK_REMOTE_BLENDER", "").strip(),
            os.environ.get("BLENDER_501_EXECUTABLE", "").strip(),
        ]
        default_candidates = [
            _remote_child(PREFERRED_BLENDER_INSTALL_DIR, "blender.exe"),
            r"C:\Program Files\Blender Foundation\Blender 5.0\blender.exe",
            r"C:\Program Files\Blender Foundation\Blender 5.1\blender.exe",
            r"D:\Blender\Blender 5.0\blender.exe",
            _remote_child(self.software_dir, "Blender 5.0.1", "blender.exe"),
            _remote_child(self.software_dir, "blender.exe"),
        ]
        return _dedupe_paths(env_candidates + default_candidates)

    @property
    def task_description(self) -> str:
        return textwrap.dedent(f"""\
            You are a 3D artist using Blender on a Windows VM.

            Reconstruct the provided stylized character from the staged multiview references.

            Agent-visible input:
            - Modeling brief: `{_remote_child(self.input_dir, "modeling_brief.md")}`
            - Scale/orientation guide: `{_remote_child(self.input_dir, "scale_orientation_guide.json")}`
            - Validation camera guide: `{_remote_child(self.input_dir, "validation_views.json")}`
            - Views: `view_front.png`, `view_side.png`, `view_back.png`, `view_front_three_quarter.png`, `view_back_three_quarter.png`
            - Blender launcher: `{self.software_launcher}`

            Required submission under `{self.output_submission_dir}`:
            - `final.blend`
            - `reconstructed_character.glb`
            - `reconstructed_character.obj`
            - `modeling_report.md`

            Requirements:
            - Preserve the major full-body silhouette, proportions, and component structure.
            - Match the coordinate and scale guidance from `scale_orientation_guide.json`.
            - Treat the five staged views as the visual target.
            - Write the required deliverables only under the designated `output/submission/` path.
            """)

    def to_metadata(self) -> dict[str, Any]:
        data = super().to_metadata()
        data.update(
            {
                "task_id": TASK_ID,
                "input_dir": self.input_dir,
                "output_submission_dir": self.output_submission_dir,
                "output_blend": self.output_blend,
                "output_glb": self.output_glb,
                "output_obj": self.output_obj,
                "output_report": self.output_report,
                "reference_blend": self.reference_blend,
                "reference_glb": self.reference_glb,
                "reference_obj": self.reference_obj,
                "reference_report": self.reference_report,
                "scale_guide": self.scale_guide,
                "validation_views": self.validation_views,
                "evaluation_config": self.evaluation_config,
                "software_launcher": self.software_launcher,
                "blender_exe_candidates": self.blender_exe_candidates,
                "approved_blender_version": APPROVED_BLENDER_VERSION,
                "blender_exe": "",
            }
        )
        return data


config = BlenderCharacterTaskConfig()


class BlenderCharacterSetup(BaseTaskSetup):
    async def setup(self, task_cfg: Any, session: cb.DesktopSession) -> None:
        meta = task_cfg.metadata
        meta["blender_exe"] = await _resolve_blender_exe(
            session,
            list(meta.get("blender_exe_candidates") or []),
        )


_setup = BlenderCharacterSetup()


@cb.tasks_config(split="train")
def load():
    return [
        cb.Task(
            description=config.task_description,
            metadata=config.to_metadata(),
            computer={"provider": "computer", "setup_config": {"os_type": config.OS_TYPE}},
        )
    ]


@cb.setup_task(split="train")
async def start(task_cfg, session: cb.DesktopSession):
    await _setup(task_cfg, session)


async def _evaluate_impl(task_cfg, session: cb.DesktopSession) -> list[float]:
    meta = task_cfg.metadata
    scale_guide = await _read_json(session, meta["scale_guide"])
    views_config = await _read_json(session, meta["validation_views"])
    evaluation_config = await _read_json(session, meta["evaluation_config"])

    selected = {
        "name": "submission",
        "blend": meta["output_blend"],
        "glb": meta["output_glb"],
        "obj": meta["output_obj"],
        "report": meta["output_report"],
    }

    sizes = {}
    for key in ["blend", "glb", "obj", "report"]:
        size = await _remote_file_size(session, selected[key])
        sizes[key] = size
        if size is None or size <= 0:
            logger.error("Missing or empty required submission file: %s", selected[key])
            return [0.0]

    blender_exe = str(meta.get("blender_exe") or "").strip()
    if not blender_exe or not await session.file_exists(blender_exe):
        blender_exe = await _resolve_blender_exe(
            session,
            list(meta.get("blender_exe_candidates") or []),
        )
        meta["blender_exe"] = blender_exe

    blend_ok, blend_log = await _blend_can_open(
        session,
        blender_exe=blender_exe,
        blend_path=selected["blend"],
    )
    if not blend_ok:
        logger.error("Submitted blend did not open cleanly. log=%s", blend_log[-800:])
        return [0.0]

    await session.interface.create_dir(EVAL_TMP_DIR)
    helper_path = _remote_child(EVAL_TMP_DIR, "blender_eval_submission.py")
    metrics_path = _remote_child(EVAL_TMP_DIR, "submission_metrics.json")
    render_dir = _remote_child(EVAL_TMP_DIR, "renders")
    await session.write_file(
        helper_path,
        (TASK_DIR / "scripts" / "blender_eval_submission.py").read_text(encoding="utf-8"),
    )

    expected_render_names = [
        PureWindowsPath(str(view["output_image_path"])).name
        for view in views_config.get("per_view_cameras", [])
    ]
    eval_ready, eval_stdout, eval_stderr = await _run_blender_eval_submission(
        session,
        blender_exe=blender_exe,
        helper_path=helper_path,
        submission_obj=selected["obj"],
        views_config_path=meta["validation_views"],
        metrics_path=metrics_path,
        render_dir=render_dir,
        expected_render_names=expected_render_names,
    )
    if not eval_ready:
        logger.error(
            "Blender render helper timed out or left missing outputs. stdout_tail=%s stderr_tail=%s",
            eval_stdout[-800:],
            eval_stderr[-800:],
        )
        return [0.0]

    metrics = await _read_json(session, metrics_path)
    if metrics.get("mesh_object_count", 0) <= 0 or metrics.get("vertex_count", 0) <= 0:
        logger.error("Imported OBJ was empty or unreadable: %s", metrics)
        return [0.0]

    geometry = _geometry_similarity(
        await _read_bytes(session, meta["reference_obj"]),
        await _read_bytes(session, selected["obj"]),
        int(evaluation_config.get("geometry_downsample_limit", OBJ_SAMPLE_LIMIT_DEFAULT)),
    )
    bbox = _bbox_similarity(scale_guide, metrics)

    view_scores: list[dict[str, Any]] = []
    per_view = views_config.get("per_view_cameras", [])
    for view in per_view:
        output_name = PureWindowsPath(str(view["output_image_path"])).name
        reference_path = _remote_child(meta["reference_dir"], output_name)
        candidate_path = _remote_child(render_dir, output_name)
        if not (await session.file_exists(reference_path) or await session.directory_exists(reference_path)) or not (await session.file_exists(candidate_path) or await session.directory_exists(candidate_path)):
            logger.error(
                "Missing render pair for %s. ref_exists=%s cand_exists=%s",
                output_name,
                (await session.file_exists(reference_path) or await session.directory_exists(reference_path)),
                (await session.file_exists(candidate_path) or await session.directory_exists(candidate_path)),
            )
            return [0.0]
        similarity = _render_similarity(
            await _read_bytes(session, reference_path),
            await _read_bytes(session, candidate_path),
        )
        similarity["view_name"] = str(view["view_name"])
        view_scores.append(similarity)

    render_score = float(sum(item["combined"] for item in view_scores) / max(len(view_scores), 1))
    weights = evaluation_config["weights"]
    final_score = (
        float(weights["geometry_score"]) * geometry["score"]
        + float(weights["render_score"]) * render_score
        + float(weights["bbox_score"]) * bbox["score"]
    )

    payload = {
        "sizes": sizes,
        "blend_open_ok": blend_ok,
        "geometry": geometry,
        "bbox": bbox,
        "metrics": metrics,
        "view_scores": view_scores,
        "render_score": render_score,
        "final_score": final_score,
        "pass_threshold": float(evaluation_config["pass_threshold"]),
    }
    logger.info("Evaluation payload: %s", json.dumps(payload, ensure_ascii=False))
    return [float(final_score)]


@cb.evaluate_task(split="train")
async def evaluate(task_cfg, session: cb.DesktopSession) -> list[float]:
    # Defensive wrapper: the cua_bench evaluate_task wrapper masks any exception
    # raised inside the body as the opaque "'async_generator' object is not
    # iterable", hiding the real cause. Catch + log the real traceback and
    # degrade to 0.0 so a scoring bug surfaces in the task log instead of a
    # generic masked failure.
    try:
        return await _evaluate_impl(task_cfg, session)
    except Exception:
        logger.exception("[blender_char_recon] evaluate() raised; scoring as 0.0")
        return [0.0]
