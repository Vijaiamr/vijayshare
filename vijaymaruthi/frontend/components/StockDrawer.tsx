"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  TrendingUp,
  TrendingDown,
  Minus,
  ArrowRight,
  Loader2,
  ShieldCheck,
  ShieldAlert,
  Shield,
  CircleCheck,
  CircleX,
  CirclePlus,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import type { DashboardRow, TickerAnalysis } from "@/lib/types";
import { formatPrice } from "@/lib/humaniser";
import { getSignalColor, signalHex } from "@/lib/theme";
import { PATTERN_LABELS } from "@/lib/patterns";
import { cn } from "@/lib/utils";

// ─── Score bands ───

function scoreBand(score: number): { label: string; kind: "strongBuy" | "hold" | "strongSell" } {
  if (score >= 90) return { label: "Exceptional", kind: "strongBuy" };
  if (score >= 80) return { label: "Strong", kind: "strongBuy" };
  if (score >= 70) return { label: "Good", kind: "hold" };
  if (score >= 60) return { label: "Neutral", kind: "hold" };
  return { label: "Weak", kind: "strongSell" };
}

function riskLabel(score: number): { label: string; icon: React.ReactNode; cls: string; kind: "strongBuy" | "hold" | "strongSell" } {
  if (score >= 80)
    return { label: "Low", icon: <ShieldCheck className="size-3.5" />, cls: "text-strong-buy", kind: "strongBuy" };
  if (score >= 60)
    return { label: "Medium", icon: <Shield className="size-3.5" />, cls: "text-hold", kind: "hold" };
  return { label: "High", icon: <ShieldAlert className="size-3.5" />, cls: "text-strong-sell", kind: "strongSell" };
}

function RowStat({ label, value, tone }: { label: string; value: React.ReactNode; tone?: string }) {
  return (
    <div className="rounded-lg border border-border/70 bg-card px-2.5 py-2">
      <p className="text-[0.58rem] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </p>
      <p className={cn("mt-0.5 text-sm font-bold tabular-nums", tone)}>{value}</p>
    </div>
  );
}

/**
 * Stock detail drawer — the "explain every signal" layer.
 * Shows the score, confidence, sub-scores and WHY from data that actually
 * exists (row fields + a lazy full-analysis fetch for the evidence bullets).
 */
