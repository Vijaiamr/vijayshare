"use client";

// Object tree — TradingView-style list of drawings on the chart. Click to
// select, delete to remove. Collapsible panel on the right edge.

import { useState } from "react";
import { ChevronRight, Layers, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ChartDrawing } from "./types";
import { DRAWING_TOOL_META } from "./drawings/tools";

interface Props {
  drawings: ChartDrawing[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onDelete: (id: string) => void;
}

export default function ChartObjectTree({ drawings, selectedId, onSelect, onDelete }: Props) {
  const [open, setOpen] = useState(false);

  const labelFor = (type: ChartDrawing["type"]) =>
    DRAWING_TOOL_META.find((m) => m.type === type)?.label ?? type;

  return (
    <div className="absolute top-10 right-2 z-30 flex items-start">
      {open && (
        <div className="mr-1 w-52 rounded-lg border border-border/60 bg-background/95 shadow-lg backdrop-blur">
          <div className="flex items-center justify-between border-b border-border/60 px-2 py-1.5">
            <span className="flex items-center gap-1 text-[0.65rem] font-semibold text-muted-foreground">
              <Layers className="size-3" /> Objects ({drawings.length})
            </span>
            <Button variant="ghost" size="icon-sm" aria-label="Close object tree" onClick={() => setOpen(false)}>
              <ChevronRight className="size-3.5" />
            </Button>
          </div>
          <div className="max-h-56 overflow-y-auto p-1">
            {drawings.length === 0 && (
              <p className="px-2 py-3 text-center text-[0.65rem] text-muted-foreground">No drawings yet.</p>
            )}
            {drawings.map((d) => (
              <div
                key={d.id}
                className={cn(
                  "group flex items-center justify-between rounded px-2 py-1 text-xs",
                  selectedId === d.id ? "bg-primary/10 text-primary" : "hover:bg-muted",
                )}
              >
                <button
                  type="button"
                  className="flex-1 truncate text-left"
                  onClick={() => onSelect(selectedId === d.id ? null : d.id)}
                >
                  <span className="mr-1 inline-block size-2 rounded-full" style={{ background: d.color }} />
                  {labelFor(d.type)}
                </button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Delete drawing"
                  className="opacity-0 group-hover:opacity-100"
                  onClick={() => onDelete(d.id)}
                >
                  <Trash2 className="size-3" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}
      {!open && (
        <Button variant="outline" size="icon-sm" aria-label="Open object tree" onClick={() => setOpen(true)}>
          <Layers className="size-3.5" />
        </Button>
      )}
    </div>
  );
}