from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / "desktop_launch_smoke.py"


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
            result = self.launch(
                "import os,json,time; from pathlib import Path; "
                "Path(os.environ['ARXELL_DESKTOP_SMOKE_REPORT']).write_text(json.dumps({'frontendRendered':True,'ipcVersion':'0.2.12'})); time.sleep(60)", root)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("renderer + Rust IPC", result.stdout)

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
