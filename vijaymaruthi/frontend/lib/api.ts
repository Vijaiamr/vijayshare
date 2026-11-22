// API client for the VijayMaruthi Wealth Management backend
// Optimised for Indian markets (NSE/BSE) with ₹ defaults

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8765/api/v1";
const FETCH_TIMEOUT = 30_000; // 30s — prevents infinite loading spinners

// Data mode: "local" (FastAPI on your Mac) or "supabase" (server proxy → Supabase)
const DATA_MODE = process.env.NEXT_PUBLIC_DATA_MODE || "local";

async function fetchJSON<T>(path: string, options?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
  const url = `${API_BASE}${path}`;
  try {
    const res = await fetch(url, {
      headers: { "Content-Type": "application/json", ...options?.headers },
      signal: controller.signal,
      ...options,
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`API ${res.status}: ${body.slice(0, 200)}`);
    }
    return res.json();
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Same-origin fetch for the deployed "supabase" data mode.
 *
 * The backend API_BASE (http://localhost:8765) does NOT exist on Vercel, so
 * deployed calls go through Next.js proxy routes (/api/*) on the same origin.
 * Handles the 401 → /login redirect used across the app.
 */
async function sameOriginFetch<T>(path: string): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
  try {
    const res = await fetch(path, {
      cache: "no-store",
      signal: controller.signal,
    });
    if (res.status === 401 && typeof window !== "undefined") {
      window.location.href = `/login?next=${encodeURIComponent(path)}`;
      throw new Error("Session expired — redirecting to login");
    }
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`${path} ${res.status}: ${body.slice(0, 200)}`);
    }
    return res.json();
  } finally {
    clearTimeout(timeoutId);
  }
}

export interface AnalyzeParams {
  ticker: string;
  period?: string;
  sentiment?: boolean;
  save_db?: boolean;
}

export const api = {
  /** Health check */
  health: () => fetchJSON<{ status: string; version: string }>("/health"),

  /** Analyse a single ticker */
  analyze: (params: AnalyzeParams) => {
    // Supabase mode: same-origin proxy route serves the real snapshot row.
    // Deep-dive engine sections (patterns, Wyckoff, Gann, backtest) need the
    // Python backend — not deployed — and degrade gracefully on the page.
    if (DATA_MODE === "supabase") {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
      return (async () => {
        try {
          const res = await fetch(`/api/stock/${encodeURIComponent(params.ticker)}`, {
            cache: "no-store",
            signal: controller.signal,
          });
          if (res.status === 401 && typeof window !== "undefined") {
            window.location.href = `/login?next=/stock/${encodeURIComponent(params.ticker)}`;
            throw new Error("Session expired — redirecting to login");
          }
          if (!res.ok) {
            const body = await res.text();
            throw new Error(`Stock ${res.status}: ${body.slice(0, 200)}`);
          }
          return res.json();
        } finally {
          clearTimeout(timeoutId);
        }
      })();
    }
    return fetchJSON<any>("/analyze", {
      method: "POST",
      body: JSON.stringify({
        ticker: params.ticker,
        period: params.period || "1y",
        sentiment: params.sentiment ?? false,
        save_db: params.save_db ?? false,
      }),
    });
  },

  /** Batch analyse multiple tickers */
  analyzeBatch: (tickers: string[], period = "1y", sentiment = false) =>
    fetchJSON<import("./types").BatchResult>("/analyze/batch", {
      method: "POST",
      body: JSON.stringify({ tickers, period, sentiment }),
    }),

  /** Convenience: analyse default Indian watchlist */
  analyzeNSEWatchlist: (period = "1y") => {
    const { INDIAN_WATCHLIST } = require("./types");
    return api.analyzeBatch([...INDIAN_WATCHLIST], period);
  },

  /** Get full-picture dashboard (analysis + DB trend merged) */
  getDashboard: async (force = false, period = "1y") => {
    // Supabase mode: same-origin proxy route. Auth = Supabase session cookie;
    // the shared APP_TOKEN is no longer sent from the browser.
    if (DATA_MODE === "supabase") {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
      try {
        const res = await fetch(`/api/dashboard?force=${force ? "1" : "0"}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (res.status === 401 && typeof window !== "undefined") {
          window.location.href = "/login?next=/";
          throw new Error("Session expired — redirecting to login");
        }
        if (!res.ok) {
          const body = await res.text();
          throw new Error(`Dashboard ${res.status}: ${body.slice(0, 200)}`);
        }
        return res.json();
      } finally {
        clearTimeout(timeoutId);
      }
    }
    // Local mode: FastAPI backend (dev / same-machine)
    return fetchJSON<import("./types").DashboardResponse>(
      `/dashboard?force=${force}&period=${period}`,
    );
  },

  /** Get portfolio snapshot from DB */
  getPortfolio: () =>
    fetchJSON<import("./types").PortfolioRow[]>("/portfolio"),

  /** Get ticker history */
  getHistory: (ticker: string) =>
    fetchJSON<import("./types").TickerHistory>(`/history/${encodeURIComponent(ticker)}`),

  /** Get all NSE symbols */
  getNseSymbols: () => {
    if (DATA_MODE === "supabase") {
      // Deployed: same-origin proxy serves the real ticker list from the snapshot
      return sameOriginFetch<import("./types").NseSymbolsResponse>("/api/nse-symbols");
    }
    return fetchJSON<import("./types").NseSymbolsResponse>("/nse-symbols");
  },

  /** Start background scan of ALL NSE stocks */
  startNseScan: (period = "1y") =>
    fetchJSON<import("./types").ScanStartResponse>("/analyze/scan-nse", {
      method: "POST",
      body: JSON.stringify({ period }),
    }),

  /** Start background scan of only pending (not-yet-analysed) NSE stocks */
  startPendingNseScan: (period = "1y") =>
    fetchJSON<import("./types").ScanStartResponse>("/analyze/scan-pending", {
      method: "POST",
      body: JSON.stringify({ period }),
    }),

  /** Poll NSE scan progress */
  getScanProgress: (scanId: string) =>
    fetchJSON<import("./types").ScanProgress>(`/analyze/scan-progress/${scanId}`),

  /** Get last traded price (real-time via intraday 1m data) */
  getLastPrice: (ticker: string) => {
    if (DATA_MODE === "supabase") {
      // Deployed: derive the last price from the snapshot row (no live backend)
      return sameOriginFetch<import("./types").TickerAnalysis>(`/api/stock/${encodeURIComponent(ticker)}`)
        .then((a) => ({
          ticker,
          price: a.price ?? null,
          time: a.cached_at ?? null,
          source: "snapshot",
        }))
        .catch(() => ({ ticker, price: null, time: null, source: "snapshot" }));
    }
    return fetchJSON<import("./types").LastPriceResponse>(`/last-price/${encodeURIComponent(ticker)}`);
  },

  /** Get OHLCV price data for interactive charting */
  getOHLCV: (ticker: string, period = "1y", interval = "1d") => {
    if (DATA_MODE === "supabase") {
      // Deployed: same-origin proxy slices the precomputed 5y series
      return sameOriginFetch<import("./types").OHLCVResponse>(
        `/api/ohlcv/${encodeURIComponent(ticker)}?period=${encodeURIComponent(period)}&interval=${encodeURIComponent(interval)}`,
      );
    }
    return fetchJSON<import("./types").OHLCVResponse>(`/ohlcv/${encodeURIComponent(ticker)}?period=${period}&interval=${interval}`);
  },

  /** Run quantamental backtest for a ticker */
  runBacktest: (ticker: string, years = 3, rebalanceDays = 63) =>
    fetchJSON<import("./types").BacktestResponse>("/backtest", {
      method: "POST",
      body: JSON.stringify({ ticker, years, rebalance_days: rebalanceDays }),
    }),

  /** Run chart pattern backtest for a ticker */
  patternBacktest: (
    ticker: string,
    years = 3,
    minConfidence = 60,
    minRr = 1.5,
    screenConfig?: import("./patterns").ScreenConfig,
  ) =>
    fetchJSON<import("./types").PatternBacktestResponse>("/pattern-backtest", {
      method: "POST",
      body: JSON.stringify({
        ticker,
        years,
        min_confidence: minConfidence,
        min_rr: minRr,
        screen_config: screenConfig ?? null,
      }),
    }),

  /** Get fundamental data for a stock ticker */
  getFundamentals: (ticker: string) => {
    if (DATA_MODE === "supabase") {
      // Deployed: same-origin proxy serves the stored normalized snapshot
      return sameOriginFetch<import("./types").FundamentalsData>(
        `/api/fundamentals/${encodeURIComponent(ticker)}`,
      );
    }
    return fetchJSON<import("./types").FundamentalsData>(`/fundamentals/${encodeURIComponent(ticker)}`);
  },

  /** Get market-wide sector rotation / relative strength (Feature 1).
   *  Only available in "supabase" data mode (server-side aggregation). */
  getMarket: () =>
    sameOriginFetch<import("./types").MarketResponse>("/api/market"),

  /**
   * Deterministic analyzer (analysis_app). Local-only: it reads a pinned
   * snapshot on the machine running the FastAPI backend, so it is unavailable
   * in "supabase" data mode.
   */
  deterministic: {
    health: () =>
      fetchJSON<import("./types").DeterministicHealth>("/deterministic/health"),
    universe: () =>
      fetchJSON<import("./types").DeterministicUniverse>("/deterministic/universe"),
    state: (ticker: string, timeline = false) =>
      fetchJSON<import("./types").DeterministicStock>(
        `/deterministic/state/${encodeURIComponent(ticker)}?timeline=${timeline ? "1" : "0"}`,
      ),
    analyze: (body: { limit?: number; as_of?: string; period?: string; timeline?: boolean; persist?: boolean }) =>
      fetchJSON<import("./types").DeterministicRunResponse>("/deterministic/analyze", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    runs: () =>
      fetchJSON<{ runs: import("./types").DeterministicRunSummary[] }>("/deterministic/runs"),
    run: (runId: string) =>
      fetchJSON<import("./types").DeterministicRunDetail>(
        `/deterministic/runs/${encodeURIComponent(runId)}`,
      ),
  },
};
