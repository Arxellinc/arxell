import { useEffect, useRef } from "react";
import { useChatStore } from "../../store/chatStore";
import { MessageItem } from "./MessageItem";
import { MessageSquarePlus } from "lucide-react";

export function MessageList() {
  const { messages, streamingMessage, isStreaming } = useChatStore();
  const bottomRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const scrollRaf = useRef<number | null>(null);

  useEffect(() => {
    if (scrollRaf.current !== null) {
      cancelAnimationFrame(scrollRaf.current);
    }
    scrollRaf.current = requestAnimationFrame(() => {
      const list = listRef.current;
      if (list) {
        list.scrollTo({
          top: list.scrollHeight,
          behavior: streamingMessage ? "auto" : "smooth",
        });
      } else {
        bottomRef.current?.scrollIntoView({
          behavior: streamingMessage ? "auto" : "smooth",
          block: "end",
        });
      }
      scrollRaf.current = null;
    });

    return () => {
      if (scrollRaf.current !== null) {
        cancelAnimationFrame(scrollRaf.current);
        scrollRaf.current = null;
      }
    };
  }, [messages.length, streamingMessage?.content]);

  if (messages.length === 0 && !isStreaming) {
    return (
      <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-3 text-center px-8">
        <MessageSquarePlus size={32} className="text-text-dark" />
        <p className="text-sm text-text-dark">
          Start a conversation
        </p>
        <p className="text-xs text-text-dark max-w-xs">
          Type a message or click the mic button to use voice input
        </p>
      </div>
    );
  }

  return (
    <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto overscroll-contain py-2">
      {messages.map((msg) => (
        <MessageItem key={msg.id} message={msg} />
      ))}
      {streamingMessage && (
        <MessageItem
          key={streamingMessage.id}
          message={{
            id: streamingMessage.id,
            role: "assistant",
            content: streamingMessage.content || "…",
            streaming: true,
          }}
        />
      )}
      <div ref={bottomRef} />
    </div>
  );
}
