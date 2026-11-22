"use client";

import * as React from "react";
import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Rocket, RefreshCw, Play, RotateCcw, XCircle, TrendingUp, TrendingDown, Wallet, Target, ShieldAlert, Gauge, Clock } from "lucide-react";
import { motion } from "framer-motion";
import FadeIn from "@/components/animations/FadeIn";
import { cn } from "@/lib/utils";
import type { PilotSnapshot, PilotTrade } from "@/lib/pilot/types";
import AiOpsLinkCard from "@/components/pilot/AiOpsLinkCard";
import { analytics } from "@/lib/analytics/client-tracker";

const CAPITAL = 100000;

// ─── CSS-variable signal colours (resolves at browser → zero hydration mismatch) ───

const SIGNAL_VAR = {
  strongBuy: "var(--strong-buy)",
  buy: "var(--buy)",
  hold: "var(--hold)",
  sell: "var(--sell)",
  strongSell: "var(--strong-sell)",
} as const;

type SignalKind = keyof typeof SIGNAL_VAR;

function signalVar(kind: SignalKind): string {
  return SIGNAL_VAR[kind];
}

function scoreVar(score: number): string {
  if (score >= 80) return signalVar("strongBuy");
  if (score >= 60) return signalVar("hold");
  return signalVar("strongSell");
}

// ─── Small stat card ───

function StatCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <Card className="border-border">
      <CardContent className="p-3">
        <p className="text-[0.62rem] uppercase tracking-wider text-muted-foreground block mb-1">{label}</p>
        <p className="text-xl font-extrabold leading-none" style={{ color: color ?? "var(--foreground)" }}>{value}</p>
        {sub && <p className="text-[0.65rem] text-muted-foreground block mt-1">{sub}</p>}
      </CardContent>
    </Card>
  );
}

// ─── Trade row ───

function TradeRow({ trade, onClose }: { trade: PilotTrade; onClose?: (id: string) => void }) {
  const isOpen = trade.status === "OPEN";
  const pnlColor = (trade.pnl ?? 0) >= 0 ? signalVar("strongBuy") : signalVar("strongSell");
  const pnlStr = (trade.pnl ?? 0) >= 0 ? `+₹${(trade.pnl ?? 0).toFixed(0)}` : `-₹${Math.abs(trade.pnl ?? 0).toFixed(0)}`;
  const pnlPctStr = (trade.pnlPct ?? 0) >= 0 ? `+${(trade.pnlPct ?? 0).toFixed(2)}%` : `${(trade.pnlPct ?? 0).toFixed(2)}%`;

  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 py-2.5 border-b border-border last:border-0">
      {/* Ticker + signal */}
      <div className="flex items-center gap-2 min-w-[150px]">
        <span className="text-sm font-bold">{trade.ticker.replace(".NS", "").replace(".BO", "")}</span>
        <Badge variant="outline" className="text-[0.6rem] h-4 font-semibold border-strong-buy text-strong-buy bg-strong-buy/10">
          {trade.techSignal ?? "BUY"}
        </Badge>
        {trade.fundRating != null && (
          <Badge variant="outline" className="text-[0.6rem] h-4 font-semibold border-hold text-hold bg-hold/10">
            F:{trade.fundRating}
          </Badge>
        )}
        {trade.qmScore != null && (
          <span className="text-[0.65rem] font-semibold" style={{ color: scoreVar(trade.qmScore ?? 0) }}>
            {trade.qmScore.toFixed(0)}
          </span>
        )}
      </div>

      {/* Entry / Target / Stop */}
      <div className="flex gap-4 text-xs flex-1">
        <div>
          <p className="text-[0.55rem] uppercase text-muted-foreground">Entry</p>
          <p className="font-semibold font-mono">₹{trade.entry.toFixed(1)}</p>
        </div>
        <div>
          <p className="text-[0.55rem] uppercase text-muted-foreground">Target</p>
          <p className="font-semibold font-mono text-strong-buy">₹{trade.target1.toFixed(1)}</p>
        </div>
        <div>
          <p className="text-[0.55rem] uppercase text-muted-foreground">Stop</p>
          <p className="font-semibold font-mono text-strong-sell">₹{trade.stopLoss.toFixed(1)}</p>
        </div>
        <div>
          <p className="text-[0.55rem] uppercase text-muted-foreground">Qty</p>
          <p className="font-semibold font-mono">{trade.quantity}</p>
        </div>
      </div>

      {/* Current + P&L */}
      <div className="flex items-center gap-4 text-xs">
        <div>
          <p className="text-[0.55rem] uppercase text-muted-foreground">Current</p>
          <p className="font-semibold font-mono">{trade.currentPrice != null ? `₹${trade.currentPrice.toFixed(1)}` : "—"}</p>
        </div>
        <div>
          <p className="text-[0.55rem] uppercase text-muted-foreground">P&L</p>
          <p className="font-bold font-mono" style={{ color: pnlColor }}>
            {pnlStr} <span className="text-[0.6rem]">({pnlPctStr})</span>
          </p>
        </div>
        {isOpen && onClose && (
          <Button variant="ghost" size="sm" className="h-7 px-2 text-[0.65rem] gap-1" onClick={() => onClose(trade.id)}>
            <XCircle className="h-3 w-3" /> Close
          </Button>
        )}
        {!isOpen && (
          <Badge variant="secondary" className="text-[0.6rem] h-4 font-semibold">
            {trade.closeReason === "take-profit" ? "Take-profit" : trade.closeReason === "stop-loss" ? "Stop-loss" : "Closed"}
          </Badge>
        )}
      </div>
    </div>
  );
}

