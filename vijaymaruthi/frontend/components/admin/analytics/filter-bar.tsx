"use client";

/**
 * components/admin/analytics/filter-bar.tsx
 * Global analytics filter bar — date range, comparison, segment and
 * dimension filters. All state lives in AnalyticsFilterProvider (URL-synced)
 * so every page and API stays consistent.
 */

import * as React from "react";
import { RefreshCw, SlidersHorizontal } from "lucide-react";
import { useAnalyticsFilters } from "./filter-context";
import {
  RANGE_PRESETS,
  COMPARE_MODES,
  SEGMENTS,
  DEVICES,
  BROWSERS,
  SOURCES,
} from "@/lib/analytics/filters";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function FilterSelect({
  value,
  onValueChange,
  options,
  ariaLabel,
  className,
}: {
  value: string;
  onValueChange: (v: string) => void;
  options: { id: string; label: string }[];
  ariaLabel: string;
  className?: string;
}) {
  return (
    <Select value={value} onValueChange={(v) => v && onValueChange(v)} aria-label={ariaLabel}>
      <SelectTrigger className={cn("h-8 w-auto min-w-[7.5rem] text-xs", className)}>
        <SelectValue placeholder={ariaLabel} />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.id} value={o.id}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function FilterBar({
  onRefresh,
  refreshing,
  className,
}: {
  onRefresh?: () => void;
  refreshing?: boolean;
  className?: string;
}) {
  const { filters, update, reset, ready } = useAnalyticsFilters();

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2",
        className,
      )}
      role="toolbar"
      aria-label="Analytics filters"
    >
      <SlidersHorizontal className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />

      <FilterSelect
        value={filters.preset}
        onValueChange={(v) => update("preset", v as typeof filters.preset)}
        options={RANGE_PRESETS}
        ariaLabel="Date range"
      />

      {filters.preset === "custom" && (
        <div className="flex items-center gap-1.5">
          <Input
            type="date"
            value={filters.customStart ?? ""}
            onChange={(e) => update("customStart", e.target.value)}
            className="h-8 w-[8.5rem] text-xs"
            aria-label="Custom start date"
          />
          <span className="text-xs text-muted-foreground">→</span>
          <Input
            type="date"
            value={filters.customEnd ?? ""}
            onChange={(e) => update("customEnd", e.target.value)}
            className="h-8 w-[8.5rem] text-xs"
            aria-label="Custom end date"
          />
        </div>
      )}

      <FilterSelect
        value={filters.compare}
        onValueChange={(v) => update("compare", v as typeof filters.compare)}
        options={COMPARE_MODES}
        ariaLabel="Comparison"
      />

      <FilterSelect
        value={filters.segment}
        onValueChange={(v) => update("segment", v as typeof filters.segment)}
        options={SEGMENTS}
        ariaLabel="Segment"
      />

      <FilterSelect
        value={filters.device}
        onValueChange={(v) => update("device", v as typeof filters.device)}
        options={DEVICES}
        ariaLabel="Device"
      />

      <FilterSelect
        value={filters.browser}
        onValueChange={(v) => update("browser", v as typeof filters.browser)}
        options={BROWSERS}
        ariaLabel="Browser"
      />

      <FilterSelect
        value={filters.source}
        onValueChange={(v) => update("source", v as typeof filters.source)}
        options={SOURCES}
        ariaLabel="Traffic source"
      />

      <div className="ml-auto flex items-center gap-2">
        {!ready && <span className="text-xs text-muted-foreground">Loading filters…</span>}
        <Button
          variant="ghost"
          size="sm"
          className="h-8 gap-1.5 text-xs"
          onClick={reset}
          aria-label="Reset filters"
        >
          Reset
        </Button>
        {onRefresh && (
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={onRefresh}
            disabled={refreshing}
            aria-label="Refresh data"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} aria-hidden />
            Refresh
          </Button>
        )}
      </div>
    </div>
  );
}