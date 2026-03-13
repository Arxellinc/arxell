import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { useVoiceStore } from "../store/voiceStore";
import { chatCancel, prefillWarmup, voiceStart, voiceStop } from "../lib/tauri";
import { useChatStore } from "../store/chatStore";
import type { AmplitudeEvent, TranscriptEvent, VoiceStateEvent } from "../types";

const BARGE_IN_GRACE_MS = 900;
const BARGE_IN_MIN_AMPLITUDE = 0.012;
const PREFILL_DEBUG_LOGS = false;
const PARTIAL_UI_HZ = 6;
const PARTIAL_UI_INTERVAL_MS = Math.max(1, Math.floor(1000 / PARTIAL_UI_HZ));

function isNonVerbalOnlyTranscript(textRaw: string): boolean {
  const text = textRaw.trim();
  if (!text) return true;

  // Strip non-verbal annotations — Whisper uses [brackets], (parens), or *asterisks*
  // e.g. [typing], [Music], (cough), *cough*, [BLANK_AUDIO]
  const stripped = text
    .replace(/[\[(][^\])\n]{1,60}[\])]/g, " ")
    .replace(/\*[^*\n]{1,60}\*/g, " ")
    .replace(/[\s,.;:!?'"`~\-_/\\|()\[\]*]+/g, "")
    .trim();

  return stripped.length === 0;
}

export function useVoiceEvents(onTranscript?: (text: string) => void) {
  // Avoid subscribing this hook host to the entire voice store.
  // Event handlers write through getState() so unrelated voice-store updates
  // (like amplitude ticks) don't force React re-renders via this hook.

  // Track the last stable-zone text sent for prefill (to avoid duplicate requests)
  const lastPrefillZone = useRef<string>("");
  const lastPrefillAt = useRef<number>(0);
  const lastPrefillWordCount = useRef<number>(0);
  const partialUiLastEmitAt = useRef<number>(0);
  const partialUiPending = useRef<string | null>(null);
  const partialUiTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const emitPartialUi = (text: string) => {
      useVoiceStore.getState().setPartialText(text);
      partialUiLastEmitAt.current = Date.now();
    };

    const flushPartialUiPending = () => {
      partialUiTimer.current = null;
      const pending = partialUiPending.current;
      if (pending == null) return;
      partialUiPending.current = null;
      emitPartialUi(pending);
    };

    const setPartialTextThrottled = (text: string) => {
      const now = Date.now();
      const elapsed = now - partialUiLastEmitAt.current;
      if (elapsed >= PARTIAL_UI_INTERVAL_MS) {
        if (partialUiTimer.current) {
          clearTimeout(partialUiTimer.current);
          partialUiTimer.current = null;
        }
        partialUiPending.current = null;
        emitPartialUi(text);
        return;
      }
      partialUiPending.current = text;
      if (partialUiTimer.current == null) {
        partialUiTimer.current = setTimeout(
          flushPartialUiPending,
          PARTIAL_UI_INTERVAL_MS - elapsed
        );
      }
    };

    const clearPartialUiThrottle = () => {
      if (partialUiTimer.current) {
        clearTimeout(partialUiTimer.current);
        partialUiTimer.current = null;
      }
      partialUiPending.current = null;
      partialUiLastEmitAt.current = 0;
    };

    const unlistenState = listen<VoiceStateEvent>("voice:state", (e) => {
      const vs = useVoiceStore.getState();
      const newVoiceState = e.payload.state;

      // ── Barge-in detection ────────────────────────────────────────────────
      // If the user starts speaking while the agent is playing audio, interrupt it
      if (vs.pipelineState === "agent_speaking" && vs.bargeInEnabled) {
        const elapsed = Date.now() - (vs.agentSpeakingSince || 0);
        const hasAmplitude = vs.amplitude >= BARGE_IN_MIN_AMPLITUDE;
        const isConfidentSpeech = newVoiceState === "speaking";
        const canInterrupt = elapsed >= BARGE_IN_GRACE_MS && hasAmplitude && isConfidentSpeech;

        if (canInterrupt) {
          vs.stopCurrentAudio?.();
          chatCancel().catch(console.error);
          // Immediately clear isStreaming so the next transcript isn't dropped
          // by dispatchTranscript's isStreaming guard. chatCancel() sets the
          // Rust cancel flag but does NOT guarantee a done chunk arrives.
          useChatStore.getState().finishStreaming();
          vs.setPipelineState("interrupted");
        }
      } else if (newVoiceState === "listening" || newVoiceState === "speaking") {
        if (vs.pipelineState !== "interrupted") {
          vs.setPipelineState("user_speaking");
        }
      }

      useVoiceStore.getState().setState(newVoiceState);

      if (newVoiceState === "idle") {
        clearPartialUiThrottle();
        vs.setPartialText(null);
        // Reset pipeline from user_speaking / interrupted → idle
        const cur = useVoiceStore.getState().pipelineState;
        if (cur === "user_speaking" || cur === "interrupted") {
          useVoiceStore.getState().setPipelineState("idle");
        }
        // Reset prefill dedup ref
        lastPrefillZone.current = "";
        lastPrefillAt.current = 0;
        lastPrefillWordCount.current = 0;
      }
    });

    const unlistenAmplitude = listen<AmplitudeEvent>("voice:amplitude", (e) => {
      useVoiceStore.getState().setAmplitude(e.payload.level);
    });

    const unlistenTranscript = listen<TranscriptEvent>("voice:transcript", (e) => {
      const finalText = e.payload.text;

      // ── Divergence logging (optional debug only) ─────────────────────────
      if (PREFILL_DEBUG_LOGS && lastPrefillZone.current) {
        const zoneWords  = lastPrefillZone.current.toLowerCase().split(/\s+/).filter(Boolean);
        const finalWords = finalText.toLowerCase().split(/\s+/).filter(Boolean);
        const matchLen = Math.min(zoneWords.length, finalWords.length);
        let hits = 0;
        for (let i = 0; i < matchLen; i++) {
          if (finalWords[i] === zoneWords[i]) hits++;
          else break; // prefix match only
        }
        const ratio = matchLen > 0 ? hits / zoneWords.length : 0;
        const threshold = useVoiceStore.getState().prefillDivergenceThreshold;
        if (ratio >= threshold) {
          console.debug(`[prefill] cache hit — overlap ${(ratio * 100).toFixed(0)}% (${hits}/${zoneWords.length} words)`);
        } else {
          console.debug(`[prefill] cache miss — overlap ${(ratio * 100).toFixed(0)}% (${hits}/${zoneWords.length} words), final: "${finalText.slice(0, 60)}"`);
        }
      }
      lastPrefillZone.current = "";

      clearPartialUiThrottle();
      useVoiceStore.getState().setPartialText(null);
      useVoiceStore.getState().setTranscript(finalText);
      onTranscript?.(finalText);
    });

    const unlistenPartial = listen<{ text: string }>("voice:partial", (e) => {
      const vs = useVoiceStore.getState();
      if (vs.state !== "listening" && vs.state !== "speaking") return;

      setPartialTextThrottled(e.payload.text);

      // ── Stable-zone prefill ───────────────────────────────────────────────
      if (!vs.prefillEnabled) return;

      const words = e.payload.text.trim().split(/\s+/).filter(Boolean);
      const tailCount  = Math.max(0, vs.stableTailWords);
      const stableZone = words.slice(0, Math.max(0, words.length - tailCount)).join(" ");

      if (stableZone.split(/\s+/).filter(Boolean).length < vs.prefillMinWords) return;
      if (stableZone === lastPrefillZone.current) return; // same zone, skip

      const now = Date.now();
      const stableWords = stableZone.split(/\s+/).filter(Boolean).length;
      const wordGrowth = stableWords - lastPrefillWordCount.current;
      // Tune: avoid flooding warmups on tiny transcript deltas unless enough
      // time has passed.
      if (wordGrowth < 2 && now - lastPrefillAt.current < 850) return;

      lastPrefillZone.current = stableZone;
      lastPrefillAt.current = now;
      lastPrefillWordCount.current = stableWords;

      const convId = useChatStore.getState().activeConversationId;
      if (!convId) return;

      prefillWarmup(convId, stableZone).catch((err) =>
        console.debug("[prefill] warmup error:", err)
      );
    });

    const unlistenError = listen<{ message: string }>("voice:error", (e) => {
      // Discard errors that arrive after voice mode has been turned off.
      // The Rust transcription thread can still emit errors for buffered audio
      // captured just before voiceStop() — they're harmless but confusing.
      if (!useVoiceStore.getState().voiceMode) return;

      console.error("[voice:error]", e.payload.message);
      clearPartialUiThrottle();
      useVoiceStore.getState().setPartialText(null);
      lastPrefillZone.current = "";
      useVoiceStore.getState().setError(e.payload.message);
      setTimeout(() => useVoiceStore.getState().setError(null), 6000);

      // If we're in Rust-STT voice mode, the capture thread has already exited
      // by the time an error fires. Auto-restart after a brief pause so the
      // conversation loop doesn't die on a transient STT failure.
      const vs = useVoiceStore.getState();
      if (vs.voiceMode && !vs.useBrowserSR) {
        setTimeout(() => {
          if (useVoiceStore.getState().voiceMode) {
            voiceStart().catch(console.error);
          }
        }, 2000);
      }
    });

    return () => {
      clearPartialUiThrottle();
      unlistenState.then((fn) => fn());
      unlistenAmplitude.then((fn) => fn());
      unlistenTranscript.then((fn) => fn());
      unlistenPartial.then((fn) => fn());
      unlistenError.then((fn) => fn());
    };
  }, [onTranscript]);
}

