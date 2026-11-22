import { NextResponse } from "next/server";
import { authenticate } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

// Local AIOps API (FastAPI on the Mac). On Vercel this address does not
// exist, so the route degrades to { available: false } — the page then
// renders the "run locally" guidance panel. Mirrors the existing engine
// backend fallback (see lib/api.ts).
const AIOPS_API_URL =
  process.env.AIOPS_API_URL || "http://127.0.0.1:8010/api/v1";
const AIOPS_TIMEOUT_MS = 1500;

/**
 * GET /api/pilot/aiops/status
 *
 * Server-side proxy to the local AIOps status endpoint. Returns the live
 * status payload when the local server is reachable, otherwise
 * { available: false } — never fabricated data.
 */
export async function GET(request: Request) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), AIOPS_TIMEOUT_MS);
    try {
      const res = await fetch(`${AIOPS_API_URL}/status`, {
        signal: controller.signal,
        cache: "no-store",
      });
      if (!res.ok) {
        return NextResponse.json({ available: false });
      }
      const data = await res.json();
      return NextResponse.json({ available: true, ...data });
    } finally {
      clearTimeout(timeoutId);
    }
  } catch {
    // Local server unreachable (deployed mode or aiops serve not running)
    return NextResponse.json({ available: false });
  }
}