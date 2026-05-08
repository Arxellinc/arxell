export async function copyImageFromSrc(src: string): Promise<void> {
  const trimmed = src.trim();
  if (!trimmed) {
    throw new Error("missing image source");
  }
  if (
    typeof window === "undefined" ||
    typeof navigator === "undefined" ||
    !navigator.clipboard
  ) {
    throw new Error("clipboard API unavailable");
  }
  const clipboardItemCtor =
    "ClipboardItem" in window
      ? (window as Window & typeof globalThis & { ClipboardItem: typeof ClipboardItem })
          .ClipboardItem
      : null;
  if (clipboardItemCtor && typeof navigator.clipboard.write === "function") {
    const response = await fetch(trimmed);
    if (!response.ok) {
      throw new Error(`image fetch failed: ${response.status}`);
    }
    const blob = await response.blob();
    await navigator.clipboard.write([
      new clipboardItemCtor({
        [blob.type || "image/png"]: blob
      })
    ]);
    return;
  }
  await navigator.clipboard.writeText(trimmed);
}
