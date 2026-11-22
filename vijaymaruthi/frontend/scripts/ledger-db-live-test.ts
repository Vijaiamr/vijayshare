/**
 * Live Supabase integration test for the ledger db.ts helpers.
 * Run: npx tsx scripts/ledger-db-live-test.ts
 *
 * Proves: CRUD works against the real tables, owner_id isolation holds
 * (two simulated users never see each other's rows), and RLS blocks the
 * anon key from reading data.
 */
import * as fs from "fs";
import * as path from "path";

// Load .env.local into process.env BEFORE importing db.ts (db.ts reads the
// env at module load time, so static imports would see empty values).
const envPath = path.resolve(process.cwd(), ".env.local");
for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

import type { Transaction } from "../lib/ledger/types";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) console.log(`  PASS ${name}`);
  else {
    failures++;
    console.log(`  FAIL ${name}\n    expected ${e}\n    actual   ${a}`);
  }
}

const ownerA = "11111111-1111-4111-8111-111111111111"; // simulated "vijay"
const ownerB = "22222222-2222-4222-8222-222222222222"; // simulated "mani"

// Create two throwaway auth users so the owner_id FK constraint is satisfied.
// Uses the GoTrue admin API (service role) — no confirmation email is sent.
async function createTestUser(email: string): Promise<string> {
  const url = (process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const resp = await fetch(`${url}/auth/v1/admin/users`, {
    method: "POST",
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "LedgerTest!2026", email_confirm: true }),
  });
  const body = await resp.json();
  if (!body?.id) throw new Error(`admin create failed for ${email}: ${JSON.stringify(body)}`);
  return body.id as string;
}

