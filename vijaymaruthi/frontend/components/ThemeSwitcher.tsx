"use client";

import * as React from "react";
import { useEffect, useState } from "react";
import { Sun, Moon, Monitor } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { getStoredTheme, setStoredTheme, applyTheme } from "@/lib/theme";

type ModeOption = { value: "light" | "dark" | "system"; label: string; icon: React.ReactNode };

const OPTIONS: ModeOption[] = [
  { value: "light", label: "Light", icon: <Sun className="h-4 w-4" /> },
  { value: "dark", label: "Dark", icon: <Moon className="h-4 w-4" /> },
  { value: "system", label: "System", icon: <Monitor className="h-4 w-4" /> },
];

/**
 * Mode toggle (Light / Dark / System) using Tailwind's `dark` class.
 * Reads/writes localStorage("qm-theme") and toggles `.dark` on <html>.
 */
export default function ThemeSwitcher({ slim = false }: { slim?: boolean }) {
  const [mode, setMode] = useState<"light" | "dark" | "system">("dark");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMode(getStoredTheme());
    setMounted(true);
  }, []);

  const resolvedMode =
    mode === "system"
      ? typeof window !== "undefined" &&
        window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : mode;
  const isDark = resolvedMode === "dark";

  const handleSelect = (value: "light" | "dark" | "system") => {
    setMode(value);
    setStoredTheme(value);
  };

  const currentIcon = mounted ? (
    isDark ? (
      <Sun className={slim ? "h-4 w-4" : "h-5 w-5"} />
    ) : (
      <Moon className={slim ? "h-4 w-4" : "h-5 w-5"} />
    )
  ) : (
    <Monitor className={slim ? "h-4 w-4" : "h-5 w-5"} />
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={`inline-flex items-center justify-center rounded-md transition-colors text-muted-foreground hover:text-foreground cursor-pointer ${slim ? "h-6 w-6" : "h-8 w-8"}`}>
        {currentIcon}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[140px]">
        {OPTIONS.map((option) => (
          <DropdownMenuItem
            key={option.value}
            onClick={() => handleSelect(option.value)}
            className={mode === option.value ? "bg-accent text-accent-foreground" : ""}
          >
            <span className="mr-2">{option.icon}</span>
            {option.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
