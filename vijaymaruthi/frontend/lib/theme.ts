/**
 * Theme constants — no MUI dependencies.
 * Pure JS color constants for signal badges and theme helpers.
 *
 * Single source of truth for the Institutional Terminal palette.
 * Hex values here MUST match the CSS tokens in app/globals.css
 * (--strong-buy / --buy / --hold / --sell / --strong-sell).
 */

// ─── Signal colours (shared across components) ───
// Dark-first canonical set. Light-mode variants used via getSignalColor().

export const SIGNAL_COLORS = {
  BUY: { bg: "#0bb98a", text: "#04110b", label: "Can Buy" },
  HOLD: { bg: "#e7b62d", text: "#1a1300", label: "Hold" },
  SELL: { bg: "#f05252", text: "#ffffff", label: "Avoid" },
} as const;

export const SIGNAL_COLORS_LIGHT = {
  BUY: { bg: "#0b8a5f", text: "#ffffff", label: "Can Buy" },
  HOLD: { bg: "#b37f03", text: "#ffffff", label: "Hold" },
  SELL: { bg: "#d92d2d", text: "#ffffff", label: "Avoid" },
} as const;

/** 5-level signal ramp — matches CSS tokens exactly. */
export const SIGNAL_LEVELS = {
  "Strong Buy": { bg: "#20d6a0", text: "#04110b" },
  Buy: { bg: "#0bb98a", text: "#04110b" },
  Hold: { bg: "#e7b62d", text: "#1a1300" },
  Sell: { bg: "#e08a2e", text: "#1a1300" },
  "Strong Sell": { bg: "#f05252", text: "#ffffff" },
} as const;

export type SignalLevel = keyof typeof SIGNAL_LEVELS;

export function qmToSignal(rating: string): "BUY" | "HOLD" | "SELL" {
  if (rating === "Strong Buy" || rating === "Buy") return "BUY";
  if (rating === "Sell" || rating === "Strong Sell") return "SELL";
  return "HOLD";
}

export function getSignalColor(rating: string) {
  const dark = getCurrentMode() === "dark";
  const set = dark ? SIGNAL_COLORS : SIGNAL_COLORS_LIGHT;
  return set[qmToSignal(rating)] || set.HOLD;
}

/** Mode-aware hex for a 5-level signal kind (for inline styles). */
export function signalHex(kind: "strongBuy" | "buy" | "hold" | "sell" | "strongSell"): string {
  const dark = getCurrentMode() === "dark";
  const map = {
    strongBuy: dark ? "#20d6a0" : "#0e9f6e",
    buy: dark ? "#0bb98a" : "#0b8a5f",
    hold: dark ? "#e7b62d" : "#b37f03",
    sell: dark ? "#e08a2e" : "#d97a1f",
    strongSell: dark ? "#f05252" : "#d92d2d",
  };
  return map[kind];
}

/** Score → signal hue (>=75 strong buy, >=55 hold, else strong sell). */
export function scoreColor(score: number): string {
  if (score >= 75) return signalHex("strongBuy");
  if (score >= 55) return signalHex("hold");
  return signalHex("strongSell");
}

/** Mode-aware { bg, fg } pair for a 5-level signal kind (badges, chips). */
export function signalPair(kind: "strongBuy" | "buy" | "hold" | "sell" | "strongSell"): { bg: string; fg: string } {
  const dark = getCurrentMode() === "dark";
  const map = {
    strongBuy: dark ? { bg: "#20d6a0", fg: "#04110b" } : { bg: "#0e9f6e", fg: "#ffffff" },
    buy: dark ? { bg: "#0bb98a", fg: "#04110b" } : { bg: "#0b8a5f", fg: "#ffffff" },
    hold: dark ? { bg: "#e7b62d", fg: "#1a1300" } : { bg: "#b37f03", fg: "#ffffff" },
    sell: dark ? { bg: "#e08a2e", fg: "#1a1300" } : { bg: "#d97a1f", fg: "#ffffff" },
    strongSell: dark ? { bg: "#f05252", fg: "#ffffff" } : { bg: "#d92d2d", fg: "#ffffff" },
  };
  return map[kind];
}

/** CSSProperties-ready signal style (for inline style props). */
export function signalStyle(kind: "strongBuy" | "buy" | "hold" | "sell" | "strongSell"): { backgroundColor: string; color: string } {
  const p = signalPair(kind);
  return { backgroundColor: p.bg, color: p.fg };
}

// ─── Institutional Terminal palette (matches globals.css) ───

export const COLORS = {
  primary: "#20d6a0",
  primaryLight: "#20d6a0",
  danger: "#f05252",
  warning: "#e7b62d",
  success: "#20d6a0",
  surface: "#0d1011",
  card: "#121516",
  textPrimary: "#f2f4f3",
  textSecondary: "#8d9693",
  borderLight: "rgba(255, 255, 255, 0.08)",
  borderHover: "rgba(32, 214, 160, 0.25)",
} as const;

// ─── Dark mode helpers (replaces MUI useColorScheme) ───

export function getStoredTheme(): "light" | "dark" | "system" {
  if (typeof window === "undefined") return "dark";
  const stored = localStorage.getItem("qm-theme");
  if (stored === "light" || stored === "dark" || stored === "system") return stored;
  return "dark"; // default to dark theme
}

export function setStoredTheme(mode: "light" | "dark" | "system") {
  localStorage.setItem("qm-theme", mode);
  applyTheme(mode);
}

export function applyTheme(mode: "light" | "dark" | "system") {
  if (typeof window === "undefined") return;
  if (mode === "light") {
    document.documentElement.classList.remove("dark");
  } else if (mode === "dark") {
    document.documentElement.classList.add("dark");
  } else {
    // "system" — respect the OS preference
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.classList.toggle("dark", prefersDark);
  }
}

/** Get current effective mode (resolved, not "system") */
export function getCurrentMode(): "light" | "dark" {
  if (typeof window === "undefined") return "dark";
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}