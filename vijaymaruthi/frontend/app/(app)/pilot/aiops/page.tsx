"use client";

import * as React from "react";
import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Brain, Activity, Target, ExternalLink, Terminal, RefreshCw, CalendarClock } from "lucide-react";
import FadeIn from "@/components/animations/FadeIn";
import { cn } from "@/lib/utils";

// ─── CSS-variable signal colours (same convention as the Auto Pilot page) ───

const SIGNAL_VAR = {
  strongBuy: "var(--strong-buy)",
  buy: "var(--buy)",
  hold: "var(--hold)",
  sell: "var(--sell)",
  strongSell: "var(--strong-sell)",
} as const;

type AiOpsStatus = {
  available: boolean;
  prompt_version?: string;
  knowledge_version?: number | string;
  knowledge_hash?: string | null;
  adk_ui_url?: string;
  next_scheduled?: string;
  predictions?: number;
  validation?: { total: number; hits: number; hit_rate: number };
  lessons?: Record<string, number>;
  runs?: Array<{
    id: number;
    run_type: string;
    run_date: string;
    status: string;
    as_of?: string | null;
    started_at?: string;
    finished_at?: string | null;
  }>;
  calibration?: Array<{
    symbol: string;
    bucket: string;
    n: number;
    hits: number;
    hit_rate: number | null;
  }>;
};

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

function lastRun(runs: AiOpsStatus["runs"], type: string) {
  const found = (runs ?? []).find((r) => r.run_type === type && r.status === "completed");
  return found ? new Date(found.started_at ?? found.run_date).toLocaleString() : "Never";
}

