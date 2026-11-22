"use client";

// Chart settings dialog: style (log scale, grid, candle colors) and
// per-indicator parameters. Changes are applied live and persisted by the
// parent (InteractiveChart) via localStorage.

import { useState } from "react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ChartSettings, IndicatorSettings, PriceScaleMode } from "./types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: ChartSettings;
  indicatorSettings: IndicatorSettings;
  onSettingsChange: (s: ChartSettings) => void;
  onIndicatorSettingsChange: (s: IndicatorSettings) => void;
}

function NumField({
  label, value, onChange, min = 1, max = 500,
}: {
  label: string; value: number; onChange: (v: number) => void; min?: number; max?: number;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input
        type="number"
        value={value}
        min={min}
        max={max}
        className="h-7 w-20 text-right text-xs"
        onChange={(e) => {
          const v = Number(e.target.value);
          if (!Number.isNaN(v)) onChange(Math.min(max, Math.max(min, v)));
        }}
      />
    </div>
  );
}

export default function ChartSettingsDialog({
  open, onOpenChange, settings, indicatorSettings, onSettingsChange, onIndicatorSettingsChange,
}: Props) {
  const [draft, setDraft] = useState<IndicatorSettings | null>(null);
  const active = draft ?? indicatorSettings;

  const set = (patch: Partial<IndicatorSettings>) => setDraft({ ...active, ...patch });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Chart settings</DialogTitle>
          <DialogDescription>Style, scale and indicator parameters.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Style */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-foreground">Style</p>
            <div className="grid grid-cols-2 gap-2">
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={settings.logScale}
                  onChange={(e) => onSettingsChange({ ...settings, logScale: e.target.checked })}
                  className="size-3.5 accent-[#20d6a0]"
                />
                Log scale
              </label>
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={settings.showGrid}
                  onChange={(e) => onSettingsChange({ ...settings, showGrid: e.target.checked })}
                  className="size-3.5 accent-[#20d6a0]"
                />
                Grid
              </label>
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={settings.magnet}
                  onChange={(e) => onSettingsChange({ ...settings, magnet: e.target.checked })}
                  className="size-3.5 accent-[#20d6a0]"
                />
                Magnet (snap to OHLC)
              </label>
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={settings.sessionBreaks}
                  onChange={(e) => onSettingsChange({ ...settings, sessionBreaks: e.target.checked })}
                  className="size-3.5 accent-[#20d6a0]"
                />
                Session breaks
              </label>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="flex items-center gap-2">
                <Label className="text-xs text-muted-foreground">Up</Label>
                <input
                  type="color"
                  value={settings.upColor}
                  onChange={(e) => onSettingsChange({ ...settings, upColor: e.target.value })}
                  className="h-6 w-10 cursor-pointer rounded border border-border bg-transparent"
                />
              </div>
              <div className="flex items-center gap-2">
                <Label className="text-xs text-muted-foreground">Down</Label>
                <input
                  type="color"
                  value={settings.downColor}
                  onChange={(e) => onSettingsChange({ ...settings, downColor: e.target.value })}
                  className="h-6 w-10 cursor-pointer rounded border border-border bg-transparent"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs text-muted-foreground">Price scale</Label>
                <select
                  value={settings.priceScaleMode}
                  onChange={(e) => onSettingsChange({ ...settings, priceScaleMode: e.target.value as PriceScaleMode })}
                  className="h-7 w-full rounded-md border border-border bg-background px-1 text-xs"
                >
                  <option value="normal">Normal</option>
                  <option value="log">Log</option>
                  <option value="percentage">Percentage</option>
                  <option value="indexed">Indexed to 100</option>
                </select>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Bar spacing (px, 0 = auto)</Label>
                <Input
                  type="number"
                  value={settings.barSpacing}
                  min={0}
                  max={50}
                  className="h-7 w-full text-right text-xs"
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (!Number.isNaN(v)) onSettingsChange({ ...settings, barSpacing: Math.min(50, Math.max(0, v)) });
                  }}
                />
              </div>
            </div>
            <div>
              <Label htmlFor="chart-watermark" className="text-xs text-muted-foreground">Watermark (empty = off)</Label>
              <Input
                id="chart-watermark"
                value={settings.watermark}
                placeholder="e.g. RELIANCE · 1D"
                className="h-7 text-xs"
                onChange={(e) => onSettingsChange({ ...settings, watermark: e.target.value })}
              />
            </div>
          </div>

          {/* Alternative chart-type params */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-foreground">Alternative chart types</p>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label htmlFor="chart-kagi-reversal" className="text-xs text-muted-foreground">Kagi reversal (%)</Label>
                <Input
                  id="chart-kagi-reversal"
                  type="number"
                  value={settings.kagiReversal}
                  min={0.1}
                  max={50}
                  step={0.1}
                  className="h-7 w-full text-right text-xs"
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (!Number.isNaN(v)) onSettingsChange({ ...settings, kagiReversal: Math.min(50, Math.max(0.1, v)) });
                  }}
                />
              </div>
              <div>
                <Label htmlFor="chart-pf-box" className="text-xs text-muted-foreground">P&amp;F box size (%)</Label>
                <Input
                  id="chart-pf-box"
                  type="number"
                  value={settings.pfBoxSize}
                  min={0.1}
                  max={20}
                  step={0.1}
                  className="h-7 w-full text-right text-xs"
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (!Number.isNaN(v)) onSettingsChange({ ...settings, pfBoxSize: Math.min(20, Math.max(0.1, v)) });
                  }}
                />
              </div>
              <div>
                <Label htmlFor="chart-pf-reversal" className="text-xs text-muted-foreground">P&amp;F reversal (boxes)</Label>
                <Input
                  id="chart-pf-reversal"
                  type="number"
                  value={settings.pfReversal}
                  min={1}
                  max={10}
                  className="h-7 w-full text-right text-xs"
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (!Number.isNaN(v)) onSettingsChange({ ...settings, pfReversal: Math.min(10, Math.max(1, Math.round(v))) });
                  }}
                />
              </div>
              <div>
                <Label htmlFor="chart-range-size" className="text-xs text-muted-foreground">Range size (%)</Label>
                <Input
                  id="chart-range-size"
                  type="number"
                  value={settings.rangeSize}
                  min={0.1}
                  max={20}
                  step={0.1}
                  className="h-7 w-full text-right text-xs"
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (!Number.isNaN(v)) onSettingsChange({ ...settings, rangeSize: Math.min(20, Math.max(0.1, v)) });
                  }}
                />
              </div>
              <div>
                <Label htmlFor="chart-linebreak-lines" className="text-xs text-muted-foreground">Line Break lines</Label>
                <Input
                  id="chart-linebreak-lines"
                  type="number"
                  value={settings.lineBreakLines}
                  min={1}
                  max={10}
                  className="h-7 w-full text-right text-xs"
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (!Number.isNaN(v)) onSettingsChange({ ...settings, lineBreakLines: Math.min(10, Math.max(1, Math.round(v))) });
                  }}
                />
              </div>
            </div>
          </div>

          {/* Indicator params */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-foreground">Indicators</p>
            <NumField label="RSI period" value={active.rsiPeriod} onChange={(v) => set({ rsiPeriod: v })} min={2} max={100} />
            <div className="grid grid-cols-3 gap-2">
              <NumField label="MACD fast" value={active.macdFast} onChange={(v) => set({ macdFast: v })} min={2} max={100} />
              <NumField label="MACD slow" value={active.macdSlow} onChange={(v) => set({ macdSlow: v })} min={2} max={200} />
              <NumField label="MACD sig" value={active.macdSignal} onChange={(v) => set({ macdSignal: v })} min={2} max={100} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <NumField label="Bollinger period" value={active.bbPeriod} onChange={(v) => set({ bbPeriod: v })} min={2} max={200} />
              <NumField label="Bollinger σ" value={active.bbStd} onChange={(v) => set({ bbStd: v })} min={0.5} max={5} />
            </div>
            <NumField label="ADX period" value={active.adxPeriod} onChange={(v) => set({ adxPeriod: v })} min={2} max={100} />
            <div className="grid grid-cols-3 gap-2">
              <NumField label="Stoch K" value={active.stochK} onChange={(v) => set({ stochK: v })} min={2} max={100} />
              <NumField label="Stoch D" value={active.stochD} onChange={(v) => set({ stochD: v })} min={2} max={100} />
              <NumField label="Stoch sm" value={active.stochSmooth} onChange={(v) => set({ stochSmooth: v })} min={1} max={50} />
            </div>
            <NumField label="CCI period" value={active.cciPeriod} onChange={(v) => set({ cciPeriod: v })} min={2} max={200} />
            <NumField label="ATR period" value={active.atrPeriod} onChange={(v) => set({ atrPeriod: v })} min={2} max={100} />
            <div className="grid grid-cols-2 gap-2">
              <NumField label="SuperTrend mult" value={active.superTrendMultiplier} onChange={(v) => set({ superTrendMultiplier: v })} min={0.5} max={10} />
              <NumField label="SuperTrend per" value={active.superTrendPeriod} onChange={(v) => set({ superTrendPeriod: v })} min={2} max={100} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <NumField label="PSAR step" value={active.psarStep} onChange={(v) => set({ psarStep: v })} min={0.001} max={0.5} />
              <NumField label="PSAR max" value={active.psarMax} onChange={(v) => set({ psarMax: v })} min={0.01} max={1} />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setDraft(null)}>Reset</Button>
          <Button
            onClick={() => {
              if (draft) onIndicatorSettingsChange(draft);
              setDraft(null);
              onOpenChange(false);
            }}
          >
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}