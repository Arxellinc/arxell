#!/usr/bin/env python3
"""Real CPU inference/transcription from a relocated packaged dependency closure."""
import argparse
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request

from model_assets import download, GGUF_URL, GGUF_SHA256

JFK_URL = "https://raw.githubusercontent.com/ggml-org/whisper.cpp/v1.9.4/samples/jfk.wav"
JFK_SHA256 = "59dfb9a4acb36fe2a2affc14bacbee2920ff435cb13cc314a08c13f66ba7860e"


def http(url, data=None, headers=None):
    request = urllib.request.Request(url, data=data, headers=headers or {})
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.load(response)


def run_server(binary, arguments, operation, output):
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]
    env = os.environ.copy()
    variable = "PATH" if os.name == "nt" else "DYLD_LIBRARY_PATH" if sys.platform == "darwin" else "LD_LIBRARY_PATH"
    env[variable] = str(binary.parent) + (os.pathsep + env.get("PATH", "") if os.name == "nt" else "")
    base = f"http://127.0.0.1:{port}"
    with output.open("wb") as log:
        server = subprocess.Popen([str(binary), "--host", "127.0.0.1", "--port", str(port), *arguments], env=env, stdout=log, stderr=log)
        try:
            deadline = time.monotonic() + 120
            while True:
                if server.poll() is not None:
                    raise RuntimeError(f"Packaged {binary.name} exited: {server.returncode}; see {output}")
                try:
                    if http(base + "/health").get("status") == "ok":
                        break
                except (OSError, ValueError):
                    pass
                if time.monotonic() > deadline:
                    raise RuntimeError(f"Packaged {binary.name} failed readiness; see {output}")
                time.sleep(0.2)
            operation(base)
        finally:
            server.terminate()
            try:
                server.wait(timeout=5)
            except subprocess.TimeoutExpired:
                server.kill()
                server.wait(timeout=5)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("resources", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    # These are test fixtures, not additional bundled user-facing models.
    wav = download(JFK_URL, args.output / "jfk.wav", JFK_SHA256)
    with tempfile.TemporaryDirectory(prefix="arxell-relocated-") as temporary:
        root = Path(temporary)
        whisper = root / "whisper"
        shutil.copytree(args.resources / "whisper-server", whisper)
        whisper_pattern = (
            "whisper-server-windows-*.exe"
            if os.name == "nt"
            else "whisper-server-macos-*"
            if sys.platform == "darwin"
            else "whisper-server-linux-*"
        )
        whisper_binary = next(whisper.glob(whisper_pattern))
        model = args.resources / "whisper/ggml-base-q8_0.bin"
        if not model.is_file():
            raise RuntimeError("Bundled Whisper base model missing")

        def transcription(base):
            boundary = "arxell-smoke-boundary"
            body = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"jfk.wav\"\r\nContent-Type: audio/wav\r\n\r\n".encode()
                    + wav.read_bytes() + f"\r\n--{boundary}--\r\n".encode())
            result = http(base + "/inference", body, {"Content-Type": f"multipart/form-data; boundary={boundary}"})
            if "country" not in result.get("text", "").lower():
                raise RuntimeError("Packaged Whisper failed known-speech transcription")

        llama_source = args.resources / "llama-runtime/llama.cpp-cpu"
        if llama_source.is_dir():
            gguf = download(GGUF_URL, args.output / "stories15M-q4_0.gguf", GGUF_SHA256).resolve()
            cpu = root / "llama"
            shutil.copytree(llama_source, cpu)
            llama = cpu / ("llama-server.exe" if os.name == "nt" else "llama-server")

            def completion(base):
                result = http(base + "/completion", json.dumps({"prompt": "Once upon a time", "n_predict": 8, "temperature": 0, "stream": False}).encode(), {"Content-Type": "application/json"})
                if not result.get("content", "").strip():
                    raise RuntimeError("Packaged llama.cpp returned no generated text")

            run_server(llama, ["--model", str(gguf), "--ctx-size", "256", "-ngl", "0", "--threads", "2"], completion, args.output / "llama.log")

        run_server(whisper_binary, ["--model", str(model.resolve()), "--threads", "2"], transcription, args.output / "whisper.log")
    print("PASS: packaged, relocated runtime closure smoke test")


if __name__ == "__main__":
    main()
