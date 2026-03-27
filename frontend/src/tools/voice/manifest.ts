import type { ToolManifest } from "../types";

export const voiceToolManifest: ToolManifest = {
  id: "voice",
  version: "1.0.0",
  title: "Voice",
  description: "STT/TTS toolchain and microphone helpers",
  category: "media",
  core: false,
  defaultEnabled: true,
  source: "builtin",
  icon: "mic"
};
