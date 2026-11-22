/**
 * Ledger analysis engine — the single source of truth for bank-statement
 * parsing and categorization (the legacy Python parser was removed).
 *
 * Pure functions only (no fetch / no I/O). Corrections are passed in so the
 * engine can run identically in Next.js route handlers and in tests.
 */

import * as XLSX from "xlsx";
import { CATEGORY_RULES, FALLBACK_BUDGETS } from "./categories";
import type { Transaction, SpendingInsight, BudgetRecommendation } from "./types";

// ── Text helpers ──────────────────────────────────────────────────────────

export function normalizeDesc(desc: string): string {
  return desc.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
}

/**
 * Rent-payment detection for the tax tracker. Word-boundary "rent" (house
 * rent, rent paid, monthly rent) but NOT rentals — "rental"/"rented"/"renting"
 * fail the word boundary, and "rent a car/bike/movie" is excluded explicitly.
 */
export function isRentPayment(desc: string): boolean {
  const l = desc.toLowerCase();
  if (!/\brent\b/.test(l)) return false;
  if (/\brent\s+(a|an|the|car|bike|vehicle|movie|dvd|game|equipment|tool|dress|costume|furniture|household|scooter|cycle)\b/.test(l)) return false;
  return true;
}

/** Category names that signal rent (word-boundary, so "Current"/"Parent" don't match). */
const RENT_CATEGORY_RE = /\b(rent|housing|accommodation)\b/i;

/**
 * Rent detection for the tax tracker: a transaction counts as rent when its
 * description matches (isRentPayment) OR the user has tagged it with a
 * rent-like category ("Rent", "House Rent", "Housing", ...). Category tags
 * are respected so manual recategorization feeds the HRA calculation.
 */
export function isRentTransaction(tx: { description: string; categories?: string[] }): boolean {
  if (isRentPayment(tx.description)) return true;
  return (tx.categories || []).some((c) => RENT_CATEGORY_RE.test(c));
}

const UPI_REF_RE =
  /\b(?:txn|ref|utr|rrn|utr\s*no)[\s:-]*\d[\da-z]{7,15}\b|\b\d{10,16}\b|\b[a-z]{2,8}\d{4,16}\b/gi;
const UPI_PREFIX_RE =
  /^(upi\s*[\/-]?\s*|paytm\s+upi|phonepe\s+upi|google\s+pay|bhim\s+upi|gpay)\s*/i;

const PAYEE_STOP_WORDS = new Set([
  "payment", "paid", "transfer", "credit", "debit", "sent", "received",
  "from", "to", "via", "by", "inr", "rs", "amount", "value", "acknowledgement",
  "successful", "completed", "initiated", "failed", "pending", "refund",
]);

