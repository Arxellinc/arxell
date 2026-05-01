# TTS Pipeline Analysis — GLM-5.1 Review

Date: 2026-05-01

## Summary

The streaming TTS pipeline spans a Rust/Tauri backend (sherpa-onnx synthesis engine) and a TypeScript frontend (text chunking, queue management, audio playback). Multiple failed patches have accumulated complexity. This document traces the full pipeline, identifies the likely root cause of text-skipping bugs, catalogs dead/removable code, and proposes a phased simplification plan.

---

## 1. Pipeline Trace

### Data Flow

```
Chat stream delta (from LLM)
    |
    v
events.ts: handleChatStreamEvent()
    |  on "chat.stream.chunk" → target.ingestChatStreamForTts(correlationId, delta)
    v
main.ts: ingestChatStreamForTts()
    |  1. extractSpeakableStreamDelta(delta) — strips code blocks
    |  2. enqueueSpeakableChunk(speakableDelta) — sentence boundary splitting
    |  3. tryLowLatencyBufferFlush() — eager first-chunk flush
    |  4. scheduleLowLatencyBufferFlush() — timer-based fallback flush
    |  5. runChatTtsQueue(sendMessage) — starts/continues queue consumer
    v
chatTtsPipeline.ts: ChatTtsPipeline
    |  Maintains: streamBuffer, queue[], flushTimerId
    |  Splits text at sentence/word boundaries
    |  Merges small adjacent chunks via shiftQueueText()
    v
main.ts: runChatTtsQueue() — queue consumer loop
    |  1. waitForChatTtsQueueText(220ms timeout)
    |  2. synthesizeChatTtsChunk(text, correlationId)
    |     → calls clientRef.ttsSpeakStream() via IPC
    |  3. waitForChatTtsStreamDone() — waits for backend to emit final chunk
    v
Rust: tts::speak_stream() (src-tauri/src/tts/mod.rs:1786)
    |  Spawns tokio task → spawn_blocking → sherpa OfflineTts::generate_with_config()
    |  Progress callback emits "tts.stream.chunk" events (base64 PCM16LE)
    |  Final event has payload.final = true
    v
events.ts: handleCoreAppEvent()
    |  routes "tts.stream.chunk" → onChatTtsStreamChunkEvent()
    v
main.ts: onChatTtsStreamChunkEvent()
    |  Validates active request, decodes base64, calls playChatTtsStreamChunk()
    v
main.ts: playChatTtsStreamChunk()
    |  Decodes PCM16LE → Float32 → AudioBuffer
    |  Schedules playback gaplessly via Web Audio API
    |  Updates avatar speech state
    v
main.ts: scheduleChatTtsStreamFinalize()
    |  After final chunk + delay → clears chatTtsPlaying state
    v
User hears speech
```

### Non-Streaming Path (Manual "Speak" Button Only)

```
TTS Panel "Speak" button (main.ts ~line 6233)
    → clientRef.ttsSpeak()
    → playTtsAudio()
    → Web Audio API (primary) or HTMLAudioElement (fallback)
```

---

## 2. Files Involved

| File | Role | Lines (approx) |
|------|------|-----------------|
| `src-tauri/src/tts/mod.rs` | Backend synthesis engine, streaming callback, engine caching | 2147 |
| `src-tauri/src/contracts.rs` | IPC request/response types | ~164 |
| `src-tauri/src/main.rs` | Tauri command registrations | ~20 |
| `src-tauri/src/voice/tts_interface.rs` | Trait definitions for voice pipeline | 32 |
| `frontend/src/main.ts` | All TTS orchestration, queue consumer, playback, state | ~550 |
| `frontend/src/voice/chatTtsPipeline.ts` | Text chunking, queue, stream parser | 287 |
| `frontend/src/app/events.ts` | Event routing (stream chunks + chat stream) | 379 |
| `frontend/src/app/chatSend.ts` | Non-streaming TTS path for completed responses | 176 |
| `frontend/src/ipcClient.ts` | IPC client abstraction | ~35 |
| `frontend/src/contracts.ts` | TypeScript contract types | ~130 |
| `frontend/src/tts/engineRules.ts` | Engine config, UI rules, state reset | 171 |
| `frontend/src/panels/ttsPanel.ts` | TTS settings panel UI | 313 |
| `frontend/src/avatar/phonemeUtils.ts` | Lip-sync phoneme conversion | 161 |
| `frontend/src/stt/useAudioQueue.ts` | **UNUSED** audio queue hook | 108 |

