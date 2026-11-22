"use client";

// Chart layouts — saved named chart configurations.
// localStorage in local (FastAPI) mode, Supabase-backed API in deployed mode.

import { useCallback, useEffect, useState } from "react";

export interface ChartLayoutConfig {
  ticker: string;
  interval: string;
  lookback: string;
  chartType: string;
}

export interface ChartLayout {
  id: string;
  name: string;
  layout: ChartLayoutConfig[];
  created_at: string;
  updated_at: string;
}

const DATA_MODE = process.env.NEXT_PUBLIC_DATA_MODE || "local";
const LS_KEY = "vm_chart_layouts";

function loadLocal(): ChartLayout[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? (JSON.parse(raw) as ChartLayout[]) : [];
  } catch {
    return [];
  }
}

function saveLocal(layouts: ChartLayout[]) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(layouts));
  } catch (_) {}
}

async function apiGet(): Promise<ChartLayout[]> {
  const res = await fetch("/api/layouts", { cache: "no-store" });
  if (!res.ok) throw new Error(`layouts ${res.status}`);
  return res.json();
}

async function apiPost(name: string, layout: ChartLayoutConfig[]): Promise<ChartLayout> {
  const res = await fetch("/api/layouts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, layout }),
  });
  if (!res.ok) throw new Error(`layouts create ${res.status}`);
  return res.json();
}

async function apiPatch(id: string, patch: Partial<ChartLayout>): Promise<void> {
  await fetch(`/api/layouts?id=${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
}

async function apiDelete(id: string): Promise<void> {
  await fetch(`/api/layouts?id=${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function useChartLayouts() {
  const [layouts, setLayouts] = useState<ChartLayout[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (DATA_MODE === "supabase") {
      apiGet()
        .then((l) => { if (!cancelled) { setLayouts(l); setLoaded(true); } })
        .catch(() => { if (!cancelled) { setLayouts(loadLocal()); setLoaded(true); } });
    } else {
      setLayouts(loadLocal());
      setLoaded(true);
    }
    return () => { cancelled = true; };
  }, []);

  const saveLayout = useCallback((name: string, layout: ChartLayoutConfig[]) => {
    const local: ChartLayout = {
      id: `l_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name,
      layout,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    setLayouts((prev) => {
      const next = [local, ...prev];
      if (DATA_MODE === "supabase") {
        apiPost(name, layout)
          .then((saved) => {
            setLayouts((cur) => cur.map((l) => (l.id === local.id ? { ...saved } : l)));
          })
          .catch(() => saveLocal(next));
      } else {
        saveLocal(next);
      }
      return next;
    });
    return local;
  }, []);

  const deleteLayout = useCallback((id: string) => {
    setLayouts((prev) => {
      const next = prev.filter((l) => l.id !== id);
      if (DATA_MODE === "supabase") apiDelete(id).catch(() => saveLocal(next));
      else saveLocal(next);
      return next;
    });
  }, []);

  return { layouts, loaded, saveLayout, deleteLayout };
}