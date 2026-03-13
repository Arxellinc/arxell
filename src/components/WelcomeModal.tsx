import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AlertTriangle, Cable, Download, Loader2, Rocket, Sparkles } from "lucide-react";
import { llmModelAdd } from "../core/tooling/client";

interface WelcomeModalProps {
  open: boolean;
  initialDoNotShow: boolean;
  onDismiss: (doNotShowAgain: boolean) => void;
  onOpenModelSetup: () => void;
  onOpenPremiumTools: () => void;
  onOpenCommercialLicense: () => void;
}

interface WelcomeModelOption {
  id: string;
  name: string;
  size: string;
  description: string;
  download:
    | {
        type: "asset";
        repoId: string;
        fileName: string;
      }
    | {
        type: "query";
        query: string;
      }
    | {
        type: "custom";
      };
}

const WELCOME_MODEL_OPTIONS: WelcomeModelOption[] = [
  {
    id: "qwen35-2b",
    name: "Qwen3.5 2B",
    size: "~2 GB",
    description: "Fastest startup option for lower-end hardware and responsive voice mode.",
    download: {
      type: "query",
      query: "Qwen3.5 2B Instruct GGUF Q4",
    },
  },
  {
    id: "qwen35-4b",
    name: "Qwen3.5 4B",
    size: "~4 GB",
    description: "Balanced baseline model for everyday chat and tool-assisted tasks.",
    download: {
      type: "asset",
      repoId: "unsloth/Qwen3.5-4B-GGUF",
      fileName: "Q4_K_M",
    },
  },
  {
    id: "gpt-oss-20b",
    name: "GPT-OSS 20B",
    size: "~13 GB",
    description: "Higher quality output with slower voice-turn responsiveness on most systems.",
    download: {
      type: "asset",
      repoId: "Arxell/gpt-oss-20b-MXFP4",
      fileName: "gpt-oss-20b-MXFP4.gguf",
    },
  },
  {
    id: "custom-endpoint",
    name: "Use Custom Endpoint",
    size: "External",
    description: "Use your own API endpoint by providing URL, model name, and API key.",
    download: {
      type: "custom",
    },
  },
];