---

## 3. Root Cause Analysis: Text Skipping

### Bug #1: Silent text discard in `enqueueSpeakableChunk` (HIGH — most likely cause)

**Location:** `chatTtsPipeline.ts:108-145`

When `nextSpeakableBoundary()` returns a boundary and `postprocess(part)` returns an empty string (e.g., the chunk was whitespace-only after stripping), the code enters the `else` branch at line 137-138:

```ts
} else if (!finalFlush) {
  break;                        // buffer stays — OK for non-final
} else {
  this.streamBuffer = this.streamBuffer.slice(boundary);  // TEXT CONSUMED BUT NOT SPOKEN
}
```

On `finalFlush`, text is consumed from the buffer and silently discarded. This happens when the final chunk in a response has been stripped to nothing by `postprocessSpeakableText()`.

### Bug #2: `extractSpeakableStreamDelta` state machine corruption (HIGH)

**Location:** `chatTtsPipeline.ts:67-106`

The inline/fenced code block detector tracks `inInlineCode` and `inFencedCode` across stream deltas. If a delta boundary splits a backtick run oddly (e.g., one backtick at end of delta, two more at start of next), the `pendingTicks` accumulator should handle it — but the state machine has no escape hatch. Once `inInlineCode = true`, it stays true until a matching backtick is seen. If one is never seen (malformed markdown, or code block that never closes), **all subsequent text is suppressed**.

There is no maximum-suppression guard. A stuck `inInlineCode` or `inFencedCode` state will swallow the entire rest of the response silently.

### Bug #3: Race between eager flush and normal enqueue (MEDIUM)

**Location:** `main.ts:2498-2525` (`ingestChatStreamForTts`)

On every stream delta, the code calls:
1. `enqueueSpeakableChunk()` — appends to `streamBuffer`, splits at boundaries
2. `tryLowLatencyBufferFlush()` — independently reads and slices `streamBuffer`
3. `scheduleLowLatencyBufferFlush()` — schedules a timer that also calls `tryLowLatencyBufferFlush()`

Both `enqueueSpeakableChunk` and `tryLowLatencyBufferFlush` read from and mutate `streamBuffer`. While they share the same `ChatTtsPipeline` instance, the interleaving of these two code paths across microtasks can cause text to be consumed by one path that the other path expected to process. The `tryLowLatencyBufferFlush` has its own independent boundary-finding logic that may produce different split points than `enqueueSpeakableChunk`.

### Bug #4: Queue consumer re-entry and premature exit (MEDIUM)

**Location:** `main.ts:2413-2496` (`runChatTtsQueue`)

- The `finally` block at line 2490-2493 re-enters `runChatTtsQueue` if the queue has items. Combined with the guard `if (chatTtsQueueRunning) return;`, this can cause items to be left in the queue if `chatTtsQueueRunning` hasn't been reset yet when the re-entry check happens.
- The 220ms timeout at line 2464 causes the queue to exit if no new text arrives within 220ms. For slow LLM responses, this can cause the queue to stop and restart, potentially losing text that was in the pipeline.

---

## 4. Dead / Removable Code

### Dead Functions in `main.ts`

| Function | Lines | Status |
|----------|-------|--------|
| `nextSpeakableBoundary()` | 2108-2137 | **Dead.** Never called. Duplicates logic inside `ChatTtsPipeline.nextSpeakableBoundary()`. |
| `findSafeWordBoundary()` | 2139-2154 | **Dead.** Only called by the dead `nextSpeakableBoundary()` above. |
| `clearChatTtsFlushTimer()` | 1730-1732 | **Dead.** Empty function body — does nothing. |
| `notifyChatTtsQueueAvailable()` | 1772-1774 | **Dead.** Empty function body — does nothing. |

### Dead Code Path: Non-Streaming Chat TTS

