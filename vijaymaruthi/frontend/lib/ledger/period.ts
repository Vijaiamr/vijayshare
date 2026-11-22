import { Transaction } from './types';

/**
 * Period-aware ledger utilities.
 *
 * The selected period is the single source of truth for the entire ledger
 * page. Every calculation (income, expense, savings, categories, insights,
 * budgets, charts, transaction list) must derive from the SAME filtered
 * transaction set produced here — never the full uploaded dataset (unless
 * the user explicitly selects "All Time").
 */

export type PeriodView = 'monthly' | 'yearly' | 'all';

export interface PeriodSelection {
  /** 'monthly' → a specific month (YYYY-MM); 'yearly' → a year (YYYY); 'all' → everything */
  view: PeriodView;
  /** YYYY-MM for monthly, YYYY for yearly, null for all */
  key: string | null;
}

/** Human label for the selected period, e.g. "September 2026", "2026", "All Time". */
export function periodLabel(sel: PeriodSelection): string {
  if (sel.view === 'all') return 'All Time';
  if (sel.view === 'yearly' && sel.key) return sel.key;
  if (sel.view === 'monthly' && sel.key) {
    const [y, m] = sel.key.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }
  return 'All Time';
}

/** Short label for pills, e.g. "Sep 2026", "2026", "All". */
export function periodShortLabel(sel: PeriodSelection): string {
  if (sel.view === 'all') return 'All Time';
  if (sel.view === 'yearly' && sel.key) return sel.key;
  if (sel.view === 'monthly' && sel.key) {
    const [y, m] = sel.key.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  }
  return 'All Time';
}

/** Inclusive [start, end] date strings (YYYY-MM-DD) for the selected period. */
export function periodDateRange(sel: PeriodSelection): { start: string; end: string } | null {
  if (sel.view === 'all') return null;
  if (sel.view === 'yearly' && sel.key) {
    const y = Number(sel.key);
    return { start: `${y}-01-01`, end: `${y}-12-31` };
  }
  if (sel.view === 'monthly' && sel.key) {
    const [y, m] = sel.key.split('-').map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    return { start: `${sel.key}-01`, end: `${sel.key}-${String(lastDay).padStart(2, '0')}` };
  }
  return null;
}

/** Filter a transaction set to the selected period. */
export function filterTransactionsByPeriod(transactions: Transaction[], sel: PeriodSelection): Transaction[] {
  if (sel.view === 'all') return transactions;
  const range = periodDateRange(sel);
  if (!range) return transactions;
  return transactions.filter(t => t.date >= range.start && t.date <= range.end);
}

/** All distinct months (YYYY-MM) present in the data, sorted ascending. */
export function availableMonths(transactions: Transaction[]): string[] {
  const set = new Set<string>();
  transactions.forEach(t => {
    const m = t.date?.slice(0, 7);
    if (m && /^\d{4}-\d{2}$/.test(m)) set.add(m);
  });
  return Array.from(set).sort();
}

/** All distinct years (YYYY) present in the data, sorted ascending. */
export function availableYears(transactions: Transaction[]): string[] {
  const set = new Set<string>();
  transactions.forEach(t => {
    const y = t.date?.slice(0, 4);
    if (y && /^\d{4}$/.test(y)) set.add(y);
  });
  return Array.from(set).sort();
}

/** Default period: the most recent month present in the data (never All Time). */
export function defaultPeriod(transactions: Transaction[]): PeriodSelection {
  const months = availableMonths(transactions);
  if (months.length === 0) return { view: 'all', key: null };
  return { view: 'monthly', key: months[months.length - 1] };
}

/** Shift a monthly selection by ±1 month (for the ← / → arrows). */
export function shiftMonth(key: string, delta: number): string {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Shift a yearly selection by ±1 year. */
export function shiftYear(key: string, delta: number): string {
  return String(Number(key) + delta);
}

/**
 * Number of calendar months spanned by the given transactions (min 1).
 *
 * Budgets are monthly limits, so period-total spends must be normalized to a
 * monthly average before comparing against them. Uses UTC components so the
 * result is identical on every host timezone.
 */
export function monthsSpanned(transactions: Transaction[]): number {
  if (transactions.length === 0) return 1;
  let min = Infinity, max = -Infinity;
  transactions.forEach(t => {
    const ts = new Date(`${t.date}T00:00:00Z`).getTime();
    if (!isNaN(ts)) { min = Math.min(min, ts); max = Math.max(max, ts); }
  });
  if (min === Infinity) return 1;
  const minD = new Date(min), maxD = new Date(max);
  return Math.max(1, (maxD.getUTCFullYear() - minD.getUTCFullYear()) * 12 + maxD.getUTCMonth() - minD.getUTCMonth() + 1);
}
