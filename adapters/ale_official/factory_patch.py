#!/usr/bin/env python3
"""Register Metis in an ALE checkout's agent factory (optional shortcut).

ALE already accepts fully-qualified deployer class paths in ``harness:``, so
this patch is optional convenience:

    harness: metis

instead of:

    harness: adapters.ale_official.deployer.MetisDeployer

Requirements:
- Metis repo root on ``PYTHONPATH``
- ALE checkout path via ``--ale-root``

Never embeds secrets. Idempotent.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

SHORTCUT = "metis"
FQN = "adapters.ale_official.deployer.MetisDeployer"
MARKER_BEGIN = "# BEGIN metis ale_official factory patch"
MARKER_END = "# END metis ale_official factory patch"


def patch_factory(factory_path: Path) -> bool:
	text = factory_path.read_text(encoding="utf-8")
	if f'"{SHORTCUT}":' in text and FQN in text:
		print(f"already registered: {SHORTCUT} -> {FQN}")
		return False

	# Prefer inserting into the _AGENT_FQNS literal.
	pattern = re.compile(r'(_AGENT_FQNS:\s*dict\[str,\s*str\]\s*=\s*\{)', re.M)
	match = pattern.search(text)
	if not match:
		raise SystemExit(f"could not find _AGENT_FQNS in {factory_path}")

	insert = (
		f'{match.group(1)}\n'
		f'    {MARKER_BEGIN}\n'
		f'    "{SHORTCUT}": "{FQN}",\n'
		f'    {MARKER_END}'
	)
	# Avoid double-wrapping if begin marker exists without FQN (corrupt).
	if MARKER_BEGIN in text:
		text = re.sub(
			rf"{re.escape(MARKER_BEGIN)}.*?{re.escape(MARKER_END)}",
			f'{MARKER_BEGIN}\n    "{SHORTCUT}": "{FQN}",\n    {MARKER_END}',
			text,
			count=1,
			flags=re.S,
		)
	else:
		text = pattern.sub(insert, text, count=1)

	factory_path.write_text(text, encoding="utf-8")
	print(f"patched {factory_path}: {SHORTCUT} -> {FQN}")
	return True


def main(argv: list[str] | None = None) -> int:
	parser = argparse.ArgumentParser(description=__doc__)
	parser.add_argument(
		"--ale-root",
		type=Path,
		required=True,
		help="Path to agents-last-exam checkout",
	)
	parser.add_argument(
		"--dry-run",
		action="store_true",
		help="Print target path only",
	)
	args = parser.parse_args(argv)

	factory = args.ale_root / "ale_run" / "orchestration" / "factory.py"
	if not factory.is_file():
		print(f"error: factory not found at {factory}", file=sys.stderr)
		return 2
	if args.dry_run:
		print(factory)
		return 0
	patch_factory(factory)
	return 0


if __name__ == "__main__":
	raise SystemExit(main())
