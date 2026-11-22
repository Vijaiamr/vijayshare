"use client";

import * as React from "react";
import { Menu, X } from "lucide-react";
import { useRouter, usePathname } from "next/navigation";
import ThemeSwitcher from "./ThemeSwitcher";
import UserBadge from "./UserBadge";
import { useAdmin } from "@/lib/admin-context";
import { Button } from "@/components/ui/button";
import { NAV_GROUPS, NavItem, GroupLabel, BrandBlock } from "./nav-config";

export default function AppNavbar() {
  const [open, setOpen] = React.useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const { isAdmin } = useAdmin();

  const visibleGroups = NAV_GROUPS.filter(
    (g) => !g.adminOnly || isAdmin,
  ).map((g) => ({
    ...g,
    items: g.items.filter((i) => !i.adminOnly || isAdmin),
  }));

  return (
    <>
      {/* Mobile top bar */}
      <header className="md:hidden fixed top-0 inset-x-0 z-50 flex items-center h-14 px-4 border-b border-border bg-background/80 backdrop-blur-xl">
        <Button
          variant="ghost"
          size="icon"
          className="mr-2 text-foreground"
          onClick={() => setOpen(true)}
        >
          <Menu className="h-5 w-5" />
        </Button>
        <div className="flex items-center gap-2">
          <img
            src="/logo.png"
            alt="VijayMaruthi Logo"
            className="w-7 h-7 rounded-md object-cover"
          />
          <span className="gradient-text text-base font-extrabold">VijayMaruthi</span>
        </div>
        <div className="flex-1" />
        <ThemeSwitcher slim />
      </header>

      {/* Mobile Drawer */}
      {open && (
        <>
          {/* Backdrop */}
          <div
            className="md:hidden fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />
          {/* Drawer panel */}
          <div className="md:hidden fixed inset-y-0 left-0 z-50 w-[260px] bg-background border-r border-border flex flex-col animate-in slide-in-from-left duration-200">
            {/* Logo + close */}
            <div className="flex items-center justify-between pr-3">
              <BrandBlock compact />
              <Button variant="ghost" size="icon-xs" onClick={() => setOpen(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>

            <hr className="mx-4 opacity-50 border-border" />

            {/* Navigation groups — all inside the scrollable area (pinned groups
              render last) so no item can ever be pushed off-screen. */}
            <nav className="flex-1 overflow-y-auto">
              {visibleGroups.filter((g) => !g.pinned).map((group) => (
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
                      onClick={() => {
                        router.push(item.path);
                        setOpen(false);
                      }}
                    />
                  ))}
                </ul>
              ))}
              {visibleGroups.filter((g) => g.pinned).map((group) => (
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
                      onClick={() => {
                        router.push(item.path);
                        setOpen(false);
                      }}
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
          </div>
        </>
      )}
    </>
  );
}