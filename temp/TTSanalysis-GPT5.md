# TTS Analysis - GPT-5

## Scope

This review traces the current chat auto-speak and TTS streaming path end-to-end, with emphasis on bugs where large sections of text or audio are skipped. No code changes were made as part of this analysis.

Primary files reviewed:

- `frontend/src/main.ts`
- `frontend/src/voice/chatTtsPipeline.ts`
- `frontend/src/app/events.ts`
- `frontend/src/app/chatSend.ts`
- `frontend/src/ipcClient.ts`
- `src-tauri/src/tts/mod.rs`
- `src-tauri/src/contracts.rs`

## Current Pipeline

The current implementation has two different streaming layers operating at the same time.

1. Chat response streaming emits assistant text deltas through `chat.stream.chunk` events.
2. `handleChatStreamEvent` forwards each assistant text delta to `ingestChatStreamForTts`.
3. `ChatTtsPipeline` strips inline/fenced code, buffers speakable text, finds sentence or word boundaries, and enqueues speakable chunks.
4. `runChatTtsQueue` consumes queued text chunks sequentially.
5. `synthesizeChatTtsChunk` currently uses `clientRef.ttsSpeakStream` because `CHAT_TTS_STREAMING_ENABLED` is a constant `true`.
6. Backend `speak_stream` returns quickly with an accepted response, then starts a detached Tauri task that emits `tts.stream.chunk` events containing base64 PCM16 audio.
7. Frontend `onChatTtsStreamChunkEvent` decodes each PCM chunk and schedules it manually through Web Audio.
8. The queue advances when a stream waiter is resolved by a final stream chunk or by a `tts.request complete` event.

Important locations:

- Text ingestion: `frontend/src/main.ts:2498-2525`
- Final text flush: `frontend/src/main.ts:2527-2545`
- Queue loop: `frontend/src/main.ts:2413-2496`
- Chunk synthesis selection: `frontend/src/main.ts:2316-2370`
- Stream event handling: `frontend/src/main.ts:1924-1959`
- PCM scheduling: `frontend/src/main.ts:1974-2055`
- Text queue/parser implementation: `frontend/src/voice/chatTtsPipeline.ts`
- Chat event routing: `frontend/src/app/events.ts:229-379`
- Backend stream implementation: `src-tauri/src/tts/mod.rs:1786-2037`

## Most Likely Skip Causes

### 1. Backend streaming callback may drop audio chunks

In `src-tauri/src/tts/mod.rs:1884-1894`, backend streaming assumes the sherpa callback's `samples` argument is cumulative. It tracks `already_emitted` and emits only `samples[already_emitted..]`.

If sherpa's callback provides incremental chunks instead of cumulative output, then any later callback whose chunk length is less than or equal to the previously emitted sample count is discarded entirely.

This is the strongest match for the reported symptom: large portions of generated speech can be skipped even when the text queue is correct.

Risk pattern:

- First callback has 20,000 samples, emits 20,000.
- Second callback has 5,000 new samples, but `already_emitted` is 20,000.
- Code sees `already_emitted >= samples.len()` and returns without emitting.
- The entire second callback's audio is skipped.

The implementation needs confirmation against sherpa-onnx callback semantics before it can be trusted.

### 2. Frontend queue advances on stream completion, not actual playback completion

In stream mode, `runChatTtsQueue` waits on `waitForChatTtsStreamDone`, not on Web Audio playback drain:

- `frontend/src/main.ts:2440-2442`
- `frontend/src/main.ts:1898-1922`

The final event indicates backend generation is complete. It does not necessarily mean all PCM chunks have arrived, been accepted, scheduled, and played.

This can allow the next TTS request to become active while prior audio is still arriving or scheduled.

### 3. Active request filtering can discard valid late chunks

`onChatTtsStreamChunkEvent` drops chunks when their correlation ID does not match `chatTtsActiveStreamRequestId`:

- `frontend/src/main.ts:1931-1937`

This is intended to protect against stale audio, but it is brittle. If event delivery is delayed or slightly reordered, valid chunks from the prior request can be dropped after the queue advances to a new active request.

This is especially risky because completion and final events can resolve waiters before the frontend has necessarily processed every progress chunk.

### 4. There are two completion paths for one stream

Waiters resolve on both:

- `tts.stream.chunk` with `final: true` in `frontend/src/main.ts:1951-1957`
- `tts.request complete` in `frontend/src/app/events.ts:128-129`

Multiple completion signals make ordering harder to reason about. If `tts.request complete` arrives before all chunk events are processed, the queue can advance too early.

### 5. Backend `ttsStop` is not true cancellation

`src-tauri/src/tts/mod.rs:1595-1600` only clears cached TTS engines through `tts_state.shutdown()` and returns `stopped: true`.

It does not cancel any currently running `speak_stream` task. The frontend must therefore rely on local stop flags and correlation filtering, which increases stale-event race risk.

### 6. Full-response fallback adds a second frontend text path

