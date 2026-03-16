#!/usr/bin/env python3
"""Prepare bundled Kokoro runtime artifacts for Tauri release builds."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path


GITHUB_API_LATEST = (
    "https://api.github.com/repos/astral-sh/python-build-standalone/releases/latest"
)


def _detect_target() -> tuple[str, str, str]:
    system = platform.system().lower()
    machine = platform.machine().lower()
    if machine in {"amd64", "x86_64", "x64"}:
        arch = "x86_64"
    elif machine in {"arm64", "aarch64"}:
        arch = "aarch64"
    else:
        raise RuntimeError(f"Unsupported architecture: {machine}")

    if system == "linux":
        target = f"{arch}-unknown-linux-gnu"
        os_tag = "linux"
    elif system == "darwin":
        target = f"{arch}-apple-darwin"
        os_tag = "macos"
    elif system == "windows":
        target = f"{arch}-pc-windows-msvc"
        os_tag = "windows"
    else:
        raise RuntimeError(f"Unsupported platform: {system}")
    return target, os_tag, arch


def _download(url: str, dest: Path) -> None:
    req = urllib.request.Request(url, headers=_request_headers(api=False))
    with urllib.request.urlopen(req) as resp, dest.open("wb") as out:
        shutil.copyfileobj(resp, out)


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def _request_headers(*, api: bool) -> dict[str, str]:
    headers = {"User-Agent": "arx-kokoro-runtime-prep"}
    token = (os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN") or "").strip()
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if api:
        headers["Accept"] = "application/vnd.github+json"
        headers["X-GitHub-Api-Version"] = "2022-11-28"
    return headers


def _fetch_latest_pbs_asset(target: str, python_series: str) -> tuple[str, str]:
    req = urllib.request.Request(GITHUB_API_LATEST, headers=_request_headers(api=True))
    with urllib.request.urlopen(req) as resp:
        payload = json.load(resp)

    assets = payload.get("assets", [])
    escaped_target = re.escape(target)
    escaped_series = re.escape(python_series)
    strict = re.compile(
        rf"^cpython-{escaped_series}\.\d+\+.*-{escaped_target}-install_only\.tar\.gz$"
    )
    relaxed = re.compile(rf"^cpython-.*-{escaped_target}-install_only\.tar\.gz$")

    for pattern in (strict, relaxed):
        for asset in assets:
            name = asset.get("name", "")
            if pattern.match(name):
                return asset["browser_download_url"], name

    raise RuntimeError(
        f"No python-build-standalone install_only asset found for target {target}"
    )


def _find_python_binary(root: Path) -> Path:
    candidates: list[Path] = []
    for path in root.rglob("*"):
        if not path.is_file():
            continue
        name = path.name.lower()
        if name in {"python", "python3", "python.exe"}:
            candidates.append(path)
    if not candidates:
        raise RuntimeError("Could not locate extracted standalone python binary")

    def score(p: Path) -> tuple[int, int]:
        # Prefer install/bin python binaries over unrelated files.
        s = str(p).lower()
        return (int("install" in s), int("/bin/" in s or "\\bin\\" in s))

    candidates.sort(key=score, reverse=True)
    return candidates[0]


def _venv_python(venv_dir: Path) -> Path:
    if os.name == "nt":
        return venv_dir / "Scripts" / "python.exe"
    for cand in (venv_dir / "bin" / "python3", venv_dir / "bin" / "python"):
        if cand.exists():
            return cand
    return venv_dir / "bin" / "python3"


def _run(cmd: list[str], *, cwd: Path | None = None, input_text: str | None = None) -> None:
    subprocess.run(
        cmd,
        cwd=str(cwd) if cwd else None,
        check=True,
        input=input_text,
        text=input_text is not None,
    )


def _zip_runtime(venv_dir: Path, archive_path: Path) -> None:
    archive_path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for file_path in sorted(venv_dir.rglob("*")):
            if not file_path.is_file():
                continue
            rel = file_path.relative_to(venv_dir)
            arcname = Path("venv") / rel
            info = zipfile.ZipInfo.from_file(file_path, arcname=str(arcname))
            if os.name != "nt" and os.access(file_path, os.X_OK):
                info.external_attr = (0o755 & 0xFFFF) << 16
            else:
                info.external_attr = (0o644 & 0xFFFF) << 16
            with file_path.open("rb") as src:
                zf.writestr(info, src.read(), compress_type=zipfile.ZIP_DEFLATED)


def _smoke_test(
    venv_python: Path, repo_root: Path, model_path: Path, voices_path: Path
) -> None:
    _run(
        [
            str(venv_python),
            "-c",
            "import kokoro_onnx, soundfile, onnxruntime; print('ok')",
        ]
    )

    tts_script = repo_root / "src-tauri" / "resources" / "scripts" / "voice" / "tts_kokoro.py"
    p = subprocess.run(
        [
            str(venv_python),
            str(tts_script),
            "--model",
            str(model_path),
            "--voices",
            str(voices_path),
            "--voice",
            "af_heart",
        ],
        input=b"Runtime smoke test",
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=True,
    )
    if len(p.stdout) < 128:
        raise RuntimeError(
            f"Synthesis smoke test output too small ({len(p.stdout)} bytes): "
            f"{p.stderr.decode('utf-8', errors='ignore')}"
        )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--runtime-out", required=True)
    parser.add_argument("--model-out", required=True)
    parser.add_argument("--python-series", default="3.11")
    parser.add_argument(
        "--requirements",
        default=str(Path("scripts") / "kokoro-runtime-requirements.txt"),
    )
    parser.add_argument(
        "--pbs-asset-url",
        default=os.environ.get("KOKORO_PBS_ASSET_URL", "").strip(),
        help="Optional direct URL for python-build-standalone install_only archive.",
    )
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parent.parent
    runtime_out = (repo_root / args.runtime_out).resolve()
    model_out = (repo_root / args.model_out).resolve()
    voices_path = (repo_root / "public" / "voice" / "voices-v1.0.bin").resolve()
    req_path = (repo_root / args.requirements).resolve()
    quant_url = os.environ.get("KOKORO_QUANT_MODEL_URL", "").strip()
    quant_sha = os.environ.get("KOKORO_QUANT_MODEL_SHA256", "").strip().lower()

    target, os_tag, arch = _detect_target()
    archive_name = f"kokoro-runtime-{os_tag}-{arch}.zip"
    archive_path = runtime_out / archive_name
    runtime_out.mkdir(parents=True, exist_ok=True)
    model_out.parent.mkdir(parents=True, exist_ok=True)

    if quant_url:
        print(f"Downloading quantized Kokoro model -> {model_out}")
        _download(quant_url, model_out)
        if quant_sha:
            got = _sha256(model_out)
            if got != quant_sha:
                raise RuntimeError(
                    f"Quantized model SHA256 mismatch: expected {quant_sha}, got {got}"
                )

    if not model_out.exists():
        raise RuntimeError(f"Model file missing: {model_out}")
    if not voices_path.exists():
        raise RuntimeError(f"Voices file missing: {voices_path}")
    if not req_path.exists():
        raise RuntimeError(f"Requirements file missing: {req_path}")

    if args.pbs_asset_url:
        url = args.pbs_asset_url
        parsed = urllib.parse.urlparse(url)
        asset_name = Path(parsed.path).name
    else:
        url, asset_name = _fetch_latest_pbs_asset(target, args.python_series)
    print(f"Using python-build-standalone asset: {asset_name}")

    with tempfile.TemporaryDirectory(prefix="kokoro-runtime-") as td:
        tmp = Path(td)
        archive = tmp / asset_name
        extract_dir = tmp / "extract"
        venv_dir = tmp / "venv"
        _download(url, archive)
        extract_dir.mkdir(parents=True, exist_ok=True)
        with tarfile.open(archive, "r:gz") as tf:
            tf.extractall(extract_dir)

        standalone_python = _find_python_binary(extract_dir)
        print(f"Standalone Python: {standalone_python}")

        _run([str(standalone_python), "-m", "venv", str(venv_dir), "--copies"])
        vpy = _venv_python(venv_dir)
        _run([str(vpy), "-m", "pip", "install", "--upgrade", "pip"])
        _run([str(vpy), "-m", "pip", "install", "-r", str(req_path)])
        _smoke_test(vpy, repo_root, model_out, voices_path)

        if archive_path.exists():
            archive_path.unlink()
        _zip_runtime(venv_dir, archive_path)

    print(f"Created runtime archive: {archive_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