async function deleteTestUser(id: string): Promise<void> {
  const url = (process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  await fetch(`${url}/auth/v1/admin/users/${id}`, {
    method: "DELETE",
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  });
}

async function main() {
  const {
    ledgerConfigured,
    getTransactions,
    insertTransactions,
    insertTransaction,
    updateTransaction,
    deleteTransaction,
    getBudgets,
    replaceBudgets,
    getCorrections,
    saveCorrection,
    getSummary,
  } = await import("../lib/ledger/db");

  console.log("== config ==");
  check("ledgerConfigured", ledgerConfigured(), true);

  console.log("== create test users ==");
  const ts = Date.now();
  const ownerA = await createTestUser(`ledger-test-a-${ts}@gmail.com`);
  const ownerB = await createTestUser(`ledger-test-b-${ts}@gmail.com`);
  console.log(`  owner A (test-a-${ts}): ${ownerA}`);
  console.log(`  owner B (test-b-${ts}): ${ownerB}`);
  console.log("== config ==");
  check("ledgerConfigured", ledgerConfigured(), true);

  // Clean slate
  for (const owner of [ownerA, ownerB]) {
    const existing = await getTransactions(owner);
    for (const t of existing) await deleteTransaction(owner, t.id);
    const budgets = await getBudgets(owner);
    if (budgets.length) await replaceBudgets(owner, []);
  }

  console.log("== insertTransactions (owner A) ==");
  const txsA: Omit<Transaction, "id">[] = [
    { date: "2026-08-01", description: "UPI-SWIGGY-SWIGGYIN@YBL-123-PAYMENT FROM PHONE", amount: 543, categories: ["Food & Dining"], confidence: "medium", recurring: false },
    { date: "2026-08-02", description: "BY TRANSFER ZERODHA BROKING LIMITED", amount: 5000, categories: ["Investment"], confidence: "medium", recurring: false },
    { date: "2026-08-03", description: "SALARY CREDIT FOR AUGUST", amount: -85000, categories: ["Income"], confidence: "high", recurring: false },
  ];
  const savedA = await insertTransactions(ownerA, txsA as Transaction[]);
  check("saved 3 rows with ids", savedA.length, 3);
  check("all have uuid ids", savedA.every((t) => /^[0-9a-f-]{36}$/.test(t.id)), true);

  console.log("== isolation: owner B sees nothing ==");
  const txsB0 = await getTransactions(ownerB);
  check("owner B empty", txsB0.length, 0);

  console.log("== insertTransaction (owner B) ==");
  const savedB = await insertTransaction(ownerB, {
    date: "2026-08-04", description: "UPI-ZEPTO-ZEPTOONLINE@YBL-456-PAYMENT FROM PHONE", amount: 201, categories: ["Food & Dining"], confidence: "medium", recurring: false,
  } as Transaction);
  check("owner B saved 1", Boolean(savedB.id), true);

  console.log("== isolation re-check ==");
  const txsA1 = await getTransactions(ownerA);
  check("owner A still 3 (B's row invisible)", txsA1.length, 3);
  const txsB1 = await getTransactions(ownerB);
  check("owner B sees exactly 1", txsB1.length, 1);
  check("owner B row is B's", txsB1[0].description.includes("ZEPTO"), true);

  console.log("== updateTransaction (owner A) ==");
  const target = savedA[0];
  const updated = await updateTransaction(ownerA, target.id, { categories: ["Food & Dining", "Shopping"] });
  check("categories updated", updated?.categories, ["Food & Dining", "Shopping"]);

  console.log("== budgets ==");
  const budgets = [
    { category: "Food & Dining", suggestedPercentage: 15, limitAmount: 25000 },
    { category: "Investment", suggestedPercentage: 15, limitAmount: 25000 },
  ];
  const savedBudgets = await replaceBudgets(ownerA, budgets);
  check("budgets saved", savedBudgets.length, 2);
  const readBudgets = await getBudgets(ownerA);
  check("budgets read back", readBudgets.length, 2);
  const bBudgets = await getBudgets(ownerB);
  check("owner B budgets empty (isolation)", bBudgets.length, 0);

  console.log("== corrections ==");
  await saveCorrection(ownerA, "UPI-THIYAGU ELUMALAI-PAYTMQR6YF2W2@PTYS-YESB0PTMUPI-74292146", ["Food & Dining"], "thiyagu elumalai");
  const corrA = await getCorrections(ownerA);
  check("correction learned for A (desc key)", corrA["desc::UPI-THIYAGU ELUMALAI-PAYTMQR6YF2W2@PTYS-YESB0PTMUPI-74292146"], ["Food & Dining"]);
  check("correction learned for A (payee key)", corrA["payee::thiyagu elumalai"], ["Food & Dining"]);
  const corrB = await getCorrections(ownerB);
  check("owner B corrections empty (isolation)", Object.keys(corrB).length, 0);

  console.log("== summary ==");
  const summary = await getSummary(ownerA);
  check("totalSpent", summary.totalSpent, 5543);
  check("totalIncome", summary.totalIncome, 85000);
  check("netSavings", summary.netSavings, 79457);
  check("transactionCount", summary.transactionCount, 3);
  check("topCategory", summary.topCategory, "Investment");

  console.log("== deleteTransaction ==");
  await deleteTransaction(ownerA, target.id);
  const afterDelete = await getTransactions(ownerA);
  check("owner A now 2", afterDelete.length, 2);

  console.log("== RLS: anon key must NOT read data ==");
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  const url = (process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
  const rlsResp = await fetch(`${url}/rest/v1/ledger_transactions?select=id&limit=5`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
  });
  const rlsBody = await rlsResp.json();
  check("anon read blocked (RLS)", Array.isArray(rlsBody) && rlsBody.length === 0, true);

  // Cleanup
  for (const owner of [ownerA, ownerB]) {
    const existing = await getTransactions(owner);
    for (const t of existing) await deleteTransaction(owner, t.id);
    const budgets = await getBudgets(owner);
    if (budgets.length) await replaceBudgets(owner, []);
  }
  await deleteTestUser(ownerA);
  await deleteTestUser(ownerB);
  console.log("  test users deleted");

  console.log(failures === 0 ? "\nALL LIVE TESTS PASSED" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});