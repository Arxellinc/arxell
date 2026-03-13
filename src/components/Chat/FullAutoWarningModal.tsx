import { useEffect, useRef, useState } from "react";
import { Bot, Clock, Rocket, ShieldCheck, TimerReset } from "lucide-react";
import { cn } from "../../lib/utils";

const COUNTDOWN_SECONDS = 60;
const RING_RADIUS = 26;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

export interface FullAutoWarningModalProps {
  open: boolean;
  pendingTaskCount: number;
  pendingTaskTitle?: string;
  lastActivityAt: number;
  onReturnToToolsMode: () => void;
  onPostpone: () => void;
  onAccept: () => void;
}

export function FullAutoWarningModal({
  open,
  pendingTaskCount,
  pendingTaskTitle,
  lastActivityAt,
  onReturnToToolsMode,
  onPostpone,
  onAccept,
}: FullAutoWarningModalProps) {
  const [countdown, setCountdown] = useState(COUNTDOWN_SECONDS);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onAcceptRef = useRef(onAccept);
  onAcceptRef.current = onAccept;

  useEffect(() => {
    if (!open) {
      setCountdown(COUNTDOWN_SECONDS);
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }

    setCountdown(COUNTDOWN_SECONDS);
    intervalRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(intervalRef.current!);
          intervalRef.current = null;
          // Defer to avoid calling setState inside setState cycle
          setTimeout(() => onAcceptRef.current(), 0);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [open]);

  if (!open) return null;

  const progress = countdown / COUNTDOWN_SECONDS;
  const dashOffset = RING_CIRCUMFERENCE * (1 - progress);
  const isUrgent = countdown <= 10;

  // Format idle time as human-readable
  const idleMs = Date.now() - lastActivityAt;
  const idleMinutes = Math.floor(idleMs / 60000);
  const idleSeconds = Math.floor((idleMs % 60000) / 1000);
  const idleText =
    idleMinutes >= 1
      ? `${idleMinutes}m ${idleSeconds}s ago`
      : `${idleSeconds}s ago`;

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/65 backdrop-blur-sm px-4">
      <div className="w-full max-w-[420px] rounded-2xl border border-line-dark bg-bg-light shadow-2xl overflow-hidden">

        {/* ── Header ── */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-line-med bg-accent-green/5">
          <div className="flex items-center justify-center w-9 h-9 rounded-full bg-accent-green/15 flex-shrink-0">
            <Rocket size={16} className="text-accent-green" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-text-norm">Full-Auto Mode</div>
            <div className="text-[11px] text-text-med">No user activity detected for ~5 minutes</div>
          </div>
        </div>

        {/* ── Body ── */}
        <div className="px-5 py-5 space-y-4">

          {/* Countdown ring + message */}
          <div className="flex items-center gap-5">
            {/* SVG ring */}
            <div className="relative flex-shrink-0 w-[64px] h-[64px]">
              <svg
                width="64"
                height="64"
                viewBox="0 0 64 64"
                className="-rotate-90"
                aria-hidden="true"
              >
                {/* Track */}
                <circle
                  cx="32" cy="32" r={RING_RADIUS}
                  fill="none"
                  strokeWidth="5"
                  className="stroke-line-med"
                />
                {/* Progress */}
                <circle
                  cx="32" cy="32" r={RING_RADIUS}
                  fill="none"
                  strokeWidth="5"
                  strokeLinecap="round"
                  style={{
                    stroke: isUrgent
                      ? "var(--color-accent-red)"
                      : "var(--color-accent-green)",
                    strokeDasharray: RING_CIRCUMFERENCE,
                    strokeDashoffset: dashOffset,
                    transition: "stroke-dashoffset 1s linear, stroke 0.4s ease",
                  }}
                />
              </svg>
              {/* Number label */}
              <div className="absolute inset-0 flex items-center justify-center">
                <span
                  className={cn(
                    "text-base font-bold tabular-nums leading-none",
                    isUrgent ? "text-accent-red" : "text-accent-green"
                  )}
                >
                  {countdown}
                </span>
              </div>
            </div>

            <div className="flex-1 min-w-0 space-y-1">
              <p className="text-sm font-medium text-text-norm leading-snug">
                Agent will resume autonomous operation
              </p>
              <p className="text-[11px] text-text-med leading-relaxed">
                The agent will begin processing queued tasks in{" "}
                <span
                  className={cn(
                    "font-semibold",
                    isUrgent ? "text-accent-red" : "text-accent-green"
                  )}
                >
                  {countdown}s
                </span>{" "}
                unless you take action below.
              </p>
            </div>
          </div>

          {/* Pending task preview */}
          {pendingTaskCount > 0 && (
            <div className="rounded-lg border border-line-med bg-bg-dark px-3 py-2.5">
              <div className="flex items-center gap-2 mb-0.5">
                <Bot size={11} className="text-accent-primary flex-shrink-0" />
                <span className="text-[11px] font-medium text-text-norm">
                  {pendingTaskCount} pending task{pendingTaskCount !== 1 ? "s" : ""} queued
                </span>
              </div>
              {pendingTaskTitle && (
                <p className="text-[11px] text-text-dark truncate pl-[19px]">
                  Next: {pendingTaskTitle}
                </p>
              )}
            </div>
          )}

          {/* Last activity timestamp */}
          <div className="flex items-center gap-1.5 text-[11px] text-text-dark">
            <Clock size={10} className="flex-shrink-0" />
            <span>Last activity {idleText}</span>
          </div>
        </div>

        {/* ── Footer buttons ── */}
        <div className="flex items-center gap-2 px-5 py-4 border-t border-line-med bg-bg-dark flex-wrap">
          {/* 1. Return to +tools */}
          <button
            onClick={onReturnToToolsMode}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-[11px] bg-accent-gold/15 text-accent-gold hover:bg-accent-gold/25 transition-colors"
            title="Switch to +Tools — the agent will ask before executing each action"
          >
            <ShieldCheck size={12} />
            +Tools
          </button>

          {/* 2. Postpone */}
          <button
            onClick={onPostpone}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-[11px] bg-line-med text-text-med hover:bg-line-dark hover:text-text-norm transition-colors"
            title="Dismiss and reset the idle timer — you will be reminded again in 5 minutes"
          >
            <TimerReset size={12} />
            Postpone
          </button>

          {/* 3. Accept — proceed */}
          <button
            onClick={onAccept}
            className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded text-[11px] bg-accent-green/15 text-accent-green hover:bg-accent-green/25 transition-colors"
            title="Allow the agent to proceed with autonomous task execution now"
          >
            <Rocket size={12} />
            Accept
          </button>
        </div>
      </div>
    </div>
  );
}
