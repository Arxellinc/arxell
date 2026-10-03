#!/usr/bin/env python3
"""Pinned, checksum-verified test/bundled models. No authentication required."""
import argparse
import hashlib
from pathlib import Path
import tempfile
import urllib.request

WHISPER_REVISION = "5359861c739e955e79d9a303bcbc70fb988958b1"
WHISPER_MODELS = {
    "ggml-base.en-q8_0.bin": "a4d4a0768075e13cfd7e19df3ae2dbc4a68d37d36a7dad45e8410c9a34f8c87e",
    "ggml-tiny.en-q8_0.bin": "5bc2b3860aa151a4c6e7bb095e1fcce7cf12c7b020ca08dcec0c6d018bb7dd94",
}
GGUF_URL = "https://huggingface.co/ggml-org/tiny-llamas/resolve/99dd1a73db5a37100bd4ae633f4cfce6560e1567/stories15M-q4_0.gguf"
GGUF_SHA256 = "6151b1929d7f5aa3385d9ddef3393e55587c0a55de661562322bc51dfda93a04"


def digest(path):
    result = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            result.update(chunk)
    return result.hexdigest()


def download(url, destination, expected):
    destination = Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.is_file() and digest(destination) == expected:
        return destination
    # Never expose an incomplete model or poison a reusable runtime artifact.
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=destination.parent, delete=False) as output:
            temporary = Path(output.name)
            with urllib.request.urlopen(url, timeout=90) as response:
                for chunk in iter(lambda: response.read(1024 * 1024), b""):
                    output.write(chunk)
        if digest(temporary) != expected:
            raise RuntimeError(f"Model checksum mismatch: {destination.name}")
        temporary.replace(destination)
        return destination
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("kind", choices=["whisper", "gguf"])
    parser.add_argument("directory", type=Path)
    args = parser.parse_args()
    if args.kind == "whisper":
        for name, expected in WHISPER_MODELS.items():
            url = f"https://huggingface.co/ggerganov/whisper.cpp/resolve/{WHISPER_REVISION}/{name}"
            print(download(url, args.directory / name, expected))
    else:
        print(download(GGUF_URL, args.directory / "stories15M-q4_0.gguf", GGUF_SHA256))


if __name__ == "__main__":
    main()
