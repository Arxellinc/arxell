import type { ChatAttachment } from "../contracts.js";
import { createSendMessageHandler } from "./chatSend.js";

type SendMessage = (text: string, attachments?: ChatAttachment[]) => Promise<void>;

export function initializeSendMessageBinding(
  deps: Parameters<typeof createSendMessageHandler>[0],
  setRenderSendMessageRef: (sendMessage: SendMessage) => void
): SendMessage {
  const sendMessage = createSendMessageHandler(deps);
  setRenderSendMessageRef(sendMessage);
  return sendMessage;
}
