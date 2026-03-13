import { Mic, Volume2 } from "lucide-react";
import { useVoiceStore } from "../../store/voiceStore";
import { cn } from "../../lib/utils";
import { chatCancel, voiceStop } from "../../lib/tauri";

export function VoiceModeButton() {
  // Selector subscriptions keep this button decoupled from unrelated voice-store churn.
  const voiceMode = useVoiceStore((s) => s.voiceMode);
  const state = useVoiceStore((s) => s.state);
  const isSpeaking = useVoiceStore((s) => s.isSpeaking);
  const setVoiceMode = useVoiceStore((s) => s.setVoiceMode);

  const isListening = state === "listening" || state === "speaking";

  return (
    <button
      onClick={() => {
        if (voiceMode) {
          // Immediate hard stop when voice mode is turned off.
          const vs = useVoiceStore.getState();
          vs.stopCurrentAudio?.();
          vs.setStopCurrentAudio(null);
          vs.setIsSpeaking(false);
          vs.setPartialText(null);
          vs.setState("idle");
          vs.setPipelineState("idle");
          chatCancel().catch(console.error);
          void voiceStop().catch(console.error);
          setVoiceMode(false);
        } else {
          setVoiceMode(true);
        }
      }}
      title={voiceMode ? "Exit voice conversation mode" : "Enter voice conversation mode"}
      className={cn(
        "flex-shrink-0 w-12 h-12 rounded-full flex items-center justify-center transition-all duration-200 border",
        voiceMode
          ? isSpeaking
            ? "bg-accent-green/20 border-accent-green/40 text-accent-green shadow-lg shadow-accent-green/10"
            : isListening
            ? "bg-accent-primary/25 border-accent-primary/40 text-accent-primary shadow-lg shadow-accent-primary/10 animate-pulse"
            : "bg-accent-primary/15 border-accent-primary/30 text-accent-primary hover:bg-accent-primary/25"
          : "bg-line-light border-line-med text-text-dark hover:text-text-med hover:bg-line-med hover:border-line-dark"
      )}
    >
      {isSpeaking ? <Volume2 size={20} /> : <Mic size={20} />}
    </button>
  );
}
