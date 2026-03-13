export type DeviceAvailability =
  | "available"
  | "in_use"
  | "not_found"
  | "permission_denied";

export interface AudioDevice {
  webviewId: string;
  label: string;
  normalizedLabel: string;
  groupId: string;
  isDefault: boolean;
  availability: DeviceAvailability;
}

export interface DeviceFingerprint {
  normalizedLabel: string;
  groupId: string;
  webviewIdHint: string;
  lastSeenLabel: string;
}

export interface DeviceSelection {
  fingerprintPreferred: DeviceFingerprint | null;
  fallbackToDefault: boolean;
  allDevices: AudioDevice[];
}

export interface StreamStatus {
  state: "idle" | "opening" | "active" | "error" | "lost";
  resolvedNativeDevice: string | null;
  matchStrategy: MatchStrategy | null;
  errorMessage: string | null;
}

export type MatchStrategy =
  | "exact_label"
  | "normalized_label"
  | "substring"
  | "fuzzy"
  | "default_fallback"
  | "none";
