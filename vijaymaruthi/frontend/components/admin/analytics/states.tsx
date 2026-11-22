"use client";

/**
 * components/admin/analytics/states.tsx
 * Shared loading / empty / error states + section primitives.
 */

import * as React from "react";
import { RefreshCw, Inbox, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

/* ── Section title ── */
export function SectionTitle({
  title,
  description,
  actions,
  className,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-2", className)}>
      <div>
        <h2 className="text-base font-semibold tracking-tight text-foreground">{title}</h2>
        {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

/* ── Loading skeleton ── */
export function LoadingSkeleton({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("space-y-3", className)} aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-9 animate-pulse rounded-lg bg-muted" />
      ))}
    </div>
  );
}

export function MetricSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-xl border border-border bg-surface p-4">
          <div className="h-3 w-20 animate-pulse rounded bg-muted" />
          <div className="mt-3 h-7 w-24 animate-pulse rounded bg-muted" />
          <div className="mt-2 h-3 w-16 animate-pulse rounded bg-muted" />
        </div>
      ))}
    </div>
  );
}

/* ── Empty state ── */
export function EmptyState({
  message = "No analytics data for this period.",
  action,
  className,
}: {
  message?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-surface/50 px-6 py-12 text-center",
        className,
      )}
    >
      <Inbox className="h-8 w-8 text-muted-foreground/40" aria-hidden />
      <p className="max-w-sm text-sm text-muted-foreground">{message}</p>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

/* ── Error state ── */
export function ErrorState({
  message = "Analytics data could not be loaded.",
  onRetry,
  className,
}: {
  message?: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-xl border border-danger/25 bg-danger/5 px-6 py-10 text-center",
        className,
      )}
    >
      <AlertTriangle className="h-8 w-8 text-danger/70" aria-hidden />
      <p className="max-w-sm text-sm text-foreground">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden />
          Retry
        </button>
      )}
    </div>
  );
}

/* ── Inline error banner (non-blocking) ── */
export function ErrorBanner({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="rounded-lg border border-danger/25 bg-danger/5 px-3 py-2 text-xs text-danger"
    >
      {message}
    </div>
  );
}