export function extractUpiPayee(description: string): string | null {
  let d = description.toLowerCase().trim();
  d = d.replace(/\//g, " ").replace(/-/g, " ");
  d = d.replace(UPI_PREFIX_RE, "");
  d = d.replace(UPI_REF_RE, " ");
  d = d.replace(/@\w+/g, "");
  d = d.replace(/\s+/g, " ").trim();
  d = d.replace(/[^a-z0-9\s]/g, "");
  const words = d.split(" ").filter((w) => w.length > 1 && !PAYEE_STOP_WORDS.has(w));
  if (words.length === 0) return null;
  const key = words.join(" ");
  return key.length >= 3 ? key : null;
}

// ── Dedup helpers ──────────────────────────────────────────────────────────
// Upload dedup uses two tiers:
//   exact      — (date, raw description, amount). Never false-merges two
//                genuinely distinct same-day same-amount swipes that carry
//                different ref numbers (e.g. two ₹64 SRISAIAGENCY payments).
//   normalized — (date, ref/handle-stripped description, amount). Catches
//                cross-bank UPI where only the volatile ref/handle segments
//                differ between statements describing the same transaction.

/** Stable, lossy normalization of a narration for duplicate detection. */
export function dedupDescription(description: string): string {
  let s = description.toLowerCase().trim();
  s = s.replace(/([a-z])20([a-z])/g, "$1 $2"); // UPI encodes spaces as "20"
  s = s.replace(UPI_PREFIX_RE, " ");
  s = s.replace(UPI_REF_RE, " ");
  s = s.replace(/@\w+/g, " ");
  s = s.replace(/[^a-z0-9\s]/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

/** Round to 2dp for stable amount comparison (644 vs 644.0 vs 644.00). */
export function dedupAmount(amount: number): number {
  return Math.round(amount * 100) / 100;
}

/** Dedup keys for a transaction (both tiers). */
export function dedupKeys(tx: {
  date: string;
  description: string;
  amount: number;
}): { exact: string; normalized: string } {
  const date = tx.date;
  const amt = dedupAmount(tx.amount);
  const raw = tx.description.trim().toLowerCase();
  return {
    exact: `${date}::${raw}::${amt}`,
    normalized: `${date}::${dedupDescription(tx.description)}::${amt}`,
  };
}

/**
 * Client-side merge used as defense in depth after an upload. The server is
 * authoritative (it already deduped before persisting), but merging by the
 * exact key here guarantees the UI never shows duplicated rows either.
 */
export function mergeTransactions(
  existing: Transaction[],
  incoming: Transaction[],
): Transaction[] {
  const seen = new Set<string>();
  const out: Transaction[] = [];
  for (const t of existing) {
    const k = dedupKeys(t).exact;
    if (!seen.has(k)) {
      seen.add(k);
      out.push(t);
    }
  }
  for (const t of incoming) {
    const k = dedupKeys(t).exact;
    if (!seen.has(k)) {
      seen.add(k);
      out.push(t);
    }
  }
  return out;
}

/** Approximates difflib.SequenceMatcher(None, a, b).ratio() via LCS. */
export function similarityRatio(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  const m = a.length;
  const n = b.length;
  const dp = new Uint32Array((m + 1) * (n + 1));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const idx = i * (n + 1) + j;
      if (a[i - 1] === b[j - 1]) {
        dp[idx] = dp[(i - 1) * (n + 1) + (j - 1)] + 1;
      } else {
        dp[idx] = Math.max(dp[(i - 1) * (n + 1) + j], dp[i * (n + 1) + (j - 1)]);
      }
    }
  }
  const lcs = dp[m * (n + 1) + n];
  return (2 * lcs) / (m + n);
}

// ── Corrections ───────────────────────────────────────────────────────────

export type CorrectionsMap = Record<string, string[]>;

export function findBestLearnedMatch(
  desc: string,
  corrections: CorrectionsMap,
  payee: string | null = null,
): string[] | null {
  if (payee && corrections[`payee::${payee}`]) {
    return corrections[`payee::${payee}`];
  }
  const norm = normalizeDesc(desc);
  if (!norm) return null;
  let bestScore = 0;
  let bestCats: string[] | null = null;
  for (const [key, categories] of Object.entries(corrections)) {
    if (!key.startsWith("desc::")) continue;
    const storedNorm = normalizeDesc(key.slice("desc::".length));
    const score = similarityRatio(norm, storedNorm);
    if (score > bestScore && score >= 0.65) {
      bestScore = score;
      bestCats = categories;
    }
  }
  return bestCats;
}

// ── Categorization ────────────────────────────────────────────────────────

export interface CategorizeResult {
  categories: string[];
  matchedKeywords: Record<string, string>;
  confidence: "high" | "medium" | "low";
  learned?: boolean;
  payee?: string;
}

export function categorize(
  description: string,
  amount: number,
  corrections: CorrectionsMap = {},
): CategorizeResult {
  if (amount < 0) {
    return { categories: ["Income"], matchedKeywords: {}, confidence: "high" };
  }
  // UPI encodes spaces as "20" in some bank feeds (e.g. BAJAJ20FINANCE20LIMI).
  const desc = description.toLowerCase().replace(/([a-z])20([a-z])/g, "$1 $2");
  const words = desc.split(/\s+/);
  const payee = extractUpiPayee(description);

  const learned = findBestLearnedMatch(description, corrections, payee);
  if (learned !== null) {
    const result: CategorizeResult = {
      categories: learned,
      matchedKeywords: { learned: "user correction" },
      confidence: "high",
      learned: true,
    };
    if (payee) result.payee = payee;
    return result;
  }

  const matches: Record<string, string[]> = {};
  for (const [category, keywords] of Object.entries(CATEGORY_RULES)) {
    for (const k of keywords) {
      if (k.length <= 3) {
        if (words.includes(k)) matches[category] = [...(matches[category] ?? []), k];
      } else if (desc.includes(k)) {
        matches[category] = [...(matches[category] ?? []), k];
      }
    }
  }

  if (Object.keys(matches).length === 0) {
    if (looksLikePersonalTransfer(desc)) {
      const result: CategorizeResult = {
        categories: ["Personal"],
        matchedKeywords: { personal: "person transfer" },
        confidence: "medium",
      };
      if (payee) result.payee = payee;
      return result;
    }
    return { categories: ["Others"], matchedKeywords: {}, confidence: "low" };
  }

  const totalKeywordsMatched = Object.values(matches).reduce((s, v) => s + v.length, 0);
  const categories = Object.keys(matches);
  const matchedKeywords: Record<string, string> = {};
  for (const [cat, kws] of Object.entries(matches)) matchedKeywords[cat] = kws[0];

  let confidence: "high" | "medium" | "low";
  if (totalKeywordsMatched >= 3 || (categories.length >= 2 && totalKeywordsMatched >= 2)) {
    confidence = "high";
  } else if (totalKeywordsMatched >= 1) {
    confidence = "medium";
  } else {
    confidence = "low";
  }

  const result: CategorizeResult = { categories, matchedKeywords, confidence };
  if (payee) result.payee = payee;
  return result;
}

// ── Person-to-person transfer heuristic ────────────────────────────────────
// Indian UPI statements mix person transfers with small merchants. Paytm
// person transfers end with "PAYMENT FROM PHONE" and use @PTY/@PAYTM handles;
// merchants use @PTYS (Paytm merchant). Google Pay person transfers also end
// with "PAYMENT FROM PHONE". We only apply this AFTER keyword rules miss, and
// we skip payees that carry merchant hints (store, enterprise, etc.).

const PERSONAL_MERCHANT_HINTS = [
  "store", "shop", "enterprise", "corporation", "agency", "traders", "trading",
  "services", "industries", "mill", "hotel", "restaurant", "cafe", "pos",
  "mall", "mart", "bazaar", "kiran", "provision", "super", "private", "limited",
  "pvt", "ltd", "exports", "imports", "associates", "solutions", "technologies",
  "systems", "group", "company", "suppliers", "wholesale", "logistics",
  "transport", "travels", "courier", "garage", "workshop", "hospital", "clinic",
  "pharmacy", "medical", "school", "college", "institute", "temple", "church",
];

function looksLikePersonalTransfer(desc: string): boolean {
  if (!desc.includes("payment from phone") || desc.includes("@ptys")) return false;
  const payee = extractUpiPayee(desc) ?? "";
  if (PERSONAL_MERCHANT_HINTS.some((h) => payee.includes(h))) return false;
  return true;
}

// ── Recurring + insights ──────────────────────────────────────────────────

export function detectRecurring(transactions: Transaction[]): Transaction[] {
  const keyCounts = new Map<string, number>();
  for (const t of transactions) {
    if (t.amount > 0) {
      const key = `${t.description.trim().toLowerCase()}::${Math.round(t.amount * 100) / 100}`;
      keyCounts.set(key, (keyCounts.get(key) ?? 0) + 1);
    }
  }
  const recurringKeys = new Set(
    [...keyCounts.entries()].filter(([, c]) => c >= 2).map(([k]) => k),
  );
  return transactions.map((t) => {
    if (t.amount > 0) {
      const key = `${t.description.trim().toLowerCase()}::${Math.round(t.amount * 100) / 100}`;
      if (recurringKeys.has(key)) return { ...t, recurring: true };
    }
    return t;
  });
}

export function generateInsights(transactions: Transaction[]): SpendingInsight[] {
  const categoryTotals: Record<string, number> = {};
  let totalSpent = 0;
  for (const t of transactions) {
    const amt = t.amount;
    if (amt > 0) {
      totalSpent += amt;
      for (const cat of t.categories?.length ? t.categories : ["Others"]) {
        categoryTotals[cat] = (categoryTotals[cat] ?? 0) + amt;
      }
    }
  }

  const topCat = Object.entries(categoryTotals).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "None";
  const topAmt = categoryTotals[topCat] ?? 0;

  const insights: SpendingInsight[] = [
    {
      id: "insight-count", type: "info",
      title: "Excel Data Processed",
      description: `Successfully parsed ${transactions.length} transactions from your file. All figures are in Indian Rupees.`,
      impactValue: `${transactions.length} transactions`,
    },
    {
      id: "insight-top-cat", type: "trend",
      title: "Top Category Spend",
      description: Object.keys(categoryTotals).length > 0
        ? `Your biggest spending driver is "${topCat}" totaling ₹${topAmt.toLocaleString("en-IN", { minimumFractionDigits: 2 })}.`
        : "No spending data found.",
      impactValue: totalSpent > 0 ? `₹${Math.round(totalSpent).toLocaleString("en-IN")} total` : "₹0",
    },
    {
      id: "insight-tip", type: "saving",
      title: "Smart Spending Tip",
      description: "Review recurring charges under subscriptions. Setting daily spending alerts could save you up to 10% of discretionary outflow.",
      impactValue: "10% Savings",
    },
  ];

  const recurringCount = transactions.filter((t) => t.recurring).length;
  if (recurringCount > 0) {
    insights.unshift({
      id: "insight-recurring", type: "info",
      title: "Recurring Charges Detected",
      description: `Found ${recurringCount} recurring transactions. Review them to optimize monthly outflows.`,
      impactValue: `${recurringCount} recurring`,
    });
  }

  const lowConfCount = transactions.filter((t) => t.confidence === "low").length;
  if (lowConfCount > 0) {
    insights.push({
      id: "insight-review", type: "warning",
      title: "Review Needed",
      description: `${lowConfCount} transactions could not be confidently categorized and need your review.`,
      impactValue: `${lowConfCount} to review`,
    });
  }

  return insights;
}

// ── Column detection ──────────────────────────────────────────────────────

export interface ColumnMapping {
  date: string | null;
  description: string | null;
  amount: string | null;       // single amount column (signed or Dr/Cr-indicated)
  withdrawal: string | null;   // debit column
  deposit: string | null;      // credit column
  drCr: string | null;         // Dr/Cr (or Type) indicator column
  balance: string | null;      // running-balance column (used for self-check)
  category: string | null;
}

const DATE_COL_RE = /date|posted|time/i;
const VALUE_DATE_RE = /value\s*(dt|date)/i;
const DESC_COL_RE = /narration|description|particulars|details|remarks|merchant|payee|narrative|transaction details|transaction description/i;
const WITHDRAWAL_COL_RE = /withdrawal|debit|withdrawal amt|debit amt|debit amount|\bdr\.?\b/i;
const DEPOSIT_COL_RE = /deposit|credit|deposit amt|credit amt|credit amount|\bcr\.?\b/i;
const AMOUNT_COL_RE = /amount|\bamt\b|value|price|sum|cost|txn amt|transaction amount/i;
const BALANCE_COL_RE = /^balance$|running balance|closing balance|available balance|balance amount/i;
const DRCr_COL_RE = /dr\/cr|dr cr|debit\/credit|txn type|transaction type|^type$/i;
const CATEGORY_COL_RE = /category|^cat$|^group$/i;

function isDateCol(l: string): boolean { return DATE_COL_RE.test(l) || VALUE_DATE_RE.test(l); }
function isValueDateCol(l: string): boolean { return VALUE_DATE_RE.test(l); }
function isDescriptionCol(l: string): boolean { return DESC_COL_RE.test(l); }
function isWithdrawalCol(l: string): boolean { return WITHDRAWAL_COL_RE.test(l); }
function isDepositCol(l: string): boolean { return DEPOSIT_COL_RE.test(l); }
function isAmountCol(l: string): boolean { return AMOUNT_COL_RE.test(l); }
function isBalanceCol(l: string): boolean { return BALANCE_COL_RE.test(l); }
function isDrCrCol(l: string): boolean { return DRCr_COL_RE.test(l); }
function isCategoryCol(l: string): boolean { return CATEGORY_COL_RE.test(l); }

export function autoDetectColumns(cols: string[]): ColumnMapping {
  const mapping: ColumnMapping = {
    date: null, description: null, amount: null,
    withdrawal: null, deposit: null, drCr: null, balance: null, category: null,
  };
  for (const c of cols) {
    const l = String(c).toLowerCase().trim();
    if (isDateCol(l)) {
      // Prefer the real transaction date over "Value Date" when both exist.
      if (!mapping.date || (isValueDateCol(String(mapping.date).toLowerCase()) && !isValueDateCol(l))) {
        mapping.date = c;
      }
    } else if (isDescriptionCol(l)) {
      if (!mapping.description) mapping.description = c;
    } else if (isDrCrCol(l)) {
      if (!mapping.drCr) mapping.drCr = c;
    } else if (isWithdrawalCol(l)) {
      if (!mapping.withdrawal) mapping.withdrawal = c;
    } else if (isDepositCol(l)) {
      if (!mapping.deposit) mapping.deposit = c;
    } else if (isBalanceCol(l)) {
      if (!mapping.balance) mapping.balance = c;
    } else if (isAmountCol(l)) {
      if (!mapping.amount) mapping.amount = c;
    } else if (isCategoryCol(l)) {
      if (!mapping.category) mapping.category = c;
    }
  }
  // Positional fallback for bare layouts (A, B, C).
  if (!mapping.date && cols.length > 0) mapping.date = cols[0];
  if (!mapping.description && cols.length > 1) mapping.description = cols[1];
  if (!mapping.amount && !mapping.withdrawal && !mapping.deposit && cols.length > 2) mapping.amount = cols[2];
  return mapping;
}

// ── Parsing helpers ───────────────────────────────────────────────────────

const MONTH_NAMES: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/**
 * True when a value plausibly represents a calendar date (dd/mm/yy,
 * dd-mm-yyyy, dd.mm.yyyy, dd-mmm-yy, yyyy-mm-dd, or a 5-digit Excel serial).
 * Used to stop summary/footer rows whose totals land in the Date column
 * (e.g. HDFC "STATEMENT SUMMARY" Opening Balance) from being read as dated
 * transactions.
 */
export function looksLikeDate(value: string): boolean {
  const v = String(value).trim();
  if (!v) return false;
  return (
    /^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}$/.test(v) ||
    /^\d{1,2}[-/.]\w{3}[-/.]\d{2,4}$/i.test(v) ||
    /^\d{4}-\d{2}-\d{2}/.test(v) ||
    /^\d{5}(\.\d+)?$/.test(v)
  );
}

