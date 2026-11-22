/**
 * Server-only Supabase REST helpers for the ledger tables.
 *
 * ⚠️ Uses SUPABASE_SERVICE_ROLE_KEY (full DB access). Only import from
 * Next.js route handlers / server code — never from client components.
 *
 * Every query is scoped by owner_id = the authenticated user's id. RLS
 * (ledger_schema.sql) enforces the same rule at the database level, so a
 * user can never read or write another user's rows — defense in depth.
 */

import type { Transaction, BudgetRecommendation } from "./types";

const SUPABASE_URL = (process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

export function ledgerConfigured(): boolean {
  return Boolean(SUPABASE_URL && SERVICE_KEY);
}

const HEADERS: Record<string, string> = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  "Content-Type": "application/json",
};

// ── Row shapes (snake_case from Postgres) ─────────────────────────────────

interface TxRow {
  id: string;
  owner_id: string;
  date: string;
  description: string;
  amount: number;
  categories: string[] | string;
  recurring: boolean;
  confidence: string | null;
  matched_keywords: Record<string, string> | string | null;
  learned: boolean;
  payee: string | null;
  raw_category: string | null;
  created_at: string;
  updated_at: string;
}

interface BudgetRow {
  id: string;
  owner_id: string;
  category: string;
  suggested_percentage: number | null;
  limit_amount: number;
  updated_at: string;
}

interface CorrectionRow {
  id: string;
  owner_id: string;
  description: string;
  categories: string[] | string;
  payee: string | null;
  created_at: string;
}

function parseJson<T>(v: T | string | null, fallback: T): T {
  if (v === null || v === undefined) return fallback;
  if (typeof v !== "string") return v;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
}

export function rowToTransaction(row: TxRow): Transaction {
  return {
    id: row.id,
    date: row.date,
    description: row.description,
    amount: row.amount,
    categories: parseJson<string[]>(row.categories, []),
    recurring: row.recurring,
    confidence: (row.confidence as Transaction["confidence"]) ?? undefined,
    matchedKeywords: parseJson<Record<string, string>>(row.matched_keywords, {}),
    learned: row.learned,
    payee: row.payee ?? undefined,
    rawCategory: row.raw_category ?? undefined,
  };
}

function txToRow(ownerId: string, tx: Transaction): Record<string, unknown> {
  return {
    owner_id: ownerId,
    date: tx.date,
    description: tx.description,
    amount: tx.amount,
    categories: tx.categories ?? [],
    recurring: tx.recurring ?? false,
    confidence: tx.confidence ?? null,
    matched_keywords: tx.matchedKeywords ?? {},
    learned: tx.learned ?? false,
    payee: tx.payee ?? null,
    raw_category: tx.rawCategory ?? null,
  };
}

