import { useEffect, useState } from "react";
import { TerminalToolPanel } from "./TerminalToolPanel";
import { PI_START_COMMAND } from "../../../lib/piBootstrap";
import { settingsGet } from "../../../lib/tauri";

function normalizePiModel(modelRaw: string): string {
  const model = modelRaw.trim();
  if (!model) return "";
  const lowered = model.toLowerCase();
  if (
    lowered === "default" ||
    lowered === "auto" ||
    lowered === "openai/default" ||
    lowered === "openai/auto"
  ) {
    return "";
  }
  return model;
}

export function PiToolPanel() {
  const [sessionModel, setSessionModel] = useState<string>("default");

  useEffect(() => {
    let active = true;

    const refresh = async () => {
      const coderModel = normalizePiModel((await settingsGet("coder_model"))?.trim() || "");
      const globalModel = normalizePiModel((await settingsGet("model"))?.trim() || "");
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
      toolId="pi"
      title={
        <>
          Pi
          <span className="ml-4 text-text-dark">({sessionModel})</span>
        </>
      }
      startupCommand={PI_START_COMMAND}
      readinessCheck={(output) => {
        const text = output.toLowerCase();
        return (
          text.includes(" pi v") ||
          text.includes("escape to interrupt") ||
          text.includes("[context]") ||
          text.includes("ctrl+c twice to exit")
        );
      }}
    />
  );
}
