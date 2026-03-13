import { useEffect, useRef } from "react";
import { AvatarPanel } from "./Workspace/panels/AvatarPanel";
import { PresentationChatView } from "./Chat/PresentationChatView";
import { useUiModeStore } from "../store/uiModeStore";

export function AvatarPresentationMode() {
  const exitAvatarPresentation = useUiModeStore((s) => s.exitAvatarPresentation);
  const fullscreenOwnerRef = useRef<"tauri" | "dom" | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        exitAvatarPresentation();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [exitAvatarPresentation]);

  useEffect(() => {
    let disposed = false;

    const enterFullscreen = async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        if (disposed) return;
        const appWindow = getCurrentWindow();
        const isFullscreen = await appWindow.isFullscreen();
        if (!isFullscreen) {
          await appWindow.setFullscreen(true);
          fullscreenOwnerRef.current = "tauri";
        }
        return;
      } catch {
        // Fall through to browser fullscreen API.
      }

      try {
        if (!document.fullscreenElement) {
          await document.documentElement.requestFullscreen();
          fullscreenOwnerRef.current = "dom";
        }
      } catch {
        // Best-effort only; presentation mode still works in-window.
      }
    };

    void enterFullscreen();

    return () => {
      disposed = true;
      const owner = fullscreenOwnerRef.current;
      fullscreenOwnerRef.current = null;

      void (async () => {
        if (owner === "tauri") {
          try {
            const { getCurrentWindow } = await import("@tauri-apps/api/window");
            await getCurrentWindow().setFullscreen(false);
          } catch {
            // Ignore cleanup failures.
          }
          return;
        }
        if (owner === "dom" && document.fullscreenElement) {
          try {
            await document.exitFullscreen();
          } catch {
            // Ignore cleanup failures.
          }
        }
      })();
    };
  }, []);

  return (
    <div className="fixed inset-0 z-[1200] flex h-screen w-screen overflow-hidden bg-black">
      <div className="h-full w-[44%] min-w-[360px]">
        <PresentationChatView />
      </div>
      <div className="h-full flex-1 min-w-0">
        <AvatarPanel presentationMode />
      </div>
    </div>
  );
}