| Item | Lines | Status |
|------|-------|--------|
| `CHAT_TTS_STREAMING_ENABLED` flag | 1544 | Hardcoded `true`. The non-streaming branch in `synthesizeChatTtsChunk()` is unreachable for chat TTS. |
| Non-streaming branch in `synthesizeChatTtsChunk()` | 2346-2369 | Dead code — `CHAT_TTS_STREAMING_ENABLED` is always `true`. |
| `ChatTtsSynthResult.response` field | 2309-2314 | Never populated for chat TTS. Only used in `runChatTtsQueue` non-streaming branch (also dead). |

Note: `playTtsAudio()` itself is NOT dead — it's used by the manual "Speak" button in the TTS panel (line 6233). Only the chat TTS queue's non-streaming path is dead.

### Unused File

| File | Lines | Status |
|------|-------|--------|
| `frontend/src/stt/useAudioQueue.ts` | 108 | **Entirely unused.** The file's own comment says "Currently unused by STT — built for future TTS integration." The real TTS playback is implemented inline in main.ts. Imported by `useSTT.ts` but the `audioQueue` object is never used for actual TTS playback. |

### Diagnostic-Only State (No Control Flow Impact)

| Item | Lines | Purpose |
|------|-------|---------|
| `chatTtsStreamStatsByRequest` Map + `noteChatTtsStreamChunk()` + `flushChatTtsStreamStats()` | ~30 | Logs chunk/byte/timing stats per request. Never affects playback decisions. |
| `chatTtsStreamChunkSeq` counter | ~3 | Only used for `seq % 20 === 1` diagnostic log throttling. |
| `textStatsByCorrelation` in pipeline + `noteStreamChars()` + `consumeTextStats()` | ~20 | Tracks streamChars/enqueuedChars for a single debug log line in `flushChatStreamForTts`. |

### Potentially Removable: Low-Latency Flush Path

| Item | Lines | Risk |
|------|-------|------|
| `tryLowLatencyBufferFlush()` | chatTtsPipeline.ts:147-166 | Creates a second code path that races with `enqueueSpeakableChunk()`. |
| `scheduleLowLatencyBufferFlush()` | chatTtsPipeline.ts:168-184 | Timer-based flush that adds timing complexity. |
| `scheduleLowLatencyBufferFlush()` wrapper in main.ts | 2161-2167 | Thin wrapper. |

The eager flush path exists to reduce time-to-first-audio. However, it introduces complexity and is one of the suspected causes of text skipping. Removing it would simplify the pipeline at the cost of slightly higher first-audio latency (~180ms).

---

## 5. Proposed Simplification Plan

### Phase 1: Dead Code Removal (Zero Risk)

- Delete standalone `nextSpeakableBoundary()` and `findSafeWordBoundary()` from main.ts
- Delete `clearChatTtsFlushTimer()` and `notifyChatTtsQueueAvailable()` stubs
- Delete `frontend/src/stt/useAudioQueue.ts` and its import in `useSTT.ts`

### Phase 2: Eliminate Non-Streaming Chat TTS Path (Low Risk)

- Remove `CHAT_TTS_STREAMING_ENABLED` flag
- Remove the `else` branch in `synthesizeChatTtsChunk()` that calls `ttsSpeak()`
- Remove `ChatTtsSynthResult.response` field
- Simplify the queue loop in `runChatTtsQueue` to only handle streaming mode (remove the `currentSynth.response` checks and the `playTtsAudio` call in the loop)
- Keep `playTtsAudio()` itself for the manual panel Speak button

### Phase 3: Simplify Text Chunking (Highest Impact on Skipping Bug)

- **Fix the silent discard bug**: In `enqueueSpeakableChunk`, when `postprocess()` returns empty but the raw text contains alphanumeric content, do NOT slice it from the buffer. Keep it for the next iteration or final flush.
- **Remove `tryLowLatencyBufferFlush` and `scheduleLowLatencyBufferFlush`**: These create a second code path that mutates `streamBuffer` concurrently with `enqueueSpeakableChunk`. Replace with a single, simpler approach: `enqueueSpeakableChunk` handles all splitting, and the first chunk is sent immediately when a sentence boundary is found.
- **Simplify `nextSpeakableBoundary`**: Replace the multi-strategy approach (sentence boundary → soft split at 80 → eager target → word boundary) with a simpler two-level strategy:
  1. Split at sentence endings (`.!?` followed by space/newline) — primary
  2. Hard upper limit at ~200 chars with word-boundary fallback — safety valve
