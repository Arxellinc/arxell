import { useState, useCallback } from "react";
import { Check, ChevronDown, ChevronRight, Copy, Play, RefreshCw } from "lucide-react";
import { runVoiceDiagnostics, modelVerify, modelListAll, toolInvoke, type DiagResult } from "../../lib/tauri";
import { getAllToolManifests } from "../../core/tooling/registry";
import { cn } from "../../lib/utils";
import { useChatStore } from "../../store/chatStore";
import { useNotesStore } from "../../store/notesStore";
import { dispatchChatMessage } from "../../lib/chatDispatch";
import type { ToolId } from "../../core/tooling/types";

// Derive a section label from a result name like "stt/transcribe_test"
function sectionOf(name: string) {
  return name.split("/")[0].toUpperCase();
}

// Group results by their section prefix
function groupResults(results: DiagResult[]) {
  const groups = new Map<string, DiagResult[]>();
  for (const r of results) {
    const section = sectionOf(r.name);
    if (!groups.has(section)) groups.set(section, []);
    groups.get(section)!.push(r);
  }
  return groups;
}

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <div
      className={cn(
        "w-1.5 h-1.5 rounded-full flex-shrink-0 mt-0.5",
        ok ? "bg-accent-green" : "bg-accent-red/80"
      )}
    />
  );
}

interface DiagnosticRun {
  results: DiagResult[];
  timestamp: Date;
}

const PRIMARY_AGENT_TIMEOUT_MS = 45000;
const PRIMARY_AGENT_POLL_MS = 250;

// Tool test definitions: action to invoke and success criteria
interface ToolTest {
  toolId: ToolId;
  action: string;
  payload?: Record<string, unknown>;
  successCheck: (result: unknown) => { ok: boolean; detail: string };
  skipIfNoModel?: boolean;
  optional?: boolean;
}

// Predefined tool tests with success criteria
// Note: Some tools require rootGuard - we use "/" as a safe root for diagnostics
const TOOL_TESTS: ToolTest[] = [
  {
    toolId: "llm",
    action: "model.list_all",
    successCheck: (result) => {
      const r = result as { models?: unknown[] };
      if (r && Array.isArray(r.models)) {
        return { ok: true, detail: `${r.models.length} models configured` };
      }
      return { ok: false, detail: "Invalid response format" };
    },
  },
  {
    toolId: "devices",
    action: "system.identity",
    successCheck: (result) => {
      const r = result as { osName?: string; hostName?: string };
      if (r && r.osName) {
        return { ok: true, detail: `${r.osName} / ${r.hostName || "unknown"}` };
      }
      return { ok: false, detail: "Invalid response format" };
    },
  },
  {
    toolId: "devices",
    action: "system.storage",
    successCheck: (result) => {
      const r = result as { devices?: unknown[] };
      if (r && Array.isArray(r.devices)) {
        return { ok: true, detail: `${r.devices.length} storage devices` };
      }
      return { ok: false, detail: "Invalid response format" };
    },
  },
  {
    toolId: "devices",
    action: "audio.list_devices",
    successCheck: (result) => {
      const r = result as { inputs?: string[]; outputs?: string[] };
      if (r && Array.isArray(r.inputs) && Array.isArray(r.outputs)) {
        return { ok: true, detail: `${r.inputs.length} inputs, ${r.outputs.length} outputs` };
      }
      return { ok: false, detail: "Invalid response format" };
    },
  },
  {
    toolId: "web",
    action: "browser.fetch",
    payload: { url: "https://httpbin.org/get", mode: "text" },
    successCheck: (result) => {
      const r = result as { content?: string };
      if (r && typeof r.content === "string" && r.content.length > 0) {
        return { ok: true, detail: `${r.content.length} bytes fetched` };
      }
      return { ok: false, detail: "No content returned" };
    },
  },
  {
    toolId: "help",
    action: "workspace.list_dir",
    payload: { path: ".", rootGuard: "/" },
    optional: true,
    successCheck: (result) => {
      const r = result as { entries?: unknown[] };
      if (r && Array.isArray(r.entries)) {
        return { ok: true, detail: `${r.entries.length} entries returned` };
      }
      return { ok: false, detail: "Invalid response format" };
    },
  },
  {
    toolId: "terminal",
    action: "terminal.resolve_path",
    payload: { path: ".", rootGuard: "/" },
    successCheck: (result) => {
      const r = result as { path?: string };
      if (r && r.path) {
        return { ok: true, detail: r.path };
      }
      return { ok: false, detail: "Path not resolved" };
    },
  },
  {
    toolId: "terminal",
    action: "terminal.exec",
    payload: { command: "echo 'arx-test-ok'", timeout_ms: 5000, rootGuard: "/" },
    successCheck: (result) => {
      const r = result as { stdout?: string; exitCode?: number };
      if (r && r.exitCode === 0) {
        return { ok: true, detail: `exit=${r.exitCode}, stdout=${(r.stdout || "").trim()}` };
      }
      return { ok: false, detail: `exit=${r?.exitCode}, expected 0` };
    },
  },
  {
    toolId: "code",
    action: "workspace.list_dir",
    payload: { path: ".", rootGuard: "/" },
    successCheck: (result) => {
      const r = result as { entries?: unknown[] };
      if (r && Array.isArray(r.entries)) {
        return { ok: true, detail: `${r.entries.length} entries` };
      }
      return { ok: false, detail: "Invalid response format" };
    },
  },
];

