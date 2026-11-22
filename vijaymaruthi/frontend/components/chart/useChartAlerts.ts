"use client";

// Chart alerts — in-app price alerts per (user, ticker).
// localStorage in local (FastAPI) mode, Supabase-backed API in deployed mode.

import { useCallback, useEffect, useRef, useState } from "react";

export interface ChartAlert {
  id: string;
  ticker: string;
  direction: "above" | "below";
  price: number;
  note: string | null;
  active: boolean;
  created_at: string;
}

const DATA_MODE = process.env.NEXT_PUBLIC_DATA_MODE || "local";

function storageKey(ticker: string): string {
  return `vm_chart_alerts_${ticker}`;
}

function loadLocal(ticker: string): ChartAlert[] {
  try {
    const raw = localStorage.getItem(storageKey(ticker));
    return raw ? (JSON.parse(raw) as ChartAlert[]) : [];
  } catch {
    return [];
  }
}

function saveLocal(ticker: string, alerts: ChartAlert[]) {
  try {
    localStorage.setItem(storageKey(ticker), JSON.stringify(alerts));
  } catch (_) {}
}

async function apiGet(ticker: string): Promise<ChartAlert[]> {
  const res = await fetch(`/api/alerts?ticker=${encodeURIComponent(ticker)}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`alerts ${res.status}`);
  return res.json();
}

async function apiPost(alert: Omit<ChartAlert, "id" | "created_at">): Promise<ChartAlert> {
  const res = await fetch("/api/alerts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(alert),
  });
  if (!res.ok) throw new Error(`alerts create ${res.status}`);
  return res.json();
}

async function apiPatch(id: string, patch: Partial<ChartAlert>): Promise<void> {
  await fetch(`/api/alerts?id=${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
}

async function apiDelete(id: string): Promise<void> {
  await fetch(`/api/alerts?id=${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function useChartAlerts(ticker: string) {
  const [alerts, setAlerts] = useState<ChartAlert[]>([]);
  const [loaded, setLoaded] = useState(false);
  const tickerRef = useRef(ticker);
  tickerRef.current = ticker;

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    if (DATA_MODE === "supabase") {
      apiGet(ticker)
        .then((a) => { if (!cancelled) { setAlerts(a); setLoaded(true); } })
        .catch(() => { if (!cancelled) { setAlerts(loadLocal(ticker)); setLoaded(true); } });
    } else {
      setAlerts(loadLocal(ticker));
      setLoaded(true);
    }
    return () => { cancelled = true; };
  }, [ticker]);

  const addAlert = useCallback((input: { direction: "above" | "below"; price: number; note?: string }) => {
    const t = tickerRef.current;
    const local: ChartAlert = {
      id: `a_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      ticker: t,
      direction: input.direction,
      price: input.price,
      note: input.note ?? null,
      active: true,
      created_at: new Date().toISOString(),
    };
    setAlerts((prev) => {
      const next = [local, ...prev];
      if (DATA_MODE === "supabase") {
        apiPost({ ticker: t, direction: local.direction, price: local.price, note: local.note, active: true })
          .then((saved) => {
            setAlerts((cur) => cur.map((a) => (a.id === local.id ? { ...saved } : a)));
          })
          .catch(() => saveLocal(t, next));
      } else {
        saveLocal(t, next);
      }
      return next;
    });
    return local;
  }, []);

  const updateAlert = useCallback((id: string, patch: Partial<ChartAlert>) => {
    setAlerts((prev) => {
      const next = prev.map((a) => (a.id === id ? { ...a, ...patch } : a));
      const t = tickerRef.current;
      if (DATA_MODE === "supabase") apiPatch(id, patch).catch(() => saveLocal(t, next));
      else saveLocal(t, next);
      return next;
    });
  }, []);

  const deleteAlert = useCallback((id: string) => {
    setAlerts((prev) => {
      const next = prev.filter((a) => a.id !== id);
      const t = tickerRef.current;
      if (DATA_MODE === "supabase") apiDelete(id).catch(() => saveLocal(t, next));
      else saveLocal(t, next);
      return next;
    });
  }, []);

  return { alerts, loaded, addAlert, updateAlert, deleteAlert };
}