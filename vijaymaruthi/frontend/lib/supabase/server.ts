import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Server-side Supabase client (App Router: server components, route handlers,
 * server actions). Uses the PUBLISHABLE key + the user's session cookies.
 *
 * ⚠️ Never import this from client components.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component — cannot set cookies here.
            // Session refresh is handled by middleware for page routes.
          }
        },
      },
    },
  );
}

/**
 * Service-role database client for privileged server-side queries
 * (e.g. profile lookup when checking admin status).
 * SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY must only ever live server-side.
 */
export async function createServiceClient() {
  const { createClient: createClientBase } = await import("@supabase/supabase-js");
  return createClientBase(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}
