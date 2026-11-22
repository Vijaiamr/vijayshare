import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/auth/me
 *
 * Returns the current session user's identity + role (admin/user) + approval
 * status. Used by the client shell to gate admin-only navigation and pages.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ user: null }, { status: 200 });
  }

  const service = await createServiceClient();
  const { data: profile } = await service
    .from("profiles")
    .select("role,approved,email")
    .eq("id", user.id)
    .maybeSingle();

  return NextResponse.json({
    user: {
      id: user.id,
      email: profile?.email ?? user.email ?? null,
      role: profile?.role ?? "user",
      approved: profile?.approved ?? false,
    },
  });
}