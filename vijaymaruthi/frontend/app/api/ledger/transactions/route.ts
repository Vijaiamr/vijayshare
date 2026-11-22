import { NextResponse } from "next/server";
import { authenticate } from "@/lib/server-auth";
import {
  ledgerConfigured,
  getTransactions,
  insertTransaction,
  updateTransaction,
  deleteTransaction,
} from "@/lib/ledger/db";
import type { Transaction } from "@/lib/ledger/types";

export const dynamic = "force-dynamic";

/**
 * /api/ledger/transactions
 *
 * GET    ?month=YYYY-MM  → list the user's transactions (newest first)
 * POST   { transaction } → add one transaction
 * PATCH  { id, updates } → edit one transaction
 * DELETE ?id=...         → delete one transaction
 *
 * All operations are scoped to the authenticated user (owner_id).
 */
export async function GET(request: Request) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;
  const user = auth.user;
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  if (!ledgerConfigured()) return supabaseNotConfigured();

  try {
    const month = new URL(request.url).searchParams.get("month") ?? undefined;
    const transactions = await getTransactions(user.id, month);
    return NextResponse.json({ transactions });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: Request) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;
  const user = auth.user;
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  if (!ledgerConfigured()) return supabaseNotConfigured();

  try {
    const body = (await request.json()) as { transaction?: Partial<Transaction> };
    const tx = body.transaction;
    if (!tx || !tx.date || !tx.description || typeof tx.amount !== "number") {
      return NextResponse.json({ error: "transaction requires date, description, amount" }, { status: 400 });
    }
    const saved = await insertTransaction(user.id, tx as Transaction);
    return NextResponse.json({ transaction: saved });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(request: Request) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;
  const user = auth.user;
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  if (!ledgerConfigured()) return supabaseNotConfigured();

  try {
    const body = (await request.json()) as { id?: string; updates?: Partial<Transaction> };
    if (!body.id || !body.updates) {
      return NextResponse.json({ error: "id and updates required" }, { status: 400 });
    }
    const saved = await updateTransaction(user.id, body.id, body.updates);
    if (!saved) return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
    return NextResponse.json({ transaction: saved });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(request: Request) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;
  const user = auth.user;
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  if (!ledgerConfigured()) return supabaseNotConfigured();

  try {
    const id = new URL(request.url).searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    await deleteTransaction(user.id, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}

function supabaseNotConfigured() {
  return NextResponse.json(
    { error: "Supabase not configured on server (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)" },
    { status: 503 },
  );
}

function errorResponse(err: unknown) {
  const message = err instanceof Error ? err.message : "Ledger request failed";
  return NextResponse.json({ error: message }, { status: 500 });
}