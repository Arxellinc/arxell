declare const __APP_VERSION__: string;

export const APP_BUILD_VERSION = __APP_VERSION__;

export function normalizeVersionLabel(version: string): string {
  const trimmed = version.trim();
  if (!trimmed) return "v0.0.0";
  return trimmed.startsWith("v") ? trimmed : `v${trimmed}`;
}
