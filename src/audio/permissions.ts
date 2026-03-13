export type PermissionState =
  | "unknown"
  | "granted"
  | "denied"
  | "unavailable";

export async function requestAudioPermission(): Promise<PermissionState> {
  try {
    if (!navigator?.mediaDevices?.getUserMedia) {
      console.error("[audio] getUserMedia not available");
      return "unavailable";
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    console.info("[audio] microphone permission granted");
    return "granted";
  } catch (e: any) {
    const name = e?.name ?? "unknown";
    const message = e?.message ?? "unknown";
    console.error("[audio] getUserMedia failed:", { name, message, ua: navigator.userAgent });
    if (e?.name === "NotAllowedError" || e?.name === "PermissionDeniedError") {
      return "denied";
    }
    if (e?.name === "NotFoundError") {
      return "unavailable";
    }
    return "unknown";
  }
}
