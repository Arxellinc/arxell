#!/usr/bin/env python3
"""Kokoro ONNX TTS — subprocess interface.

stdin  : plain UTF-8 text
stdout : WAV file bytes
stderr : diagnostic messages

Usage:
  echo "Hello world" | python3 tts_kokoro.py \
    --model  /path/to/kokoro-v1.0.onnx \
    --voices /path/to/voices-v1.0.bin  \
    [--voice af_heart] [--speed 1.0] [--lang en-us]
"""

import sys
import argparse
import io

def main():
    p = argparse.ArgumentParser(description="Kokoro TTS subprocess")
    p.add_argument("--model",  required=True, help="Path to kokoro-v1.0.onnx")
    p.add_argument("--voices", required=True, help="Path to voices-v1.0.bin")
    p.add_argument("--voice",  default="af_heart")
    p.add_argument("--speed",  type=float, default=1.0)
    p.add_argument("--lang",   default="en-us")
    args = p.parse_args()

    text = sys.stdin.read().strip()
    if not text:
        print("[kokoro] no text on stdin — exiting", file=sys.stderr)
        sys.exit(1)

    try:
        from kokoro_onnx import Kokoro
        import soundfile as sf
    except ImportError as e:
        print(f"[kokoro] import error: {e}", file=sys.stderr)
        print("[kokoro] install with: pip install kokoro-onnx soundfile", file=sys.stderr)
        sys.exit(2)

    try:
        print(f"[kokoro] loading model {args.model}", file=sys.stderr)
        k = Kokoro(args.model, args.voices)
        samples, sr = k.create(text, voice=args.voice, speed=args.speed, lang=args.lang)
        print(f"[kokoro] synthesised {len(samples)} samples @ {sr}Hz", file=sys.stderr)

        buf = io.BytesIO()
        sf.write(buf, samples, sr, format="WAV")
        sys.stdout.buffer.write(buf.getvalue())
        sys.stdout.buffer.flush()
    except Exception as e:
        print(f"[kokoro] synthesis error: {e}", file=sys.stderr)
        sys.exit(3)

if __name__ == "__main__":
    main()
