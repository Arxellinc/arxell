#!/usr/bin/env python3
"""Persistent faster-whisper STT daemon - length-prefixed binary protocol.

This script stays alive for the duration of the app session, accepts
transcription requests via stdin (length-prefixed binary), and returns
transcripts via stdout (length-prefixed JSON).

Protocol:
  Request:  [4 bytes: payload_len as little-endian u32]
            [N bytes: WAV audio data]
  
  Response: [4 bytes: meta_len as little-endian u32]
            [N bytes: JSON {"text": "...", "duration_ms": M, "chunk_id": N}]
            OR on error:
            [4 bytes: meta_len][JSON {"text": "", "error": "..."}]

Usage:
  python3 stt_whisper_persistent.py --model tiny [--model-dir /path/to/cache]

The model is loaded ONCE at startup, then the script enters a request loop.
"""

import sys
import struct
import json
import argparse
import tempfile
import os


def main():
    parser = argparse.ArgumentParser(description="Persistent faster-whisper STT daemon")
    parser.add_argument("--model", default="tiny",
                        help="Whisper model size: tiny, base, small, medium, large-v3")
    parser.add_argument("--language", default="en")
    parser.add_argument("--model-dir", default=None,
                        help="Directory to cache model files (default: HuggingFace cache)")
    args = parser.parse_args()

    # Load model ONCE at startup
    try:
        from faster_whisper import WhisperModel
        print(f"[whisper] Loading model '{args.model}' (cpu / int8)...", file=sys.stderr, flush=True)
        kwargs = {"device": "cpu", "compute_type": "int8"}
        if args.model_dir:
            kwargs["download_root"] = args.model_dir
        
        model = WhisperModel(args.model, **kwargs)
        print(f"[whisper] Model loaded successfully", file=sys.stderr, flush=True)
    except ImportError as e:
        error_msg = f"Import error: {e}. Install with: pip install faster-whisper"
        print(f"[whisper] {error_msg}", file=sys.stderr, flush=True)
        sys.exit(2)
    except Exception as e:
        print(f"[whisper] Model load error: {e}", file=sys.stderr, flush=True)
        sys.exit(3)

    # Persistent request loop
    print("[whisper] Ready for transcription requests", file=sys.stderr, flush=True)
    chunk_id = 0
    
    while True:
        tmp_path = None
        try:
            # Read length-prefixed request
            len_buf = sys.stdin.buffer.read(4)
            if len(len_buf) < 4:
                # EOF - parent process closed
                print("[whisper] EOF received, exiting", file=sys.stderr, flush=True)
                break
            
            payload_len = struct.unpack('<I', len_buf)[0]
            if payload_len > 50 * 1024 * 1024:  # Sanity check (50MB max)
                raise ValueError(f"Payload too large: {payload_len}")
            
            # Read WAV data
            wav_bytes = sys.stdin.buffer.read(payload_len)
            if len(wav_bytes) < payload_len:
                print("[whisper] Incomplete request, exiting", file=sys.stderr, flush=True)
                break
            
            chunk_id += 1
            print(f"[whisper] Chunk {chunk_id}: {len(wav_bytes)} WAV bytes", file=sys.stderr, flush=True)

            if not wav_bytes or len(wav_bytes) < 44:
                # Empty or too small - skip but acknowledge
                response = json.dumps({
                    "chunk_id": chunk_id,
                    "text": "",
                    "error": "Audio too short"
                }).encode('utf-8')
                sys.stdout.buffer.write(struct.pack('<I', len(response)))
                sys.stdout.buffer.write(response)
                sys.stdout.buffer.flush()
                continue
            
            # Write to temp file (faster-whisper needs a file path)
            with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
                f.write(wav_bytes)
                tmp_path = f.name

            # Transcribe
            segments, info = model.transcribe(
                tmp_path,
                language=args.language,
                vad_filter=True,
                vad_parameters={"min_silence_duration_ms": 300},
            )
            text = " ".join(s.text.strip() for s in segments).strip()
            duration_ms = int(info.duration * 1000) if hasattr(info, 'duration') else 0
            
            print(f"[whisper] Chunk {chunk_id}: '{text[:50]}{'...' if len(text) > 50 else ''}'", 
                  file=sys.stderr, flush=True)
            
            # Build response
            response = json.dumps({
                "chunk_id": chunk_id,
                "text": text,
                "duration_ms": duration_ms,
                "language": info.language if hasattr(info, 'language') else args.language,
            }).encode('utf-8')
            
            # Write response (length-prefixed)
            sys.stdout.buffer.write(struct.pack('<I', len(response)))
            sys.stdout.buffer.write(response)
            sys.stdout.buffer.flush()
            
        except json.JSONDecodeError as e:
            error_response = json.dumps({
                "chunk_id": chunk_id,
                "text": "",
                "error": f"JSON error: {e}"
            }).encode('utf-8')
            sys.stdout.buffer.write(struct.pack('<I', len(error_response)))
            sys.stdout.buffer.write(error_response)
            sys.stdout.buffer.flush()
            
        except Exception as e:
            # Transcription or other error
            error_response = json.dumps({
                "chunk_id": chunk_id,
                "text": "",
                "error": str(e)
            }).encode('utf-8')
            sys.stdout.buffer.write(struct.pack('<I', len(error_response)))
            sys.stdout.buffer.write(error_response)
            sys.stdout.buffer.flush()
            print(f"[whisper] Error: {e}", file=sys.stderr, flush=True)
            
        finally:
            # Clean up temp file
            if tmp_path and os.path.exists(tmp_path):
                try:
                    os.unlink(tmp_path)
                except:
                    pass


if __name__ == "__main__":
    main()