export default function AiOpsPage() {
  const [status, setStatus] = useState<AiOpsStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/pilot/aiops/status", { cache: "no-store" });
      const data = await res.json().catch(() => ({ available: false }));
      setStatus(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load AI Ops status");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const lessons = status?.lessons ?? {};
  const lessonTotal = Object.values(lessons).reduce((a, b) => a + (b ?? 0), 0);
  const hitRate = status?.validation?.total
    ? ((status.validation.hits / status.validation.total) * 100).toFixed(1)
    : "—";
  const hitColor =
    status?.validation?.total && status.validation.hit_rate >= 0.5
      ? SIGNAL_VAR.strongBuy
      : SIGNAL_VAR.strongSell;

  return (
    <div className="w-full max-w-[1100px]">
      {/* Header */}
      <FadeIn delay={0.05}>
        <Card className="mb-4 border-2 border-primary">
          <CardContent className="p-6">
            <div className="flex flex-col sm:flex-row gap-4 items-start justify-between">
              <div>
                <div className="flex items-center gap-3 mb-1">
                  <h2 className="text-2xl font-extrabold gradient-text">AI Ops &amp; Learning</h2>
                  <Badge className="font-semibold rounded-md bg-primary text-white">
                    <Brain className="h-3 w-3 mr-1" /> Auto Pilot · Learning
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground max-w-xl">
                  Morning prediction → evening validation → continuous learning. Runs locally on the
                  Mac via the AIOps engine; this view shows live status when <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">aiops serve</code> is running.
                </p>
              </div>
              <div className="flex gap-2 shrink-0 flex-wrap">
                <Button variant="outline" onClick={fetchStatus} disabled={loading} className="gap-2">
                  <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </FadeIn>

      {error && (
        <div className="border-l-4 border-strong-sell bg-strong-sell/10 p-3 rounded mb-4 text-sm text-strong-sell">{error}</div>
      )}

      {loading ? (
        <div className="w-full flex flex-col items-center justify-center py-12 text-muted-foreground gap-4">
          <div className="w-9 h-9 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-sm">Loading AI Ops...</p>
        </div>
      ) : !status?.available ? (
        /* ── Local-only guidance panel (deployed mode / server not running) ── */
        <FadeIn delay={0.1}>
          <Card className="border-border">
            <CardContent className="p-10 text-center">
              <Terminal className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <h3 className="text-lg font-bold mb-1">AI Ops runs locally</h3>
              <p className="text-sm text-muted-foreground max-w-md mx-auto mb-4">
                The AIOps learning engine lives on your Mac (local SQLite + OpenCode LLM). Start it
                to see live status here.
              </p>
              <div className="text-left max-w-md mx-auto bg-muted rounded-lg p-4 font-mono text-xs space-y-1.5 mb-4">
                <p><span className="text-muted-foreground"># from the platform repo</span></p>
                <p>cd vijaymaruthi/aiops</p>
                <p>python3 -m aiops.cli.main init</p>
                <p>python3 -m aiops.cli.main morning</p>
                <p>python3 -m aiops.cli.main evening</p>
                <p>python3 -m aiops.cli.main serve</p>
              </div>
              <p className="text-xs text-muted-foreground">
                Then refresh this page — live status appears here. The ADK Web UI opens at the URL
                shown by <code className="font-mono">aiops serve</code>.
              </p>
            </CardContent>
          </Card>
        </FadeIn>
      ) : (
        <>
          {/* Stats */}
          <FadeIn delay={0.1}>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
              <StatCard label="Last Morning Run" value={lastRun(status.runs, "morning")} sub="Prediction as-of D 09:00" />
              <StatCard label="Last Evening Run" value={lastRun(status.runs, "evening")} sub="Validation as-of D 16:00" />
              <StatCard label="Next Scheduled" value={status.next_scheduled ?? "Not configured"} sub="Manual CLI runs only" />
              <StatCard label="Hit Rate" value={`${hitRate}%`} sub={`${status.validation?.hits ?? 0}/${status.validation?.total ?? 0} validated`} color={hitColor} />
            </div>
          </FadeIn>

          {/* Knowledge + actions */}
          <FadeIn delay={0.15}>
            <Card className="mb-4 border-border">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
                  <Activity className="h-4 w-4 text-primary" /> Knowledge &amp; Actions
                </CardTitle>
                <CardDescription className="text-xs">
                  Version identity + content integrity hashes; the ADK Web UI opens the full agent console.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-3">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
                  <StatCard label="Prompt" value={status.prompt_version ?? "—"} sub={status.prompt_version ? "analysis-v1" : undefined} />
                  <StatCard label="Knowledge" value={String(status.knowledge_version ?? 0)} sub={status.knowledge_hash ? status.knowledge_hash.slice(0, 12) : "no hash"} />
                  <StatCard label="Predictions" value={String(status.predictions ?? 0)} sub="stored, immutable" />
                  <StatCard label="Lessons" value={String(lessonTotal)} sub={`${lessons.accepted ?? 0} accepted`} />
                </div>
                {status.adk_ui_url && (
                  <a
                    href={status.adk_ui_url}
                    target="_blank"
                    rel="noreferrer"
                    className={cn(buttonVariants({ variant: "outline" }), "gap-2")}
                  >
                    <ExternalLink className="h-4 w-4" /> Open ADK Web UI
                  </a>
                )}
              </CardContent>
            </Card>
          </FadeIn>

          {/* Recent runs */}
          <FadeIn delay={0.2}>
            <Card className="mb-4 border-border">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
                  <CalendarClock className="h-4 w-4 text-primary" /> Recent Runs
                </CardTitle>
              </CardHeader>
              <CardContent className="p-2.5">
                {(status.runs ?? []).length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-6">No runs yet.</p>
                ) : (
                  <div className="divide-y divide-border">
                    {(status.runs ?? []).slice(0, 8).map((r) => (
                      <div key={r.id} className="flex items-center gap-3 py-2 text-xs">
                        <Badge variant="outline" className="font-mono uppercase">{r.run_type}</Badge>
                        <span className="font-mono">{r.run_date}</span>
                        <span className="text-muted-foreground">{r.as_of ? new Date(r.as_of).toLocaleString() : ""}</span>
                        <span className="ml-auto">
                          {r.status === "completed" ? (
                            <span className="text-strong-buy font-semibold">completed</span>
                          ) : r.status === "failed" ? (
                            <span className="text-strong-sell font-semibold">failed</span>
                          ) : (
                            <span className="text-hold font-semibold">running</span>
                          )}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </FadeIn>

          {/* Calibration */}
          <FadeIn delay={0.25}>
            <Card className="border-border">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
                  <Target className="h-4 w-4 text-primary" /> Calibration
                </CardTitle>
                <CardDescription className="text-xs">
                  Per-symbol confidence buckets — how often each confidence band actually hit.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-2.5">
                {(status.calibration ?? []).length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-6">No calibration data yet.</p>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
                    {(status.calibration ?? []).slice(0, 16).map((c) => {
                      const rate = c.hit_rate != null ? (c.hit_rate * 100).toFixed(0) : "—";
                      const color = c.hit_rate != null ? (c.hit_rate >= 0.5 ? SIGNAL_VAR.strongBuy : SIGNAL_VAR.strongSell) : undefined;
                      return (
                        <div key={`${c.symbol}-${c.bucket}`} className="flex items-center gap-2 py-1.5 px-2 rounded bg-muted/40 text-xs">
                          <span className="font-semibold min-w-[90px]">{c.symbol.replace(".NS", "")}</span>
                          <span className="font-mono text-muted-foreground">{c.bucket}</span>
                          <span className="text-muted-foreground">n={c.n}</span>
                          <span className="ml-auto font-bold" style={{ color }}>{rate}%</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </FadeIn>
        </>
      )}
    </div>
  );
}