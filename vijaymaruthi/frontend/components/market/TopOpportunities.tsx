"use client";

import { Sparkles } from "lucide-react";
import type { DashboardRow } from "@/lib/types";
import { cn } from "@/lib/utils";
import { signalHex } from "@/lib/theme";

function capLabel(cap: string): string {
  const c = cap.toLowerCase();
  if (c === "large") return "Large Cap";
  if (c === "mid") return "Mid Cap";
  if (c === "small") return "Small Cap";
  return cap;
}

/**
 * Opportunities — compact ranked list of the highest-scored buy signals.
 * Single-line rows: 01 · TICKER · Cap · Signal · Score · ↗ change.
 * Clicking a row opens the stock detail drawer (via onSelect).
 */
export default function TopOpportunities({
  rows,
  onSelect,
}: {
  rows: DashboardRow[];
  onSelect: (row: DashboardRow) => void;
}) {
  const top = [...rows]
    .filter((r) => r.qm_rating === "Strong Buy" || r.qm_rating === "Buy")
    .sort((a, b) => b.qm_score - a.qm_score)
    .slice(0, 5);

  if (top.length === 0) return null;

  return (
    <section className="rounded-xl border border-border bg-surface p-2.5">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-[0.72rem] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
          <Sparkles className="size-3.5 text-primary" />
          Opportunities
        </h2>
        <span className="text-[0.58rem] text-muted-foreground/60">
          Top buy signals
        </span>
      </div>

      <div className="space-y-px">
        {top.map((r, i) => {
          const color = signalHex(r.qm_score >= 80 ? "strongBuy" : r.qm_score >= 60 ? "hold" : "strongSell");
          const improving = r.trend === "improving";
          const deteriorating = r.trend === "deteriorating";
          return (
            <button
              key={r.ticker}
              onClick={() => onSelect(r)}
              className="group flex w-full items-center gap-2 rounded-md px-1.5 py-[3px] text-left transition-colors hover:bg-muted/30"
            >
              <span className="w-4 shrink-0 text-right font-mono text-[0.58rem] tabular-nums text-muted-foreground/50">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className="w-[74px] shrink-0 truncate text-[0.7rem] font-bold text-foreground/90 group-hover:text-foreground">
                {r.ticker.replace(/\.(NS|BO)$/i, "")}
              </span>
              <span className="min-w-0 flex-1 truncate text-[0.58rem] text-muted-foreground/70">
                {capLabel(r.cap_category)} · {r.tech_signal}
              </span>
              <span className="shrink-0 text-[0.7rem] font-bold tabular-nums" style={{ color }}>
                {r.qm_score.toFixed(0)}
              </span>
              <span
                className={cn(
                  "flex w-[62px] shrink-0 items-center justify-end gap-0.5 text-[0.6rem] font-semibold tabular-nums",
                  improving
                    ? "text-strong-buy"
                    : deteriorating
                      ? "text-strong-sell"
                      : "text-muted-foreground",
                )}
              >
                {improving ? "↗" : deteriorating ? "↘" : "→"}
                {r.score_change >= 0 ? "+" : ""}
                {r.score_change.toFixed(1)}%
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}