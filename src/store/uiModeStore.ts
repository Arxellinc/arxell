import { create } from "zustand";

export type UiMode = "default" | "avatar_presentation";

interface UiModeState {
  mode: UiMode;
  enterAvatarPresentation: () => void;
  exitAvatarPresentation: () => void;
  toggleAvatarPresentation: () => void;
}

export const useUiModeStore = create<UiModeState>((set, get) => ({
  mode: "default",
  enterAvatarPresentation: () => set({ mode: "avatar_presentation" }),
  exitAvatarPresentation: () => set({ mode: "default" }),
  toggleAvatarPresentation: () =>
    set({ mode: get().mode === "avatar_presentation" ? "default" : "avatar_presentation" }),
}));
