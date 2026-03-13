import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { Copy, Check, NotebookPen, GitBranchPlus, RefreshCw } from "lucide-react";
import { memo, useState, isValidElement, type ReactNode } from "react";
import { cn } from "../../lib/utils";
import type { Message } from "../../types";
import {
  chatGetMessages,
  chatRegenerateLastPrompt,
  conversationBranchFromMessage,
  conversationListAll,
} from "../../lib/tauri";
import { dispatchChatMessage } from "../../lib/chatDispatch";
import { useChatStore } from "../../store/chatStore";
import { useNotesStore } from "../../store/notesStore";
import { useToolPanelStore } from "../../store/toolPanelStore";
import { DelegationCard } from "./DelegationCard";

interface MessageItemProps {
  message: Message | { id: string; role: "assistant"; content: string; streaming?: boolean };
  variant?: "default" | "minimal";
}

const TOOL_TAG_NAMES = [
  "write_to_file", "read_file", "browser_fetch", "browser_navigate", "browser_screenshot",
  "create_task", "update_task", "coder_run", "create_note", "update_note",
  "memory_set", "memory_delete", "settings_get", "settings_set",
  "project_second_opinion", "project_process_create", "project_process_set_status", "project_process_retry",
  "delegate_to_model",
];
const TOOL_XML_RE = new RegExp(
  `<(?:${TOOL_TAG_NAMES.join("|")})[\\s\\S]*?</(?:${TOOL_TAG_NAMES.join("|")})>|<(?:${TOOL_TAG_NAMES.join("|")})\\s*/?>`,
  "gi"
);

function stripToolXml(content: string): string {
  return content.replace(TOOL_XML_RE, "").replace(/\n{3,}/g, "\n\n").trim();
}

function nodeToPlainText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map((item) => nodeToPlainText(item)).join("");
  if (isValidElement(node)) {
    const props = node.props as { children?: ReactNode } | null;
    return nodeToPlainText(props?.children ?? "");
  }
  return "";
}

