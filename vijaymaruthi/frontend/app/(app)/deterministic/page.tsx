"use client";

import * as React from "react";
import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import type {
  DeterministicHealth,
  DeterministicRunSummary,
  DeterministicStock,
} from "@/lib/types";

// ── helpers ──
function regimeClass(r: string): string {
  if (r === "trend_up") return "bg-green-500/15 text-green-600 border-green-500/30";
  if (r === "trend_down") return "bg-red-500/15 text-red-600 border-red-500/30";
  if (r === "high_volatility") return "bg-amber-500/15 text-amber-600 border-amber-500/30";
  return "bg-slate-500/15 text-slate-600 border-slate-500/30";
}
function setupClass(s: string): string {
  if (s === "triggered") return "bg-green-500/15 text-green-600 border-green-500/30";
  if (s === "armed") return "bg-blue-500/15 text-blue-600 border-blue-500/30";
  if (s === "watch") return "bg-amber-500/15 text-amber-600 border-amber-500/30";
  if (s === "invalidated") return "bg-red-500/15 text-red-600 border-red-500/30";
  return "bg-slate-500/15 text-slate-600 border-slate-500/30";
}
function posClass(p: string): string {
  if (p === "target_hit") return "bg-green-500/15 text-green-600 border-green-500/30";
  if (p === "stopped") return "bg-red-500/15 text-red-600 border-red-500/30";
  if (p === "managing" || p === "entered") return "bg-blue-500/15 text-blue-600 border-blue-500/30";
  return "bg-slate-500/15 text-slate-600 border-slate-500/30";
}
function fmt(v: number | null | undefined, d = 2): string {
  if (v == null || Number.isNaN(v)) return "—";
  return v.toFixed(d);
}

