import importlib.util
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))
spec = importlib.util.spec_from_file_location("packaged_runtime_smoke", ROOT / "scripts/packaged_runtime_smoke.py")
smoke = importlib.util.module_from_spec(spec)
spec.loader.exec_module(smoke)


class PackagedRuntimeSmokeTests(unittest.TestCase):
    def test_early_server_exit_fails_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            binary = root / "fake-server"
            log = root / "server.log"

            class ExitedProcess:
                returncode = 3

                def poll(self):
                    return 3

                def terminate(self):
                    pass

                def wait(self, timeout=None):
                    return 3

            with patch.object(smoke.subprocess, "Popen", return_value=ExitedProcess()):
                with self.assertRaisesRegex(RuntimeError, "Packaged fake-server exited: 3"):
                    smoke.run_server(binary, [], lambda _: None, log)

    def test_missing_bundled_whisper_model_fails_before_server_launch(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            resources = root / "resources"
            (resources / "llama-runtime/llama.cpp-cpu").mkdir(parents=True)
            (resources / "llama-runtime/llama.cpp-cpu/llama-server").write_text("", encoding="utf-8")
            (resources / "whisper-server").mkdir(parents=True)
            for name in [
                "whisper-server-linux-x86_64",
                "whisper-server-macos-aarch64",
                "whisper-server-windows-x86_64.exe",
            ]:
                (resources / "whisper-server" / name).write_text("", encoding="utf-8")
            output = root / "out"

            def fake_download(_url, destination, _expected):
                path = Path(destination)
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(b"fixture")
                return path

            with patch.object(smoke, "download", side_effect=fake_download), patch.object(
                sys, "argv", ["packaged_runtime_smoke.py", str(resources), "--output", str(output)]
            ):
                with self.assertRaisesRegex(RuntimeError, "Bundled Tiny English model missing"):
                    smoke.main()


if __name__ == "__main__":
    unittest.main()
