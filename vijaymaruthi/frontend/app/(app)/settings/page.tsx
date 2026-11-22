"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { Settings, Home, RotateCcw, SlidersHorizontal, Check } from "lucide-react";
import {
  SCREEN_CONFIG_BOUNDS,
  SCREEN_CONFIG_LABELS,
  defaultScreenConfig,
  type ScreenConfig,
} from "@/lib/patterns";
import { loadScreenConfig, saveScreenConfig, clearScreenConfig } from "@/lib/screenConfig";

const DIAL_KEYS = Object.keys(SCREEN_CONFIG_LABELS) as (keyof ScreenConfig)[];

function formatValue(key: keyof ScreenConfig, v: number): string {
  if (key === "minConfidence" || key === "triangleMinTouches" || key === "cupMinBars" || key === "patternCooldownBars") {
    return String(Math.round(v));
  }
  return v.toFixed(2);
}

export default function SettingsPage() {
  const router = useRouter();
  const [dials, setDials] = useState<ScreenConfig>(defaultScreenConfig());
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const cfg = loadScreenConfig();
    if (cfg) setDials(cfg);
  }, []);

  const setDial = (key: keyof ScreenConfig, value: number) => {
    setDials((d) => ({ ...d, [key]: value }));
    setSaved(false);
  };

  const handleSave = () => {
    saveScreenConfig(dials);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleReset = () => {
    const def = defaultScreenConfig();
    setDials(def);
    clearScreenConfig();
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="w-full max-w-[800px]">
      {/* Breadcrumb */}
      <nav className="mb-1 flex items-center gap-1 text-xs">
        <Link
          href="/"
          className="flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground"
        >
          <Home size={14} />
          Home
        </Link>
        <span className="text-muted-foreground">/</span>
        <span className="font-semibold text-foreground">Settings</span>
      </nav>

      {/* Header */}
      <h2 className="mb-3 text-[1.6rem] font-bold tracking-tight">Settings</h2>

      {/* Screen Dials (Feature 3) */}
      <Card className="mb-2 border shadow-sm">
        <CardContent className="p-5">
          <div className="mb-2 flex items-center justify-between">
            <h6 className="flex items-center gap-2 text-sm font-semibold">
              <SlidersHorizontal className="h-4 w-4" />
              Pattern Screen Dials
            </h6>
            <Badge variant="outline" className="text-[0.65rem] font-semibold">
              Client
            </Badge>
          </div>
          <Separator className="mb-3" />
          <p className="mb-3 text-xs text-muted-foreground">
            Tune the pattern-detection thresholds used by the chart and Patterns tab.
            Changes apply immediately to new analyses and are stored in your browser.
          </p>

          <div className="grid grid-cols-1 gap-4">
            {DIAL_KEYS.map((key) => {
              const [min, max] = SCREEN_CONFIG_BOUNDS[key];
              const value = dials[key] ?? defaultScreenConfig()[key]!;
              return (
                <div key={key}>
                  <div className="mb-1 flex items-center justify-between">
                    <label className="text-sm font-medium">{SCREEN_CONFIG_LABELS[key]}</label>
                    <span className="text-xs font-semibold tabular-nums text-muted-foreground">
                      {formatValue(key, value)}
                    </span>
                  </div>
                  <Slider
                    value={value}
                    min={min}
                    max={max}
                    step={key === "minConfidence" || key === "triangleMinTouches" || key === "cupMinBars" || key === "patternCooldownBars" ? 1 : 0.01}
                    onValueChange={(v) => setDial(key, typeof v === "number" ? v : v[0])}
                    className="h-1.5"
                  />
                </div>
              );
            })}
          </div>

          <div className="mt-4 flex items-center gap-2">
            <Button size="sm" onClick={handleSave} className="gap-2 font-semibold">
              {saved ? <Check className="h-4 w-4" /> : <Settings className="h-4 w-4" />}
              {saved ? "Saved" : "Save Dials"}
            </Button>
            <Button size="sm" variant="outline" onClick={handleReset} className="gap-2 font-semibold">
              <RotateCcw className="h-4 w-4" />
              Reset to Defaults
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Analysis settings */}
      <Card className="mb-2 border shadow-sm">
        <CardContent className="p-5">
          <div className="mb-2 flex items-center justify-between">
            <h6 className="text-sm font-semibold">Analysis Configuration</h6>
            <Badge variant="outline" className="text-[0.65rem] font-semibold">
              Backend
            </Badge>
          </div>
          <Separator className="mb-2" />

          <div className="flex max-w-[300px] flex-col gap-4">
            <div>
              <label className="text-sm font-medium">Cache TTL (hours)</label>
              <input
                type="text"
                defaultValue="6"
                disabled
                className="mt-1 block w-full rounded-md border bg-muted px-3 py-1.5 text-sm opacity-60"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Set via CACHE_TTL_HOURS environment variable on the backend
              </p>
            </div>
            <div>
              <label className="text-sm font-medium">Batch Timeout (seconds)</label>
              <input
                type="text"
                defaultValue="300"
                disabled
                className="mt-1 block w-full rounded-md border bg-muted px-3 py-1.5 text-sm opacity-60"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Set via BATCH_TIMEOUT_SECONDS environment variable
              </p>
            </div>
            <div>
              <label className="text-sm font-medium">Ticker Timeout (seconds)</label>
              <input
                type="text"
                defaultValue="120"
                disabled
                className="mt-1 block w-full rounded-md border bg-muted px-3 py-1.5 text-sm opacity-60"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Set via TICKER_TIMEOUT_SECONDS &mdash; max time per stock analysis
              </p>
            </div>
            <div className="max-w-[400px]">
              <label className="text-sm font-medium">Database Path</label>
              <input
                type="text"
                defaultValue="reports/analysis_history.db"
                disabled
                className="mt-1 block w-full rounded-md border bg-muted px-3 py-1.5 text-sm opacity-60"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                SQLite database location (relative to analysis engine)
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Danger zone */}
      <Card className="border border-destructive/50 shadow-sm">
        <CardContent className="p-5">
          <div className="mb-2 flex items-center justify-between">
            <h6 className="text-sm font-semibold text-destructive">Danger Zone</h6>
            <Badge variant="destructive" className="text-[0.65rem] font-semibold">
              Destructive
            </Badge>
          </div>
          <Separator className="mb-2" />
          <p className="mb-2 text-sm text-muted-foreground">
            Clearing the analysis database will delete all saved results. You will need
            to re-run the NSE scan.
          </p>
          <Button variant="outline" size="sm" disabled className="gap-2 font-semibold">
            <RotateCcw className="h-4 w-4" />
            Clear Analysis Database (not yet implemented)
          </Button>
        </CardContent>
      </Card>

      <p className="pt-3 text-center text-[0.7rem] text-muted-foreground">
        Screen dials are stored in your browser and applied to chart pattern detection.
        Backend settings are configured via environment variables on the server.
      </p>
    </div>
  );
}
