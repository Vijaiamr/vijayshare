"use client";

// Chart templates — save the full view configuration (chart type, interval,
// lookback, toggles, settings, indicator settings) to localStorage and reload
// it later. TradingView-style "save template" behavior.

import { useState } from "react";
import { Trash2 } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ChartTemplate, ChartType, BarInterval, Lookback, ToggleState, ChartSettings, IndicatorSettings } from "./types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templates: ChartTemplate[];
  onSave: (t: ChartTemplate) => void;
  onDelete: (id: string) => void;
  onApply: (t: ChartTemplate) => void;
  current: {
    chartType: ChartType;
    interval: BarInterval;
    lookback: Lookback;
    toggles: ToggleState;
    settings: ChartSettings;
    indicatorSettings: IndicatorSettings;
  };
}

export default function ChartTemplatesDialog({
  open, onOpenChange, templates, onSave, onDelete, onApply, current,
}: Props) {
  const [name, setName] = useState("");

  const save = () => {
    const t: ChartTemplate = {
      id: `tpl_${Date.now()}`,
      name: name.trim() || `Template ${templates.length + 1}`,
      chartType: current.chartType,
      interval: current.interval,
      lookback: current.lookback,
      toggles: current.toggles,
      settings: current.settings,
      indicatorSettings: current.indicatorSettings,
      createdAt: new Date().toISOString(),
    };
    onSave(t);
    setName("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Chart templates</DialogTitle>
          <DialogDescription>Save the current layout and reload it on any symbol.</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Input
              placeholder="Template name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") save(); }}
              className="h-8 text-sm"
            />
            <Button size="sm" onClick={save} disabled={!name.trim()}>Save current</Button>
          </div>

          <div className="max-h-64 space-y-1 overflow-y-auto">
            {templates.length === 0 && (
              <p className="py-4 text-center text-xs text-muted-foreground">No templates saved yet.</p>
            )}
            {templates.map((t) => (
              <div
                key={t.id}
                className="flex items-center justify-between gap-2 rounded-md border border-border/60 px-2 py-1.5"
              >
                <button
                  type="button"
                  className="flex-1 text-left"
                  onClick={() => onApply(t)}
                  title="Apply template"
                >
                  <span className="block text-xs font-medium">{t.name}</span>
                  <span className="block text-[0.65rem] text-muted-foreground">
                    {t.chartType} · {t.interval} · {t.lookback} · {new Date(t.createdAt).toLocaleDateString()}
                  </span>
                </button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Delete ${t.name}`}
                  onClick={() => onDelete(t.id)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            ))}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}