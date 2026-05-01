# TTS Analysis - Final Aggregate

## Purpose

This document consolidates findings from:

- `temp/TTSanalysis-CODEX.md`
- `temp/TTSanalysis-GLM51.md`
- `temp/TTSanalysis-GPT5.md`
- `temp/TTSanalysis-MM27.md`

The goal is to identify the most likely causes of skipped TTS content, distinguish confirmed issues from uncertain claims, and propose a stabilization plan that removes complexity without breaking unrelated voice features.

## Executive Summary

The current chat auto-speak path is too complex because it streams at two different layers:

1. Chat text is streamed from the LLM to the frontend.
2. Frontend chunks that text into speakable segments.
3. Each segment is sent to backend TTS using `ttsSpeakStream`.
4. Backend TTS emits PCM audio chunks through Tauri events.
5. Frontend manually decodes and schedules those PCM chunks through Web Audio.

This creates several race windows and multiple ways to drop content. The strongest aggregate conclusion is that chat auto-speak should first be made deterministic by using `ttsSpeak` per frontend text chunk instead of backend PCM streaming. That preserves streamed assistant text and frontend chunking while removing the most failure-prone layer.

## Current End-to-End Pipeline

1. LLM emits `chat.stream.chunk` events.
2. `frontend/src/app/events.ts:352-360` routes assistant deltas to `ingestChatStreamForTts`.
3. `frontend/src/main.ts:2498-2525` filters and buffers the delta.
4. `frontend/src/voice/chatTtsPipeline.ts` handles code filtering, sentence/word-boundary splitting, queueing, merging, and low-latency flush timers.
5. `frontend/src/main.ts:2413-2496` runs the queue consumer.
6. `frontend/src/main.ts:2316-2370` calls `clientRef.ttsSpeakStream` because `CHAT_TTS_STREAMING_ENABLED` is hardcoded `true`.
7. `src-tauri/src/tts/mod.rs:1786-2037` starts a detached Tauri task and emits `tts.stream.chunk` events containing base64 PCM16 audio.
8. `frontend/src/main.ts:1924-1959` handles stream chunk events.
9. `frontend/src/main.ts:1974-2055` decodes and schedules PCM chunks through Web Audio.
10. The queue advances when stream waiters are resolved by either a final stream chunk or a `tts.request complete` event.

## Highest-Confidence Root Cause Areas

### 1. Backend PCM Streaming May Drop Audio Chunks

Location: `src-tauri/src/tts/mod.rs:1884-1894`

The backend streaming callback tracks `emitted_sample_count` and emits only `samples[already_emitted..]`. This assumes sherpa-onnx callback samples are cumulative.

If the callback actually provides incremental samples, this logic drops entire chunks after the first callback whose length is less than or equal to the previous emitted total.

Example failure pattern:

- Callback 1: `samples.len() = 20000`; emit 20000 samples.
- Callback 2: `samples.len() = 5000`; `already_emitted = 20000`.
- Code returns early because `already_emitted >= samples.len()`.
- Callback 2 audio is skipped entirely.

This is the most direct match for “large chunks skipped” when text accounting appears correct. It must be verified against sherpa-onnx callback semantics before backend PCM streaming can be trusted.

### 2. Queue Advances On Generation Completion, Not Playback Completion

Locations:

- `frontend/src/main.ts:2440-2442`
- `frontend/src/main.ts:1898-1922`

In streaming mode, `runChatTtsQueue` waits for `waitForChatTtsStreamDone`. That resolves when backend generation is marked complete, not when all scheduled Web Audio has actually played.

This can allow the next TTS request to become active while prior audio chunks are still being delivered, accepted, or played.

### 3. Active Request Filtering Can Drop Valid Late Chunks

Location: `frontend/src/main.ts:1931-1937`

`onChatTtsStreamChunkEvent` drops chunks whose correlation ID does not match `chatTtsActiveStreamRequestId`.

This is intended as stale-event protection, but it becomes dangerous when combined with premature completion. If the active request advances before all valid chunks from the previous request are processed, those valid chunks are discarded.