export default function DeterministicPage() {
  const [health, setHealth] = useState<DeterministicHealth | null>(null);
  const [healthErr, setHealthErr] = useState<string>("");
  const [ticker, setTicker] = useState("RELIANCE.NS");
  const [stock, setStock] = useState<DeterministicStock | null>(null);
  const [stockErr, setStockErr] = useState<string>("");
  const [limit, setLimit] = useState(25);
  const [running, setRunning] = useState(false);
  const [runRows, setRunRows] = useState<DeterministicStock[]>([]);
  const [runId, setRunId] = useState<string>("");
  const [runs, setRuns] = useState<DeterministicRunSummary[]>([]);

  const loadHealth = useCallback(async () => {
    try {
      setHealth(await api.deterministic.health());
      setHealthErr("");
    } catch (e) {
      setHealthErr(e instanceof Error ? e.message : "unavailable");
    }
  }, []);

  const loadRuns = useCallback(async () => {
    try {
      const r = await api.deterministic.runs();
      setRuns(r.runs);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    loadHealth();
    loadRuns();
  }, [loadHealth, loadRuns]);

  const fetchState = useCallback(async () => {
    setStockErr("");
    setStock(null);
    try {
      setStock(await api.deterministic.state(ticker.trim(), true));
    } catch (e) {
      setStockErr(e instanceof Error ? e.message : "failed");
    }
  }, [ticker]);

  const runAnalysis = useCallback(async () => {
    setRunning(true);
    setRunRows([]);
    try {
      const res = await api.deterministic.analyze({ limit, timeline: false, persist: true });
      setRunRows(res.results);
      setRunId(res.run_id);
      loadRuns();
    } catch (e) {
      setStockErr(e instanceof Error ? e.message : "run failed");
    } finally {
      setRunning(false);
    }
  }, [limit, loadRuns]);

  return (
    <div className="container mx-auto max-w-6xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Deterministic Analyzer</h1>
        <p className="text-sm text-muted-foreground">
          Rule engine + composite state machine (regime × setup × position) over a
          pinned snapshot. Identical inputs always produce identical outputs.
        </p>
      </div>

      {/* Snapshot status */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pinned snapshot</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          {healthErr ? (
            <p className="text-red-500">
              Unavailable: {healthErr}
              <br />
              <span className="text-muted-foreground">
                Run <code>python -m analysis_app freeze …</code> and start the backend.
              </span>
            </p>
          ) : health ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div><div className="text-muted-foreground">As of</div><div className="font-medium">{health.snapshot_date ?? "—"}</div></div>
              <div><div className="text-muted-foreground">Tickers</div><div className="font-medium">{health.tickers}</div></div>
              <div><div className="text-muted-foreground">OHLCV rows</div><div className="font-medium">{health.ohlcv_rows.toLocaleString()}</div></div>
              <div><div className="text-muted-foreground">Snapshot SHA</div><div className="font-mono text-xs">{health.snapshot_sha?.slice(0, 12) ?? "—"}</div></div>
            </div>
          ) : (
            <p className="text-muted-foreground">Loading…</p>
          )}
        </CardContent>
      </Card>

      {/* Single-ticker state */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Composite state</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Input
              value={ticker}
              onChange={(e) => setTicker(e.target.value)}
              placeholder="e.g. RELIANCE.NS"
              className="max-w-xs"
            />
            <Button onClick={fetchState}>Analyze state</Button>
          </div>
          {stockErr && <p className="text-sm text-red-500">{stockErr}</p>}
          {stock && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{stock.ticker}</span>
                <Badge variant="outline">{stock.signal} · {fmt(stock.confidence, 0)}</Badge>
                <Badge className={regimeClass(stock.state.regime)}>{stock.state.regime}</Badge>
                <Badge className={setupClass(stock.state.setup)}>{stock.state.setup}</Badge>
                <Badge className={posClass(stock.state.position)}>{stock.state.position}</Badge>
                {stock.state.gates.length > 0 && (
                  <Badge variant="outline" className="text-amber-600">
                    {stock.state.gates.length} gate(s)
                  </Badge>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <div><div className="text-muted-foreground">Price</div><div className="font-medium">₹{fmt(stock.price)}</div></div>
                <div><div className="text-muted-foreground">Entry</div><div className="font-medium">{fmt(stock.state.entry)}</div></div>
                <div><div className="text-muted-foreground">Stop</div><div className="font-medium">{fmt(stock.state.stop)}</div></div>
                <div><div className="text-muted-foreground">Target</div><div className="font-medium">{fmt(stock.state.target)}</div></div>
              </div>
              <p className="text-xs text-muted-foreground">{stock.state.reason}</p>
              {stock.timeline.length > 0 && (
                <div className="text-xs">
                  <div className="mb-1 font-medium text-muted-foreground">Position timeline</div>
                  <div className="flex flex-wrap gap-2">
                    {stock.timeline.map((t, i) => (
                      <span key={i} className="rounded border px-2 py-0.5">
                        {t.bar} · {t.position} @ {fmt(t.price)}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Run analysis */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Run analysis</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-end gap-2">
            <div>
              <label className="text-xs text-muted-foreground">Limit (tickers)</label>
              <Input
                type="number"
                value={limit}
                onChange={(e) => setLimit(Number(e.target.value) || 0)}
                className="w-32"
              />
            </div>
            <Button onClick={runAnalysis} disabled={running}>
              {running ? "Running…" : "Run"}
            </Button>
            {runId && <span className="text-xs text-muted-foreground">run_id <code>{runId}</code></span>}
          </div>
          {runRows.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-1 pr-3">Ticker</th>
                    <th className="py-1 pr-3">Signal</th>
                    <th className="py-1 pr-3">Conf</th>
                    <th className="py-1 pr-3">Regime</th>
                    <th className="py-1 pr-3">Setup</th>
                    <th className="py-1 pr-3">Position</th>
                    <th className="py-1 pr-3">Pattern</th>
                  </tr>
                </thead>
                <tbody>
                  {runRows.map((r) => (
                    <tr key={r.ticker} className="border-b">
                      <td className="py-1 pr-3 font-medium">{r.ticker}</td>
                      <td className="py-1 pr-3">{r.signal}</td>
                      <td className="py-1 pr-3">{fmt(r.confidence, 0)}</td>
                      <td className="py-1 pr-3"><Badge className={regimeClass(r.state.regime)}>{r.state.regime}</Badge></td>
                      <td className="py-1 pr-3"><Badge className={setupClass(r.state.setup)}>{r.state.setup}</Badge></td>
                      <td className="py-1 pr-3"><Badge className={posClass(r.state.position)}>{r.state.position}</Badge></td>
                      <td className="py-1 pr-3 text-muted-foreground">{r.state.pattern_type || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Runs */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent runs</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          {runs.length === 0 ? (
            <p className="text-muted-foreground">No runs yet.</p>
          ) : (
            <ul className="space-y-1">
              {runs.map((r) => (
                <li key={r.run_id} className="flex flex-wrap gap-3">
                  <code className="text-xs">{r.run_id}</code>
                  <span className="text-muted-foreground">{r.as_of}</span>
                  <span>{r.analyzed}/{r.tickers} ok</span>
                  {r.errors ? <span className="text-red-500">{r.errors} errors</span> : null}
                  {r.run_sha256 && <span className="font-mono text-xs text-muted-foreground">{r.run_sha256.slice(0, 12)}</span>}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
