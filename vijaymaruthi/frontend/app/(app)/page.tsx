"use client";

import * as React from "react";
import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  RefreshCw,
  TrendingUp,
  TrendingDown,
  Minus,
  Database,
  ListChecks,
  Clock,
  ChevronRight,
  Search,
  ArrowUpDown,
  Filter,
  FileText,
  CircleCheck,
  CircleX,
  Home,
  Wallet,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from "@/components/ui/tooltip";
import { api } from "@/lib/api";
import { useScan } from "@/lib/scan-context";
import { useMarketData } from "@/lib/use-market";
import type { DashboardRow, DashboardResponse } from "@/lib/types";
import { formatPrice } from "@/lib/humaniser";
import { signalHex } from "@/lib/theme";
import { cn } from "@/lib/utils";
import FadeIn from "@/components/animations/FadeIn";
import StaggerChildren from "@/components/animations/StaggerChildren";
import { staggerItem } from "@/components/animations/StaggerChildren";
import SpendingSnapshot from "@/components/ledger/SpendingSnapshot";
import MarketOverviewStrip from "@/components/market/MarketOverviewStrip";
import SectorRail from "@/components/market/SectorRail";
import TopOpportunities from "@/components/market/TopOpportunities";
import StockDrawer from "@/components/StockDrawer";

// ─── Scroll-driven table loading ───
const TABLE_PAGE_SIZE = 50;
const SCROLL_LOAD_THRESHOLD = 240;