Important correction: chunks are not dropped before `chatTtsActiveStreamRequestId` is set. The drop only occurs when the active ID is non-null and mismatched.

### 4. Two Completion Signals Resolve The Same Stream Waiters

Locations:

- `frontend/src/main.ts:1951-1957`
- `frontend/src/app/events.ts:128-129`

Stream waiters resolve from both:

- `tts.stream.chunk` with `final: true`
- `tts.request complete`

This makes ordering hard to reason about. If `tts.request complete` arrives before all progress chunks have been processed, the queue can advance too early.

### 5. Markdown Code Filtering Can Suppress Large Text Ranges

Location: `frontend/src/voice/chatTtsPipeline.ts:67-106`

`extractSpeakableStreamDelta` suppresses inline code and fenced code across stream deltas. If malformed markdown or split backtick runs leave the parser stuck in `inInlineCode` or `inFencedCode`, all following text can be suppressed until a closing marker appears.

This may be intentional for code blocks, but without a suppression limit or accounting, it can look exactly like skipped text.

### 6. Backend `ttsStop` Is Not True Cancellation

Location: `src-tauri/src/tts/mod.rs:1595-1600`

`ttsStop` clears cached engines and returns `stopped: true`. It does not cancel already-running `speak_stream` tasks.

The frontend therefore depends on local stop flags and correlation filtering to ignore stale audio, which increases race risk.

## Medium-Confidence Or Contextual Issues

### Low-Latency Flush Timers Add State Complexity

Locations:

- `frontend/src/voice/chatTtsPipeline.ts:147-184`
- `frontend/src/main.ts:2161-2167`

`tryLowLatencyBufferFlush` and `scheduleLowLatencyBufferFlush` mutate the same buffer as normal enqueue/final-flush logic. They are useful for reducing first-audio latency, but they add another timing-dependent path.

They are not the strongest root-cause candidate, but they are good simplification targets after the backend streaming issue is addressed.

### Full-Response Fallback Adds A Second Text Path

Location: `frontend/src/app/chatSend.ts:126-151`

If no stream delta was observed, completed assistant text is split and enqueued separately. This is useful for non-streaming responses, but it has different segmentation behavior from live streaming.

It should remain only as an explicit non-streaming fallback and should not overlap with streamed responses.

### Prewarm Synthesis Adds Extra TTS State

Location: `frontend/src/main.ts:2381-2411`

`prewarmChatTtsIfNeeded` synthesizes a fixed phrase to warm the model. This is probably not a direct skip cause, but it is extra state and backend work. It can be removed later if startup latency is acceptable.

## Disputed Or Incorrect Claims From The Reports

### `nextSpeakableBoundary` Does Not Permanently Trap All Mid-Sentence Text

One report claimed text shorter than the eager target with no punctuation is permanently stuck. During normal streaming, this text remains buffered, but final flush should call `nextSpeakableBoundary(..., finalFlush=true)` and return `text.length`.

So this is not a primary root cause by itself. Problems can still occur if final flush is not reached or if earlier filtering suppresses the text.

### Final-Flush Silent Discard Is Lower Confidence For Normal Prose

`enqueueSpeakableChunk` can consume a final segment without enqueuing if postprocessing and fallback produce no speakable text. However, current `postprocessSpeakableText` mostly preserves text, and fallback runs for alphanumeric raw content.

This is more likely to discard whitespace or format-only text than large normal prose. The more serious related risk is code-filter suppression before the text reaches `enqueueSpeakableChunk`.

### Do Not Remove Voice Speculation Or Handoff Services For This TTS Fix

`VoiceSpeculationService` and `VoiceHandoffService` are not part of text-streamed TTS playback, but they are used by the backend voice runtime, VAD, duplex, and handoff features.

Removing them is outside the TTS stabilization scope and could break voice mode.

### `useAudioQueue.ts` Is Not Current Chat TTS Playback, But Is Not Completely Unreferenced

`frontend/src/stt/useAudioQueue.ts` is not used by the active chat TTS path. It is imported by `useSTT.ts` and used only for `audioQueue.stop()` on speech start. Since nothing enqueues audio into it in the reviewed path, it is not relevant to current chat TTS skips.

