import { Computer, Monitor, Cpu, Database, Mic, Volume2, ChevronDown, ChevronUp, Usb, HardDrive, MemoryStick, Keyboard, Mouse, Camera } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useServeStore } from "../../../store/serveStore";
import { PanelWrapper, type DisplayInfo, type StorageDevice, type SystemIdentity } from "./shared";
import {
  systemGetDisplayInfo,
  systemGetIdentity,
  systemGetStorageDevices,
  systemListAudioDevices,
  systemListPeripheralDevices,
  type AudioDevices,
  type PeripheralDevice,
} from "../../../core/tooling/client";


export function NewProjectPanel() {
  const [displays, setDisplays] = useState<DisplayInfo[]>([]);
  const [audioDevices, setAudioDevices] = useState<AudioDevices | null>(null);
  const [peripherals, setPeripherals] = useState<PeripheralDevice[]>([]);
  const [storageDevices, setStorageDevices] = useState<StorageDevice[]>([]);
  const [identity, setIdentity] = useState<SystemIdentity | null>(null);
  const [showSystemJson, setShowSystemJson] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const { systemResources, fetchSystemResources } = useServeStore();

  useEffect(() => {
    let mounted = true;

    const refresh = async () => {
      await fetchSystemResources();
      try {
        const audio = await systemListAudioDevices();
        if (mounted) setAudioDevices(audio);
      } catch (e) {
        console.warn("Failed to load audio devices for system panel:", e);
      }
      try {
        const nextPeripherals = await systemListPeripheralDevices();
        if (mounted) setPeripherals(nextPeripherals);
      } catch (e) {
        console.warn("Failed to load peripheral devices for system panel:", e);
      }
      try {
        const disks = await systemGetStorageDevices();
        if (mounted) setStorageDevices(disks);
      } catch (e) {
        console.warn("Failed to load storage devices for system panel:", e);
      }
      try {
        const nextDisplays = await systemGetDisplayInfo();
        if (mounted) setDisplays(nextDisplays);
      } catch (e) {
        console.warn("Failed to load display info for system panel:", e);
      }
      try {
        const sysIdentity = await systemGetIdentity();
        if (mounted) setIdentity(sysIdentity);
      } catch (e) {
        console.warn("Failed to load system identity for system panel:", e);
      }
    };

    void refresh();
    const interval = setInterval(() => void refresh(), 5000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [fetchSystemResources]);

  const topologyJson = useMemo(
    () =>
      JSON.stringify(
        {
          updated_at: new Date().toISOString(),
          displays,
          monitors: { count: displays.length },
          identity,
          cpu: systemResources?.cpu ?? null,
          memory: systemResources?.memory ?? null,
          gpus: systemResources?.gpus ?? [],
          npus: systemResources?.npus ?? [],
          storage_devices: storageDevices,
          drivers: systemResources?.drivers ?? [],
          audio_devices: audioDevices
            ? {
                default_input: audioDevices.default_input,
                default_output: audioDevices.default_output,
                inputs: audioDevices.inputs,
                outputs: audioDevices.outputs,
              }
            : null,
        },
        null,
        2
      ),
    [audioDevices, displays, identity, storageDevices, systemResources]
  );

  const usbDevices = useMemo(() => {
    const inferred = new Set<string>();

    storageDevices
      .filter((disk) => disk.isRemovable)
      .forEach((disk) => {
        inferred.add(`${disk.name} (${disk.mountPoint || "removable storage"})`);
      });

    (audioDevices?.inputs ?? [])
      .filter((name) => /usb/i.test(name))
      .forEach((name) => inferred.add(`${name} (audio input)`));

    (audioDevices?.outputs ?? [])
      .filter((name) => /usb/i.test(name))
      .forEach((name) => inferred.add(`${name} (audio output)`));

    return Array.from(inferred);
  }, [audioDevices, storageDevices]);

  const keyboardDevices = useMemo(
    () => peripherals.filter((p) => p.kind === "keyboard").map((p) => p.name),
    [peripherals]
  );
  const mouseDevices = useMemo(
    () => peripherals.filter((p) => p.kind === "mouse").map((p) => p.name),
    [peripherals]
  );
  const otherInputDevices = useMemo(
    () => peripherals.filter((p) => p.kind === "input").map((p) => p.name),
    [peripherals]
  );
  const videoInputDevices = useMemo(
    () => peripherals.filter((p) => p.kind === "video").map((p) => p.name),
    [peripherals]
  );

  const audioInputDevices = useMemo(
    () => (audioDevices?.inputs ?? []).map((name) => `${name} (audio)`),
    [audioDevices?.inputs]
  );

  const copyJson = async () => {
    try {
      await navigator.clipboard.writeText(topologyJson);
      setCopyState("copied");
    } catch {
      setCopyState("error");
    } finally {
      setTimeout(() => setCopyState("idle"), 1200);
    }
  };

  return (
    <PanelWrapper title="System" icon={<Computer size={16} className="text-accent-primary" />}>
      <div className="flex flex-col h-full">
        <div className="flex-1 overflow-auto pt-4">
          <div className="px-4 grid grid-cols-3 gap-2">
            <div className="rounded border border-line-med bg-black/20 px-2.5 py-2">
              <div className="text-[10px] text-text-dark uppercase tracking-wide">OS / System</div>
              <div className="text-xs text-text-med mt-1 truncate" title={`${identity?.osName ?? "Unknown"} ${identity?.osVersion ?? ""}`}>
                {identity?.osName ?? "Unknown"} {identity?.osVersion ?? ""}
              </div>
              <div className="text-[10px] text-text-dark truncate" title={identity?.hostName ?? "-"}>
                {identity?.hostName ?? "-"}
              </div>
            </div>
            <div className="rounded border border-line-med bg-black/20 px-2.5 py-2">
              <div className="text-[10px] text-text-dark uppercase tracking-wide">CPU</div>
              <div className="text-xs text-text-med mt-1 truncate" title={identity?.cpuName ?? "-"}>
                {identity?.cpuName ?? "-"}
              </div>
              <div className="text-[10px] text-text-dark">
                {identity?.cpuPhysicalCores ?? "-"}C / {identity?.cpuLogicalCores ?? "-"}T ({identity?.cpuArch ?? "-"})
              </div>
            </div>
            <div className="rounded border border-line-med bg-black/20 px-2.5 py-2">
              <div className="text-[10px] text-text-dark uppercase tracking-wide">User</div>
              <div className="text-xs text-text-med mt-1 truncate">{identity?.userName ?? "-"}</div>
              <div className="text-[10px] text-text-dark">
                Uptime {Math.floor((identity?.uptimeSecs ?? 0) / 3600)}h
              </div>
            </div>
          </div>

          <div className="px-4 py-4">
            <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
              <div className="space-y-6">
                <section className="space-y-2">
                  <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-text-med">
                    <Keyboard size={14} className="text-accent-green" />
                    Keyboard Devices
                  </div>
                  {keyboardDevices.length === 0 ? (
                    <div className="text-xs text-text-dark">No keyboard devices</div>
                  ) : (
                    <div className="space-y-1">
                      {keyboardDevices.map((input) => (
                        <div key={input} className="text-xs text-text-med">{input}</div>
                      ))}
                    </div>
                  )}
                </section>

                <section className="space-y-2">
                  <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-text-med">
                    <Mouse size={14} className="text-accent-green" />
                    Mouse Devices
                  </div>
                  {mouseDevices.length === 0 ? (
                    <div className="text-xs text-text-dark">No mouse devices</div>
                  ) : (
                    <div className="space-y-1">
                      {mouseDevices.map((input) => (
                        <div key={input} className="text-xs text-text-med">{input}</div>
                      ))}
                    </div>
                  )}
                </section>

                <section className="space-y-2">
                  <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-text-med">
                    <Camera size={14} className="text-accent-primary" />
                    Video Input Devices
                  </div>
                  {videoInputDevices.length === 0 ? (
                    <div className="text-xs text-text-dark">No video input devices</div>
                  ) : (
                    <div className="space-y-1">
                      {videoInputDevices.map((device) => (
                        <div key={device} className="text-xs text-text-med">{device}</div>
                      ))}
                    </div>
                  )}
                </section>

                <section className="space-y-2">
                  <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-text-med">
                    <Mic size={14} className="text-accent-green" />
                    Audio Input Devices
                  </div>
                  {audioInputDevices.length === 0 ? (
                    <div className="text-xs text-text-dark">No audio input devices</div>
                  ) : (
                    <div className="space-y-1">
                      {audioInputDevices.map((input) => (
                        <div key={input} className="text-xs text-text-med">{input}</div>
                      ))}
                    </div>
                  )}
                </section>
              </div>

              <div className="space-y-6">
                <section className="space-y-2">
                  <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-text-med">
                    <MemoryStick size={14} className="text-accent-primary/70" />
                    System
                  </div>
                  <div className="space-y-1 text-xs text-text-med">
                    <div>{identity?.osName ?? "Unknown OS"} {identity?.osVersion ?? ""}</div>
                    <div>Host: {identity?.hostName ?? "-"}</div>
                    <div>User: {identity?.userName ?? "-"}</div>
                    <div>Memory: {systemResources ? `${(systemResources.memory.usedMb / 1024).toFixed(1)} / ${(systemResources.memory.totalMb / 1024).toFixed(1)} GB` : "-"}</div>
                  </div>
                </section>

                <section className="space-y-2">
                  <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-text-med">
                    <Mic size={14} className="text-accent-green" />
                    Other Input Devices
                  </div>
                  {otherInputDevices.length === 0 ? (
                    <div className="text-xs text-text-dark">No other input devices</div>
                  ) : (
                    <div className="space-y-1">
                      {otherInputDevices.map((input) => (
                        <div key={input} className="text-xs text-text-med">{input}</div>
                      ))}
                    </div>
                  )}
                </section>

                <section className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-text-med">
                      <Cpu size={14} className="text-accent-gold" />
                      Compute Devices
                    </div>
                  </div>
                  <div className="space-y-1 text-xs text-text-med">
                    <div>
                      CPU: {identity?.cpuName ?? systemResources?.cpu?.name ?? "Unknown"} ({identity?.cpuPhysicalCores ?? systemResources?.cpu?.physicalCores ?? "-"}C/{identity?.cpuLogicalCores ?? systemResources?.cpu?.logicalCores ?? "-"}T)
                    </div>
                    {(systemResources?.gpus ?? []).length === 0 ? (
                      <div className="text-text-dark">GPU: none detected</div>
                    ) : (
                      (systemResources?.gpus ?? []).map((gpu) => (
                        <div key={gpu.id}>GPU: {gpu.name} ({gpu.gpuType})</div>
                      ))
                    )}
                    {(systemResources?.npus ?? []).length === 0 ? (
                      <div className="text-text-dark">NPU: none detected</div>
                    ) : (
                      (systemResources?.npus ?? []).map((npu) => (
                        <div key={`${npu.npuType}-${npu.name}`}>NPU: {npu.name} ({npu.npuType})</div>
                      ))
                    )}
                  </div>
                </section>
              </div>

              <div className="space-y-6">
                <section className="space-y-2">
                  <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-text-med">
                    <Monitor size={14} className="text-accent-primary" />
                    Displays
                  </div>
                  {displays.length === 0 ? (
                    <div className="text-xs text-text-dark">No displays detected</div>
                  ) : (
                    <div className="space-y-1">
                      {displays.map((display, idx) => (
                        <div key={`${display.name ?? "display"}-${idx}`} className="text-xs text-text-med">
                          {display.name ?? `Display ${idx + 1}`} · {display.width}x{display.height}{display.isPrimary ? " · primary" : ""}
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                <section className="space-y-2">
                  <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-text-med">
                    <Volume2 size={14} className="text-accent-primary" />
                    Output Devices
                  </div>
                  {(audioDevices?.outputs ?? []).length === 0 ? (
                    <div className="text-xs text-text-dark">No audio outputs</div>
                  ) : (
                    <div className="space-y-1">
                      {(audioDevices?.outputs ?? []).map((output) => (
                        <div key={output} className="text-xs text-text-med">{output}</div>
                      ))}
                    </div>
                  )}
                </section>

                <section className="space-y-2">
                  <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-text-med">
                    <Usb size={14} className="text-accent-primary" />
                    USB Connected Devices
                  </div>
                  {usbDevices.length === 0 ? (
                    <div className="text-xs text-text-dark">No USB devices inferred</div>
                  ) : (
                    <div className="space-y-1">
                      {usbDevices.map((device) => (
                        <div key={device} className="text-xs text-text-med">{device}</div>
                      ))}
                    </div>
                  )}
                </section>
              </div>
            </div>
          </div>

          <div className="px-4 mt-1 pb-3">
            <div className="text-[10px] text-text-dark uppercase tracking-wide mb-1.5">
              Disks, Volumes, and Storage Devices
            </div>
            <div className="rounded border border-line-med bg-black/20 overflow-hidden">
              <div className="grid grid-cols-[1.4fr_1fr_0.8fr_1fr_0.8fr] gap-2 px-2.5 py-2 text-[10px] text-text-dark uppercase tracking-wide border-b border-line-med">
                <span>Device / Volume</span>
                <span>Mount</span>
                <span>Type</span>
                <span>Used / Total</span>
                <span>Usage</span>
              </div>
              <div className="max-h-40 overflow-auto">
                {storageDevices.length === 0 ? (
                  <div className="px-2.5 py-2 text-xs text-text-dark">No storage devices detected</div>
                ) : (
                  storageDevices.map((disk) => (
                    <div
                      key={`${disk.name}-${disk.mountPoint}`}
                      className="grid grid-cols-[1.4fr_1fr_0.8fr_1fr_0.8fr] gap-2 px-2.5 py-2 text-[11px] border-b border-line-light last:border-b-0"
                    >
                      <span className="text-text-med truncate" title={disk.name}>{disk.name}</span>
                      <span className="text-text-dark truncate" title={disk.mountPoint}>{disk.mountPoint}</span>
                      <span className="text-text-dark">{disk.kind || disk.fileSystem || "-"}</span>
                      <span className="text-text-med">
                        {(disk.usedMb / 1024).toFixed(1)}GB / {(disk.totalMb / 1024).toFixed(1)}GB
                      </span>
                      <span className="text-text-med">{disk.usagePercent.toFixed(0)}%</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="mt-auto border-t border-line-light bg-black/20">
          <div className="flex items-center justify-between px-3 py-1.5">
            <button
              onClick={() => setShowSystemJson((v) => !v)}
              className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-text-med hover:text-text-norm transition-colors"
              title="Toggle system JSON"
            >
              {showSystemJson ? <ChevronDown size={11} /> : <ChevronUp size={11} />}
              System JSON
            </button>
            <button
              onClick={() => void copyJson()}
              className="px-1.5 py-0.5 rounded text-[10px] bg-line-med text-text-med hover:text-text-norm hover:bg-line-dark transition-colors"
            >
              {copyState === "copied" ? "Copied" : copyState === "error" ? "Copy failed" : "Copy"}
            </button>
          </div>
          {showSystemJson && (
            <pre className="mx-2 mb-2 max-h-24 overflow-auto rounded bg-black/30 p-2 text-[10px] leading-4 text-accent-green/90">
              {topologyJson}
            </pre>
          )}
        </div>
      </div>
    </PanelWrapper>
  );
}
