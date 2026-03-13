import { useChatStore } from "../../store/chatStore";
import { MessageItem } from "./MessageItem";
import { PresentationInputBar } from "./PresentationInputBar";

export function PresentationChatView() {
  const { messages, streamingMessage } = useChatStore();

  return (
    <div className="flex h-full min-h-0 flex-col bg-black">
      <div className="flex-1 min-h-0 overflow-y-auto px-2 py-6">
        {messages.length === 0 && !streamingMessage ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-white/45">Conversation will appear here.</p>
          </div>
        ) : null}

        {messages.map((msg) => (
          <MessageItem key={msg.id} message={msg} variant="minimal" />
        ))}

        {streamingMessage ? (
          <MessageItem
            key={streamingMessage.id}
            variant="minimal"
            message={{
              id: streamingMessage.id,
              role: "assistant",
              content: streamingMessage.content || "…",
              streaming: true,
            }}
          />
        ) : null}
      </div>
      <PresentationInputBar />
    </div>
  );
}
