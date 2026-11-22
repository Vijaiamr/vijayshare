"use client";

// Symbol search — TradingView-style quick switcher. Searches the NSE symbol
// list (fetched once, cached) and navigates to the stock page.

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentTicker: string;
}

let cachedSymbols: string[] | null = null;

export default function ChartSymbolSearchDialog({ open, onOpenChange, currentTicker }: Props) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [symbols, setSymbols] = useState<string[]>(cachedSymbols ?? []);
  const [loading, setLoading] = useState(!cachedSymbols);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => {
    if (cachedSymbols) return;
    let cancelled = false;
    api.getNseSymbols()
      .then((res) => {
        if (cancelled) return;
        cachedSymbols = res.symbols ?? [];
        setSymbols(cachedSymbols);
        setLoading(false);
      })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const results = useMemo(() => {
    const q = query.trim().toUpperCase();
    if (!q) return symbols.slice(0, 50);
    return symbols.filter((s) => s.includes(q)).slice(0, 50);
  }, [query, symbols]);

  const go = (sym: string) => {
    onOpenChange(false);
    const bare = sym.replace(/\.(NS|BO)$/i, "");
    if (bare === currentTicker.replace(/\.(NS|BO)$/i, "")) return;
    router.push(`/stock/${encodeURIComponent(bare)}`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Symbol search</DialogTitle>
          <DialogDescription>Type to search NSE symbols.</DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="e.g. RELIANCE, TCS, HDFCBANK…"
            className="h-9 pl-7 text-sm"
          />
        </div>

        <div className="max-h-72 overflow-y-auto">
          {loading && <p className="py-4 text-center text-xs text-muted-foreground">Loading symbols…</p>}
          {!loading && results.length === 0 && (
            <p className="py-4 text-center text-xs text-muted-foreground">No symbols match “{query}”.</p>
          )}
          {results.map((s) => {
            const bare = s.replace(/\.(NS|BO)$/i, "");
            const active = bare === currentTicker.replace(/\.(NS|BO)$/i, "");
            return (
              <button
                key={s}
                type="button"
                onClick={() => go(s)}
                className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm transition-colors ${
                  active ? "bg-primary/10 text-primary" : "hover:bg-muted"
                }`}
              >
                <span className="font-medium">{bare}</span>
                {active && <span className="text-[0.65rem] text-muted-foreground">current</span>}
              </button>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}