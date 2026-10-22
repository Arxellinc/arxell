import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / "desktop_launch_smoke.py"


CHECKS = {key: True for key in (
    "dataImageDecoded", "blobImageDecoded", "dataAudioLoaded", "blobAudioLoaded",
    "dataFetchLoaded", "blobFetchLoaded", "inlineStyleApplied", "inlineScriptBlocked",
)}


def report_code(payload):
    return ("import os,time; from pathlib import Path; "
            f"Path(os.environ['ARXELL_DESKTOP_SMOKE_REPORT']).write_text({json.dumps(payload)!r}); time.sleep(60)")


class DesktopSmokeTests(unittest.TestCase):
    def launch(self, code, root):
        return subprocess.run([
            sys.executable, str(SCRIPT), "--require-report", "--timeout", "0.4",
            "--output", root, "--", sys.executable, "-c", code,
        ], capture_output=True, text=True, timeout=8)

    def test_live_process_without_renderer_report_fails(self):
        with tempfile.TemporaryDirectory() as root:
            result = self.launch("import time; time.sleep(60)", root)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("handshake missing", result.stderr)

    def test_renderer_ipc_report_passes(self):
        with tempfile.TemporaryDirectory() as root:
            result = self.launch(report_code({
                "frontendRendered": True, "ipcVersion": "0.2.12", "checks": CHECKS,
            }), root)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("renderer + Rust IPC", result.stdout)

    def test_old_layout_only_report_does_not_pass(self):
        with tempfile.TemporaryDirectory() as root:
            result = self.launch(report_code({"frontendRendered": True, "ipcVersion": "0.2.12"}), root)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("handshake missing", result.stderr)

    def test_each_dom_or_media_check_is_required_and_must_be_true(self):
        for key in CHECKS:
            for replacement in (None, False, "true"):
                with self.subTest(key=key, replacement=replacement), tempfile.TemporaryDirectory() as root:
                    checks = dict(CHECKS)
                    if replacement is None:
                        del checks[key]
                    else:
                        checks[key] = replacement
                    result = self.launch(report_code({
                        "frontendRendered": True, "ipcVersion": "0.2.12", "checks": checks,
                    }), root)
                    self.assertNotEqual(result.returncode, 0)
                    self.assertIn("handshake missing", result.stderr)

    def test_malformed_report_does_not_pass(self):
        with tempfile.TemporaryDirectory() as root:
            result = self.launch(
                "import os,time; from pathlib import Path; "
                "Path(os.environ['ARXELL_DESKTOP_SMOKE_REPORT']).write_text('incomplete-json'); time.sleep(60)", root)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("handshake missing", result.stderr)

    def test_early_exit_fails(self):
        with tempfile.TemporaryDirectory() as root:
            result = self.launch("raise SystemExit(7)", root)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("exited during startup", result.stderr)


if __name__ == "__main__":
    unittest.main()
