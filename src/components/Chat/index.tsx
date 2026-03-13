import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, FolderPlus, Trash2 } from "lucide-react";
import { ModeSelector } from "./ModeSelector";
import { FullAutoWarningModal } from "./FullAutoWarningModal";
import { useChatStore } from "../../store/chatStore";
import { useVoiceStore } from "../../store/voiceStore";
import { useTaskStore, areDependenciesComplete, computeTaskScore } from "../../store/taskStore";
import { ensureDefaultProjectId, useChatStream, useLoadMessages } from "../../hooks/useChat";
import { useVoiceMode } from "../../hooks/useVoice";
import { MessageList } from "./MessageList";
import { InputBar } from "./InputBar";
import { VoiceIndicator } from "./VoiceIndicator";
import { SkillsBar } from "./SkillsBar";
import { MODE_SELECTION_SETTING_KEY } from "../../lib/modes";
import {
  CHAT_DISPATCH_EVENT,
  registerChatDispatchHandler,
  type ChatDispatchPayload,
} from "../../lib/chatDispatch";
import {
  chatCancel,
  chatClear,
  conversationCreate,
  conversationGetLast,
  conversationListAll,
  settingsGet,
  settingsSet,
} from "../../lib/tauri";
import { suppressContextMenuUnlessAllowed } from "../../lib/contextMenu";

const IDLE_CHECK_INTERVAL_MS = 10_000; // check every 10 s

