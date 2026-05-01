# TTS Streaming Architecture Analysis

**Date**: 2026-05-01
**Analysis Scope**: Text-to-Speech streaming speech generation process
**Critical Bugs**: Large chunks of text completely skipped during streaming

---

## 1. Architecture Overview

### 1.1 Backend (Rust/Tauri)

| File | Lines | Purpose |
|------|-------|---------|
| `src-tauri/src/tts/mod.rs` | 2147 | Main TTS engine — sherpa-onnx integration (Kokoro, Piper, Matcha, Kitten). Handles model loading, synthesis, WAV encoding, streaming chunks via callback. |
| `src-tauri/src/main.rs` | 1805 | Tauri commands: `cmd_tts_speak`, `cmd_tts_speak_stream`, `cmd_tts_stop`, etc. |

**Streaming mechanism**: Not WebSocket-based. Uses Tauri event emitter (`app.emit("app:event", ...)`) to stream PCM16Base64 chunks to frontend via `tts.stream.chunk` events.

```rust
// Backend spawns blocking task for synthesis with callback
let generated = engine.tts.generate_with_config(
    &text_clone,
    &gen_config,
    Some(move |samples: &[f32], _progress: f32| {
        // emit PCM16Base64 chunk via tts.stream.chunk event
        emit_tts_event(&app, &corr, "tts.stream.chunk", ...);
        true  // continue
    }),
);
```

### 1.2 Frontend (TypeScript)

| File | Lines | Purpose |
|------|-------|---------|
| `frontend/src/main.ts` | 9141 | Monolithic entry point containing ALL frontend logic |
| `frontend/src/voice/chatTtsPipeline.ts` | 287 | Text stream segmentation into speakable chunks |

### 1.3 Voice Services (Backend)

| File | Purpose |
|------|---------|
| `src-tauri/src/app/voice_runtime_service.rs` | 787 lines — Voice session management |
| `src-tauri/src/app/voice_speculation_service.rs` | 49 lines — Speculative prefix generation for VAD |
| `src-tauri/src/app/voice_handoff_service.rs` | VAD method handoff coordinator |

---

## 2. Data Flow

### 2.1 Streaming Path (text → audio)

```
Chat Message Delta
       │
       ▼
ingestChatStreamForTts(correlationId, delta)
       │
       ▼
ChatTtsPipeline.extractSpeakableStreamDelta()
  — Strips markdown code fences/inline code
       │
       ▼
ChatTtsPipeline.enqueueSpeakableChunk()
  — Accumulates in streamBuffer
  — Calls nextSpeakableBoundary() to find sentence/word breaks
  — Pushes speakable chunks to queue[]
       │
       ▼
runChatTtsQueue() ─────────────────────────┐
       │                                   │
       ▼                                   │
synthesizeChatTtsChunk(text, corrId)       │
       │                                   │
       ▼                                   │
clientRef.ttsSpeakStream({                 │
  correlationId,                           │
  text,                                    │
  voice,                                  │
  speed                                   │
})
       │                                   │
       ▼                                   │
Backend: speak_stream()                   │
  — Returns immediately with {accepted: true}
  — Spawns tokio::task::spawn_blocking
  — sherpa-onnx generate_with_config() with callback
       │                                   │
       │  tts.stream.chunk events         │
       ▼                                   │
onChatTtsStreamChunkEvent(event)          │
       │                                   │
       ▼                                   │
playChatTtsStreamChunk(pcm16Base64, sr)   │
  — decodeBase64ToUint8Array()
  — Int16 → Float32 conversion
  — Web Audio API buffer scheduling
  — Avatar lip-sync update
       │
       ▼
waitForChatTtsStreamDone() ◄──────────────┘
  — Resumes queue loop for next chunk
```

### 2.2 Key Constants

```typescript
const CHAT_TTS_MIN_SENTENCE_CHARS = 24;
const CHAT_TTS_FIRST_CHUNK_TARGET = 95;
const CHAT_TTS_STEADY_CHUNK_TARGET = 260;
const CHAT_TTS_MIN_FLUSH_CHARS = 70;
const CHAT_TTS_FLUSH_INTERVAL_MS = 180;
const CHAT_TTS_MERGE_TARGET = 320;
const CHAT_TTS_STREAMING_ENABLED = true;  // hardcoded — non-streaming path is dead
```

---

