import type { AppResourceUsageResponse } from "../contracts";

interface AppResourceClient {
  getAppResourceUsage(request: { correlationId: string }): Promise<AppResourceUsageResponse>;
}

interface AppResourcePollingDeps {
  getClient: () => AppResourceClient | null;
  isRuntimeTauri: () => boolean;
  isAnyVisible: () => boolean;
  nextCorrelationId: () => string;
  applySnapshot: (snapshot: AppResourceUsageResponse) => void;
  hasSnapshotChanged: () => boolean;
  shouldSkipRender: () => boolean;
  onRenderNeeded: () => void;
}

export function createAppResourcePolling(deps: AppResourcePollingDeps) {
  let timerId: number | null = null;
  let busy = false;

  const stop = (): void => {
    if (timerId !== null) {
      window.clearInterval(timerId);
      timerId = null;
    }
  };

  const pollOnce = async (): Promise<void> => {
    if (!deps.isRuntimeTauri() || !deps.isAnyVisible() || busy) return;
    const client = deps.getClient();
    if (!client) return;
    busy = true;
    try {
      const snapshot = await client.getAppResourceUsage({ correlationId: deps.nextCorrelationId() });
      deps.applySnapshot(snapshot);
      if (!deps.hasSnapshotChanged()) return;
      if (deps.shouldSkipRender()) return;
      deps.onRenderNeeded();
    } catch {
      // Keep stale values on transient sampling failures.
    } finally {
      busy = false;
    }
  };

  const restart = (intervalMs = 1000): void => {
    if (!deps.isRuntimeTauri() || !deps.isAnyVisible()) {
      stop();
      return;
    }
    stop();
    timerId = window.setInterval(() => {
      void pollOnce();
    }, intervalMs);
    void pollOnce();
  };

  return {
    stop,
    restart,
    pollOnce
  };
}