export function useVoiceControls() {
  const state = useVoiceStore((s) => s.state);

  const toggleVoice = async () => {
    if (state === "idle") {
      await voiceStart();
    } else {
      await voiceStop();
    }
  };

  return { toggleVoice, isActive: state !== "idle" };
}

// Full voice conversation mode.
// Tries browser SpeechRecognition first (no server needed).
// Falls back to Rust audio capture + backend Whisper STT.
export function useVoiceMode(sendMessage: (text: string) => void) {
  const { voiceMode } = useVoiceStore();
  const sendRef = useRef(sendMessage);
  const lastSentRef = useRef<{ text: string; at: number }>({ text: "", at: 0 });
  sendRef.current = sendMessage;

  const dispatchTranscript = (textRaw: string) => {
    const text = textRaw.trim();
    if (!text) return;
    if (isNonVerbalOnlyTranscript(text)) return;

    const now = Date.now();
    const last = lastSentRef.current;
    if (last.text === text && now - last.at < 1500) {
      return;
    }
    if (useChatStore.getState().isStreaming) {
      return;
    }

    lastSentRef.current = { text, at: now };
    sendRef.current(text);
  };

  useEffect(() => {
    if (!voiceMode) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SR: (new () => any) | undefined =
      (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;

    if (SR) {
      // ── Browser Speech Recognition path ──────────────────────────────────
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const recognition: any = new SR();
      recognition.continuous = false; // one utterance at a time — restarter handles loop
      recognition.interimResults = true;
      let active = true;
      let finalTranscript = "";
      let sentFinal = "";
      let lastPrefillZoneBrowser = "";
      let lastBrowserPrefillAt = 0;
      let lastBrowserPrefillWords = 0;
      let browserPartialUiLastEmitAt = 0;
      let browserPartialUiPending: string | null = null;
      let browserPartialUiTimer: ReturnType<typeof setTimeout> | null = null;

      const emitBrowserPartialUi = (text: string) => {
        useVoiceStore.getState().setPartialText(text);
        browserPartialUiLastEmitAt = Date.now();
      };

      const flushBrowserPartialUi = () => {
        browserPartialUiTimer = null;
        if (browserPartialUiPending == null) return;
        const text = browserPartialUiPending;
        browserPartialUiPending = null;
        emitBrowserPartialUi(text);
      };

      const setBrowserPartialUiThrottled = (text: string) => {
        const now = Date.now();
        const elapsed = now - browserPartialUiLastEmitAt;
        if (elapsed >= PARTIAL_UI_INTERVAL_MS) {
          if (browserPartialUiTimer) {
            clearTimeout(browserPartialUiTimer);
            browserPartialUiTimer = null;
          }
          browserPartialUiPending = null;
          emitBrowserPartialUi(text);
          return;
        }
        browserPartialUiPending = text;
        if (browserPartialUiTimer == null) {
          browserPartialUiTimer = setTimeout(
            flushBrowserPartialUi,
            PARTIAL_UI_INTERVAL_MS - elapsed
          );
        }
      };

      const clearBrowserPartialUiThrottle = () => {
        if (browserPartialUiTimer) {
          clearTimeout(browserPartialUiTimer);
          browserPartialUiTimer = null;
        }
        browserPartialUiPending = null;
        browserPartialUiLastEmitAt = 0;
      };

      const startRecognition = () => {
        if (!active) return;
        try {
          sentFinal = "";
          finalTranscript = "";
          lastPrefillZoneBrowser = "";
          clearBrowserPartialUiThrottle();
          useVoiceStore.getState().setState("listening");
          recognition.start();
        } catch {
          // already started
        }
      };

      recognition.onresult = (e: any) => {
        let interim = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          const transcript = (r[0]?.transcript as string | undefined)?.trim() ?? "";
          if (!transcript) continue;
          if (r.isFinal) {
            finalTranscript = `${finalTranscript} ${transcript}`.trim();
          } else {
            interim = `${interim} ${transcript}`.trim();
          }
        }

        const combined = `${finalTranscript} ${interim}`.trim();
        const vs = useVoiceStore.getState();

        // Show interim text in InputBar and update voice state so VoiceIndicator
        // transitions to "speaking" (matching the Rust VAD path behaviour).
        if (combined) {
          setBrowserPartialUiThrottled(combined);
          if (vs.state === "listening") vs.setState("speaking");
        } else if (vs.state === "speaking") {
          clearBrowserPartialUiThrottle();
          vs.setState("listening");
          vs.setPartialText(null);
        }

        // Speculative prefill while speaking (browser SR path)
        if (combined && vs.voiceMode && vs.prefillEnabled) {
          const words = combined.split(/\s+/).filter(Boolean);
          const tailCount = Math.max(0, vs.stableTailWords);
          const stableZone = words.slice(0, Math.max(0, words.length - tailCount)).join(" ");

          if (
            stableZone &&
            stableZone !== lastPrefillZoneBrowser &&
            stableZone.split(/\s+/).filter(Boolean).length >= vs.prefillMinWords
          ) {
            const now = Date.now();
            const stableWords = stableZone.split(/\s+/).filter(Boolean).length;
            const wordGrowth = stableWords - lastBrowserPrefillWords;
            if (wordGrowth < 2 && now - lastBrowserPrefillAt < 850) {
              return;
            }
            lastPrefillZoneBrowser = stableZone;
            lastBrowserPrefillAt = now;
            lastBrowserPrefillWords = stableWords;
            const convId = useChatStore.getState().activeConversationId;
            if (convId) {
              prefillWarmup(convId, stableZone).catch((err) =>
                console.debug("[prefill] browser SR warmup error:", err)
              );
            }
          }
        }

      };

      recognition.onend = () => {
        const finalText = finalTranscript.trim();
        if (finalText && finalText !== sentFinal && useVoiceStore.getState().voiceMode) {
          sentFinal = finalText;
          dispatchTranscript(finalText);
          // Restart is handled by useChat.ts after TTS finishes
        } else {
          // No transcript (silence, noise, transient error) — restart immediately
          // so the user doesn't have to re-toggle voice mode.
          finalTranscript = "";
          lastPrefillZoneBrowser = "";
          lastBrowserPrefillAt = 0;
          lastBrowserPrefillWords = 0;
          clearBrowserPartialUiThrottle();
          useVoiceStore.getState().setPartialText(null);
          useVoiceStore.getState().setState("idle");
          setTimeout(startRecognition, 300);
          return;
        }
        finalTranscript = "";
        lastPrefillZoneBrowser = "";
        lastBrowserPrefillAt = 0;
        lastBrowserPrefillWords = 0;
        clearBrowserPartialUiThrottle();
        useVoiceStore.getState().setPartialText(null);
        useVoiceStore.getState().setState("idle");
      };

      recognition.onerror = (e: any) => {
        if (e.error === "not-allowed" || e.error === "service-not-available") {
          useVoiceStore.getState().setError("Browser speech recognition not available — configure an STT endpoint");
          useVoiceStore.getState().setUseBrowserSR(false);
          active = false;
        }
        // For other transient errors, onend will fire and restart
      };

      useVoiceStore.getState().setUseBrowserSR(true);
      startRecognition();

      // Expose restart function on the store so useChat can call it after TTS
      (useVoiceStore as unknown as { _restartBrowserSR?: () => void })._restartBrowserSR = startRecognition;

      return () => {
        active = false;
        finalTranscript = "";
        sentFinal = "";
        lastPrefillZoneBrowser = "";
        lastBrowserPrefillAt = 0;
        lastBrowserPrefillWords = 0;
        clearBrowserPartialUiThrottle();
        const vs = useVoiceStore.getState();
        vs.stopCurrentAudio?.();
        vs.setStopCurrentAudio(null);
        vs.setIsSpeaking(false);
        vs.setPipelineState("idle");
        delete (useVoiceStore as unknown as { _restartBrowserSR?: () => void })._restartBrowserSR;
        useVoiceStore.getState().setUseBrowserSR(false);
        try { recognition.abort(); } catch { /* ignore */ }
        useVoiceStore.getState().setState("idle");
      };
    } else {
      // ── Rust capture + backend Whisper STT path ───────────────────────────
      useVoiceStore.getState().setUseBrowserSR(false);
      voiceStart().catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[voice] voiceStart failed:", msg);
        const vs = useVoiceStore.getState();
        vs.setError(`Microphone unavailable: ${msg}`);
        setTimeout(() => useVoiceStore.getState().setError(null), 6000);
        // Reset voice mode so the button doesn't stay stuck in the active state
        vs.setVoiceMode(false);
      });

      const unlistenTranscript = listen<TranscriptEvent>("voice:transcript", (e) => {
        if (useVoiceStore.getState().voiceMode) {
          dispatchTranscript(e.payload.text);
        }
      });

      return () => {
        const vs = useVoiceStore.getState();
        vs.stopCurrentAudio?.();
        vs.setStopCurrentAudio(null);
        vs.setIsSpeaking(false);
        vs.setPipelineState("idle");
        voiceStop().catch(console.error);
        unlistenTranscript.then((fn) => fn());
        useVoiceStore.getState().setUseBrowserSR(false);
      };
    }
  }, [voiceMode]);
}
