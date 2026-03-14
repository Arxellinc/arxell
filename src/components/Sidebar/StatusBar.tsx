import { useEffect, useState } from "react";
import { Mic, Volume2, Bot, Image as ImageIcon, Film, Eye, Cpu, Zap } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import {
  checkSttEngines,
  checkTtsEngines,
  checkVoiceEndpoints,
  settingsGetAll,
} from "../../lib/tauri";
import type { ServeState } from "../../types/model";
import type { TtsEngineStatus, SttEngineStatus, VoiceEndpointStatus } from "../../lib/tauri";
import { useServeStore } from "../../store/serveStore";
import { useVoiceStore } from "../../store/voiceStore";
import { cn } from "../../lib/utils";
import { whisperModelName } from "./VoiceStatus";

function StatusDot({ ok, loading }: { ok: boolean | undefined; loading?: boolean }) {
  if (loading) {
    return <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-accent-gold/70 animate-pulse" />;
  }
  return (
    <div
      className={cn(
        "w-1.5 h-1.5 rounded-full flex-shrink-0",
        ok === undefined ? "bg-line-dark" : ok ? "bg-accent-green" : "bg-accent-red/70"
      )}
    />
  );
}

async function checkImgEndpoint(url: string): Promise<boolean> {
  try {
    const base = url.trim().replace(/\/+$/, "");
    const resp = await fetch(base, { method: "GET", signal: AbortSignal.timeout(4000) });
    return resp.ok || resp.status < 500;
  } catch {
    return false;
  }
}

