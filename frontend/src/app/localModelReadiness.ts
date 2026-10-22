export const LOCAL_MODEL_READY_TIMEOUT_MS = 45_000;

interface LocalModelReadinessDeps {
  refresh: () => Promise<void>;
  isReady: () => boolean;
  isCurrent: () => boolean;
}

/** Wait before sending chat, never by resubmitting a message to persistence.
 * The deadline/cancellation checks also bound a hung status refresh. An IPC
 * refresh already in flight cannot be aborted, but cannot restart polling or
 * dispatch a message after this wait settles.
 */
export function waitForLocalModelReadiness(
  deps: LocalModelReadinessDeps,
  timeoutMs = LOCAL_MODEL_READY_TIMEOUT_MS,
  pollIntervalMs = 1000
): Promise<boolean> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    const deadlineTimer = setTimeout(() => finish(false), timeoutMs);
    const cancellationTimer = setInterval(() => {
      if (!deps.isCurrent()) finish(false);
    }, 50);

    function cleanup(): boolean {
      if (settled) return false;
      settled = true;
      clearTimeout(deadlineTimer);
      clearTimeout(pollTimer);
      clearInterval(cancellationTimer);
      return true;
    }
    function finish(ready: boolean): void {
      if (cleanup()) resolve(ready);
    }
    async function poll(): Promise<void> {
      if (settled) return;
      try {
        if (!deps.isCurrent()) return finish(false);
        await deps.refresh();
        if (settled) return;
        if (!deps.isCurrent()) return finish(false);
        if (deps.isReady()) return finish(true);
        pollTimer = setTimeout(() => { void poll(); }, pollIntervalMs);
      } catch (error) {
        if (cleanup()) reject(error);
      }
    }
    void poll();
  });
}
