"use client";

/**
 * components/admin/analytics/header.tsx
 * Stable analytics page header — title, description, filter bar and
 * optional "last updated" / live indicator.
 */

import * as React from "react";
import { cn } from "@/lib/utils";
import { FilterBar } from "./filter-bar";

export function AnalyticsHeader({
  title,
  description,
  onRefresh,
  refreshing,
  lastUpdated,
  live,
  children,
  className,
}: {
  title: string;
  description?: string;
  onRefresh?: () => void;
  refreshing?: boolean;
  lastUpdated?: string;
  live?: boolean;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-4", className)}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">{title}</h1>
          {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {live && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-success/30 bg-success/10 px-2.5 py-1 font-medium text-success">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-success" />
              </span>
              Live
            </span>
          )}
          {lastUpdated && <span>Updated {lastUpdated}</span>}
        </div>
      </div>

      <FilterBar onRefresh={onRefresh} refreshing={refreshing} />

      {children}
    </div>
  );
}