import { useEffect, useState } from "react";
import { settingsGet } from "../../../lib/tauri";
import { TerminalToolPanel } from "./TerminalToolPanel";

function normalizeModel(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const lowered = trimmed.toLowerCase();
  if (
    lowered === "default" ||
    lowered === "auto" ||
    lowered === "openai/default" ||
    lowered === "openai/auto"
  ) {
    return "";
  }
  return trimmed;
}

export function CoderPanel() {
  const [sessionModel, setSessionModel] = useState<string>("default");

  useEffect(() => {
    let active = true;

    const refresh = async () => {
      const coderModel = normalizeModel((await settingsGet("coder_model")) ?? "");
      const globalModel = normalizeModel((await settingsGet("model")) ?? "");
      const next = coderModel || globalModel || "default";
      if (active) {
        setSessionModel(next);
      }
    };

    void refresh();
    const timer = window.setInterval(() => {
      void refresh();
    }, 2000);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  return (
    <TerminalToolPanel
      toolId="codex"
      title={
        <>
          Coder
          <span className="ml-4 text-text-dark">({sessionModel})</span>
        </>
      }
      readinessCheck={(output) => {
        const text = output.toLowerCase();
        return (
          text.includes("[stop_reason=") ||
          text.includes("tool-result") ||
          text.includes("[error]")
        );
      }}
    />
  );
}
