import { useState, useRef, useCallback, useEffect } from "react";
import { Send, Mic, MicOff, Square, Volume2 } from "lucide-react";
import { cn } from "../../lib/utils";
import { useVoiceStore } from "../../store/voiceStore";
import { useChatStore } from "../../store/chatStore";
import { useVoiceEvents, useVoiceControls } from "../../hooks/useVoice";
import { prefillWarmup } from "../../lib/tauri";
import type { VoiceState } from "../../types/index";

interface InputBarProps {
  onSend: (content: string) => void;
  onStop?: () => void;
  isStreaming?: boolean;
  canStop?: boolean;
  disabled?: boolean;
  voiceMode?: boolean;
}

// Status label shown during recording phases
const VOICE_LABEL: Record<VoiceState, string | null> = {
  idle:       null,
  listening:  "Listening…",
  speaking:   "Speaking…",
  processing: "Transcribing…",
};

export function InputBar({ onSend, onStop, canStop, disabled, voiceMode }: InputBarProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fpsDisplayRef = useRef<HTMLSpanElement>(null);
  // Selector-based voice subscriptions prevent high-frequency store writes
  // (amplitude/ttsAmplitude) from re-rendering InputBar unnecessarily.
  const voiceState = useVoiceStore((s) => s.state);
  const partialText = useVoiceStore((s) => s.partialText);
  const isVoiceMode = useVoiceStore((s) => s.voiceMode);
  const setVoiceMode = useVoiceStore((s) => s.setVoiceMode);
  const isSpeaking = useVoiceStore((s) => s.isSpeaking);
  const setStopCurrentAudio = useVoiceStore((s) => s.setStopCurrentAudio);
  const setIsSpeaking = useVoiceStore((s) => s.setIsSpeaking);
  const setPartialText = useVoiceStore((s) => s.setPartialText);
  const setState = useVoiceStore((s) => s.setState);
  const setPipelineState = useVoiceStore((s) => s.setPipelineState);
  const error = useVoiceStore((s) => s.error);
  const { toggleVoice, isActive } = useVoiceControls();
  const streamingMessage = useChatStore((s) => s.streamingMessage);
  const activeConversationId = useChatStore((s) => s.activeConversationId);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const messagePerfById = useChatStore((s) => s.messagePerfById);
  const lastCompletedPerfMessageId = useChatStore((s) => s.lastCompletedPerfMessageId);
  const prefillEnabled = useVoiceStore((s) => s.prefillEnabled);
  const stableTailWords = useVoiceStore((s) => s.stableTailWords);
  const prefillMinWords = useVoiceStore((s) => s.prefillMinWords);
  const lastTypingPrefillZone = useRef<string>("");
  const fpsFramesRef = useRef(0);
  const fpsStartRef = useRef(0);

  const activePerfMessageId = streamingMessage?.id ?? lastCompletedPerfMessageId;
  const activePerf = activePerfMessageId ? messagePerfById[activePerfMessageId] : null;

  const ppMs = activePerf?.firstTokenAt
    ? Math.max(0, activePerf.firstTokenAt - activePerf.startedAt)
    : null;
  const tgMs = activePerf?.firstTokenAt && activePerf.completedAt
    ? Math.max(0, activePerf.completedAt - activePerf.firstTokenAt)
    : null;
  const responseMs = activePerf?.completedAt
    ? Math.max(0, activePerf.completedAt - activePerf.startedAt)
    : null;
  const tokenRate = activePerf?.estimatedTokens && activePerf.firstTokenAt && activePerf.completedAt
    ? activePerf.estimatedTokens / Math.max(0.1, (activePerf.completedAt - activePerf.firstTokenAt) / 1000)
    : null;

  // In voice mode, render interim transcript directly in the textarea for live feedback.
  const liveVoiceText = isVoiceMode && !value && partialText ? partialText : "";
  const textareaValue = value || liveVoiceText;
  // Keep legacy inline partial preview for non-voice text input path only.
  const showingPartial = !isVoiceMode && isActive && !!partialText && !value;

  const handleTranscript = useCallback((text: string) => {
    setValue((prev) => (prev ? prev + " " + text : text));
    textareaRef.current?.focus();
  }, []);

  // In voice mode the VoiceModeButton handles transcripts — don't populate the text box
  useVoiceEvents(voiceMode ? undefined : handleTranscript);

  const handleSubmit = () => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setValue(e.target.value);
    // Auto-resize
    e.target.style.height = "auto";
    e.target.style.height = Math.min(e.target.scrollHeight, 200) + "px";
  };

  useEffect(() => {
    let rafId = 0;
    const tick = (ts: number) => {
      if (fpsStartRef.current === 0) fpsStartRef.current = ts;
      fpsFramesRef.current += 1;
      const elapsed = ts - fpsStartRef.current;
      if (elapsed >= 500) {
        const fps = (fpsFramesRef.current * 1000) / elapsed;
        if (fpsDisplayRef.current) fpsDisplayRef.current.textContent = String(Math.round(fps));
        fpsFramesRef.current = 0;
        fpsStartRef.current = ts;
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(rafId);
      fpsFramesRef.current = 0;
      fpsStartRef.current = 0;
      if (fpsDisplayRef.current) fpsDisplayRef.current.textContent = "—";
    };
  }, []);

  useEffect(() => {
    if (!prefillEnabled || isVoiceMode) return;
    if (isStreaming) return;
    if (!activeConversationId) return;

    const words = value.trim().split(/\s+/).filter(Boolean);
    const tail = Math.max(0, Math.floor(stableTailWords));
    const stableZone = words.slice(0, Math.max(0, words.length - tail)).join(" ").trim();
    const stableCount = stableZone ? stableZone.split(/\s+/).filter(Boolean).length : 0;
    if (stableCount < Math.max(1, Math.floor(prefillMinWords))) return;
    if (stableZone === lastTypingPrefillZone.current) return;

    const id = setTimeout(() => {
      if (!activeConversationId) return;
      if (!prefillEnabled || isVoiceMode || isStreaming) return;
      const latestWords = value.trim().split(/\s+/).filter(Boolean);
      const latestZone = latestWords
        .slice(0, Math.max(0, latestWords.length - tail))
        .join(" ")
        .trim();
      if (!latestZone || latestZone === lastTypingPrefillZone.current) return;
      const latestCount = latestZone.split(/\s+/).filter(Boolean).length;
      if (latestCount < Math.max(1, Math.floor(prefillMinWords))) return;
      lastTypingPrefillZone.current = latestZone;
      prefillWarmup(activeConversationId, latestZone).catch((err) =>
        console.debug("[prefill] typing warmup error:", err)
      );
    }, 700);

    return () => clearTimeout(id);
  }, [
    value,
    prefillEnabled,
    stableTailWords,
    prefillMinWords,
    activeConversationId,
    isVoiceMode,
    isStreaming,
  ]);

  const handleVoiceModeToggle = () => {
    if (isVoiceMode) {
      // Immediate hard stop when voice mode is turned off.
      const vs = useVoiceStore.getState();
      vs.stopCurrentAudio?.();
      vs.setStopCurrentAudio(null);
      vs.setIsSpeaking(false);
      vs.setPartialText(null);
      vs.setState("idle");
      vs.setPipelineState("idle");
      import("../../lib/tauri").then(({ chatCancel, voiceStop }) => {
        chatCancel().catch(console.error);
        void voiceStop().catch(console.error);
      });
      setVoiceMode(false);
    } else {
      setVoiceMode(true);
    }
  };

  const voiceIcon = {
    idle: <Mic size={16} />,
    listening: <Mic size={16} className="text-accent-primary" />,
    speaking: <Mic size={16} className="text-accent-green" />,
    processing: <Square size={16} className="text-accent-gold" />,
  }[voiceState];

  const isListening = voiceState === "listening" || voiceState === "speaking";
  const showTranscribingHint =
    isActive &&
    !partialText &&
    (voiceState === "processing" || (isVoiceMode && voiceState === "speaking"));

  return (
    <div>
      <div className="h-4 mb-1 px-1 text-[10px] leading-none text-text-dark/80 select-none">
        PP {ppMs !== null ? `${ppMs}ms` : "—"} | TG {tgMs !== null ? `${tgMs}ms` : "—"} | rate {tokenRate !== null ? `${tokenRate.toFixed(1)} tok/s` : "—"} | FPS <span ref={fpsDisplayRef}>—</span> | total {responseMs !== null ? `${responseMs}ms` : "—"}
      </div>
      <div className="chat-input-wrap">
      <div className="chat-input-container relative bg-bg-norm border border-line-med">
      
      {/* Controls at top right */}
      <div className="absolute top-2 right-[28px] flex items-center gap-1.5 z-10">
        {/* Voice Mode Button */}
        <button
          onClick={handleVoiceModeToggle}
          title={isVoiceMode ? "Exit voice conversation mode" : "Enter voice conversation mode"}
          className={cn(
            "w-8 h-8 rounded flex items-center justify-center transition-all duration-200 border",
            isVoiceMode
              ? isSpeaking
                ? "bg-bg-button border-accent-green/40 text-accent-green"
                : isListening
                ? "bg-bg-button border-accent-primary/40 text-accent-primary animate-pulse"
                : "bg-bg-button border-accent-primary/30 text-accent-primary hover:bg-bg-button"
              : "bg-bg-button border-line-med text-text-med hover:text-text-norm hover:border-line-dark"
          )}
        >
          {isSpeaking ? <Volume2 size={14} /> : <Mic size={14} />}
        </button>

        {/* Stop Button */}
        <button
          onClick={onStop}
          disabled={!canStop}
          title={canStop ? "Stop response" : "No active response"}
          className={cn(
            "w-8 h-8 rounded flex items-center justify-center transition-all border bg-bg-button",
            canStop
              ? "text-accent-red border-accent-red/30 hover:bg-bg-button"
              : "text-text-med border-line-med cursor-not-allowed"
          )}
        >
          <Square size={12} fill="currentColor" />
        </button>

        {/* Send Button */}
        <button
          onClick={handleSubmit}
          disabled={!value.trim() || disabled}
          title="Send message"
          className={cn(
            "w-8 h-8 rounded flex items-center justify-center transition-all border bg-bg-button",
            value.trim() && !disabled
              ? "text-accent-primary border-accent-primary hover:brightness-110"
              : "text-text-med border-line-med cursor-not-allowed"
          )}
        >
          <Send size={14} />
        </button>
      </div>

      {/* Subtle voice mode indicator below buttons */}
      {isVoiceMode && voiceState === "listening" && !error && !isSpeaking && (
        <div className="absolute top-11 right-[28px] text-[10px] text-accent-primary/60 select-none">
          Listening…
        </div>
      )}
      {isVoiceMode && voiceState === "processing" && !error && !isSpeaking && (
        <div className="absolute top-11 right-[28px] text-[10px] text-accent-gold/60 select-none">
          Transcribing…
        </div>
      )}
      {/* Agent speaking (TTS playback) */}
      {isVoiceMode && isSpeaking && (
        <div className="absolute top-11 right-[28px] text-[10px] text-accent-green/60 select-none">
          Speaking…
        </div>
      )}
      {/* Subtle error indicator when STT fails */}
      {isVoiceMode && error && !isSpeaking && (
        <div className="absolute top-11 right-[28px] text-[10px] text-accent-red/70 select-none">
          Didn't catch that…
        </div>
      )}

      {/* Main input area */}
      <div className="p-3">
        <div className="relative min-h-[72px]">
          <textarea
            ref={textareaRef}
            value={textareaValue}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            placeholder=""
            disabled={disabled}
            rows={3}
            className={cn(
              "w-full bg-transparent text-sm text-text-norm placeholder-text-dark resize-none outline-none leading-relaxed min-h-[72px] pr-[117px]",
              "caret-accent-primary"
            )}
            style={{ caretColor: 'var(--color-accent-primary)' }}
          />
          {/* Streaming partial transcription — appears below textarea while speaking */}
          {showingPartial && (
            <div className="flex items-start gap-1.5 pt-0.5 pb-0.5 absolute bottom-0 left-0 right-0">
              <span className="mt-[3px] flex-shrink-0 w-1.5 h-1.5 rounded-full bg-accent-primary/60 animate-pulse" />
              <p className="text-sm text-accent-primary/60 italic leading-relaxed select-none">
                {partialText}
              </p>
            </div>
          )}
          {/* "Transcribing…" indicator when Whisper is running */}
          {showTranscribingHint && (
            <div className="flex items-center gap-1.5 pt-0.5 pb-0.5 absolute bottom-0 left-0">
              <span className="flex-shrink-0 w-1.5 h-1.5 rounded-full bg-accent-gold/60 animate-pulse" />
              <p className="text-xs text-accent-gold/50 italic">Transcribing…</p>
            </div>
          )}
        </div>
      </div>
      </div>
      </div>
    </div>
  );
}