export function parseDateStr(value: string): string {
  const dv = String(value).trim();
  if (!dv) return new Date().toISOString().slice(0, 10);

  // Raw Excel serial number (e.g. "46000") — some PSU-bank exports store
  // dates as unformatted numbers. Excel epoch is 1899-12-30.
  if (/^\d{5}(\.\d+)?$/.test(dv)) {
    const serial = Number(dv);
    const d = new Date(Date.UTC(1899, 11, 30) + serial * 86400000);
    if (!isNaN(d.getTime())) {
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
    }
  }

  // dd/mm/yy, dd-mm-yyyy, dd.mm.yyyy, dd-mmm-yy, dd-mmm-yyyy
  const parts = dv.replace(/[\/.]/g, "-").split("-");
  if (parts.length === 3) {
    let [dd, mm, yy] = parts;
    if (yy.length === 2) {
      // Century heuristic: 2-digit years above (current+10) are 19xx.
      const cur = new Date().getFullYear() % 100;
      yy = Number(yy) > cur + 10 ? "19" + yy : "20" + yy;
    }
    let m = Number(mm);
    if (!Number.isInteger(m) || m < 1 || m > 12) {
      m = MONTH_NAMES[mm.toLowerCase().slice(0, 3)] ?? NaN;
    }
    const y = Number(yy), d = Number(dd);
    if (Number.isInteger(y) && Number.isInteger(m) && Number.isInteger(d) &&
        m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
  }
  const ts = new Date(dv);
  if (!isNaN(ts.getTime())) {
    // ISO date-only strings parse as UTC midnight; everything else parses as
    // local time. Read the matching components so the calendar date never
    // shifts on any host timezone.
    const isIso = /^\d{4}-\d{2}-\d{2}/.test(dv);
    const y = isIso ? ts.getUTCFullYear() : ts.getFullYear();
    const m = isIso ? ts.getUTCMonth() + 1 : ts.getMonth() + 1;
    const d = isIso ? ts.getUTCDate() : ts.getDate();
    return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  return new Date().toISOString().slice(0, 10);
}

export function parseAmount(value: unknown): number {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return value;
  const s = String(value).trim();
  // Bank statements use parentheses for debits/negatives: "(3,000)" = -3000.
  // Also honor an explicit leading minus and a trailing minus ("500-").
  let negative = /^\(.*\)$/.test(s) || s.startsWith("-") || s.endsWith("-");
  // Trailing Dr/DB/Debit suffix = debit (expense → positive in this app's
  // convention); trailing Cr/CR/Credit suffix = credit (income → negative).
  const suffix = s.match(/\b(dr|db|debit|cr|credit)\b\.?\s*$/i)?.[1]?.toLowerCase();
  if (suffix) {
    negative = suffix === "cr" || suffix === "credit";
  }
  // Strip thousands separators, then extract the first decimal number. This
  // also discards currency symbols and Dr./Cr. markers (e.g. "Dr. 500" must
  // parse as 500, not 0.5 — the period in "Dr." would otherwise survive a
  // simple character-class cleanup).
  const cleaned = s.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/)?.[0] ?? "";
  const n = parseFloat(cleaned);
  if (isNaN(n)) return 0;
  return negative ? -Math.abs(n) : n;
}

/** Minimal CSV parser handling quoted fields, commas, and newlines. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  row.push(field);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

/** Parse an uploaded file into a 2D string grid (like pandas header=None). */
export async function parseFileToRows(contents: ArrayBuffer | string, filename: string): Promise<string[][]> {
  const lower = filename.toLowerCase();
  const isTextName = lower.endsWith(".csv") || lower.endsWith(".txt") || typeof contents === "string";

  if (isTextName) {
    const text = typeof contents === "string" ? contents : new TextDecoder().decode(contents);
    // UPI app exports have distinctive headers — try them first.
    const { parseUpiExport } = await import("./upi");
    const upi = parseUpiExport(text);
    if (upi) return upi;
    // Delimited (tab/semicolon/pipe/comma).
    const { detectDelimiter, parseDelimited, parseFixedWidth } = await import("./delimited");
    const delim = detectDelimiter(text);
    if (delim === ",") return parseCsv(text);
    if (delim) return parseDelimited(text, delim);
    // Fixed-width "text statement" exports.
    const fw = parseFixedWidth(text);
    if (fw.length > 0) return fw;
    return parseCsv(text);
  }

  // Binary: sniff magic bytes rather than trusting the extension (some banks
  // ship HTML or PDFs with .xls names).
  const { sniffContentType } = await import("./delimited");
  const type = sniffContentType(contents);
  if (type === "pdf") {
    const { parsePdfToRows } = await import("./pdf");
    return parsePdfToRows(contents as ArrayBuffer);
  }
  if (type === "unknown") return [];

  // .xlsx / .xls
  // cellDates:true makes date-formatted cells come through as Date objects.
  // We then use each cell's formatted display string (cell.w, e.g.
  // "07/06/2026") rather than the Date object itself: SheetJS's serial→Date
  // conversion is timezone/fp-sensitive and can land a few seconds short of
  // midnight, which previously collapsed every date cell to "today".
  const wb = XLSX.read(contents, { type: "array", cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return [];
  const range = XLSX.utils.decode_range(sheet["!ref"] || "A1");
  const rows: string[][] = [];
  for (let r = range.s.r; r <= range.e.r; r++) {
    const row: string[] = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })];
      if (cell === undefined || cell.v === null || cell.v === undefined) {
        row.push("");
      } else if (cell.t === "d") {
        const d = cell.v as Date;
        if (typeof cell.w === "string" && cell.w.trim() !== "") {
          row.push(cell.w);
        } else {
          // Fallback: numdate() intends local midnight of the calendar date;
          // round to the nearest day to absorb sub-day fp/timezone fuzz.
          const rounded = new Date(d.getTime() + 12 * 60 * 60 * 1000);
          const y = rounded.getFullYear();
          const m = String(rounded.getMonth() + 1).padStart(2, "0");
          const day = String(rounded.getDate()).padStart(2, "0");
          row.push(`${y}-${m}-${day}`);
        }
      } else {
        row.push(String(cell.v));
      }
    }
    rows.push(row);
  }
  return rows;
}

