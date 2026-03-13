import type { MouseEvent } from "react";

export function suppressContextMenuUnlessAllowed(event: MouseEvent<HTMLElement>) {
  const target = event.target as HTMLElement | null;
  if (target?.closest("[data-allow-native-contextmenu='true']")) return;
  event.preventDefault();
}
