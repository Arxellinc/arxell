import type { HandoffState, VoiceRuntimeState } from "../contracts.js";

export function isVoiceRuntimeIdle(state: VoiceRuntimeState): boolean {
  return state === "idle";
}

export function isVoiceRuntimeRunning(state: VoiceRuntimeState): boolean {
  return state === "running" || state === "running_single" || state === "running_dual";
}

export function canRequestVadHandoff(args: {
  runtimeState: VoiceRuntimeState;
  handoffState: HandoffState;
  targetCount: number;
}): boolean {
  return (
    isVoiceRuntimeRunning(args.runtimeState) &&
    args.handoffState !== "requested" &&
    args.handoffState !== "preparing" &&
    args.handoffState !== "ready_to_cutover" &&
    args.handoffState !== "cutover_in_progress" &&
    args.targetCount > 0
  );
}

export function canStartShadowEval(args: {
  runtimeState: VoiceRuntimeState;
  shadowMethodId: string | null;
}): boolean {
  return isVoiceRuntimeRunning(args.runtimeState) && Boolean(args.shadowMethodId);
}

export function canStopShadowEval(runtimeState: VoiceRuntimeState): boolean {
  return runtimeState === "running_dual";
}
