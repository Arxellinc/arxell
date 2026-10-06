import type { FirstRunOnboardingStep } from "./firstRunOnboarding";

export function isValidFirstRunCustomGgufPath(path: string): boolean {
  return path.trim().toLowerCase().endsWith(".gguf");
}

export function isFirstRunPrimaryActionDisabled(input: {
  step: FirstRunOnboardingStep;
  busy: boolean;
  termsAccepted: boolean;
  customModelSelected: boolean;
  customModelPath: string;
}): boolean {
  return input.busy ||
    (input.step === "welcome" && !input.termsAccepted) ||
    (input.step === "model" && input.customModelSelected && !isValidFirstRunCustomGgufPath(input.customModelPath));
}
