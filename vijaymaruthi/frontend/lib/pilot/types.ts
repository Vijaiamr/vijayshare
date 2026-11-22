/**
 * Auto Pilot — paper-trading types.
 *
 * The pilot reads the app's top BUY-scored tickers, computes real entry /
 * target / stop-loss from the underlying S/R + ATR analysis, paper-trades
 * them with a fixed notional capital, and marks to market against the latest
 * NSE close on every refresh.
 */

export interface PilotState {
  id: string;
  capital: number; // starting capital ₹
  availableCash: number; // unallocated cash ₹
  startedAt: string;
  updatedAt: string;
}

export interface PilotTrade {
  id: string;
  ticker: string;
  direction: "BUY";
  entry: number;
  target1: number;
  stopLoss: number;
  quantity: number;
  notional: number;
  qmScore: number | null;
  techSignal: string | null;
  fundScore: number | null;
  fundRating: string | null;
  status: "OPEN" | "CLOSED";
  closeReason: "take-profit" | "stop-loss" | "manual" | null;
  currentPrice: number | null;
  pnl: number | null;
  pnlPct: number | null;
  openDate: string;
  closeDate: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PilotSnapshot {
  state: PilotState | null;
  trades: PilotTrade[];
  /** Aggregate realized + unrealized P&L across all trades */
  totalPnl: number;
  /** Aggregate P&L as % of starting capital */
  totalPnlPct: number;
  /** Win rate across CLOSED trades */
  winRate: number | null;
  /** Number of OPEN positions */
  openCount: number;
  /** Number of CLOSED positions */
  closedCount: number;
  /** When the last refresh marked prices */
  lastMarkedAt: string | null;
  /** Live-price source used on the last refresh */
  lastPriceSource: string | null;
}

/** A candidate ticker the pilot could trade (from the app's snapshot). */
export interface PilotCandidate {
  ticker: string;
  qmScore: number;
  techSignal: string;
  qmRating: string;
  price: number | null;
  fundScore: number | null;
  fundRating: string | null;
  // Real-engine trade levels (from _classify_signal). When present, the pilot
  // trades on these — the SAME analysis engine as the rest of the platform.
  entryLow: number | null;
  entryHigh: number | null;
  target1: number | null;
  target2: number | null;
  target3: number | null;
  stopLoss: number | null;
}