// ─── Main page ───

export default function AutoPilotPage() {
  const [snapshot, setSnapshot] = useState<PilotSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null); // which action is running
  const [error, setError] = useState<string | null>(null);
  const [schemaRequired, setSchemaRequired] = useState(false);

  const fetchState = useCallback(async () => {
    try {
      const res = await fetch("/api/pilot/state", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.schemaRequired) setSchemaRequired(true);
        throw new Error(data.error ?? "Failed to load Auto Pilot");
      }
      setSnapshot(data);
      setSchemaRequired(false);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load Auto Pilot");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchState();
  }, [fetchState]);

  const runAction = async (action: string, url: string, body?: unknown) => {
    setBusy(action);
    setError(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.schemaRequired) setSchemaRequired(true);
        throw new Error(data.error ?? "Action failed");
      }
      if (data.snapshot) setSnapshot(data.snapshot);
      else await fetchState();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy(null);
    }
  };

  const handleStart = () => { analytics.track("conversion", { goal: "pilot_start", value: CAPITAL }); runAction("start", "/api/pilot/start", { topN: 8 }); };
  const handleRefresh = () => runAction("refresh", "/api/pilot/refresh");
  const handleReset = () => runAction("reset", "/api/pilot/reset");
  const handleClose = (id: string) => runAction("close", "/api/pilot/close", { id });

  const hasState = snapshot?.state != null;
  const openTrades = snapshot?.trades.filter((t) => t.status === "OPEN") ?? [];
  const closedTrades = snapshot?.trades.filter((t) => t.status === "CLOSED") ?? [];
  const totalPnl = snapshot?.totalPnl ?? 0;
  const totalPnlColor = totalPnl >= 0 ? signalVar("strongBuy") : signalVar("strongSell");
  const availableCash = snapshot?.state?.availableCash ?? CAPITAL;

  return (
    <div className="w-full max-w-[1100px]">
      {/* Header */}
      <FadeIn delay={0.05}>
        <Card className="mb-4 border-2 border-strong-buy">
          <CardContent className="p-6">
            <div className="flex flex-col sm:flex-row gap-4 items-start justify-between">
              <div>
                <div className="flex items-center gap-3 mb-1">
                  <h2 className="text-2xl font-extrabold gradient-text">Auto Pilot</h2>
                  <Badge className="font-semibold rounded-md bg-strong-buy text-white">
                    <Rocket className="h-3 w-3 mr-1" /> Paper Trading
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground max-w-xl">
                  Automatically trades the app's top BUY-scored tickers with real entry / target / stop-loss
                  from S/R + ATR analysis, and marks to market against live NSE prices.
                </p>
              </div>
              <div className="flex gap-2 shrink-0 flex-wrap">
                {!hasState ? (
                  <Button onClick={handleStart} disabled={busy !== null} className="font-semibold gap-2">
                    {busy === "start" ? <div className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" /> : <Play className="h-4 w-4" />}
                    {busy === "start" ? "Starting..." : "Start Auto Pilot"}
                  </Button>
                ) : (
                  <>
                    <Button onClick={handleRefresh} disabled={busy !== null} className="font-semibold gap-2">
                      {busy === "refresh" ? <div className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                      {busy === "refresh" ? "Refreshing..." : "Refresh Prices"}
                    </Button>
                    <Button variant="outline" onClick={handleReset} disabled={busy !== null} className="gap-2">
                      <RotateCcw className="h-4 w-4" /> Reset
                    </Button>
                  </>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </FadeIn>

      {/* AI Ops & Learning — additive link (does not affect pilot state or logic) */}
      <FadeIn delay={0.08}>
        <AiOpsLinkCard />
      </FadeIn>

      {error && (
        <div className="border-l-4 border-strong-sell bg-strong-sell/10 p-3 rounded mb-4 text-sm text-strong-sell">{error}</div>
      )}

      {schemaRequired && (
        <div className="border-l-4 border-hold bg-hold/10 p-3 rounded mb-4 text-sm text-hold">
          <p className="font-semibold mb-1">Auto Pilot tables not created yet.</p>
          <p className="text-muted-foreground">
            Run <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">sync/auto_pilot_schema.sql</code> in the
            Supabase Dashboard → SQL Editor, then refresh this page.
          </p>
        </div>
      )}

      {loading ? (
        <div className="w-full flex flex-col items-center justify-center py-12 text-muted-foreground gap-4">
          <div className="w-9 h-9 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-sm">Loading Auto Pilot...</p>
        </div>
      ) : !hasState ? (
        <FadeIn delay={0.1}>
          <Card className="border-border">
            <CardContent className="p-10 text-center">
              <Rocket className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <h3 className="text-lg font-bold mb-1">Start the Auto Pilot</h3>
              <p className="text-sm text-muted-foreground max-w-md mx-auto mb-4">
                The pilot will select the top 8 BUY-scored tickers from the app's intelligence,
                compute real entry / target / stop-loss from S/R + ATR, and paper-trade them with ₹{CAPITAL.toLocaleString("en-IN")}.
              </p>
              <Button onClick={handleStart} disabled={busy !== null} className="font-semibold gap-2">
                {busy === "start" ? <div className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" /> : <Play className="h-4 w-4" />}
                {busy === "start" ? "Starting..." : "Start with ₹1,00,000"}
              </Button>
            </CardContent>
          </Card>
        </FadeIn>
      ) : (
        <>
          {/* Stats */}
          <FadeIn delay={0.1}>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
              <StatCard label="Capital" value={`₹${(snapshot?.state?.capital ?? CAPITAL).toLocaleString("en-IN")}`} sub="Starting capital" />
              <StatCard label="Available Cash" value={`₹${availableCash.toLocaleString("en-IN")}`} sub={`${openTrades.length} open positions`} />
              <StatCard label="Total P&L" value={`${totalPnl >= 0 ? "+" : ""}₹${totalPnl.toFixed(0)}`} sub={`${totalPnl >= 0 ? "+" : ""}${(snapshot?.totalPnlPct ?? 0).toFixed(2)}%`} color={totalPnlColor} />
              <StatCard
                label="Win Rate"
                value={snapshot?.winRate != null ? `${snapshot.winRate.toFixed(0)}%` : "—"}
                sub={`${snapshot?.closedCount ?? 0} closed · ${snapshot?.openCount ?? 0} open`}
                color={snapshot?.winRate != null ? (snapshot.winRate >= 50 ? signalVar("strongBuy") : signalVar("strongSell")) : undefined}
              />
            </div>
          </FadeIn>

          {/* Last marked */}
          {snapshot?.lastMarkedAt && (
            <p className="text-[0.65rem] text-muted-foreground mb-3 flex items-center gap-1">
              <Clock className="h-3 w-3" />
              Last marked {new Date(snapshot.lastMarkedAt).toLocaleString()}
              {snapshot.lastPriceSource && <span className="ml-1">· source: {snapshot.lastPriceSource}</span>}
            </p>
          )}

          {/* Open positions */}
          <FadeIn delay={0.15}>
            <Card className="mb-4 border-border">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
                  <TrendingUp className="h-4 w-4 text-primary" /> Open Positions ({openTrades.length})
                </CardTitle>
                <CardDescription className="text-xs">
                  Entry / target / stop from S/R + ATR. P&L marked to live NSE price.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-2.5">
                {openTrades.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-6">
                    No open positions. Click "Refresh Prices" to mark to market, or "Reset" to restart.
                  </p>
                ) : (
                  openTrades.map((t) => <TradeRow key={t.id} trade={t} onClose={handleClose} />)
                )}
              </CardContent>
            </Card>
          </FadeIn>

          {/* Closed positions */}
          <FadeIn delay={0.2}>
            <Card className="border-border">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
                  <TrendingDown className="h-4 w-4 text-primary" /> Closed Positions ({closedTrades.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="p-2.5">
                {closedTrades.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-6">
                    No closed positions yet. Positions square automatically when they hit target or stop.
                  </p>
                ) : (
                  closedTrades.map((t) => <TradeRow key={t.id} trade={t} />)
                )}
              </CardContent>
            </Card>
          </FadeIn>
        </>
      )}
    </div>
  );
}
