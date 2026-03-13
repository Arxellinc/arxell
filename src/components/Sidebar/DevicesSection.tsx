import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Mic, RefreshCw } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { enumerateAudioInputs, normalizeLabel } from "../../audio/enumerate";
import { requestAudioPermission, type PermissionState } from "../../audio/permissions";
import { loadFingerprint, saveFingerprint } from "../../audio/store";
import { selectDevice } from "../../audio/reconcile";
import type { AudioDevice, DeviceSelection } from "../../audio/types";
import { listAudioDevices, settingsGetAll, settingsSet, type AudioDevices } from "../../lib/tauri";
import { useSystemAlertStore } from "../../store/systemAlertStore";
import { useVoiceStore } from "../../store/voiceStore";
import { cn } from "../../lib/utils";

type CameraOption = { id: string; label: string };

function formatDefaultLabel(kind: "input" | "output", name: string | null) {
  const base = kind === "input" ? "System default" : "System default";
  return name ? `${base} (${name})` : base;
}

function formatAvailability(device: AudioDevice): string {
  if (device.availability === "available") return device.isDefault ? "Default" : "Available";
  if (device.availability === "in_use") return "In use";
  if (device.availability === "not_found") return "Not found";
  return "Permission denied";
}

function formatMicLabel(device: AudioDevice): string {
  if (!device.isDefault) return device.label;
  if (device.label) return `System default (${device.label})`;
  return "System default";
}

function resolveSelectedMicId(devices: AudioDevice[], fingerprintLabel?: string | null) {
  if (devices.length === 0) return "";
  if (fingerprintLabel) {
    const byNorm = devices.find((d) => d.normalizedLabel === fingerprintLabel);
    if (byNorm) return byNorm.webviewId;
  }
  const defaultDevice = devices.find((d) => d.isDefault);
  return defaultDevice?.webviewId ?? devices[0].webviewId;
}

function findNativeLabelHint(
  webviewLabel: string,
  nativeInputs: string[] | null | undefined
): string {
  if (!nativeInputs?.length) return webviewLabel;
  const wanted = normalizeLabel(webviewLabel);
  if (!wanted) return webviewLabel;
  const exact = nativeInputs.find((n) => normalizeLabel(n) === wanted);
  if (exact) return exact;
  const fuzzy = nativeInputs.find((n) => normalizeLabel(n).includes(wanted));
  return fuzzy ?? webviewLabel;
}

function MicPermissionModal({
  open,
  state,
  onClose,
  onRetry,
}: {
  open: boolean;
  state: PermissionState;
  onClose: () => void;
  onRetry: () => void;
}) {
  if (!open) return null;
  const title =
    state === "denied"
      ? "Microphone permission denied"
      : state === "unavailable"
        ? "No microphone detected"
        : "Microphone permission required";
  const body =
    state === "denied"
      ? "Enable microphone access in system settings, then click retry."
      : state === "unavailable"
        ? "Connect a microphone and try again."
        : "Allow microphone access to list and select input devices.";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-[320px] rounded-lg border border-line-light bg-bg-norm p-4 shadow-xl">
        <div className="text-[12px] font-semibold text-text-norm">{title}</div>
        <div className="mt-2 text-[10px] text-text-med leading-relaxed">{body}</div>
        <div className="mt-3 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="px-2 py-1 text-[10px] rounded border border-line-light text-text-dark hover:text-text-med hover:bg-line-light transition-colors"
          >
            Dismiss
          </button>
          <button
            onClick={onRetry}
            className="px-2 py-1 text-[10px] rounded border border-line-med bg-line-light text-text-med hover:text-text-norm hover:bg-line-med transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    </div>
  );
}

