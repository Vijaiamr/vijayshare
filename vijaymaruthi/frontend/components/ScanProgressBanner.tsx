"use client";

import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useScan } from "@/lib/scan-context";

/**
 * Compact analysis-engine status pill — rendered in the app layout so it
 * stays visible on every page while a scan is running.
 * Terminal-style: `● ANALYSIS ENGINE ACTIVE · 2,411 / 2,570 · ▂▂▂▂░░ 2%`
 */
export default function ScanProgressBanner() {
  const { isScanning, scanPct, scanProgress, scanType } = useScan();

  return (
    <AnimatePresence>
      {isScanning && scanProgress && (
        <motion.div
          initial={{ opacity: 0, y: -12, height: 0 }}
          animate={{ opacity: 1, y: 0, height: "auto" }}
          exit={{ opacity: 0, y: -12, height: 0 }}
          transition={{ duration: 0.2, ease: [0.25, 0.46, 0.45, 0.94] }}
        >
          <div className="mx-1.5 mt-1 md:mx-3">
            <div className="inline-flex max-w-full items-center gap-2 overflow-hidden rounded-md border border-primary/25 bg-primary/5 px-2.5 py-1">
              {/* Pulsing dot */}
              <span className="relative flex size-2 shrink-0">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
                <span className="relative inline-flex size-2 rounded-full bg-primary" />
              </span>

              <span className="truncate font-mono text-[0.62rem] font-semibold uppercase tracking-[0.12em] text-foreground">
                Analysis Engine Active
              </span>

              <span className="hidden font-mono text-[0.62rem] text-muted-foreground sm:inline">
                {scanProgress.completed.toLocaleString()} / {scanProgress.total.toLocaleString()}
                {scanProgress.failed > 0 && (
                  <span className="text-strong-sell"> · {scanProgress.failed} failed</span>
                )}
              </span>

              {/* Block progress glyph */}
              <span className="hidden font-mono text-[0.6rem] tracking-tighter text-muted-foreground/70 md:inline">
                {blockGlyph(scanPct)}
              </span>

              <span className="font-mono text-[0.62rem] font-bold text-primary">
                {scanPct}%
              </span>

              <span className="hidden font-mono text-[0.55rem] uppercase tracking-[0.1em] text-muted-foreground/60 lg:inline">
                {scanType === "pending" ? "pending scan" : "full scan"}
              </span>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** ▂▃▅▇ block glyph — 8 cells, filled proportionally to progress. */
function blockGlyph(pct: number): string {
  const cells = 8;
  const filled = Math.round((Math.min(Math.max(pct, 0), 100) / 100) * cells);
  const blocks = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];
  let out = "";
  for (let i = 0; i < cells; i++) {
    if (i < filled) out += blocks[blocks.length - 1];
    else out += "░";
  }
  return out;
}