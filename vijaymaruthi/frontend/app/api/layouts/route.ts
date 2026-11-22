import { NextResponse } from "next/server";
import { authenticate } from "@/lib/server-auth";
import { supabaseConfigured, supabaseRequest } from "@/lib/supabase";

// Never statically optimize — layouts are per-user
export const dynamic = "force-dynamic";

/**
 * Saved chart layouts (supabase data mode).
 *
 *   GET    /api/layouts                    → ChartLayout[]
 *   POST   /api/layouts                    → create { name, layout }
 *   PATCH  /api/layouts?id=...             → update { name?, layout? }
 *   DELETE /api/layouts?id=...             → delete
 *
 * A layout is a named list of chart configs:
 *   [{ ticker, interval, lookback, chartType }, ...]
 *
 * Authorization mirrors /api/dashboard. RLS on chart_layouts restricts rows
 * to their owner.
 */

export interface ChartLayoutRow {
  id: string;
  name: string;
  layout: unknown[] | string;
  created_at: string;
  updated_at: string;
}

export async function GET(request: Request) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;
  if (!supabaseConfigured()) {
    return NextResponse.json({ error: "Supabase not configured on server" }, { status: 503 });
  }
  const user = auth.user;
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });

  try {
    const rows = await supabaseRequest<ChartLayoutRow[]>(
      `chart_layouts?select=*&user_id=eq.${encodeURIComponent(user.id)}&order=updated_at.desc`,
    );
    return NextResponse.json(rows);
  } catch (err) {
    const message = err instanceof Error ? err.message : "layouts fetch failed";
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
  if (!user) return NextResponse.json({ error: "Sign in required to save layouts" }, { status: 401 });

  let body: { name?: string; layout?: unknown[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.name || !Array.isArray(body.layout)) {
    return NextResponse.json({ error: "name and layout (array) are required" }, { status: 400 });
  }

  try {
    const rows = await supabaseRequest<ChartLayoutRow[]>("chart_layouts", {
      method: "POST",
      headers: { "Content-Type": "application/json", Prefer: "return=representation" },
      body: JSON.stringify({
        user_id: user.id,
        name: body.name,
        layout: body.layout,
      }),
    });
    return NextResponse.json(rows[0], { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "layout create failed";
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
  if (!user) return NextResponse.json({ error: "Sign in required to update layouts" }, { status: 401 });

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  let body: { name?: string; layout?: unknown[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body.name === "string") patch.name = body.name;
  if (Array.isArray(body.layout)) patch.layout = body.layout;

  try {
    const rows = await supabaseRequest<ChartLayoutRow[]>(
      `chart_layouts?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(user.id)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Prefer: "return=representation" },
        body: JSON.stringify(patch),
      },
    );
    if (rows.length === 0) return NextResponse.json({ error: "Layout not found" }, { status: 404 });
    return NextResponse.json(rows[0]);
  } catch (err) {
    const message = err instanceof Error ? err.message : "layout update failed";
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
  if (!user) return NextResponse.json({ error: "Sign in required to delete layouts" }, { status: 401 });

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  try {
    await supabaseRequest(
      `chart_layouts?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(user.id)}`,
      { method: "DELETE" },
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "layout delete failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}