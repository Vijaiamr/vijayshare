import { NextResponse } from "next/server";
import { authenticate } from "@/lib/server-auth";
import { ledgerConfigured, saveCorrection } from "@/lib/ledger/db";

export const dynamic = "force-dynamic";

/**
 * POST /api/ledger/corrections
 *
 * Learn a user-taught categorization override. Stored per-user so future
 * uploads categorize the same merchant/payee correctly for THIS user only.
 */
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
    const body = (await request.json()) as {
      description?: string;
      categories?: string[];
      payee?: string | null;
    };
    const description = (body.description ?? "").trim();
    const categories = Array.isArray(body.categories) ? body.categories : [];
    if (!description || categories.length === 0) {
      return NextResponse.json({ error: "description and categories required" }, { status: 400 });
    }
    await saveCorrection(user.id, description, categories, body.payee ?? null);
    return NextResponse.json({ status: "ok", message: `Learned: '${description}' → ${categories.join(", ")}` });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Correction failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}