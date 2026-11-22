/**
 * Server-only Supabase REST helpers for the Auto Pilot tables.
 *
 * ⚠️ Uses SUPABASE_SERVICE_ROLE_KEY (full DB access). Only import from
 * Next.js route handlers / server code — never from client components.
 *
 * Every query is scoped by owner_id = the authenticated user's id. RLS
 * (auto_pilot_schema.sql) enforces the same rule at the database level, so a
 * user can never read or write another user's rows — defense in depth.
 */

import type { PilotState, PilotTrade } from "./types";

const SUPABASE_URL = (process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

export function pilotConfigured(): boolean {
  return Boolean(SUPABASE_URL && SERVICE_KEY);
}

const HEADERS: Record<string, string> = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  "Content-Type": "application/json",
};

// ── Row shapes (snake_case from Postgres) ─────────────────────────────────

interface StateRow {
  id: string;
  owner_id: string;
  capital: number;
  available_cash: number;
  started_at: string;
  updated_at: string;
}

interface TradeRow {
  id: string;
  owner_id: string;
  ticker: string;
  direction: string;
  entry: number;
  target1: number;
  stop_loss: number;
  quantity: number;
  notional: number;
  qm_score: number | null;
  tech_signal: string | null;
  fund_score: number | null;
  fund_rating: string | null;
  status: string;
  close_reason: string | null;
  current_price: number | null;
  pnl: number | null;
  pnl_pct: number | null;
  open_date: string;
  close_date: string | null;
  created_at: string;
  updated_at: string;
}

async function supabaseFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { ...HEADERS, ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text();
    // Detect "table not found" so callers can show a clear "run the schema"
    // message instead of a generic 500.
    if (/Could not find the table|does not exist|PGRST205|relation .* does not exist/i.test(body)) {
      throw new PilotSchemaError(body.slice(0, 200));
    }
    throw new Error(`Supabase ${res.status}: ${body.slice(0, 300)}`);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

/** Thrown when the Auto Pilot tables have not been created yet. */
export class PilotSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PilotSchemaError";
  }
}

function rowToState(r: StateRow): PilotState {
  return {
    id: r.id,
    capital: r.capital,
    availableCash: r.available_cash,
    startedAt: r.started_at,
    updatedAt: r.updated_at,
  };
}

function rowToTrade(r: TradeRow): PilotTrade {
  return {
    id: r.id,
    ticker: r.ticker,
    direction: "BUY",
    entry: r.entry,
    target1: r.target1,
    stopLoss: r.stop_loss,
    quantity: r.quantity,
    notional: r.notional,
    qmScore: r.qm_score,
    techSignal: r.tech_signal,
    fundScore: r.fund_score,
    fundRating: r.fund_rating,
    status: r.status === "CLOSED" ? "CLOSED" : "OPEN",
    closeReason: (r.close_reason as PilotTrade["closeReason"]) ?? null,
    currentPrice: r.current_price,
    pnl: r.pnl,
    pnlPct: r.pnl_pct,
    openDate: r.open_date,
    closeDate: r.close_date,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

// ── State ─────────────────────────────────────────────────────────────────

export async function getPilotState(ownerId: string): Promise<PilotState | null> {
  const rows = await supabaseFetch<StateRow[]>(
    `auto_pilot_state?select=*&owner_id=eq.${encodeURIComponent(ownerId)}&limit=1`,
  );
  return rows[0] ? rowToState(rows[0]) : null;
}

export async function upsertPilotState(
  ownerId: string,
  state: { capital: number; availableCash: number },
): Promise<PilotState> {
  const rows = await supabaseFetch<StateRow[]>(
    `auto_pilot_state?select=*&on_conflict=owner_id`,
    {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify({
        owner_id: ownerId,
        capital: state.capital,
        available_cash: state.availableCash,
        updated_at: new Date().toISOString(),
      }),
    },
  );
  return rowToState(rows[0]);
}

export async function updatePilotState(
  ownerId: string,
  updates: { availableCash?: number; capital?: number },
): Promise<PilotState | null> {
  const body: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (updates.availableCash !== undefined) body.available_cash = updates.availableCash;
  if (updates.capital !== undefined) body.capital = updates.capital;
  const rows = await supabaseFetch<StateRow[]>(
    `auto_pilot_state?select=*&owner_id=eq.${encodeURIComponent(ownerId)}`,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(body),
    },
  );
  return rows[0] ? rowToState(rows[0]) : null;
}

// ── Trades ────────────────────────────────────────────────────────────────

export async function getPilotTrades(ownerId: string): Promise<PilotTrade[]> {
  const rows = await supabaseFetch<TradeRow[]>(
    `auto_pilot_trades?select=*&owner_id=eq.${encodeURIComponent(ownerId)}&order=open_date.desc&limit=1000`,
  );
  return rows.map(rowToTrade);
}

export async function insertPilotTrades(
  ownerId: string,
  trades: Array<Omit<PilotTrade, "id" | "openDate" | "closeDate" | "createdAt" | "updatedAt">>,
): Promise<PilotTrade[]> {
  if (trades.length === 0) return [];
  const rows = await supabaseFetch<TradeRow[]>(
    `auto_pilot_trades?select=*`,
    {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(
        trades.map((t) => ({
          owner_id: ownerId,
          ticker: t.ticker,
          direction: t.direction,
          entry: t.entry,
          target1: t.target1,
          stop_loss: t.stopLoss,
          quantity: t.quantity,
          notional: t.notional,
          qm_score: t.qmScore,
          tech_signal: t.techSignal,
          fund_score: t.fundScore,
          fund_rating: t.fundRating,
          status: t.status,
          close_reason: t.closeReason,
          current_price: t.currentPrice,
          pnl: t.pnl,
          pnl_pct: t.pnlPct,
        })),
      ),
    },
  );
  return rows.map(rowToTrade);
}

export async function updatePilotTrade(
  ownerId: string,
  id: string,
  updates: Partial<PilotTrade>,
): Promise<PilotTrade | null> {
  const body: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (updates.status !== undefined) body.status = updates.status;
  if (updates.closeReason !== undefined) body.close_reason = updates.closeReason;
  if (updates.currentPrice !== undefined) body.current_price = updates.currentPrice;
  if (updates.pnl !== undefined) body.pnl = updates.pnl;
  if (updates.pnlPct !== undefined) body.pnl_pct = updates.pnlPct;
  if (updates.closeDate !== undefined) body.close_date = updates.closeDate;
  const rows = await supabaseFetch<TradeRow[]>(
    `auto_pilot_trades?select=*&id=eq.${encodeURIComponent(id)}&owner_id=eq.${encodeURIComponent(ownerId)}`,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(body),
    },
  );
  return rows[0] ? rowToTrade(rows[0]) : null;
}

export async function deletePilotState(ownerId: string): Promise<void> {
  await supabaseFetch<unknown>(
    `auto_pilot_state?owner_id=eq.${encodeURIComponent(ownerId)}`,
    { method: "DELETE" },
  );
}

export async function deletePilotTrades(ownerId: string): Promise<void> {
  await supabaseFetch<unknown>(
    `auto_pilot_trades?owner_id=eq.${encodeURIComponent(ownerId)}`,
    { method: "DELETE" },
  );
}