export function ChatPanel() {
  const {
    activeConversationId,
    activeProjectId,
    isStreaming,
    conversations,
    setActiveConversation,
    setConversations,
    setMessages,
    addConversation,
    finishStreaming,
    thinkingEnabled,
    toggleThinking,
    activeMode,
    setActiveMode,
  } = useChatStore();
  const tasks = useTaskStore((s) => s.tasks);
  const pendingTasks = useMemo(
    () =>
      [...tasks]
        .filter((t) => t.status === "pending" && areDependenciesComplete(t, tasks))
        .sort((a, b) => computeTaskScore(b, tasks) - computeTaskScore(a, tasks)),
    [tasks]
  );
  // Use field-level selectors (instead of useVoiceStore() object destructuring)
  // so high-frequency voice store updates (e.g. amplitude) do not re-render
  // the entire ChatPanel subtree unless these specific fields change.
  const voiceMode = useVoiceStore((s) => s.voiceMode);
  const isSpeaking = useVoiceStore((s) => s.isSpeaking);
  const pipelineState = useVoiceStore((s) => s.pipelineState);
  const stopCurrentAudio = useVoiceStore((s) => s.stopCurrentAudio);
  const setStopCurrentAudio = useVoiceStore((s) => s.setStopCurrentAudio);
  const setIsSpeaking = useVoiceStore((s) => s.setIsSpeaking);
  const setPipelineState = useVoiceStore((s) => s.setPipelineState);
  const { sendMessage } = useChatStream();
  useVoiceMode(sendMessage);
  useLoadMessages();
  const prevVoiceMode = useRef(voiceMode);
  const lastAutoDispatchKey = useRef<string>("");

  // ── Full-auto idle detection ──────────────────────────────────────────────
  const lastActivityAtRef = useRef<number>(Date.now());
  const showAutoWarningRef = useRef(false);
  const autoDispatchReadyRef = useRef(false);
  const idleThresholdMsRef = useRef(5 * 60 * 1000); // default 5 min, overridden by setting
  const [showAutoWarning, setShowAutoWarning] = useState(false);
  const [autoDispatchReady, setAutoDispatchReady] = useState(false);
  // Keep refs in sync so interval callbacks read fresh values without stale closure
  showAutoWarningRef.current = showAutoWarning;
  autoDispatchReadyRef.current = autoDispatchReady;

  // Auto-load last conversation on mount, or create a new one if none exist
  useEffect(() => {
    const initChat = async () => {
      // Load all conversations
      try {
        const allConvs = await conversationListAll();
        setConversations(allConvs);

        // If no active conversation, try to load the last one or create a new one
        if (!activeConversationId) {
          const lastConv = await conversationGetLast();
          if (lastConv) {
            setActiveConversation(lastConv.id);
          } else if (allConvs.length === 0) {
            // No conversations exist, create a new one automatically
            const projectId = await ensureDefaultProjectId();
            const newConv = await conversationCreate(projectId, "New Chat");
            addConversation(newConv);
            setActiveConversation(newConv.id);
          } else {
            // Conversations exist but no last one found, use the first from list
            setActiveConversation(allConvs[0].id);
          }
        }
      } catch (e) {
        console.error("Failed to initialize chat:", e);
      }
    };
    initChat();
  }, []);

  // Load user-configured full-auto idle timeout
  useEffect(() => {
    settingsGet("full_auto_idle_minutes")
      .then((v) => {
        const minutes = v ? parseFloat(v) : 5;
        if (Number.isFinite(minutes) && minutes > 0) {
          idleThresholdMsRef.current = Math.round(minutes * 60 * 1000);
        }
      })
      .catch(() => {}); // keep default on error
  }, []);

  // Voice mode defaults: prefer short responses with thinking off for latency.
  // User can still manually turn thinking back on while voice mode is active.
  useEffect(() => {
    if (voiceMode && !prevVoiceMode.current && thinkingEnabled) {
      toggleThinking();
    }
    prevVoiceMode.current = voiceMode;
  }, [voiceMode, thinkingEnabled, toggleThinking]);

  // Track user activity — reset idle clock on any interaction
  useEffect(() => {
    if (activeMode !== "full") {
      // Leaving full-auto: clear modal + dispatch lock
      setShowAutoWarning(false);
      setAutoDispatchReady(false);
      lastActivityAtRef.current = Date.now();
      return;
    }

    const onActivity = () => {
      lastActivityAtRef.current = Date.now();
    };

    window.addEventListener("mousemove", onActivity, { passive: true });
    window.addEventListener("mousedown", onActivity, { passive: true });
    window.addEventListener("keydown", onActivity, { passive: true });
    window.addEventListener("touchstart", onActivity, { passive: true });
    window.addEventListener("scroll", onActivity, { passive: true });

    return () => {
      window.removeEventListener("mousemove", onActivity);
      window.removeEventListener("mousedown", onActivity);
      window.removeEventListener("keydown", onActivity);
      window.removeEventListener("touchstart", onActivity);
      window.removeEventListener("scroll", onActivity);
    };
  }, [activeMode]);

  // Periodically check for idle → show warning before autonomous dispatch
  useEffect(() => {
    if (activeMode !== "full") return;

    const interval = setInterval(() => {
      if (showAutoWarningRef.current) return;   // Modal already visible
      if (autoDispatchReadyRef.current) return; // Already unlocked

      // Check pending tasks from store without closing over stale state
      const { tasks } = useTaskStore.getState();
      const hasPending = tasks.some(
        (t) => t.status === "pending" && areDependenciesComplete(t, tasks)
      );
      if (!hasPending) return;

      if (Date.now() - lastActivityAtRef.current >= idleThresholdMsRef.current) {
        setShowAutoWarning(true);
      }
    }, IDLE_CHECK_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [activeMode]);

  // ── Full-auto modal handlers ──────────────────────────────────────────────
  const handleAutoWarningReturnToolsMode = async () => {
    setShowAutoWarning(false);
    setAutoDispatchReady(false);
    lastActivityAtRef.current = Date.now();
    setActiveMode("tools");
    try {
      await settingsSet(MODE_SELECTION_SETTING_KEY, "tools");
    } catch (e) {
      console.error("Failed to persist mode change:", e);
    }
  };

  const handleAutoWarningPostpone = () => {
    setShowAutoWarning(false);
    setAutoDispatchReady(false);
    // Reset idle clock so the warning won't reappear for another 5 minutes
    lastActivityAtRef.current = Date.now();
  };

  const handleAutoWarningAccept = () => {
    setShowAutoWarning(false);
    setAutoDispatchReady(true);
    lastActivityAtRef.current = Date.now();
  };

  const handleNewChat = async () => {
    try {
      const projectId = activeProjectId ?? (await ensureDefaultProjectId());
      const conv = await conversationCreate(projectId, "New Chat");
      addConversation(conv);
      setActiveConversation(conv.id);
      // Refresh the full conversation list to ensure sidebar is in sync
      const allConvs = await conversationListAll();
      setConversations(allConvs);
    } catch (e) {
      console.error("Failed to create conversation:", e);
    }
  };

  const handleStop = async () => {
    // Clear streaming state FIRST so any in-flight chat:chunk events fail the
    // streamingMessage guard in useChatStream and are silently dropped, preventing
    // tool follow-ups, TTS, and other post-completion side-effects from firing.
    finishStreaming();
    stopCurrentAudio?.();
    setStopCurrentAudio(null);
    setIsSpeaking(false);
    if (pipelineState === "agent_speaking" || pipelineState === "processing") {
      setPipelineState("interrupted");
    }
    try {
      await chatCancel();
    } catch (e) {
      console.error("Failed to cancel chat:", e);
    }
  };

  const handleClearChat = async () => {
    if (!activeConversationId) return;
    try {
      await chatClear(activeConversationId);
      setMessages([]);
    } catch (e) {
      console.error("Failed to clear chat:", e);
    }
  };

  const handleAddToProject = async () => {
    // For now, just show an alert - this would open a project selector modal
    // TODO: Implement project selector modal
    if (!activeConversationId) return;
    alert("Project selector coming soon! For now, you can drag the chat to a project in the sidebar.");
  };

  useEffect(() => {
    if (
      activeMode !== "full" ||
      !activeConversationId ||
      isStreaming ||
      pendingTasks.length === 0 ||
      !autoDispatchReady  // Wait for user to acknowledge the idle warning
    ) {
      return;
    }

    const pending = pendingTasks[0];
    const dispatchKey = `${pending.id}:${pending.updated_at}`;
    if (lastAutoDispatchKey.current === dispatchKey) return;
    lastAutoDispatchKey.current = dispatchKey;

    // Reset dispatch lock — next task batch will require another idle+accept cycle
    setAutoDispatchReady(false);

    const autoPrompt = [
      "FULL-AUTO TASK RUN",
      `Process the next pending task now:`,
      `Task ID: ${pending.id}`,
      `Title: ${pending.title}`,
      `Project: ${pending.project_name}`,
      `Priority: ${pending.priority}`,
      `Due: ${pending.due_at ?? "none"}`,
      "",
      "Requirements:",
      "- Mark the task as running using <update_task> before implementation work.",
      "- Execute the task end-to-end.",
      "- Mark it completed (or failed with explanation) using <update_task>.",
      "- If follow-up work is needed, create child tasks with <create_task>.",
    ].join("\n");

    void sendMessage(autoPrompt);
  }, [activeMode, activeConversationId, isStreaming, pendingTasks, sendMessage, autoDispatchReady]);

  useEffect(() => {
    registerChatDispatchHandler((payload) => {
      const content = payload.content?.trim();
      if (!content) return;
      void sendMessage(content);
    });

    const handleDispatch = (event: Event) => {
      const custom = event as CustomEvent<ChatDispatchPayload>;
      const content = custom.detail?.content?.trim();
      if (!content) return;
      void sendMessage(content);
    };

    window.addEventListener(CHAT_DISPATCH_EVENT, handleDispatch as EventListener);
    return () => {
      registerChatDispatchHandler(null);
      window.removeEventListener(CHAT_DISPATCH_EVENT, handleDispatch as EventListener);
    };
  }, [sendMessage]);

  return (
    <div
      className="flex-1 flex flex-col bg-bg-dark min-w-0 min-h-0 h-full overflow-hidden"
      onContextMenu={suppressContextMenuUnlessAllowed}
    >
      {/* Header with action buttons */}
      <div className="h-12 px-3 border-b border-line-light bg-bg-norm flex-shrink-0 flex items-center justify-between">
        <ModeSelector />
        <div className="flex items-center gap-1">
          <button
            onClick={handleNewChat}
            className="flex items-center gap-1.5 px-2 py-1 text-[11px] text-text-med hover:text-text-med hover:bg-line-light rounded transition-colors"
            title="New chat"
          >
            <Plus size={12} />
            <span>New Chat</span>
          </button>
          <button
            onClick={handleClearChat}
            disabled={!activeConversationId}
            className="flex items-center gap-1.5 px-2 py-1 text-[11px] text-text-med hover:text-text-med hover:bg-line-light rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            title="Clear chat"
          >
            <Trash2 size={12} />
            <span>Clear Chat</span>
          </button>
          <button
            onClick={handleAddToProject}
            disabled={!activeConversationId}
            className="flex items-center gap-1.5 px-2 py-1 text-[11px] text-text-med hover:text-text-med hover:bg-line-light rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            title="Add to project"
          >
            <FolderPlus size={12} />
            <span>Add to Project</span>
          </button>
        </div>
      </div>

      {/* Skills bar - below header */}
      <SkillsBar />

      {/* Messages */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <MessageList />
      </div>

      {/* Voice indicator */}
      <VoiceIndicator />

      {/* Input panel */}
      <div className="chat-input-panel p-3 border-t border-line-light bg-transparent">
        <InputBar
          onSend={sendMessage}
          onStop={handleStop}
          isStreaming={isStreaming}
          canStop={isStreaming || isSpeaking || pipelineState === "agent_speaking"}
          disabled={isStreaming}
          voiceMode={voiceMode}
        />
      </div>

      {/* Full-auto idle warning modal */}
      <FullAutoWarningModal
        open={showAutoWarning}
        pendingTaskCount={pendingTasks.length}
        pendingTaskTitle={pendingTasks[0]?.title}
        lastActivityAt={lastActivityAtRef.current}
        onReturnToToolsMode={() => void handleAutoWarningReturnToolsMode()}
        onPostpone={handleAutoWarningPostpone}
        onAccept={handleAutoWarningAccept}
      />
    </div>
  );
}
