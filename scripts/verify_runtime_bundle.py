#!/usr/bin/env python3
"""Fail closed on stale/native-tuned runtime caches and missing library closure."""
import argparse
import json
import os
from pathlib import Path
import subprocess


def verify_cmake_cache(path: Path) -> None:
    lines = path.read_text(encoding="utf-8").splitlines()
    values = [line.split("=", 1)[1] for line in lines if line.startswith("GGML_NATIVE:BOOL=")]
    if values != ["OFF"]:
        raise RuntimeError(f"{path}: expected GGML_NATIVE:BOOL=OFF, got {values!r}")


def verify_bundle(root: Path, runtime: str, platform: str, tag: str) -> None:
    manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
    if manifest.get("releaseTag") != tag:
        raise RuntimeError(f"Expected {runtime} {tag}, got {manifest.get('releaseTag')!r}")
    if manifest.get("ggmlNative") is not False:
        raise RuntimeError(f"{runtime}: missing portable build policy; discard the stale/native-tuned cache")
    if platform == "Linux" and not manifest.get("libgompPackageVersion"):
        raise RuntimeError(f"{runtime}: missing Linux OpenMP package provenance")
    if runtime == "llama":
        engines = {
            "Linux": ["llama.cpp-cpu", "llama.cpp-vulkan"],
            "Windows": ["llama.cpp-cpu", "llama.cpp-vulkan"],
            "macOS": ["llama.cpp-cpu", "llama.cpp-metal"],
        }[platform]
        name = "llama-server.exe" if platform == "Windows" else "llama-server"
        binaries = [(root / engine / name, "--version") for engine in engines]
    else:
        names = {
            "Linux": "whisper-server-linux-x86_64",
            "Windows": "whisper-server-windows-x86_64.exe",
            "macOS": "whisper-server-macos-aarch64",
        }
        binaries = [(root / names[platform], "--help")]
    for binary, argument in binaries:
        if not binary.is_file():
            raise RuntimeError(f"Missing bundled runtime: {binary}")
        if platform == "Linux" and not (binary.parent / "libgomp.so.1").is_file():
            raise RuntimeError(f"Missing bundled OpenMP dependency beside {binary.name}")
        env = os.environ.copy()
        variable = {"Linux": "LD_LIBRARY_PATH", "macOS": "DYLD_LIBRARY_PATH", "Windows": "PATH"}[platform]
        # Keep the Windows system/Vulkan SDK PATH; Unix closure checks must not
        # borrow libraries from earlier engines via inherited loader paths.
        prior = env.get(variable, "") if platform == "Windows" else ""
        env[variable] = str(binary.parent.resolve()) + (os.pathsep + prior if prior else "")
        result = subprocess.run([str(binary.resolve()), argument], env=env, capture_output=True, text=True, timeout=30)
        if result.returncode:
            raise RuntimeError(f"{binary.name} {argument} failed ({result.returncode}): {result.stderr[-2000:]}")
    print(f"Verified portable {runtime} {tag} bundle for {platform}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--cmake-cache", type=Path)
    mode.add_argument("--runtime", choices=["llama", "whisper"])
    parser.add_argument("--root", type=Path)
    parser.add_argument("--platform", choices=["Linux", "Windows", "macOS"])
    parser.add_argument("--tag")
    args = parser.parse_args()
    if args.cmake_cache:
        verify_cmake_cache(args.cmake_cache)
    else:
        if not all([args.root, args.platform, args.tag]):
            parser.error("--runtime requires --root, --platform and --tag")
        verify_bundle(args.root, args.runtime, args.platform, args.tag)


if __name__ == "__main__":
    main()
