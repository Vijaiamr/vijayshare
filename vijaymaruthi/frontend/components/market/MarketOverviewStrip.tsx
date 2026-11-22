"use client";

import { TrendingUp, TrendingDown, Minus, Activity, Gauge } from "lucide-react";
import type { MarketIndex, MarketResponse, SectorStat } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Market Overview strip — breadth-derived market condition.
 * No fabricated index numbers: Advancers/Decliners/Unchanged come straight
 * from the analysed NSE universe (GET /api/market breadth).
 */

type Condition = { label: string; tone: "risk-on" | "neutral" | "risk-off" };

function marketCondition(buyPct: number): Condition {
  if (buyPct >= 60) return { label: "Risk-On", tone: "risk-on" };
  if (buyPct >= 45) return { label: "Neutral", tone: "neutral" };
  return { label: "Risk-Off", tone: "risk-off" };
}

const TONE_STYLE: Record<Condition["tone"], string> = {
  "risk-on": "text-strong-buy border-strong-buy/30 bg-strong-buy/10",
  neutral: "text-hold border-hold/30 bg-hold/10",
  "risk-off": "text-strong-sell border-strong-sell/30 bg-strong-sell/10",
};

/** Spec 37 — data provenance: "Data as of 06 Sep 2026 · 16:32 IST" */
function formatAsOf(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const date = d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  const time = d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false });
  return `Data as of ${date} · ${time} IST`;
}

function Stat({
  label,
  value,
  sub,
  icon,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ReactNode;
  tone: "pos" | "neg" | "flat" | "muted";
}) {
  const toneCls =
    tone === "pos"
      ? "text-strong-buy"
      : tone === "neg"
        ? "text-strong-sell"
        : tone === "flat"
          ? "text-hold"
          : "text-foreground";
  return (
    <div className="flex min-w-0 items-center gap-2.5 py-2">
      <span className={cn("shrink-0", tone === "muted" ? "text-muted-foreground" : toneCls)}>
        {icon}
      </span>
      <div className="min-w-0">
        <p className={cn("text-sm font-bold tabular-nums leading-tight", toneCls)}>{value}</p>
        <p className="truncate text-[0.6rem] uppercase tracking-[0.08em] text-muted-foreground">
          {label}
          {sub && <span className="normal-case tracking-normal text-muted-foreground/60"> · {sub}</span>}
        </p>
      </div>
    </div>
  );
}

export default function MarketOverviewStrip({
  breadth,
  generatedAt,
  sectors,
  indices = [],
}: {
  breadth: MarketResponse["breadth"];
  generatedAt: string;
  sectors: SectorStat[];
  indices?: MarketIndex[];
}) {
  const buyPct = breadth.total > 0 ? (breadth.buy / breadth.total) * 100 : 0;
  const cond = marketCondition(buyPct);
  const improvingPct = breadth.total > 0 ? (breadth.improving / breadth.total) * 100 : 0;

  // Risk explanation — sector breadth when available, else index-based.
  // Never expose "0 declining sectors" under Risk-Off (contradictory).
  const advancing = sectors.filter((s) => s.phase === "Leading" || s.phase === "Improving").length;
  const declining = sectors.filter((s) => s.phase === "Weakening" || s.phase === "Lagging").length;
  const flat = Math.max(0, sectors.length - advancing - declining);
  const hasSectorBreadth = sectors.length > 0;
  const riskExplanation = !hasSectorBreadth
    ? cond.tone === "risk-on"
      ? "Breadth expanding"
      : cond.tone === "neutral"
        ? "Mixed breadth"
        : "Market indices weakening"
    : cond.tone === "risk-on"
      ? `Breadth expanding · ${advancing} advancing sector${advancing !== 1 ? "s" : ""}`
      : cond.tone === "neutral"
        ? `Mixed breadth · ${advancing} advancing · ${declining} declining`
        : `Breadth weakening · ${declining} declining sector${declining !== 1 ? "s" : ""}${flat > 0 ? ` · ${flat} unchanged` : ""}`;

  return (
    <section className="rounded-xl border border-border bg-surface">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 pt-2">
        <h2 className="inline-flex items-center gap-1.5 text-[0.62rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          <Gauge className="size-3.5 text-primary" />
          Market Overview
        </h2>
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[0.62rem] font-bold uppercase tracking-[0.08em]",
            TONE_STYLE[cond.tone],
          )}
        >
          <span className="size-1.5 rounded-full bg-current" />
          {cond.label}
        </span>
        <span className="text-[0.58rem] text-muted-foreground/60">
          {riskExplanation}
        </span>
        <span className="ml-auto font-mono text-[0.58rem] text-muted-foreground/60">
          {generatedAt ? formatAsOf(generatedAt) : ""}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3">
        {indices.length > 0 && (
          <div className="flex items-center gap-x-3">
            {indices.map((ix) => {
              const up = ix.change_pct >= 0;
              return (
                <div key={ix.symbol} className="flex min-w-0 items-center gap-2 py-2">
                  <div className="min-w-0">
                    <p className={cn("font-mono text-sm font-bold tabular-nums leading-tight", up ? "text-strong-buy" : "text-strong-sell")}>
                      {ix.price.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                    </p>
                    <p className="truncate text-[0.6rem] uppercase tracking-[0.08em] text-muted-foreground">
                      {ix.name}
                      <span className={cn("ml-1 normal-case tracking-normal", up ? "text-strong-buy" : "text-strong-sell")}>
                        {up ? "+" : ""}
                        {ix.change_pct.toFixed(2)}%
                      </span>
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <Stat
          label="Advancers"
          value={String(breadth.buy)}
          sub={`${buyPct.toFixed(0)}% of ${breadth.total}`}
          icon={<TrendingUp className="size-4" />}
          tone="pos"
        />
        <Stat
          label="Decliners"
          value={String(breadth.sell)}
          icon={<TrendingDown className="size-4" />}
          tone="neg"
        />
        <Stat
          label="Unchanged"
          value={String(breadth.hold)}
          icon={<Minus className="size-4" />}
          tone="flat"
        />
        <Stat
          label="Improving"
          value={`${improvingPct.toFixed(0)}%`}
          sub={`${breadth.improving} stocks`}
          icon={<Activity className="size-4" />}
          tone="pos"
        />
        <Stat
          label="Avg QM Score"
          value={breadth.avg_qm_score.toFixed(1)}
          icon={<Gauge className="size-4" />}
          tone="muted"
        />
      </div>
    </section>
  );
}