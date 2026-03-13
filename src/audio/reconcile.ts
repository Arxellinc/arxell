import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { enumerateAudioInputs } from "./enumerate";
import { loadFingerprint, saveFingerprint } from "./store";
import type { AudioDevice, DeviceSelection } from "./types";

function debounce<T extends (...args: any[]) => void>(fn: T, ms: number): T {
  let timer: ReturnType<typeof setTimeout>;
  return ((...args: any[]) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  }) as T;
}

async function doReconcile(reason: string): Promise<void> {
  console.info(`[audio] reconcile triggered: ${reason}`);
  const fingerprint = loadFingerprint();
  const allDevices = await enumerateAudioInputs({
    probeAll: false,
    previousWebviewId: fingerprint?.webviewIdHint,
  });

  const selection: DeviceSelection = {
    fingerprintPreferred: fingerprint,
    fallbackToDefault: true,
    allDevices,
  };

  try {
    await invoke("set_audio_device", { selection });
  } catch (err) {
    console.error("[audio] reconcile failed:", err);
  }
}

const debouncedReconcile = debounce(doReconcile, 400);

export async function initHotPlugListeners(): Promise<void> {
  navigator.mediaDevices.addEventListener("devicechange", () => {
    debouncedReconcile("devicechange_event");
  });

  await listen("audio_device_lost", (event) => {
    debouncedReconcile(`rust_stream_lost: ${JSON.stringify(event.payload)}`);
  });

  await listen("audio_device_warning", (event: any) => {
    console.warn("[audio] backend warning:", event.payload);
  });
}

export async function selectDevice(device: AudioDevice): Promise<void> {
  const allDevices = await enumerateAudioInputs({ probeAll: true });

  const fingerprint = {
    normalizedLabel: device.normalizedLabel,
    groupId: device.groupId,
    webviewIdHint: device.webviewId,
    lastSeenLabel: device.label,
  };
  saveFingerprint(fingerprint);

  const selection: DeviceSelection = {
    fingerprintPreferred: fingerprint,
    fallbackToDefault: true,
    allDevices,
  };

  await invoke("set_audio_device", { selection });
}

export async function reconcileFromStoredFingerprint(): Promise<void> {
  await doReconcile("startup");
}
