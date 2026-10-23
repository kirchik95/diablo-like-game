"""End-to-end tests for the create-game-assets raster helpers.

Locally modified for diablo-like-game: run from the installed skill directory
and cover exact and exceeded palette limits.
"""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

try:  # Pillow is only needed by the bundled asset helpers, not the validator.
    from PIL import Image, ImageDraw

    PILLOW_AVAILABLE = True
except ModuleNotFoundError:  # pragma: no cover - exercised on machines without Pillow
    Image = ImageDraw = None
    PILLOW_AVAILABLE = False


ROOT = Path(__file__).resolve().parents[1]
REPORT = ROOT / "scripts" / "asset_report.py"
PREVIEW = ROOT / "scripts" / "build_preview_sheet.py"


@unittest.skipUnless(
    PILLOW_AVAILABLE,
    "Pillow is not installed; run "
    "pip install -r .claude/skills/create-game-assets/scripts/requirements.txt",
)
class AssetToolTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name)
        self.asset = self.root / "sprite.png"
        image = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
        ImageDraw.Draw(image).rectangle((4, 3, 11, 14), fill=(220, 70, 90, 255))
        image.save(self.asset)

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def run_tool(self, script: Path, *args: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [sys.executable, str(script), *args],
            check=False,
            capture_output=True,
            text=True,
        )

    def test_asset_report_passes_and_emits_json(self) -> None:
        result = self.run_tool(
            REPORT,
            str(self.asset),
            "--expect-size",
            "16x16",
            "--require-alpha",
            "--max-colors",
            "4",
            "--json",
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["assets"][0]["content_bounds"], [4, 3, 12, 15])

    def test_asset_report_fails_a_constraint(self) -> None:
        result = self.run_tool(REPORT, str(self.asset), "--expect-size", "32x32")

        self.assertEqual(result.returncode, 1)
        self.assertIn("expected 32x32", result.stdout)


    def test_asset_report_color_limit_boundaries(self) -> None:
        for color_count in (1, 2, 3, 4):
            with self.subTest(color_count=color_count):
                asset = self.root / f"palette-{color_count}.png"
                image = Image.new("RGBA", (color_count, 1))
                image.putdata([(index * 50, 30, 90, 255) for index in range(color_count)])
                image.save(asset)

                result = self.run_tool(
                    REPORT, str(asset), "--max-colors", "2", "--json"
                )
                payload = json.loads(result.stdout)
                expected_ok = color_count <= 2
                self.assertEqual(result.returncode, 0 if expected_ok else 1, result.stdout)
                self.assertEqual(payload["ok"], expected_ok)
                if not expected_ok:
                    self.assertIn(
                        "image has more than 2 colors",
                        payload["assets"][0]["problems"],
                    )

    def test_preview_sheet_is_created(self) -> None:
        output = self.root / "preview.png"
        result = self.run_tool(
            PREVIEW,
            str(self.asset),
            "--out",
            str(output),
            "--columns",
            "1",
            "--cell-size",
            "64",
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        with Image.open(output) as image:
            self.assertEqual(image.size, (88, 112))


if __name__ == "__main__":
    unittest.main()
