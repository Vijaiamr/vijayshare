import { NextResponse } from "next/server";
import { requireAnalytics, parseFilters, num } from "@/lib/analytics/admin";
import { applyDimensionFilters } from "@/lib/analytics/compute";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/analytics/audiences
 *
 * Audience segments (analytics_audiences) with live member counts.
 * Definition shapes:
 *   { type: "source", value: "google" }
 *   { type: "country", value: "IN" }
 *   { type: "device", value: "mobile" }
 *   { type: "returning", value: true }        — ≥2 sessions
 *   { type: "converted", value: true }        — ≥1 conversion
 *   { type: "engaged", value: true }          — ≥60s active time
 * Honors the global filters.
 */
export async function GET(request: Request) {
  const ctx = await requireAnalytics("view");
  if (ctx.error) return ctx.error;
  const q = parseFilters(request.url);

  const [audiencesRes, sessionsRes] = await Promise.all([
    ctx.service.from("analytics_audiences").select("*").order("created_at", { ascending: true }),
    applyDimensionFilters(
      ctx.service
        .from("analytics_sessions")
        .select("id,user_id,anonymous_id,source,country,device,page_views,active_seconds,conversions"),
      q.filters,
      "started_at",
      q.start,
      q.end,
    ),
  ]);

  const sessions = sessionsRes.data ?? [];
  const memberKeys = (def: unknown): Set<string> => {
    const d = def as { type?: string; value?: unknown } | undefined;
    const out = new Set<string>();
    if (!d?.type) return out;
    for (const s of sessions) {
      const key = s.user_id ?? s.anonymous_id ?? s.id;
      switch (d.type) {
        case "source":
          if (s.source === d.value) out.add(key);
          break;
        case "country":
          if (s.country === d.value) out.add(key);
          break;
        case "device":
          if (s.device === d.value) out.add(key);
          break;
        case "returning":
          if (d.value === true && num(s.page_views) >= 2) out.add(key);
          break;
        case "converted":
          if (d.value === true && num(s.conversions) >= 1) out.add(key);
          break;
        case "engaged":
          if (d.value === true && num(s.active_seconds) >= 60) out.add(key);
          break;
      }
    }
    return out;
  };

  const rows = (audiencesRes.data ?? []).map((a) => ({
    id: a.id,
    name: a.name,
    definition: a.definition,
    members: memberKeys(a.definition).size,
  }));

  return NextResponse.json({ days: q.days, audiences: rows });
}