"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  Home,
  TrendingUp,
  TrendingDown,
  Minus,
  Database,
  BarChart3,
  Flame,
  Layers,
  Activity,
  RefreshCw,
  ScanSearch,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

import { api } from "@/lib/api";
import type { MarketResponse, SectorPhase, SectorStat, PatternSummary } from "@/lib/types";
import { PATTERN_LABELS } from "@/lib/patterns";
import { INDIAN_WATCHLIST } from "@/lib/types";

function StatCard({
  title,
  value,
  subtitle,
  color,
  icon,
}: {
  title: string;
  value: string | number;
  subtitle?: string;
  color: string;
  icon: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-[0.7rem] font-semibold uppercase tracking-wider text-muted-foreground">
              {title}
            </p>
            <p className={cn("text-[2rem] font-bold leading-tight mt-1", color)}>
              {value}
            </p>
            {subtitle && (
              <p className="mt-0.5 block text-[0.7rem] text-muted-foreground">
                {subtitle}
              </p>
            )}
          </div>
          <div className={cn(color, "opacity-30")}>{icon}</div>
        </div>
      </CardContent>
    </Card>
  );
}

const PHASE_STYLE: Record<SectorPhase, { badge: string; dot: string; label: string }> = {
  Leading: { badge: "bg-green-600/15 text-green-600", dot: "bg-green-600", label: "text-green-600" },
  Improving: { badge: "bg-blue-600/15 text-blue-600", dot: "bg-blue-600", label: "text-blue-600" },
  Weakening: { badge: "bg-amber-500/15 text-amber-500", dot: "bg-amber-500", label: "text-amber-500" },
  Lagging: { badge: "bg-red-600/15 text-red-600", dot: "bg-red-600", label: "text-red-600" },
};

function PhaseBadge({ phase }: { phase: SectorPhase }) {
  const s = PHASE_STYLE[phase];
  return (
    <Badge className={cn("h-[18px] text-[0.6rem] font-semibold", s.badge)}>
      <span className={cn("mr-1 h-1.5 w-1.5 rounded-full", s.dot)} />
      {phase}
    </Badge>
  );
}

function rsColor(pct: number) {
  if (pct >= 80) return "text-green-600";
  if (pct >= 60) return "text-blue-600";
  if (pct >= 40) return "text-amber-500";
  return "text-red-600";
}

function SectorRow({ s, index }: { s: SectorStat; index: number }) {
  return (
    <div className="grid grid-cols-12 items-center gap-2 border-b border-border/60 px-3 py-2.5 text-xs last:border-0">
      <div className="col-span-3 flex items-center gap-2">
        <span className="w-5 text-right text-[0.65rem] text-muted-foreground">{index + 1}</span>
        <span className="font-semibold">{s.sector}</span>
        <span className="text-[0.65rem] text-muted-foreground">({s.count})</span>
      </div>
      <div className="col-span-2">
        <span className={cn("font-bold tabular-nums", rsColor(s.rs_percentile))}>
          {s.rs_percentile}
        </span>
        <span className="text-[0.6rem] text-muted-foreground"> /99</span>
      </div>
      <div className="col-span-2 text-right tabular-nums">
        <span className="font-semibold">{s.avg_qm_score.toFixed(1)}</span>
        <span className="text-[0.6rem] text-muted-foreground"> QM</span>
      </div>
      <div className="col-span-2">
        <div className="flex items-center gap-1.5">
          <Progress
            value={Math.min(100, s.buy_pct)}
            className="h-1.5 flex-1 [&>[data-slot=progress-track]]:bg-muted [&>[data-slot=progress-track]]:rounded-full [&>[data-slot=progress-indicator]]:rounded-full [&>[data-slot=progress-indicator]]:bg-green-600"
          />
          <span className="w-9 text-right tabular-nums text-muted-foreground">
            {s.buy_pct.toFixed(0)}%
          </span>
        </div>
      </div>
      <div className="col-span-2">
        <div className="flex items-center gap-1.5">
          <Progress
            value={Math.min(100, s.improving_pct)}
            className="h-1.5 flex-1 [&>[data-slot=progress-track]]:bg-muted [&>[data-slot=progress-track]]:rounded-full [&>[data-slot=progress-indicator]]:rounded-full [&>[data-slot=progress-indicator]]:bg-blue-600"
          />
          <span className="w-9 text-right tabular-nums text-muted-foreground">
            {s.improving_pct.toFixed(0)}%
          </span>
        </div>
      </div>
      <div className="col-span-1 flex justify-end">
        <PhaseBadge phase={s.phase} />
      </div>
    </div>
  );
}

