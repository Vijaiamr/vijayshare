import { NextResponse } from "next/server";
import { authenticate } from "@/lib/server-auth";
import { ledgerConfigured, getBudgets, replaceBudgets } from "@/lib/ledger/db";
import type { BudgetRecommendation } from "@/lib/ledger/types";

export const dynamic = "force-dynamic";

/**
 * /api/ledger/budgets
 *
 * GET  → the user's budget limits
 * POST { budgets: [...] } → replace the user's full budget list
 */
export async function GET(request: Request) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;
  const user = auth.user;
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  if (!ledgerConfigured()) {
    return NextResponse.json(
      { error: "Supabase not configured on server (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)" },
      { status: 503 },
    );
  }

  try {
    const budgets = await getBudgets(user.id);
    return NextResponse.json({ budgets });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Budgets fetch failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;
  const user = auth.user;
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  if (!ledgerConfigured()) {
    return NextResponse.json(
      { error: "Supabase not configured on server (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)" },
      { status: 503 },
    );
  }

  try {
    const body = (await request.json()) as { budgets?: BudgetRecommendation[] };
    const budgets = Array.isArray(body.budgets) ? body.budgets : [];
    const saved = await replaceBudgets(user.id, budgets);
    return NextResponse.json({ budgets: saved });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Budgets save failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}