- **Remove the adaptive chunk sizing** (`firstChunkTarget` vs `steadyChunkTarget`): Use a single target size. The adaptive sizing adds complexity for marginal latency improvement.

### Phase 4: Harden Code Block Detection (High Impact)

- Add a safety valve to `extractSpeakableStreamDelta`: if `inInlineCode` has been true for more than 500 accumulated characters, reset it to `false`. This prevents a malformed or unclosed inline code span from suppressing all subsequent text.
- Same for `inFencedCode`: if suppressed characters exceed a large threshold (e.g., 2000), emit a warning and reset.

### Phase 5: Remove Diagnostic State (Cleanup)

- Remove `chatTtsStreamStatsByRequest`, `noteChatTtsStreamChunk()`, `flushChatTtsStreamStats()`
- Remove `chatTtsStreamChunkSeq`
- Remove `textStatsByCorrelation`, `noteStreamChars()`, `consumeTextStats()` from pipeline
- If needed, replace with a single `console.debug` call at key points

---

## 6. Complexity Score

Before simplification, the TTS streaming system involves:

- **~550 lines** in main.ts for TTS orchestration
- **287 lines** in chatTtsPipeline.ts for text chunking
- **~40 lines** of dead code
- **~30 lines** of unused files
- **~60 lines** of diagnostic-only state tracking
- **~50 lines** of dead non-streaming code path
- **2 independent code paths** that mutate `streamBuffer` (enqueue + eager flush)
- **6 tuning constants** (`MIN_SENTENCE_CHARS`, `FIRST_CHUNK_TARGET`, `STEADY_CHUNK_TARGET`, `MIN_FLUSH_CHARS`, `FLUSH_INTERVAL_MS`, `MERGE_TARGET`)

After the proposed simplification:

- Estimated reduction: **~150-200 lines** removed
- **1 code path** mutating `streamBuffer` (enqueue only)
- **3 tuning constants** (single chunk target, merge target, min sentence chars)
- Silent text discard bug eliminated
- Code block state machine corruption prevented

---

## 7. Key State Variables in main.ts

| Variable | Purpose | Used for Control Flow? |
|----------|---------|----------------------|
| `chatTtsPipeline` | Text chunking queue | Yes — core |
| `chatTtsStreamAudioContext` | Web Audio API context | Yes — playback |
| `chatTtsStreamNextStartAtSec` | Gapless scheduling tracker | Yes — playback |
| `chatTtsStreamFinalizeTimerId` | Post-playback cleanup timer | Yes — state |
| `chatTtsRequestToChatCorrelation` | Maps TTS req ID → chat corr ID | Yes — latency capture |
| `chatTtsStreamSeenByRequest` | Tracks seen requests | Yes — dedup |
| `chatTtsStreamDoneWaiters` | Promise waiters for stream done | Yes — queue consumer |
| `chatTtsQueueRunning` | Guard against re-entry | Yes — queue consumer |
| `chatTtsStopRequested` | Stop signal | Yes — cancellation |
| `chatTtsSpeakingSinceMs` | Timestamp of speech start | Yes — timing |
| `chatTtsSawStreamDeltaByCorrelation` | Tracks which correlations had stream deltas | Yes — prevents double-speak in chatSend.ts |
| `chatTtsLatencyCapturedByCorrelation` | Prevents duplicate latency capture | Yes — metrics |
| `chatTtsActiveStreamRequestId` | Currently playing stream | Yes — validation |
| `chatTtsStreamChunkSeq` | Diagnostic chunk counter | **No — logging only** |
| `chatTtsStreamStatsByRequest` | Per-request stats | **No — logging only** |
| `chatTtsWarmSignature` | Engine warm-up dedup | Yes — prewarm |
| `chatTtsPrewarmPromise` | In-flight prewarm | Yes — prewarm |
