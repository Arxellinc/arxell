import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router";
import { ClerkProvider } from "@clerk/react-router";
import App from "./App";
import "./index.css";

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
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 16, color: "#fca5a5", background: "#0f0f0f", height: "100vh", overflow: "auto", fontFamily: "monospace", fontSize: 12 }}>
          <div style={{ color: "#fecaca", marginBottom: 8 }}>UI crash detected:</div>
          <pre style={{ whiteSpace: "pre-wrap", margin: 0 }}>{this.state.error}</pre>
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
  removeLoadingScreen();
});

window.addEventListener("unhandledrejection", (event) => {
  console.error("Unhandled promise rejection:", serializeError(event.reason));
  removeLoadingScreen();
});

const RootWrapper: React.ComponentType<React.PropsWithChildren> =
  import.meta.env.DEV ? React.Fragment : React.StrictMode;

const clerkPublishableKey = (import.meta.env.VITE_CLERK_PUBLISHABLE_KEY ?? "").trim();

function MissingClerkKeyScreen() {
  return (
    <div
      style={{
        height: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#111111",
        color: "rgba(255,255,255,0.85)",
        fontFamily: "Inter, system-ui, -apple-system, Segoe UI, sans-serif",
        padding: 24,
      }}
    >
      <div style={{ maxWidth: 680, width: "100%" }}>
        <h1 style={{ fontSize: 18, margin: "0 0 12px 0" }}>Missing Clerk Configuration</h1>
        <p style={{ margin: "0 0 10px 0", opacity: 0.9 }}>
          Set <code>VITE_CLERK_PUBLISHABLE_KEY</code> in <code>.env.local</code> and restart dev mode.
        </p>
        <pre
          style={{
            margin: 0,
            padding: 12,
            borderRadius: 8,
            background: "#0b0b0b",
            border: "1px solid rgba(255,255,255,0.12)",
            whiteSpace: "pre-wrap",
            fontSize: 12,
          }}
        >
{`cp .env.local.example .env.local
# then edit .env.local:
VITE_CLERK_PUBLISHABLE_KEY=pk_...

npm run start-dev`}
        </pre>
      </div>
    </div>
  );
}

if (!clerkPublishableKey) {
  console.error("Missing Clerk Publishable Key: VITE_CLERK_PUBLISHABLE_KEY");
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <RootWrapper>
      <MissingClerkKeyScreen />
    </RootWrapper>
  );
} else {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <RootWrapper>
      <BrowserRouter>
        <ClerkProvider publishableKey={clerkPublishableKey}>
          <RootErrorBoundary>
            <Routes>
              <Route path="/" element={<App />} />
            </Routes>
          </RootErrorBoundary>
        </ClerkProvider>
      </BrowserRouter>
    </RootWrapper>
  );
}

// Fade out the inline loading screen once React has painted
requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    removeLoadingScreen();
  });
});
