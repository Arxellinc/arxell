import { useRef, useState, useEffect } from "react";
import { SignedIn, SignedOut, SignInButton, SignUpButton, UserButton } from "@clerk/react-router";
import { Settings, CircleHelp, Cloud } from "lucide-react";
import { Sidebar } from "./components/Sidebar";
import { ChatPanel } from "./components/Chat";
import { WorkspacePanel } from "./components/Workspace";
import { CommercialLicenseModal } from "./components/CommercialLicenseModal";
import { WelcomeModal } from "./components/WelcomeModal";
import { SettingsDialog } from "./components/SettingsDialog";
import { AvatarPresentationMode } from "./components/AvatarPresentationMode";
import { useChatStore } from "./store/chatStore";
import { useServeStore } from "./store/serveStore";
import { useToolPanelStore } from "./store/toolPanelStore";
import { useVoiceStore } from "./store/voiceStore";
import { useUiModeStore } from "./store/uiModeStore";
import { chatGetMessages, memoryList, memoryUpsert, settingsGet, settingsSet } from "./lib/tauri";
import { useThemeStore } from "./store/themeStore";
import { useSystemAlertStore } from "./store/systemAlertStore";
import { listen } from "@tauri-apps/api/event";
import { getVersion } from "@tauri-apps/api/app";
import { prewarmPiBootstrap } from "./lib/piBootstrap";
import { initHotPlugListeners } from "./audio/reconcile";

const SIDEBAR_MIN = 160;
const SIDEBAR_MAX = 420;
const SIDEBAR_DEFAULT = 278;
// Allow chat panel to expand much wider when dragging the center/right divider.
const WORKSPACE_MIN = 180;
const WORKSPACE_MAX = 1600;
const DIVIDER_WIDTH = 3;
const DIVIDER_COUNT = 2;
const WELCOME_DISMISS_KEY = "ui_welcome_modal_dismissed";
const CLERK_ENABLED = Boolean(
  (import.meta.env.VITE_CLERK_PUBLISHABLE_KEY ?? "").trim()
);

function ResizeDivider({
  onDelta,
  lineMode = "full",
}: {
  onDelta: (d: number) => void;
  lineMode?: "full" | "top" | "none";
}) {
  const lastX = useRef(0);
  const active = useRef(false);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    active.current = true;
    lastX.current = e.clientX;
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!active.current) return;
    onDelta(e.clientX - lastX.current);
    lastX.current = e.clientX;
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    active.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  return (
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      className="resize-divider relative w-[3px] flex-shrink-0 cursor-col-resize group z-10"
    >
      {/* visual line */}
      {lineMode === "full" && (
        <div className="resize-divider-line absolute inset-0 bg-line-light group-hover:bg-accent-primary/50 group-active:bg-accent-primary/80 transition-colors" />
      )}
      {lineMode === "top" && (
        <div className="resize-divider-line absolute left-0 right-0 top-0 h-12 bg-line-dark group-hover:bg-accent-primary/70 group-active:bg-accent-primary transition-colors" />
      )}
      {/* wider hit area */}
      <div className="absolute inset-y-0 -left-1.5 -right-1.5" />
    </div>
  );
}