## 3. Critical Bugs

### Bug 1: nextSpeakableBoundary Returns -1 for Mid-Sentence Text (SKIPPED TEXT)

**Location**: `ChatTtsPipeline.nextSpeakableBoundary` (lines 229-250) and `main.ts` duplicate (lines 2108-2137)

**Problem**: When text has no sentence-ending punctuation (`.!?\n`) and is shorter than `eagerTarget` (260 chars), the function returns `-1`. This causes the `enqueueSpeakableChunk` loop to `break` without emitting, leaving text permanently stuck in `streamBuffer`.

```typescript
// chatTtsPipeline.ts lines 242-246
if (text.length >= eagerTarget) {
  const split = this.findSafeWordBoundary(text, eagerTarget - 4, 55);
  if (split >= 55) return split;
  if (finalFlush) return text.length;
  return -1;  // BUG: returns -1 when no punctuation and below target
}
if (finalFlush) return text.length;
return -1;  // BUG: also returned here
```

**Example**: "Hello world, this is a test message" (38 chars, no period) → returns `-1` → text never spoken.

---

### Bug 2: Duplicate Boundary Logic Creates Inconsistent Behavior

**Problem**: Three separate implementations of boundary-finding logic:

1. `ChatTtsPipeline.nextSpeakableBoundary()` (lines 229-250)
2. `main.ts` standalone `nextSpeakableBoundary()` (lines 2108-2137) — exact duplicate
3. `ChatTtsPipeline.tryLowLatencyBufferFlush()` (lines 147-166) — third logic path

These can disagree on where to split the same text, causing unpredictable chunk boundaries.

---

### Bug 3: Correlation ID Check Drops Valid Chunks

**Location**: `main.ts` line 1931-1937

```typescript
function onChatTtsStreamChunkEvent(event: AppEvent): void {
  if (chatTtsActiveStreamRequestId && event.correlationId !== chatTtsActiveStreamRequestId) {
    pushConsoleEntry("warn", "browser",
      `TTS stream drop: req=${event.correlationId.slice(0, 8)} active=${chatTtsActiveStreamRequestId.slice(0, 8)}`
    );
    return;  // DROPS chunks from mismatched correlation IDs
  }
  ...
}
```

**Problem**: `chatTtsActiveStreamRequestId` is only set AFTER `synthesizeChatTtsChunk` returns (line 2424). If any chunk event fires before this assignment, it is silently dropped.

---

### Bug 4: Web Audio Timing Reset on Context Creation

**Location**: `main.ts` lines 1979-1985

```typescript
function playChatTtsStreamChunk(requestCorrelationId: string, pcm16Base64: string, sampleRate: number): void {
  if (!chatTtsStreamAudioContext) {
    chatTtsStreamAudioContext = new AudioContext();
    chatTtsStreamNextStartAtSec = chatTtsStreamAudioContext.currentTime + 0.12;
    ...
  }
}
```

**Problem**: The 120ms lookahead buffer (`+0.12`) can collide with actual chunk scheduling if events fire out of order or late. No guard against double-scheduling.

---

### Bug 5: Avatar Lip-Sync Coupling

**Problem**: TTS playback is tightly coupled to avatar animation via `updateAvatarPhonemeTimeline()` and `updateAvatarSpeechState()`. The `phonemeUtils.ts` uses a grapheme-to-phoneme approximation (not actual TTS phonemes), yet drives the avatar's mouth movements. If lip-sync fails, it does not affect audio but adds coupling that could cause timing issues.

---

## 4. Dead Code / Removable Complexity

### 4.1 Speculation Services (Irrelevant to TTS)

`VoiceSpeculationService` and `voice_speculation_service.rs` are used only for speculative prefix generation during VAD (voice activity detection) processing. **Zero involvement in text-streamed TTS playback**.

Files to remove:
- `src-tauri/src/app/voice_speculation_service.rs`
- `src-tauri/src/voice/speculation/` directory

### 4.2 Handoff Services

`VoiceHandoffService` coordinates VAD method handoffs. Not used in TTS streaming.

Files to remove:
- `src-tauri/src/app/voice_handoff_service.rs`
- `src-tauri/src/voice/handoff/` directory

### 4.3 Pre-warm Synthesis

