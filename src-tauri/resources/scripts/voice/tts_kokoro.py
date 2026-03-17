#!/usr/bin/env python3
"""Kokoro ONNX TTS — subprocess interface.

stdin  : plain UTF-8 text
stdout : WAV file bytes
stderr : diagnostic messages

Usage:
  echo "Hello world" | python3 tts_kokoro.py \
    --model  /path/to/model_quantized.onnx \
    --voices /path/to/af_heart.bin  \
    [--voice af_heart] [--speed 1.0] [--lang en-us]
"""

import sys
import argparse
import io
from pathlib import Path


def _is_quantized_model(model_path: str) -> bool:
    return Path(model_path).name.lower() == "model_quantized.onnx"


def _resolve_voice_style_path(voices_path: str, voice: str) -> Path:
    vp = Path(voices_path)
    base = vp.parent if vp.is_file() else vp
    candidates = [
        base / f"{voice}.bin",
        base / "af_heart.bin",
        base / "af.bin",
    ]
    for c in candidates:
        if c.exists():
            return c
    raise FileNotFoundError(
        f"No voice style file found near '{voices_path}'. Tried: {', '.join(str(c) for c in candidates)}"
    )

def main():
    p = argparse.ArgumentParser(description="Kokoro TTS subprocess")
    p.add_argument("--model",  required=True, help="Path to model_quantized.onnx (recommended) or model.onnx")
    p.add_argument("--voices", required=True, help="Path to af_heart.bin (or another voice style .bin)")
    p.add_argument("--voice",  default="af_heart")
    p.add_argument("--speed",  type=float, default=1.0)
    p.add_argument("--lang",   default="en-us")
    args = p.parse_args()

    text = sys.stdin.read().strip()
    if not text:
        print("[kokoro] no text on stdin — exiting", file=sys.stderr)
        sys.exit(1)

    try:
        import soundfile as sf
        import numpy as np
        from kokoro_onnx import Kokoro, Tokenizer
        import onnxruntime as ort
    except ImportError as e:
        print(f"[kokoro] import error: {e}", file=sys.stderr)
        print("[kokoro] install with: pip install kokoro-onnx onnxruntime soundfile numpy", file=sys.stderr)
        sys.exit(2)

    try:
        print(f"[kokoro] loading model {args.model}", file=sys.stderr)
        if _is_quantized_model(args.model):
            tokenizer = Tokenizer()
            phonemes = tokenizer.phonemize(text, lang=args.lang)
            token_ids = tokenizer.tokenize(phonemes)
            if len(token_ids) > 510:
                token_ids = token_ids[:510]
            ids = np.array([[0, *token_ids, 0]], dtype=np.int64)
            style_path = _resolve_voice_style_path(args.voices, args.voice)
            style_bank = np.fromfile(style_path, dtype=np.float32).reshape((-1, 1, 256))
            style_idx = min(len(token_ids), style_bank.shape[0] - 1)
            style_vec = style_bank[style_idx]
            sess = ort.InferenceSession(args.model, providers=["CPUExecutionProvider"])
            waveform = sess.run(
                None,
                {
                    "input_ids": ids,
                    "style": style_vec.astype(np.float32),
                    "speed": np.array([float(args.speed)], dtype=np.float32),
                },
            )[0]
            samples = waveform[0]
            sr = 24000
        else:
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
