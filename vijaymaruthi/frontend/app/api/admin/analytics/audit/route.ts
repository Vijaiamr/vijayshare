import { NextResponse } from "next/server";
import { requireAnalytics } from "@/lib/analytics/admin";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/analytics/audit?limit=100
 *
 * Audit log viewer — recent configuration changes (alerts, funnels,
 * audiences) with actor, action, entity and timestamp. Requires admin
 * (configure) capability.
 */
export async function GET(request: Request) {
  const ctx = await requireAnalytics("configure");
  if (ctx.error) return ctx.error;
  const limit = Math.min(500, Math.max(1, Number.parseInt(new URL(request.url).searchParams.get("limit") ?? "100", 10) || 100));

  const { data, error } = await ctx.service
    .from("analytics_audit_log")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ entries: data ?? [] });
}