// Weighted header scoring: strong signals (narration, withdrawal amt, ...)
// score higher than weak ones (date, amount). Boilerplate rows (account info,
// page headers) are penalized so a random info row never wins.
const HEADER_KEYWORD_SCORES: Array<[string, number]> = [
  ["transaction date", 3],
  ["value dt", 3],
  ["withdrawal amt", 3],
  ["deposit amt", 3],
  ["closing balance", 3],
  ["narration", 3],
  ["transaction details", 3],
  ["particulars", 2],
  ["description", 2],
  ["remarks", 2],
  ["debit", 2],
  ["credit", 2],
  ["withdrawal", 2],
  ["deposit", 2],
  ["balance", 1],
  ["amount", 1],
  ["date", 1],
  ["chq.", 1],
  ["chq", 1],
  ["ref.no.", 1],
  ["ref no", 1],
  ["cheque", 1],
];

const HEADER_BOILERPLATE = [
  "statement of accounts", "account branch", "address", "page no",
  "generated on", "ifsc", "micr", "cust id", "account no", "phone no",
  "email", "nomination", "joint holders", "statement from", "a/c open date",
  "account status", "od limit", "currency", "registered office", "gstin",
  "gstn", "end of statement",
];

export function scoreHeaderRow(text: string): number {
  let score = 0;
  for (const [kw, w] of HEADER_KEYWORD_SCORES) {
    if (text.includes(kw)) score += w;
  }
  if (/\bdr\.?\b/.test(text)) score += 1;
  if (/\bcr\.?\b/.test(text)) score += 1;
  for (const b of HEADER_BOILERPLATE) {
    if (text.includes(b)) score -= 2;
  }
  return score;
}

