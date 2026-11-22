import { NextResponse } from "next/server";
import { authenticate } from "@/lib/server-auth";
import { supabaseConfigured, supabaseRequest } from "@/lib/supabase";

// Never statically optimize — alerts are per-user
export const dynamic = "force-dynamic";

/**
 * In-app chart alerts (supabase data mode).
 *
 *   GET    /api/alerts?ticker=RELIANCE   → ChartAlert[] (all if no ticker)
 *   POST   /api/alerts                   → create { ticker, direction, price, note? }
 *   PATCH  /api/alerts?id=...            → update { active?, price?, direction?, note? }
 *   DELETE /api/alerts?id=...            → delete
 *
 * Authorization mirrors /api/dashboard. RLS restricts rows to their owner.
 */

export interface ChartAlert {
  id: string;
  ticker: string;
  direction: "above" | "below";
  price: number;
  note: string | null;
  active: boolean;
  created_at: string;
}

export async function GET(request: Request) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;
  if (!supabaseConfigured()) {
    return NextResponse.json({ error: "Supabase not configured on server" }, { status: 503 });
  }
  const user = auth.user;
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });

  const ticker = new URL(request.url).searchParams.get("ticker");
  const filter = ticker ? `&ticker=eq.${encodeURIComponent(ticker)}` : "";
  try {
    const rows = await supabaseRequest<ChartAlert[]>(
      `chart_alerts?select=*&user_id=eq.${encodeURIComponent(user.id)}${filter}&order=created_at.desc`,
    );
    return NextResponse.json(rows);
  } catch (err) {
    const message = err instanceof Error ? err.message : "alerts fetch failed";
    if (message.includes("PGRST205")) {
      return NextResponse.json(
        { error: "Chart interactivity tables not created yet — run sync/chart_schema_v2.sql in the Supabase SQL Editor." },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;
  if (!supabaseConfigured()) {
    return NextResponse.json({ error: "Supabase not configured on server" }, { status: 503 });
  }
  const user = auth.user;
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });

  let body: { ticker?: string; direction?: string; price?: number; note?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.ticker || (body.direction !== "above" && body.direction !== "below") || typeof body.price !== "number") {
    return NextResponse.json({ error: "ticker, direction (above|below) and price are required" }, { status: 400 });
  }

  try {
    const rows = await supabaseRequest<ChartAlert[]>("chart_alerts", {
      method: "POST",
      headers: { "Content-Type": "application/json", Prefer: "return=representation" },
      body: JSON.stringify({
        user_id: user.id,
        ticker: body.ticker,
        direction: body.direction,
        price: body.price,
        note: body.note ?? null,
        active: true,
      }),
    });
    return NextResponse.json(rows[0], { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "alert create failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;
  if (!supabaseConfigured()) {
    return NextResponse.json({ error: "Supabase not configured on server" }, { status: 503 });
  }
  const user = auth.user;
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body.active === "boolean") patch.active = body.active;
  if (typeof body.price === "number") patch.price = body.price;
  if (body.direction === "above" || body.direction === "below") patch.direction = body.direction;
  if (typeof body.note === "string") patch.note = body.note;

  try {
    const rows = await supabaseRequest<ChartAlert[]>(
      `chart_alerts?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(user.id)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Prefer: "return=representation" },
        body: JSON.stringify(patch),
      },
    );
    if (rows.length === 0) return NextResponse.json({ error: "Alert not found" }, { status: 404 });
    return NextResponse.json(rows[0]);
  } catch (err) {
    const message = err instanceof Error ? err.message : "alert update failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;
  if (!supabaseConfigured()) {
    return NextResponse.json({ error: "Supabase not configured on server" }, { status: 503 });
  }
  const user = auth.user;
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  try {
    await supabaseRequest(
      `chart_alerts?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(user.id)}`,
      { method: "DELETE" },
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "alert delete failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}