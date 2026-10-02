import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("verify_runtime_bundle", ROOT / "scripts/verify_runtime_bundle.py")
policy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(policy)


class RuntimePackagingTests(unittest.TestCase):
    def test_cmake_requires_explicit_native_off(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "CMakeCache.txt"
            for value in ["ON", "TRUE", "", "OFF"]:
                with self.subTest(value=value):
                    path.write_text("GGML_NATIVE:BOOL=" + value + "\n")
                    if value == "OFF":
                        policy.verify_cmake_cache(path)
                    else:
                        with self.assertRaises(RuntimeError):
                            policy.verify_cmake_cache(path)
            path.write_text("# missing policy\n")
            with self.assertRaises(RuntimeError):
                policy.verify_cmake_cache(path)

    def create_bundle(self, root, native=False):
        (root / "manifest.json").write_text(json.dumps({
            "releaseTag": "v0.4.1", "ggmlNative": native,
            "libgompPackageVersion": "test-version"
        }))
        for engine in ["llama.cpp-cpu", "llama.cpp-vulkan"]:
            directory = root / engine
            directory.mkdir()
            (directory / "llama-server").touch()
            (directory / "libgomp.so.1").touch()

    def test_stale_and_native_caches_rejected_before_execution(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with patch.object(policy.subprocess, "run") as run:
                for value in [True, None, "OFF", 0]:
                    (root / "manifest.json").write_text(json.dumps({"releaseTag": "v0.4.1", "ggmlNative": value}))
                    with self.assertRaisesRegex(RuntimeError, "portable build policy"):
                        policy.verify_bundle(root, "llama", "Linux", "v0.4.1")
                run.assert_not_called()

    def test_wrong_release_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.create_bundle(root)
            with self.assertRaisesRegex(RuntimeError, "Expected llama"):
                policy.verify_bundle(root, "llama", "Linux", "v0.4.2")

    def test_missing_openmp_closure_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.create_bundle(root)
            (root / "llama.cpp-cpu/libgomp.so.1").unlink()
            with self.assertRaisesRegex(RuntimeError, "OpenMP"):
                policy.verify_bundle(root, "llama", "Linux", "v0.4.1")

    def test_signal_failure_is_not_treated_as_success(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.create_bundle(root)
            with patch.object(policy.subprocess, "run", return_value=subprocess.CompletedProcess([], -4, "", "")):
                with self.assertRaisesRegex(RuntimeError, r"failed \(-4\)"):
                    policy.verify_bundle(root, "llama", "Linux", "v0.4.1")

    def test_loader_does_not_borrow_previous_engine_directories(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.create_bundle(root)
            with patch.dict(policy.os.environ, {"LD_LIBRARY_PATH": "/wrong/build-tree"}), patch.object(
                policy.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, "", "")
            ) as run:
                policy.verify_bundle(root, "llama", "Linux", "v0.4.1")
                self.assertEqual(run.call_count, 2)
                for call in run.call_args_list:
                    self.assertEqual(call.kwargs["timeout"], 30)
                    self.assertEqual(call.kwargs["env"]["LD_LIBRARY_PATH"], str(Path(call.args[0][0]).parent))

    def test_whisper_cache_policy_and_help_checked(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "manifest.json").write_text(json.dumps({"releaseTag": "v1.9.4", "ggmlNative": False, "libgompPackageVersion": "test-version"}))
            (root / "whisper-server-linux-x86_64").touch()
            (root / "libgomp.so.1").touch()
            with patch.object(policy.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, "", "")) as run:
                policy.verify_bundle(root, "whisper", "Linux", "v1.9.4")
                self.assertEqual(run.call_args.args[0][1], "--help")

    def test_platform_overrides_keep_notices_and_linux_licenses(self):
        base = json.loads((ROOT / "src-tauri/tauri.conf.json").read_text())
        self.assertIn("resources/THIRD_PARTY_NOTICES.md", base["bundle"]["resources"])
        for platform in ["linux", "windows", "macos"]:
            config = json.loads((ROOT / f"src-tauri/tauri.{platform}.conf.json").read_text())
            self.assertIn("resources/THIRD_PARTY_NOTICES.md", config["bundle"]["resources"])
            if platform == "linux":
                self.assertIn("resources/licenses/*", config["bundle"]["resources"])
        source = (ROOT / "THIRD_PARTY_NOTICES.md").read_bytes()
        self.assertEqual(source, (ROOT / "src-tauri/resources/THIRD_PARTY_NOTICES.md").read_bytes())
        self.assertIn(b"GNU OpenMP", source)
        self.assertIn(b"Tauri Opener", source)


if __name__ == "__main__":
    unittest.main()
