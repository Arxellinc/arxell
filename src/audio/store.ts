import type { DeviceFingerprint } from "./types";

const STORAGE_KEY = "audio_device_fingerprint";

export function saveFingerprint(fp: DeviceFingerprint): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(fp));
  } catch {
    // ignore storage failures
  }
}

export function loadFingerprint(): DeviceFingerprint | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearFingerprint(): void {
  localStorage.removeItem(STORAGE_KEY);
}
