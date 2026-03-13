import { CheckCircle2, Copy, ExternalLink, Terminal, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useToolPanelStore } from "../store/toolPanelStore";

interface NpuSetupModalProps {
  open: boolean;
  onClose: () => void;
}

type CopyState = "idle" | "copied" | "error";

interface CommandBlockProps {
  title: string;
  command: string;
  note?: string;
}

function CommandBlock({ title, command, note }: CommandBlockProps) {
  const [copyState, setCopyState] = useState<CopyState>("idle");

  const copyCommand = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopyState("copied");
    } catch {
      setCopyState("error");
    } finally {
      setTimeout(() => setCopyState("idle"), 1200);
    }
  };

  return (
    <div className="rounded-lg border border-line-med bg-black/20 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-[11px] font-medium uppercase tracking-wide text-text-med">{title}</p>
        <button
          onClick={() => void copyCommand()}
          className="inline-flex items-center gap-1 rounded border border-line-med px-2 py-1 text-[10px] text-text-med hover:bg-line-med hover:text-text-norm"
          title="Copy command"
        >
          {copyState === "copied" ? <CheckCircle2 size={11} /> : <Copy size={11} />}
          {copyState === "copied" ? "Copied" : copyState === "error" ? "Copy failed" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto rounded border border-line-light bg-black/35 px-2 py-1.5 text-[11px] leading-4 text-accent-green/90">
        <code>{command}</code>
      </pre>
      {note ? <p className="mt-2 text-[10px] text-text-dark">{note}</p> : null}
    </div>
  );
}

async function openExternalUrl(url: string) {
  try {
    const { open } = await import("@tauri-apps/plugin-shell");
    await open(url);
  } catch {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

export function NpuSetupModal({ open, onClose }: NpuSetupModalProps) {
  const guideUrl = useMemo(() => "https://lemonade-server.ai/flm_npu_linux.html", []);
  const setPanel = useToolPanelStore((s) => s.setPanel);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[96] flex items-center justify-center bg-black/70 px-4 py-6 backdrop-blur-sm"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-3xl overflow-hidden rounded-2xl border border-line-dark bg-bg-light shadow-2xl">
        <div className="flex items-center justify-between border-b border-line-med px-5 py-4">
          <div>
            <h3 className="text-sm font-semibold text-text-norm">Linux NPU Setup Helper</h3>
            <p className="text-[11px] text-text-med">FastFlowLM + AMD XDNA setup for continuous STT offload</p>
          </div>
          <button onClick={onClose} className="rounded p-1 text-text-med hover:bg-line-med hover:text-text-norm">
            <X size={15} />
          </button>
        </div>

        <div className="max-h-[70vh] space-y-4 overflow-auto px-5 py-4">
          <div className="rounded-lg border border-accent-gold/20 bg-accent-gold/[0.08] p-3 text-[11px] text-accent-gold/85">
            Run these commands in the Terminal panel with `sudo` privileges. Two reboot steps are required.
          </div>

          <section className="space-y-2">
            <p className="text-[12px] font-medium text-text-norm">Ubuntu 24.04 / 25.10</p>
            <CommandBlock
              title="1. Add AMD XRT PPA"
              command={["sudo add-apt-repository ppa:amd-team/xrt", "sudo apt update"].join("\n")}
              note="Required prerequisite for AMD NPU/XDNA userspace stack."
            />
            <CommandBlock
              title="2. Install XRT + NPU Drivers"
              command="sudo apt install libxrt-npu2 amdxdna-dkms"
            />
            <CommandBlock title="3. Reboot" command="sudo reboot" />
            <CommandBlock
              title="4. Install FastFlowLM"
              command="sudo apt install ./fastflowlm*.deb"
              note="Run from the directory containing the downloaded .deb."
            />
            <CommandBlock
              title="5. Validate memlock"
              command="ulimit -l"
              note="If not 'unlimited', set soft/hard memlock unlimited in /etc/security/limits.conf, then reboot."
            />
          </section>

          <section className="space-y-2 rounded-lg border border-line-med bg-black/20 p-3">
            <p className="text-[12px] font-medium text-text-norm">Ubuntu 26.04, Arch, and other distros</p>
            <p className="text-[11px] text-text-med">
              Follow the FastFlowLM Linux NPU guide for distro-specific package and driver steps.
            </p>
            <button
              onClick={() => void openExternalUrl(guideUrl)}
              className="inline-flex items-center gap-1 rounded border border-line-med px-2.5 py-1.5 text-[11px] text-text-med hover:bg-line-med hover:text-text-norm"
            >
              <ExternalLink size={12} />
              Open FLM NPU Linux Guide
            </button>
          </section>

          <section className="space-y-2 rounded-lg border border-line-med bg-black/20 p-3">
            <p className="text-[12px] font-medium text-text-norm">Post-Install Checks</p>
            <CommandBlock title="Driver module" command="lsmod | grep amdxdna" />
            <CommandBlock title="FastFlowLM validator" command="flm validate" />
          </section>
        </div>

        <div className="flex items-center justify-between border-t border-line-med px-5 py-3">
          <p className="text-[10px] text-text-dark">After validation, configure STT endpoint to your FLM transcription service.</p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setPanel("terminal");
                onClose();
              }}
              className="inline-flex items-center gap-1 rounded border border-line-med px-2.5 py-1.5 text-[11px] text-text-med hover:bg-line-med hover:text-text-norm"
            >
              <Terminal size={12} />
              Open Terminal
            </button>
            <button
              onClick={onClose}
              className="inline-flex items-center gap-1 rounded border border-line-med px-2.5 py-1.5 text-[11px] text-text-med hover:bg-line-med hover:text-text-norm"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
