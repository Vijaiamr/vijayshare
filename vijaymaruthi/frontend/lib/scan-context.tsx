"use client";

import React, { createContext, useContext, useState, useRef, useCallback, useEffect } from "react";
import { api } from "@/lib/api";
import type { ScanProgress } from "@/lib/types";

interface ScanContextValue {
  scanProgress: ScanProgress | null;
  scanType: "all" | "pending" | null;
  isScanning: boolean;
  scanPct: number;
  startScanAll: (totalNse: number, dbEntries: number) => Promise<void>;
  startScanPending: (pendingCount: number) => Promise<void>;
  /** Called by pages that own dashboard data so scan completion can refresh them */
  registerDashboardRefresh: (fn: (force: boolean) => void) => void;
}

const ScanContext = createContext<ScanContextValue | null>(null);

export function useScan() {
  const ctx = useContext(ScanContext);
  if (!ctx) throw new Error("useScan must be used within ScanProvider");
  return ctx;
}

export function ScanProvider({ children }: { children: React.ReactNode }) {
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);
  const [scanType, setScanType] = useState<"all" | "pending" | null>(null);
  const scanPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const dashboardRefreshRef = useRef<((force: boolean) => void) | null>(null);

  const isScanning = !!(scanProgress && (scanProgress.status === "running" || scanProgress.status === "starting"));
  const scanPct = scanProgress && scanProgress.total > 0
    ? Math.round((scanProgress.completed / scanProgress.total) * 100)
    : 0;

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (scanPollRef.current) clearInterval(scanPollRef.current);
    };
  }, []);

  const pollScan = useCallback((scanId: string, type: "all" | "pending") => {
    if (scanPollRef.current) clearInterval(scanPollRef.current);
    setScanType(type);
    let pollCount = 0;
    scanPollRef.current = setInterval(async () => {
      pollCount++;
      try {
        const prog = await api.getScanProgress(scanId);
        setScanProgress(prog);
        if (prog.status === "completed" || prog.status === "failed") {
          if (scanPollRef.current) clearInterval(scanPollRef.current);
          scanPollRef.current = null;
          setScanType(null);
          // Refresh dashboard if a page registered its refresh function
          dashboardRefreshRef.current?.(false);
        }
      } catch {
        // ignore poll errors
      }
    }, 3000);
  }, []);

  const startScanAll = useCallback(async (totalNse: number, dbEntries: number) => {
    const result = await api.startNseScan("1y");
    setScanProgress({
      scan_id: result.scan_id,
      status: "starting",
      total: totalNse || 2400,
      completed: dbEntries,
      failed: 0,
      errors: [],
    });
    pollScan(result.scan_id, "all");
  }, [pollScan]);

  const startScanPending = useCallback(async (pendingCount: number) => {
    const result = await api.startPendingNseScan("1y");
    setScanProgress({
      scan_id: result.scan_id,
      status: "starting",
      total: pendingCount || 1,
      completed: 0,
      failed: 0,
      errors: [],
    });
    pollScan(result.scan_id, "pending");
  }, [pollScan]);

  const registerDashboardRefresh = useCallback((fn: (force: boolean) => void) => {
    dashboardRefreshRef.current = fn;
  }, []);

  return (
    <ScanContext.Provider value={{ scanProgress, scanType, isScanning, scanPct, startScanAll, startScanPending, registerDashboardRefresh }}>
      {children}
    </ScanContext.Provider>
  );
}