`frontend/src/app/chatSend.ts:126-151` speaks the full `response.assistantMessage` if no stream delta was observed.

This fallback is useful for non-streaming responses, but it creates another path into the same TTS queue with different segmentation behavior. It should be kept isolated from live streaming behavior or simplified after the main path is stable.

## Complexity That Can Potentially Be Removed

### Highest-confidence removal: backend PCM streaming for chat auto-speak

The largest simplification is to remove `ttsSpeakStream` from the chat auto-speak path and use `ttsSpeak` for each frontend text chunk.

This preserves frontend text streaming and chunking, but removes backend PCM event streaming and manual Web Audio scheduling.

Likely removable or greatly simplified if this is done:

- `CHAT_TTS_STREAMING_ENABLED`
- `chatTtsActiveStreamRequestId`
- `chatTtsStreamAudioContext`
- `chatTtsStreamNextStartAtSec`
- `chatTtsStreamFinalizeTimerId`
- `chatTtsStreamDoneWaiters`
- `chatTtsRequestToChatCorrelation`, unless still needed for metrics
- `chatTtsStreamStatsByRequest`
- `chatTtsStreamChunkSeq`
- `onChatTtsStreamChunkEvent`
- `playChatTtsStreamChunk`
- `scheduleChatTtsStreamFinalize`
- `waitForChatTtsStreamDone`
- `resolveChatTtsStreamWaiters`
- backend `speak_stream`, if no other product path needs it
- `TtsSpeakStreamResponse`, if backend stream support is fully removed

This would make the queue invariant much simpler: one text item produces one audio blob, and playback completion is the only signal that advances the queue.

### Remove obsolete frontend helpers

These appear to be remnants from before `ChatTtsPipeline` owned the parser/queue internals:

- `clearChatTtsFlushTimer` in `frontend/src/main.ts:1730-1732`
- `notifyChatTtsQueueAvailable` in `frontend/src/main.ts:1772-1774`
- `nextSpeakableBoundary` in `frontend/src/main.ts:2108-2137`
- `findSafeWordBoundary` in `frontend/src/main.ts:2139-2154`

The equivalent boundary logic now lives inside `frontend/src/voice/chatTtsPipeline.ts`.

### Remove unused stream tracking

`chatTtsStreamSeenByRequest` appears unused except for clearing:

- Defined at `frontend/src/main.ts:1526`
- Cleared at `frontend/src/main.ts:1811`

It can likely be removed independently.

### Reconsider low-latency flush timers

`ChatTtsPipeline.scheduleLowLatencyBufferFlush` and `tryLowLatencyBufferFlush` add timer-based flushing on top of natural sentence and word-boundary flushing.

They may be useful for latency, but they increase state transitions. If stability remains poor after disabling backend PCM streaming, the next simplification would be to remove timer flushing and only flush on deterministic boundaries plus final response completion.

## Recommended Stabilization Plan

### Phase 1: Make auto-speak deterministic

Route chat auto-speak through `ttsSpeak` only.

Expected behavior:

- Keep frontend text streaming and chunking.
- Each queue item calls backend `ttsSpeak`.
- Frontend plays one complete WAV response.
- Queue advances only after playback ends or local stop is requested.

This should remove the most likely large-audio-skip bug without changing how assistant text is received.

### Phase 2: Delete or isolate backend PCM streaming

After the deterministic path works, remove the unused streaming branch from auto-speak code.

If backend streaming is still desired for future latency work, isolate it behind an explicit experimental path rather than keeping it interleaved with the stable queue.

### Phase 3: Add accounting logs before further tuning

Add simple per-correlation counters:

- assistant stream chars received
- speakable chars enqueued
- chars sent to TTS synthesis
- chars whose audio playback completed

This gives a practical invariant: every speakable character should be accounted for exactly once.

The current `TTS text stats` log includes streamed and enqueued chars, but it does not track synthesized or played chars.

### Phase 4: Simplify `ChatTtsPipeline`

Keep only the parts necessary for correctness:

- code fence / inline code filtering
- text buffering
- sentence/word-boundary splitting
- FIFO queue

Defer latency optimizations until correctness is proven.

### Phase 5: If streaming is reintroduced, fix it with stronger guarantees

Before using backend PCM streaming again:

- Confirm whether sherpa callback samples are cumulative or incremental.
- Emit audio according to verified semantics.
- Include and enforce sequence numbers on the frontend.
- Do not resolve queue waiters until audio chunks are scheduled and playback has drained.
- Replace active-request dropping with generation-based cancellation.
- Implement real backend cancellation or stop advertising `ttsStop` as cancelling active synthesis.

## Recommended First Change

The first change should be small and reversible: make chat auto-speak use `ttsSpeak` instead of `ttsSpeakStream`.

This removes the riskiest part of the current pipeline from active use while preserving most user-visible behavior. If large skips disappear, that strongly implicates backend PCM streaming or frontend stream event ordering. If skips remain, the investigation can focus on frontend text segmentation and queueing with much less noise.
