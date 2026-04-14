import type { ApiConnectionDraft, DevicesState } from "../panels/types";

export function defaultDevicesState(): DevicesState {
  return {
    microphonePermission: "not_enabled",
    speakerPermission: "not_enabled",
    defaultAudioInput: "Unknown",
    defaultAudioOutput: "Unknown",
    audioInputCount: 0,
    audioOutputCount: 0,
    webcamCount: 0,
    keyboardDetected: true,
    mouseDetected: false,
    lastUpdatedLabel: "Not checked"
  };
}

export function defaultApiConnectionDraft(): ApiConnectionDraft {
  return {
    apiType: "llm",
    apiUrl: "",
    name: "",
    apiKey: "",
    modelName: "",
    costPerMonthUsd: "",
    apiStandardPath: ""
  };
}
