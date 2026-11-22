"use client";

// Chart alerts dialog: create, list, toggle and delete in-app price alerts
// for the current ticker. Firing is handled by InteractiveChart (marks the
// alert inactive + shows a toast when the latest close crosses the price).

import { useState } from "react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Bell, BellOff, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChartAlert } from "./useChartAlerts";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ticker: string;
  alerts: ChartAlert[];
  loaded: boolean;
  lastPrice: number | null;
  onAdd: (input: { direction: "above" | "below"; price: number; note?: string }) => void;
  onUpdate: (id: string, patch: Partial<ChartAlert>) => void;
  onDelete: (id: string) => void;
}

export default function ChartAlertsDialog({
  open, onOpenChange, ticker, alerts, loaded, lastPrice, onAdd, onUpdate, onDelete,
}: Props) {
  const [direction, setDirection] = useState<"above" | "below">("above");
  const [price, setPrice] = useState<string>("");
  const [note, setNote] = useState<string>("");

  const submit = () => {
    const p = Number(price);
    if (!Number.isFinite(p) || p <= 0) return;
    onAdd({ direction, price: p, note: note.trim() || undefined });
    setPrice("");
    setNote("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Price alerts — {ticker}</DialogTitle>
          <DialogDescription>
            In-app alerts fire when the latest close crosses your price.
            {lastPrice != null && ` Current close: ${lastPrice.toLocaleString("en-IN")}`}
          </DialogDescription>
        </DialogHeader>

        {/* Create */}
        <div className="space-y-2 rounded-lg border border-border/60 p-3">
          <div className="flex items-center gap-2">
            <div className="flex overflow-hidden rounded-md border border-border/60">
              {(["above", "below"] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDirection(d)}
                  className={cn(
                    "px-2.5 py-1 text-xs font-medium transition-colors",
                    direction === d ? "bg-primary text-primary-foreground" : "bg-transparent text-muted-foreground hover:bg-muted",
                  )}
                >
                  {d === "above" ? "Above" : "Below"}
                </button>
              ))}
            </div>
            <Input
              type="number"
              placeholder="Price"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              className="h-8 w-28 text-right text-xs"
            />
            <Button size="xs" onClick={submit} disabled={!Number.isFinite(Number(price)) || Number(price) <= 0}>
              <Plus className="size-3.5" /> Add
            </Button>
          </div>
          <Input
            placeholder="Note (optional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="h-8 text-xs"
          />
        </div>

        {/* List */}
        <div className="space-y-1.5">
          {!loaded && <p className="py-2 text-center text-xs text-muted-foreground">Loading alerts…</p>}
          {loaded && alerts.length === 0 && (
            <p className="py-2 text-center text-xs text-muted-foreground">No alerts yet for {ticker}.</p>
          )}
          {alerts.map((a) => (
            <div
              key={a.id}
              className={cn(
                "flex items-center gap-2 rounded-lg border border-border/60 px-2.5 py-1.5",
                !a.active && "opacity-50",
              )}
            >
              <button
                type="button"
                aria-label={a.active ? "Deactivate alert" : "Activate alert"}
                onClick={() => onUpdate(a.id, { active: !a.active })}
                className="text-muted-foreground transition-colors hover:text-foreground"
              >
                {a.active ? <Bell className="size-4 text-[#20d6a0]" /> : <BellOff className="size-4" />}
              </button>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium">
                  {a.direction === "above" ? "Above" : "Below"}{" "}
                  <span className="tabular-nums">{a.price.toLocaleString("en-IN")}</span>
                </p>
                {a.note && <p className="truncate text-[0.65rem] text-muted-foreground">{a.note}</p>}
              </div>
              <span className={cn("text-[0.6rem] font-semibold uppercase", a.active ? "text-[#20d6a0]" : "text-muted-foreground")}>
                {a.active ? "Active" : "Fired"}
              </span>
              <button
                type="button"
                aria-label="Delete alert"
                onClick={() => onDelete(a.id)}
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