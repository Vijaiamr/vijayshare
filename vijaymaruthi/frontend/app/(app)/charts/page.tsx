"use client";

// Multi-chart grid page — renders saved chart layouts as a grid of
// InteractiveChart instances. Opened from the chart toolbar's Layouts dialog
// ("Grid" button) with ?layout=<id>&tickers=<comma-separated>.

import { Suspense, useMemo } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import InteractiveChart from "@/components/InteractiveChart";
import { useChartLayouts } from "@/components/chart/useChartLayouts";
import type { ChartLayoutConfig } from "@/components/chart/useChartLayouts";

function ChartsGridInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const layoutId = searchParams.get("layout") ?? "";
  const tickersParam = searchParams.get("tickers") ?? "";
  const { layouts, loaded } = useChartLayouts();

  const configs: ChartLayoutConfig[] = useMemo(() => {
    // Prefer the saved layout (has per-chart view state); fall back to the
    // tickers param with default view state.
    const found = layouts.find((l) => l.id === layoutId);
    if (found && found.layout.length > 0) return found.layout;
    return tickersParam
      .split(",")
      .filter(Boolean)
      .map((t) => ({ ticker: decodeURIComponent(t), interval: "1d", lookback: "1y", chartType: "candle" }));
  }, [layouts, layoutId, tickersParam]);

  const cols = configs.length >= 3 ? "lg:grid-cols-2" : configs.length === 2 ? "lg:grid-cols-2" : "lg:grid-cols-1";

  return (
    <div className="w-full max-w-[1400px]">
      <div className="mb-3 flex items-center justify-between">
        <Button variant="ghost" onClick={() => router.back()} className="gap-2">
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
        <p className="text-xs text-muted-foreground">
          {loaded ? `${configs.length} chart${configs.length === 1 ? "" : "s"}` : "Loading layout…"}
        </p>
      </div>

      <div className={`grid grid-cols-1 gap-3 ${cols}`}>
        {configs.map((c) => (
          <div key={c.ticker} className="rounded-xl border border-border/60 bg-card p-2">
            <div className="mb-1 flex items-center justify-between px-1">
              <p className="text-xs font-bold">{c.ticker.replace(".NS", "").replace(".BO", "")}</p>
              <p className="text-[0.6rem] text-muted-foreground">
                {c.interval} · {c.lookback} · {c.chartType}
              </p>
            </div>
            <InteractiveChart
              ticker={c.ticker}
              initialView={{ interval: c.interval as never, lookback: c.lookback as never, chartType: c.chartType as never }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ChartsGridPage() {
  return (
    <Suspense fallback={<div className="py-12 text-center text-sm text-muted-foreground">Loading charts…</div>}>
      <ChartsGridInner />
    </Suspense>
  );
}