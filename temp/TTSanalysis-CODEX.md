# TTS Streaming Stability Analysis (CODEX)

## Context
- Goal: identify why large chunks of assistant text are skipped during auto-speak and what can be removed to simplify and stabilize the pipeline.
- Scope reviewed: frontend streaming ingest, queueing, flush behavior, completion signaling, playback scheduling, and Rust stream emitter.

## End-to-end Trace (Current)
1. `chat.stream.chunk` events are handled in `handleChatStreamEvent` and routed to `ingestChatStreamForTts`.
   - `frontend/src/app/events.ts:352`
   - `frontend/src/main.ts:2498`
2. Chunk text is filtered by `extractSpeakableStreamDelta` (backtick/code-aware parser), then appended into `ChatTtsPipeline` buffering.
   - `frontend/src/voice/chatTtsPipeline.ts:67`
   - `frontend/src/voice/chatTtsPipeline.ts:108`
3. Buffer flush can happen in multiple ways:
   - punctuation/length boundary splitting in pipeline,
   - low-latency timer flush,
   - explicit final flush on `chat.stream.complete`.
   - `frontend/src/voice/chatTtsPipeline.ts:229`
   - `frontend/src/main.ts:2161`
   - `frontend/src/main.ts:2527`
4. `runChatTtsQueue` dequeues text and calls `ttsSpeakStream` for each chunk (streaming mode enabled), then waits for done.
   - `frontend/src/main.ts:2413`
   - `frontend/src/main.ts:2328`
5. Done waiters are resolved from two independent event paths:
   - `tts.stream.chunk` with `final=true`,
   - `tts.request` complete.
   - `frontend/src/main.ts:1951`
   - `frontend/src/app/events.ts:128`
6. Stream PCM chunks are decoded and scheduled in browser WebAudio (`AudioContext`) with backlog timing.
   - `frontend/src/main.ts:1974`
7. Backend `speak_stream` emits repeated `tts.stream.chunk` progress payloads and final marker.
   - `src-tauri/src/tts/mod.rs:1786`

## Primary Risk Findings

### 1) Dual completion signaling can advance queue prematurely
- Current stream completion can be driven by both:
  - `tts.stream.chunk` final signal,
  - `tts.request` complete signal.
- This creates a race window where queue waiters may resolve before the frontend has fully consumed related stream state, especially under event reordering.
- Likely symptom: tail content skipped or next queue item starts too early.

### 2) Active-request gate can drop valid late chunks
- Frontend drops stream chunks if `event.correlationId !== chatTtsActiveStreamRequestId`.
- If active request changes early (or completion occurs from the alternate path), late-but-valid chunks are discarded.
- Likely symptom: missing middle/tail audio for long responses.

### 3) Over-layered text transformation and segmentation
- Text is altered in multiple stages before synthesis:
  - code/backtick filter,
  - chunk boundary extraction,
  - merge/shift logic,
  - optional fallback cleanup,
  - timer-based flushes.
- Many independent heuristics means more opportunities for accidental omission and hard-to-reproduce regressions.
- In particular, code-aware filtering can remove large regions by design.

### 4) Mixed-mode architecture increases complexity
- Chat TTS supports streaming and non-streaming branches in the same queue runtime.
- Extra branches increase state transitions and race surface without clear stability benefit for the current incident.

## Concrete Redundancies / Removable Pieces

### A) Remove one completion path for streaming queue
- Keep only `tts.stream.chunk final=true` as authoritative completion for stream playback.
- Stop resolving stream waiters from `tts.request complete` in stream mode.

### B) Remove low-latency timer flush path
- Remove `scheduleLowLatencyBufferFlush` and timer-driven flush retries.
- Use deterministic flush only:
  - boundary-triggered flush during ingest,
  - mandatory final flush on `chat.stream.complete`.

### C) Remove code-strip parser from auto-speak path (or gate it off)
- For reliability, prefer near-raw text with minimal normalization (control-char cleanup, whitespace normalization only).
- Current parser intentionally suppresses inline/fenced code; this can look like "skipped" content when model uses markdown heavily.

### D) Remove mixed branching in chat auto-speak
- Choose one mode for chat auto-speak (streaming) and remove non-stream queue path for this feature.
- Keep non-stream only for explicit panel test/play if needed.

### E) Remove legacy/dead wrappers in `main.ts`
- `clearChatTtsFlushTimer` is a no-op.
- `notifyChatTtsQueueAvailable` is a no-op.
- Local `nextSpeakableBoundary` / `findSafeWordBoundary` duplicates are now superseded by `ChatTtsPipeline` internals.

## Stability-First Reduction Blueprint
1. Unify completion contract (single done source).
2. Remove timer flushes and keep deterministic boundaries + final flush.
3. Minimize text mutation prior to synth.
4. Collapse auto-speak to one execution branch.
5. Delete dead wrappers and duplicate helpers.

## Why this should help the specific skip bug
- Large skipped segments are usually caused by one of:
  - queue advancing before upstream text is fully enqueued,
  - chunk drops from request-id mismatch,
  - transformation logic discarding text.
- The current implementation has all three risk classes simultaneously.
- Reducing to one contract per stage (ingest, flush, completion, playback) is the fastest path to predictable behavior.

## Files Inspected
- `frontend/src/main.ts`
- `frontend/src/voice/chatTtsPipeline.ts`
- `frontend/src/app/events.ts`
- `frontend/src/app/chatSend.ts`
- `frontend/src/contracts.ts`
- `src-tauri/src/tts/mod.rs`
