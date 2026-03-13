import { useCallback, useRef, useState } from "react";
import { useChatStore } from "../../store/chatStore";
import { useVoiceStore } from "../../store/voiceStore";
import { useChatStream } from "../../hooks/useChat";
import { useVoiceEvents, useVoiceMode } from "../../hooks/useVoice";

export function PresentationInputBar() {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { sendMessage } = useChatStream();
  const isStreaming = useChatStore((s) => s.isStreaming);
  // Selector subscriptions avoid rerendering this bar on unrelated voice-store updates.
  const partialText = useVoiceStore((s) => s.partialText);
  const voiceState = useVoiceStore((s) => s.state);
  const voiceMode = useVoiceStore((s) => s.voiceMode);
  const isSpeaking = useVoiceStore((s) => s.isSpeaking);
  const error = useVoiceStore((s) => s.error);

  useVoiceMode(sendMessage);

  const handleTranscript = useCallback((text: string) => {
    setValue((prev) => (prev ? `${prev} ${text}` : text));
    textareaRef.current?.focus();
  }, []);

  useVoiceEvents(voiceMode ? undefined : handleTranscript);

  const handleSubmit = () => {
    const trimmed = value.trim();
    if (!trimmed || isStreaming) return;
    sendMessage(trimmed);
    setValue("");
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSubmit();
    }
  };

  const showingPartial = Boolean(partialText) && !value;

  return (
    <div className="border-t border-white/10 bg-black/80 px-4 py-3 backdrop-blur-sm">
      <div className="rounded-xl border border-white/15 bg-black/70 px-3 py-2">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type or speak..."
          rows={2}
          className="w-full resize-none bg-transparent text-sm leading-relaxed text-white placeholder:text-white/35 outline-none"
        />

        <div className="mt-1 min-h-[16px] text-xs text-white/50">
          {showingPartial ? (
            <p className="italic text-white/70">{partialText}</p>
          ) : null}
          {!showingPartial && voiceState === "processing" ? (
            <p className="italic text-amber-300/80">Transcribing...</p>
          ) : null}
          {!showingPartial && isSpeaking ? (
            <p className="italic text-emerald-300/80">Speaking...</p>
          ) : null}
          {!showingPartial && error ? (
            <p className="italic text-red-300/90">Didn't catch that...</p>
          ) : null}
          {!showingPartial && !isSpeaking && !error && value.trim().length === 0 ? (
            <p className="text-white/35">Enter to send, Shift+Enter for newline</p>
          ) : null}
        </div>
      </div>

      <div className="mt-2 text-[10px] text-white/35">
        {voiceMode ? "Voice mode on" : "Voice mode off"}
      </div>
    </div>
  );
}
