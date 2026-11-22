"use client";

import { useRouter } from "next/navigation";
import { Layers, ArrowRight } from "lucide-react";
import type { SectorPhase, SectorStat } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Sector Analysis — compact RS list with progress bars.
 * Single-column layout: name + RS/99 + bar. Faster to scan than 6 cards.
 */

const PHASE_DOT: Record<SectorPhase, string> = {
  Leading: "bg-strong-buy",
  Improving: "bg-buy",
  Weakening: "bg-hold",
  Lagging: "bg-strong-sell",
};

function rsTone(pct: number): string {
  if (pct >= 80) return "text-strong-buy";
  if (pct >= 60) return "text-buy";
  if (pct >= 40) return "text-hold";
  return "text-strong-sell";
}

export default function SectorRail({ sectors }: { sectors: SectorStat[] }) {
  const router = useRouter();
  const top = [...sectors].sort((a, b) => b.rs_percentile - a.rs_percentile).slice(0, 6);

  if (top.length === 0) return null;

  return (
    <section className="rounded-xl border border-border bg-surface p-3">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="flex items-center gap-1.5 text-[0.72rem] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
          <Layers className="size-3.5 text-primary" />
          Sector Analysis
        </h2>
        <button
          onClick={() => router.push("/market")}
          className="inline-flex items-center gap-0.5 text-[0.62rem] font-semibold text-muted-foreground transition-colors hover:text-foreground"
        >
          Full market <ArrowRight className="size-3" />
        </button>
      </div>

      <div className="space-y-px">
        {top.map((s) => (
          <button
            key={s.sector}
            onClick={() => router.push("/market")}
            className="group flex w-full items-center gap-2 rounded-md px-1.5 py-[3px] text-left transition-colors hover:bg-muted/30"
          >
            <span className={cn("size-1.5 shrink-0 rounded-full", PHASE_DOT[s.phase])} />
            <span className="min-w-0 flex-1 truncate text-[0.68rem] font-medium text-foreground/90 group-hover:text-foreground">
              {s.sector}
            </span>
            <span className={cn("shrink-0 tabular-nums text-[0.68rem] font-bold", rsTone(s.rs_percentile))}>
              {s.rs_percentile}
            </span>
            <span className="w-[80px] shrink-0">
              <div className="h-[3px] w-full overflow-hidden rounded-full bg-muted">
                <div
                  className={cn("h-full rounded-full", rsTone(s.rs_percentile))}
                  style={{ width: `${Math.min(100, s.rs_percentile)}%`, backgroundColor: "currentColor" }}
                />
              </div>
            </span>
            <span className="w-[52px] shrink-0 text-right text-[0.58rem] font-semibold text-muted-foreground/80">
              {s.buy_pct.toFixed(0)}% Buy
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
