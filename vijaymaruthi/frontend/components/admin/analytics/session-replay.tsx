"use client";

/**
 * components/admin/analytics/session-replay.tsx
 *
 * Session Replay — a lightweight visual replay of the journey timeline.
 * Steps through the session chronologically with play / pause / speed
 * controls and a progress rail. This is a timeline replay (screens +
 * actions), not a pixel-level mouse replay — the tracker intentionally
 * does not record mouse coordinates for privacy.
 */

import * as React from "react";
import { Play, Pause, RotateCcw, ChevronRight, ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtClock, fmtDuration, type JourneyStep } from "@/lib/analytics/journey";

const SPEEDS = [1, 2, 4] as const;

export function SessionReplay({ steps }: { steps: JourneyStep[] }) {
  const [index, setIndex] = React.useState(0);
  const [playing, setPlaying] = React.useState(false);
  const [speed, setSpeed] = React.useState<number>(1);

  const total = steps.length;
  const step = steps[Math.min(index, total - 1)];

  React.useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      setIndex((i) => {
        if (i >= total - 1) {
          setPlaying(false);
          return i;
        }
        return i + 1;
      });
    }, 1400 / speed);
    return () => window.clearInterval(timer);
  }, [playing, speed, total]);

  const reset = () => {
    setPlaying(false);
    setIndex(0);
  };

  if (total === 0) return null;

  const progress = total > 1 ? (index / (total - 1)) * 100 : 0;

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-foreground">Session Replay</span>
          <span className="rounded-full bg-muted px-2 py-0.5 text-[0.65rem] font-medium uppercase tracking-wider text-muted-foreground">
            Timeline
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={reset}
            aria-label="Restart replay"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-surface text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => setIndex((i) => Math.max(0, i - 1))}
            aria-label="Previous step"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-surface text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => setPlaying((p) => !p)}
            aria-label={playing ? "Pause replay" : "Play replay"}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90"
          >
            {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            {playing ? "Pause" : "Play"}
          </button>
          <button
            onClick={() => setIndex((i) => Math.min(total - 1, i + 1))}
            aria-label="Next step"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-surface text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
          <div className="ml-1 flex items-center gap-0.5 rounded-lg border border-border bg-surface p-0.5">
            {SPEEDS.map((s) => (
              <button
                key={s}
                onClick={() => setSpeed(s)}
                className={cn(
                  "rounded-md px-2 py-1 text-[0.65rem] font-semibold transition-colors",
                  speed === s ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {s}×
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Progress rail */}
      <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-200"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Current step */}
      <div className="mt-4 min-h-[7rem] rounded-lg border border-border bg-background/60 p-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="tabular-nums">
            Step {index + 1} of {total}
          </span>
          <span className="tabular-nums">· {fmtClock(step.at)}</span>
          {step.kind === "screen" && (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[0.65rem] font-medium text-primary">
              {step.visit.name}
            </span>
          )}
        </div>

        {step.kind === "start" && (
          <p className="mt-2 text-sm font-medium text-foreground">🟢 {step.label}</p>
        )}
        {step.kind === "end" && (
          <p className="mt-2 text-sm font-medium text-foreground">⚪ {step.label}</p>
        )}
        {step.kind === "screen" && (
          <div className="mt-2 space-y-1.5">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span className="font-semibold text-foreground">{step.visit.name}</span>
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.7rem] text-muted-foreground">
                {step.visit.path}
              </code>
              <span className="text-xs text-muted-foreground">
                {fmtDuration(step.visit.totalSeconds)} on screen
              </span>
              {step.visit.maxScrollDepth > 0 && (
                <span className="text-xs text-muted-foreground">
                  scrolled to {step.visit.maxScrollDepth}%
                </span>
              )}
            </div>
            {step.visit.actions.length > 0 ? (
              <ul className="space-y-1">
                {step.visit.actions.map((a, i) => (
                  <li key={i} className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="h-1 w-1 rounded-full bg-muted-foreground/50" aria-hidden />
                    <span className="tabular-nums">{fmtClock(a.at)}</span>
                    <span>{a.label}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground">No interactions recorded on this screen.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}