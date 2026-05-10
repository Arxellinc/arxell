export function isUserFacingWhisperModel(model: string): boolean {
  const normalized = model.trim();
  return normalized === "auto" || /^ggml-.+\.bin$/i.test(normalized);
}

export function normalizeUserFacingWhisperModels(models: string[]): string[] {
  const normalized = Array.from(
    new Set(models.map((model) => model.trim()).filter(isUserFacingWhisperModel))
  );
  return normalized.length > 0 ? normalized : ["auto"];
}
