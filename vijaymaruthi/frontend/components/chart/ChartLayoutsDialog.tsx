"use client";

// Chart layouts dialog: save the current chart as a named layout, list saved
// layouts, open a multi-chart grid, and delete layouts.

import { useState } from "react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LayoutGrid, Save, Trash2 } from "lucide-react";
import type { ChartLayout } from "./useChartLayouts";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  layouts: ChartLayout[];
  loaded: boolean;
  currentTicker: string;
  currentView: { interval: string; lookback: string; chartType: string };
  onSave: (name: string, layout: ChartLayout["layout"]) => void;
  onDelete: (id: string) => void;
}

export default function ChartLayoutsDialog({
  open, onOpenChange, layouts, loaded, currentTicker, currentView, onSave, onDelete,
}: Props) {
  const [name, setName] = useState("");

  const submit = () => {
    const n = name.trim();
    if (!n) return;
    onSave(n, [{ ticker: currentTicker, ...currentView }]);
    setName("");
  };

  const openGrid = (layout: ChartLayout) => {
    const ids = layout.layout.map((c) => encodeURIComponent(c.ticker)).join(",");
    window.location.href = `/charts?layout=${encodeURIComponent(layout.id)}&tickers=${ids}`;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Chart layouts</DialogTitle>
          <DialogDescription>
            Save the current chart view and reopen it later — alone or as a multi-chart grid.
          </DialogDescription>
        </DialogHeader>

        {/* Save current */}
        <div className="flex items-center gap-2 rounded-lg border border-border/60 p-3">
          <Input
            placeholder="Layout name (e.g. Weekly watchlist)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-8 text-xs"
          />
          <Button size="xs" onClick={submit} disabled={!name.trim()}>
            <Save className="size-3.5" /> Save
          </Button>
        </div>

        {/* List */}
        <div className="space-y-1.5">
          {!loaded && <p className="py-2 text-center text-xs text-muted-foreground">Loading layouts…</p>}
          {loaded && layouts.length === 0 && (
            <p className="py-2 text-center text-xs text-muted-foreground">No saved layouts yet.</p>
          )}
          {layouts.map((l) => (
            <div key={l.id} className="flex items-center gap-2 rounded-lg border border-border/60 px-2.5 py-1.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium">{l.name}</p>
                <p className="truncate text-[0.65rem] text-muted-foreground">
                  {l.layout.map((c) => c.ticker).join(", ")}
                </p>
              </div>
              <Button size="xs" variant="secondary" onClick={() => openGrid(l)}>
                <LayoutGrid className="size-3.5" /> Grid
              </Button>
              <button
                type="button"
                aria-label="Delete layout"
                onClick={() => onDelete(l.id)}
                className="text-muted-foreground transition-colors hover:text-destructive"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
        </div>

        <DialogFooter showCloseButton />
      </DialogContent>
    </Dialog>
  );
}