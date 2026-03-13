export const CHAT_DISPATCH_EVENT = "arx:chat-dispatch";

export interface ChatDispatchPayload {
  content: string;
  source?: string;
}

type ChatDispatchHandler = (payload: ChatDispatchPayload) => void | Promise<void>;

let activeHandler: ChatDispatchHandler | null = null;

export function registerChatDispatchHandler(handler: ChatDispatchHandler | null): void {
  activeHandler = handler;
}

export function dispatchChatMessage(payload: ChatDispatchPayload): { delivered: boolean; route: "handler" | "event" } {
  if (activeHandler) {
    void activeHandler(payload);
    return { delivered: true, route: "handler" };
  }
  if (typeof window === "undefined") {
    return { delivered: false, route: "event" };
  }
  window.dispatchEvent(new CustomEvent<ChatDispatchPayload>(CHAT_DISPATCH_EVENT, { detail: payload }));
  return { delivered: false, route: "event" };
}
