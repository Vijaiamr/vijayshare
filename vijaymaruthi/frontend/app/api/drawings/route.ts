import { NextResponse } from "next/server";
import { authenticate } from "@/lib/server-auth";
import { supabaseConfigured, supabaseRequest } from "@/lib/supabase";
import type { ChartDrawing } from "@/components/chart/types";

// Never statically optimize — drawings are per-user and change frequently
export const dynamic = "force-dynamic";

/**
 * Chart drawings persistence (supabase data mode).
 *
 *   GET    /api/drawings?ticker=RELIANCE&interval=1d   → ChartDrawing[]
 *   POST   /api/drawings                                → create (body: ChartDrawing)
 *   PATCH  /api/drawings?id=d_xxx                       → update (body: ChartDrawing)
 *   DELETE /api/drawings?id=d_xxx                       → delete
 *
 * Authorization mirrors /api/dashboard (approved session or APP_TOKEN).
 * RLS on chart_drawings restricts every row to its owner.
 */

interface DrawingRow {
  id: string;
  ticker: string;
  interval: string;
  type: string;
  points: unknown[] | string;
  text: string | null;
  color: string;
  created_at: string;
  updated_at: string;
}

function toDrawing(row: DrawingRow): ChartDrawing {
  let points: ChartDrawing["points"] = [];
  if (Array.isArray(row.points)) points = row.points as ChartDrawing["points"];
  else if (typeof row.points === "string") points = JSON.parse(row.points);
  return {
    id: row.id,
    type: row.type as ChartDrawing["type"],
    points,
    text: row.text ?? undefined,
    color: row.color,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function GET(request: Request) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;
  if (!supabaseConfigured()) {
    return NextResponse.json({ error: "Supabase not configured on server" }, { status: 503 });
  }
  const url = new URL(request.url);
  const ticker = url.searchParams.get("ticker") ?? "";
  const interval = url.searchParams.get("interval") ?? "1d";
  if (!ticker) return NextResponse.json({ error: "ticker is required" }, { status: 400 });

  try {
    const rows = await supabaseRequest<DrawingRow[]>(
      `chart_drawings?select=*&ticker=eq.${encodeURIComponent(ticker)}&interval=eq.${encodeURIComponent(interval)}&order=created_at.asc`,
    );
    return NextResponse.json(rows.map(toDrawing));
  } catch (err) {
    const message = err instanceof Error ? err.message : "drawings fetch failed";
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
  if (!user) return NextResponse.json({ error: "Sign in required to save drawings" }, { status: 401 });

  let body: ChartDrawing & { ticker?: string; interval?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.id || !body.type || !Array.isArray(body.points) || !body.color) {
    return NextResponse.json({ error: "id, type, points and color are required" }, { status: 400 });
  }

  try {
    const rows = await supabaseRequest<DrawingRow[]>("chart_drawings", {
      method: "POST",
      headers: { "Content-Type": "application/json", Prefer: "return=representation" },
      body: JSON.stringify({
        id: body.id,
        user_id: user.id,
        ticker: body.ticker ?? "",
        interval: body.interval ?? "1d",
        type: body.type,
        points: body.points,
        text: body.text ?? null,
        color: body.color,
      }),
    });
    return NextResponse.json(toDrawing(rows[0]), { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "drawing create failed";
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
  if (!user) return NextResponse.json({ error: "Sign in required to update drawings" }, { status: 401 });

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  let body: ChartDrawing;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const rows = await supabaseRequest<DrawingRow[]>(
      `chart_drawings?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(user.id)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Prefer: "return=representation" },
        body: JSON.stringify({
          points: body.points,
          text: body.text ?? null,
          color: body.color,
          updated_at: new Date().toISOString(),
        }),
      },
    );
    if (rows.length === 0) return NextResponse.json({ error: "Drawing not found" }, { status: 404 });
    return NextResponse.json(toDrawing(rows[0]));
  } catch (err) {
    const message = err instanceof Error ? err.message : "drawing update failed";
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
  if (!user) return NextResponse.json({ error: "Sign in required to delete drawings" }, { status: 401 });

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  try {
    await supabaseRequest(
      `chart_drawings?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(user.id)}`,
      { method: "DELETE" },
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "drawing delete failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}