function CodeBlock({ children, className }: { children: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const lang = className?.replace("language-", "") ?? "code";

  const copy = () => {
    navigator.clipboard.writeText(children);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative group my-3 rounded-lg overflow-hidden border border-line-med max-w-full">
      <div className="flex items-center justify-between px-3 py-1 bg-line-light border-b border-line-light">
        <span className="text-[9px] text-text-dark font-mono uppercase tracking-wide">{lang}</span>
        <button
          onClick={copy}
          className="inline-flex items-center rounded p-1 text-text-dark hover:text-text-med hover:bg-line-med transition-colors"
          title={copied ? "Copied" : "Copy snippet"}
          aria-label={copied ? "Copied" : "Copy snippet"}
        >
          {copied ? <Check size={11} /> : <Copy size={11} />}
        </button>
      </div>
      <pre className="p-3 text-[11px] leading-[1] bg-bg-dark whitespace-pre-wrap break-words [overflow-wrap:anywhere] overflow-x-hidden max-w-full">
        <code className={cn(className, "whitespace-pre-wrap break-words [overflow-wrap:anywhere]")}>{children}</code>
      </pre>
    </div>
  );
}

function MessageItemInner({ message, variant = "default" }: MessageItemProps) {
  const isUser = message.role === "user";
  const isStreaming = "streaming" in message && message.streaming;
  const isMinimal = variant === "minimal";
  const [copied, setCopied] = useState(false);
  const [noteAdded, setNoteAdded] = useState(false);
  const [branched, setBranched] = useState(false);
  const [regenerated, setRegenerated] = useState(false);
  const delegation = useChatStore((s) => s.delegations[message.id]);

  const copyMessage = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch (e) {
      console.error("Failed to copy message:", e);
    }
  };

  const addToNote = () => {
    try {
      useNotesStore.getState().addNoteFromResponse(message.content);
      useToolPanelStore.getState().setPanel("notes");
      setNoteAdded(true);
      setTimeout(() => setNoteAdded(false), 1400);
    } catch (e) {
      console.error("Failed to create note from response:", e);
    }
  };

  const branchToNewChat = async () => {
    if (isUser || isStreaming) return;
    try {
      const chatState = useChatStore.getState();
      const compact = message.content.replace(/\s+/g, " ").trim();
      const title =
        compact.length > 0
          ? `Branch: ${compact.slice(0, 44)}${compact.length > 44 ? "..." : ""}`
          : "Branched Chat";
      const conversation = await conversationBranchFromMessage(
        chatState.activeConversationId,
        chatState.activeProjectId,
        message.content,
        title
      );
      chatState.addConversation(conversation);
      chatState.setActiveConversation(conversation.id);
      const allConversations = await conversationListAll();
      chatState.setConversations(allConversations);
      setBranched(true);
      setTimeout(() => setBranched(false), 1400);
    } catch (e) {
      console.error("Failed to branch conversation:", e);
    }
  };

  const regenerateLastPrompt = async () => {
    if (isUser || isStreaming) return;
    try {
      const chatState = useChatStore.getState();
      const convId = chatState.activeConversationId;
      if (!convId) return;
      const prompt = await chatRegenerateLastPrompt(convId);
      const refreshed = await chatGetMessages(convId);
      chatState.setMessages(refreshed);
      dispatchChatMessage({ content: prompt, source: "regenerate-last-prompt" });
      setRegenerated(true);
      setTimeout(() => setRegenerated(false), 1400);
    } catch (e) {
      console.error("Failed to regenerate last prompt:", e);
    }
  };

  return (
    <div
      className={cn(
        "group flex px-6 py-2",
        isUser ? "justify-end" : "justify-start"
      )}
    >
      <div
        className={cn(
          "flex flex-col",
          isUser ? "max-w-[75%] items-end" : "max-w-[78%] items-start"
        )}
      >
        <div
          className={cn(
            "w-full px-4 py-3 relative rounded-2xl",
            isUser
              ? "rounded-tr-sm bg-[#0A84FF] text-white"
              : "rounded-tl-sm bg-[#2C2C2E] text-white"
          )}
        >
          {isUser ? (
            <p className="text-[13px] leading-relaxed whitespace-pre-wrap select-text">{message.content}</p>
          ) : isStreaming ? (
            <p className="text-[13px] leading-relaxed whitespace-pre-wrap select-text">
              {message.content}
              <span className="inline-block w-1.5 h-4 bg-accent-primary animate-pulse ml-0.5 align-middle rounded-sm" />
            </p>
          ) : (
            <div className="chat-md prose prose-invert prose-sm max-w-none select-text text-white">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeHighlight]}
                components={{
                  code({ inline, className, children, ...props }: any) {
                    const isBlock = !inline;
                    const plain = nodeToPlainText(children).replace(/\n$/, "");
                    if (isBlock) {
                      return (
                        <CodeBlock className={className}>
                          {plain}
                        </CodeBlock>
                      );
                    }
                    return (
                      <code
                        className="px-1.5 py-0.5 rounded bg-white/12 text-white text-[11px] font-mono"
                        {...props}
                      >
                        {plain}
                      </code>
                    );
                  },
                  p({ children }) {
                    return <p className="mb-3 last:mb-0 leading-relaxed text-[13px] text-white">{children}</p>;
                  },
                  ul({ children }) {
                    return <ul className="mb-3 pl-4 space-y-1 text-[13px] list-disc list-outside text-white">{children}</ul>;
                  },
                  ol({ children }) {
                    return <ol className="mb-3 pl-4 space-y-1 text-[13px] list-decimal list-outside text-white">{children}</ol>;
                  },
                  h1({ children }) {
                    return <h1 className="text-lg font-semibold mb-2 mt-4 text-white">{children}</h1>;
                  },
                  h2({ children }) {
                    return <h2 className="text-base font-semibold mb-2 mt-3 text-white">{children}</h2>;
                  },
                  h3({ children }) {
                    return <h3 className="text-sm font-semibold mb-1 mt-2 text-white">{children}</h3>;
                  },
                  blockquote({ children }) {
                    return (
                      <blockquote className="border-l-2 border-white/45 pl-3 italic text-white/90 my-2">
                        {children}
                      </blockquote>
                    );
                  },
                  table({ children }) {
                    return (
                      <div className="overflow-x-auto my-3">
                        <table className="w-full text-xs border-collapse border border-line-med">
                          {children}
                        </table>
                      </div>
                    );
                  },
                  th({ children }) {
                    return (
                      <th className="border border-line-med bg-line-light px-3 py-1.5 text-left font-medium">
                        {children}
                      </th>
                    );
                  },
                  td({ children }) {
                    return (
                      <td className="border border-line-med px-3 py-1.5">{children}</td>
                    );
                  },
                }}
              >
                {stripToolXml(message.content)}
              </ReactMarkdown>
            </div>
          )}
        </div>
        {!isUser && !isMinimal && delegation && (
          <DelegationCard delegation={delegation} />
        )}
        {!isUser && !isMinimal && (
          <div className="mt-2 flex items-center gap-1">
            <button
              onClick={() => void copyMessage()}
              className="inline-flex items-center rounded p-1 transition-colors text-text-dark hover:text-text-med hover:bg-line-med"
              title={copied ? "Copied" : "Copy message"}
              aria-label={copied ? "Copied" : "Copy message"}
            >
              {copied ? <Check size={12} /> : <Copy size={12} />}
            </button>
            {!isStreaming && (
            <>
              <button
                onClick={addToNote}
                className="inline-flex items-center rounded p-1 transition-colors text-text-dark hover:text-text-med hover:bg-line-med"
                title={noteAdded ? "Added to notes" : "Add to notes"}
                aria-label={noteAdded ? "Added to notes" : "Add to notes"}
              >
                {noteAdded ? <Check size={12} /> : <NotebookPen size={12} />}
              </button>
              <button
                onClick={() => void branchToNewChat()}
                className="inline-flex items-center rounded p-1 transition-colors text-text-dark hover:text-text-med hover:bg-line-med"
                title={branched ? "Branched" : "Branch to new chat"}
                aria-label={branched ? "Branched" : "Branch to new chat"}
              >
                {branched ? <Check size={12} /> : <GitBranchPlus size={12} />}
              </button>
              <button
                onClick={() => void regenerateLastPrompt()}
                className="inline-flex items-center rounded p-1 transition-colors text-text-dark hover:text-text-med hover:bg-line-med"
                title={regenerated ? "Regenerated" : "Regenerate last prompt"}
                aria-label={regenerated ? "Regenerated" : "Regenerate last prompt"}
              >
                {regenerated ? <Check size={12} /> : <RefreshCw size={12} />}
              </button>
            </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export const MessageItem = memo(MessageItemInner);
