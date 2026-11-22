"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useAdmin } from "@/lib/admin-context";

const TAB_GROUPS: { label: string; tabs: { href: string; label: string }[] }[] = [
  {
    label: "Overview",
    tabs: [
      { href: "/admin/analytics/exec", label: "Executive" },
      { href: "/admin/analytics", label: "Behavior" },
      { href: "/admin/analytics/visitors", label: "Visitors" },
      { href: "/admin/analytics/sessions", label: "Sessions" },
      { href: "/admin/analytics/realtime", label: "Real-time" },
    ],
  },
  {
    label: "Engagement",
    tabs: [
      { href: "/admin/analytics/events", label: "Events" },
      { href: "/admin/analytics/funnels", label: "Funnels" },
      { href: "/admin/analytics/journeys", label: "Journeys" },
      { href: "/admin/analytics/campaigns", label: "Campaigns" },
      { href: "/admin/analytics/attribution", label: "Attribution" },
      { href: "/admin/analytics/audiences", label: "Audiences" },
    ],
  },
  {
    label: "Technical",
    tabs: [
      { href: "/admin/analytics/ux", label: "UX & Errors" },
      { href: "/admin/analytics/replay", label: "Replay" },
    ],
  },
  {
    label: "Intelligence",
    tabs: [
      { href: "/admin/analytics/insights", label: "AI Insights" },
      { href: "/admin/analytics/revenue", label: "Revenue" },
      { href: "/admin/analytics/alerts", label: "Alerts" },
      { href: "/admin/analytics/audit", label: "Audit" },
    ],
  },
];

export default function AdminAnalyticsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { canViewAnalytics, loading } = useAdmin();

  if (loading) {
    return <div className="w-full max-w-6xl animate-pulse rounded-xl border border-border bg-card p-8 text-sm text-muted-foreground">Loading…</div>;
  }

  if (!canViewAnalytics) {
    return (
      <div className="w-full max-w-6xl rounded-xl border border-rose-500/30 bg-rose-500/10 p-8 text-center text-sm text-rose-600 dark:text-rose-400">
        Forbidden — analytics access required.
      </div>
    );
  }

  return (
    <div className="w-full max-w-6xl">
      <nav aria-label="Analytics sections" className="mb-4 space-y-1.5">
        {TAB_GROUPS.map((g) => (
          <div key={g.label} className="flex flex-wrap items-center gap-1.5">
            <span className="w-16 shrink-0 text-[0.6rem] font-semibold uppercase tracking-widest text-muted-foreground/60">
              {g.label}
            </span>
            {g.tabs.map((t) => {
              const active = pathname === t.href;
              return (
                <Link
                  key={t.href}
                  href={t.href}
                  className={cn(
                    "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                    active
                      ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  {t.label}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
      {children}
    </div>
  );
}