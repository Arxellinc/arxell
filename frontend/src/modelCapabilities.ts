import type { ApiConnectionRecord } from "./contracts";

export interface ChatModelCapabilities {
  text: boolean;
  inlineTextAttachments: boolean;
  imageUnderstanding: boolean;
  imageAttachmentsEnabled: boolean;
  audioUnderstanding: boolean;
  toolUse: boolean;
  reasoningControl: boolean;
}

export interface ChatModelProfile {
  id: string;
  label: string;
  source: "api" | "primary";
  capabilities: ChatModelCapabilities;
}

export function resolveActiveChatModelProfile(apiConnections: ApiConnectionRecord[]): ChatModelProfile {
  const verifiedLlm = apiConnections
    .filter((record) => record.apiType === "llm" && record.status === "verified")
    .sort((a, b) => {
      const aName = (a.name || "").toLowerCase();
      const bName = (b.name || "").toLowerCase();
      return aName.localeCompare(bName) || a.id.localeCompare(b.id);
    })[0];

  if (verifiedLlm) {
    const label = (verifiedLlm.modelName || verifiedLlm.name || verifiedLlm.id).trim() || "api-model";
    return {
      id: `api:${verifiedLlm.id}`,
      label,
      source: "api",
      capabilities: inferChatModelCapabilities(label)
    };
  }

  const fallback = "local-model";
  return {
    id: "primary-agent",
    label: fallback,
    source: "primary",
    capabilities: inferChatModelCapabilities(fallback)
  };
}

export function inferChatModelCapabilities(modelNameOrId: string): ChatModelCapabilities {
  const lower = modelNameOrId.trim().toLowerCase();
  const imageUnderstanding =
    includesAny(lower, [
      "gpt-4.1",
      "gpt-4o",
      "omni",
      "vision",
      "gemini",
      "claude-3",
      "claude-4",
      "llava",
      "minicpm-v"
    ]) && !includesAny(lower, ["text-only", "instruct-only"]);
  const audioUnderstanding = includesAny(lower, [
    "audio",
    "realtime",
    "whisper",
    "gpt-4o",
    "omni"
  ]);
  const reasoningControl = includesAny(lower, ["gpt-5", "o1", "o3", "o4", "reason"]);

  return {
    text: true,
    inlineTextAttachments: true,
    imageUnderstanding,
    imageAttachmentsEnabled: imageUnderstanding,
    audioUnderstanding,
    toolUse: true,
    reasoningControl
  };
}

function includesAny(haystack: string, needles: string[]): boolean {
  return needles.some((needle) => haystack.includes(needle));
}
