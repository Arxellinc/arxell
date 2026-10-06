import hashlib
import io
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from model_assets import download


class ModelAssetsTests(unittest.TestCase):
    def test_verified_download_and_cache_reuse(self):
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / "model.bin"
            expected = hashlib.sha256(b"model").hexdigest()
            with patch("urllib.request.urlopen", return_value=io.BytesIO(b"model")) as request:
                download("https://fixture.invalid/model", path, expected)
                download("https://fixture.invalid/model", path, expected)
                self.assertEqual(request.call_count, 1)
                self.assertEqual(path.read_bytes(), b"model")

    def test_corrupt_download_does_not_replace_previous_or_leave_partial(self):
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / "model.bin"
            path.write_bytes(b"previous")
            with patch("urllib.request.urlopen", return_value=io.BytesIO(b"corrupt")):
                with self.assertRaisesRegex(RuntimeError, "checksum mismatch"):
                    download("https://fixture.invalid/model", path, "0" * 64)
            self.assertEqual(path.read_bytes(), b"previous")
            self.assertEqual(list(Path(root).iterdir()), [path])


if __name__ == "__main__":
    unittest.main()