async function supabaseFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { ...HEADERS, ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Supabase ${res.status}: ${body.slice(0, 300)}`);
  }
  // PostgREST returns 204 for some operations and 201-with-empty-body for
  // `resolution=merge-duplicates` upserts — treat both as "no payload".
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

// ── Transactions ──────────────────────────────────────────────────────────

export async function getTransactions(
  ownerId: string,
  month?: string,
): Promise<Transaction[]> {
  let filter = `owner_id=eq.${encodeURIComponent(ownerId)}`;
  if (month && /^\d{4}-\d{2}$/.test(month)) {
    const [y, m] = month.split("-").map(Number);
    const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
    filter += `&date=gte.${month}-01&date=lt.${next}-01`;
  }
  const rows = await supabaseFetch<TxRow[]>(
    `ledger_transactions?select=*&${filter}&order=date.desc,created_at.desc&limit=10000`,
  );
  return rows.map(rowToTransaction);
}

/**
 * Fetch transactions within an inclusive date range (ISO `YYYY-MM-DD`).
 * Used by the upload route to scope the dedup set to the file's own range,
 * which is cheaper and avoids the 10k-row cap hiding older rows from dedup.
 */
export async function getTransactionsByRange(
  ownerId: string,
  startDate?: string,
  endDate?: string,
): Promise<Transaction[]> {
  let filter = `owner_id=eq.${encodeURIComponent(ownerId)}`;
  if (startDate && /^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    filter += `&date=gte.${startDate}`;
  }
  if (endDate && /^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    filter += `&date=lte.${endDate}`;
  }
  const rows = await supabaseFetch<TxRow[]>(
    `ledger_transactions?select=*&${filter}&order=date.desc,created_at.desc&limit=10000`,
  );
  return rows.map(rowToTransaction);
}

export async function insertTransactions(
  ownerId: string,
  txs: Transaction[],
): Promise<Transaction[]> {
  if (txs.length === 0) return [];
  const rows = await supabaseFetch<TxRow[]>(
    `ledger_transactions?select=*`,
    {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(txs.map((t) => txToRow(ownerId, t))),
    },
  );
  return rows.map(rowToTransaction);
}

export async function insertTransaction(
  ownerId: string,
  tx: Transaction,
): Promise<Transaction> {
  const [saved] = await insertTransactions(ownerId, [tx]);
  if (!saved) throw new Error("Insert returned no row");
  return saved;
}

export async function updateTransaction(
  ownerId: string,
  id: string,
  updates: Partial<Transaction>,
): Promise<Transaction | null> {
  const body: Record<string, unknown> = {};
  if (updates.date !== undefined) body.date = updates.date;
  if (updates.description !== undefined) body.description = updates.description;
  if (updates.amount !== undefined) body.amount = updates.amount;
  if (updates.categories !== undefined) body.categories = updates.categories;
  if (updates.recurring !== undefined) body.recurring = updates.recurring;
  if (updates.confidence !== undefined) body.confidence = updates.confidence ?? null;
  if (updates.matchedKeywords !== undefined) body.matched_keywords = updates.matchedKeywords ?? {};
  if (updates.learned !== undefined) body.learned = updates.learned;
  if (updates.payee !== undefined) body.payee = updates.payee ?? null;
  if (updates.rawCategory !== undefined) body.raw_category = updates.rawCategory ?? null;
  body.updated_at = new Date().toISOString();

  const rows = await supabaseFetch<TxRow[]>(
    `ledger_transactions?select=*&id=eq.${encodeURIComponent(id)}&owner_id=eq.${encodeURIComponent(ownerId)}`,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(body),
    },
  );
  return rows[0] ? rowToTransaction(rows[0]) : null;
}

export async function deleteTransaction(
  ownerId: string,
  id: string,
): Promise<boolean> {
  await supabaseFetch<unknown>(
    `ledger_transactions?id=eq.${encodeURIComponent(id)}&owner_id=eq.${encodeURIComponent(ownerId)}`,
    { method: "DELETE" },
  );
  return true;
}

// ── Budgets ───────────────────────────────────────────────────────────────

export async function getBudgets(ownerId: string): Promise<BudgetRecommendation[]> {
  const rows = await supabaseFetch<BudgetRow[]>(
    `ledger_budgets?select=*&owner_id=eq.${encodeURIComponent(ownerId)}&order=category.asc`,
  );
  return rows.map((r) => ({
    category: r.category,
    suggestedPercentage: r.suggested_percentage ?? 5,
    limitAmount: r.limit_amount,
  }));
}

/** Replace the user's full budget list (delete-all + insert). */
export async function replaceBudgets(
  ownerId: string,
  budgets: BudgetRecommendation[],
): Promise<BudgetRecommendation[]> {
  await supabaseFetch<unknown>(
    `ledger_budgets?owner_id=eq.${encodeURIComponent(ownerId)}`,
    { method: "DELETE" },
  );
  if (budgets.length === 0) return [];
  const rows = await supabaseFetch<BudgetRow[]>(
    `ledger_budgets?select=*`,
    {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(
        budgets.map((b) => ({
          owner_id: ownerId,
          category: b.category,
          suggested_percentage: b.suggestedPercentage ?? 5,
          limit_amount: b.limitAmount,
        })),
      ),
    },
  );
  return rows.map((r) => ({
    category: r.category,
    suggestedPercentage: r.suggested_percentage ?? 5,
    limitAmount: r.limit_amount,
  }));
}

// ── Corrections ───────────────────────────────────────────────────────────

export type CorrectionsMap = Record<string, string[]>;

export async function getCorrections(ownerId: string): Promise<CorrectionsMap> {
  const rows = await supabaseFetch<CorrectionRow[]>(
    `ledger_corrections?select=*&owner_id=eq.${encodeURIComponent(ownerId)}&limit=5000`,
  );
  const map: CorrectionsMap = {};
  for (const r of rows) {
    const cats = parseJson<string[]>(r.categories, []);
    map[`desc::${r.description}`] = cats;
    if (r.payee) map[`payee::${r.payee}`] = cats;
  }
  return map;
}

export async function saveCorrection(
  ownerId: string,
  description: string,
  categories: string[],
  payee?: string | null,
): Promise<void> {
  await supabaseFetch<unknown>(
    `ledger_corrections?on_conflict=owner_id,description`,
    {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify({
        owner_id: ownerId,
        description,
        categories,
        payee: payee ?? null,
      }),
    },
  );
}

// ── Summary (home dashboard widget) ───────────────────────────────────────

export interface LedgerSummary {
  totalSpent: number;
  totalIncome: number;
  netSavings: number;
  transactionCount: number;
  topCategory: string | null;
  topCategoryAmount: number;
  monthlyTrend: Array<{ month: string; spent: number }>;
  budgetHealth: Array<{ category: string; limit: number; spent: number; pct: number }>;
}

export async function getSummary(ownerId: string): Promise<LedgerSummary> {
  const txs = await getTransactions(ownerId);
  const budgets = await getBudgets(ownerId);

  let totalSpent = 0;
  let totalIncome = 0;
  const catSpend: Record<string, number> = {};
  const monthSpend: Record<string, number> = {};

  for (const t of txs) {
    if (t.amount > 0) {
      totalSpent += t.amount;
      for (const c of t.categories?.length ? t.categories : ["Others"]) {
        if (c !== "Income") catSpend[c] = (catSpend[c] ?? 0) + t.amount;
      }
      const month = t.date.slice(0, 7);
      monthSpend[month] = (monthSpend[month] ?? 0) + t.amount;
    } else {
      totalIncome += Math.abs(t.amount);
    }
  }

  const topEntry = Object.entries(catSpend).sort((a, b) => b[1] - a[1])[0];
  const monthlyTrend = Object.entries(monthSpend)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-12)
    .map(([month, spent]) => ({ month, spent }));

  const budgetHealth = budgets
    .map((b) => {
      const spent = catSpend[b.category] ?? 0;
      return {
        category: b.category,
        limit: b.limitAmount,
        spent,
        pct: b.limitAmount > 0 ? Math.round((spent / b.limitAmount) * 100) : 0,
      };
    })
    .sort((a, b) => b.pct - a.pct);

  return {
    totalSpent,
    totalIncome,
    netSavings: totalIncome - totalSpent,
    transactionCount: txs.length,
    topCategory: topEntry?.[0] ?? null,
    topCategoryAmount: topEntry?.[1] ?? 0,
    monthlyTrend,
    budgetHealth,
  };
}