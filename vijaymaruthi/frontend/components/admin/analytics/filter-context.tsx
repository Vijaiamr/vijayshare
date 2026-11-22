"use client";

/**
 * components/admin/analytics/filter-context.tsx
 *
 * Global analytics filter state. Every analytics page consumes the same
 * provider so date range, comparison, segment and dimension filters are
 * consistent across the entire section. State is mirrored to the URL
 * (shallow replace) so reloads and deep links preserve the context.
 */

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  AnalyticsFilters,
  DEFAULT_FILTERS,
  filtersFromParams,
  filtersToParams,
  computePeriod,
  computeComparison,
  periodDays,
  Period,
} from "@/lib/analytics/filters";

interface FilterContextValue {
  filters: AnalyticsFilters;
  setFilters: (f: AnalyticsFilters) => void;
  update: <K extends keyof AnalyticsFilters>(key: K, value: AnalyticsFilters[K]) => void;
  reset: () => void;
  /** Computed primary period (UTC ISO). */
  period: Period;
  /** Computed comparison period, or null. */
  comparison: Period | null;
  /** Days in the primary period. */
  days: number;
  /** True while the provider is hydrating from the URL. */
  ready: boolean;
}

const FilterContext = React.createContext<FilterContextValue | null>(null);

export function AnalyticsFilterProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [filters, setFiltersState] = React.useState<AnalyticsFilters>(DEFAULT_FILTERS);
  const [ready, setReady] = React.useState(false);

  // Hydrate from URL once on mount.
  React.useEffect(() => {
    setFiltersState(filtersFromParams(searchParams.toString()));
    setReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setFilters = React.useCallback(
    (f: AnalyticsFilters) => {
      setFiltersState(f);
      const qs = filtersToParams(f).toString();
      const url = qs ? `${pathname}?${qs}` : pathname;
      router.replace(url, { scroll: false });
    },
    [pathname, router],
  );

  const update = React.useCallback(
    <K extends keyof AnalyticsFilters>(key: K, value: AnalyticsFilters[K]) => {
      setFiltersState((f) => {
        const next = { ...f, [key]: value };
        const qs = filtersToParams(next).toString();
        const url = qs ? `${pathname}?${qs}` : pathname;
        router.replace(url, { scroll: false });
        return next;
      });
    },
    [pathname, router],
  );

  const reset = React.useCallback(() => setFilters(DEFAULT_FILTERS), [setFilters]);

  const period = React.useMemo(() => computePeriod(filters), [filters]);
  const comparison = React.useMemo(() => computeComparison(filters, period), [filters, period]);
  const days = React.useMemo(() => periodDays(period), [period]);

  const value = React.useMemo(
    () => ({ filters, setFilters, update, reset, period, comparison, days, ready }),
    [filters, setFilters, update, reset, period, comparison, days, ready],
  );

  return <FilterContext.Provider value={value}>{children}</FilterContext.Provider>;
}

export function useAnalyticsFilters(): FilterContextValue {
  const ctx = React.useContext(FilterContext);
  if (!ctx) throw new Error("useAnalyticsFilters must be used within AnalyticsFilterProvider");
  return ctx;
}