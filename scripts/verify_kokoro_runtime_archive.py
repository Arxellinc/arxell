#!/usr/bin/env python3
from __future__ import annotations

import platform
import sys
import zipfile
from pathlib import Path


def expected_archive_name() -> str:
    system = platform.system().lower()
    machine = platform.machine().lower()
    if machine in {"amd64", "x86_64", "x64"}:
        arch = "x86_64"
    elif machine in {"arm64", "aarch64"}:
        arch = "aarch64"
    else:
        raise RuntimeError(f"Unsupported architecture: {machine}")

    if system == "linux":
        os_tag = "linux"
    elif system == "darwin":
        os_tag = "macos"
    elif system == "windows":
        os_tag = "windows"
    else:
        raise RuntimeError(f"Unsupported platform: {system}")

    return f"kokoro-runtime-{os_tag}-{arch}.zip"


def main() -> int:
    repo_root = Path(__file__).resolve().parent.parent
    archive = repo_root / "src-tauri" / "resources" / "kokoro-runtime" / expected_archive_name()
    if not archive.exists() or archive.stat().st_size < 1024:
        print(
            "ERROR: Bundled Kokoro runtime archive is missing for this build target:\n"
            f"  expected: {archive}\n"
            "Run scripts/prepare_kokoro_runtime.py before packaging.",
            file=sys.stderr,
        )
        return 1
    with zipfile.ZipFile(archive, "r") as zf:
        names = {n for n in zf.namelist() if not n.endswith("/")}
    expected_any = (
        {"python.exe", "Scripts/python.exe", "bin/python.exe"}
        if platform.system().lower() == "windows"
        else {"bin/python3", "bin/python"}
    )
    if not any(name in names for name in expected_any):
        print(
            "ERROR: Runtime archive does not contain an expected Python interpreter path.\n"
            f"  expected one of: {sorted(expected_any)}\n"
            f"  archive: {archive}",
            file=sys.stderr,
        )
        return 1
    print(f"Kokoro runtime archive present: {archive}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
