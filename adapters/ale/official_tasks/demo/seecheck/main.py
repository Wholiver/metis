"""Demo task: ``demo/seecheck`` — does the screenshot image reach the model?

A deliberately tiny GUI task that isolates the vision bridge. ``setup`` renders
a unique ``SCREEN CODE`` (e.g. ``SCRN-7QX42K``) full-screen onto the desktop
wallpaper. The code is never written to any input file — it exists ONLY as
pixels on screen. The agent must:

  1. take a single screenshot,
  2. read the SCREEN CODE off the screen,
  3. write it (exact) to ``output/result.txt``.

If the agent's harness drops screenshot images before they reach the model
(e.g. the gemini-cli OpenRouter converter not emitting ``image_url``), the model
is blind and writes ``NO_IMAGE`` or a hallucinated string → score 0.0. When the
image is forwarded, the model reads the code → score 1.0. This is the smallest
end-to-end probe of the desktop GUI → model image path.

Self-contained: it stages no GCS data and writes no input/reference. The
expected code is a constant defined HERE (host-side, never on the VM and never
in the prompt), so the only way an agent can produce it is by reading the
screen — there is no file to ``cat``. setup() paints the constant; evaluate()
compares against it.
"""
from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass

import cua_bench as cb

from tasks.linux_runtime import LinuxTaskConfig, set_desktop_wallpaper

logger = logging.getLogger(__name__)

DOMAIN_NAME = "demo"
TASK_NAME = "seecheck"
VARIANT_NAME = "base"

# The ground-truth code. It lives ONLY here (host-side) and as pixels on the
# screen — never written to the VM filesystem and never put in the prompt — so
# an agent cannot obtain it without actually reading the screenshot. Fixed (not
# random) so setup() and evaluate() agree with no shared state and the check
# survives a mid-run session reconnect. Unambiguous chars (no O/0/I/1).
EXPECTED_CODE = "CODE-K7QF2M"
# Any prior plaintext token file from older task versions — removed defensively
# in setup() so a stale value can't linger on a long-lived dev VM.
_LEGACY_EXPECTED_PATH = "/home/user/.seecheck_expected"


@dataclass
class TaskConfig(LinuxTaskConfig):
    DOMAIN_NAME: str = DOMAIN_NAME
    TASK_NAME: str = TASK_NAME
    VARIANT_NAME: str = VARIANT_NAME

    @property
    def result_path(self) -> str:
        return f"{self.remote_output_dir}/result.txt"

    @property
    def task_description(self) -> str:
        return (
            "Vision check — a GUI task. The desktop shows a large code on a "
            "blue background, formatted as 'SCREEN CODE:' followed by a value "
            "like CODE-XXXXXX.\n\n"
            "1. Take exactly ONE screenshot of the desktop.\n"
            "2. Read the SCREEN CODE shown on screen.\n"
            f"3. Write that code, exactly, on a single line, to "
            f"{self.result_path}.\n\n"
            "The code is only visible on the screen — it is not in any file. "
            "If you receive no image / cannot see the screen at all, write "
            "exactly NO_IMAGE to that file instead."
        )

    def to_metadata(self) -> dict:
        m = super().to_metadata()
        m.update({
            "result_path": self.result_path,
        })
        return m


@cb.tasks_config(split="train")
def load():
    cfg = TaskConfig()
    return [cb.Task(
        description=cfg.task_description,
        metadata=cfg.to_metadata(),
        computer={
            "provider": "computer",
            "setup_config": {"os_type": cfg.OS_TYPE},
        },
    )]


@cb.setup_task(split="train")
async def start(task_cfg, session: cb.DesktopSession):
    """Paint a fresh SCREEN CODE onto the wallpaper; stash the truth."""
    meta = task_cfg.metadata
    out_dir = meta["remote_output_dir"]
    await session.run_command(f"mkdir -p {out_dir!r}", check=False)
    await session.run_command(f"rm -f {meta['result_path']!r}", check=False)
    # Defensively remove any stale plaintext token file from an older version.
    await session.run_command(f"rm -f {_LEGACY_EXPECTED_PATH!r}", check=False)

    code = EXPECTED_CODE
    text = f"SCREEN CODE:\\n{code}"
    # Unique path per run: GNOME no-ops if picture-uri is set to the SAME value
    # it already holds, so reusing one path leaves a stale/blank wallpaper on a
    # long-lived box. A fresh filename + clearing the key first forces a redraw.
    image_path = f"/tmp/seecheck_{uuid.uuid4().hex}.png"

    render = (
        f"convert -size 1920x1080 xc:'#0b3d91' -gravity center -fill white "
        f"-pointsize 130 -annotate +0+0 '{text}' {image_path}"
    )
    r = await session.run_command(render, check=False)
    if r["return_code"] != 0:
        raise RuntimeError(f"[seecheck] render failed: {(r.get('stderr') or '')[:300]}")

    # Paint it on whichever desktop is live — GNOME on the VM, XFCE in the
    # docker container. (The old bare gsettings call only worked on GNOME; the
    # helper also drives XFCE's xfconf and uses the inherited session bus.)
    await set_desktop_wallpaper(session, image_path)

    logger.info("[seecheck] painted SCREEN CODE %s onto the wallpaper", code)


@cb.evaluate_task(split="train")
async def evaluate(task_cfg, session: cb.DesktopSession) -> list[float]:
    """Exact-match the code the agent transcribed from the screen."""
    meta = task_cfg.metadata
    expected = EXPECTED_CODE

    try:
        actual = (await session.read_file(meta["result_path"])).strip()
    except Exception as exc:
        logger.info("[seecheck] output unreadable at %s: %s", meta["result_path"], exc)
        return [0.0]

    if actual.upper() == expected.upper():
        logger.info("[seecheck] PASS — model read the screen code %r", expected)
        return [1.0]
    logger.info("[seecheck] FAIL — got %r, expected %r (NO_IMAGE => image never "
                "reached the model)", actual[:80], expected)
    return [0.0]
