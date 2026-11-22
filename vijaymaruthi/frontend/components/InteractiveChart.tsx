"use client";

// InteractiveChart — composition wrapper.
//
// Owns view state (lookback, interval, chart type, toggles, settings,
// drawings, compare, replay, templates) and delegates all lightweight-charts
// work to ChartBuilder. The public API is unchanged: { ticker, targetPrice?,
// backendPatterns? }.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { OHLCVPoint } from "@/lib/types";
import { computeIndicators } from "@/lib/indicators";
import type { DetectedPattern } from "@/lib/patterns";
import { getCurrentMode } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { buildChart } from "./chart/ChartBuilder";
import type { ChartHandle } from "./chart/types";
import ChartToolbar from "./chart/ChartToolbar";
import ChartLegend from "./chart/ChartLegend";
import ChartSettingsDialog from "./chart/ChartSettings";
import ChartAlertsDialog from "./chart/ChartAlertsDialog";
import ChartLayoutsDialog from "./chart/ChartLayoutsDialog";
import ChartTemplatesDialog from "./chart/ChartTemplatesDialog";
import ChartSymbolSearchDialog from "./chart/ChartSymbolSearchDialog";
import ChartDataWindow from "./chart/ChartDataWindow";
import ChartObjectTree from "./chart/ChartObjectTree";
import DrawingLayer from "./chart/drawings/DrawingLayer";
import { useDrawings } from "./chart/drawings/useDrawings";
import { useChartAlerts } from "./chart/useChartAlerts";
import { useChartLayouts } from "./chart/useChartLayouts";
import { transformCandles } from "./chart/resample";
import type {
  BarInterval, ChartDrawing, ChartSettings, ChartTemplate, ChartTime, ChartType, CompareSeries,
  DrawingType, IndicatorSettings, Lookback, PaneKey, ReplayState, ToggleKey, ToggleState,
} from "./chart/types";
import {
  DEFAULT_CHART_SETTINGS, DEFAULT_INDICATOR_SETTINGS, DEFAULT_TOGGLES, PANE_DEFS,
} from "./chart/types";

interface Props {
  ticker: string;
  targetPrice?: number | null;
  backendPatterns?: DetectedPattern[];
  /** Optional initial view state (used by the multi-chart grid page). */
  initialView?: { interval?: BarInterval; lookback?: Lookback; chartType?: ChartType };
}

const LS_PREFIX = "vm_chart_";