`prewarmChatTtsIfNeeded()` (lines 2381-2411) synthesizes "Hi there, what would you like to work on?" when voice mode activates. This is unnecessary — models warm up naturally on first use, and the warmup phrase itself triggers TTS.

```typescript
async function prewarmChatTtsIfNeeded(): Promise<void> {
  // ...
  await clientRef.ttsSpeak({
    correlationId: nextCorrelationId(),
    text: "Hi there, what would you like to work on?",
    voice: state.tts.selectedVoice,
    speed: state.tts.speed
  });
  // ...
}
```

### 4.4 Non-Streaming Path is Dead Code

`CHAT_TTS_STREAMING_ENABLED` is hardcoded `true` at line 1544. The non-streaming `ttsSpeak` path (line 2346) is never executed for chat TTS.

### 4.5 Duplicate Boundary Functions

`main.ts` contains a copy of `nextSpeakableBoundary` (lines 2108-2137) that duplicates `ChatTtsPipeline.nextSpeakableBoundary`. The standalone function should be removed; all boundary logic should flow through `ChatTtsPipeline`.

---

## 5. Proposed Simplification Plan

### Phase 1: Remove Dead Code (No Risk)

| Action | Files/Lines |
|--------|-------------|
| Remove `VoiceSpeculationService` | `src-tauri/src/app/voice_speculation_service.rs`, `src-tauri/src/voice/speculation/` |
| Remove `VoiceHandoffService` | `src-tauri/src/app/voice_handoff_service.rs`, `src-tauri/src/voice/handoff/` |
| Remove pre-warm synthesis | `main.ts:2381-2411` |
| Remove `CHAT_TTS_STREAMING_ENABLED` branching | `main.ts:2327-2344` |
| Remove duplicate `nextSpeakableBoundary` | `main.ts:2108-2154` |
| Remove non-streaming `ttsSpeak` path | `main.ts:2346-2369` |

### Phase 2: Fix Core Bugs

| Bug | Fix |
|-----|-----|
| Boundary returns -1 | Always return `text.length` at `finalFlush=true`, never -1 |
| Duplicate boundary logic | Single source of truth in `ChatTtsPipeline`; remove standalone function |
| Correlation ID timing | Set `chatTtsActiveStreamRequestId` before awaiting stream response, or use promise-based resolution |

### Phase 3: Architectural Cleanup (If Time Permits)

| Action | Notes |
|--------|-------|
| Extract TTS from `main.ts` | Create `frontend/src/tts/chatTts.ts` (~300-400 lines) |
| Decouple avatar lip-sync | Ensure `updateAvatarPhonemeTimeline` failures don't affect TTS flow |
| Consider WebSocket | Replace Tauri event streaming with WebSocket for proper backpressure |

---

## 6. What's Safe to Remove Entirely

| Component | Reason |
|-----------|--------|
| `VoiceSpeculationService` | Speculative prefix generation is for VAD voice conversation, not text streaming TTS |
| `VoiceHandoffService` | VAD method handoff, irrelevant to TTS |
| `prewarmChatTtsIfNeeded()` | Artificially warms TTS with hardcoded phrase; not needed |
| Non-streaming `ttsSpeak` path | Only `ttsSpeakStream` is used for chat TTS |
| `CHAT_TTS_STREAMING_ENABLED` constant | Hardcoded `true`; no runtime switching |

## 7. What's NOT Safe to Remove (Critical Path)

- `ChatTtsPipeline` — text segmentation engine
- `playChatTtsStreamChunk` — Web Audio playback
- Backend `speak_stream` + `generate_with_config` callback mechanism
- `runChatTtsQueue` — queue orchestration
- `ingestChatStreamForTts` / `flushChatStreamForTts` — stream ingestion

---

## 8. Root Cause Hypothesis for Skipped Text

The most likely cause of "large chunks of text completely skipped":

1. `nextSpeakableBoundary` returns `-1` for text segments without sentence punctuation
2. Text sits in `streamBuffer` indefinitely
3. At `finalFlush`, the text should be emitted via `return text.length`, but due to the `-1` return earlier in `nextSpeakableBoundary`, combined with the conditional at line 240 `if (boundary >= 0 && boundary + 1 >= this.options.minSentenceChars)`, text below `minSentenceChars` (24) with no punctuation is silently discarded

**Fix**: Ensure `nextSpeakableBoundary` always returns a valid boundary (≥ 0) when `finalFlush=true`.
