/**
 * Shared server-side auth for API route handlers.
 *
 * Mirrors the authz rules of the platform (defense in depth):
 *   1. A valid Supabase session (browser cookie) AND an APPROVED profile.
 *   2. OR the shared APP_TOKEN (?token=...) — external monitoring/scripts only.
 *
 * Returns `{ user }` on success, or a `NextResponse` JSON error to return
 * directly. Route handlers should:
 *
 *   const auth = await authenticate(request);
 *   if ("response" in auth) return auth.response;
 *   const { user } = auth;
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseConfigured } from "@/lib/supabase";

export type AuthResult =
  | { user: import("@supabase/supabase-js").User | null; response?: never }
  | { user?: never; response: NextResponse };

export async function authenticate(request: Request): Promise<AuthResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const token = process.env.APP_TOKEN;
  const reqToken = new URL(request.url).searchParams.get("token") ?? "";
  const hasServiceToken = Boolean(token) && reqToken === token;

  if (!user && !hasServiceToken) {
    return {
      response: NextResponse.json({ error: "Unauthorized — sign in first" }, { status: 401 }),
    };
  }

  if (!supabaseConfigured()) {
    return {
      response: NextResponse.json(
        { error: "Supabase not configured on server (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)" },
        { status: 503 },
      ),
    };
  }

  // Session users must have an APPROVED profile. Service-token callers are
  // already vetted by possession of the shared secret.
  if (user && !hasServiceToken) {
    const { data: profile, error } = await supabase
      .from("profiles")
      .select("approved")
      .eq("id", user.id)
      .maybeSingle();

    if (error) {
      // Distinguish "table missing" (schema not applied) from real errors so
      // users aren't told to contact an admin for an infra problem.
      if (error.code === "PGRST205" || /Could not find the table 'public.profiles'/.test(error.message)) {
        return {
          response: NextResponse.json(
            { error: "Auth database schema not configured — the administrator must run sync/auth_schema_v2.sql" },
            { status: 503 },
          ),
        };
      }
      return { response: NextResponse.json({ error: error.message }, { status: 500 }) };
    }
    if (!profile) {
      return {
        response: NextResponse.json(
          { error: "Profile not found — contact the administrator" },
          { status: 403 },
        ),
      };
    }
    if (profile.approved !== true) {
      return {
        response: NextResponse.json(
          { error: "Account pending approval by the administrator" },
          { status: 403 },
        ),
      };
    }
  }

  return { user: user ?? null };
}
