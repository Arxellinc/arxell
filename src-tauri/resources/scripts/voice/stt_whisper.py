#!/usr/bin/env python3
"""faster-whisper STT — subprocess interface.

stdin  : WAV file bytes
stdout : JSON  {"text": "transcript"}  or  {"text": "", "error": "reason"}
stderr : diagnostic messages

Usage:
  cat audio.wav | python3 stt_whisper.py \
    [--model tiny] [--language en] [--model-dir /path/to/cache]
"""

import sys
import argparse
import json
import os
import tempfile


def main():
    p = argparse.ArgumentParser(description="faster-whisper STT subprocess")
    p.add_argument("--model",     default="tiny",
                   help="Whisper model size: tiny, base, small, medium, large-v3")
    p.add_argument("--language",  default="en")
    p.add_argument("--model-dir", default=None,
                   help="Directory to cache model files (default: HuggingFace cache)")
    args = p.parse_args()

    wav_bytes = sys.stdin.buffer.read()
    if not wav_bytes:
        _out({"text": "", "error": "no WAV data on stdin"})
        sys.exit(1)

    print(f"[whisper] received {len(wav_bytes)} WAV bytes", file=sys.stderr)

    try:
        from faster_whisper import WhisperModel
    except ImportError:
        _out({"text": "", "error": "faster-whisper not installed — run: pip install faster-whisper"})
        sys.exit(2)

    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            f.write(wav_bytes)
            tmp_path = f.name

        print(f"[whisper] loading model '{args.model}' (cpu / int8)", file=sys.stderr)
        kwargs = {"device": "cpu", "compute_type": "int8"}
        if args.model_dir:
            kwargs["download_root"] = args.model_dir

        model = WhisperModel(args.model, **kwargs)
        segments, _info = model.transcribe(
            tmp_path,
            language=args.language,
            vad_filter=True,           # skip silence automatically
            vad_parameters={"min_silence_duration_ms": 300},
        )
        text = " ".join(s.text.strip() for s in segments).strip()
        print(f"[whisper] transcript: {repr(text)}", file=sys.stderr)
        _out({"text": text})

    except Exception as e:
        print(f"[whisper] error: {e}", file=sys.stderr)
        _out({"text": "", "error": str(e)})
        sys.exit(3)
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)


def _out(data: dict):
    sys.stdout.write(json.dumps(data) + "\n")
    sys.stdout.flush()


if __name__ == "__main__":
    main()
