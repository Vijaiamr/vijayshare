import { NextResponse } from "next/server";

// Invite-code verification. The real code lives in the server-only env var
// INVITE_CODE and never reaches the browser. Constant-time comparison plus a
// small delay and per-IP rate limiting slow down brute-force attempts.

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// In-memory per-IP attempt tracker (resets on redeploy — acceptable for v1).
const attempts = new Map<string, number[]>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (attempts.get(ip) ?? []).filter((t) => now - t < 10 * 60 * 1000);
  if (recent.length >= 20) {
    attempts.set(ip, recent);
    return true;
  }
  recent.push(now);
  attempts.set(ip, recent);
  return false;
}

export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (isRateLimited(ip)) {
    return NextResponse.json({ error: "Too many attempts — try again later" }, { status: 429 });
  }

  let code = "";
  try {
    const body = await request.json();
    code = String(body?.code ?? "");
  } catch {
    // fall through — invalid body = invalid code
  }

  const expected = process.env.INVITE_CODE ?? "";

  // Constant-time-ish compare + fixed delay to frustrate brute force.
  const match = expected.length > 0 && safeEqual(code, expected);
  await new Promise((resolve) => setTimeout(resolve, 300));

  if (!match) {
    return NextResponse.json({ error: "Invalid invite code" }, { status: 401 });
  }
  return NextResponse.json({ ok: true });
}
