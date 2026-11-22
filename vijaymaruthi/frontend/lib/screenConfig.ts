"use client";

import type { ScreenConfig } from "./patterns";
import { defaultScreenConfig } from "./patterns";

/**
 * Persistence + accessor for the user-adjustable pattern "screen dials"
 * (Feature 3). The Settings page writes a ScreenConfig to localStorage; the
 * chart / pattern call sites read it back and pass it to detectPatterns.
 *
 * Stored under a single key as a partial ScreenConfig (only the dials the
 * user changed). Reads merge over the defaults so a partial save is safe.
 */

const STORAGE_KEY = "vijaymaruthi.screenConfig.v1";

/** Read the saved screen config (merged over defaults). Returns null if none. */
export function loadScreenConfig(): ScreenConfig | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ScreenConfig>;
    return { ...defaultScreenConfig(), ...parsed };
  } catch {
    return null;
  }
}

/** Persist a screen config (partial or full). */
export function saveScreenConfig(cfg: Partial<ScreenConfig>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
  } catch {
    // ignore quota / privacy-mode errors
  }
}

/** Clear the saved screen config. */
export function clearScreenConfig(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

/** True when a non-default screen config is currently saved. */
export function hasCustomScreenConfig(): boolean {
  const cfg = loadScreenConfig();
  if (!cfg) return false;
  const def = defaultScreenConfig();
  return (Object.keys(def) as (keyof ScreenConfig)[]).some(
    (k) => cfg[k] !== def[k],
  );
}
