const FORCE_LOCAL_MODE_KEY = "arx_force_local_mode";

function readLocalModeOverride(): boolean {
  try {
    const value = window.localStorage.getItem(FORCE_LOCAL_MODE_KEY);
    return value === "1" || value === "true";
  } catch {
    return false;
  }
}

function readQueryLocalMode(): boolean {
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get("localMode") === "1";
  } catch {
    return false;
  }
}

export function forceEnableLocalMode(): void {
  try {
    window.localStorage.setItem(FORCE_LOCAL_MODE_KEY, "1");
  } catch {
    // best effort
  }
}

export function clearLocalModeOverride(): void {
  try {
    window.localStorage.removeItem(FORCE_LOCAL_MODE_KEY);
  } catch {
    // best effort
  }
}

export function isClerkEnabled(): boolean {
  const hasKey = Boolean(
    (import.meta.env.VITE_CLERK_PUBLISHABLE_KEY ?? "").trim()
  );
  if (!hasKey) return false;
  return !(readLocalModeOverride() || readQueryLocalMode());
}

