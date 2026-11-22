"use client";

import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";
import type { MarketResponse } from "@/lib/types";

/**
 * Market-wide intelligence (breadth, sectors, breakout ledger).
 * Served by GET /api/market (server-side aggregation over the snapshot).
 * Works in both data modes — the route skips auth in local mode.
 */
export function useMarketData() {
  const [data, setData] = useState<MarketResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await api.getMarket();
      setData(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load market data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { data, loading, error, refresh };
}