export default function StockDrawer({
  row,
  onClose,
  monitored,
  onToggleMonitor,
}: {
  row: DashboardRow | null;
  onClose: () => void;
  monitored: boolean;
  onToggleMonitor: (e: React.MouseEvent | null, row: DashboardRow) => void;
}) {
  const router = useRouter();
  const [analysis, setAnalysis] = React.useState<TickerAnalysis | null>(null);
  const [analysisLoading, setAnalysisLoading] = React.useState(false);

  // Lazy full-analysis fetch — only when a row is open.
  React.useEffect(() => {
    if (!row) {
      setAnalysis(null);
      return;
    }
    let cancelled = false;
    setAnalysisLoading(true);
    api
      .analyze({ ticker: row.ticker, period: "1y", sentiment: false, save_db: false })
      .then((a: TickerAnalysis) => {
        if (!cancelled) setAnalysis(a);
      })
      .catch(() => {
        /* degrade gracefully — row-derived data is enough */
      })
      .finally(() => {
        if (!cancelled) setAnalysisLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [row]);

  const open = row !== null;
  const band = row ? scoreBand(row.qm_score) : null;
  const risk = row ? riskLabel(row.qm_score) : null;
  const signal = row
    ? {
        ...getSignalColor(row.qm_rating),
        kind:
          row.qm_rating === "Strong Buy" || row.qm_rating === "Buy"
            ? ("strongBuy" as const)
            : row.qm_rating === "Sell" || row.qm_rating === "Strong Sell"
              ? ("strongSell" as const)
              : ("hold" as const),
      }
    : null;

  const evidence = analysis?.quantamental?.evidence?.technical ?? [];
  const convScore = analysis?.conv_technical?.score;

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-[400px] gap-0 p-0">
        {row && band && signal && risk && (
          <>
            {/* ── Header ── */}
            <SheetHeader className="border-b border-border/70 p-4">
              <div className="flex items-start justify-between gap-2 pr-8">
                <div className="min-w-0">
                  <SheetTitle className="text-lg font-extrabold tracking-tight">
                    {row.ticker.replace(/\.(NS|BO)$/i, "")}
                  </SheetTitle>
                  <SheetDescription className="mt-0.5 font-mono text-[0.62rem]">
                    {row.ticker} · {row.cap_category}
                  </SheetDescription>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className="flex items-baseline gap-1.5">
                    <span className="font-mono text-sm font-bold">
                      {formatPrice(row.price, row.ticker)}
                    </span>
                    <span
                      className={cn(
                        "font-mono text-[0.62rem] font-bold tabular-nums",
                        row.score_change >= 0 ? "text-strong-buy" : "text-strong-sell",
                      )}
                    >
                      {row.score_change >= 0 ? "+" : ""}
                      {row.score_change.toFixed(1)}%
                    </span>
                  </span>
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded-[6px] border px-1.5 py-0.5 text-[0.62rem] font-bold uppercase tracking-wide",
                      signal.kind === "strongBuy"
                        ? "border-strong-buy/30 bg-strong-buy/10 text-strong-buy"
                        : signal.kind === "hold"
                          ? "border-hold/30 bg-hold/10 text-hold"
                          : "border-strong-sell/30 bg-strong-sell/10 text-strong-sell",
                    )}
                  >
                    <span className="size-1.5 rounded-full bg-current" />
                    {signal.label}
                  </span>
                </div>
              </div>
            </SheetHeader>

            <div className="flex-1 overflow-y-auto p-4">
              {/* ── Score + confidence ── */}
              <div className="mb-3 flex items-center gap-3 rounded-xl border border-border/70 bg-card p-3">
                <div className="flex items-baseline gap-1">
                  <span
                    className="text-[2rem] font-extrabold tabular-nums leading-none"
                    style={{ color: signalHex(band.kind) }}
                  >
                    {row.qm_score.toFixed(0)}
                  </span>
                  <span className="text-[0.65rem] font-medium text-muted-foreground">/ 100</span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="h-[5px] w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.min(100, row.qm_score)}%`,
                        backgroundColor: signalHex(band.kind),
                      }}
                    />
                  </div>
                  <div className="mt-1 flex items-center justify-between">
                    <span className="text-[0.65rem] font-bold" style={{ color: signalHex(band.kind) }}>
                      {band.label}
                    </span>
                    <span className="text-[0.62rem] text-muted-foreground">
                      confidence {row.tech_confidence ?? "—"}%
                    </span>
                  </div>
                </div>
              </div>

              {/* ── Sub-score grid ── */}
              <div className="mb-3 grid grid-cols-2 gap-1.5">
                <RowStat label="Technical" value={`${row.tech_score.toFixed(0)} / 100`} tone={row.tech_signal === "BUY" ? "text-strong-buy" : row.tech_signal === "SELL" ? "text-strong-sell" : "text-hold"} />
                <RowStat label="Fundamental" value={`${row.fund_score.toFixed(0)} / 100`} tone={row.fund_score >= 60 ? "text-strong-buy" : row.fund_score >= 40 ? "text-hold" : "text-strong-sell"} />
                <RowStat
                  label="Trend"
                  value={
                    <span className={cn("inline-flex items-center gap-1", row.trend === "improving" ? "text-strong-buy" : row.trend === "deteriorating" ? "text-strong-sell" : "text-muted-foreground")}>
                      {row.trend === "improving" ? <TrendingUp className="size-3.5" /> : row.trend === "deteriorating" ? <TrendingDown className="size-3.5" /> : <Minus className="size-3.5" />}
                      {row.trend}
                    </span>
                  }
                />
                <RowStat
                  label="Health"
                  value={
                    row.health_pass === true ? (
                      <span className="inline-flex items-center gap-1 text-strong-buy">
                        <CircleCheck className="size-3.5" /> PASS
                      </span>
                    ) : row.health_pass === false ? (
                      <span className="inline-flex items-center gap-1 text-strong-sell">
                        <CircleX className="size-3.5" /> FAIL
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )
                  }
                />
                <RowStat
                  label="Momentum"
                  value={
                    <span className={row.score_change >= 0 ? "text-strong-buy" : "text-strong-sell"}>
                      {row.score_change >= 0 ? "+" : ""}
                      {row.score_change.toFixed(1)}
                    </span>
                  }
                />
                <RowStat
                  label="Risk"
                  value={
                    <span className={cn("inline-flex items-center gap-1", risk.cls)}>
                      {risk.icon}
                      {risk.label}
                    </span>
                  }
                />
              </div>

              {/* ── Why this signal ── */}
              <div className="mb-3">
                <h3 className="mb-1.5 text-[0.68rem] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                  Why {signal.label}
                </h3>
                <ul className="space-y-1">
                  <li className="flex items-start gap-1.5 text-[0.72rem] text-foreground/90">
                    <CircleCheck className="mt-0.5 size-3 shrink-0 text-strong-buy" />
                    Technical score {row.tech_score.toFixed(0)}/100 — {row.tech_signal} momentum
                  </li>
                  <li className="flex items-start gap-1.5 text-[0.72rem] text-foreground/90">
                    <CircleCheck className="mt-0.5 size-3 shrink-0 text-strong-buy" />
                    Fundamentals {row.fund_score.toFixed(0)}/100 — {row.fund_rating}
                  </li>
                  <li className="flex items-start gap-1.5 text-[0.72rem] text-foreground/90">
                    <CircleCheck className="mt-0.5 size-3 shrink-0 text-strong-buy" />
                    Trend {row.trend} — score {row.score_change >= 0 ? "+" : ""}
                    {row.score_change.toFixed(1)} vs last run
                  </li>
                  {row.health_pass != null && (
                    <li className="flex items-start gap-1.5 text-[0.72rem] text-foreground/90">
                      <CircleCheck className="mt-0.5 size-3 shrink-0 text-strong-buy" />
                      v3 health check {row.health_pass ? "passed" : "failed"}
                    </li>
                  )}
                </ul>

                {analysisLoading && (
                  <div className="mt-2 flex items-center gap-1.5 text-[0.65rem] text-muted-foreground">
                    <Loader2 className="size-3 animate-spin" />
                    Loading engine evidence…
                  </div>
                )}
                {!analysisLoading && evidence.length > 0 && (
                  <ul className="mt-2 space-y-1 rounded-lg border border-border/70 bg-card p-2.5">
                    {evidence.slice(0, 4).map((e, i) => (
                      <li key={i} className="flex items-start gap-1.5 text-[0.7rem] text-muted-foreground">
                        <span className="mt-1 size-1 shrink-0 rounded-full bg-muted-foreground/50" />
                        {String(e)}
                      </li>
                    ))}
                    {convScore != null && (
                      <li className="flex items-start gap-1.5 text-[0.7rem] font-semibold text-foreground/80">
                        <span className="mt-1 size-1 shrink-0 rounded-full bg-primary" />
                        Confluence score {convScore.toFixed(0)}/100 across all engine modules
                      </li>
                    )}
                  </ul>
                )}
              </div>

              {/* ── Risks (derived from real row data, never fabricated) ── */}
              <div className="mb-3">
                <h3 className="mb-1.5 text-[0.68rem] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                  Risks
                </h3>
                <ul className="space-y-1">
                  {row.fund_score < 60 && (
                    <li className="flex items-start gap-1.5 text-[0.72rem] text-foreground/90">
                      <span className="mt-1.5 size-1 shrink-0 rounded-full bg-strong-sell" />
                      Fundamental score {row.fund_score.toFixed(0)}/100 — below the 60 threshold
                    </li>
                  )}
                  {row.tech_signal === "SELL" && (
                    <li className="flex items-start gap-1.5 text-[0.72rem] text-foreground/90">
                      <span className="mt-1.5 size-1 shrink-0 rounded-full bg-strong-sell" />
                      Technical signal is SELL
                    </li>
                  )}
                  {row.trend === "deteriorating" && (
                    <li className="flex items-start gap-1.5 text-[0.72rem] text-foreground/90">
                      <span className="mt-1.5 size-1 shrink-0 rounded-full bg-strong-sell" />
                      Trend deteriorating — score {row.score_change >= 0 ? "+" : ""}
                      {row.score_change.toFixed(1)} vs last run
                    </li>
                  )}
                  {row.health_pass === false && (
                    <li className="flex items-start gap-1.5 text-[0.72rem] text-foreground/90">
                      <span className="mt-1.5 size-1 shrink-0 rounded-full bg-strong-sell" />
                      v3 health check failed
                    </li>
                  )}
                  {risk.kind === "strongSell" && (
                    <li className="flex items-start gap-1.5 text-[0.72rem] text-foreground/90">
                      <span className="mt-1.5 size-1 shrink-0 rounded-full bg-strong-sell" />
                      High risk profile — blended score {row.qm_score.toFixed(0)}/100
                    </li>
                  )}
                  {row.fund_score >= 60 &&
                    row.tech_signal !== "SELL" &&
                    row.trend !== "deteriorating" &&
                    row.health_pass !== false &&
                    risk.kind !== "strongSell" && (
                      <li className="flex items-start gap-1.5 text-[0.72rem] text-muted-foreground">
                        <span className="mt-1.5 size-1 shrink-0 rounded-full bg-muted-foreground/50" />
                        No material risk flags in current data
                      </li>
                    )}
                </ul>
              </div>

              {/* ── Patterns ── */}
              {row.detected_patterns && row.detected_patterns.length > 0 && (
                <div className="mb-3">
                  <h3 className="mb-1.5 text-[0.68rem] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                    Chart patterns
                  </h3>
                  <div className="space-y-1.5">
                    {row.detected_patterns.slice(0, 4).map((p, i) => {
                      const meta = PATTERN_LABELS[p.type as keyof typeof PATTERN_LABELS];
                      const bullish = p.direction === "bullish";
                      return (
                        <div
                          key={`${p.type}-${i}`}
                          className="rounded-lg border border-border/70 bg-card px-2.5 py-2"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span
                              className={cn(
                                "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[0.6rem] font-semibold",
                                bullish
                                  ? "border-strong-buy/30 bg-strong-buy/10 text-strong-buy"
                                  : "border-strong-sell/30 bg-strong-sell/10 text-strong-sell",
                              )}
                            >
                              {meta?.abbr ?? p.type.replace(/_/g, " ").toUpperCase()}
                              <span className="opacity-70">{p.confidence}%</span>
                            </span>
                            <span className="text-[0.6rem] uppercase tracking-[0.06em] text-muted-foreground">
                              {p.status}
                            </span>
                          </div>
                          <p className="mt-1 text-[0.65rem] text-muted-foreground">
                            {meta?.full ?? p.type} · {p.direction}
                            {p.risk_reward != null && ` · R:R ${p.risk_reward.toFixed(2)}`}
                          </p>
                          {(p.entry != null || p.stop_loss != null || p.target != null) && (
                            <p className="mt-0.5 font-mono text-[0.6rem] text-muted-foreground/80">
                              {p.entry != null && `Entry ${p.entry.toFixed(2)}`}
                              {p.stop_loss != null && ` · SL ${p.stop_loss.toFixed(2)}`}
                              {p.target != null && ` · Tgt ${p.target.toFixed(2)}`}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* ── Footer ── */}
            <div className="border-t border-border/70 p-4">
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 rounded-[6px] px-2.5 font-semibold"
                  onClick={(e) => {
                    if (row) onToggleMonitor(e, row);
                  }}
                >
                  {monitored ? (
                    <>
                      <CircleCheck className="size-3.5" />
                      Monitored
                    </>
                  ) : (
                    <>
                      <CirclePlus className="size-3.5" />
                      Add to Validation
                    </>
                  )}
                </Button>
                <Button
                  size="sm"
                  className="flex-1 gap-1.5 rounded-[6px]"
                  onClick={() => {
                    onClose();
                    router.push(`/stock/${encodeURIComponent(row.ticker)}`);
                  }}
                >
                  View Full Analysis
                  <ArrowRight className="size-4" />
                </Button>
              </div>
              <p className="mt-2 text-center text-[0.6rem] text-muted-foreground/60">
                Full report: chart, indicators, fundamentals, backtest & pattern detail
              </p>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}