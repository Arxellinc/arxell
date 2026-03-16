#!/usr/bin/env python3
"""Persistent Kokoro TTS daemon - length-prefixed binary protocol.

This script stays alive for the duration of the app session, accepts synthesis
requests via stdin (length-prefixed JSON), and returns synthesized audio via
stdout (length-prefixed JSON metadata + length-prefixed WAV bytes).

Protocol:
  Request:  [4 bytes: payload_len as little-endian u32]
           [N bytes: JSON {"text": "...", "chunk_id": N, "voice": "..."}]
  
  Response: [4 bytes: meta_len as little-endian u32]
            [N bytes: JSON {"chunk_id": N, "status": "ok|error", "duration_ms": M}]
            [4 bytes: audio_len as little-endian u32]
            [M bytes: WAV audio data (0 if error)]

Usage:
  python3 tts_kokoro_persistent.py --model /path/to/model_quantized.onnx --voices /path/to/voices-v1.0.bin

The model is loaded ONCE at startup, then the script enters a request loop.
"""

import sys
import struct
import json
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
    parser = argparse.ArgumentParser(description="Persistent Kokoro TTS daemon")
    parser.add_argument("--model", required=True, help="Path to model_quantized.onnx (recommended) or model.onnx")
    parser.add_argument("--voices", required=True, help="Path to voices-v1.0.bin")
    parser.add_argument("--default-voice", default="af_heart", help="Default voice to use")
    args = parser.parse_args()

    # Load model ONCE at startup
    try:
        import numpy as np
        import onnxruntime as ort
        from kokoro_onnx import Kokoro, Tokenizer
        quantized_mode = _is_quantized_model(args.model)
        print("[kokoro] Loading model...", file=sys.stderr, flush=True)
        import os
        sess_opts = ort.SessionOptions()
        sess_opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        n_threads = min(os.cpu_count() or 4, 8)
        sess_opts.intra_op_num_threads = n_threads
        sess_opts.inter_op_num_threads = 1
        sess_opts.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
        if quantized_mode:
            tokenizer = Tokenizer()
            quant_sess = ort.InferenceSession(
                args.model,
                sess_options=sess_opts,
                providers=["CPUExecutionProvider"],
            )
        else:
            kokoro = Kokoro(args.model, args.voices)
            kokoro.sess = ort.InferenceSession(
                args.model,
                sess_options=sess_opts,
                providers=["CPUExecutionProvider"],
            )
        print(f"[kokoro] Model loaded successfully (threads={n_threads})", file=sys.stderr, flush=True)
    except ImportError as e:
        error_msg = f"Import error: {e}. Install with: pip install kokoro-onnx onnxruntime soundfile numpy"
        print(f"[kokoro] {error_msg}", file=sys.stderr, flush=True)
        sys.exit(2)
    except Exception as e:
        print(f"[kokoro] Model load error: {e}", file=sys.stderr, flush=True)
        sys.exit(3)

    # Persistent request loop
    print("[kokoro] Ready for requests", file=sys.stderr, flush=True)
    
    while True:
        try:
                # Read length-prefixed request
                len_buf = sys.stdin.buffer.read(4)
                if len(len_buf) < 4:
                    # EOF - parent process closed
                    print("[kokoro] EOF received, exiting", file=sys.stderr, flush=True)
                    break
                
                payload_len = struct.unpack('<I', len_buf)[0]
                if payload_len > 10 * 1024 * 1024:  # Sanity check (10MB max)
                    raise ValueError(f"Payload too large: {payload_len}")
                
                # Read request payload
                payload = sys.stdin.buffer.read(payload_len)
                if len(payload) < payload_len:
                    print("[kokoro] Incomplete request, exiting", file=sys.stderr, flush=True)
                    break
                
                request = json.loads(payload.decode('utf-8'))
                text = request.get("text", "")
                chunk_id = request.get("chunk_id", 0)
                voice = request.get("voice", args.default_voice)
                speed = request.get("speed", 1.0)
                
                if not text:
                    # Empty text - skip but acknowledge
                    response = json.dumps({
                        "chunk_id": chunk_id,
                        "status": "error",
                        "message": "Empty text"
                    }).encode('utf-8')
                    sys.stdout.buffer.write(struct.pack('<I', len(response)))
                    sys.stdout.buffer.write(response)
                    sys.stdout.buffer.write(struct.pack('<I', 0))
                    sys.stdout.buffer.flush()
                    continue
                
                # Synthesize
                print(f"[kokoro] Synthesizing chunk {chunk_id}: '{text[:30]}...'", file=sys.stderr, flush=True)
                if quantized_mode:
                    phonemes = tokenizer.phonemize(text, lang="en-us")
                    token_ids = tokenizer.tokenize(phonemes)
                    if len(token_ids) > 510:
                        token_ids = token_ids[:510]
                    ids = np.array([[0, *token_ids, 0]], dtype=np.int64)
                    style_path = _resolve_voice_style_path(args.voices, voice)
                    style_bank = np.fromfile(style_path, dtype=np.float32).reshape((-1, 1, 256))
                    style_idx = min(len(token_ids), style_bank.shape[0] - 1)
                    style_vec = style_bank[style_idx]
                    waveform = quant_sess.run(
                        None,
                        {
                            "input_ids": ids,
                            "style": style_vec.astype(np.float32),
                            "speed": np.array([float(speed)], dtype=np.float32),
                        },
                    )[0]
                    samples = waveform[0]
                    sr = 24000
                else:
                    samples, sr = kokoro.create(text, voice=voice, speed=speed)

                # Try to extract the phoneme sequence Kokoro used for lipsync.
                # misaki is kokoro-onnx's own G2P library — zero extra inference cost.
                phonemes_raw = None
                try:
                    from misaki import en as _misaki_en
                    _ps, _ = _misaki_en.G2P()(text)
                    if isinstance(_ps, str) and _ps.strip():
                        phonemes_raw = _ps.strip()
                except Exception:
                    pass
                if phonemes_raw is None:
                    try:
                        import subprocess as _sp
                        _r = _sp.run(
                            ['espeak-ng', '-v', 'en-us', '-q', '--ipa', text],
                            capture_output=True, text=True, timeout=3,
                        )
                        if _r.returncode == 0 and _r.stdout.strip():
                            phonemes_raw = _r.stdout.strip()
                    except Exception:
                        pass

                # Encode to WAV
                buf = io.BytesIO()
                import soundfile as sf
                sf.write(buf, samples, sr, format="WAV")
                audio_bytes = buf.getvalue()

                # Build response
                response = json.dumps({
                    "chunk_id": chunk_id,
                    "status": "ok",
                    "sample_rate": sr,
                    "duration_ms": int(len(samples) * 1000 / sr),
                    "samples_count": len(samples),
                    "phonemes": phonemes_raw,
                }).encode('utf-8')
                
                # Write response (length-prefixed)
                sys.stdout.buffer.write(struct.pack('<I', len(response)))
                sys.stdout.buffer.write(response)
                sys.stdout.buffer.write(struct.pack('<I', len(audio_bytes)))
                sys.stdout.buffer.write(audio_bytes)
                sys.stdout.buffer.flush()
                
                print(f"[kokoro] Chunk {chunk_id} complete: {len(audio_bytes)} bytes, {len(samples)/sr:.2f}s", file=sys.stderr, flush=True)
                
        except json.JSONDecodeError as e:
            # JSON parse error
            error_response = json.dumps({
                "chunk_id": request.get("chunk_id", 0) if 'request' in dir() else -1,
                "status": "error",
                "message": f"JSON error: {e}"
            }).encode('utf-8')
            sys.stdout.buffer.write(struct.pack('<I', len(error_response)))
            sys.stdout.buffer.write(error_response)
            sys.stdout.buffer.write(struct.pack('<I', 0))
            sys.stdout.buffer.flush()
            
        except Exception as e:
            # Synthesis or other error
            try:
                chunk_id = request.get("chunk_id", 0) if 'request' in dir() else -1
            except:
                chunk_id = -1
            
            error_response = json.dumps({
                "chunk_id": chunk_id,
                "status": "error",
                "message": str(e)
            }).encode('utf-8')
            sys.stdout.buffer.write(struct.pack('<I', len(error_response)))
            sys.stdout.buffer.write(error_response)
            sys.stdout.buffer.write(struct.pack('<I', 0))
            sys.stdout.buffer.flush()
            print(f"[kokoro] Error: {e}", file=sys.stderr, flush=True)


if __name__ == "__main__":
    main()
