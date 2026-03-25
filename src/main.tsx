import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router";
import { ClerkProvider } from "@clerk/react-router";
import App from "./App";
import "./index.css";
import { forceEnableLocalMode, isClerkEnabled } from "./lib/runtimeFlags";
import {
  installRuntimeDiagnostics,
  readRuntimeDiagnostics,
  reportRuntimeError,
} from "./lib/runtimeDiagnostics";

type ErrorBoundaryState = {
  error: string | null;
};

class RootErrorBoundary extends React.Component<React.PropsWithChildren, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return {
      error: error instanceof Error ? error.stack || error.message : String(error),
    };
  }

  componentDidCatch(error: unknown) {
    console.error("Root render error:", error);
    reportRuntimeError("root-render-error", error);
  }

  render() {
    if (this.state.error) {
      const diagnostics = readRuntimeDiagnostics()
        .slice(-40)
        .map((row) => `${row.ts} [${row.kind}] ${row.detail}`)
        .join("\n");
      return (
        <div style={{ padding: 16, color: "#fca5a5", background: "#0f0f0f", height: "100vh", overflow: "auto", fontFamily: "monospace", fontSize: 12 }}>
          <div style={{ color: "#fecaca", marginBottom: 8 }}>UI crash detected:</div>
          <pre style={{ whiteSpace: "pre-wrap", margin: 0 }}>{this.state.error}</pre>
          <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
            <button
              style={{ background: "#222", color: "#ddd", border: "1px solid #444", padding: "6px 10px", cursor: "pointer" }}
              onClick={() => navigator.clipboard.writeText(`${this.state.error}\n\n--- Runtime diagnostics ---\n${diagnostics}`)}
            >
              Copy Crash Report
            </button>
            <button
              style={{ background: "#222", color: "#ddd", border: "1px solid #444", padding: "6px 10px", cursor: "pointer" }}
              onClick={() => {
                forceEnableLocalMode();
                window.location.reload();
              }}
            >
              Retry In Local Mode
            </button>
          </div>
          {diagnostics ? (
            <pre style={{ whiteSpace: "pre-wrap", marginTop: 12, color: "#d1d5db" }}>
              {diagnostics}
            </pre>
          ) : null}
        </div>
      );
    }
    return this.props.children;
  }
}

function removeLoadingScreen() {
  const el = document.getElementById("app-loading");
  if (el) {
    el.classList.add("fade-out");
    setTimeout(() => el.remove(), 300);
  }
}

function serializeError(value: unknown): string {
  if (value instanceof Error) return value.stack || `${value.name}: ${value.message}`;
  if (typeof value === "string") return value;
  try { return JSON.stringify(value); } catch { return String(value); }
}

window.addEventListener("error", (event) => {
  // Resource-load failures (broken img/script/link) fire with no error and
  // no message — log them at debug level only to avoid console spam.
  if (!event.error && !event.message) {
    console.debug("Resource load error:", event.filename || event.target);
    removeLoadingScreen();
    return;
  }
  const detail = event.error != null
    ? serializeError(event.error)
    : (event.message || `at ${event.filename}:${event.lineno}:${event.colno}`);
  console.error("Unhandled window error:", detail);
  reportRuntimeError("window-error", detail);
  removeLoadingScreen();
});

window.addEventListener("unhandledrejection", (event) => {
  console.error("Unhandled promise rejection:", serializeError(event.reason));
  reportRuntimeError("unhandled-rejection", event.reason);
  removeLoadingScreen();
});

const RootWrapper: React.ComponentType<React.PropsWithChildren> =
  import.meta.env.DEV ? React.Fragment : React.StrictMode;

installRuntimeDiagnostics();

const clerkPublishableKey = (import.meta.env.VITE_CLERK_PUBLISHABLE_KEY ?? "").trim();
const clerkEnabled = isClerkEnabled();
const appRoutes = (
  <RootErrorBoundary>
    <Routes>
      <Route path="/" element={<App />} />
    </Routes>
  </RootErrorBoundary>
);

if (!clerkPublishableKey) {
  console.warn(
    "Clerk publishable key not configured; running in local mode without cloud auth."
  );
}

type ClerkBoundaryState = { failed: boolean };
class ClerkBoundary extends React.Component<React.PropsWithChildren, ClerkBoundaryState> {
  state: ClerkBoundaryState = { failed: false };
  static getDerivedStateFromError(): ClerkBoundaryState {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.error("Clerk provider failed; falling back to local mode:", error);
    reportRuntimeError("clerk-provider-error", error);
    forceEnableLocalMode();
  }
  render() {
    if (this.state.failed) return appRoutes;
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <RootWrapper>
    <BrowserRouter>
      {clerkEnabled && clerkPublishableKey ? (
        <ClerkBoundary>
          <ClerkProvider publishableKey={clerkPublishableKey}>{appRoutes}</ClerkProvider>
        </ClerkBoundary>
      ) : (
        appRoutes
      )}
    </BrowserRouter>
  </RootWrapper>
);

// Fade out the inline loading screen once React has painted
requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    removeLoadingScreen();
  });
});
