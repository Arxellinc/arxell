import type { ToolManifest } from "../types";

export const llmToolManifest: ToolManifest = {
  id: "llm",
  version: "1.0.0",
  title: "LLM",
  description: "Model inference and runtime controls",
  category: "models",
  core: false,
  defaultEnabled: true,
  source: "builtin",
  icon: "cpu"
};
