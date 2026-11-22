"use client";

// Drawings persistence — localStorage in local (FastAPI) mode, Supabase-backed
// API in deployed mode. Keeps the chart drawings per (user, ticker, interval).

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChartDrawing } from "../types";

const DATA_MODE = process.env.NEXT_PUBLIC_DATA_MODE || "local";

function storageKey(ticker: string, interval: string): string {
  return `vm_chart_drawings_${ticker}_${interval}`;
}

function loadLocal(ticker: string, interval: string): ChartDrawing[] {
  try {
    const raw = localStorage.getItem(storageKey(ticker, interval));
    return raw ? (JSON.parse(raw) as ChartDrawing[]) : [];
  } catch {
    return [];
  }
}

function saveLocal(ticker: string, interval: string, drawings: ChartDrawing[]) {
  try {
    localStorage.setItem(storageKey(ticker, interval), JSON.stringify(drawings));
  } catch (_) {}
}

async function apiGet(ticker: string, interval: string): Promise<ChartDrawing[]> {
  const res = await fetch(`/api/drawings?ticker=${encodeURIComponent(ticker)}&interval=${encodeURIComponent(interval)}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`drawings ${res.status}`);
  return res.json();
}

async function apiPost(drawing: ChartDrawing, ticker: string, interval: string): Promise<void> {
  await fetch("/api/drawings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...drawing, ticker, interval }),
  });
}

async function apiPatch(drawing: ChartDrawing): Promise<void> {
  await fetch(`/api/drawings?id=${encodeURIComponent(drawing.id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(drawing),
  });
}

async function apiDelete(id: string): Promise<void> {
  await fetch(`/api/drawings?id=${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function useDrawings(ticker: string, interval: string) {
  const [drawings, setDrawings] = useState<ChartDrawing[]>([]);
  const [loaded, setLoaded] = useState(false);
  const tickerRef = useRef(ticker);
  const intervalRef = useRef(interval);
  tickerRef.current = ticker;
  intervalRef.current = interval;

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    if (DATA_MODE === "supabase") {
      apiGet(ticker, interval)
        .then((d) => { if (!cancelled) { setDrawings(d); setLoaded(true); } })
        .catch(() => { if (!cancelled) { setDrawings(loadLocal(ticker, interval)); setLoaded(true); } });
    } else {
      setDrawings(loadLocal(ticker, interval));
      setLoaded(true);
    }
    return () => { cancelled = true; };
  }, [ticker, interval]);

  const addDrawing = useCallback((d: ChartDrawing) => {
    setDrawings((prev) => {
      const next = [...prev, d];
      const t = tickerRef.current, iv = intervalRef.current;
      if (DATA_MODE === "supabase") apiPost(d, t, iv).catch(() => saveLocal(t, iv, next));
      else saveLocal(t, iv, next);
      return next;
    });
  }, []);

  const updateDrawing = useCallback((d: ChartDrawing) => {
    setDrawings((prev) => {
      const next = prev.map((x) => (x.id === d.id ? d : x));
      const t = tickerRef.current, iv = intervalRef.current;
      if (DATA_MODE === "supabase") apiPatch(d).catch(() => saveLocal(t, iv, next));
      else saveLocal(t, iv, next);
      return next;
    });
  }, []);

  const deleteDrawing = useCallback((id: string) => {
    setDrawings((prev) => {
      const next = prev.filter((x) => x.id !== id);
      const t = tickerRef.current, iv = intervalRef.current;
      if (DATA_MODE === "supabase") apiDelete(id).catch(() => saveLocal(t, iv, next));
      else saveLocal(t, iv, next);
      return next;
    });
  }, []);

  /** Replace the whole drawing list (used by undo/redo). */
  const replaceDrawings = useCallback((next: ChartDrawing[]) => {
    setDrawings(next);
    const t = tickerRef.current, iv = intervalRef.current;
    saveLocal(t, iv, next);
  }, []);

  return { drawings, loaded, addDrawing, updateDrawing, deleteDrawing, replaceDrawings };
}