"use client";

import * as React from "react";
import {
  Home,
  Calculator,
  Briefcase,
  BarChart3,
  Rocket,
  BookOpen,
  Settings,
  Info,
  Users,
  LayoutDashboard,
  Workflow,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Single source of truth for app navigation.
 * Consumed by SideMenu (desktop) and AppNavbar (mobile drawer) so the two
 * can never drift apart again.
 *
 * Only pages that exist today are listed — no dead links.
 */

export interface NavItemDef {
  label: string;
  icon: React.ReactNode;
  path: string;
  compact?: boolean;
  /** Admin-only items are hidden from non-admin viewers (client-side UX;
   *  the server still enforces admin on every route). */
  adminOnly?: boolean;
  /** Highlight this item when the pathname starts with this prefix
   *  (e.g. a section landing page whose sub-pages live under it). */
  match?: string;
}

export interface NavGroupDef {
  label: string;
  items: NavItemDef[];
  /** Pinned groups render at the bottom of the sidebar (e.g. System). */
  pinned?: boolean;
  /** Hide the whole group from non-admin viewers. */
  adminOnly?: boolean;
}

export const NAV_GROUPS: NavGroupDef[] = [
  {
    label: "Overview",
    items: [
      { label: "Home", icon: <Home size={18} />, path: "/" },
      { label: "Market", icon: <BarChart3 size={18} />, path: "/market" },
      { label: "Portfolio", icon: <Briefcase size={18} />, path: "/portfolio" },
      { label: "Free Stock Calculator", icon: <Calculator size={18} />, path: "/calculator" },
      { label: "Auto Pilot", icon: <Rocket size={18} />, path: "/pilot" },
      { label: "Deterministic Analyzer", icon: <Workflow size={18} />, path: "/deterministic" },
    ],
  },
  {
    label: "Finance",
    items: [
      { label: "My Financial Ledger", icon: <BookOpen size={18} />, path: "/ledger" },
    ],
  },
  {
    label: "System",
    pinned: true,
    items: [
      { label: "Settings", icon: <Settings size={18} />, path: "/settings" },
      { label: "About", icon: <Info size={18} />, path: "/about" },
      { label: "User Admin", icon: <Users size={18} />, path: "/admin/users", adminOnly: true },
    ],
  },
  {
    label: "Analytics (Admin)",
    pinned: true,
    adminOnly: true,
    items: [
      {
        label: "Analytics (Admin)",
        icon: <LayoutDashboard size={18} />,
        path: "/admin/analytics/exec",
        adminOnly: true,
        match: "/admin/analytics",
      },
    ],
  },
];

/** Shared nav row — emerald accent bar + subtle tinted active state. */
export function NavItem({
  item,
  selected,
  onClick,
}: {
  item: NavItemDef;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <li className="mb-0.5">
      <button
        onClick={onClick}
        className={cn(
          "relative w-full flex items-center gap-3 rounded-lg text-sm transition-colors duration-150",
          item.compact ? "py-2 pl-8 pr-3 text-xs" : "py-2.5 px-3",
          selected
            ? "bg-accent text-accent-foreground font-semibold"
            : "text-muted-foreground hover:bg-accent/40 hover:text-foreground"
        )}
      >
        {/* Emerald accent bar for selected items */}
        {selected && (
          <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-[60%] rounded-r bg-primary" />
        )}
        <span className={cn("flex-shrink-0", selected ? "text-primary" : "")}>
          {item.icon}
        </span>
        <span className="truncate">{item.label}</span>
      </button>
    </li>
  );
}

export function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <li className="px-3 pt-3 pb-1">
      <span className="text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground/60">
        {children}
      </span>
    </li>
  );
}

/** Brand block shared by desktop sidebar + mobile drawer. */
export function BrandBlock({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-3 px-5 py-6">
      <img
        src="/logo.png"
        alt="VijayMaruthi Logo"
        className={cn("rounded-lg object-cover", compact ? "w-8 h-8" : "w-[34px] h-[34px]")}
      />
      <div className="flex flex-col leading-tight">
        <span className="gradient-text text-lg font-extrabold tracking-tight">
          VijayMaruthi
        </span>
        <span className="font-mono text-[0.55rem] uppercase tracking-[0.18em] text-primary/80">
          Wealth Intelligence
        </span>
      </div>
    </div>
  );
}