# Voice VAD V2

V2 extends the V1 Multi-VAD architecture without changing the baseline V1 path. The V1 selector remains idle-only. Live method changes use the separate handoff command so the old behavior can still be preserved by leaving V2 controls disabled.

## Roles

- Active VAD controls live segmentation and is the only role allowed to influence STT/TTS orchestration.
- Standby VAD is created during a handoff prepare phase and becomes active only after cutover succeeds.
- Shadow VAD receives mirrored frames and produces diagnostics only. It cannot start/finalize STT, cancel TTS, or mutate the session.

## Handoff

The handoff flow is transactional:

1. `voice.vad.handoff.requested`
2. eligibility check against registry capabilities
3. standby instantiation and config load
4. `voice.vad.handoff.ready`
5. cutover swaps standby into active
6. `voice.vad.handoff.complete`

Failures emit `voice.vad.handoff.rejected` or `voice.vad.handoff.rollback`. The original active strategy is retained unless cutover completes.

## Speculation

Duplex mode controls speculative behavior:

- `single_turn`: V1-compatible, speculation disabled.
- `full_duplex_speculative`: enables a short fast-path prefix.
- `full_duplex_shadow_only`: keeps full-duplex experimentation diagnostic-only.

Speculation uses a fast path for short cancellable prefixes and a confirming path over normalized VAD events. Interruption events cancel speculative speech before it is committed.

## Config

Voice settings schema is versioned at `2` and stores:

- `selectedVadMethod`
- `shadowVadMethod`
- `duplexMode`
- `handoffPolicy`
- `globalVoiceConfig`
- `vadMethods[methodId]`
- `speculation`

Method configs remain isolated under `vadMethods`.

## V1 Compatibility

Use `duplexMode: "single_turn"`, no shadow method, and no handoff request. In that mode the active VAD method runs alone and method selection remains idle-only.

