import type { AudioDevice, DeviceAvailability } from "./types";

const STRIP_PREFIXES = [
  /^default\s*[-–]\s*/i,
  /^communications\s*[-–]\s*/i,
  /^pipewire\s*[-–:\s]*/i,
  /^pulse\s*[-–:\s]*/i,
  /^alsa\s*[-–:\s]*/i,
  /^\(hw:\d+,\d+\)\s*/i,
];

export function normalizeLabel(raw: string): string {
  let s = raw.toLowerCase().trim();
  for (const prefix of STRIP_PREFIXES) {
    s = s.replace(prefix, "");
  }
  return s.trim();
}

export async function probeDevice(webviewId: string): Promise<DeviceAvailability> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { deviceId: { exact: webviewId } },
    });
    stream.getTracks().forEach((t) => t.stop());
    return "available";
  } catch (e: any) {
    if (e?.name === "NotReadableError") return "in_use";
    if (e?.name === "NotFoundError") return "not_found";
    if (e?.name === "NotAllowedError") return "permission_denied";
    return "in_use";
  }
}

export async function enumerateAudioInputs(opts: {
  probeAll: boolean;
  previousWebviewId?: string;
}): Promise<AudioDevice[]> {
  if (!navigator?.mediaDevices?.enumerateDevices) {
    throw new Error("mediaDevices API unavailable");
  }
  const raw = await navigator.mediaDevices.enumerateDevices();
  const inputs = raw.filter((d) => d.kind === "audioinput");

  const devices: AudioDevice[] = await Promise.all(
    inputs.map(async (d) => {
      const isDefault = d.deviceId === "default" || d.deviceId === "communications";
      const shouldProbe =
        opts.probeAll ||
        isDefault ||
        d.deviceId === opts.previousWebviewId;

      const availability: DeviceAvailability = shouldProbe
        ? await probeDevice(d.deviceId)
        : "available";

      return {
        webviewId: d.deviceId,
        label: d.label || `Microphone (${d.groupId.slice(0, 8)})`,
        normalizedLabel: normalizeLabel(d.label || ""),
        groupId: d.groupId,
        isDefault,
        availability,
      };
    })
  );

  return devices;
}