export function findHeaderRow(rows: string[][]): number | null {
  let best: { idx: number; score: number } | null = null;
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const text = rows[i].join(" ").toLowerCase();
    const score = scoreHeaderRow(text);
    if (score >= 4 && (!best || score > best.score)) {
      best = { idx: i, score };
    }
  }
  return best?.idx ?? null;
}

// ── Bank statement parser (auto header detection) ─────────────────────────

export function parseBankStatement(
  rows: string[][],
  corrections: CorrectionsMap = {},
): { transactions: Transaction[] | null; balanceCheck?: UploadResult["balanceCheck"] } {
  const headerIdx = findHeaderRow(rows);
  if (headerIdx === null) return { transactions: null };

  const headerLabels = rows[headerIdx].map((c) => String(c));
  const mapping = autoDetectColumns(headerLabels);
  const colIndex = (name: string | null) => (name ? headerLabels.indexOf(name) : null);
  const dateCol = colIndex(mapping.date);
  const descCol = colIndex(mapping.description);
  const withdrawalCol = colIndex(mapping.withdrawal);
  const depositCol = colIndex(mapping.deposit);
  const amountCol = colIndex(mapping.amount);
  const drCrCol = colIndex(mapping.drCr);
  const balanceCol = colIndex(mapping.balance);

  const transactions: Transaction[] = [];
  let lastTx: Transaction | null = null;
  // Balance-continuity self-check: when the statement carries a running
  // Balance column, verify prev_balance + amount == balance for every row.
  // A mismatch is a strong signal the parser mis-read a row (wrong sign,
  // wrong amount, or a skipped transaction).
  let prevBalance: number | null = null;
  const balanceMismatches: BalanceMismatch[] = [];
  let balanceChecked = 0;
  for (let idx = headerIdx + 1; idx < rows.length; idx++) {
    const row = rows[idx];
    const textVals = row.map((v) => String(v ?? ""));
    const fullText = textVals.join(" ").toLowerCase();
    const stripped = fullText.replace(/[*_-]/g, "").trim();
    if (!stripped) continue;
    if (fullText.includes("end of statement") || fullText.includes("page no")) continue;
    if (!/[a-z0-9]/i.test(stripped)) continue;
    // Repeated page headers inside the data block (common in PDFs and
    // multi-page exports) look like the header row — never transactions.
    if (scoreHeaderRow(fullText) >= 4) continue;

    const get = (col: number | null) => (col !== null && row[col] !== undefined ? String(row[col]).trim() : "");
    const dateRaw = get(dateCol);
    const descRaw = get(descCol);
    const hasDate = dateRaw !== "" && looksLikeDate(dateRaw);
    const hasDesc = descRaw !== "";
    // Summary/footer rows (e.g. HDFC "STATEMENT SUMMARY" totals, Dr/Cr Count)
    // carry numbers but no date and no description — never real transactions.
    if (dateCol !== null && !hasDate && !hasDesc) continue;

    // Multi-line narration continuation: a row with no date but a description
    // directly under a dated row is the wrapped tail of the previous
    // transaction (common in PDFs and fixed-width exports). Merge it in.
    if (dateCol !== null && !hasDate && hasDesc && lastTx) {
      lastTx.description = (lastTx.description + " " + descRaw).trim();
      const catResult = categorize(lastTx.description, lastTx.amount, corrections);
      lastTx.categories = catResult.categories;
      lastTx.confidence = catResult.confidence;
      lastTx.matchedKeywords = catResult.matchedKeywords;
      continue;
    }

    const dateStr = hasDate ? parseDateStr(dateRaw) : new Date().toISOString().slice(0, 10);

    let amount = 0;
    const wRaw = get(withdrawalCol);
    const dRaw = get(depositCol);
    const aRaw = get(amountCol);
    const hasWithdrawal = wRaw !== "";
    const hasDeposit = dRaw !== "";
    const hasSingle = aRaw !== "";
    if (hasWithdrawal || hasDeposit) {
      if (hasWithdrawal) amount = Math.abs(parseAmount(wRaw));
      if (hasDeposit) {
        const a = parseAmount(dRaw);
        if (a > 0) amount = -Math.abs(a);
      }
    } else if (hasSingle) {
      amount = parseAmount(aRaw);
      if (drCrCol !== null) {
        const dir = get(drCrCol).toLowerCase();
        if (/^(cr|credit|received|deposit|in|income)$/.test(dir)) amount = -Math.abs(amount);
        else if (/^(dr|debit|paid|withdrawal|out|expense)$/.test(dir)) amount = Math.abs(amount);
      }
    }

    let description = "Unknown Transaction";
    if (hasDesc) description = descRaw;

    if (["opening balance", "statement summary", "generated on", "gstin", "gstn",
      "end of statement", "registered office", "dr count", "cr count", "closing bal",
      "carried forward", "brought forward", "carried over", "balance b/f", "balance c/f"]
      .some((kw) => fullText.includes(kw))) continue;
    if (amount === 0 && (description === "Unknown Transaction" || description.length < 8)) continue;

    const catResult = categorize(description, amount, corrections);
    const tx: Transaction = {
      id: `imported-${idx}-${Date.now()}`,
      date: dateStr,
      description,
      amount,
      categories: catResult.categories,
      confidence: catResult.confidence,
      matchedKeywords: catResult.matchedKeywords,
      rawCategory: "",
      ...(catResult.payee ? { payee: catResult.payee } : {}),
    };

    // Balance-continuity self-check (only when the statement has a Balance
    // column). amount is signed: positive = expense, negative = income.
    if (balanceCol !== null) {
      const balRaw = get(balanceCol);
      if (balRaw !== "") {
        const actual = parseAmount(balRaw);
        if (prevBalance !== null) {
          balanceChecked++;
          // amount is signed positive=expense, negative=income; balance moves
          // in the opposite direction, so expected = prev - amount.
          const expected = prevBalance - amount;
          if (Math.abs(expected - actual) > 0.01) {
            balanceMismatches.push({
              date: dateStr,
              description,
              amount,
              expectedBalance: round2(expected),
              actualBalance: round2(actual),
            });
          }
        }
        prevBalance = actual;
      }
    }

    transactions.push(tx);
    lastTx = tx;
  }

  if (transactions.length === 0) return { transactions: null };
  return {
    transactions,
    ...(balanceCol !== null && balanceChecked > 0
      ? { balanceCheck: { checked: balanceChecked, mismatches: balanceMismatches } }
      : {}),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ── Standard file parser (first row = header) ─────────────────────────────

export function parseStandardFile(
  rows: string[][],
  corrections: CorrectionsMap = {},
): Transaction[] | null {
  if (rows.length < 2) return null;
  const header = rows[0].map((c) => String(c));
  const mapping = autoDetectColumns(header);
  const dataRows = rows.slice(1);

  const transactions: Transaction[] = [];
  dataRows.forEach((row, idx) => {
    const get = (col: string | null) => {
      if (!col) return undefined;
      const j = header.indexOf(col);
      return j >= 0 ? row[j] : undefined;
    };

    const dateVal = get(mapping.date);
    const dateStr = dateVal !== undefined && String(dateVal).trim() !== ""
      ? parseDateStr(String(dateVal))
      : new Date().toISOString().slice(0, 10);

    const rawWithdrawal = get(mapping.withdrawal);
    const rawDeposit = get(mapping.deposit);
    const rawAmount = get(mapping.amount);
    const rawDrCr = get(mapping.drCr);

    let amount = 0;
    const hasWithdrawal = rawWithdrawal !== undefined && String(rawWithdrawal).trim() !== "";
    const hasDeposit = rawDeposit !== undefined && String(rawDeposit).trim() !== "";
    const hasSingle = rawAmount !== undefined && String(rawAmount).trim() !== "";
    if (hasWithdrawal || hasDeposit) {
      if (hasWithdrawal) amount = Math.abs(parseAmount(rawWithdrawal));
      if (hasDeposit) {
        const a = parseAmount(rawDeposit);
        if (a > 0) amount = -Math.abs(a);
      }
    } else if (hasSingle) {
      amount = parseAmount(rawAmount);
      if (mapping.drCr && rawDrCr !== undefined) {
        const dir = String(rawDrCr).toLowerCase().trim();
        if (/^(cr|credit|received|deposit|in|income)$/.test(dir)) amount = -Math.abs(amount);
        else if (/^(dr|debit|paid|withdrawal|out|expense)$/.test(dir)) amount = Math.abs(amount);
      }
    }

    const descRaw = get(mapping.description);
    const description = descRaw !== undefined && String(descRaw).trim() !== ""
      ? String(descRaw).trim()
      : "Unknown Transaction";

    const rawCatRaw = get(mapping.category);
    const rawCat = rawCatRaw !== undefined && String(rawCatRaw).trim() !== ""
      ? String(rawCatRaw).trim()
      : "";

    let categories: string[];
    let confidence: "high" | "medium" | "low";
    let matchedKeywords: Record<string, string>;
    if (rawCat) {
      categories = [rawCat];
      confidence = "medium";
      matchedKeywords = {};
    } else {
      const catResult = categorize(description, amount, corrections);
      categories = catResult.categories;
      confidence = catResult.confidence;
      matchedKeywords = catResult.matchedKeywords;
    }

    // Real bank statements never carry a zero-amount transaction. Dropping
    // them here stops random CSVs (positional fallback) from fabricating
    // garbage rows with amount 0.
    if (amount === 0) return;

    transactions.push({
      id: `imported-${idx}-${Date.now()}`,
      date: dateStr,
      description,
      amount,
      categories,
      confidence,
      matchedKeywords,
      rawCategory: rawCat,
    });
  });

  return transactions.length > 0 ? transactions : null;
}

// ── Top-level dispatch ────────────────────────────────────────────────────

export interface UploadResult {
  transactions: Transaction[];
  insights: SpendingInsight[];
  budgets: BudgetRecommendation[];
  isFallback: boolean;
  /** Balance-continuity self-check results (empty when no Balance column). */
  balanceCheck?: {
    checked: number;
    mismatches: BalanceMismatch[];
  };
}

export interface BalanceMismatch {
  date: string;
  description: string;
  amount: number;
  expectedBalance: number;
  actualBalance: number;
}

export async function parseUploadedFile(
  contents: ArrayBuffer | string,
  filename: string,
  corrections: CorrectionsMap = {},
): Promise<UploadResult> {
  const rows = await parseFileToRows(contents, filename);
  const parsed = parseBankStatement(rows, corrections);
  let transactions = parsed.transactions;
  const balanceCheck = parsed.balanceCheck;
  if (transactions === null) {
    transactions = parseStandardFile(rows, corrections);
  }
  if (transactions === null) transactions = [];

  transactions = detectRecurring(transactions);
  const insights = generateInsights(transactions);

  return {
    transactions,
    insights,
    budgets: FALLBACK_BUDGETS,
    isFallback: true,
    ...(balanceCheck ? { balanceCheck } : {}),
  };
}

export { FALLBACK_BUDGETS };