function useChatErrorListener() {
  useEffect(() => {
    const unlisten = listen<{ message: string }>("chat:error", (e) => {
      console.error("Chat error:", e.payload.message);
      // Clear isStreaming so the next sendMessage isn't permanently blocked.
      // Without this, any backend API failure leaves isStreaming=true forever.
      useChatStore.getState().finishStreaming();
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);
}

function getDefaultWorkspaceWidth(sidebarWidth: number): number {
  if (typeof window === "undefined") return 800;
  const available = window.innerWidth - sidebarWidth - DIVIDER_WIDTH * DIVIDER_COUNT;
  // Bias default layout slightly toward chat width.
  const preferred = available * 0.48;
  return Math.max(WORKSPACE_MIN, Math.min(WORKSPACE_MAX, preferred));
}

function extractNameFromUserText(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const patterns = [
    /\bmy name is\s+([A-Za-z][A-Za-z'-]{1,30})\b/i,
    /\bi am\s+([A-Za-z][A-Za-z'-]{1,30})\b/i,
    /\bi'm\s+([A-Za-z][A-Za-z'-]{1,30})\b/i,
    /\bcall me\s+([A-Za-z][A-Za-z'-]{1,30})\b/i,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(trimmed);
    const candidate = match?.[1]?.trim();
    if (candidate) return candidate;
  }
  return null;
}

export default function App() {
  const uiMode = useUiModeStore((s) => s.mode);
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT);
  const [workspaceWidth, setWorkspaceWidth] = useState(() => getDefaultWorkspaceWidth(SIDEBAR_DEFAULT));
  const [showCommercialLicenseModal, setShowCommercialLicenseModal] = useState(false);
  const [showGlobalSettings, setShowGlobalSettings] = useState(false);
  const [showWelcomeModal, setShowWelcomeModal] = useState(false);
  const [welcomeModalResolved, setWelcomeModalResolved] = useState(false);
  const [welcomeDoNotShow, setWelcomeDoNotShow] = useState(false);
  const [welcomeFlowCompleted, setWelcomeFlowCompleted] = useState(false);
  const [appVersion, setAppVersion] = useState(__APP_VERSION__);
  const { setPanel, toolbarPosition } = useToolPanelStore();
  const addAlert = useSystemAlertStore((s) => s.addAlert);

  // Initialize serve store on mount
  const { initialize, isLoaded } = useServeStore();
  const { loadTheme } = useThemeStore();
  const { addMessage, activeConversationId } = useChatStore();
  const hasGreetedRef = useRef(false);

  // Temporarily disabled to isolate startup nested-update crash.
  useChatErrorListener();

  // Initialize serve store and load persisted theme once on mount
  useEffect(() => {
    void (async () => {
      await initialize();
      const hasAvailableModel = useServeStore.getState().availableModels.length > 0;
      setPanel(hasAvailableModel ? "avatar" : "serve");
    })();
    void loadTheme();
    void prewarmPiBootstrap(".");
  }, []);

  useEffect(() => {
    initHotPlugListeners().catch((err) => {
      console.error("[audio] failed to init hot-plug listeners:", err);
      addAlert("Audio: failed to initialize device listeners.");
    });

    const unlistenWarning = listen("audio_device_warning", (e: any) => {
      const msg = typeof e.payload === "string" ? e.payload : "Audio device warning";
      addAlert(`Audio: ${msg}`);
      console.warn("[audio] warning:", e.payload);
    });
    const unlistenLost = listen("audio_device_lost", (e: any) => {
      const msg = typeof e.payload === "string" ? e.payload : "Audio device lost";
      addAlert(`Audio: ${msg}`);
      console.error("[audio] device lost:", e.payload);
    });
    const unlistenError = listen("audio_device_error", (e: any) => {
      const msg = typeof e.payload === "string" ? e.payload : "Audio device error";
      addAlert(`Audio: ${msg}`);
      console.error("[audio] device error:", e.payload);
    });

    return () => {
      void unlistenWarning.then((fn) => fn());
      void unlistenLost.then((fn) => fn());
      void unlistenError.then((fn) => fn());
    };
  }, [addAlert]);

  // Proactive greeting when LLM is first detected
  useEffect(() => {
    if (
      isLoaded &&
      welcomeFlowCompleted &&
      !hasGreetedRef.current &&
      activeConversationId
    ) {
      hasGreetedRef.current = true;
      
      // Check if we know the user's name and speak a personalized greeting
      void (async () => {
        let greetingText: string;
        try {
          const userMemory = await memoryList("user");
          const memoryName = userMemory.find((entry) => entry.key === "name")?.value?.trim();
          const legacyName = (await settingsGet("user_name"))?.trim();
          let userName = memoryName || legacyName || "";

          if (!userName && activeConversationId) {
            const history = await chatGetMessages(activeConversationId);
            for (let i = history.length - 1; i >= 0; i -= 1) {
              const msg = history[i];
              if (msg.role !== "user") continue;
              const inferred = extractNameFromUserText(msg.content);
              if (inferred) {
                userName = inferred;
                break;
              }
            }
            if (userName) {
              await memoryUpsert("user", "name", userName);
            }
          }

          greetingText = userName
            ? `Hi ${userName}, It's good to see you again. What can i do for you?`
            : "Hello! I don't think we've met. What's your name?";
        } catch {
          greetingText = "Hello! I don't think we've met. What's your name?";
        }
        
        // Add greeting message to chat
        const greetingMessage = {
          id: `greeting-${Date.now()}`,
          conversation_id: activeConversationId,
          role: "assistant" as const,
          content: greetingText,
          created_at: Date.now(),
        };
        addMessage(greetingMessage);
        
        // Speak the greeting with avatar lip-sync, then enable voice mode so
        // the user can immediately respond by voice.
        const vs = useVoiceStore.getState();
        const wasVoiceMode = vs.voiceMode;
        try {
          vs.setIsSpeaking(true);
          vs.setPipelineState("agent_speaking");
          const { speakText } = await import("./lib/voice");
          await speakText(greetingText);
        } catch {
          // TTS not available, continue silently
        } finally {
          const after = useVoiceStore.getState();
          after.setIsSpeaking(false);
          after.setStopCurrentAudio(null);
          if (after.pipelineState === "agent_speaking") {
            after.setPipelineState("idle");
          }
          if (!wasVoiceMode && !after.voiceMode) {
            after.setVoiceMode(true);
          }
        }
      })();
    }
  }, [isLoaded, welcomeFlowCompleted, activeConversationId, addMessage]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        // Keep welcome/terms gating machine-local so fresh installs always
        // show onboarding even if synced DB settings exist.
        const local = window.localStorage.getItem(WELCOME_DISMISS_KEY);
        const dismissed = local === "true";
        if (cancelled) return;
        setWelcomeDoNotShow(dismissed);
        setShowWelcomeModal(!dismissed);
        setWelcomeFlowCompleted(dismissed);
      } catch (error) {
        console.error("Failed to load welcome modal setting:", error);
        if (!cancelled) {
          setShowWelcomeModal(true);
          setWelcomeFlowCompleted(false);
        }
      } finally {
        if (!cancelled) setWelcomeModalResolved(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const version = await getVersion();
        if (!cancelled && version.trim()) {
          setAppVersion(version.trim());
        }
      } catch {
        // Non-Tauri contexts use the build-time fallback.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const dismissWelcomeModal = (doNotShowAgain: boolean) => {
    setWelcomeDoNotShow(doNotShowAgain);
    setShowWelcomeModal(false);
    setWelcomeFlowCompleted(true);
    try {
      window.localStorage.setItem(
        WELCOME_DISMISS_KEY,
        doNotShowAgain ? "true" : "false"
      );
    } catch {}
    // Keep DB value in sync for backward compatibility with existing tooling.
    void settingsSet(WELCOME_DISMISS_KEY, doNotShowAgain ? "true" : "false").catch((error) => {
      console.error("Failed to save welcome modal setting:", error);
    });
  };

  const resizeSidebar = (delta: number) => {
    setSidebarWidth((w) => Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, w + delta)));
  };

  const resizeWorkspace = (delta: number) => {
    // Divider is on the left edge of workspace: drag right → shrink workspace
    setWorkspaceWidth((w) => Math.max(WORKSPACE_MIN, Math.min(WORKSPACE_MAX, w - delta)));
  };

  if (uiMode === "avatar_presentation") {
    return <AvatarPresentationMode />;
  }

  return (
    <div className="flex h-screen w-screen flex-col bg-bg-norm overflow-hidden text-text-norm select-none">
      <div className="h-10 flex-shrink-0 border-b border-line-med bg-bg-norm px-3">
        <div className="flex h-full items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="inline-flex items-center gap-1.5">
              <span className="text-[12px] font-semibold tracking-wide text-text-norm">Arxell</span>
              <span className="text-[10px] text-text-med">v{appVersion}</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowGlobalSettings(true)}
              className="inline-flex items-center gap-1 text-[11px] text-text-med hover:text-text-norm"
              title="Open global settings"
            >
              <Settings size={13} />
              Settings
            </button>
            <button
              onClick={() => setPanel("help")}
              className="inline-flex items-center gap-1 text-[11px] text-text-med hover:text-text-norm"
              title="Open help"
            >
              <CircleHelp size={13} />
              Help
            </button>
            <button
              onClick={() => setPanel("sync")}
              className="inline-flex items-center gap-1 rounded bg-accent-gold/20 px-2 py-1 text-[11px] text-accent-gold hover:bg-accent-gold/30"
              title="Open cloud sync panel"
            >
              <Cloud size={13} />
              Cloud Sync
            </button>
            {CLERK_ENABLED ? (
              <>
                <SignedOut>
                  <SignInButton mode="modal">
                    <button className="rounded bg-line-med px-2 py-1 text-[11px] text-text-med hover:bg-line-dark">
                      Sign in
                    </button>
                  </SignInButton>
                  <SignUpButton mode="modal">
                    <button className="rounded bg-accent-primary/25 px-2 py-1 text-[11px] text-accent-primary hover:bg-accent-primary/35">
                      Sign up
                    </button>
                  </SignUpButton>
                </SignedOut>
                <SignedIn>
                  <UserButton />
                </SignedIn>
              </>
            ) : (
              <span className="text-[11px] text-text-dark">Cloud auth disabled</span>
            )}
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Left: Sidebar */}
        <div style={{ width: sidebarWidth }} className="flex-shrink-0 min-w-0 min-h-0 overflow-hidden">
          <Sidebar />
        </div>

        <ResizeDivider onDelta={resizeSidebar} />

        {/* Center: Chat */}
        <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
          <ChatPanel />
        </div>

        <ResizeDivider
          onDelta={resizeWorkspace}
          lineMode={toolbarPosition === "top" ? "top" : "full"}
        />

        {/* Right: Workspace */}
        <div style={{ width: workspaceWidth }} className="flex-shrink-0 min-w-0">
          <WorkspacePanel />
        </div>
      </div>

      <CommercialLicenseModal
        open={showCommercialLicenseModal}
        onClose={() => setShowCommercialLicenseModal(false)}
      />
      <WelcomeModal
        open={showWelcomeModal}
        initialDoNotShow={welcomeDoNotShow}
        onDismiss={dismissWelcomeModal}
        onOpenModelSetup={() => setPanel("llm")}
        onOpenPremiumTools={() => setPanel("tools")}
        onOpenCommercialLicense={() => setShowCommercialLicenseModal(true)}
      />
      <SettingsDialog
        open={showGlobalSettings}
        onClose={() => setShowGlobalSettings(false)}
      />
    </div>
  );
}