// ─── Spinner ───
function Spinner({ size = 16 }: { size?: number }) {
  return (
    <svg
      className="animate-spin"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}

// ─── Score band helpers ───

function scoreBandLabel(score: number): string {
  if (score >= 90) return "Exceptional";
  if (score >= 80) return "Strong";
  if (score >= 70) return "Good";
  if (score >= 60) return "Neutral";
  return "Weak";
}

function scoreKind(score: number): "strongBuy" | "hold" | "strongSell" {
  if (score >= 80) return "strongBuy";
  if (score >= 60) return "hold";
  return "strongSell";
}

// ─── Scanner filters (spec 18: Signal / Score / Market Cap / Risk) ───

type SignalKey = "buy" | "hold" | "sell";
type RiskKey = "low" | "medium" | "high";

type FilterState = {
  signals: Set<SignalKey>;
  caps: Set<string>;
  risks: Set<RiskKey>;
  minScore: number;
  maxScore: number;
};

function signalKey(rating: string): SignalKey {
  if (rating === "Strong Buy" || rating === "Buy") return "buy";
  if (rating === "Sell" || rating === "Strong Sell") return "sell";
  return "hold";
}

function riskKey(score: number): RiskKey {
  if (score >= 80) return "low";
  if (score >= 60) return "medium";
  return "high";
}

function activeFilterCount(f: FilterState): number {
  let n = 0;
  if (f.signals.size > 0) n += 1;
  if (f.caps.size > 0) n += 1;
  if (f.risks.size > 0) n += 1;
  if (f.minScore > 0 || f.maxScore < 100) n += 1;
  return n;
}

const EMPTY_FILTERS: FilterState = {
  signals: new Set(),
  caps: new Set(),
  risks: new Set(),
  minScore: 0,
  maxScore: 100,
};

// Human-readable sort labels (spec 17: "Sort by: Score ↓", never raw values)
const SORT_LABELS: Record<string, string> = {
  "score-desc": "Score ↓",
  "score-asc": "Score ↑",
  alpha: "A – Z",
  "alpha-rev": "Z – A",
  "price-desc": "Price ↓",
  "price-asc": "Price ↑",
};

// ─── Metric card (analytical layout) ───

function MetricCard({
  title,
  value,
  color,
  selected,
  onClick,
  breakdown,
  trend,
}: {
  title: string;
  value: number;
  color: string;
  selected: boolean;
  onClick: () => void;
  breakdown: { strong: number; moderate: number; weak: number };
  trend: { dir: "up" | "down" | "flat"; delta: number };
}) {
  return (
    <Card
      onClick={onClick}
      size="sm"
      className={cn(
        "flex-1 cursor-pointer transition-all duration-150 [--card-spacing:--spacing(2)]",
        selected ? "ring-1 ring-primary/40" : "hover:border-foreground/25",
      )}
      style={{ borderColor: selected ? color : undefined }}
    >
      <CardContent className="p-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[0.6rem] font-semibold uppercase tracking-[0.8px] text-muted-foreground">
            {title}
          </p>
          {trend.dir !== "flat" && (
            <span
              className={cn(
                "inline-flex items-center gap-0.5 text-[0.62rem] font-bold tabular-nums",
                trend.dir === "up" ? "text-strong-buy" : "text-strong-sell",
              )}
            >
              {trend.dir === "up" ? "↗" : "↘"} {trend.delta >= 0 ? "+" : ""}
              {trend.delta}
            </span>
          )}
        </div>
        <div className="mt-1 flex items-baseline gap-1.5">
          <p className="text-[1.7rem] font-extrabold leading-none tabular-nums" style={{ color }}>
            {value}
          </p>
          <span className="text-[0.62rem] font-medium text-muted-foreground">Stocks</span>
        </div>
        <div className="mt-1.5 truncate text-[0.58rem] text-muted-foreground/70">
          {breakdown.strong} Strong · {breakdown.moderate} Moderate · {breakdown.weak} Weak
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Score bar (score / 100 + band) ───

function ScoreBar({ score }: { score: number }) {
  const kind = scoreKind(score);
  const color = kind === "strongBuy" ? "bg-strong-buy" : kind === "hold" ? "bg-hold" : "bg-strong-sell";
  const textColor = kind === "strongBuy" ? "text-strong-buy" : kind === "hold" ? "text-hold" : "text-strong-sell";
  return (
    <div className="flex min-w-[120px] flex-col gap-1">
      <div className="flex items-baseline gap-1">
        <span className={cn("text-sm font-bold tabular-nums leading-none", textColor)}>
          {score.toFixed(0)}
        </span>
        <span className="text-[0.58rem] text-muted-foreground">/ 100</span>
        <span className="ml-auto text-[0.58rem] font-medium text-muted-foreground">
          {scoreBandLabel(score)}
        </span>
      </div>
      <div className="relative h-[4px] w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn("absolute inset-y-0 left-0 rounded-full", color)}
          style={{ width: `${Math.min(score, 100)}%` }}
        />
      </div>
    </div>
  );
}

// ─── Tier badge (tinted, with indicator dot) ───

function TierBadge({ score }: { score: number }) {
  const tier = score >= 80 ? "Strong" : score >= 60 ? "Moderate" : "Weak";
  const kind = scoreKind(score);
  const cls =
    kind === "strongBuy"
      ? "border-strong-buy/30 bg-strong-buy/10 text-strong-buy"
      : kind === "hold"
        ? "border-hold/30 bg-hold/10 text-hold"
        : "border-strong-sell/30 bg-strong-sell/10 text-strong-sell";
  return (
    <Badge variant="outline" className={cn("min-w-[68px] justify-center gap-1 rounded-[6px] text-[0.62rem] font-bold", cls)}>
      <span className="size-1.5 rounded-full" style={{ backgroundColor: signalHex(kind) }} />
      {tier}
    </Badge>
  );
}

// ─── Signal chip (spec 22: tinted bg + 1px border + dot, "● CAN BUY") ───

function SignalChip({ rating }: { rating: string }) {
  const kind =
    rating === "Strong Buy" || rating === "Buy"
      ? "strongBuy"
      : rating === "Sell" || rating === "Strong Sell"
        ? "strongSell"
        : "hold";
  const cls =
    kind === "strongBuy"
      ? "border-strong-buy/30 bg-strong-buy/10 text-strong-buy"
      : kind === "hold"
        ? "border-hold/30 bg-hold/10 text-hold"
        : "border-strong-sell/30 bg-strong-sell/10 text-strong-sell";
  const label =
    rating === "Strong Buy" || rating === "Buy" ? "Can Buy" : rating === "Sell" || rating === "Strong Sell" ? "Avoid" : "Hold";
  return (
    <Badge variant="outline" className={cn("gap-1 rounded-[6px] text-[0.68rem] font-bold uppercase tracking-wide", cls)}>
      <span className="size-1.5 rounded-full bg-current" />
      {label}
    </Badge>
  );
}

// ─── Trend chip ───

function TrendChip({ trend, change }: { trend: string; change: number }) {
  if (trend === "improving") {
    return (
      <Badge
        variant="outline"
        className="gap-1 border-strong-buy/30 bg-strong-buy/10 text-[0.68rem] font-semibold text-strong-buy"
      >
        <TrendingUp className="size-3.5" />+{change.toFixed(1)}
      </Badge>
    );
  }
  if (trend === "deteriorating") {
    return (
      <Badge
        variant="outline"
        className="gap-1 border-strong-sell/30 bg-strong-sell/10 text-[0.68rem] font-semibold text-strong-sell"
      >
        <TrendingDown className="size-3.5" />
        {change.toFixed(1)}
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="gap-1 text-[0.68rem] font-medium text-muted-foreground">
      <Minus className="size-3.5" />
      Stable
    </Badge>
  );
}

// ─── Skeleton blocks ───

function SkeletonKpis() {
  return (
    <div className="mb-3 flex flex-col gap-1.5 sm:flex-row sm:gap-2">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-[88px] flex-1 animate-pulse rounded-xl bg-surface ring-1 ring-border/60" />
      ))}
    </div>
  );
}

function SkeletonTable() {
  return (
    <div className="rounded-xl bg-surface p-3 ring-1 ring-border/60">
      <div className="mb-3 h-7 w-1/3 animate-pulse rounded bg-muted" />
      <div className="space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <div className="h-6 w-16 animate-pulse rounded bg-muted" />
            <div className="h-6 w-32 animate-pulse rounded bg-muted" />
            <div className="h-6 w-24 animate-pulse rounded bg-muted" />
            <div className="h-6 w-28 animate-pulse rounded bg-muted" />
            <div className="h-6 w-20 animate-pulse rounded bg-muted" />
            <div className="ml-auto h-6 w-16 animate-pulse rounded bg-muted" />
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main page ───

export default function DashboardPage() {
  const router = useRouter();
  const [rows, setRows] = useState<DashboardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<string>("score-desc");
  const [filters, setFilters] = useState<FilterState>({
    signals: new Set<SignalKey>(),
    caps: new Set<string>(),
    risks: new Set<RiskKey>(),
    minScore: 0,
    maxScore: 100,
  });
  const [searchQuery, setSearchQuery] = useState("");
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [dbEntries, setDbEntries] = useState(0);
  const [totalNse, setTotalNse] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);
  const [healthSummary, setHealthSummary] = useState<{ known: number; pass: number; fail: number } | null>(null);
  const [visibleCount, setVisibleCount] = useState(TABLE_PAGE_SIZE);
  const [selectedRow, setSelectedRow] = useState<DashboardRow | null>(null);

  // "updated Xs ago" — truthful timestamp of the last successful fetch
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // Global scan state from context
  const { isScanning, scanPct, scanProgress, scanType, startScanAll, startScanPending, registerDashboardRefresh } = useScan();

  // Market-wide intelligence (breadth / sectors / opportunities)
  const { data: marketData, loading: marketLoading } = useMarketData();

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const updatedAgo = useMemo(() => {
    if (!lastUpdatedAt) return "—";
    const s = Math.max(0, Math.floor((now - lastUpdatedAt) / 1000));
    if (s < 60) return "just now";
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    return `${Math.floor(s / 3600)}h ago`;
  }, [lastUpdatedAt, now]);

  // Seconds since last successful fetch — for "Data refreshed Xs ago"
  const refreshedAgo = useMemo(() => {
    if (!lastUpdatedAt) return null;
    return Math.max(0, Math.floor((now - lastUpdatedAt) / 1000));
  }, [lastUpdatedAt, now]);

  // ─── Validation sheet monitoring ───
  const VALIDATION_STORAGE_KEY = "vm_validation_rows";
  const [monitoredTickers, setMonitoredTickers] = useState<Set<string>>(new Set());

  useEffect(() => {
    try {
      const raw = localStorage.getItem(VALIDATION_STORAGE_KEY);
      if (raw) {
        const stored: DashboardRow[] = JSON.parse(raw);
        setMonitoredTickers(new Set(stored.map((r) => r.ticker)));
      }
    } catch { /* ignore */ }
  }, []);

  const toggleMonitor = (e: React.MouseEvent | null, row: DashboardRow) => {
    e?.stopPropagation();
    const isAdding = !monitoredTickers.has(row.ticker);
    setMonitoredTickers((prev) => {
      const next = new Set(prev);
      if (isAdding) next.add(row.ticker);
      else next.delete(row.ticker);
      return next;
    });
    try {
      const raw = localStorage.getItem(VALIDATION_STORAGE_KEY);
      const stored: DashboardRow[] = raw ? JSON.parse(raw) : [];
      if (isAdding) {
        if (!stored.some((r) => r.ticker === row.ticker)) stored.push(row);
      } else {
        const idx = stored.findIndex((r) => r.ticker === row.ticker);
        if (idx !== -1) stored.splice(idx, 1);
      }
      localStorage.setItem(VALIDATION_STORAGE_KEY, JSON.stringify(stored));
    } catch { /* ignore */ }
  };

  const fetchDashboard = async (force = false) => {
    setLoading(true);
    setError(null);
    try {
      const result: DashboardResponse = await api.getDashboard(force, "1y");
      setRows(result.rows);
      setGeneratedAt(result.generated_at);
      setDbEntries(result.db_entries);
      setTotalNse(result.total_nse_count);
      setPendingCount(result.pending_count ?? 0);
      setHealthSummary(result.health_summary ?? null);
      setLastUpdatedAt(Date.now());
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to fetch dashboard");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboard(false);
    registerDashboardRefresh(fetchDashboard);
  }, []);

  const handleStartScanAll = async () => {
    try {
      await startScanAll(totalNse, dbEntries);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to start NSE scan");
    }
  };

  const handleStartScanPending = async () => {
    try {
      await startScanPending(pendingCount);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to start pending NSE scan");
    }
  };

  const sortedRows = useMemo(() => {
    const buy: DashboardRow[] = [];
    const hold: DashboardRow[] = [];
    const sell: DashboardRow[] = [];
    const pri = (r: DashboardRow) => {
      if (r.qm_rating === "Strong Buy" || r.qm_rating === "Buy") return 0;
      if (r.qm_rating === "Hold") return 1;
      return 2;
    };
    for (const row of rows) {
      const p = pri(row);
      if (p === 0) buy.push(row);
      else if (p === 1) hold.push(row);
      else sell.push(row);
    }

    let sortFn: (a: DashboardRow, b: DashboardRow) => number;
    switch (sortBy) {
      case "score-asc": sortFn = (a, b) => a.qm_score - b.qm_score; break;
      case "alpha": sortFn = (a, b) => a.ticker.localeCompare(b.ticker); break;
      case "alpha-rev": sortFn = (a, b) => b.ticker.localeCompare(a.ticker); break;
      case "price-desc": sortFn = (a, b) => (b.price || 0) - (a.price || 0); break;
      case "price-asc": sortFn = (a, b) => (a.price || 0) - (b.price || 0); break;
      case "score-desc":
      default: sortFn = (a, b) => b.qm_score - a.qm_score; break;
    }
    buy.sort(sortFn);
    hold.sort(sortFn);
    sell.sort(sortFn);

    let ranked = [...buy, ...hold, ...sell].map((r, i) => ({ ...r, rank: i + 1 }));

    let filtered = ranked;
    if (filters.signals.size > 0) {
      filtered = filtered.filter((r) => filters.signals.has(signalKey(r.qm_rating)));
    }
    if (filters.caps.size > 0) {
      filtered = filtered.filter((r) => filters.caps.has(r.cap_category));
    }
    if (filters.risks.size > 0) {
      filtered = filtered.filter((r) => filters.risks.has(riskKey(r.qm_score)));
    }
    if (filters.minScore > 0 || filters.maxScore < 100) {
      filtered = filtered.filter((r) => r.qm_score >= filters.minScore && r.qm_score <= filters.maxScore);
    }

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter((r) =>
        r.ticker.toLowerCase().includes(q) ||
        r.qm_rating.toLowerCase().includes(q) ||
        r.cap_category.toLowerCase().includes(q) ||
        r.trend.toLowerCase().includes(q) ||
        r.tech_signal.toLowerCase().includes(q) ||
        r.fund_rating.toLowerCase().includes(q)
      );
    }

    return filtered;
  }, [rows, filters, sortBy, searchQuery]);

  useEffect(() => {
    setVisibleCount(TABLE_PAGE_SIZE);
  }, [rows, filters, sortBy, searchQuery]);

  const visibleRows = sortedRows.slice(0, visibleCount);

  const handleTableScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const remaining = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (remaining < SCROLL_LOAD_THRESHOLD) {
      setVisibleCount((c) => Math.min(c + TABLE_PAGE_SIZE, sortedRows.length));
    }
  };

  const isFundStrong = (r: DashboardRow) => r.fund_score >= 60;
  const buyRows = rows.filter((r) => r.qm_rating === "Strong Buy" || r.qm_rating === "Buy");
  const holdRows = rows.filter((r) => r.qm_rating === "Hold");
  const sellRows = rows.filter((r) => r.qm_rating === "Sell" || r.qm_rating === "Strong Sell");

  const bucketStats = (bucket: DashboardRow[]) => {
    const strong = bucket.filter((r) => r.qm_score >= 80).length;
    const moderate = bucket.filter((r) => r.qm_score >= 60 && r.qm_score < 80).length;
    const weak = bucket.filter((r) => r.qm_score < 60).length;
    const improving = bucket.filter((r) => r.trend === "improving").length;
    const deteriorating = bucket.filter((r) => r.trend === "deteriorating").length;
    const dir: "up" | "down" | "flat" =
      improving > deteriorating ? "up" : deteriorating > improving ? "down" : "flat";
    return { strong, moderate, weak, dir, delta: Math.abs(improving - deteriorating) };
  };

  const summary = {
    buy: { total: buyRows.length, ...bucketStats(buyRows) },
    hold: { total: holdRows.length, ...bucketStats(holdRows) },
    sell: { total: sellRows.length, ...bucketStats(sellRows) },
  };

  return (
    <TooltipProvider>
      <div className="w-full max-w-[1200px]">
        {/* Breadcrumb */}
        <FadeIn delay={0} direction="down">
          <nav className="mb-1 flex items-center gap-1" aria-label="breadcrumb">
            <button
              onClick={() => router.push("/")}
              className="flex items-center gap-1 text-muted-foreground hover:text-foreground text-[0.75rem] cursor-pointer"
            >
              <Home className="size-3.5" />
              <span>NSE</span>
            </button>
            <ChevronRight className="size-3 text-muted-foreground/50" />
            <span className="text-[0.75rem] font-semibold text-foreground">
              Market Intelligence
            </span>
          </nav>
        </FadeIn>

        {/* Header */}
        <FadeIn delay={0.05}>
          <div className="mb-3 flex flex-col items-start justify-between gap-2 md:flex-row md:items-end">
            <div>
              <h1 className="gradient-text text-[1.6rem] font-extrabold tracking-[-0.02em]">
                NSE Market Intelligence
              </h1>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1">
                <span className="inline-flex items-center gap-1.5 text-[0.68rem] font-bold uppercase tracking-[0.08em] text-primary">
                  <span className="relative flex size-1.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
                    <span className="relative inline-flex size-1.5 rounded-full bg-primary" />
                  </span>
                  Analysis Engine Active
                </span>
                <span className="text-muted-foreground/40">·</span>
                <span className="text-[0.68rem] text-muted-foreground">
                  <span className="font-semibold tabular-nums text-foreground/80">
                    {dbEntries.toLocaleString("en-IN")}
                  </span>
                  {" / "}
                  <span className="font-semibold tabular-nums text-foreground/80">
                    {totalNse.toLocaleString("en-IN")}
                  </span>
                  {" stocks analyzed"}
                </span>
                <span className="text-muted-foreground/40">·</span>
                <span className="inline-flex items-center gap-1 text-[0.68rem] text-muted-foreground">
                  <Clock className="size-3" />
                  Data refreshed{" "}
                  {refreshedAgo !== null && refreshedAgo < 60
                    ? `${refreshedAgo} sec ago`
                    : updatedAgo}
                </span>
                {isScanning && (
                  <Badge className="h-5 gap-1 font-semibold text-[0.65rem]">
                    <Spinner size={10} />
                    {scanPct}%
                  </Badge>
                )}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                variant="outline"
                className="h-6 gap-1.5 rounded-[6px] border-primary/30 bg-primary/5 px-2 font-mono text-[0.62rem] font-bold text-primary"
              >
                NSE
                <span className="relative flex size-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
                  <span className="relative inline-flex size-1.5 rounded-full bg-primary" />
                </span>
                LIVE
              </Badge>
              {!isScanning && (
                <>
                  <Button
                    size="sm"
                    className="gap-1.5 rounded-[6px] px-2.5 font-semibold"
                    onClick={handleStartScanAll}
                  >
                    <ListChecks className="size-3.5" />
                    Scan All NSE
                  </Button>
                  {pendingCount > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5 rounded-[6px] px-2.5 font-semibold"
                      onClick={handleStartScanPending}
                    >
                      Scan Pending NSE
                    </Button>
                  )}
                </>
              )}
              {!isScanning && dbEntries > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 rounded-[6px] px-2.5 font-semibold"
                  onClick={() => window.open(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8765/api/v1"}/export/report`, "_blank")}
                >
                  <FileText className="size-3.5" />
                  Export Report
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 rounded-[6px] px-2.5 font-semibold"
                onClick={() => fetchDashboard(false)}
                disabled={loading}
              >
                <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
                {loading ? "Loading…" : "Refresh"}
              </Button>
            </div>
          </div>
        </FadeIn>

        {/* ── Market overview (breadth / risk) ── */}
        {marketLoading ? (
          <div className="mb-2 h-16 animate-pulse rounded-xl bg-surface ring-1 ring-border/60" />
        ) : marketData ? (
          <>
            <div className="mb-2">
              <MarketOverviewStrip
                breadth={marketData.breadth}
                generatedAt={marketData.generated_at}
                sectors={marketData.sectors}
                indices={marketData.indices}
              />
            </div>
            <div className="mb-2 grid grid-cols-1 gap-2 lg:grid-cols-2 lg:items-start">
              <div className={marketData.sectors.length === 0 ? "lg:col-span-2" : ""}>
                <TopOpportunities rows={rows} onSelect={setSelectedRow} />
              </div>
              <SectorRail sectors={marketData.sectors} />
            </div>
          </>
        ) : null}

        {/* ── KPI cards (scanner filters) ── */}
        {loading ? (
          <SkeletonKpis />
        ) : (
          <StaggerChildren stagger={0.08}>
            <div className="mb-3 flex flex-col gap-1.5 sm:flex-row sm:gap-2">
              <motion.div variants={staggerItem} className="flex-1">
                <MetricCard
                  title="Can Buy"
                  value={summary.buy.total}
                  color={signalHex("strongBuy")}
                  selected={filters.signals.has("buy")}
                  onClick={() =>
                    setFilters((f) => ({
                      ...f,
                      signals: f.signals.has("buy") ? new Set() : new Set(["buy"]),
                    }))
                  }
                  breakdown={{ strong: summary.buy.strong, moderate: summary.buy.moderate, weak: summary.buy.weak }}
                  trend={{ dir: summary.buy.dir, delta: summary.buy.delta }}
                />
              </motion.div>
              <motion.div variants={staggerItem} className="flex-1">
                <MetricCard
                  title="Hold"
                  value={summary.hold.total}
                  color={signalHex("hold")}
                  selected={filters.signals.has("hold")}
                  onClick={() =>
                    setFilters((f) => ({
                      ...f,
                      signals: f.signals.has("hold") ? new Set() : new Set(["hold"]),
                    }))
                  }
                  breakdown={{ strong: summary.hold.strong, moderate: summary.hold.moderate, weak: summary.hold.weak }}
                  trend={{ dir: summary.hold.dir, delta: summary.hold.delta }}
                />
              </motion.div>
              <motion.div variants={staggerItem} className="flex-1">
                <MetricCard
                  title="Avoid"
                  value={summary.sell.total}
                  color={signalHex("strongSell")}
                  selected={filters.signals.has("sell")}
                  onClick={() =>
                    setFilters((f) => ({
                      ...f,
                      signals: f.signals.has("sell") ? new Set() : new Set(["sell"]),
                    }))
                  }
                  breakdown={{ strong: summary.sell.strong, moderate: summary.sell.moderate, weak: summary.sell.weak }}
                  trend={{ dir: summary.sell.dir, delta: summary.sell.delta }}
                />
              </motion.div>
            </div>
          </StaggerChildren>
        )}

        {/* v3 health summary */}
        {healthSummary && healthSummary.known > 0 && (
          <div className="mb-3 flex flex-wrap items-center gap-1.5 px-0.5">
            <span className="text-[0.65rem] font-semibold uppercase tracking-[0.5px] text-muted-foreground">
              Health
            </span>
            <span className="inline-flex items-center gap-1 rounded border border-strong-buy/30 bg-strong-buy/10 px-1.5 py-0.5 text-[0.65rem] font-semibold text-strong-buy">
              <CircleCheck className="size-3" />
              {healthSummary.pass} pass
            </span>
            <span className="inline-flex items-center gap-1 rounded border border-strong-sell/30 bg-strong-sell/10 px-1.5 py-0.5 text-[0.65rem] font-semibold text-strong-sell">
              <CircleX className="size-3" />
              {healthSummary.fail} fail
            </span>
            <span className="text-[0.65rem] text-muted-foreground/60">
              {healthSummary.known} of {dbEntries} scanned with v3 methodology
            </span>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="mb-2 rounded-lg border-l-4 border-strong-sell bg-strong-sell/10 p-3 text-sm text-strong-sell">
            {error}
          </div>
        )}

        {/* Stock Scanner */}
        {!loading && sortedRows.length > 0 && (
          <div className="mb-1.5 flex items-center gap-1.5 px-0.5">
            <h2 className="inline-flex items-center gap-1.5 text-[0.72rem] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              <Search className="size-3.5 text-primary" />
              Stock Scanner
            </h2>
            <span className="text-[0.6rem] text-muted-foreground/60">
              {sortedRows.length.toLocaleString("en-IN")} analyzed · click a row for the full signal breakdown
            </span>
          </div>
        )}

        {/* Sort / Filter bar */}
        {!loading && sortedRows.length > 0 && (
          <FadeIn delay={0.2} direction="up" viewport={false}>
            <div className="mb-1.5 flex flex-col items-stretch justify-between gap-1 px-0.5 sm:flex-row sm:items-center">
              <div className="flex items-center gap-1.5">
                <ArrowUpDown className="size-4 text-muted-foreground" />
                <Select value={sortBy} onValueChange={(v) => v && setSortBy(v)}>
                  <SelectTrigger className="h-7 w-[170px] text-[0.8rem]">
                    <span className="text-muted-foreground">Sort:</span>
                    <span className="flex-1 text-left">{SORT_LABELS[sortBy] ?? sortBy}</span>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="score-desc" label="Score ↓">Score ↓</SelectItem>
                    <SelectItem value="score-asc" label="Score ↑">Score ↑</SelectItem>
                    <SelectItem value="alpha" label="A – Z">A – Z</SelectItem>
                    <SelectItem value="alpha-rev" label="Z – A">Z – A</SelectItem>
                    <SelectItem value="price-desc" label="Price ↓">Price ↓</SelectItem>
                    <SelectItem value="price-asc" label="Price ↑">Price ↑</SelectItem>
                  </SelectContent>
                </Select>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    className={cn(
                      "inline-flex h-7 items-center gap-1.5 rounded-[6px] border border-input bg-transparent px-2.5 text-[0.8rem] font-semibold whitespace-nowrap transition-colors outline-none select-none hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/50",
                      activeFilterCount(filters) > 0 && "border-primary/40 text-primary",
                    )}
                  >
                    <Filter className="size-3.5" />
                    Filters
                    {activeFilterCount(filters) > 0 && (
                      <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary/15 px-1 text-[0.6rem] font-bold text-primary">
                        {activeFilterCount(filters)}
                      </span>
                    )}
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-[260px] p-2">
                    <p className="px-1 pb-1 text-[0.65rem] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                      Signal
                    </p>
                    <div className="grid grid-cols-3 gap-1 px-1 pb-1">
                      {(["buy", "hold", "sell"] as SignalKey[]).map((k) => (
                        <label
                          key={k}
                          className={cn(
                            "flex cursor-pointer items-center justify-center gap-1 rounded-md border px-1.5 py-1 text-[0.68rem] font-semibold transition-colors",
                            filters.signals.has(k)
                              ? k === "buy"
                                ? "border-strong-buy/40 bg-strong-buy/10 text-strong-buy"
                                : k === "hold"
                                  ? "border-hold/40 bg-hold/10 text-hold"
                                  : "border-strong-sell/40 bg-strong-sell/10 text-strong-sell"
                              : "border-border text-muted-foreground hover:bg-muted/40",
                          )}
                        >
                          <Checkbox
                            checked={filters.signals.has(k)}
                            onCheckedChange={(checked) =>
                              setFilters((f) => {
                                const next = new Set(f.signals);
                                if (checked) next.add(k);
                                else next.delete(k);
                                return { ...f, signals: next };
                              })
                            }
                            className="size-3.5"
                          />
                          {k === "buy" ? "Can Buy" : k === "hold" ? "Hold" : "Avoid"}
                        </label>
                      ))}
                    </div>

                    <DropdownMenuSeparator />

                    <p className="px-1 pb-1 text-[0.65rem] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                      Score
                    </p>
                    <div className="px-2 pb-1">
                      <Slider
                        min={0}
                        max={100}
                        step={5}
                        value={[filters.minScore, filters.maxScore]}
                        onValueChange={(v) => {
                          const arr = Array.isArray(v) ? v : [v];
                          setFilters((f) => ({
                            ...f,
                            minScore: arr[0],
                            maxScore: arr[1] ?? arr[0],
                          }));
                        }}
                        className="mt-2"
                      />
                      <div className="mt-1 flex justify-between text-[0.6rem] tabular-nums text-muted-foreground">
                        <span>{filters.minScore}</span>
                        <span>{filters.maxScore}</span>
                      </div>
                    </div>

                    <DropdownMenuSeparator />

                    <p className="px-1 pb-1 text-[0.65rem] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                      Market Cap
                    </p>
                    <div className="grid grid-cols-3 gap-1 px-1 pb-1">
                      {["large", "mid", "small"].map((c) => (
                        <label
                          key={c}
                          className={cn(
                            "flex cursor-pointer items-center justify-center gap-1 rounded-md border px-1.5 py-1 text-[0.68rem] font-semibold capitalize transition-colors",
                            filters.caps.has(c)
                              ? "border-primary/40 bg-primary/10 text-primary"
                              : "border-border text-muted-foreground hover:bg-muted/40",
                          )}
                        >
                          <Checkbox
                            checked={filters.caps.has(c)}
                            onCheckedChange={(checked) =>
                              setFilters((f) => {
                                const next = new Set(f.caps);
                                if (checked) next.add(c);
                                else next.delete(c);
                                return { ...f, caps: next };
                              })
                            }
                            className="size-3.5"
                          />
                          {c}
                        </label>
                      ))}
                    </div>

                    <DropdownMenuSeparator />

                    <p className="px-1 pb-1 text-[0.65rem] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                      Risk
                    </p>
                    <div className="grid grid-cols-3 gap-1 px-1 pb-1">
                      {(["low", "medium", "high"] as RiskKey[]).map((k) => (
                        <label
                          key={k}
                          className={cn(
                            "flex cursor-pointer items-center justify-center gap-1 rounded-md border px-1.5 py-1 text-[0.68rem] font-semibold capitalize transition-colors",
                            filters.risks.has(k)
                              ? "border-primary/40 bg-primary/10 text-primary"
                              : "border-border text-muted-foreground hover:bg-muted/40",
                          )}
                        >
                          <Checkbox
                            checked={filters.risks.has(k)}
                            onCheckedChange={(checked) =>
                              setFilters((f) => {
                                const next = new Set(f.risks);
                                if (checked) next.add(k);
                                else next.delete(k);
                                return { ...f, risks: next };
                              })
                            }
                            className="size-3.5"
                          />
                          {k}
                        </label>
                      ))}
                    </div>

                    <DropdownMenuSeparator />

                    <div className="flex items-center justify-between px-1 pt-1">
                      <span className="text-[0.62rem] text-muted-foreground/70">
                        {activeFilterCount(filters) > 0
                          ? `${activeFilterCount(filters)} active`
                          : "No filters"}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-[0.68rem] font-semibold text-muted-foreground hover:text-foreground"
                        onClick={() => setFilters(EMPTY_FILTERS)}
                      >
                        Reset
                      </Button>
                    </div>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <div className="flex items-center gap-1">
                <div className="relative w-full sm:w-auto">
                  <Search className="absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Search stocks…"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="h-7 min-w-[200px] pl-8 text-[0.8rem]"
                  />
                </div>
              </div>
            </div>
          </FadeIn>
        )}

        {/* Loading skeleton */}
        {loading && <SkeletonTable />}

        {/* Stock table */}
        {!loading && sortedRows.length > 0 && (
          <FadeIn delay={0.15} direction="up" viewport={false}>
            <div
              className="max-h-[calc(100vh-320px)] overflow-auto rounded-xl bg-surface ring-1 ring-border/60"
              onScroll={handleTableScroll}
            >
              <Table className="min-w-[760px]">
                <TableHeader>
                  <TableRow className="sticky top-0 z-20 bg-surface hover:bg-surface">
                    <TableHead className="text-[0.7rem] font-semibold uppercase tracking-[0.5px] text-muted-foreground">Tier</TableHead>
                    <TableHead className="text-[0.7rem] font-semibold uppercase tracking-[0.5px] text-muted-foreground">Stock</TableHead>
                    <TableHead className="text-[0.7rem] font-semibold uppercase tracking-[0.5px] text-muted-foreground">Signal</TableHead>
                    <TableHead className="text-[0.7rem] font-semibold uppercase tracking-[0.5px] text-muted-foreground">Score</TableHead>
                    <TableHead className="text-[0.7rem] font-semibold uppercase tracking-[0.5px] text-muted-foreground">Trend</TableHead>
                    <TableHead className="text-[0.7rem] font-semibold uppercase tracking-[0.5px] text-muted-foreground">Tech</TableHead>
                    <TableHead className="text-[0.7rem] font-semibold uppercase tracking-[0.5px] text-muted-foreground">Fund</TableHead>
                    <TableHead className="text-right text-[0.7rem] font-semibold uppercase tracking-[0.5px] text-muted-foreground">Price</TableHead>
                    <TableHead className="text-right text-[0.7rem] font-semibold uppercase tracking-[0.5px] text-muted-foreground"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleRows.map((row) => (
                    <TableRow
                      key={row.ticker}
                      className="cursor-pointer transition-colors duration-150 hover:bg-muted/60"
                      onClick={() => setSelectedRow(row)}
                    >
                      <TableCell><TierBadge score={row.qm_score} /></TableCell>
                      <TableCell>
                        <div>
                          <p className="text-sm font-bold">
                            {row.ticker.replace(".NS", "").replace(".BO", "")}
                          </p>
                          <p className="text-[0.62rem] text-muted-foreground">
                            {row.ticker}
                            {row.history_runs > 0 && (
                              <Tooltip>
                                <TooltipTrigger render={<span className="ml-0.5 cursor-default text-muted-foreground/50" />}>
                                  · {row.history_runs}r
                                </TooltipTrigger>
                                <TooltipContent>
                                  Analysed {row.history_runs} time{row.history_runs !== 1 ? "s" : ""}
                                </TooltipContent>
                              </Tooltip>
                            )}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <SignalChip rating={row.qm_rating} />
                      </TableCell>
                      <TableCell>
                        <ScoreBar score={row.qm_score} />
                      </TableCell>
                      <TableCell>
                        <TrendChip trend={row.trend} change={row.score_change} />
                      </TableCell>
                      <TableCell>
                        <span
                          className={`text-xs font-medium ${
                            row.tech_signal === "BUY"
                              ? "text-strong-buy"
                              : row.tech_signal === "SELL"
                                ? "text-strong-sell"
                                : "text-hold"
                          }`}
                        >
                          {row.tech_signal}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className="text-xs text-muted-foreground">
                          {row.fund_rating}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <p className="font-semibold font-mono text-sm">
                          {formatPrice(row.price, row.ticker)}
                        </p>
                      </TableCell>
                      <TableCell className="text-right">
                        <button
                          onClick={() => setSelectedRow(row)}
                          className="inline-flex items-center justify-center rounded p-1 text-muted-foreground transition-colors hover:text-primary"
                          aria-label={`Open ${row.ticker} analysis`}
                        >
                          <ChevronRight className="size-4" />
                        </button>
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow>
                    <TableCell colSpan={8} className="py-1.5 text-center">
                      <div className="flex items-center justify-center gap-1">
                        {visibleCount < sortedRows.length ? (
                          <>
                            <Spinner size={13} />
                            <span className="text-xs font-medium text-muted-foreground">
                              Scroll for more — {visibleCount} of {sortedRows.length} stocks
                            </span>
                          </>
                        ) : (
                          <span className="text-xs text-muted-foreground/50">
                            End of list — all {sortedRows.length} stocks loaded
                          </span>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </FadeIn>
        )}

        {/* Empty state */}
        {!loading && sortedRows.length === 0 && !error && (
          <FadeIn delay={0.1}>
            <div className="flex w-full flex-col items-center py-8 text-center text-muted-foreground bg-surface ring-1 ring-border/60 rounded-xl">
              <Database className="mb-2 size-12 opacity-30" />
              <h3 className="mb-1 text-lg font-medium">No stocks in database yet</h3>
              <p className="mb-2 max-w-[400px] text-sm">
                Click &quot;Scan All NSE&quot; to analyse all {totalNse > 0 ? totalNse : "NSE"} stocks.
                Results are saved to the database and dashboard updates in real-time.
              </p>
              <Button
                size="lg"
                className="gap-1.5"
                onClick={handleStartScanAll}
                disabled={isScanning}
              >
                <ListChecks className="size-4" />
                {isScanning ? `Scanning… ${scanPct}%` : "Scan All NSE Stocks"}
              </Button>
            </div>
          </FadeIn>
        )}

        {/* Financial Health (per-user ledger widget) */}
        {!loading && (
          <div className="mt-3">
            <h2 className="mb-1.5 flex items-center gap-1.5 text-[0.72rem] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              <Wallet className="size-3.5 text-primary" />
              Financial Health
            </h2>
            <SpendingSnapshot />
          </div>
        )}

        {/* Footer */}
        {!loading && sortedRows.length > 0 && (
          <p className="block pt-2 text-center text-xs text-muted-foreground/50">
            {isScanning && scanProgress
              ? `${scanType === "pending" ? "Pending" : "Full"} scan in progress — ${scanProgress.completed} of ${scanProgress.total} stocks analyzed (${scanPct}%)`
              : `Click any stock to open the quick analysis drawer — or View Full Analysis for the complete report. Data persisted in local database. Prices in ₹ for NSE stocks.`
            }
          </p>
        )}

        {/* Stock detail drawer */}
        <StockDrawer
          row={selectedRow}
          onClose={() => setSelectedRow(null)}
          monitored={selectedRow ? monitoredTickers.has(selectedRow.ticker) : false}
          onToggleMonitor={toggleMonitor}
        />
      </div>
    </TooltipProvider>
  );
}