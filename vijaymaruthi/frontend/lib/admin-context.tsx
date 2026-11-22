"use client";

import * as React from "react";

/**
 * Client-side admin context. Fetches /api/auth/me once on mount and exposes
 * the viewer's role so admin-only navigation and pages can be gated in the
 * UI (the server still enforces roles on every API route — this is UX only).
 *
 * Role model (profiles.role):
 *   super_admin — full access incl. user management
 *   admin       — analytics + configuration (funnels/audiences/alerts)
 *   analyst     — analytics + exports
 *   viewer      — read-only analytics
 *   user        — regular app user (no analytics)
 */

interface MeUser {
  id: string;
  email: string | null;
  role: string;
  approved: boolean;
}

interface AdminCtx {
  user: MeUser | null;
  /** admin or super_admin (backward-compatible gate). */
  isAdmin: boolean;
  /** Any analytics role (super_admin/admin/analyst/viewer). */
  canViewAnalytics: boolean;
  /** admin or super_admin — can configure funnels/audiences/alerts. */
  canConfigure: boolean;
  /** analyst or above — can export data. */
  canExport: boolean;
  loading: boolean;
}

const ANALYTICS_ROLES = new Set(["super_admin", "admin", "analyst", "viewer"]);
const CONFIGURE_ROLES = new Set(["super_admin", "admin"]);
const EXPORT_ROLES = new Set(["super_admin", "admin", "analyst"]);

const Ctx = React.createContext<AdminCtx>({
  user: null,
  isAdmin: false,
  canViewAnalytics: false,
  canConfigure: false,
  canExport: false,
  loading: true,
});

export function AdminProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = React.useState<MeUser | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { user: null }))
      .then((d) => {
        if (!cancelled) {
          setUser(d.user ?? null);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setUser(null);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const value = React.useMemo<AdminCtx>(() => {
    const role = user?.role ?? "user";
    return {
      user,
      isAdmin: role === "admin" || role === "super_admin",
      canViewAnalytics: ANALYTICS_ROLES.has(role),
      canConfigure: CONFIGURE_ROLES.has(role),
      canExport: EXPORT_ROLES.has(role),
      loading,
    };
  }, [user, loading]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAdmin(): AdminCtx {
  return React.useContext(Ctx);
}