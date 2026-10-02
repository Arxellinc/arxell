import hashlib
import importlib.util
from pathlib import Path
import shutil
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("release_checksums", ROOT / "scripts/generate_release_checksums.py")
checksums = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checksums)


class ReleaseChecksumsTests(unittest.TestCase):
    def test_nested_artifacts_verify_as_flat_downloads(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "artifacts"
            downloads = Path(directory) / "downloads"
            downloads.mkdir()
            for name in ["linux/Arxell.deb", "macos/Arxell.dmg", "windows/Arxell setup.msi"]:
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(name.encode())
                shutil.copy2(path, downloads / path.name)
            lines = checksums.checksum_lines(root)
            self.assertEqual(len(lines), 3)
            for line in lines:
                digest, name = line.rstrip("\n").split("  ", 1)
                self.assertNotIn("/", name)
                self.assertEqual(hashlib.sha256((downloads / name).read_bytes()).hexdigest(), digest)

    def test_duplicate_case_insensitive_asset_names_fail(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name in ["one/Arxell.deb", "two/arxell.deb"]:
                path = root / name
                path.parent.mkdir()
                path.touch()
            with self.assertRaisesRegex(ValueError, "Ambiguous"):
                checksums.checksum_lines(root)

    def test_empty_asset_directory_fails(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(ValueError, "No installer"):
                checksums.checksum_lines(Path(directory))


if __name__ == "__main__":
    unittest.main()
