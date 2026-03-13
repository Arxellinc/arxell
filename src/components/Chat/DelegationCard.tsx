import { useEffect, useRef } from "react";
import { Bot, Loader2, CheckCircle, AlertCircle } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { listen } from "@tauri-apps/api/event";
import { useChatStore, type DelegationState } from "../../store/chatStore";
import { modelListAll, delegateModelStream } from "../../lib/tauri";

interface Props {
  delegation: DelegationState;
}

export function DelegationCard({ delegation }: Props) {
  const startedRef = useRef(false);
  const unlistenRef = useRef<(() => void) | null>(null);
  const { appendDelegationChunk, completeDelegation } = useChatStore();

  useEffect(() => {
    if (startedRef.current) return;
    if (delegation.status !== "pending") return;
    startedRef.current = true;

    const run = async () => {
      try {
        // Look up api_key for the model
        let apiKey = delegation.apiKey;
        if (!apiKey) {
          const models = await modelListAll();
          const match = models.find(
            (m) =>
              m.name === delegation.modelName ||
              m.model_id === delegation.modelId ||
              m.base_url.replace(/\/$/, "") === delegation.baseUrl.replace(/\/$/, "")
          );
          apiKey = match?.api_key ?? "";
        }

        // Listen for streaming chunks before firing the command
        const unlisten = await listen<{
          delegation_id: string;
          delta: string;
          done: boolean;
          error?: string;
        }>("delegate:chunk", (event) => {
          const { delegation_id, delta, done, error } = event.payload;
          if (delegation_id !== delegation.messageId) return;
          if (delta) {
            appendDelegationChunk(delegation.messageId, delta);
          }
          if (done) {
            completeDelegation(delegation.messageId, error);
            unlistenRef.current?.();
            unlistenRef.current = null;
          }
        });
        unlistenRef.current = unlisten;

        await delegateModelStream({
          delegationId: delegation.messageId,
          modelId: delegation.modelId,
          baseUrl: delegation.baseUrl,
          apiKey,
          prompt: delegation.prompt,
        });
      } catch (e) {
        completeDelegation(delegation.messageId, String(e));
        unlistenRef.current?.();
        unlistenRef.current = null;
      }
    };

    void run();

    return () => {
      unlistenRef.current?.();
      unlistenRef.current = null;
    };
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  const isRunning = delegation.status === "pending" || delegation.status === "running";
  const isError = delegation.status === "error";
  const isDone = delegation.status === "done";

  const endpoint = `${delegation.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const displayCmd = `# Delegating to ${delegation.modelName}\ncurl -s -X POST '${endpoint}' \\\n  -H 'Content-Type: application/json' \\\n  -d '{"model":"${delegation.modelId}","messages":[{"role":"user","content":"..."}],"stream":true}'`;

  return (
    <div className="mt-2 w-full border border-accent-primary/30 rounded-xl overflow-hidden bg-bg-dark text-[12px]">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-line-med bg-line-light/30">
        {isRunning && (
          <Loader2 size={13} className="text-accent-primary animate-spin shrink-0" />
        )}
        {isDone && (
          <CheckCircle size={13} className="text-accent-green shrink-0" />
        )}
        {isError && (
          <AlertCircle size={13} className="text-accent-red shrink-0" />
        )}
        <Bot size={13} className="text-accent-primary shrink-0" />
        <span className="text-text-med">
          {isRunning ? "Asking " : isDone ? "Response from " : "Error from "}
          <span className="text-accent-primary font-medium">{delegation.modelName}</span>
          {isRunning ? "…" : ""}
        </span>
      </div>

      {/* Command section */}
      <div className="px-3 py-2 border-b border-line-med">
        <div className="text-[10px] text-text-dark uppercase tracking-wide mb-1">Command</div>
        <pre className="text-[10px] text-text-med font-mono whitespace-pre-wrap break-all leading-relaxed">
          {displayCmd}
        </pre>
      </div>

      {/* Response section */}
      <div className="px-3 py-2">
        <div className="text-[10px] text-text-dark uppercase tracking-wide mb-1">Response</div>
        {isRunning && !delegation.response && (
          <span className="text-text-dark italic">Streaming…</span>
        )}
        {delegation.response && (
          <div className="chat-md prose prose-invert prose-sm max-w-none select-text text-text-norm">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {delegation.response}
            </ReactMarkdown>
          </div>
        )}
        {isRunning && delegation.response && (
          <span className="inline-block w-1.5 h-3 bg-accent-primary animate-pulse ml-0.5 align-middle rounded-sm" />
        )}
        {isError && (
          <p className="text-accent-red text-[11px]">
            {delegation.error ?? "Unknown error"}
          </p>
        )}
      </div>
    </div>
  );
}