## Removable Complexity

### Safe Or Nearly Safe Cleanup

These are dead or obsolete in the reviewed TTS path:

- `frontend/src/main.ts:1730-1732` `clearChatTtsFlushTimer`
- `frontend/src/main.ts:1772-1774` `notifyChatTtsQueueAvailable`
- `frontend/src/main.ts:2108-2137` standalone `nextSpeakableBoundary`
- `frontend/src/main.ts:2139-2154` standalone `findSafeWordBoundary`
- `chatTtsStreamSeenByRequest`, which appears unused except for clearing

### Diagnostic-Only State That Can Be Removed Later

These do not control playback behavior:

- `chatTtsStreamStatsByRequest`
- `noteChatTtsStreamChunk`
- `flushChatTtsStreamStats`
- `chatTtsStreamChunkSeq`, except for throttled diagnostic logging
- `textStatsByCorrelation`, if replaced by better accounting logs

### Best High-Impact Removal

Remove backend PCM streaming from chat auto-speak first.

That means routing each frontend text chunk through `ttsSpeak` instead of `ttsSpeakStream`. This would make the queue invariant straightforward:

1. One text chunk enters synthesis.
2. One complete audio blob returns.
3. Playback completes or is locally stopped.
4. Only then does the next text chunk start.

If this change eliminates skips, the culprit is almost certainly backend PCM streaming or frontend stream-event ordering.

## Recommended Stabilization Plan

### Phase 1: Establish A Deterministic Baseline

Change chat auto-speak to call `ttsSpeak` per queued text chunk.

Keep:

- chat text streaming
- `ChatTtsPipeline` buffering and segmentation
- existing `playTtsAudio` complete-audio playback

Bypass:

- `ttsSpeakStream`
- `tts.stream.chunk` PCM event handling
- manual PCM Web Audio scheduling
- stream waiters
- active stream request filtering

Expected result: lower latency than reading the entire response at the end, but much more deterministic than backend PCM streaming.

### Phase 2: Add Accounting Logs

Add per-chat-correlation counters:

- assistant text chars received from stream
- speakable chars after filtering
- chars enqueued to TTS queue
- chars sent to backend synthesis
- chars whose audio playback completed

This creates an explicit invariant: speakable text should be synthesized and played exactly once.

### Phase 3: Harden Text Filtering

Either temporarily disable markdown code suppression for reliability testing or add safety valves:

- maximum suppressed inline-code character count
- maximum suppressed fenced-code character count
- diagnostic log when suppression exceeds threshold
- final-flush behavior that reports suppressed trailing content

This prevents malformed markdown from swallowing the rest of an answer invisibly.

### Phase 4: Simplify The Queue And Buffering

After stability is verified:

- remove low-latency timer flushing if it is not necessary
- use one deterministic split path
- consider one chunk target instead of separate first/steady targets
- keep final flush mandatory and observable

### Phase 5: Remove Dead Helpers And Diagnostics

Remove the no-op and duplicate helpers listed above.

Remove diagnostic-only stream state if backend PCM streaming is no longer active in chat auto-speak.

### Phase 6: Reintroduce Backend PCM Streaming Only If Needed

If latency requirements demand backend PCM streaming later, reintroduce it behind an explicit experimental flag with stronger guarantees:

- verify sherpa callback semantics
- emit audio chunks according to confirmed semantics
- use monotonic sequence numbers on the frontend
- do not resolve queue waiters until scheduled audio has drained
- use generation-based cancellation instead of active-request dropping
- implement real backend task cancellation or rename `ttsStop` behavior honestly

## Final Recommendation

The first implementation change should be small, reversible, and diagnostic:

Route chat auto-speak through `ttsSpeak` per queued frontend text chunk and add accounting logs.

Do not start by deleting broad backend voice services or rewriting the entire queue. The immediate goal is to remove the most race-prone audio streaming layer while preserving enough of the current user experience to validate whether skips disappear.

If skips continue after this change, the investigation should focus on frontend text filtering and segmentation. If skips disappear, the backend PCM streaming path should remain disabled until its callback semantics, completion contract, and cancellation model are fixed.