/** Chart Pattern Scan (Tier 2) — engine patterns across the NSE watchlist.
 *  Self-contained so it renders even when the Supabase market snapshot is
 *  unavailable (local mode): the scan only needs the local Python engine. */
function PatternScanSection() {
  const router = useRouter();
  const [scanRows, setScanRows] = useState<{ ticker: string; patterns: PatternSummary[] }[]>([]);
  const [scanLoading, setScanLoading] = useState(true);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanFilter, setScanFilter] = useState<{ type: string; direction: string; status: string }>({
    type: "all", direction: "all", status: "all",
  });

  const loadPatternScan = async () => {
    setScanLoading(true);
    setScanError(null);
    try {
      const res = await api.analyzeBatch([...INDIAN_WATCHLIST], "1y");
      const rows = (res.rows ?? [])
        .map((r) => ({ ticker: r.ticker, patterns: r.detected_patterns ?? [] }))
        .filter((r) => r.patterns.length > 0);
      setScanRows(rows);
    } catch (e) {
      setScanError(e instanceof Error ? e.message : "Pattern scan failed");
    } finally {
      setScanLoading(false);
    }
  };

  useEffect(() => {
    loadPatternScan();
  }, []);

  const scanTypes = useMemo(() => {
    const s = new Set<string>();
    scanRows.forEach((r) => r.patterns.forEach((p) => s.add(p.type)));
    return Array.from(s).sort();
  }, [scanRows]);

  const filteredScan = useMemo(() => {
    return scanRows
      .map((r) => ({
        ...r,
        patterns: r.patterns.filter(
          (p) =>
            (scanFilter.type === "all" || p.type === scanFilter.type) &&
            (scanFilter.direction === "all" || p.direction === scanFilter.direction) &&
            (scanFilter.status === "all" || p.status === scanFilter.status),
        ),
      }))
      .filter((r) => r.patterns.length > 0)
      .sort((a, b) => Math.max(...b.patterns.map((p) => p.confidence)) - Math.max(...a.patterns.map((p) => p.confidence)));
  }, [scanRows, scanFilter]);

  return (
    <Card className="mb-3">
      <CardContent className="p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="flex items-center gap-1.5 text-sm font-semibold">
              <ScanSearch className="size-4 text-primary" />
              Chart Pattern Scan
            </h3>
            <p className="text-[0.65rem] text-muted-foreground">
              Institutional engine patterns across the NSE watchlist — click a row to open the chart
            </p>
          </div>
          <button
            onClick={loadPatternScan}
            disabled={scanLoading}
            className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[0.65rem] font-medium text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            <RefreshCw className={cn("size-3", scanLoading && "animate-spin")} />
            Refresh
          </button>
        </div>

        {/* Filters */}
        <div className="mb-2 flex flex-wrap items-center gap-2 text-[0.65rem]">
          <select
            value={scanFilter.type}
            onChange={(e) => setScanFilter({ ...scanFilter, type: e.target.value })}
            className="rounded border border-border bg-card px-2 py-1 text-xs"
          >
            <option value="all">All types</option>
            {scanTypes.map((t) => (
              <option key={t} value={t}>{PATTERN_LABELS[t as keyof typeof PATTERN_LABELS]?.full ?? t}</option>
            ))}
          </select>
          <select
            value={scanFilter.direction}
            onChange={(e) => setScanFilter({ ...scanFilter, direction: e.target.value })}
            className="rounded border border-border bg-card px-2 py-1 text-xs"
          >
            <option value="all">All directions</option>
            <option value="bullish">Bullish</option>
            <option value="bearish">Bearish</option>
          </select>
          <select
            value={scanFilter.status}
            onChange={(e) => setScanFilter({ ...scanFilter, status: e.target.value })}
            className="rounded border border-border bg-card px-2 py-1 text-xs"
          >
            <option value="all">All statuses</option>
            <option value="forming">Forming</option>
            <option value="active">Active</option>
            <option value="completed">Completed</option>
            <option value="failed">Failed</option>
          </select>
          <span className="text-muted-foreground">
            {filteredScan.length} stock{filteredScan.length !== 1 ? "s" : ""} with patterns
          </span>
        </div>

        {scanLoading ? (
          <div className="flex justify-center py-6">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : scanError ? (
          <p className="py-4 text-center text-xs text-destructive">{scanError}</p>
        ) : filteredScan.length === 0 ? (
          <p className="py-4 text-center text-xs text-muted-foreground">
            No patterns match the current filters
          </p>
        ) : (
          <div className="grid grid-cols-12 items-center gap-2 border-b border-border px-3 pb-2 text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
            <div className="col-span-3">Ticker</div>
            <div className="col-span-6">Patterns</div>
            <div className="col-span-3 text-right">Confidence</div>
          </div>
        )}
        {!scanLoading && !scanError && filteredScan.map((r) => (
          <div
            key={r.ticker}
            onClick={() => router.push(`/stock/${encodeURIComponent(r.ticker)}`)}
            className="grid grid-cols-12 items-center gap-2 border-b border-border/60 px-3 py-2 text-xs last:border-0 hover:bg-muted/30 cursor-pointer"
          >
            <div className="col-span-3">
              <span className="font-semibold">{r.ticker.replace(/\.(NS|BO)$/i, "")}</span>
              <span className="ml-1 text-[0.6rem] text-muted-foreground">{r.ticker}</span>
            </div>
            <div className="col-span-6 flex flex-wrap gap-1">
              {r.patterns.map((p, i) => {
                const meta = PATTERN_LABELS[p.type as keyof typeof PATTERN_LABELS];
                const bullish = p.direction === "bullish";
                return (
                  <span
                    key={`${p.type}-${i}`}
                    title={`${meta?.full ?? p.type} · ${p.status}`}
                    className={cn(
                      "inline-flex items-center rounded border px-1.5 py-0.5 text-[0.6rem] font-semibold",
                      bullish
                        ? "border-strong-buy/30 bg-strong-buy/10 text-strong-buy"
                        : "border-strong-sell/30 bg-strong-sell/10 text-strong-sell",
                    )}
                  >
                    {meta?.abbr ?? p.type.replace(/_/g, " ").toUpperCase()}
                    <span className="ml-1 opacity-70">{p.confidence}%</span>
                  </span>
                );
              })}
            </div>
            <div className="col-span-3 text-right tabular-nums font-semibold">
              {Math.max(...r.patterns.map((p) => p.confidence))}%
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export default function MarketPage() {
  const router = useRouter();
  const [data, setData] = useState<MarketResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getMarket()
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load market data"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="w-full max-w-[1200px] flex justify-center py-8">
        <div className="flex flex-col items-center gap-1">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <span className="text-xs text-muted-foreground">Loading market breadth…</span>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="w-full max-w-[1200px]">
        <nav className="mb-1 flex items-center gap-1 text-xs text-muted-foreground">
          <span onClick={() => router.push("/")} className="flex cursor-pointer items-center gap-1 hover:text-foreground">
            <Home size={14} />
            <span>Home</span>
          </span>
          <span className="text-foreground font-semibold">Market</span>
        </nav>
        <Card className="mt-4">
          <CardContent className="p-6 text-center">
            <p className="text-sm font-semibold text-destructive">Unable to load market data</p>
            <p className="mt-1 text-xs text-muted-foreground">{error ?? "Unknown error"}</p>
            <p className="mt-2 text-xs text-muted-foreground">
              This feature requires the deployed (Supabase) data mode. Run the Mac sync, then refresh.
            </p>
          </CardContent>
        </Card>
        {/* Pattern scan still works in local mode — engine is reachable */}
        <div className="mt-3">
          <PatternScanSection />
        </div>
      </div>
    );
  }

  const b = data.breadth;
  const buyPct = b.total > 0 ? (b.buy / b.total) * 100 : 0;
  const improvingPct = b.total > 0 ? (b.improving / b.total) * 100 : 0;
  const leading = data.sectors.filter((s) => s.phase === "Leading").length;
  const lagging = data.sectors.filter((s) => s.phase === "Lagging").length;

  return (
    <div className="w-full max-w-[1200px]">
      <nav className="mb-1 flex items-center gap-1 text-xs text-muted-foreground">
        <span onClick={() => router.push("/")} className="flex cursor-pointer items-center gap-1 hover:text-foreground">
          <Home size={14} />
          <span>Home</span>
        </span>
        <span className="text-foreground font-semibold">Market</span>
      </nav>

      <div className="mb-3 flex items-center justify-between">
        <div>
          <h1 className="text-[1.6rem] font-bold tracking-tight">
            Market Rotation & Relative Strength
          </h1>
          <p className="text-xs text-muted-foreground">
            Sector-level breadth and momentum across the analysed NSE universe
          </p>
        </div>
      </div>

      {/* ── Market-wide breadth stat cards ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2 mb-3">
        <StatCard title="Analysed Stocks" value={b.total} icon={<Database size={28} />} color="text-primary" subtitle="with sector mapping" />
        <StatCard title="Buy Breadth" value={`${buyPct.toFixed(1)}%`} icon={<TrendingUp size={28} />} color="text-green-600" subtitle={`${b.buy} of ${b.total} rated Buy`} />
        <StatCard title="Improving" value={`${improvingPct.toFixed(1)}%`} icon={<Activity size={28} />} color="text-blue-600" subtitle={`${b.improving} stocks improving`} />
        <StatCard title="Avg QM Score" value={b.avg_qm_score.toFixed(1)} icon={<BarChart3 size={28} />} color="text-amber-500" subtitle="market-wide blended score" />
      </div>

      {/* ── Rotation summary ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-3">
        <Card className="border-green-600/30 opacity-85">
          <CardContent className="p-5">
            <div className="flex items-center gap-2">
              <Flame className="text-green-600" size={20} />
              <div>
                <p className="text-[1.5rem] font-bold leading-tight text-green-600">{leading}</p>
                <p className="text-[0.7rem] text-muted-foreground">Leading sectors</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-blue-600/30 opacity-85">
          <CardContent className="p-5">
            <div className="flex items-center gap-2">
              <Layers className="text-blue-600" size={20} />
              <div>
                <p className="text-[1.5rem] font-bold leading-tight text-blue-600">
                  {data.sectors.filter((s) => s.phase === "Improving").length}
                </p>
                <p className="text-[0.7rem] text-muted-foreground">Improving sectors</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-red-600/30 opacity-85">
          <CardContent className="p-5">
            <div className="flex items-center gap-2">
              <TrendingDown className="text-red-600" size={20} />
              <div>
                <p className="text-[1.5rem] font-bold leading-tight text-red-600">{lagging}</p>
                <p className="text-[0.7rem] text-muted-foreground">Lagging sectors</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Sector RS table ── */}
      <Card className="mb-3">
        <CardContent className="p-4">
          <h3 className="mb-2 text-sm font-semibold">Sector Relative Strength</h3>
          <div className="grid grid-cols-12 items-center gap-2 border-b border-border px-3 pb-2 text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
            <div className="col-span-3">Sector</div>
            <div className="col-span-2">RS Rank</div>
            <div className="col-span-2 text-right">Avg QM</div>
            <div className="col-span-2">Buy Breadth</div>
            <div className="col-span-2">Improving</div>
            <div className="col-span-1 text-right">Phase</div>
          </div>
          {data.sectors.map((s, i) => (
            <SectorRow key={s.sector} s={s} index={i} />
          ))}
        </CardContent>
      </Card>

      {/* ── Rotation heatmap ── */}
      <Card className="mb-3">
        <CardContent className="p-4">
          <h3 className="mb-2 text-sm font-semibold">Rotation Heatmap</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
            {data.sectors.map((s) => {
              const st = PHASE_STYLE[s.phase];
              return (
                <div
                  key={s.sector}
                  className={cn(
                    "rounded-lg border p-2.5",
                    s.phase === "Leading" && "border-green-600/40 bg-green-600/5",
                    s.phase === "Improving" && "border-blue-600/40 bg-blue-600/5",
                    s.phase === "Weakening" && "border-amber-500/40 bg-amber-500/5",
                    s.phase === "Lagging" && "border-red-600/40 bg-red-600/5",
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[0.7rem] font-semibold leading-tight">{s.sector}</span>
                    <span className={cn("h-2 w-2 rounded-full", st.dot)} />
                  </div>
                  <div className="mt-1.5 flex items-baseline justify-between">
                    <span className={cn("text-[1.1rem] font-bold tabular-nums", st.label)}>
                      {s.rs_percentile}
                    </span>
                    <span className="text-[0.6rem] text-muted-foreground">RS</span>
                  </div>
                  <div className="mt-0.5 text-[0.6rem] text-muted-foreground">
                    {s.count} stocks · {s.buy_pct.toFixed(0)}% buy
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* ── Breakout ledger ── */}
      <Card>
        <CardContent className="p-4">
          <h3 className="mb-2 text-sm font-semibold">Breakout Ledger — Top Movers</h3>
          <div className="grid grid-cols-12 items-center gap-2 border-b border-border px-3 pb-2 text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
            <div className="col-span-3">Ticker</div>
            <div className="col-span-2 text-right">QM Score</div>
            <div className="col-span-2 text-right">Δ Score</div>
            <div className="col-span-2 text-right">Tech</div>
            <div className="col-span-2 text-right">Trend</div>
            <div className="col-span-1 text-right">Rating</div>
          </div>
          {data.breakout_ledger.map((t) => (
            <div
              key={t.ticker}
              className="grid grid-cols-12 items-center gap-2 border-b border-border/60 px-3 py-2 text-xs last:border-0"
            >
              <div className="col-span-3">
                <span className="font-semibold">{t.ticker.replace(/\.(NS|BO)$/i, "")}</span>
                <span className="ml-1 text-[0.6rem] text-muted-foreground">{t.cap_category}</span>
              </div>
              <div className="col-span-2 text-right tabular-nums font-semibold">{t.qm_score.toFixed(1)}</div>
              <div className={cn("col-span-2 text-right tabular-nums font-semibold", t.score_change >= 0 ? "text-green-600" : "text-red-600")}>
                {t.score_change >= 0 ? "+" : ""}
                {t.score_change.toFixed(1)}
              </div>
              <div className="col-span-2 text-right tabular-nums">{t.tech_score.toFixed(1)}</div>
              <div className="col-span-2 text-right">
                {t.trend === "improving" ? (
                  <span className="text-green-600">▲ Improving</span>
                ) : t.trend === "deteriorating" ? (
                  <span className="text-red-600">▼ Deteriorating</span>
                ) : (
                  <span className="text-muted-foreground">— Stable</span>
                )}
              </div>
              <div className="col-span-1 text-right">
                <Badge
                  variant="outline"
                  className={cn(
                    "h-[18px] text-[0.6rem] font-semibold",
                    (t.qm_rating === "Strong Buy" || t.qm_rating === "Buy") && "text-green-600",
                    t.qm_rating === "Hold" && "text-amber-500",
                    (t.qm_rating === "Sell" || t.qm_rating === "Strong Sell") && "text-red-600",
                  )}
                >
                  {t.qm_rating}
                </Badge>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* ── Chart Pattern Scan (Tier 2) ── */}
      <PatternScanSection />

      <p className="block text-center pt-3 text-[0.7rem] text-muted-foreground/50">
        Sector RS = percentile rank (1-99) of each sector&apos;s average blended QM score across all sectors.
        Breadth = % of sector stocks rated Buy / improving. Rotation phase derived from strength + breadth.
        Data from the most recent NSE analysis sync.
      </p>
    </div>
  );
}
