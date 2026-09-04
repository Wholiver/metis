"""Demo task: ``demo/seecheck_win`` (Windows) — does the screenshot reach the model?

Windows counterpart of ``demo/seecheck``. Same intent — isolate the vision
bridge — but rendered with native Windows facilities instead of ImageMagick +
GNOME:

  * ``setup`` draws a unique ``SCREEN CODE`` onto a bitmap via .NET
    ``System.Drawing``, sets it as the desktop wallpaper via
    ``SystemParametersInfo``, and minimizes all windows so the wallpaper is the
    visible desktop. The code exists ONLY as pixels.
  * The agent must take ONE screenshot, read the code, and write it (exact) to
    ``output\\result.txt``.

If the harness drops screenshot images before they reach the model, the model is
blind → writes ``NO_IMAGE`` / a hallucination → score 0.0. When forwarded, it
reads the code → 1.0. Smallest end-to-end probe of the Windows desktop → model
image path (the cua-verse/hermes-agent fork's whole reason to exist).

Self-contained (``REQUIRES_TASK_DATA = False``): stages no data, writes no
input/reference. The expected code is a constant defined HERE (host-side, never
on the VM and never in the prompt), so the only way an agent can produce it is
by reading the screen — there is no file to read. setup() paints the constant;
evaluate() compares against it.
"""
from __future__ import annotations

import base64
import logging
import uuid
from dataclasses import dataclass

import cua_bench as cb

from tasks.common_config import GeneralTaskConfig

logger = logging.getLogger(__name__)

DOMAIN_NAME = "demo"
TASK_NAME = "seecheck_win"
VARIANT_NAME = "base"

# The ground-truth code. It lives ONLY here (host-side) and as pixels on the
# screen — never written to the VM filesystem and never put in the prompt — so
# an agent cannot obtain it without actually reading the screenshot. Fixed (not
# random) so setup() and evaluate() agree with no shared state and the check
# survives a mid-run session reconnect. Distinct from the Linux variant's code.
# Unambiguous chars (no O/0/I/1).
EXPECTED_CODE = "CODE-W4XJ9R"
# Any prior plaintext token file from older task versions — removed defensively
# in setup() so a stale value can't linger on a long-lived dev VM.
_LEGACY_EXPECTED_PATH = r"C:\Users\User\.seecheck_win_expected"


@dataclass
class TaskConfig(GeneralTaskConfig):
    DOMAIN_NAME: str = DOMAIN_NAME
    TASK_NAME: str = TASK_NAME
    VARIANT_NAME: str = VARIANT_NAME
    OS_TYPE: str = "windows"
    REQUIRES_TASK_DATA: bool = False

    @property
    def result_path(self) -> str:
        return rf"{self.remote_output_dir}\result.txt"

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


def _ps_encoded(script: str) -> str:
    """Wrap a PowerShell script as ``powershell -EncodedCommand <b64>``.

    EncodedCommand takes UTF-16LE base64 — this sidesteps all cmd/PowerShell
    quoting hazards for the multi-line render script run over cua run_command.
    """
    b64 = base64.b64encode(script.encode("utf-16-le")).decode("ascii")
    return f"powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand {b64}"


def _ps_quote(path: str) -> str:
    return path.replace("'", "''")


@cb.setup_task(split="train")
async def start(task_cfg, session: cb.DesktopSession):
    """Paint a fresh SCREEN CODE onto the wallpaper; stash the truth."""
    meta = task_cfg.metadata
    out_dir = meta["remote_output_dir"]
    await session.run_command(
        f"powershell -NoProfile -Command \"New-Item -ItemType Directory -Force "
        f"-Path '{_ps_quote(out_dir)}' | Out-Null\"",
        check=False,
    )
    await session.run_command(
        f"powershell -NoProfile -Command \"Remove-Item -Force -ErrorAction "
        f"SilentlyContinue '{_ps_quote(meta['result_path'])}',"
        f"'{_ps_quote(_LEGACY_EXPECTED_PATH)}'\"",
        check=False,
    )

    code = EXPECTED_CODE
    # Unique path per run: SystemParametersInfo may skip a redraw if the path is
    # unchanged from a prior run, leaving a stale wallpaper on a long-lived box.
    image_path = rf"C:\Users\User\seecheck_{uuid.uuid4().hex}.bmp"

    # Render the code to a bitmap, set it as wallpaper, minimize all windows so
    # the desktop (wallpaper) is what a screenshot captures.
    script = f"""
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$code = '{code}'
$path = '{_ps_quote(image_path)}'
$bmp = New-Object System.Drawing.Bitmap(1920,1080)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.Clear([System.Drawing.Color]::FromArgb(11,61,145))
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAlias
$font = New-Object System.Drawing.Font('Arial',90,[System.Drawing.FontStyle]::Bold)
$fmt = New-Object System.Drawing.StringFormat
$fmt.Alignment = [System.Drawing.StringAlignment]::Center
$fmt.LineAlignment = [System.Drawing.StringAlignment]::Center
$rect = New-Object System.Drawing.RectangleF(0,0,1920,1080)
$g.DrawString("SCREEN CODE:`n$code", $font, [System.Drawing.Brushes]::White, $rect, $fmt)
$g.Dispose()
$bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Bmp)
$bmp.Dispose()
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Wp {{
  [DllImport("user32.dll", CharSet=CharSet.Auto)]
  public static extern int SystemParametersInfo(int uAction, int uParam, string lpvParam, int fuWinIni);
}}
"@
# SPI_SETDESKWALLPAPER=20, SPIF_UPDATEINIFILE|SPIF_SENDWININICHANGE=3
[Wp]::SystemParametersInfo(20, 0, $path, 3) | Out-Null
# Hide desktop icons so they don't obscure the code (the licensed-software dev
# image has a dense icon grid right over the centre). Restarting Explorer applies
# HideIcons and re-renders the wallpaper cleanly; it auto-restarts the taskbar.
Set-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced' -Name HideIcons -Value 1
Stop-Process -Name explorer -Force
Start-Sleep -Seconds 3
try {{ (New-Object -ComObject Shell.Application).MinimizeAll() }} catch {{}}
"""
    r = await session.run_command(_ps_encoded(script), check=False)
    if r["return_code"] != 0:
        raise RuntimeError(
            f"[seecheck_win] render/setwallpaper failed: "
            f"{(r.get('stderr') or r.get('stdout') or '')[:300]}"
        )
    logger.info("[seecheck_win] painted SCREEN CODE onto the wallpaper")


@cb.evaluate_task(split="train")
async def evaluate(task_cfg, session: cb.DesktopSession) -> list[float]:
    """Exact-match the code the agent transcribed from the screen."""
    meta = task_cfg.metadata
    expected = EXPECTED_CODE

    try:
        actual = (await session.read_file(meta["result_path"])).strip()
    except Exception as exc:
        logger.info("[seecheck_win] output unreadable at %s: %s", meta["result_path"], exc)
        return [0.0]

    if actual.upper() == expected.upper():
        logger.info("[seecheck_win] PASS — model read the screen code %r", expected)
        return [1.0]
    logger.info("[seecheck_win] FAIL — got %r, expected %r (NO_IMAGE => image never "
                "reached the model)", actual[:80], expected)
    return [0.0]
