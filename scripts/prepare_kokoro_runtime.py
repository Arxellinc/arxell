#!/usr/bin/env python3
"""Prepare a bundled Kokoro runtime archive for the current OS/arch.

This script expects a local Python interpreter with pip available.
It installs requirements into a standalone venv and zips that venv to:
  src-tauri/resources/kokoro-runtime/kokoro-runtime-{os}-{arch}.zip
"""

from __future__ import annotations

import argparse
import os
import platform
import shutil
import subprocess
import tempfile
import zipfile
from pathlib import Path


def detect_tags() -> tuple[str, str]:
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

    return os_tag, arch


def run(cmd: list[str], cwd: Path | None = None) -> None:
    subprocess.run(cmd, cwd=str(cwd) if cwd else None, check=True)


def find_python(venv_dir: Path) -> Path:
    if os.name == "nt":
        return venv_dir / "Scripts" / "python.exe"
    return venv_dir / "bin" / "python3"


def zip_runtime(runtime_root: Path, archive_path: Path) -> None:
    archive_path.parent.mkdir(parents=True, exist_ok=True)
    if archive_path.exists():
        archive_path.unlink()
    with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for path in sorted(runtime_root.rglob("*")):
            if not path.is_file():
                continue
            rel = path.relative_to(runtime_root)
            zf.write(path, rel.as_posix())


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--python", default="python3" if os.name != "nt" else "python")
    parser.add_argument(
        "--requirements",
        default="scripts/kokoro-runtime-requirements.txt",
    )
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parent.parent
    requirements = (repo_root / args.requirements).resolve()
    if not requirements.exists():
        raise RuntimeError(f"Missing requirements file: {requirements}")

    os_tag, arch = detect_tags()
    archive_path = (
        repo_root
        / "src-tauri"
        / "resources"
        / "kokoro-runtime"
        / f"kokoro-runtime-{os_tag}-{arch}.zip"
    )

    with tempfile.TemporaryDirectory(prefix="kokoro-runtime-") as td:
        tmp = Path(td)
        venv_dir = tmp / "venv"
        run([args.python, "-m", "venv", str(venv_dir)])
        venv_python = find_python(venv_dir)
        run([str(venv_python), "-m", "pip", "install", "--upgrade", "pip"])
        run([str(venv_python), "-m", "pip", "install", "-r", str(requirements)])
        run([
            str(venv_python),
            "-c",
            "import kokoro_onnx, onnxruntime, numpy; print('ok')",
        ])

        runtime_root = tmp / "runtime-root"
        shutil.copytree(venv_dir, runtime_root)
        zip_runtime(runtime_root, archive_path)

    print(f"Created runtime archive: {archive_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
