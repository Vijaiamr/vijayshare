import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser-side Supabase client.
 *
 * Uses the PUBLISHABLE (anon) key — safe for the browser because every table
 * is locked behind Row Level Security. All real data reads happen through the
 * server proxy (/api/dashboard) which verifies the session server-side.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