function normalizeApiBaseUrl(value: string): string {
  let root = value.trim().replace(/\/+$/, "");
  root = root
    .replace(/\/chat\/completions$/i, "")
    .replace(/\/completions$/i, "")
    .replace(/\/responses$/i, "")
    .replace(/\/models$/i, "")
    .replace(/\/+$/, "");
  if (!root) return "";
  if (!/^https?:\/\//i.test(root)) root = `https://${root}`;
  const nestedVersionMatch = root.match(/^(.*\/v\d+)\/v1$/i);
  if (nestedVersionMatch) root = nestedVersionMatch[1];
  if (/\/v\d+$/i.test(root)) return root;
  if (root.toLowerCase().endsWith("/v1")) return root;
  return `${root}/v1`;
}

async function openExternalUrl(url: string) {
  try {
    const { open } = await import("@tauri-apps/plugin-shell");
    await open(url);
  } catch {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

export function WelcomeModal({
  open,
  initialDoNotShow,
  onDismiss,
  onOpenModelSetup,
  onOpenPremiumTools,
  onOpenCommercialLicense,
}: WelcomeModalProps) {
  const [doNotShowAgain, setDoNotShowAgain] = useState(initialDoNotShow);
  const [step, setStep] = useState<0 | 1>(0);
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [selectedModelId, setSelectedModelId] = useState(WELCOME_MODEL_OPTIONS[0].id);
  const [customEndpointUrl, setCustomEndpointUrl] = useState("https://openrouter.ai/api/v1");
  const [customModelName, setCustomModelName] = useState("");
  const [customApiKey, setCustomApiKey] = useState("");
  const [downloadInProgress, setDownloadInProgress] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const termsUrl = useMemo(() => "https://arxell.com/terms.html", []);

  useEffect(() => {
    setDoNotShowAgain(initialDoNotShow);
    if (open) {
      setStep(0);
      setAgreedToTerms(false);
      setSelectedModelId(WELCOME_MODEL_OPTIONS[0].id);
      setCustomEndpointUrl("https://openrouter.ai/api/v1");
      setCustomModelName("");
      setCustomApiKey("");
      setDownloadInProgress(false);
      setDownloadError(null);
    }
  }, [initialDoNotShow, open]);

  if (!open) return null;

  const selectedModel = WELCOME_MODEL_OPTIONS.find((model) => model.id === selectedModelId) ?? WELCOME_MODEL_OPTIONS[0];
  const customOptionSelected = selectedModel.download.type === "custom";
  const customReady =
    normalizeApiBaseUrl(customEndpointUrl).length > 0 && customModelName.trim().length > 0;

  const handleDownloadAndContinue = async () => {
    if (downloadInProgress) return;
    setDownloadError(null);
    setDownloadInProgress(true);
    try {
      if (selectedModel.download.type === "custom") {
        const endpoint = normalizeApiBaseUrl(customEndpointUrl);
        const modelName = customModelName.trim();
        if (!endpoint || !modelName) {
          throw new Error("Please provide endpoint URL and model name.");
        }
        await llmModelAdd({
          name: modelName,
          model_id: modelName,
          base_url: endpoint,
          api_key: customApiKey.trim(),
          api_type: "chat",
          is_primary: true,
        });
      } else if (selectedModel.download.type === "asset") {
        await invoke("cmd_download_model_from_hf_asset", {
          repoId: selectedModel.download.repoId,
          fileName: selectedModel.download.fileName,
        });
      } else {
        await invoke("cmd_download_model_from_hf_query", {
          query: selectedModel.download.query,
        });
      }
      onOpenModelSetup();
      onDismiss(doNotShowAgain);
    } catch (error) {
      setDownloadError(String(error));
    } finally {
      setDownloadInProgress(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[95] flex items-center justify-center bg-black/70 px-4 py-6 backdrop-blur-sm"
    >
      <div className="w-full max-w-3xl overflow-hidden rounded-2xl border border-line-dark bg-bg-light shadow-2xl">
        {step === 0 ? (
          <>
            <div className="space-y-4 px-5 py-5">
              <div className="space-y-2 text-center">
                <p className="inline-flex items-center gap-2 mt-4 text-sm font-semibold text-text-norm">
                  <Sparkles size={15} className="text-accent-primary/90" />
                  Welcome to Arxell
                </p><p>&nbsp;</p>
                <p className="text-xs text-text-med">
                  Arxell is your local-first open-source AI workstation for learning, building, shipping, and problem-solving with real tools.
                </p>
                <p className="text-xs text-text-med">
                  In case you were wondering,{" "}
                  <button
                    onClick={() => void openExternalUrl("https://en.wikipedia.org/wiki/Arx_(Roman)")}
                    className="text-accent-primary underline underline-offset-2 hover:text-accent-primary"
                  >
                    Arx
                  </button>{" "}
                  is Latin for citadel, stronghold, and sovereign outpost, and this is what we strive to be. Please be aware that Arxell is under active development and not all tools will are fully functional. Please report bugs on Github.
                </p>
              </div>

              <div className="flex items-start gap-2 text-accent-gold/85">
                <AlertTriangle className="mt-0.5 text-accent-gold/90" size={16} />
                <div>
                  <p className="text-[11px]">
                    This software is experimental, provided with no guarantees, and you are responsible for useing the integrated guardrails.
                  </p>
                </div>
              </div>

              <div className="pl-4">
                <p className="mb-2 inline-flex items-center gap-2 text-[12px] font-medium text-text-norm">
                  <Rocket size={14} className="text-accent-green/90" />
                  Quick Setup (Please read)
                </p>
                <ol className="list-decimal space-y-1 pl-4 text-[12px] text-text-med">
                  <li>Arxell works best with at at least one small local model. Please select and download one on the next screen that fits comfortably in your vram or system ram. </li>
                  <li>You can and should add additional API endpoints in the API tools panel for search and text-generation. We recommend a free serper.dev account for API-search and Openrouter.com for LLM API's where you can usually find several free options like GLM Air.</li>
                  <li>Guard rail policies are available in most tools and in settings. We recommend using them. Run a short prompt and confirm output before using autonomous workflows.</li>
                  <li>The different agent 'Modes' selectable the top of the Chat Panel (Voice, Chat, Tools, And Full-auto) offer increasing levels of context, tool use, autonomy and latency. Use accordingly.  </li>
                </ol>
              </div>

              <div className="text-[12px] text-text-med">
                <p>
                  Arxell is open-source under GPLv3 and built by an independent developer. Please show your support by contributing, buying a premium tool or paying for the commercial license when appropriate.
        
                  Personal use is free. Commercial use requires a valid license. Please review the{" "}
                  <button
                    onClick={() => void openExternalUrl(termsUrl)}
                    className="text-accent-primary underline underline-offset-2 hover:text-accent-primary"
                  >
                    Terms
                  </button>
                  .
                </p>
                <p>&nbsp;
                </p>
                <div className="mt-2 mx-auto flex w-fit flex-wrap items-center justify-center gap-3">
                  <div className="rounded-lg border border-line-dark bg-black/20 px-3 py-2">
                    <label className="flex items-center justify-center gap-2 text-[12px] text-text-med">
                      <input
                        type="checkbox"
                        checked={agreedToTerms}
                        onChange={(event) => setAgreedToTerms(event.target.checked)}
                        className="h-4 w-4"
                      />
                      <span>I have read and agree to the terms of use</span>
                    </label>
                  </div>
                  <button
                    onClick={() => {
                      onOpenCommercialLicense();
                      onDismiss(doNotShowAgain);
                    }}
                    className="rounded border border-line-dark px-2.5 py-1.5 text-[11px] text-text-norm hover:bg-line-med"
                  >
                     Get Commercial License 
                  </button>
                </div>
              </div>
            </div>

            <div className="border-t border-line-med px-5 py-4">
              <div className="flex items-center justify-between gap-3">
                <button
                  onClick={() => onDismiss(doNotShowAgain)}
                  disabled={!agreedToTerms}
                  className="rounded border border-line-dark px-3 py-1.5 text-[11px] font-medium text-text-med hover:bg-line-med disabled:cursor-not-allowed disabled:border-line-med disabled:bg-line-med disabled:text-text-dim disabled:hover:bg-line-med"
                >
                  Skip Setup
                </button>
                <button
                  onClick={() => setStep(1)}
                  disabled={!agreedToTerms}
                  className="rounded bg-accent-green px-3 py-1.5 text-[11px] font-medium text-black hover:brightness-110 disabled:cursor-not-allowed disabled:bg-line-med disabled:text-text-dim disabled:hover:brightness-100"
                >
                  next
                </button>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="space-y-4 px-5 py-5">
              <div className="space-y-2 text-center">
                <p className="inline-flex items-center gap-2 text-sm font-semibold text-text-norm">
                  <Download size={15} className="text-accent-primary/90" />
                  Choose Primary Agent Model
                </p>
                <p className="text-xs text-text-med">
                  Arxell needs a primary local model to answer prompts. You can change this any time in the Model Server panel.
                </p>
                <p className="text-xs text-text-med">
                  Larger models and larger context windows improve quality but increase prefill latency and make voice mode less responsive.
                </p>
              </div>

              <div className="space-y-2">
                {WELCOME_MODEL_OPTIONS.map((model) => (
                  <label
                    key={model.id}
                    className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2 text-left transition-colors ${
                      selectedModelId === model.id
                        ? "border-accent-primary/70 bg-accent-primary/10"
                        : "border-line-dark hover:bg-line-med"
                    }`}
                  >
                    <input
                      type="radio"
                      className="mt-1"
                      name="welcome-primary-model"
                      checked={selectedModelId === model.id}
                      onChange={() => setSelectedModelId(model.id)}
                    />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-[12px] font-medium text-text-norm">{model.name}</p>
                        <span className="rounded border border-line-dark px-1.5 py-0.5 text-[10px] text-text-med">{model.size}</span>
                      </div>
                      <p className="mt-1 text-[11px] text-text-med">{model.description}</p>
                    </div>
                  </label>
                ))}
              </div>

              {customOptionSelected && (
                <div className="rounded-lg border border-line-dark bg-line-light p-3 space-y-2">
                  <div className="text-[11px] text-text-med">Custom Endpoint Configuration</div>
                  <input
                    type="text"
                    value={customEndpointUrl}
                    onChange={(e) => setCustomEndpointUrl(e.target.value)}
                    className="w-full px-2 py-1.5 bg-line-light border border-line-med rounded text-xs text-text-norm outline-none focus:border-accent-primary/50"
                    placeholder="API endpoint URL (e.g. https://openrouter.ai/api/v1)"
                  />
                  <input
                    type="text"
                    value={customModelName}
                    onChange={(e) => setCustomModelName(e.target.value)}
                    className="w-full px-2 py-1.5 bg-line-light border border-line-med rounded text-xs text-text-norm outline-none focus:border-accent-primary/50"
                    placeholder="Model name (e.g. google/gemma-3-27b-it:free)"
                  />
                  <input
                    type="password"
                    value={customApiKey}
                    onChange={(e) => setCustomApiKey(e.target.value)}
                    className="w-full px-2 py-1.5 bg-line-light border border-line-med rounded text-xs text-text-norm outline-none focus:border-accent-primary/50"
                    placeholder="API key"
                  />
                </div>
              )}

              {downloadError && (
                <p className="rounded border border-red-500/40 bg-red-500/10 px-2.5 py-2 text-[11px] text-red-200">
                  Download failed: {downloadError}
                </p>
              )}
            </div>

            <div className="border-t border-line-med px-5 py-4">
              <div className="flex items-center justify-between gap-3">
                <label className="inline-flex items-center gap-2 text-[11px] text-text-med">
                  <input
                    type="checkbox"
                    checked={doNotShowAgain}
                    onChange={(event) => setDoNotShowAgain(event.target.checked)}
                  />
                  Do not show this message again
                </label>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setStep(0)}
                    disabled={downloadInProgress}
                    className="rounded border border-line-dark px-3 py-1.5 text-[11px] font-medium text-text-med hover:bg-line-med disabled:opacity-50"
                  >
                    Back
                  </button>
                  <button
                    onClick={() => onDismiss(doNotShowAgain)}
                    disabled={downloadInProgress}
                    className="rounded border border-line-dark px-3 py-1.5 text-[11px] font-medium text-text-med hover:bg-line-med disabled:opacity-50"
                  >
                    Skip For Now
                  </button>
                  <button
                    onClick={() => void handleDownloadAndContinue()}
                    disabled={downloadInProgress || (customOptionSelected && !customReady)}
                    className="inline-flex items-center gap-1 rounded bg-accent-green/25 px-3 py-1.5 text-[11px] font-medium text-accent-green hover:bg-accent-green/35 disabled:opacity-60"
                  >
                    {downloadInProgress ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                    {downloadInProgress
                      ? customOptionSelected
                        ? "Saving..."
                        : "Downloading..."
                      : customOptionSelected
                      ? "Save + Continue"
                      : "Download + Continue"}
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