function loadLS<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(LS_PREFIX + key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

function loadLSRaw<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(LS_PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function saveLS(key: string, value: unknown) {
  try {
    localStorage.setItem(LS_PREFIX + key, JSON.stringify(value));
  } catch (_) {}
}

const fmt = (v: number | null | undefined, digits = 2) =>
  v == null || Number.isNaN(Number(v)) ? "—" : Number(v).toLocaleString("en-IN", { maximumFractionDigits: digits });

export default function InteractiveChart({ ticker, targetPrice, backendPatterns, initialView }: Props) {
  const isDark = getCurrentMode() === "dark";

  // ── View state (persisted; initialView overrides for grid charts) ──
  const [lookback, setLookback] = useState<Lookback>(() => initialView?.lookback ?? loadLSRaw<Lookback>("lookback", "1y"));
  const [interval, setInterval] = useState<BarInterval>(() => initialView?.interval ?? loadLSRaw<BarInterval>("interval", "1d"));
  const [chartType, setChartType] = useState<ChartType>(() => initialView?.chartType ?? loadLSRaw<ChartType>("chartType", "candle"));
  const [toggles, setToggles] = useState<ToggleState>(() => loadLS("toggles", DEFAULT_TOGGLES));
  const [settings, setSettings] = useState<ChartSettings>(() => loadLS("settings", DEFAULT_CHART_SETTINGS));
  const [indicatorSettings, setIndicatorSettings] = useState<IndicatorSettings>(() => loadLS("indicatorSettings", DEFAULT_INDICATOR_SETTINGS));

  // ── Transient state ──
  const [rawCandles, setRawCandles] = useState<OHLCVPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTool, setActiveTool] = useState<DrawingType | "cursor">("cursor");
  const [drawingColor, setDrawingColor] = useState("#22d3ee");
  const [compare, setCompare] = useState<CompareSeries[]>(() => loadLSRaw<CompareSeries[]>(`compare_${ticker}`, []));
  const [replay, setReplay] = useState<ReplayState>({ active: false, index: 0, playing: false, speed: 5 });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [layoutsOpen, setLayoutsOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [symbolSearchOpen, setSymbolSearchOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [legend, setLegend] = useState<{ ohlc: { open: number; high: number; low: number; close: number; volume: number } | null; changePct: number | null }>({ ohlc: null, changePct: null });
  const [dataWindow, setDataWindow] = useState<{ time: ChartTime | null; ohlc: { open: number; high: number; low: number; close: number; volume: number } | null; changePct: number | null }>({ time: null, ohlc: null, changePct: null });
  const [selectedDrawingId, setSelectedDrawingId] = useState<string | null>(null);
  const [mainSize, setMainSize] = useState({ w: 0, h: 380 });
  const [templates, setTemplates] = useState<ChartTemplate[]>(() => loadLSRaw<ChartTemplate[]>("templates", []));
  const [vpVersion, setVpVersion] = useState(0); // bump to re-render volume profile overlay

  // ── Refs ──
  const containerRef = useRef<HTMLDivElement>(null);
  const mainContainerRef = useRef<HTMLDivElement>(null);
  const paneRefs = useRef<Partial<Record<PaneKey, HTMLDivElement | null>>>({});
  const handleRef = useRef<ChartHandle | null>(null);
  const replayTimerRef = useRef<number | null>(null);
  const crosshairCbRef = useRef<((info: { time: ChartTime | null; ohlc: { open: number; high: number; low: number; close: number; volume: number } | null; changePct: number | null }) => void) | null>(null);

  // ── Persist view state ──
  useEffect(() => saveLS("lookback", lookback), [lookback]);
  useEffect(() => saveLS("interval", interval), [interval]);
  useEffect(() => saveLS("chartType", chartType), [chartType]);
  useEffect(() => saveLS("toggles", toggles), [toggles]);
  useEffect(() => saveLS("settings", settings), [settings]);
  useEffect(() => saveLS("indicatorSettings", indicatorSettings), [indicatorSettings]);
  useEffect(() => saveLS("templates", templates), [templates]);
  // Compare list is persisted per ticker (Phase C2)
  useEffect(() => saveLS(`compare_${ticker}`, compare), [compare, ticker]);

  // ── Drawings ──
  const { drawings, addDrawing, updateDrawing, deleteDrawing, replaceDrawings } = useDrawings(ticker, interval);

  // ── Drawing undo/redo history ──
  const [historyPast, setHistoryPast] = useState<ChartDrawing[][]>([]);
  const [historyFuture, setHistoryFuture] = useState<ChartDrawing[][]>([]);

  const pushHistory = useCallback(() => {
    setHistoryPast((p) => [...p.slice(-49), drawings]);
    setHistoryFuture([]);
  }, [drawings]);

  const handleAddDrawing = useCallback((d: ChartDrawing) => {
    pushHistory();
    addDrawing(d);
  }, [pushHistory, addDrawing]);

  const handleUpdateDrawing = useCallback((d: ChartDrawing) => {
    pushHistory();
    updateDrawing(d);
  }, [pushHistory, updateDrawing]);

  const handleDeleteDrawing = useCallback((id: string) => {
    pushHistory();
    deleteDrawing(id);
    setSelectedDrawingId((s) => (s === id ? null : s));
  }, [pushHistory, deleteDrawing]);

  const handleDuplicateDrawing = useCallback((id: string) => {
    const src = drawings.find((d) => d.id === id);
    if (!src) return;
    pushHistory();
    const copy: ChartDrawing = {
      ...src,
      id: `d_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      // Nudge the copy so it is visibly distinct from the original.
      points: src.points.map((p) => ({ time: p.time, price: p.price * 1.002 })),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    addDrawing(copy);
    setSelectedDrawingId(copy.id);
  }, [drawings, pushHistory, addDrawing]);

  const handleToggleLock = useCallback((id: string) => {
    const src = drawings.find((d) => d.id === id);
    if (!src) return;
    pushHistory();
    updateDrawing({ ...src, locked: !src.locked, updatedAt: new Date().toISOString() });
  }, [drawings, pushHistory, updateDrawing]);

  const handleReorderDrawing = useCallback((id: string, dir: "front" | "back") => {
    const idx = drawings.findIndex((d) => d.id === id);
    if (idx < 0) return;
    pushHistory();
    const next = [...drawings];
    const [item] = next.splice(idx, 1);
    if (dir === "front") next.push(item);
    else next.unshift(item);
    replaceDrawings(next);
  }, [drawings, pushHistory, replaceDrawings]);

  const undo = useCallback(() => {
    setHistoryPast((past) => {
      if (past.length === 0) return past;
      const prev = past[past.length - 1];
      setHistoryFuture((f) => [...f, drawings]);
      replaceDrawings(prev);
      return past.slice(0, -1);
    });
  }, [drawings, replaceDrawings]);

  const redo = useCallback(() => {
    setHistoryFuture((future) => {
      if (future.length === 0) return future;
      const next = future[future.length - 1];
      setHistoryPast((p) => [...p, drawings]);
      replaceDrawings(next);
      return future.slice(0, -1);
    });
  }, [drawings, replaceDrawings]);

  // ── Alerts + layouts ──
  const { alerts, loaded: alertsLoaded, addAlert, updateAlert, deleteAlert } = useChartAlerts(ticker);
  const { layouts, loaded: layoutsLoaded, saveLayout, deleteLayout } = useChartLayouts();

  // ── Fetch data (interval-aware) ──
  const fetchData = useCallback(async (p: Lookback, iv: BarInterval) => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getOHLCV(ticker, p, iv);
      setRawCandles(res.candles ?? []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load chart data");
    } finally {
      setLoading(false);
    }
  }, [ticker]);

  useEffect(() => { fetchData(lookback, interval) }, [lookback, interval, fetchData]);

  // ── Transform + indicators ──
  const transformKind = chartType === "heikin" ? "heikin" : chartType === "renko" ? "renko" : "none";
  const candles = useMemo(() => transformCandles(rawCandles, interval, transformKind), [rawCandles, interval, transformKind]);

  const validCandles = useMemo(
    () => candles.filter((d) => [d.open, d.high, d.low, d.close, d.volume].every((v) => v != null && !Number.isNaN(Number(v)))),
    [candles],
  );

  const indicators = useMemo(() => {
    if (validCandles.length === 0) return null;
    return computeIndicators(validCandles, indicatorSettings);
  }, [validCandles, indicatorSettings]);

  // ── Alert firing: check active alerts against the latest close ──
  const lastClose = validCandles.length > 0 ? validCandles[validCandles.length - 1].close : null;
  useEffect(() => {
    if (lastClose == null) return;
    const fired = alerts.filter((a) => a.active && (a.direction === "above" ? lastClose >= a.price : lastClose <= a.price));
    fired.forEach((a) => {
      updateAlert(a.id, { active: false });
      toast(`${ticker} ${a.direction === "above" ? "crossed above" : "fell below"} ${a.price.toLocaleString("en-IN")}`, {
        description: a.note ?? "Price alert fired",
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [validCandles]);

  // ── Build chart (rebuilds on data / pane-visibility / theme changes) ──
  const paneKeys: PaneKey[] = PANE_DEFS.map((p) => p.key as PaneKey);
  const paneVisible = paneKeys.filter((k) => toggles[k]);

  useEffect(() => {
    if (!mainContainerRef.current || validCandles.length === 0 || !indicators) return;
    const handle = buildChart({
      mainEl: mainContainerRef.current,
      paneEls: paneRefs.current,
      candles: validCandles,
      indicators,
      backendPatterns: backendPatterns ?? [],
      targetPrice: targetPrice ?? null,
      isDark,
      chartType,
      settings,
      toggles,
      compare,
    });
    handleRef.current = handle;
    // Initial legend = last candle
    const last = validCandles[validCandles.length - 1];
    const first = validCandles[0];
    const initial = {
      ohlc: { open: last.open, high: last.high, low: last.low, close: last.close, volume: last.volume },
      changePct: first.close ? ((last.close - first.close) / first.close) * 100 : null,
    };
    setLegend(initial);
    setDataWindow({ time: last.time, ...initial });
    const cb = (info: { time: ChartTime | null; ohlc: { open: number; high: number; low: number; close: number; volume: number } | null; changePct: number | null }) => {
      setLegend({ ohlc: info.ohlc, changePct: info.changePct });
      setDataWindow(info);
    };
    crosshairCbRef.current = cb;
    handle.subscribeCrosshair(cb);
    handle.subscribeVisibleRange(() => setVpVersion((v) => v + 1));
    return () => {
      handle.destroy();
      handleRef.current = null;
      crosshairCbRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [validCandles, indicators, isDark, backendPatterns, targetPrice, paneVisible.join(",")]);

  // ── Apply non-pane toggles without rebuild ──
  useEffect(() => {
    handleRef.current?.setToggles(toggles);
  }, [toggles]);

  // ── Apply settings without rebuild ──
  useEffect(() => {
    handleRef.current?.setSettings(settings);
  }, [settings]);

  // ── Apply chart type without rebuild ──
  useEffect(() => {
    handleRef.current?.setChartType(chartType);
  }, [chartType]);

  // ── Apply compare without rebuild ──
  useEffect(() => {
    handleRef.current?.setCompare(compare);
  }, [compare]);

  // ── Measure main chart area (for drawing layer) ──
  useEffect(() => {
    const el = mainContainerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setMainSize({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    setMainSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // ── Compare data loading ──
  useEffect(() => {
    const missing = compare.filter((c) => c.data.length === 0);
    if (missing.length === 0) return;
    let cancelled = false;
    missing.forEach(async (c) => {
      try {
        const res = await api.getOHLCV(c.ticker, lookback, interval);
        if (cancelled) return;
        const data = (res.candles ?? []).map((d) => ({ time: d.time, value: Number(d.close) }));
        setCompare((prev) => prev.map((x) => (x.ticker === c.ticker ? { ...x, data } : x)));
      } catch (_) {}
    });
    return () => { cancelled = true; };
  }, [compare, lookback, interval]);

  // ── Replay ──
  const totalCandles = validCandles.length;

  useEffect(() => {
    if (!replay.active) return;
    if (replay.playing) {
      replayTimerRef.current = window.setInterval(() => {
        setReplay((r) => {
          const next = Math.min(r.index + r.speed, totalCandles);
          handleRef.current?.chart.timeScale().setVisibleLogicalRange({ from: 0, to: next });
          if (next >= totalCandles) return { ...r, index: next, playing: false };
          return { ...r, index: next };
        });
      }, 250);
    }
    return () => {
      if (replayTimerRef.current) clearInterval(replayTimerRef.current);
      replayTimerRef.current = null;
    };
  }, [replay.active, replay.playing, replay.speed, totalCandles]);

  const startReplay = useCallback(() => {
    setReplay({ active: true, index: 20, playing: true, speed: 5 });
    handleRef.current?.chart.timeScale().setVisibleLogicalRange({ from: 0, to: 20 });
  }, []);

  const exitReplay = useCallback(() => {
    setReplay({ active: false, index: 0, playing: false, speed: 5 });
    handleRef.current?.chart.timeScale().fitContent();
  }, []);

  // ── Export PNG ──
  const exportPng = useCallback(() => {
    const canvas = handleRef.current?.screenshot();
    if (!canvas) return;
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = `${ticker}_${interval}_${lookback}.png`;
    a.click();
  }, [ticker, interval, lookback]);

  // ── Snapshot (copy to clipboard, TradingView-style) ──
  const snapshot = useCallback(async () => {
    const canvas = handleRef.current?.screenshot();
    if (!canvas) return;
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": canvas.toDataURL("image/png") })]);
      toast("Snapshot copied to clipboard");
    } catch {
      // Fallback: download
      const a = document.createElement("a");
      a.href = canvas.toDataURL("image/png");
      a.download = `${ticker}_${interval}_${lookback}.png`;
      a.click();
      toast("Snapshot downloaded");
    }
  }, [ticker, interval, lookback]);

  // ── Fullscreen ──
  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) containerRef.current?.requestFullscreen?.();
    else document.exitFullscreen?.();
  }, []);

  useEffect(() => {
    const onFs = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  // ── Toggle handler ──
  const handleToggle = useCallback((k: ToggleKey, v: boolean) => {
    setToggles((prev) => ({ ...prev, [k]: v }));
  }, []);

  // ── Templates ──
  const applyTemplate = useCallback((t: ChartTemplate) => {
    setChartType(t.chartType);
    setInterval(t.interval);
    setLookback(t.lookback);
    setToggles(t.toggles);
    setSettings(t.settings);
    setIndicatorSettings(t.indicatorSettings);
    setTemplatesOpen(false);
    toast(`Template “${t.name}” applied`);
  }, []);

  const deleteTemplate = useCallback((id: string) => {
    setTemplates((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // ── Hotkeys ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
        return;
      }
      if (mod && e.key.toLowerCase() === "y") { e.preventDefault(); redo(); return; }
      if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); snapshot(); return; }
      if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedDrawingId) { handleDeleteDrawing(selectedDrawingId); return; }
      }
      if (e.key === "Escape") { setActiveTool("cursor"); setSelectedDrawingId(null); return; }
      if (e.key === "f" || e.key === "F") { toggleFullscreen(); return; }
      if (e.key === "v" || e.key === "V") { setActiveTool("trendline"); return; }
      if (e.key === "h" || e.key === "H") { setActiveTool("hline"); return; }
      if (e.key === "x" || e.key === "X") { setActiveTool("cursor"); return; }
      if (e.key === "s" || e.key === "S") { setSymbolSearchOpen(true); return; }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo, snapshot, toggleFullscreen, selectedDrawingId, handleDeleteDrawing]);

  // ── Data window rows ──
  const dataWindowRows = useMemo(() => {
    const o = dataWindow.ohlc;
    if (!o) return [];
    const rows = [
      { label: "O", value: fmt(o.open), color: o.open >= o.close ? "#f04e4e" : "#0bbd8a" },
      { label: "H", value: fmt(o.high), color: "#f04e4e" },
      { label: "L", value: fmt(o.low), color: "#0bbd8a" },
      { label: "C", value: fmt(o.close), color: o.close >= o.open ? "#0bbd8a" : "#f04e4e" },
      { label: "Vol", value: fmt(o.volume, 0) },
    ];
    if (dataWindow.changePct != null) {
      rows.push({ label: "Chg", value: `${dataWindow.changePct >= 0 ? "+" : ""}${dataWindow.changePct.toFixed(2)}%`, color: dataWindow.changePct >= 0 ? "#0bbd8a" : "#f04e4e" });
    }
    return rows;
  }, [dataWindow]);

  // ── Volume profile overlay (right-side horizontal histogram) ──
  const vpBars = useMemo(() => {
    if (!toggles.volumeProfile || !indicators?.volumeProfile || indicators.volumeProfile.length === 0) return [];
    const handle = handleRef.current;
    if (!handle) return [];
    const maxVol = Math.max(...indicators.volumeProfile.map((p) => p.volume));
    if (!maxVol) return [];
    const bars = indicators.volumeProfile
      .map((p) => {
        const y = handle.priceToCoordinate(p.price);
        if (y == null) return null;
        return { y, w: Math.max(4, (p.volume / maxVol) * 90), isPOC: p.isPOC, isVA: p.isVA };
      })
      .filter((b): b is { y: number; w: number; isPOC: boolean; isVA: boolean } => b != null);
    return bars;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toggles.volumeProfile, indicators, vpVersion, mainSize]);

  // ── Session breaks overlay (weekend shading) ──
  const sessionBreaks = useMemo(() => {
    if (!settings.sessionBreaks || validCandles.length === 0) return [];
    const handle = handleRef.current;
    if (!handle) return [];
    const range = handle.getVisibleRange();
    if (!range) return [];
    const breaks: { x: number }[] = [];
    // Walk the visible candles; mark the first candle of each new week.
    // Logical range indices can be negative when scrolled — clamp to 0.
    const from = Math.max(0, Math.floor(range.from));
    const to = Math.min(validCandles.length - 1, Math.ceil(range.to));
    let prevWeek = "";
    for (let i = from; i <= to; i++) {
      const t = validCandles[i].time;
      const week = String(t).slice(0, 10); // YYYY-MM-DD (or epoch → slice is harmless)
      const d = new Date(week);
      if (Number.isNaN(d.getTime())) continue;
      const wk = `${d.getFullYear()}-${d.getMonth()}-${Math.floor(d.getDate() / 7)}`;
      if (prevWeek && wk !== prevWeek) {
        const x = handle.timeToCoordinate(t);
        if (x != null) breaks.push({ x });
      }
      prevWeek = wk;
    }
    return breaks;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.sessionBreaks, validCandles, vpVersion, mainSize]);

  const intervalLabel = interval === "1d" ? "1D" : interval === "1w" ? "1W" : interval === "1M" ? "1M" : interval.toUpperCase();

  return (
    <div ref={containerRef} className={cn("relative", isFullscreen && "fixed inset-0 z-50 bg-background p-2")}>
      <ChartToolbar
        lookback={lookback}
        onLookbackChange={setLookback}
        interval={interval}
        onIntervalChange={setInterval}
        chartType={chartType}
        onChartTypeChange={setChartType}
        toggles={toggles}
        onToggleChange={handleToggle}
        activeTool={activeTool}
        onToolChange={setActiveTool}
        drawingColor={drawingColor}
        onDrawingColorChange={setDrawingColor}
        compare={compare}
        onCompareChange={setCompare}
        onReplay={startReplay}
        onExport={exportPng}
        onSnapshot={snapshot}
        onFullscreen={toggleFullscreen}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenAlerts={() => setAlertsOpen(true)}
        onOpenLayouts={() => setLayoutsOpen(true)}
        onOpenTemplates={() => setTemplatesOpen(true)}
        onOpenSymbolSearch={() => setSymbolSearchOpen(true)}
        isFullscreen={isFullscreen}
      />

      {loading && (
        <div className="flex justify-center py-8">
          <div className="size-7 animate-spin rounded-full border-2 border-muted border-t-primary" />
        </div>
      )}
      {error && !loading && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className={cn("relative", (loading || error) && "hidden")}>
        <div ref={mainContainerRef} className="h-[380px] w-full overflow-hidden rounded-lg" />

        {/* Watermark overlay (lightweight-charts v5 has no text watermark option) */}
        {settings.watermark && (
          <div className="pointer-events-none absolute inset-0 z-[5] flex items-center justify-center">
            <span className={cn("text-4xl font-bold tracking-tight select-none", isDark ? "text-white/5" : "text-black/5")}>
              {settings.watermark}
            </span>
          </div>
        )}

        {/* Session breaks (weekend shading) */}
        {sessionBreaks.length > 0 && (
          <svg className="pointer-events-none absolute inset-0 z-[6] h-full w-full">
            {sessionBreaks.map((b, i) => (
              <line key={i} x1={b.x} y1={0} x2={b.x} y2={mainSize.h} stroke={isDark ? "rgba(255,255,255,0.08)" : "rgba(9,9,11,0.08)"} strokeDasharray="3 3" />
            ))}
          </svg>
        )}

        {/* Volume profile (right-side histogram) */}
        {vpBars.length > 0 && (
          <svg className="pointer-events-none absolute top-0 right-0 z-[6] h-full" width={100}>
            {vpBars.map((b, i) => (
              <rect
                key={i}
                x={100 - b.w}
                y={b.y - 1}
                width={b.w}
                height={2}
                fill={b.isPOC ? (isDark ? "rgba(34,211,238,0.7)" : "rgba(8,145,178,0.7)") : b.isVA ? (isDark ? "rgba(34,211,238,0.25)" : "rgba(8,145,178,0.25)") : (isDark ? "rgba(255,255,255,0.12)" : "rgba(9,9,11,0.12)")}
              />
            ))}
          </svg>
        )}

        {/* Legend overlay */}
        <div className="pointer-events-none absolute top-1 left-2 z-10">
          <ChartLegend
            ticker={ticker}
            intervalLabel={intervalLabel}
            ohlc={legend.ohlc}
            changePct={legend.changePct}
            isDark={isDark}
          />
        </div>

        {/* Object tree */}
        <ChartObjectTree
          drawings={drawings}
          selectedId={selectedDrawingId}
          onSelect={setSelectedDrawingId}
          onDelete={handleDeleteDrawing}
        />

        {/* Drawing layer */}
        {mainSize.w > 0 && (
          <DrawingLayer
            handle={handleRef.current}
            drawings={drawings}
            activeTool={activeTool}
            color={drawingColor}
            width={mainSize.w}
            height={mainSize.h}
            selectedId={selectedDrawingId}
            onSelect={setSelectedDrawingId}
            onAdd={handleAddDrawing}
            onUpdate={handleUpdateDrawing}
            onDelete={handleDeleteDrawing}
            onDuplicate={handleDuplicateDrawing}
            onToggleLock={handleToggleLock}
            onReorder={handleReorderDrawing}
          />
        )}

        {/* Sub-panes */}
        {paneVisible.map((key) => {
          const def = PANE_DEFS.find((p) => p.key === key)!;
          return (
            <div key={key} className="relative border-t border-border/60">
              <span className="absolute top-0.5 left-1 z-10 text-[0.6rem] font-semibold text-muted-foreground">
                {def.label}
              </span>
              <div
                ref={(el) => { paneRefs.current[key] = el; }}
                className="h-[100px] w-full overflow-hidden"
              />
            </div>
          );
        })}
      </div>

      {/* Data window (crosshair readout) */}
      {!loading && !error && <ChartDataWindow rows={dataWindowRows} />}

      {/* Replay bar */}
      {replay.active && (
        <div className="mt-1 flex items-center gap-2 rounded-lg border border-border/60 bg-muted/40 px-2 py-1.5">
          <Button size="xs" variant="secondary" onClick={() => setReplay((r) => ({ ...r, playing: !r.playing }))}>
            {replay.playing ? "Pause" : "Play"}
          </Button>
          <Button size="xs" variant="ghost" onClick={() => setReplay((r) => ({ ...r, index: 20, playing: true }))}>
            Restart
          </Button>
          <input
            type="range"
            min={20}
            max={Math.max(20, totalCandles)}
            value={replay.index}
            onChange={(e) => {
              const v = Number(e.target.value);
              setReplay((r) => ({ ...r, index: v, playing: false }));
              handleRef.current?.chart.timeScale().setVisibleLogicalRange({ from: 0, to: v });
            }}
            className="h-1.5 flex-1 cursor-pointer accent-[#20d6a0]"
          />
          <span className="text-xs tabular-nums text-muted-foreground">
            {replay.index}/{totalCandles}
          </span>
          <div className="flex items-center gap-0.5 rounded-md border border-border/60 p-0.5">
            {[1, 2, 5, 10].map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setReplay((r) => ({ ...r, speed: s }))}
                className={cn(
                  "rounded px-1.5 py-0.5 text-[0.65rem] font-medium transition-colors",
                  replay.speed === s ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
                )}
              >
                {s}×
              </button>
            ))}
          </div>
          <Button size="xs" variant="ghost" onClick={exitReplay}>Exit</Button>
        </div>
      )}

      <ChartSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        settings={settings}
        indicatorSettings={indicatorSettings}
        onSettingsChange={setSettings}
        onIndicatorSettingsChange={setIndicatorSettings}
      />

      <ChartAlertsDialog
        open={alertsOpen}
        onOpenChange={setAlertsOpen}
        ticker={ticker}
        alerts={alerts}
        loaded={alertsLoaded}
        lastPrice={lastClose}
        onAdd={addAlert}
        onUpdate={updateAlert}
        onDelete={deleteAlert}
      />

      <ChartLayoutsDialog
        open={layoutsOpen}
        onOpenChange={setLayoutsOpen}
        layouts={layouts}
        loaded={layoutsLoaded}
        currentTicker={ticker}
        currentView={{ interval, lookback, chartType }}
        onSave={saveLayout}
        onDelete={deleteLayout}
      />

      <ChartTemplatesDialog
        open={templatesOpen}
        onOpenChange={setTemplatesOpen}
        templates={templates}
        onSave={(t) => setTemplates((prev) => [...prev, t])}
        onDelete={deleteTemplate}
        onApply={applyTemplate}
        current={{ chartType, interval, lookback, toggles, settings, indicatorSettings }}
      />

      <ChartSymbolSearchDialog
        open={symbolSearchOpen}
        onOpenChange={setSymbolSearchOpen}
        currentTicker={ticker}
      />
    </div>
  );
}