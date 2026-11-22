"use client";

import * as React from "react";
import Link from "next/link";
import { Wallet, TrendingUp, TrendingDown, PiggyBank, ArrowRight } from "lucide-react";
import type { LedgerSummary } from "@/lib/ledger/db";

/**
 * Spending Snapshot — compact home-dashboard widget.
 *
 * Fetches /api/ledger/summary (server-side auth). Renders nothing when the
 * user is not signed in, Supabase is unconfigured, or there is no data yet.
 */
export default function SpendingSnapshot() {
  const [summary, setSummary] = React.useState<LedgerSummary | null>(null);
  const [visible, setVisible] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    fetch("/api/ledger/summary", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: LedgerSummary | null) => {
        if (cancelled) return;
        if (data && data.transactionCount > 0) {
          setSummary(data);
          setVisible(true);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (!visible || !summary) return null;

  const thisMonth = summary.monthlyTrend[summary.monthlyTrend.length - 1];
  const monthLabel = thisMonth
    ? new Date(`${thisMonth.month}-01T00:00:00`).toLocaleDateString("en-IN", { month: "short", year: "numeric" })
    : "All time";
  const monthSpent = thisMonth?.spent ?? summary.totalSpent;
  const savingsPct =
    summary.totalIncome > 0 ? Math.round((summary.netSavings / summary.totalIncome) * 100) : 0;

  const fmt = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-border bg-card px-3.5 py-2.5">
      <span className="inline-flex items-center gap-1.5 text-[0.65rem] font-semibold uppercase tracking-[0.5px] text-muted-foreground">
        <Wallet className="size-3.5 text-primary" />
        Spending Snapshot
      </span>

      <span className="inline-flex items-center gap-1 text-[0.7rem] font-semibold text-foreground">
        <TrendingDown className="size-3 text-strong-sell" />
        {fmt(monthSpent)}
        <span className="font-normal text-muted-foreground/70">spent {monthLabel}</span>
      </span>

      <span className="inline-flex items-center gap-1 text-[0.7rem] font-semibold text-foreground">
        <TrendingUp className="size-3 text-primary" />
        {fmt(summary.totalIncome)}
        <span className="font-normal text-muted-foreground/70">income</span>
      </span>

      <span className="inline-flex items-center gap-1 text-[0.7rem] font-semibold text-foreground">
        <PiggyBank className="size-3 text-hold" />
        {fmt(summary.netSavings)}
        <span className="font-normal text-muted-foreground/70">saved ({savingsPct}%)</span>
      </span>

      {summary.topCategory && (
        <span className="inline-flex items-center gap-1 rounded border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[0.65rem] font-semibold text-primary">
          Top: {summary.topCategory} · {fmt(summary.topCategoryAmount)}
        </span>
      )}

      <Link
        href="/ledger"
        className="ml-auto inline-flex items-center gap-1 text-[0.65rem] font-semibold text-muted-foreground transition-colors hover:text-foreground"
      >
        Open Ledger <ArrowRight className="size-3" />
      </Link>
    </div>
  );
}