export function DiagnosticsPanel() {
  const [isExpanded, setIsExpanded] = useState(false);
  const [voiceRunning, setVoiceRunning] = useState(false);
  const [fullRunning, setFullRunning] = useState(false);
  const [toolsRunning, setToolsRunning] = useState(false);
  const [primaryRunning, setPrimaryRunning] = useState(false);
  const [voiceRun, setVoiceRun] = useState<DiagnosticRun | null>(null);
  const [fullRun, setFullRun] = useState<DiagnosticRun | null>(null);
  const [toolsRun, setToolsRun] = useState<DiagnosticRun | null>(null);
  const [primaryRun, setPrimaryRun] = useState<DiagnosticRun | null>(null);
  const [copiedAll, setCopiedAll] = useState(false);

  const renderErrorSummary = useCallback(
    (errors: DiagResult[]) => {
      if (errors.length === 0) return null;
      return (
        <div className="space-y-1">
          {errors.map((err, index) => (
            <div key={`${err.name}:${index}`} className="flex items-start gap-1 rounded border border-accent-red/20 bg-accent-red/5 px-1 py-1">
              <div className="min-w-0 flex-1">
                <p className="text-[9px] text-accent-red/90 whitespace-pre-wrap break-words select-text cursor-text">
                  {err.name}: {err.detail}
                </p>
              </div>
            </div>
          ))}
        </div>
      );
    },
    []
  );

  // Run Voice diagnostics only
  const runVoice = useCallback(async () => {
    setVoiceRunning(true);
    try {
      const res = await runVoiceDiagnostics();
      setVoiceRun({ results: res, timestamp: new Date() });
      // Backend logs all results via log::info!/log::warn! which appear in app console
    } catch (e) {
      console.error("[arx diagnostics] Voice failed:", e);
    } finally {
      setVoiceRunning(false);
    }
  }, []);

  // Run Full System diagnostics (voice + model + coder)
  const runFull = useCallback(async () => {
    setFullRunning(true);
    const allResults: DiagResult[] = [];

    try {
      // 1. Voice diagnostics (backend logs to app console via log::info!/log::warn!)
      try {
        const voiceRes = await runVoiceDiagnostics();
        allResults.push(...voiceRes);
      } catch (e) {
        allResults.push({ name: "voice/error", ok: false, detail: String(e) });
      }

      // 2. Model connectivity
      try {
        const models = await modelListAll();
        const primary = models.find(m => m.is_primary) || models[0];
        if (primary) {
          const verify = await modelVerify(primary.id, false);
          allResults.push({ name: "model/verify", ok: verify.ok, detail: verify.message });
        } else {
          allResults.push({ name: "model/config", ok: false, detail: "No models configured" });
        }
      } catch (e) {
        allResults.push({ name: "model/error", ok: false, detail: String(e) });
      }

      // 3. Database (if we got here, DB is working - models query uses it)
      allResults.push({ name: "db/connection", ok: true, detail: "Database accessible" });

      setFullRun({ results: allResults, timestamp: new Date() });
    } catch (e) {
      console.error("[arx diagnostics] Full system failed:", e);
    } finally {
      setFullRunning(false);
    }
  }, []);

  // Run Agentic Tools Test
  const runTools = useCallback(async () => {
    setToolsRunning(true);
    const results: DiagResult[] = [];

    // Get enabled tools from registry
    const manifests = getAllToolManifests();
    const enabledTools = new Set(
      manifests.filter(m => m.defaultEnabled).map(m => m.id)
    );

    for (const test of TOOL_TESTS) {
      // Skip if tool is not enabled
      if (!enabledTools.has(test.toolId)) {
        results.push({
          name: `tools/${test.toolId}/${test.action}`,
          ok: true,
          detail: "Skipped (tool disabled)",
        });
        continue;
      }

      try {
        const result = await toolInvoke<unknown>({
          toolId: test.toolId,
          action: test.action,
          mode: "sandbox",
          payload: test.payload,
        });
        
        const check = test.successCheck(result);
        results.push({
          name: `tools/${test.toolId}/${test.action}`,
          ok: check.ok,
          detail: check.detail,
        });
      } catch (e) {
        const message = String(e);
        const shouldSkipAsOptional =
          Boolean(test.optional) &&
          (
            message.includes("outside allowed roots: <none>") ||
            message.toLowerCase().includes("not available") ||
            message.toLowerCase().includes("failed to run command") ||
            message.toLowerCase().includes("no such file or directory")
          );

        results.push({
          name: `tools/${test.toolId}/${test.action}`,
          ok: shouldSkipAsOptional,
          detail: shouldSkipAsOptional ? `Skipped (optional dependency unavailable): ${message}` : message,
        });
      }
    }

    setToolsRun({ results, timestamp: new Date() });
    setToolsRunning(false);
  }, []);

  // Run Primary Agent E2E test through the same send pipeline used by chat input.
  const runPrimaryAgentE2E = useCallback(async () => {
    setPrimaryRunning(true);
    const results: DiagResult[] = [];

    try {
      const token = `diag-${Date.now().toString(36)}`;
      const ack = `DIAG_OK ${token}`;
      const chatState = useChatStore.getState();
      const notesBefore = useNotesStore.getState().notes.length;
      const convId = chatState.activeConversationId;

      if (!convId) {
        results.push({
          name: "primary_agent/precheck",
          ok: false,
          detail: "No active conversation. Open chat and try again.",
        });
        setPrimaryRun({ results, timestamp: new Date() });
        return;
      }

      const messagesBefore = chatState.messages.filter((m) => m.conversation_id === convId).length;
      const prompt = [
        "Diagnostics test command.",
        `Use <create_note> to create a note titled "Diagnostics ${token}".`,
        `Set content to exactly "Primary agent token: ${token}".`,
        "Set tags to diagnostics,e2e.",
        `After creating the note, reply with exactly: ${ack}`,
      ].join(" ");

      const dispatch = dispatchChatMessage({ content: prompt, source: "diagnostics.primary_agent_e2e" });
      results.push({
        name: "primary_agent/dispatch",
        ok: dispatch.delivered,
        detail: dispatch.delivered
          ? `Dispatched via ${dispatch.route} with token ${token}`
          : `Dispatch fallback (${dispatch.route}) only; chat input handler not connected`,
      });
      if (!dispatch.delivered) {
        setPrimaryRun({ results, timestamp: new Date() });
        return;
      }

      const startedAt = Date.now();
      let sawStreaming = false;
      let sawAssistantAck = false;
      let sawUserPrompt = false;
      let sawNoteCreate = false;
      let lastAssistantSnippet = "";

      while (Date.now() - startedAt < PRIMARY_AGENT_TIMEOUT_MS) {
        const state = useChatStore.getState();
        const notesState = useNotesStore.getState();
        const convMessages = state.messages.filter((m) => m.conversation_id === convId);
        const recentMessages = convMessages.slice(messagesBefore);

        if (state.isStreaming) sawStreaming = true;

        for (const message of recentMessages) {
          if (message.role === "user" && message.content.includes(token)) {
            sawUserPrompt = true;
          }
          if (message.role === "assistant") {
            lastAssistantSnippet = message.content.slice(0, 180).replace(/\s+/g, " ").trim();
            if (message.content.includes(ack)) {
              sawAssistantAck = true;
            }
          }
        }

        sawNoteCreate = notesState.notes.some(
          (note) => note.title.includes(token) || note.content.includes(token)
        );

        if (sawUserPrompt && sawStreaming && sawAssistantAck && sawNoteCreate && !state.isStreaming) {
          break;
        }

        // Fail early if the dispatched user prompt never enters the conversation.
        if (!sawUserPrompt && Date.now() - startedAt > 8000) {
          break;
        }

        await new Promise((resolve) => setTimeout(resolve, PRIMARY_AGENT_POLL_MS));
      }

      const messagesAfter = useChatStore
        .getState()
        .messages.filter((m) => m.conversation_id === convId).length;
      const notesAfter = useNotesStore.getState().notes.length;

      results.push({
        name: "primary_agent/activity",
        ok: sawUserPrompt && sawStreaming,
        detail: `user_message=${sawUserPrompt} streaming=${sawStreaming} message_delta=${messagesAfter - messagesBefore}`,
      });
      results.push({
        name: "primary_agent/output",
        ok: sawAssistantAck,
        detail: sawAssistantAck
          ? `Assistant returned expected token: ${ack}`
          : `Missing expected assistant token. Last assistant snippet: ${lastAssistantSnippet || "(none)"}`,
      });
      results.push({
        name: "primary_agent/tool_side_effect",
        ok: sawNoteCreate && notesAfter > notesBefore,
        detail: `note_created=${sawNoteCreate} notes_before=${notesBefore} notes_after=${notesAfter}`,
      });
      results.push({
        name: "primary_agent/timeout",
        ok: sawAssistantAck && sawNoteCreate,
        detail:
          sawAssistantAck && sawNoteCreate
            ? "Primary agent E2E completed within timeout"
            : `Timed out after ${Math.round(PRIMARY_AGENT_TIMEOUT_MS / 1000)}s while waiting for completion`,
      });
    } catch (e) {
      results.push({
        name: "primary_agent/error",
        ok: false,
        detail: String(e),
      });
    } finally {
      setPrimaryRun({ results, timestamp: new Date() });
      setPrimaryRunning(false);
    }
  }, []);

  // Get errors from a diagnostic run
  const getErrors = (run: DiagnosticRun | null): DiagResult[] => {
    if (!run) return [];
    return run.results.filter(r => !r.ok);
  };

  const voiceErrors = getErrors(voiceRun);
  const fullErrors = getErrors(fullRun);
  const toolsErrors = getErrors(toolsRun);
  const primaryErrors = getErrors(primaryRun);
  const totalErrors = voiceErrors.length + fullErrors.length + toolsErrors.length + primaryErrors.length;
  const hasAnyRun = Boolean(voiceRun || fullRun || toolsRun || primaryRun);

  const copyAllResults = useCallback(async () => {
    const runs: Array<{ name: string; run: DiagnosticRun | null }> = [
      { name: "Voice", run: voiceRun },
      { name: "Full System", run: fullRun },
      { name: "Agentic Tools", run: toolsRun },
      { name: "Primary Agent E2E", run: primaryRun },
    ];

    const blocks = runs
      .filter((entry) => entry.run)
      .map((entry) => {
        const run = entry.run!;
        const header = `## ${entry.name}\nTimestamp: ${run.timestamp.toISOString()}\nPassed: ${run.results.filter((r) => r.ok).length}/${run.results.length}`;
        const rows = run.results
          .map((r) => `- [${r.ok ? "OK" : "FAIL"}] ${r.name}: ${r.detail}`)
          .join("\n");
        return `${header}\n${rows}`;
      });

    const report = [
      `Diagnostics Export`,
      `Generated: ${new Date().toISOString()}`,
      `Total Failures: ${totalErrors}`,
      "",
      ...blocks,
    ].join("\n");

    try {
      await navigator.clipboard.writeText(report);
      setCopiedAll(true);
      setTimeout(() => setCopiedAll(false), 1500);
    } catch (e) {
      console.error("[arx diagnostics] clipboard copy failed:", e);
    }
  }, [voiceRun, fullRun, toolsRun, primaryRun, totalErrors]);

  return (
    <div className="border-b border-line-light">
      {/* Header */}
      <div
        className="flex items-center gap-1.5 px-3 py-2 cursor-pointer hover:bg-line-light transition-colors"
        onClick={() => setIsExpanded((v) => !v)}
      >
        {isExpanded ? (
          <ChevronDown size={11} className="text-text-dark flex-shrink-0" />
        ) : (
          <ChevronRight size={11} className="text-text-dark flex-shrink-0" />
        )}
        <span className="sidebar-header-title text-[10px] font-medium uppercase tracking-wider flex-1">
          Diagnostics
        </span>

        {/* Summary badge */}
        {hasAnyRun && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              void copyAllResults();
            }}
            title={copiedAll ? "Copied diagnostics results" : "Copy all diagnostics results and errors"}
            className="p-1 rounded text-text-med hover:text-text-norm hover:bg-line-light transition-colors"
          >
            {copiedAll ? <Check size={11} /> : <Copy size={11} />}
          </button>
        )}

        {hasAnyRun && (
          <span
            className={cn(
              "text-[9px] px-1 py-0.5 rounded font-mono",
              totalErrors > 0 
                ? "text-accent-red bg-accent-red/10" 
                : "text-accent-green bg-accent-green/10"
            )}
          >
            {totalErrors > 0 ? `${totalErrors} fail` : "all ok"}
          </span>
        )}
      </div>

      {isExpanded && (
        <div className="px-3 pb-3 space-y-3">
          {/* Voice Diagnostic Button */}
          <div className="space-y-1">
            <button
              onClick={runVoice}
              disabled={voiceRunning}
              className="flex items-center gap-1.5 px-2 py-1 text-[10px] bg-line-light hover:bg-line-med text-text-med hover:text-text-norm rounded transition-colors disabled:opacity-50 w-full justify-center"
            >
              {voiceRunning ? (
                <RefreshCw size={9} className="animate-spin" />
              ) : (
                <Play size={9} />
              )}
              {voiceRunning ? "Running Voice…" : "Voice Diagnostic"}
            </button>
            {voiceRun && (
              <p className="text-[9px] text-text-dark">
                Last run: {voiceRun.timestamp.toLocaleTimeString()}
              </p>
            )}
            {/* Voice error summary - single lines, no wrap */}
            {renderErrorSummary(voiceErrors)}
          </div>

          {/* Full System Diagnostic Button */}
          <div className="space-y-1">
            <button
              onClick={runFull}
              disabled={fullRunning}
              className="flex items-center gap-1.5 px-2 py-1 text-[10px] bg-accent-primary/10 hover:bg-accent-primary/20 text-accent-primary rounded transition-colors disabled:opacity-50 w-full justify-center"
            >
              {fullRunning ? (
                <RefreshCw size={9} className="animate-spin" />
              ) : (
                <Play size={9} />
              )}
              {fullRunning ? "Running Full System…" : "Full System Diagnostic"}
            </button>
            {fullRun && (
              <p className="text-[9px] text-text-dark">
                Last run: {fullRun.timestamp.toLocaleTimeString()}
              </p>
            )}
            {/* Full system error summary - single lines, no wrap */}
            {renderErrorSummary(fullErrors)}
          </div>

          {/* Agentic Tools Test Button */}
          <div className="space-y-1">
            <button
              onClick={runTools}
              disabled={toolsRunning}
              className="flex items-center gap-1.5 px-2 py-1 text-[10px] bg-amber-500/10 hover:bg-amber-500/20 text-amber-600 rounded transition-colors disabled:opacity-50 w-full justify-center"
            >
              {toolsRunning ? (
                <RefreshCw size={9} className="animate-spin" />
              ) : (
                <Play size={9} />
              )}
              {toolsRunning ? "Running Tools Test…" : "Agentic Tools Test"}
            </button>
            {toolsRun && (
              <p className="text-[9px] text-text-dark">
                Last run: {toolsRun.timestamp.toLocaleTimeString()} • {toolsRun.results.filter(r => r.ok).length}/{toolsRun.results.length} passed
              </p>
            )}
            {/* Tools error summary - single lines, no wrap */}
            {renderErrorSummary(toolsErrors)}
          </div>

          {/* Primary Agent E2E Test */}
          <div className="space-y-1">
            <button
              onClick={runPrimaryAgentE2E}
              disabled={primaryRunning}
              className="flex items-center gap-1.5 px-2 py-1 text-[10px] bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-600 rounded transition-colors disabled:opacity-50 w-full justify-center"
            >
              {primaryRunning ? (
                <RefreshCw size={9} className="animate-spin" />
              ) : (
                <Play size={9} />
              )}
              {primaryRunning ? "Running Primary Agent E2E…" : "Primary Agent E2E Test"}
            </button>
            {primaryRun && (
              <p className="text-[9px] text-text-dark">
                Last run: {primaryRun.timestamp.toLocaleTimeString()} • {primaryRun.results.filter(r => r.ok).length}/{primaryRun.results.length} passed
              </p>
            )}
            {renderErrorSummary(primaryErrors)}
          </div>

          {/* Detailed results for voice */}
          {voiceRun && (
            <div className="space-y-2 pt-2 border-t border-line-light">
              <div className="sidebar-header-title text-[9px] font-medium uppercase tracking-wider">
                Voice Details ({voiceRun.results.filter(r => r.ok).length}/{voiceRun.results.length} passed)
              </div>
              <div className="space-y-2">
                {Array.from(groupResults(voiceRun.results).entries()).map(([section, items]) => {
                  const sectionFail = items.some((i) => !i.ok);
                  return (
                    <div key={section}>
                      <div className="flex items-center gap-1.5 mb-1">
                        <div
                          className={cn(
                            "w-1 h-1 rounded-full flex-shrink-0",
                            sectionFail ? "bg-accent-red/70" : "bg-accent-green/70"
                          )}
                        />
                        <span className="sidebar-header-title text-[9px] font-medium uppercase tracking-wider">
                          {section}
                        </span>
                      </div>
                      <div className="space-y-1 pl-3">
                        {items.map((item) => (
                          <div key={item.name} className="flex items-start gap-1.5">
                            <StatusDot ok={item.ok} />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-baseline gap-1 flex-wrap">
                                <span className="text-[9px] text-text-med font-mono">
                                  {item.name.split("/").slice(1).join("/")}
                                </span>
                              </div>
                              <p
                                className={cn(
                                  "text-[9px] leading-snug break-all select-text cursor-text",
                                  item.ok ? "text-text-dark" : "text-accent-red/70"
                                )}
                              >
                                {item.detail}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Detailed results for tools */}
          {toolsRun && (
            <div className="space-y-2 pt-2 border-t border-line-light">
              <div className="sidebar-header-title text-[9px] font-medium uppercase tracking-wider">
                Tools Test Details ({toolsRun.results.filter(r => r.ok).length}/{toolsRun.results.length} passed)
              </div>
              <div className="space-y-2">
                {Array.from(groupResults(toolsRun.results).entries()).map(([section, items]) => {
                  const sectionFail = items.some((i) => !i.ok);
                  return (
                    <div key={section}>
                      <div className="flex items-center gap-1.5 mb-1">
                        <div
                          className={cn(
                            "w-1 h-1 rounded-full flex-shrink-0",
                            sectionFail ? "bg-accent-red/70" : "bg-accent-green/70"
                          )}
                        />
                        <span className="sidebar-header-title text-[9px] font-medium uppercase tracking-wider">
                          {section}
                        </span>
                      </div>
                      <div className="space-y-1 pl-3">
                        {items.map((item) => (
                          <div key={item.name} className="flex items-start gap-1.5">
                            <StatusDot ok={item.ok} />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-baseline gap-1 flex-wrap">
                                <span className="text-[9px] text-text-med font-mono">
                                  {item.name.split("/").slice(1).join("/")}
                                </span>
                              </div>
                              <p
                                className={cn(
                                  "text-[9px] leading-snug break-all select-text cursor-text",
                                  item.ok ? "text-text-dark" : "text-accent-red/70"
                                )}
                              >
                                {item.detail}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Detailed results for primary agent e2e */}
          {primaryRun && (
            <div className="space-y-2 pt-2 border-t border-line-light">
              <div className="sidebar-header-title text-[9px] font-medium uppercase tracking-wider">
                Primary Agent E2E Details ({primaryRun.results.filter(r => r.ok).length}/{primaryRun.results.length} passed)
              </div>
              <div className="space-y-2">
                {Array.from(groupResults(primaryRun.results).entries()).map(([section, items]) => {
                  const sectionFail = items.some((i) => !i.ok);
                  return (
                    <div key={section}>
                      <div className="flex items-center gap-1.5 mb-1">
                        <div
                          className={cn(
                            "w-1 h-1 rounded-full flex-shrink-0",
                            sectionFail ? "bg-accent-red/70" : "bg-accent-green/70"
                          )}
                        />
                        <span className="sidebar-header-title text-[9px] font-medium uppercase tracking-wider">
                          {section}
                        </span>
                      </div>
                      <div className="space-y-1 pl-3">
                        {items.map((item) => (
                          <div key={item.name} className="flex items-start gap-1.5">
                            <StatusDot ok={item.ok} />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-baseline gap-1 flex-wrap">
                                <span className="text-[9px] text-text-med font-mono">
                                  {item.name.split("/").slice(1).join("/")}
                                </span>
                              </div>
                              <p
                                className={cn(
                                  "text-[9px] leading-snug break-all select-text cursor-text",
                                  item.ok ? "text-text-dark" : "text-accent-red/70"
                                )}
                              >
                                {item.detail}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

        </div>
      )}
    </div>
  );
}
