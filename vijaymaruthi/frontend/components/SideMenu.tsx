"use client";

import * as React from "react";
import { useRouter, usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import ThemeSwitcher from "./ThemeSwitcher";
import UserBadge from "./UserBadge";
import { useAdmin } from "@/lib/admin-context";
import { NAV_GROUPS, NavItem, GroupLabel, BrandBlock } from "./nav-config";

const drawerWidth = 240;

export default function SideMenu() {
  const router = useRouter();
  const pathname = usePathname();
  const { isAdmin } = useAdmin();

  const visibleGroups = NAV_GROUPS.filter(
    (g) => !g.adminOnly || isAdmin,
  ).map((g) => ({
    ...g,
    items: g.items.filter((i) => !i.adminOnly || isAdmin),
  }));

  const mainGroups = visibleGroups.filter((g) => !g.pinned);
  const pinnedGroups = visibleGroups.filter((g) => g.pinned);

  return (
    <aside
      className="hidden md:flex flex-col shrink-0 w-[240px] border-r border-border bg-background"
      style={{ height: "100vh", position: "sticky", top: 0 }}
    >
      {/* Logo */}
      <BrandBlock />

      <hr className="mx-4 opacity-50 border-border" />

      {/* Navigation groups — all inside the scrollable area (pinned groups
          render last) so no item can ever be pushed off-screen. */}
      <nav className="flex-1 overflow-y-auto">
        {mainGroups.map((group) => (
          <ul key={group.label} className="flex flex-col gap-0.5 px-2 py-1">
            <GroupLabel>{group.label}</GroupLabel>
            {group.items.map((item) => (
              <NavItem
                key={item.path}
                item={item}
                selected={
                  item.match
                    ? pathname === item.match || pathname.startsWith(item.match + "/")
                    : pathname === item.path
                }
                onClick={() => router.push(item.path)}
              />
            ))}
          </ul>
        ))}
        {pinnedGroups.map((group) => (
          <ul key={group.label} className="flex flex-col gap-0.5 px-2 py-1">
            <GroupLabel>{group.label}</GroupLabel>
            {group.items.map((item) => (
              <NavItem
                key={item.path}
                item={item}
                selected={
                  item.match
                    ? pathname === item.match || pathname.startsWith(item.match + "/")
                    : pathname === item.path
                }
                onClick={() => router.push(item.path)}
              />
            ))}
          </ul>
        ))}
      </nav>

      {/* User Profile */}
      <hr className="mx-4 my-2 opacity-50 border-border" />
      <div className="flex items-center">
        <div className="flex-1 min-w-0">
          <UserBadge />
        </div>
        <div className="pr-3 shrink-0">
          <ThemeSwitcher slim />
        </div>
      </div>
    </aside>
  );
}