export function StatusBar() {
  const [ttsEngines, setTtsEngines] = useState<TtsEngineStatus | null>(null);
  const [sttEngines, setSttEngines] = useState<SttEngineStatus | null>(null);
  const [voiceStatus, setVoiceStatus] = useState<VoiceEndpointStatus | null>(null);
  const [sttEngine, setSttEngineVal] = useState("whisper");
  const [ttsEngine, setTtsEngineVal] = useState("kokoro");
  const [selectedModel, setSelectedModel] = useState("");
  const [llmSource, setLlmSource] = useState("local");
  const [runtimeModelName, setRuntimeModelName] = useState("");
  const [runtimeLoaded, setRuntimeLoaded] = useState(false);
  const [imgUrl, setImgUrl] = useState("");
  const [imgOk, setImgOk] = useState<boolean | undefined>(undefined);
  const [vidUrl, setVidUrl] = useState("");
  const [vidOk, setVidOk] = useState<boolean | undefined>(undefined);
  const [visionUrl, setVisionUrl] = useState("");
  const [visionOk, setVisionOk] = useState<boolean | undefined>(undefined);

  const isLoaded = useServeStore((s) => s.isLoaded);
  const modelInfo = useServeStore((s) => s.modelInfo);
  const systemResources = useServeStore((s) => s.systemResources);

  // Live model selection + loading flags pushed by VoiceStatus on every switch.
  const storeSttModel  = useVoiceStore((s) => s.sttModel);
  const storeTtsEngine = useVoiceStore((s) => s.ttsEngine);
  const sttLoading     = useVoiceStore((s) => s.sttLoading);
  const ttsLoading     = useVoiceStore((s) => s.ttsLoading);

  useEffect(() => {
    const init = async () => {
      try {
        const [allR, ttsR, sttR, voiceR] = await Promise.allSettled([
          settingsGetAll(),
          checkTtsEngines(),
          checkSttEngines(),
          checkVoiceEndpoints(),
        ]);
        if (allR.status === "fulfilled") {
          setSttEngineVal(allR.value["stt_engine"] ?? "whisper");
          setTtsEngineVal(allR.value["tts_engine"] ?? "kokoro");
          setSelectedModel(allR.value["model"] ?? "");
          setLlmSource((allR.value["primary_llm_source"] ?? "local").trim().toLowerCase());
          const url = allR.value["img_url"] ?? "";
          setImgUrl(url);
          if (url) checkImgEndpoint(url).then(setImgOk);
          const vurl = allR.value["vid_url"] ?? "";
          setVidUrl(vurl);
          if (vurl) checkImgEndpoint(vurl).then(setVidOk);
          const visurl = allR.value["vision_url"] ?? "";
          setVisionUrl(visurl);
          if (visurl) checkImgEndpoint(visurl).then(setVisionOk);
        }
        if (ttsR.status === "fulfilled") setTtsEngines(ttsR.value);
        if (sttR.status === "fulfilled") setSttEngines(sttR.value);
        if (voiceR.status === "fulfilled") setVoiceStatus(voiceR.value);
        const serveState = await invoke<ServeState>("cmd_get_serve_state");
        setRuntimeLoaded(Boolean(serveState.isLoaded));
        setRuntimeModelName((serveState.modelInfo?.name ?? "").trim());
      } catch {}
    };
    init();
  }, []);

  // Re-check LLM selection when model loads/unloads
  useEffect(() => {
    settingsGetAll()
      .then((all) => {
        setSelectedModel(all["model"] ?? "");
        setLlmSource((all["primary_llm_source"] ?? "local").trim().toLowerCase());
        return invoke<ServeState>("cmd_get_serve_state");
      })
      .then((serveState) => {
        setRuntimeLoaded(Boolean(serveState.isLoaded));
        setRuntimeModelName((serveState.modelInfo?.name ?? "").trim());
      })
      .catch(() => {});
  }, [isLoaded]);

  // Keep LLM source/model indicators fresh even when no load/unload event fires.
  useEffect(() => {
    const timer = window.setInterval(() => {
      settingsGetAll()
        .then((all) => {
          setSelectedModel(all["model"] ?? "");
          setLlmSource((all["primary_llm_source"] ?? "local").trim().toLowerCase());
          return invoke<ServeState>("cmd_get_serve_state");
        })
        .then((serveState) => {
          setRuntimeLoaded(Boolean(serveState.isLoaded));
          setRuntimeModelName((serveState.modelInfo?.name ?? "").trim());
        })
        .catch(() => {});
    }, 1500);
    return () => window.clearInterval(timer);
  }, []);

  // ── Derived status ──────────────────────────────────────────────────────────

  const usingApiPrimary = llmSource === "api";

  // LLM: green only when the active source is actually connected.
  // - api source: selected API model exists
  // - local source: runtime model is loaded
  // Otherwise show neutral/grey.
  const llmOk: boolean | undefined = usingApiPrimary
    ? (selectedModel ? true : undefined)
    : (runtimeLoaded || isLoaded)
    ? true
    : undefined;

  const llmLabel = usingApiPrimary
    ? selectedModel
      ? `${selectedModel} (API)`
      : "none"
    : (runtimeLoaded || isLoaded)
    ? (runtimeModelName || modelInfo?.name || "local")
    : "none";

  // Prefer store values (updated live on switch); fall back to local state.
  // storeSttModel is now either a full model path or "external".
  const activeSttModel  = storeSttModel  || (sttEngine === "external" ? "external" : "");
  const activeTtsEngine = storeTtsEngine || ttsEngine;

  const isExternal = activeSttModel === "external";

  const sttOk: boolean | undefined = sttLoading
    ? undefined
    : isExternal
    ? voiceStatus?.stt
    : sttEngines?.whisper_rs;

  const sttLabel = sttLoading
    ? "loading…"
    : sttEngines === null
    ? "—"
    : isExternal
    ? (voiceStatus?.stt ? "online" : "offline")
    : sttEngines?.whisper_rs
    ? `Whisper.cpp — ${activeSttModel ? whisperModelName(activeSttModel) : "…"}`
    : "model not found";

  const ttsOk: boolean | undefined = ttsLoading
    ? undefined
    : activeTtsEngine === "kokoro"
    ? (ttsEngines?.kokoro || ttsEngines?.espeak)
    : activeTtsEngine === "external"
    ? ttsEngines?.external
    : false;

  const ttsLabel = ttsLoading
    ? "loading…"
    : ttsEngines === null
    ? "—"
    : activeTtsEngine === "kokoro"
    ? ttsEngines.kokoro
      ? "kokoro ✓"
      : ttsEngines.espeak
      ? "fallback: espeak"
      : "not found"
    : ttsEngines.external
    ? "online"
    : "offline";

  const primaryGpu = systemResources?.gpus.find((g) => g.isAvailable) ?? systemResources?.gpus[0];
  const gpuOk: boolean | undefined = systemResources ? (primaryGpu?.isAvailable ?? false) : undefined;
  const gpuLabel = systemResources ? (primaryGpu?.name ?? "none") : "—";

  const primaryNpu = systemResources?.npus.find((n) => n.isAvailable) ?? systemResources?.npus[0];
  const npuOk: boolean | undefined = systemResources ? (primaryNpu?.isAvailable ?? false) : undefined;
  const npuLabel = systemResources ? (primaryNpu?.name ?? "none") : "—";

  return (
    <div className="px-3 py-2 space-y-1.5 border-b border-line-light">
      {/* GPU row */}
      <div className="flex items-center gap-2">
        <StatusDot ok={gpuOk} />
        <Cpu size={10} className="text-text-dark flex-shrink-0" />
        <span className="text-[10px] text-text-med flex-1">GPU</span>
        <span className={cn("text-[9px] truncate max-w-[90px]", gpuOk ? "text-accent-green" : gpuOk === undefined ? "text-text-dark" : "text-text-dark")} title={gpuLabel}>
          {gpuLabel}
        </span>
      </div>

      {/* NPU row */}
      <div className="flex items-center gap-2">
        <StatusDot ok={npuOk} />
        <Zap size={10} className="text-text-dark flex-shrink-0" />
        <span className="text-[10px] text-text-med flex-1">NPU</span>
        <span className={cn("text-[9px] truncate max-w-[90px]", npuOk ? "text-accent-green" : npuOk === undefined ? "text-text-dark" : "text-text-dark")} title={npuLabel}>
          {npuLabel}
        </span>
      </div>

      {/* LLM row */}
      <div className="flex items-center gap-2">
        <StatusDot ok={llmOk} />
        <Bot size={10} className="text-text-dark flex-shrink-0" />
        <span className="text-[10px] text-text-med flex-1">LLM</span>
        <span
          className={cn(
            "text-[9px] truncate max-w-[90px]",
            llmOk === true
              ? "text-accent-green"
              : llmOk === undefined
              ? "text-text-dark"
              : "text-accent-red/70"
          )}
          title={llmLabel}
        >
          {llmLabel}
        </span>
      </div>

      {/* STT row */}
      <div className="flex items-center gap-2">
        <StatusDot ok={sttOk} loading={sttLoading} />
        <Mic size={10} className="text-text-dark flex-shrink-0" />
        <span className="text-[10px] text-text-med flex-1">STT</span>
        <span className={cn(
          "text-[9px]",
          sttLoading ? "text-accent-gold/80" : sttOk ? "text-accent-green" : "text-accent-red/70"
        )}>
          {sttLabel}
        </span>
      </div>

      {/* TTS row */}
      <div className="flex items-center gap-2">
        <StatusDot ok={ttsOk} loading={ttsLoading} />
        <Volume2 size={10} className="text-text-dark flex-shrink-0" />
        <span className="text-[10px] text-text-med flex-1">TTS</span>
        <span className={cn(
          "text-[9px]",
          ttsLoading ? "text-accent-gold/80" : ttsOk ? "text-accent-green" : "text-accent-red/70"
        )}>
          {ttsLabel}
        </span>
      </div>

      {/* IMG row */}
      <div className="flex items-center gap-2">
        <StatusDot ok={imgUrl ? imgOk : undefined} />
        <ImageIcon size={10} className="text-text-dark flex-shrink-0" />
        <span className="text-[10px] text-text-med flex-1">IMG</span>
        <span className={cn("text-[9px]", !imgUrl ? "text-text-dark" : imgOk ? "text-accent-green" : "text-accent-red/70")}>
          {!imgUrl ? "none" : imgOk === undefined ? "—" : imgOk ? "online" : "offline"}
        </span>
      </div>

      {/* VID row */}
      <div className="flex items-center gap-2">
        <StatusDot ok={vidUrl ? vidOk : undefined} />
        <Film size={10} className="text-text-dark flex-shrink-0" />
        <span className="text-[10px] text-text-med flex-1">VID</span>
        <span className={cn("text-[9px]", !vidUrl ? "text-text-dark" : vidOk ? "text-accent-green" : "text-accent-red/70")}>
          {!vidUrl ? "none" : vidOk === undefined ? "—" : vidOk ? "online" : "offline"}
        </span>
      </div>

      {/* Vision row */}
      <div className="flex items-center gap-2">
        <StatusDot ok={visionUrl ? visionOk : undefined} />
        <Eye size={10} className="text-text-dark flex-shrink-0" />
        <span className="text-[10px] text-text-med flex-1">Vision</span>
        <span className={cn("text-[9px]", !visionUrl ? "text-text-dark" : visionOk ? "text-accent-green" : "text-accent-red/70")}>
          {!visionUrl ? "none" : visionOk === undefined ? "—" : visionOk ? "online" : "offline"}
        </span>
      </div>
    </div>
  );
}