export function DevicesSection() {
  const isLinux = /linux/i.test(navigator.userAgent);
  const [isExpanded, setIsExpanded] = useState(false);
  const [audioDevices, setAudioDevices] = useState<AudioDevices | null>(null);
  const [micDevices, setMicDevices] = useState<AudioDevice[]>([]);
  const [cameraDevices, setCameraDevices] = useState<CameraOption[]>([]);
  const [selectedInput, setSelectedInput] = useState("");
  const [selectedOutput, setSelectedOutput] = useState("");
  const [selectedCamera, setSelectedCamera] = useState("");
  const [permissionState, setPermissionState] = useState<PermissionState>("unknown");
  const [showPermissionModal, setShowPermissionModal] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const { state: voiceState, amplitude, ttsAmplitude } = useVoiceStore();
  const addAlert = useSystemAlertStore((s) => s.addAlert);
  const micActive = voiceState !== "idle";
  const micPercent = Math.min(100, amplitude * 800);
  const ttsPercent = Math.min(100, ttsAmplitude * 800);
  const ttsActive = ttsAmplitude > 0.01;

  useEffect(() => {
    void loadSettingsAndDevices();
  }, []);

  const loadSettingsAndDevices = async () => {
    setIsRefreshing(true);
    try {
      const settings = await settingsGetAll();
      setSelectedOutput(settings["audio_output_device"] ?? "");
      setSelectedCamera(settings["camera_device"] ?? "");
      const [audio, cameras] = await Promise.all([
        listAudioDevices().catch(() => null),
        listCameraDevices().catch(() => [] as CameraOption[]),
      ]);
      if (audio) setAudioDevices(audio);
      setCameraDevices(cameras);
    } finally {
      setIsRefreshing(false);
    }
  };

  const ensurePermissionAndRefresh = async (probeAll: boolean, allowPrompt: boolean) => {
    setIsRefreshing(true);
    try {
      let permission = permissionState;
      if (permission !== "granted" && allowPrompt) {
        permission = await requestAudioPermission();
        setPermissionState(permission);
      }
      if (permission !== "granted") {
        if (allowPrompt && !isLinux) setShowPermissionModal(true);
        addAlert(`Audio: microphone permission ${permission}.`);
        console.error(`[audio] microphone permission ${permission}`);
        return;
      }

      const fingerprint = loadFingerprint();
      const devices = await enumerateAudioInputs({
        probeAll,
        previousWebviewId: fingerprint?.webviewIdHint,
      });
      const ordered = devices
        .slice()
        .sort((a, b) => Number(b.isDefault) - Number(a.isDefault))
        .sort((a, b) => {
          if (a.isDefault !== b.isDefault) return Number(b.isDefault) - Number(a.isDefault);
          return a.label.localeCompare(b.label);
        });
      setMicDevices(ordered);
      const resolved = resolveSelectedMicId(ordered, fingerprint?.normalizedLabel ?? null);
      setSelectedInput(resolved);
    } catch (err) {
      console.error("[audio] device enumeration failed:", err);
      addAlert("Audio: failed to enumerate devices.");
    } finally {
      setIsRefreshing(false);
    }
  };

  const listCameraDevices = async (): Promise<CameraOption[]> => {
    if (!navigator?.mediaDevices?.enumerateDevices) return [];
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cams = devices.filter((d) => d.kind === "videoinput");
    return cams.map((d, idx) => ({
      id: d.deviceId,
      label: d.label?.trim() || `Camera ${idx + 1}`,
    }));
  };

  const outputOptions = useMemo(() => {
    const outputs = audioDevices?.outputs ?? [];
    return outputs;
  }, [audioDevices]);

  const cameraOptions = useMemo(() => {
    const ids = cameraDevices.map((c) => c.id);
    if (selectedCamera && !ids.includes(selectedCamera)) {
      return [{ id: selectedCamera, label: "Selected camera" }, ...cameraDevices];
    }
    return cameraDevices;
  }, [cameraDevices, selectedCamera]);

  const handleInputChange = async (value: string) => {
    setSelectedInput(value);
    if (!value) {
      const selection: DeviceSelection = {
        fingerprintPreferred: null,
        fallbackToDefault: true,
        allDevices: [],
      };
      try {
        await invoke("set_audio_device", { selection });
      } catch (err) {
        console.error("[audio] set_audio_device failed:", err);
        addAlert("Audio: failed to activate default microphone.");
      }
      return;
    }
    const device = micDevices.find((d) => d.webviewId === value);
    if (!device) return;
    try {
      if (isLinux) {
        const nativeHint = findNativeLabelHint(device.label, audioDevices?.inputs);
        const fingerprint = {
          normalizedLabel: device.normalizedLabel,
          groupId: device.groupId,
          webviewIdHint: device.webviewId,
          lastSeenLabel: nativeHint,
        };
        saveFingerprint(fingerprint);
        const selection: DeviceSelection = {
          fingerprintPreferred: fingerprint,
          fallbackToDefault: true,
          allDevices: micDevices,
        };
        await invoke("set_audio_device", { selection });
      } else {
        await selectDevice(device);
      }
    } catch (err) {
      console.error("[audio] set_audio_device failed:", err);
      addAlert("Audio: failed to activate selected microphone.");
    }
  };

  const handleOutputChange = async (value: string) => {
    setSelectedOutput(value);
    await settingsSet("audio_output_device", value);
  };

  const handleCameraChange = async (value: string) => {
    setSelectedCamera(value);
    await settingsSet("camera_device", value);
  };

  return (
    <div className="border-b border-line-light">
      <div
        className="flex items-center gap-1.5 px-3 py-2 hover:bg-line-light transition-colors cursor-pointer"
        onClick={() => {
          if (isExpanded) {
            setIsExpanded(false);
            return;
          }
          setIsExpanded(true);
          void ensurePermissionAndRefresh(true, true);
          void loadSettingsAndDevices();
        }}
      >
        {isExpanded ? (
          <ChevronDown size={11} className="text-text-dark flex-shrink-0" />
        ) : (
          <ChevronRight size={11} className="text-text-dark flex-shrink-0" />
        )}
        <span className="sidebar-header-title text-[10px] font-normal uppercase tracking-wider flex-1">
          Devices
        </span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            void ensurePermissionAndRefresh(true, !isLinux);
            void loadSettingsAndDevices();
          }}
          className="p-0.5 rounded transition-colors disabled:opacity-50"
          title="Refresh devices"
          disabled={isRefreshing}
        >
          <RefreshCw size={10} className={cn("text-text-dark", isRefreshing && "animate-spin")} />
        </button>
      </div>

      {isExpanded && (
        <div className="px-3 pb-3 space-y-3">
          <div className="space-y-1.5">
            <label className="text-[9px] text-text-dark">Microphone</label>
            {permissionState !== "granted" && (
              <button
                type="button"
                onClick={async () => {
                  const permission = await requestAudioPermission();
                  setPermissionState(permission);
                  if (permission !== "granted") {
                    addAlert(`Audio: microphone permission ${permission}.`);
                    console.error(`[audio] microphone permission ${permission}`);
                    return;
                  }
                  void ensurePermissionAndRefresh(true, false);
                }}
                className="w-full px-2 py-1 text-[10px] rounded border border-accent-gold/60 text-accent-gold/90 hover:text-accent-gold hover:border-accent-gold bg-transparent transition-colors flex items-center justify-center gap-1.5"
              >
                <Mic size={10} />
                Enable Microphone Access
              </button>
            )}
            <select
              value={selectedInput}
              onChange={(e) => void handleInputChange(e.target.value)}
              className="w-full bg-transparent border border-line-light rounded px-2 py-1 text-[10px] text-text-med outline-none focus:border-accent-primary/50"
            >
              <option value="">System default</option>
              {micDevices.length === 0 ? (
                <option value="">No microphones detected</option>
              ) : (
                micDevices.map((input) => (
                  <option key={input.webviewId} value={input.webviewId}>
                    {formatMicLabel(input)} · {formatAvailability(input)}
                  </option>
                ))
              )}
            </select>

            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[9px] text-text-dark">Mic level</span>
                <span className={cn("text-[9px]", micActive ? "text-accent-primary" : "text-text-dark")}>
                  {micActive ? voiceState : "off"}
                </span>
              </div>
              <div className="h-1.5 bg-line-light rounded-full overflow-hidden">
                <div
                  className={cn(
                    "h-full rounded-full transition-all duration-75",
                    micActive
                      ? micPercent > 60 ? "bg-accent-green" : "bg-accent-primary"
                      : "bg-line-med"
                  )}
                  style={{ width: `${micActive ? micPercent : 0}%` }}
                />
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-[9px] text-text-dark">Speaker</label>
            <select
              value={selectedOutput}
              onChange={(e) => void handleOutputChange(e.target.value)}
              className="w-full bg-transparent border border-line-light rounded px-2 py-1 text-[10px] text-text-med outline-none focus:border-accent-primary/50"
            >
              <option value="">
                {formatDefaultLabel("output", audioDevices?.default_output ?? null)}
              </option>
              {outputOptions.map((output) => (
                <option key={output} value={output}>{output}</option>
              ))}
            </select>

            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[9px] text-text-dark">Volume</span>
                <span className={cn("text-[9px]", ttsActive ? "text-accent-primary" : "text-text-dark")}>
                  {ttsActive ? "playing" : "idle"}
                </span>
              </div>
              <div className="h-1.5 bg-line-light rounded-full overflow-hidden">
                <div
                  className={cn(
                    "h-full rounded-full transition-all duration-75",
                    ttsActive
                      ? ttsPercent > 60 ? "bg-accent-green" : "bg-accent-primary"
                      : "bg-line-med"
                  )}
                  style={{ width: `${ttsActive ? ttsPercent : 0}%` }}
                />
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-[9px] text-text-dark">Camera</label>
            <select
              value={selectedCamera}
              onChange={(e) => void handleCameraChange(e.target.value)}
              className="w-full bg-transparent border border-line-light rounded px-2 py-1 text-[10px] text-text-med outline-none focus:border-accent-primary/50"
            >
              <option value="">System default</option>
              {cameraOptions.map((cam) => (
                <option key={cam.id} value={cam.id}>{cam.label}</option>
              ))}
            </select>
          </div>
        </div>
      )}

      <MicPermissionModal
        open={showPermissionModal}
        state={permissionState}
        onClose={() => setShowPermissionModal(false)}
        onRetry={() => void ensurePermissionAndRefresh(true, true)}
      />
    </div>
  );
}
