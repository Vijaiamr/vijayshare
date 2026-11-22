"use client";

import * as React from "react";
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  Home,
  DollarSign,
  PlusCircle,
  Trash2,
  Trash,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Pencil,
  Search,
  ChevronUp,
  ChevronDown,
  Loader2,
} from "lucide-react";

import { api } from "@/lib/api";
import type { NseSymbolsResponse } from "@/lib/types";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

// ─── Types ───────────────────────────────────────────────────

interface PortfolioPosition {
  id: string;
  symbol: string;
  buyPrice: number;
  quantity: number;
  buyDate: string;
  notes?: string;
  addedAt: string;
  targetPrice?: number;
}

interface PriceMap {
  [symbol: string]: number | null;
}

interface FormState {
  symbol: string;
  buyPrice: string;
  quantity: string;
  targetPrice: string;
}

const STORAGE_KEY = "vm_portfolio_positions";

// ─── Helpers ─────────────────────────────────────────────────

function loadPositions(): PortfolioPosition[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as PortfolioPosition[]) : [];
  } catch {
    return [];
  }
}

function savePositions(positions: PortfolioPosition[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(positions));
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatINR(n: number): string {
  return "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatPct(n: number): string {
  return (n >= 0 ? "+" : "") + n.toFixed(2) + "%";
}

// ─── CSS pie chart (conic-gradient) ──────────────────────────

function AllocationPie({ slices }: { slices: { label: string; value: number; color: string }[] }) {
  const total = slices.reduce((s, x) => s + x.value, 0);
  if (total === 0) return <p className="py-4 text-center text-sm text-muted-foreground">No data</p>;

  let conic = "";
  let cum = 0;
  for (const s of slices) {
    const start = (cum / total) * 360;
    cum += s.value;
    const end = (cum / total) * 360;
    conic += `${s.color} ${start}deg ${end}deg,`;
  }
  conic = conic.slice(0, -1);

  return (
    <div className="flex flex-wrap items-center justify-center gap-3">
      <div
        className="h-[140px] w-[140px] flex-shrink-0 rounded-full"
        style={{ background: `conic-gradient(${conic})` }}
      />
      <div className="flex flex-col gap-0.5">
        {slices.map((s) => (
          <div key={s.label} className="flex items-center gap-1">
            <div className="h-[10px] w-[10px] flex-shrink-0 rounded-[2px]" style={{ backgroundColor: s.color }} />
            <span className="whitespace-nowrap text-[0.7rem]">
              {s.label}: {((s.value / total) * 100).toFixed(1)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── CSS horizontal bar chart ────────────────────────────────

function PnLBarChart({ items, total }: { items: { label: string; value: number }[]; total: number }) {
  if (items.length === 0) return <p className="py-4 text-center text-sm text-muted-foreground">No data</p>;
  const absMax = Math.max(...items.map((x) => Math.abs(x.value)), 1);

  return (
    <div className="flex w-full flex-col gap-1">
      {items.map((item) => {
        const pct = (item.value / absMax) * 100;
        const isPos = item.value >= 0;
        return (
          <div key={item.label} className="w-full">
            <div className="mb-0.5 flex justify-between">
              <span className="text-[0.7rem] font-semibold">{item.label}</span>
              <span className={cn("text-[0.7rem]", isPos ? "text-emerald-500" : "text-red-500")}>
                {formatINR(item.value)}
              </span>
            </div>
            <div className="relative h-4 w-full overflow-hidden rounded bg-muted">
              <div
                className="absolute top-0 h-full rounded opacity-70"
                style={{
                  width: `${Math.abs(pct)}%`,
                  left: isPos ? `calc(50% - ${pct / 2}%)` : `calc(50% - ${Math.abs(pct) / 2}%)`,
                  backgroundColor: isPos ? "hsl(142, 76%, 36%)" : "hsl(0, 84%, 60%)",
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────

export default function PortfolioPage() {
  const router = useRouter();

  const [positions, setPositions] = useState<PortfolioPosition[]>([]);
  const [prices, setPrices] = useState<PriceMap>({});
  const [priceLoading, setPriceLoading] = useState(false);
  const [priceErrors, setPriceErrors] = useState<Set<string>>(new Set());

  const [nseSymbols, setNseSymbols] = useState<string[]>([]);
  const [symbolsLoading, setSymbolsLoading] = useState(true);

  const [form, setForm] = useState<FormState>({ symbol: "", buyPrice: "", quantity: "", targetPrice: "" });
  const [formError, setFormError] = useState<string | null>(null);

  const [clearDialogOpen, setClearDialogOpen] = useState(false);
  const [toast, setToast] = useState<{ message: string; variant: "success" | "error" | "info" } | null>(null);

  const [priceDialog, setPriceDialog] = useState<{
    symbol: string;
    position: PortfolioPosition;
    loading: boolean;
    price: number | null;
    time: string | null;
    source: string;
    error: string | null;
  } | null>(null);

  type SortKey = "symbol" | "buyPrice" | "currentPrice" | "quantity" | "invested" | "currentValue" | "pnl" | "pnlPct" | "targetPrice" | "freeShares" | "buyDate";
  const [sortConfig, setSortConfig] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "symbol", dir: "asc" });
  const [searchQuery, setSearchQuery] = useState("");

  const [editDialog, setEditDialog] = useState<PortfolioPosition | null>(null);

  useEffect(() => {
    setPositions(loadPositions());
  }, []);

  useEffect(() => {
    let cancelled = false;
    api.getNseSymbols()
      .then((res: NseSymbolsResponse) => { if (!cancelled) setNseSymbols(res.symbols); })
      .catch(() => { if (!cancelled) setToast({ message: "Failed to load NSE symbols list", variant: "error" }); })
      .finally(() => { if (!cancelled) setSymbolsLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(t);
    }
  }, [toast]);

  const persist = useCallback((updated: PortfolioPosition[]) => {
    setPositions(updated);
    savePositions(updated);
  }, []);

  const metrics = useMemo(() => {
    let invested = 0;
    let current = 0;
    const pnlItems: { label: string; value: number }[] = [];
    const pricedPositions: PortfolioPosition[] = [];

    for (const p of positions) {
      const cur = prices[p.symbol] != null ? prices[p.symbol]! * p.quantity : null;
      if (cur != null) {
        const inv = p.buyPrice * p.quantity;
        invested += inv;
        current += cur;
        pnlItems.push({ label: p.symbol.replace(".NS", ""), value: cur - inv });
        pricedPositions.push(p);
      }
    }

    const pnl = current - invested;
    const pnlPct = invested > 0 ? (pnl / invested) * 100 : 0;

    const best = pnlItems.length > 0 ? pnlItems.reduce((a, b) => (a.value > b.value ? a : b)) : null;
    const worst = pnlItems.length > 0 ? pnlItems.reduce((a, b) => (a.value < b.value ? a : b)) : null;

    return { invested, current, pnl, pnlPct, pnlItems, best, worst, positionsWithPrices: pricedPositions };
  }, [positions, prices]);

  const refreshPrices = useCallback(async (opts?: { silent?: boolean }) => {
    const syms = positions.map((p) => p.symbol);
    if (syms.length === 0) return;

    if (!opts?.silent) setPriceLoading(true);

    const lpResults = await Promise.allSettled(
      syms.map((sym) =>
        api.getLastPrice(sym)
          .then((res) => ({ symbol: sym, price: res.price }))
          .catch(() => ({ symbol: sym, price: null }))
      )
    );

    const newPrices: PriceMap = { ...prices };
    const newErrors = new Set<string>();
    const ohlcvFallbackSyms: string[] = [];

    for (const r of lpResults) {
      if (r.status === "fulfilled") {
        newPrices[r.value.symbol] = r.value.price;
        if (r.value.price == null) ohlcvFallbackSyms.push(r.value.symbol);
      }
    }

    if (ohlcvFallbackSyms.length > 0) {
      const ohlcvResults = await Promise.allSettled(
        ohlcvFallbackSyms.map((sym) =>
          api.getOHLCV(sym, "3mo")
            .then((res) => ({ symbol: sym, price: res.candles.length > 0 ? res.candles[res.candles.length - 1].close : null }))
            .catch(() => ({ symbol: sym, price: null }))
        )
      );
      for (const r of ohlcvResults) {
        if (r.status === "fulfilled") {
          newPrices[r.value.symbol] = r.value.price;
          if (r.value.price == null) newErrors.add(r.value.symbol);
        }
      }
    }

    setPrices(newPrices);
    setPriceErrors(newErrors);
    setPriceLoading(false);
  }, [positions]);

  useEffect(() => {
    if (positions.length > 0) refreshPrices();
  }, [positions.length > 0]);

  useEffect(() => {
    if (positions.length === 0) return;

    const onVisibility = () => {
      if (document.visibilityState === "visible") refreshPrices({ silent: true });
    };
    document.addEventListener("visibilitychange", onVisibility);

    const intervalId = setInterval(() => refreshPrices({ silent: true }), 30_000);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      clearInterval(intervalId);
    };
  }, [positions.length > 0, refreshPrices]);

  const handleAdd = () => {
    setFormError(null);

    const symbol = form.symbol.trim().toUpperCase();
    const buyPrice = parseFloat(form.buyPrice);
    const quantity = parseInt(form.quantity, 10);

    if (!symbol) { setFormError("Symbol is required"); return; }
    if (isNaN(buyPrice) || buyPrice <= 0) { setFormError("Buy price must be > 0"); return; }
    if (isNaN(quantity) || quantity <= 0) { setFormError("Quantity must be > 0"); return; }

    const symWithSuffix = symbol.endsWith(".NS") ? symbol : `${symbol}.NS`;

    const targetPrice = form.targetPrice.trim() ? parseFloat(form.targetPrice) : undefined;

    const newPos: PortfolioPosition = {
      id: generateId(),
      symbol: symWithSuffix,
      buyPrice,
      quantity,
      buyDate: todayStr(),
      addedAt: new Date().toISOString(),
      ...(targetPrice != null && !isNaN(targetPrice) && targetPrice > 0 ? { targetPrice } : {}),
    };

    const updated = [...positions, newPos];
    persist(updated);
    setForm({ symbol: "", buyPrice: "", quantity: "", targetPrice: "" });
    setToast({ message: `${symWithSuffix} added to portfolio`, variant: "success" });

    const fetchPrice = async (sym: string) => {
      try {
        const last = await api.getLastPrice(sym);
        if (last.price != null) {
          setPrices((prev) => ({ ...prev, [sym]: last.price }));
          return;
        }
      } catch { /* fall through */ }
      try {
        const ohlcv = await api.getOHLCV(sym, "3mo");
        const close = ohlcv.candles.length > 0 ? ohlcv.candles[ohlcv.candles.length - 1].close : null;
        if (close != null) {
          setPrices((prev) => ({ ...prev, [sym]: close }));
          return;
        }
      } catch { /* fall through */ }
      setPrices((prev) => ({ ...prev, [sym]: null }));
      setPriceErrors((prev) => new Set(prev).add(sym));
    };
    fetchPrice(symWithSuffix);
  };

  const handleDelete = (id: string) => {
    const removed = positions.find((p) => p.id === id);
    const updated = positions.filter((p) => p.id !== id);
    persist(updated);
    if (removed) setToast({ message: `${removed.symbol} removed`, variant: "info" });
  };

  const handleClear = () => {
    persist([]);
    setPrices({});
    setPriceErrors(new Set());
    setClearDialogOpen(false);
    setToast({ message: "Portfolio cleared", variant: "info" });
  };

  const updateForm = (field: keyof FormState, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setFormError(null);
  };

  const PIE_COLORS = ["#1976d2", "#388e3c", "#f57c00", "#d32f2f", "#7b1fa2", "#00796b", "#5d4037", "#c2185b", "#303f9f", "#689f38"];

  const pieSlices = useMemo(() => {
    return metrics.pnlItems.map((item, i) => ({
      label: item.label,
      value: Math.abs(item.value),
      color: PIE_COLORS[i % PIE_COLORS.length],
    }));
  }, [metrics.pnlItems]);

  const handleSymbolClick = useCallback((pos: PortfolioPosition) => {
    const symbol = pos.symbol;
    setPriceDialog({ symbol, position: pos, loading: true, price: null, time: null, source: "", error: null });
    api.getLastPrice(symbol)
      .then((res) => {
        setPriceDialog((prev) =>
          prev?.symbol === symbol
            ? { ...prev, loading: false, price: res.price, time: res.time, source: res.source, error: res.price == null ? "No price available" : null }
            : prev
        );
      })
      .catch((err) => {
        setPriceDialog((prev) =>
          prev?.symbol === symbol
            ? { ...prev, loading: false, error: err.message ?? "Failed to fetch price" }
            : prev
        );
      });
  }, []);

  const handleClosePriceDialog = useCallback(() => {
    setPriceDialog(null);
  }, []);

  const handleOpenEdit = useCallback((pos: PortfolioPosition) => {
    setEditDialog(pos);
  }, []);

  const handleSaveEdit = useCallback((id: string, updated: Partial<Pick<PortfolioPosition, "buyPrice" | "quantity" | "buyDate" | "notes" | "targetPrice">>) => {
    const newPositions = positions.map((p) =>
      p.id === id ? { ...p, ...updated } : p
    );
    persist(newPositions);
    setEditDialog(null);
    setToast({ message: "Position updated", variant: "success" });
  }, [positions, persist]);

  const filteredPositions = useMemo(() => {
    let filtered = positions;

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      filtered = filtered.filter((p) => p.symbol.replace(".NS", "").toLowerCase().includes(q));
    }

    const sorted = [...filtered];
    const { key, dir } = sortConfig;
    const mul = dir === "asc" ? 1 : -1;

    sorted.sort((a, b) => {
      const curA = prices[a.symbol];
      const curB = prices[b.symbol];

      switch (key) {
        case "symbol": {
          const aVal = a.symbol.replace(".NS", "");
          const bVal = b.symbol.replace(".NS", "");
          return mul * aVal.localeCompare(bVal);
        }
        case "buyPrice":
          return mul * (a.buyPrice - b.buyPrice);
        case "currentPrice":
          return mul * ((curA ?? 0) - (curB ?? 0));
        case "quantity":
          return mul * (a.quantity - b.quantity);
        case "invested":
          return mul * (a.buyPrice * a.quantity - b.buyPrice * b.quantity);
        case "currentValue":
          return mul * ((curA ?? 0) * a.quantity - (curB ?? 0) * b.quantity);
        case "pnl": {
          const pnlA = curA != null ? curA * a.quantity - a.buyPrice * a.quantity : 0;
          const pnlB = curB != null ? curB * b.quantity - b.buyPrice * b.quantity : 0;
          return mul * (pnlA - pnlB);
        }
        case "pnlPct": {
          const pctA = a.buyPrice > 0 && curA != null ? ((curA - a.buyPrice) / a.buyPrice) * 100 : 0;
          const pctB = b.buyPrice > 0 && curB != null ? ((curB - b.buyPrice) / b.buyPrice) * 100 : 0;
          return mul * (pctA - pctB);
        }
        case "targetPrice":
          return mul * ((a.targetPrice ?? 0) - (b.targetPrice ?? 0));
        case "freeShares": {
          const shA = prices[a.symbol] != null ? a.quantity - Math.ceil((a.buyPrice * a.quantity) / prices[a.symbol]!) : 0;
          const shB = prices[b.symbol] != null ? b.quantity - Math.ceil((b.buyPrice * b.quantity) / prices[b.symbol]!) : 0;
          return mul * (shA - shB);
        }
        case "buyDate":
          return mul * (a.buyDate.localeCompare(b.buyDate));
        default:
          return 0;
      }
    });

    return sorted;
  }, [positions, searchQuery, sortConfig, prices]);

  const handleSort = useCallback((key: SortKey) => {
    setSortConfig((prev) => ({
      key,
      dir: prev.key === key && prev.dir === "asc" ? "desc" : "asc",
    }));
  }, []);

  const SortIcon = ({ columnKey }: { columnKey: SortKey }) => {
    if (sortConfig.key !== columnKey) return null;
    return sortConfig.dir === "asc"
      ? <ChevronUp size={14} className="ml-0.5 inline-block align-middle" />
      : <ChevronDown size={14} className="ml-0.5 inline-block align-middle" />;
  };

  return (
    <TooltipProvider>
      <div className="w-full max-w-[1200px]">
        {/* Breadcrumb */}
        <nav className="mb-1 text-xs text-muted-foreground" aria-label="breadcrumb">
          <span
            onClick={() => router.push("/")}
            className="inline-flex cursor-pointer items-center gap-0.5 hover:text-foreground"
          >
            <Home size={14} />
            Home
          </span>
          <span className="mx-1">/</span>
          <span className="font-semibold text-foreground">Portfolio</span>
        </nav>

        {/* Header */}
        <div className="mb-1 flex flex-wrap items-center justify-between gap-1">
          <h1 className="text-[1.6rem] font-bold tracking-tight">Portfolio</h1>
          <div className="flex gap-1">
            <Button size="sm" variant="outline" onClick={() => refreshPrices()} disabled={priceLoading || positions.length === 0} className="whitespace-nowrap">
              <RefreshCw size={14} className="mr-1" />
              {priceLoading ? "Loading..." : "Refresh"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setClearDialogOpen(true)} disabled={positions.length === 0} className="whitespace-nowrap text-destructive hover:bg-destructive/10">
              <Trash size={14} className="mr-1" />
              Clear All
            </Button>
          </div>
        </div>

        {/* Holdings content */}
        {positions.length === 0 ? (
          <Card className="rounded-lg border py-12 text-center">
            <CardContent>
              <div className="mb-2 flex justify-center text-muted-foreground"><DollarSign size={56} /></div>
              <h6 className="mb-0.5 text-lg font-semibold text-muted-foreground">Your portfolio is empty</h6>
              <p className="mb-2 text-sm text-muted-foreground">
                Add your first position using the form below to get started.
              </p>
              <Button onClick={() => document.getElementById("symbol-input")?.focus()}>
                <PlusCircle size={14} className="mr-1" />
                Add Position
              </Button>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Metric Cards */}
            <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-4">
              <Card className="rounded-lg border">
                <CardContent className="p-2">
                  <p className="text-[0.65rem] font-semibold uppercase tracking-wide text-muted-foreground">Total Invested</p>
                  <p className="mt-0.3 text-[1.3rem] font-bold">{formatINR(metrics.invested)}</p>
                </CardContent>
              </Card>
              <Card className="rounded-lg border">
                <CardContent className="p-2">
                  <p className="text-[0.65rem] font-semibold uppercase tracking-wide text-muted-foreground">Current Value</p>
                  <p className="mt-0.3 text-[1.3rem] font-bold">
                    {metrics.positionsWithPrices.length > 0 ? formatINR(metrics.current) : "—"}
                  </p>
                </CardContent>
              </Card>
              <Card className={cn("rounded-lg border", metrics.pnl >= 0 ? "border-emerald-500" : "border-red-500")}>
                <CardContent className="p-2">
                  <p className="text-[0.65rem] font-semibold uppercase tracking-wide text-muted-foreground">Total P&L</p>
                  <p className={cn("mt-0.3 text-[1.3rem] font-bold", metrics.pnl >= 0 ? "text-emerald-500" : "text-red-500")}>
                    {metrics.positionsWithPrices.length > 0 ? formatINR(metrics.pnl) : "—"}
                  </p>
                  <p className={cn("text-[0.7rem] font-semibold", metrics.pnl >= 0 ? "text-emerald-500" : "text-red-500")}>
                    {metrics.positionsWithPrices.length > 0 ? formatPct(metrics.pnlPct) : "—"}
                  </p>
                </CardContent>
              </Card>
              <Card className="rounded-lg border">
                <CardContent className="p-2">
                  <p className="text-[0.65rem] font-semibold uppercase tracking-wide text-muted-foreground">Best / Worst</p>
                  <div className="mt-0.3 flex items-center gap-1.5">
                    {metrics.best && (
                      <Tooltip>
                        <TooltipTrigger>
                          <span className="inline-flex items-center gap-0.3">
                            <TrendingUp size={16} className="text-emerald-500" />
                            <span className="text-[0.85rem] font-bold text-emerald-500">{metrics.best.label}</span>
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>{metrics.best.label}: {formatINR(metrics.best.value)}</TooltipContent>
                      </Tooltip>
                    )}
                    {metrics.worst && (
                      <Tooltip>
                        <TooltipTrigger>
                          <span className="inline-flex items-center gap-0.3">
                            <TrendingDown size={16} className="text-red-500" />
                            <span className="text-[0.85rem] font-bold text-red-500">{metrics.worst.label}</span>
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>{metrics.worst.label}: {formatINR(metrics.worst.value)}</TooltipContent>
                      </Tooltip>
                    )}
                    {!metrics.best && !metrics.worst && (
                      <span className="text-[0.85rem] text-muted-foreground">—</span>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Charts Row */}
            <div className="mb-3 grid grid-cols-1 gap-2 md:grid-cols-2">
              <Card className="rounded-lg border">
                <CardContent className="p-2">
                  <h6 className="mb-1.5 text-[0.9rem] font-semibold">Allocation by Position Size</h6>
                  <AllocationPie slices={pieSlices} />
                </CardContent>
              </Card>
              <Card className="rounded-lg border">
                <CardContent className="p-2">
                  <h6 className="mb-1.5 text-[0.9rem] font-semibold">P&L by Symbol</h6>
                  <PnLBarChart items={metrics.pnlItems} total={metrics.pnl} />
                </CardContent>
              </Card>
            </div>
          </>
        )}

        {/* Add Position Form */}
        <Card className="mb-3 rounded-lg border">
          <CardContent className="p-2.5">
            <h6 className="mb-1.5 text-[1rem] font-semibold">
              <PlusCircle size={18} className="mr-1 inline-block align-text-bottom" />
              Add Position
            </h6>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 md:grid-cols-7">
              <div className="col-span-2 sm:col-span-2 md:col-span-3">
                <label htmlFor="symbol-input" className="mb-1 block text-xs text-muted-foreground">Symbol</label>
                <input
                  id="symbol-input"
                  list="nse-symbols-list"
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  placeholder="e.g. RELIANCE"
                  value={form.symbol}
                  onChange={(e) => updateForm("symbol", e.target.value)}
                />
                <datalist id="nse-symbols-list">
                  {nseSymbols.map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
              </div>
              <div className="col-span-1 sm:col-span-1 md:col-span-1">
                <label className="mb-1 block text-xs text-muted-foreground">Buy Price (₹)</label>
                <Input type="number" min={0} step={0.05} value={form.buyPrice} onChange={(e) => updateForm("buyPrice", e.target.value)} placeholder="0.00" />
              </div>
              <div className="col-span-1 sm:col-span-1 md:col-span-1">
                <label className="mb-1 block text-xs text-muted-foreground">Quantity</label>
                <Input type="number" min={1} step={1} value={form.quantity} onChange={(e) => updateForm("quantity", e.target.value)} placeholder="0" />
              </div>
              <div className="col-span-2 sm:col-span-2 md:col-span-1">
                <label className="mb-1 block text-xs text-muted-foreground">Target Price (₹)</label>
                <Input type="number" min={0} step={0.05} value={form.targetPrice} onChange={(e) => updateForm("targetPrice", e.target.value)} placeholder="0.00" />
              </div>
              <div className="col-span-2 sm:col-span-4 md:col-span-1">
                <div className="flex flex-col gap-0.5">
                  <Button className="w-full" onClick={handleAdd}>Add to Portfolio</Button>
                  {formError && <p className="text-xs text-destructive">{formError}</p>}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Holdings Table */}
        {positions.length > 0 && (
          <Card className="rounded-lg border">
            <div className="flex items-center gap-1 px-2 pt-1.5 pb-0.5">
              <Search size={14} className="text-muted-foreground" />
              <input
                className="max-w-[220px] border-0 border-b border-input bg-transparent px-1 py-0.5 text-[0.8rem] shadow-none outline-none placeholder:text-muted-foreground focus:border-foreground"
                placeholder="Search symbols…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              <div className="flex-1" />
              <span className="text-[0.65rem] text-muted-foreground">{filteredPositions.length} / {positions.length} shown</span>
            </div>
            <Table className="min-w-[650px]">
              <TableHeader>
                <TableRow>
                  {([
                    { key: "symbol" as SortKey, label: "Symbol", align: "left" },
                    { key: "buyPrice" as SortKey, label: "Buy Price", align: "right" },
                    { key: "currentPrice" as SortKey, label: "LTP", align: "right" },
                    { key: "quantity" as SortKey, label: "Qty", align: "right" },
                    { key: "invested" as SortKey, label: "Invested", align: "right" },
                    { key: "pnl" as SortKey, label: "P&L (₹)", align: "right" },
                    { key: "pnlPct" as SortKey, label: "P&L (%)", align: "right" },
                    { key: "targetPrice" as SortKey, label: "Target", align: "right" },
                    { key: "freeShares" as SortKey, label: "Free", align: "right" },
                    { key: "buyDate" as SortKey, label: "Buy Date", align: "center" },
                  ]).map((col) => (
                    <TableHead
                      key={col.key}
                      onClick={() => handleSort(col.key)}
                      className={cn(
                        "cursor-pointer select-none text-[0.75rem] font-bold text-muted-foreground hover:text-foreground",
                        col.align === "right" && "text-right",
                        col.align === "center" && "text-center"
                      )}
                    >
                      {col.label} <SortIcon columnKey={col.key} />
                    </TableHead>
                  ))}
                  <TableHead className="w-[80px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredPositions.map((pos) => {
                  const currentPrice = prices[pos.symbol];
                  const hasPrice = currentPrice != null;
                  const invested = pos.buyPrice * pos.quantity;
                  const currentValue = hasPrice ? currentPrice * pos.quantity : null;
                  const pnl = currentValue != null ? currentValue - invested : null;
                  const pnlPct = pnl != null && invested > 0 ? (pnl / invested) * 100 : null;
                  const isError = priceErrors.has(pos.symbol);
                  const hasTarget = pos.targetPrice != null && pos.targetPrice > 0;
                  const targetRemain = hasTarget && hasPrice ? pos.targetPrice! - currentPrice : null;
                  const targetRemainPct = targetRemain != null ? (targetRemain / pos.buyPrice) * 100 : null;
                  const sharesToRecover = hasPrice ? Math.ceil(invested / currentPrice) : null;
                  const freeShares = hasPrice && sharesToRecover != null ? pos.quantity - sharesToRecover : null;

                  return (
                    <TableRow key={pos.id}>
                      <TableCell>
                        <span
                          onClick={() => handleSymbolClick(pos)}
                          className="cursor-pointer text-[0.8rem] font-bold text-primary hover:underline hover:opacity-80"
                        >
                          {pos.symbol.replace(".NS", "")}
                        </span>
                      </TableCell>
                      <TableCell className="text-right text-[0.8rem]">{formatINR(pos.buyPrice)}</TableCell>
                      <TableCell className="text-right text-[0.8rem] font-semibold">
                        {hasPrice ? formatINR(currentPrice) : (
                          <span className="inline-flex items-center gap-0.3 text-muted-foreground">
                            {isError ? <AlertTriangle size={12} /> : null}
                            {priceLoading ? "…" : "N/A"}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right text-[0.8rem]">{pos.quantity}</TableCell>
                      <TableCell className="text-right text-[0.8rem]">{formatINR(invested)}</TableCell>
                      <TableCell className={cn("text-right text-[0.8rem] font-semibold", pnl != null ? (pnl >= 0 ? "text-emerald-500" : "text-red-500") : "text-muted-foreground")}>
                        {pnl != null ? formatINR(pnl) : "—"}
                      </TableCell>
                      <TableCell className={cn("text-right text-[0.8rem] font-semibold", pnlPct != null ? (pnlPct >= 0 ? "text-emerald-500" : "text-red-500") : "text-muted-foreground")}>
                        {pnlPct != null ? formatPct(pnlPct) : "—"}
                      </TableCell>
                      <TableCell className={cn("text-right text-[0.8rem] font-semibold", hasTarget && targetRemain != null ? (targetRemain >= 0 ? "text-emerald-500" : "text-red-500") : "text-muted-foreground")}>
                        {hasTarget ? (
                          <div>
                            <span className="text-[0.8rem] font-semibold">{formatINR(pos.targetPrice!)}</span>
                            {targetRemain != null && (
                              <span className="block text-[0.65rem] opacity-80">+{formatINR(targetRemain)} / +{targetRemainPct!.toFixed(1)}%</span>
                            )}
                          </div>
                        ) : "—"}
                      </TableCell>
                      <TableCell className={cn("text-right text-[0.8rem] font-bold", freeShares != null && freeShares > 0 ? "text-emerald-500" : "text-muted-foreground")}>
                        {freeShares != null && freeShares >= 0 ? freeShares : "—"}
                      </TableCell>
                      <TableCell className="text-center text-[0.75rem] text-muted-foreground">{pos.buyDate}</TableCell>
                      <TableCell className="text-center">
                        <div className="flex justify-center gap-0.5">
                          <Button variant="ghost" size="icon-xs" onClick={() => handleOpenEdit(pos)} className="text-muted-foreground hover:text-primary">
                            <Pencil size={16} />
                          </Button>
                          <Button variant="ghost" size="icon-xs" onClick={() => handleDelete(pos.id)} className="text-muted-foreground hover:text-destructive">
                            <Trash2 size={16} />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <div className="px-2 pb-1">
              <p className="text-[0.65rem] text-muted-foreground">
                {metrics.positionsWithPrices.length} / {positions.length} symbols priced ·
                Prices from NSE via Yahoo Finance ·
                {priceErrors.size > 0 && <> {priceErrors.size} symbol(s) unavailable ·</>}
                Data stored in browser localStorage
              </p>
            </div>
          </Card>
        )}

        {/* Edit Position Dialog */}
        <Dialog open={editDialog != null} onOpenChange={(open) => { if (!open) setEditDialog(null); }}>
          <DialogContent className="max-w-md">
            {editDialog && (
              <>
                <DialogHeader>
                  <DialogTitle className="text-[1.1rem] font-bold">
                    Edit {editDialog.symbol.replace(".NS", "")}
                  </DialogTitle>
                </DialogHeader>
                <div className="flex flex-col gap-3 pt-2">
                  <div>
                    <label className="mb-1 block text-xs text-muted-foreground">Buy Price (₹)</label>
                    <Input
                      type="number"
                      min={0}
                      step={0.05}
                      defaultValue={editDialog.buyPrice}
                      ref={(el) => { if (el) (window as any).__edit_buyPrice = el; }}
                      onChange={(e) => { (window as any).__edit_buyPriceVal = e.target.value; }}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-muted-foreground">Quantity</label>
                    <Input
                      type="number"
                      min={1}
                      step={1}
                      defaultValue={editDialog.quantity}
                      ref={(el) => { if (el) (window as any).__edit_quantity = el; }}
                      onChange={(e) => { (window as any).__edit_quantityVal = e.target.value; }}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-muted-foreground">Buy Date</label>
                    <Input
                      type="date"
                      defaultValue={editDialog.buyDate}
                      ref={(el) => { if (el) (window as any).__edit_buyDate = el; }}
                      onChange={(e) => { (window as any).__edit_buyDateVal = e.target.value; }}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-muted-foreground">Target Price (₹)</label>
                    <Input
                      type="number"
                      min={0}
                      step={0.05}
                      defaultValue={editDialog.targetPrice ?? ""}
                      ref={(el) => { if (el) (window as any).__edit_targetPrice = el; }}
                      onChange={(e) => { (window as any).__edit_targetPriceVal = e.target.value; }}
                    />
                  </div>
                </div>
                <DialogFooter className="mt-4">
                  <Button variant="outline" onClick={() => setEditDialog(null)}>Cancel</Button>
                  <Button
                    onClick={() => {
                      const price = parseFloat((window as any).__edit_buyPrice?.value ?? (window as any).__edit_buyPriceVal ?? editDialog.buyPrice);
                      const qty = parseInt((window as any).__edit_quantity?.value ?? (window as any).__edit_quantityVal ?? editDialog.quantity, 10);
                      const date = (window as any).__edit_buyDate?.value ?? (window as any).__edit_buyDateVal ?? editDialog.buyDate;
                      const rawTarget = (window as any).__edit_targetPrice?.value ?? (window as any).__edit_targetPriceVal ?? "";
                      const target = rawTarget !== "" ? parseFloat(rawTarget) : undefined;
                      if (!isNaN(price) && price > 0 && !isNaN(qty) && qty > 0 && date) {
                        handleSaveEdit(editDialog.id, {
                          buyPrice: price,
                          quantity: qty,
                          buyDate: date,
                          ...(target != null && !isNaN(target) && target > 0 ? { targetPrice: target } : { targetPrice: undefined }),
                        });
                      }
                    }}
                  >
                    Save
                  </Button>
                </DialogFooter>
              </>
            )}
          </DialogContent>
        </Dialog>

        {/* Last Traded Price Dialog */}
        <Dialog open={priceDialog != null} onOpenChange={(open) => { if (!open) setPriceDialog(null); }}>
          <DialogContent className="max-w-md">
            {priceDialog && (
              <>
                <DialogHeader>
                  <DialogTitle className="text-[1.1rem] font-bold">
                    {priceDialog.symbol.replace(".NS", "")}
                  </DialogTitle>
                </DialogHeader>
                {priceDialog.loading ? (
                  <div className="flex justify-center py-4">
                    <div className="flex items-center gap-1">
                      <Loader2 size={24} className="animate-spin" />
                      <span className="text-xs text-muted-foreground">Fetching latest price…</span>
                    </div>
                  </div>
                ) : priceDialog.error ? (
                  <div className="py-3 text-center">
                    <AlertTriangle size={32} className="mx-auto mb-2 text-destructive" />
                    <p className="mb-1 text-sm text-destructive">{priceDialog.error}</p>
                    <p className="text-xs text-muted-foreground">Try again later or check the symbol</p>
                  </div>
                ) : priceDialog.price != null ? (
                  <div className="py-2 text-center">
                    <p className="text-[0.7rem] uppercase tracking-widest text-muted-foreground">Last Traded Price</p>
                    <p className="my-1 text-[2.5rem] font-extrabold">{formatINR(priceDialog.price)}</p>
                    {priceDialog.time && (
                      <p className="mb-2 text-[0.65rem] text-muted-foreground">
                        as of {priceDialog.time} ({priceDialog.source === "intraday" ? "intraday" : "daily close"})
                      </p>
                    )}
                    <div className="my-2 h-px w-full bg-border" />
                    <div className="flex flex-col gap-1 text-left">
                      <div className="flex justify-between">
                        <span className="text-xs text-muted-foreground">Your Buy Price</span>
                        <span className="text-sm font-semibold">{formatINR(priceDialog.position.buyPrice)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-xs text-muted-foreground">Quantity</span>
                        <span className="text-sm font-semibold">{priceDialog.position.quantity}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-xs text-muted-foreground">Invested</span>
                        <span className="text-sm font-semibold">{formatINR(priceDialog.position.buyPrice * priceDialog.position.quantity)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-xs text-muted-foreground">Current Value</span>
                        <span className="text-sm font-semibold">{formatINR(priceDialog.price * priceDialog.position.quantity)}</span>
                      </div>
                      <div className="my-0.5 h-px w-full bg-border" />
                      <div className="flex justify-between">
                        <span className="text-xs text-muted-foreground">P&L</span>
                        <span className={cn(
                          "text-[1.1rem] font-bold",
                          (priceDialog.price * priceDialog.position.quantity - priceDialog.position.buyPrice * priceDialog.position.quantity) >= 0
                            ? "text-emerald-500"
                            : "text-red-500"
                        )}>
                          {formatINR(priceDialog.price * priceDialog.position.quantity - priceDialog.position.buyPrice * priceDialog.position.quantity)}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-xs text-muted-foreground">Return</span>
                        <span className={cn(
                          "text-[1.1rem] font-bold",
                          priceDialog.price >= priceDialog.position.buyPrice ? "text-emerald-500" : "text-red-500"
                        )}>
                          {formatPct((priceDialog.price - priceDialog.position.buyPrice) / priceDialog.position.buyPrice * 100)}
                        </span>
                      </div>
                      {priceDialog.position.targetPrice != null && priceDialog.position.targetPrice > 0 && (
                        <>
                          <div className="my-0.5 h-px w-full bg-border" />
                          <div className="flex justify-between">
                            <span className="text-xs text-muted-foreground">Target</span>
                            <span className="text-sm font-semibold">{formatINR(priceDialog.position.targetPrice)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-xs text-muted-foreground">Remaining to Target</span>
                            <span className={cn(
                              "text-[1.1rem] font-bold",
                              priceDialog.price <= priceDialog.position.targetPrice ? "text-emerald-500" : "text-red-500"
                            )}>
                              {formatINR(priceDialog.position.targetPrice * priceDialog.position.quantity - priceDialog.price * priceDialog.position.quantity)}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-xs text-muted-foreground">Remaining Return</span>
                            <span className={cn(
                              "text-[1.1rem] font-bold",
                              priceDialog.price <= priceDialog.position.targetPrice ? "text-emerald-500" : "text-red-500"
                            )}>
                              {formatPct((priceDialog.position.targetPrice - priceDialog.price) / priceDialog.position.buyPrice * 100)}
                            </span>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="py-3 text-center">
                    <AlertTriangle size={32} className="mx-auto mb-2 text-yellow-500" />
                    <p className="text-sm text-muted-foreground">No price data available</p>
                  </div>
                )}
                <DialogFooter>
                  <Button variant="outline" onClick={handleClosePriceDialog}>Close</Button>
                </DialogFooter>
              </>
            )}
          </DialogContent>
        </Dialog>

        {/* Clear All Confirmation Dialog */}
        <Dialog open={clearDialogOpen} onOpenChange={setClearDialogOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Clear Portfolio?</DialogTitle>
              <DialogDescription>
                This will permanently delete all {positions.length} position(s) from your paper trading portfolio. This action cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setClearDialogOpen(false)}>Cancel</Button>
              <Button variant="destructive" onClick={handleClear}>Clear All</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Toast */}
        {toast && (
          <div className={cn(
            "fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-md px-4 py-2 text-sm text-white shadow-lg",
            toast.variant === "success" && "bg-emerald-600",
            toast.variant === "error" && "bg-destructive",
            toast.variant === "info" && "bg-muted-foreground"
          )}>
            {toast.message}
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}
