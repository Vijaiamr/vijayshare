"use client";

import * as React from "react";
import { useState, useEffect, useMemo, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { ArrowLeft, RefreshCw, TrendingUp, TrendingDown, LineChart, Activity, BarChart, CandlestickChart, ArrowLeftRight, Gauge, Landmark, Brain, LayoutGrid, Search, Copy, Bug, Wallet, FileText, Target, ChevronDown } from "lucide-react";
import { motion } from "framer-motion";
import { api } from "@/lib/api";
import InteractiveChart from "@/components/InteractiveChart";
import IndicatorDashboard from "@/components/IndicatorDashboard";
import type { TickerAnalysis, PatternBacktestResponse, FundamentalsData } from "@/lib/types";
import { PATTERN_LABELS, type DetectedPattern, type TrendLineDef, type MarkerDef } from "@/lib/patterns";
import { loadScreenConfig } from "@/lib/screenConfig";
import { detectCandlestickPatterns, candlestickSummary, type DetectedCandlePattern } from "@/lib/candlestick-patterns";
import { computeIndicators } from "@/lib/indicators";
import { computePriceTargets, type PriceTargets } from "@/lib/priceTargets";
import {
  fullAnalysisDocument, formatPrice, humanisedRisk,
} from "@/lib/humaniser";
import { qmToSignal, getSignalColor, signalHex, signalPair, signalStyle } from "@/lib/theme";
import FadeIn from "@/components/animations/FadeIn";
import { cn } from "@/lib/utils";
import { analytics } from "@/lib/analytics/client-tracker";

function cleanTickerName(ticker: string): string {
  return ticker.replace(".NS", "").replace(".BO", "");
}

// ─── Info chip ───

function InfoChip({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="text-center p-1.5">
      <p className="text-[0.65rem] uppercase font-medium tracking-wide text-muted-foreground block mb-0.5">
        {label}
      </p>
      <p className="text-sm font-bold" style={{ color }}>
        {value}
      </p>
    </div>
  );
}

// ─── Price target box ───

function PriceTargetBox({ label, value, subtitle, color }: { label: string; value: string; subtitle: string; color: string }) {
  return (
    <div className="p-1.5 rounded bg-muted">
      <p className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground block mb-0.5">
        {label}
      </p>
      <p className="text-base font-extrabold" style={{ color }}>
        {value}
      </p>
      <p className="text-[0.65rem] font-semibold" style={{ color }}>
        {subtitle}
      </p>
    </div>
  );
}

// ─── Section card (simplified for tabs) ───

function SectionCard({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Card className="mb-4 border-border">
      <CardContent className="p-2.5">
        <div className="flex items-center gap-2 mb-3">
          {icon && <span className="text-primary flex">{icon}</span>}
          <h3 className="text-sm font-semibold">{title}</h3>
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

// ─── Pattern row ───

function PatternRow({ name, confidence, direction, type, status, entry, stopLoss, target, riskReward, confirmations }: {
  name: string; confidence: number; direction: "bullish" | "bearish" | "neutral"; type?: string;
  status?: string; entry?: number | null; stopLoss?: number | null; target?: number | null;
  riskReward?: number | null; confirmations?: string[];
}) {
  const dirKind = direction === "bullish" ? "strongBuy" : direction === "bearish" ? "strongSell" : "hold";
  const dirPair = signalPair(dirKind);
  const progressColor = confidence >= 75 ? "bg-strong-buy" : confidence >= 50 ? "bg-hold" : "bg-strong-sell";
  const [open, setOpen] = useState(false);
  const statusMeta: Record<string, { label: string; cls: string }> = {
    forming: { label: "FORMING", cls: "bg-hold/15 text-hold border-hold/30" },
    active: { label: "ACTIVE", cls: "bg-strong-buy/15 text-strong-buy border-strong-buy/30" },
    completed: { label: "COMPLETED", cls: "bg-strong-buy/15 text-strong-buy border-strong-buy/30" },
    failed: { label: "FAILED", cls: "bg-strong-sell/15 text-strong-sell border-strong-sell/30" },
  };
  const st = statusMeta[status ?? "forming"] ?? statusMeta.forming;
  const hasDetail = entry != null || stopLoss != null || target != null || riskReward != null || (confirmations && confirmations.length > 0);
  return (
    <div className="border-b border-border">
      <button type="button" onClick={() => setOpen(!open)} className="w-full flex items-center justify-between py-2 text-left hover:bg-muted/30 rounded px-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">{name}</span>
          {type && <Badge variant="secondary" className="text-[0.6rem] h-4">{type}</Badge>}
          <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[0.55rem] font-bold uppercase tracking-wide border ${st.cls}`}>
            {st.label}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-[0.65rem] h-5 font-semibold" style={{ backgroundColor: `${dirPair.bg}1a`, color: dirPair.bg, borderColor: dirPair.bg }}>
            {direction}
          </Badge>
          <div className="w-16">
            <Progress value={confidence} className="h-1 rounded-full" />
            <p className="text-[0.6rem] text-muted-foreground text-right mt-0.5">
              {confidence.toFixed(0)}%
            </p>
          </div>
          {hasDetail && <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />}
        </div>
      </button>
      {open && hasDetail && (
        <div className="px-2 pb-2.5 grid grid-cols-2 md:grid-cols-4 gap-2 text-[0.7rem]">
          {entry != null && (
            <div className="rounded-md border border-border p-1.5">
              <p className="text-[0.55rem] uppercase tracking-wide text-muted-foreground">Entry</p>
              <p className="font-semibold">₹{entry.toFixed(2)}</p>
            </div>
          )}
          {stopLoss != null && (
            <div className="rounded-md border border-border p-1.5">
              <p className="text-[0.55rem] uppercase tracking-wide text-muted-foreground">Stop Loss</p>
              <p className="font-semibold text-strong-sell">₹{stopLoss.toFixed(2)}</p>
            </div>
          )}
          {target != null && (
            <div className="rounded-md border border-border p-1.5">
              <p className="text-[0.55rem] uppercase tracking-wide text-muted-foreground">Target</p>
              <p className="font-semibold text-strong-buy">₹{target.toFixed(2)}</p>
            </div>
          )}
          {riskReward != null && (
            <div className="rounded-md border border-border p-1.5">
              <p className="text-[0.55rem] uppercase tracking-wide text-muted-foreground">R:R</p>
              <p className="font-semibold">1:{riskReward.toFixed(2)}</p>
            </div>
          )}
          {confirmations && confirmations.length > 0 && (
            <div className="col-span-2 md:col-span-4 rounded-md border border-border p-1.5">
              <p className="text-[0.55rem] uppercase tracking-wide text-muted-foreground mb-0.5">Confirmations</p>
              <ul className="list-disc list-inside text-muted-foreground">
                {confirmations.map((c, i) => <li key={i}>{c}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Fundamental row ───

// ─── Fundamental verdict badge (Good / Neutral / Bad / N/A) ───

function VerdictBadge({ verdict }: { verdict: string }) {
  if (verdict === "Good") {
    return (
      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[0.6rem] font-bold uppercase tracking-wide bg-strong-buy/15 text-strong-buy border border-strong-buy/30">
        Good
      </span>
    );
  }
  if (verdict === "Neutral") {
    return (
      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[0.6rem] font-bold uppercase tracking-wide bg-hold/15 text-hold border border-hold/30">
        Neutral
      </span>
    );
  }
  if (verdict === "Bad") {
    return (
      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[0.6rem] font-bold uppercase tracking-wide bg-strong-sell/15 text-strong-sell border border-strong-sell/30">
        Bad
      </span>
    );
  }
  if (verdict === "N/A (sector)") {
    return (
      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[0.6rem] font-bold uppercase tracking-wide bg-muted text-muted-foreground border border-dashed border-border">
        N/A · Sector
      </span>
    );
  }
  // N/A (data)
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[0.6rem] font-bold uppercase tracking-wide bg-muted text-muted-foreground border border-border">
      N/A
    </span>
  );
}

// ─── Fundamental metric row with verdict badge + hover explanation ───

function FundMetricRow({ label, value, verdict, explanation, example }: {
  label: string;
  value: string;
  verdict: string;
  explanation?: string;
  example?: string;
}) {
  const labelEl = (
    <span className="text-xs text-muted-foreground">{label}</span>
  );
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-border">
      {explanation ? (
        <Tooltip>
          <TooltipTrigger>
            <span className="cursor-help underline decoration-dotted underline-offset-2">
              {labelEl}
            </span>
          </TooltipTrigger>
          <TooltipContent side="top" align="start" className="max-w-xs">
            <div className="space-y-1.5 py-0.5">
              <p className="font-bold text-[0.7rem] uppercase tracking-wide">{label}</p>
              <p className="text-[0.72rem] leading-snug">{explanation}</p>
              {example && (
                <p className="text-[0.68rem] leading-snug text-muted-foreground">
                  <span className="font-semibold">Example: </span>{example}
                </p>
              )}
            </div>
          </TooltipContent>
        </Tooltip>
      ) : (
        labelEl
      )}
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold font-mono">{value}</span>
        <VerdictBadge verdict={verdict} />
      </div>
    </div>
  );
}

// ─── Metric glossary — plain-language explanations + examples ───

const METRIC_GLOSSARY: Record<string, { explanation: string; example: string }> = {
  roic: {
    explanation: "Return on Invested Capital — how much profit a company earns for every rupee of money invested in its business (debt + equity). A higher number means the company uses its money efficiently to create value.",
    example: "ROIC of 15% means for every ₹100 invested in the business, it earns ₹15 of profit each year.",
  },
  roe: {
    explanation: "Return on Equity — the profit a company earns for every rupee of shareholders' money. It shows how well the company rewards the people who own it.",
    example: "ROE of 20% means shareholders earn ₹20 of profit for every ₹100 they own in the company.",
  },
  roa: {
    explanation: "Return on Assets — the profit a company earns for every rupee of assets it owns (buildings, machines, cash, etc.). It shows how efficiently the company uses everything it has.",
    example: "ROA of 10% means the company earns ₹10 of profit for every ₹100 of assets it owns.",
  },
  ebitda: {
    explanation: "Earnings Before Interest, Tax, Depreciation and Amortisation — the raw operating profit of a company before paying interest, tax, and accounting for wear-and-tear of assets. It shows how profitable the core business is.",
    example: "EBITDA of ₹500 Cr means the company's core operations generated ₹500 Cr of profit before interest, tax and depreciation.",
  },
  ebitda_margin: {
    explanation: "EBITDA as a percentage of revenue — how much of every rupee of sales is left as operating profit. A higher margin means the company keeps more from each sale.",
    example: "EBITDA margin of 25% means for every ₹100 of sales, ₹25 is operating profit.",
  },
  gross_margin: {
    explanation: "Gross profit as a percentage of revenue — how much money is left after paying the direct cost of making the product. It shows pricing power and how cheaply the company can produce.",
    example: "Gross margin of 40% means for every ₹100 of sales, ₹40 is left after paying the cost of goods sold.",
  },
  operating_margin: {
    explanation: "Operating profit as a percentage of revenue — how much is left after paying both the cost of goods AND day-to-day running costs (salaries, rent, admin). It shows how well the company controls its expenses.",
    example: "Operating margin of 15% means for every ₹100 of sales, ₹15 is left as operating profit.",
  },
  profit_margin: {
    explanation: "Net profit as a percentage of revenue — the final profit left after ALL costs, interest and tax. This is the 'bottom line' — how much the company actually keeps from each sale.",
    example: "Net profit margin of 12% means for every ₹100 of sales, the company keeps ₹12 as final profit.",
  },
  revenue_growth: {
    explanation: "How much the company's sales (revenue) grew compared to the same period last year. It shows whether the business is expanding or shrinking.",
    example: "Revenue growth of 15% means this year's sales are 15% higher than last year's.",
  },
  earnings_growth: {
    explanation: "How much the company's profit (earnings) grew compared to last year. It shows whether the company is becoming more profitable over time.",
    example: "Earnings growth of 20% means this year's profit is 20% higher than last year's.",
  },
  pe_trailing: {
    explanation: "Price-to-Earnings ratio — how much you pay for every rupee of the company's past-year profit. A lower P/E usually means the stock is cheaper relative to its earnings.",
    example: "P/E of 15 means you pay ₹15 for every ₹1 of the company's annual profit.",
  },
  pb_ratio: {
    explanation: "Price-to-Book ratio — how much you pay for every rupee of the company's net assets (book value). It compares the market price to what the company is actually worth on paper.",
    example: "P/B of 2 means you pay ₹2 for every ₹1 of the company's book value.",
  },
  ps_ratio: {
    explanation: "Price-to-Sales ratio — how much you pay for every rupee of the company's sales. Useful for companies that aren't yet profitable.",
    example: "P/S of 3 means you pay ₹3 for every ₹1 of annual sales.",
  },
  ev_to_ebitda: {
    explanation: "Enterprise Value to EBITDA — how expensive the whole company (including debt) is compared to its operating profit. A lower number means the company is cheaper.",
    example: "EV/EBITDA of 8 means the company's total value is 8 times its annual operating profit.",
  },
  dividend_yield: {
    explanation: "The annual dividend a company pays as a percentage of its share price. It shows how much cash income you earn just from holding the stock.",
    example: "Dividend yield of 3% means for every ₹100 of stock you own, you get ₹3 per year in dividends.",
  },
  debt_to_equity: {
    explanation: "How much debt a company has compared to shareholders' money. A lower number means the company is less risky and relies less on borrowed money.",
    example: "D/E of 0.5 means the company has ₹50 of debt for every ₹100 of shareholders' equity.",
  },
  beta: {
    explanation: "How much a stock moves compared to the overall market. Beta of 1 means it moves with the market; above 1 means it's more volatile; below 1 means it's calmer.",
    example: "Beta of 1.5 means if the market rises 10%, this stock tends to rise 15%.",
  },
  analyst_upside: {
    explanation: "How much analysts think the stock could rise from its current price to their average target price. A positive upside means analysts see room to grow.",
    example: "Analyst upside of 20% means analysts expect the stock to rise 20% from its current price.",
  },
  held_by_insiders: {
    explanation: "The percentage of the company owned by its own promoters, founders and management. Higher insider ownership usually means the people running it have a strong personal stake.",
    example: "Insider holding of 45% means the founders and management own 45% of the company.",
  },
  held_by_institutions: {
    explanation: "The percentage of the company owned by big institutions like mutual funds, banks and foreign investors. Higher institutional holding is often a sign of trust from professional investors.",
    example: "Institutional holding of 25% means mutual funds and other big investors own 25% of the company.",
  },
  free_cash_flow: {
    explanation: "The cash a company generates after paying for the things it needs to keep running and growing. Positive free cash flow means the company has real money left over.",
    example: "Free cash flow of ₹200 Cr means the company has ₹200 Cr of spare cash after all its expenses and investments.",
  },
  payout_ratio: {
    explanation: "The percentage of profit a company pays out as dividends. A moderate payout means it returns cash to shareholders while keeping some to grow.",
    example: "Payout ratio of 40% means the company gives 40% of its profit to shareholders as dividends.",
  },
  current_ratio: {
    explanation: "Whether a company can pay its short-term bills with its short-term assets. A ratio above 1 means it has more short-term assets than short-term debts.",
    example: "Current ratio of 1.5 means the company has ₹1.50 of short-term assets for every ₹1 of short-term debt.",
  },
  revenue_per_share: {
    explanation: "The company's total sales divided by the number of shares. It shows how much revenue each share of the company represents.",
    example: "Revenue per share of ₹200 means each share represents ₹200 of the company's annual sales.",
  },
  market_cap: {
    explanation: "The total market value of a company — share price multiplied by total number of shares. It shows how big the company is.",
    example: "Market cap of ₹50,000 Cr means the whole company is worth ₹50,000 Cr at the current share price.",
  },
  net_income: {
    explanation: "The company's final profit after all expenses, interest and tax. It's the 'bottom line' — how much money the company actually made.",
    example: "Net income of ₹1,000 Cr means the company made ₹1,000 Cr of profit in the year.",
  },
  revenue: {
    explanation: "The total money a company earns from selling its products or services before any costs are deducted. It's the 'top line' of the business.",
    example: "Revenue of ₹10,000 Cr means the company sold ₹10,000 Cr worth of products/services in the year.",
  },
  total_debt: {
    explanation: "The total amount of money a company owes to lenders (loans, bonds, borrowings). High debt can be risky because it must be repaid with interest.",
    example: "Total debt of ₹3,000 Cr means the company owes ₹3,000 Cr to its lenders.",
  },
  total_cash: {
    explanation: "The total cash and cash-equivalents a company has on hand. A strong cash position helps a company survive tough times and invest in growth.",
    example: "Total cash of ₹1,500 Cr means the company has ₹1,500 Cr of cash available.",
  },
  book_value: {
    explanation: "The value of a company's assets minus its liabilities, per share. It's the 'accounting worth' of the company on paper.",
    example: "Book value of ₹250 means each share represents ₹250 of net assets.",
  },
  eps_trailing: {
    explanation: "Earnings Per Share over the past year — the company's profit divided by the number of shares. It shows how much profit each share earned.",
    example: "EPS of ₹30 means each share earned ₹30 of profit in the past year.",
  },
  eps_forward: {
    explanation: "Expected Earnings Per Share for the coming year, based on analyst estimates. It shows how much profit each share is expected to earn.",
    example: "Forward EPS of ₹35 means analysts expect each share to earn ₹35 next year.",
  },
  analyst_target: {
    explanation: "The average price that analysts expect the stock to reach. It's their collective view of the stock's fair value.",
    example: "Analyst target of ₹500 means analysts on average expect the stock to reach ₹500.",
  },
  target_range: {
    explanation: "The lowest and highest price analysts expect the stock to reach. It shows the range of analyst opinions on the stock's value.",
    example: "Target range of ₹450–₹600 means analysts expect the stock between ₹450 and ₹600.",
  },
  recommendation: {
    explanation: "The average analyst recommendation for the stock — whether analysts say buy, hold or sell. It's a summary of professional opinion.",
    example: "A 'Buy' recommendation means most analysts think the stock is a good buy.",
  },
  fifty_two_week_high: {
    explanation: "The highest price the stock has reached in the last 52 weeks (one year). It shows the stock's recent peak.",
    example: "52-week high of ₹300 means the stock's highest price in the last year was ₹300.",
  },
  fifty_two_week_low: {
    explanation: "The lowest price the stock has reached in the last 52 weeks (one year). It shows the stock's recent bottom.",
    example: "52-week low of ₹180 means the stock's lowest price in the last year was ₹180.",
  },
  avg_volume: {
    explanation: "The average number of shares traded per day. Higher volume means the stock is more actively traded and easier to buy/sell.",
    example: "Average volume of 2M means about 2 million shares are traded each day.",
  },
  peg_ratio: {
    explanation: "Price-to-Earnings divided by earnings growth. It shows whether a stock's price is fair given how fast it's growing. Below 1 usually means it's good value for its growth.",
    example: "PEG of 0.8 means the stock is reasonably priced relative to its expected growth.",
  },
};

// ─── Format helpers for fundamental values ───

function fmtPct(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return `${(v * 100).toFixed(digits)}%`;
}

function fmtCr(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v) || v === 0) return "—";
  return `₹${(v / 1e7).toFixed(0)} Cr`;
}

function fmtNum(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return v.toFixed(digits);
}

function fmtRatio(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || Number.isNaN(v) || v === 0) return "—";
  return v.toFixed(digits);
}

// ─── Backend pattern geometry → DetectedPattern ───
// The engine's pattern_votes.geometry carries the institutional detector's
// neckline + LS/HD/RS structure + generic boundary lines/markers. Convert it
// to the frontend DetectedPattern shape so the interactive chart draws the
// engine's detection verbatim (all pattern types, not just neckline ones).
function backendGeometryToPatterns(data: TickerAnalysis, ohlcv: { time: string }[]): DetectedPattern[] {
  const pv = (data as any).conv_technical?.pattern_votes;
  const geometry = pv?.geometry;
  if (!Array.isArray(geometry) || geometry.length === 0) return [];
  const latestTime = ohlcv.length > 0 ? ohlcv[ohlcv.length - 1].time : undefined;
  const out: DetectedPattern[] = [];
  for (const geo of geometry) {
    const neck = Array.isArray(geo.neckline) ? geo.neckline : [];
    const struct = Array.isArray(geo.structure) ? geo.structure : [];
    const genLines = Array.isArray(geo.lines) ? geo.lines : [];
    const genMarkers = Array.isArray(geo.markers) ? geo.markers : [];
    const lines: TrendLineDef[] = [];
    const markers: MarkerDef[] = [];

    // 1. Neckline (dashed) + projection to the latest bar.
    if (neck.length >= 2) {
      const [t1, p1] = neck[0];
      const [t2, p2] = neck[1];
      lines.push({
        startTime: String(t1), endTime: String(t2),
        startPrice: Number(p1), endPrice: Number(p2),
        style: "dashed", color: "#a78bfa", width: 2, label: "Neckline",
      });
      if (latestTime && String(t2) !== latestTime) {
        const slope = (Number(p2) - Number(p1)) / (new Date(String(t2)).getTime() - new Date(String(t1)).getTime());
        const projPrice = Number(p2) + slope * (new Date(latestTime).getTime() - new Date(String(t2)).getTime());
        if (Number.isFinite(projPrice) && projPrice > 0) {
          lines.push({
            startTime: String(t2), endTime: latestTime,
            startPrice: Number(p2), endPrice: projPrice,
            style: "dotted", color: "rgba(167,139,250,0.4)", width: 1,
          });
        }
      }
    }

    // 2. Structure markers (LS/HD/RS) + W-shape connections.
    if (struct.length > 0) {
      for (const s of struct) {
        markers.push({
          time: String(s.time), label: String(s.label ?? ""),
          color: "#a78bfa", position: "belowBar" as const,
        });
      }
      const structPts = struct
        .map((s: any) => ({ time: String(s.time), price: Number(s.price) }))
        .filter((p: any) => p.time && Number.isFinite(p.price) && p.price > 0);
      for (let i = 0; i < structPts.length - 1; i++) {
        lines.push({
          startTime: structPts[i].time, endTime: structPts[i + 1].time,
          startPrice: structPts[i].price, endPrice: structPts[i + 1].price,
          style: "solid", color: "#a78bfa", width: 2,
        });
      }
    }

    // 3. Generic boundary lines (triangle legs, flag channels, wedge rails,
    //    double-top/bottom levels, cup rim, island range).
    for (const ln of genLines) {
      const pts = Array.isArray(ln.points) ? ln.points : [];
      if (pts.length < 2) continue;
      const [a, b] = pts;
      lines.push({
        startTime: String(a[0]), endTime: String(b[0]),
        startPrice: Number(a[1]), endPrice: Number(b[1]),
        style: ln.style === "dashed" ? "dashed" : "solid",
        color: "#a78bfa", width: 2,
      });
    }

    // 4. Generic markers (P1/P2, H1/H2, L1/L2, R1/R2, etc.).
    for (const m of genMarkers) {
      markers.push({
        time: String(m.time), label: String(m.label ?? ""),
        color: "#a78bfa", position: "belowBar" as const,
      });
    }

    if (lines.length === 0 && markers.length === 0) continue;
    const engineStatus = String(geo.status ?? "forming");
    const status: DetectedPattern["status"] =
      engineStatus === "active" || engineStatus === "completed" || engineStatus === "failed"
        ? engineStatus
        : "forming";
    out.push({
      type: (geo.type as DetectedPattern["type"]) ?? "inverse_head_and_shoulders",
      direction: geo.direction === "bearish" ? "bearish" : "bullish",
      confidence: Number(geo.confidence) || 0,
      lines, markers,
      entry: geo.entry != null ? Number(geo.entry) : null,
      stopLoss: geo.stop_loss != null ? Number(geo.stop_loss) : null,
      target: geo.target != null ? Number(geo.target) : null,
      riskReward: geo.risk_reward != null ? Number(geo.risk_reward) : null,
      status,
      triggerPrice: null, orderType: null,
      invalidation: "",
      confirmations: Array.isArray(geo.confirmations) ? geo.confirmations.map(String) : [],
    });
  }
  return out;
}

// ─── Main page ───

export default function StockAnalysisPage() {
  const params = useParams();
  const router = useRouter();
  const symbol = (params.symbol as string) || "";
  const [data, setData] = useState<TickerAnalysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>("chart");

  // Convolution state
  const [chartPatterns, setChartPatterns] = useState<DetectedPattern[]>([]);
  const [candlestickPatterns, setCandlestickPatterns] = useState<DetectedCandlePattern[]>([]);
  // Engine-detected patterns (backend geometry — single source of truth).
  const [backendPatterns, setBackendPatterns] = useState<DetectedPattern[]>([]);
  const [fundamentals, setFundamentals] = useState<FundamentalsData | null>(null);
  const [fundLoading, setFundLoading] = useState(false);

  // Client-side analysis state (runs in browser CPU when server data is stale)
  const [clientAnalyzing, setClientAnalyzing] = useState(false);
  const [clientAnalyzed, setClientAnalyzed] = useState(false);

  // Backtest state
  const [btTicker, setBtTicker] = useState("");
  const [btResult, setBtResult] = useState<PatternBacktestResponse | null>(null);
  const [btLoading, setBtLoading] = useState(false);
  const [btError, setBtError] = useState<string | null>(null);
  const [btMinConf, setBtMinConf] = useState(60);

  const fetchAnalysis = async () => {
    if (!symbol) return;
    analytics.track("stock_analyzed", { symbol: symbol.replace(".NS", "").replace(".BO", "") });
    setLoading(true);
    setError(null);
    try {
      const result = await api.analyze({ ticker: symbol, period: "1y" });
      setData(result);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Analysis failed");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (symbol) fetchAnalysis();
  }, [symbol]);

  // Fetch OHLCV + compute chart patterns + candlestick patterns when data loads
  useEffect(() => {
    if (!data) return;
    const loadPatterns = async () => {
      setClientAnalyzing(true);
      try {
        const ohlcvResp = await api.getOHLCV(data.ticker, "1y");
        const ohlcv = ohlcvResp.candles ?? [];
        const { swingHighs, swingLows } = computeIndicators(ohlcv);
        // Engine is the single source of truth for chart patterns: the
        // institutional detector (with live status + trade levels) drives the
        // UI. The client-side detector used a different swing window and
        // produced duplicates/conflicts, so it is no longer merged.
        const bp = backendGeometryToPatterns(data, ohlcv);
        setBackendPatterns(bp);
        setChartPatterns(bp);
        const cs = detectCandlestickPatterns(ohlcv);
        setCandlestickPatterns(cs);
        setClientAnalyzed(true);
      } catch {
        // silently ignore pattern detection errors
      } finally {
        setClientAnalyzing(false);
      }
    };
    loadPatterns();
  }, [data]);

  // Fetch fundamentals when Fundamentals tab opens
  const fetchFundamentals = useCallback(async () => {
    if (fundamentals || fundLoading) return;
    setFundLoading(true);
    try {
      const cleanTicker = symbol.replace(".NS", "").replace(".BO", "");
      const f = await api.getFundamentals(cleanTicker);
      setFundamentals(f);
    } catch {
      // silently ignore
    } finally {
      setFundLoading(false);
    }
  }, [symbol, fundamentals, fundLoading]);

  // Set backtest ticker when data loads
  useEffect(() => {
    if (data && !btTicker) setBtTicker(cleanTickerName(data.ticker));
  }, [data, btTicker]);

  // Humanised document
  const humanisedDoc = useMemo(() => {
    if (!data) return "";
    const qm = data.quantamental;
    return fullAnalysisDocument({
      signal: qmToSignal(qm.blended_rating),
      confidence: data.confidence,
      price: data.price,
      ticker: data.ticker,
      techSignal: data.signal,
      techScore: qm.technical_score,
      fundRating: qm.fundamental_rating,
      fundScore: qm.fundamental_score,
      blendedRating: qm.blended_rating,
      blendedScore: qm.blended_score,
      marketStructure: data.market_structure,
      trend: data.trend,
      evidence: qm.evidence,
      capCategory: qm.market_cap_category,
      weightAdjustments: qm.weight_adjustments,
    });
  }, [data]);

  // Run backtest
  const runBacktest = async () => {
    if (!btTicker.trim()) return;
    setBtLoading(true);
    setBtError(null);
    setBtResult(null);
    try {
      const ticker = btTicker.trim().includes(".") ? btTicker.trim() : `${btTicker.trim()}.NS`;
      const result = await api.patternBacktest(ticker, 2, btMinConf);
      setBtResult(result);
    } catch (err: unknown) {
      setBtError(err instanceof Error ? err.message : "Backtest failed");
    } finally {
      setBtLoading(false);
    }
  };

  // Loading
  if (loading) {
    return (
      <div className="w-full max-w-[1100px] flex flex-col items-center justify-center py-12 text-muted-foreground gap-4">
        <div className="w-9 h-9 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        <p className="text-sm">Analysing {cleanTickerName(symbol)}...</p>
      </div>
    );
  }

  // Error
  if (error) {
    return (
      <div className="w-full max-w-[1100px]">
        <Button variant="ghost" onClick={() => router.push("/")} className="mb-4 gap-2">
          <ArrowLeft className="h-4 w-4" /> Back to stock list
        </Button>
        <div className="border-l-4 border-strong-sell bg-strong-sell/10 p-3 rounded mb-4 text-sm text-strong-sell">{error}</div>
        <div className="flex gap-2">
          <Button onClick={fetchAnalysis}>Retry</Button>
          <Button variant="outline" onClick={() => router.push("/")}>Back to List</Button>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="w-full max-w-[1100px] text-center py-12 text-muted-foreground">
        <p className="text-base mb-4">No analysis data available.</p>
        <Button onClick={fetchAnalysis}>Analyse {cleanTickerName(symbol)}</Button>
      </div>
    );
  }

  const qm = data.quantamental;
  const signal = qmToSignal(qm.blended_rating);
  const sigColors = {
    ...getSignalColor(qm.blended_rating),
    kind:
      qm.blended_rating === "Strong Buy" || qm.blended_rating === "Buy"
        ? ("strongBuy" as const)
        : qm.blended_rating === "Sell" || qm.blended_rating === "Strong Sell"
          ? ("strongSell" as const)
          : ("hold" as const),
  };
  const name = cleanTickerName(data.ticker);
  const priceStr = formatPrice(data.price, data.ticker);
  const riskText = humanisedRisk({
    signal, confidence: data.confidence, price: data.price, ticker: data.ticker,
    techSignal: data.signal, techScore: qm.technical_score,
    fundRating: qm.fundamental_rating, fundScore: qm.fundamental_score,
    blendedRating: qm.blended_rating, blendedScore: qm.blended_score,
  });
  const riskColor = qm.blended_score >= 80 ? signalHex("strongBuy") : qm.blended_score >= 60 ? signalHex("hold") : signalHex("strongSell");

  const isCached = data.cached === true;
  const cachedAt = data.cached_at;

  // Staleness: server data older than 12 hours → client-side analysis takes over
  const STALENESS_MS = 12 * 60 * 60 * 1000;
  const cachedTime = cachedAt ? new Date(cachedAt).getTime() : 0;
  const isStale = cachedTime > 0 && (Date.now() - cachedTime) > STALENESS_MS;
  const staleHours = isStale ? Math.round((Date.now() - cachedTime) / (60 * 60 * 1000)) : 0;

  // Price targets
  const atrInfo = data.indicators?.atr as { atr?: number; percent_of_price?: number } | undefined;
  const priceTargets: PriceTargets = computePriceTargets(
    data.price,
    signal,
    data.support_resistance as any,
    atrInfo ?? null,
  );

  // Candlestick summary
  const csSummary = candlestickSummary(candlestickPatterns);

  // Convolution score
  const chartSignals = chartPatterns.filter(p => p.direction === "bullish").length - chartPatterns.filter(p => p.direction === "bearish").length;
  const csSignals = csSummary.bullish - csSummary.bearish;
  const chartPts = Math.max(-15, Math.min(15, chartSignals * 5));
  const csPts = Math.max(-15, Math.min(15, csSignals * 5));
  const fundPts = Math.max(-20, Math.min(20, ((qm.fundamental_score || 50) - 50) * 0.4));
  const convolutionScore = Math.round(50 + chartPts + csPts + fundPts);

  const handleTabChange = (value: string) => {
    setActiveTab(value);
    if (value === "fundamentals") fetchFundamentals();
  };

  return (
    <div className="w-full max-w-[1100px]">
      {/* Back button + cache indicator */}
      <div className="flex items-center justify-between mb-4 w-full">
        <Button variant="ghost" onClick={() => router.push("/")} className="gap-2">
          <ArrowLeft className="h-4 w-4" /> Back to stock list
        </Button>
        <div className="flex items-center gap-2">
          {isStale && clientAnalyzing && (
            <Badge variant="secondary" className="text-[0.6rem] h-5.5 gap-1 font-semibold" style={{ backgroundColor: signalPair("hold").bg, color: signalPair("hold").fg }}>
              <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
              Server data {staleHours}h old — analysing in browser…
            </Badge>
          )}
          {isStale && clientAnalyzed && !clientAnalyzing && (
            <Badge variant="secondary" className="text-[0.6rem] h-5.5 font-semibold" style={{ backgroundColor: signalPair("strongBuy").bg, color: signalPair("strongBuy").fg }}>
              Fresh (client-side) · server was {staleHours}h stale
            </Badge>
          )}
          {!isStale && isCached && (
            <span className="text-[0.6rem] text-muted-foreground">
              Cached analysis · {cachedAt ? new Date(cachedAt).toLocaleString() : "recent"}
            </span>
          )}
          {!isCached && data.cached_at === undefined && (
            <span className="text-[0.6rem] text-muted-foreground">
              Fresh analysis
            </span>
          )}
        </div>
      </div>

      {/* Header card */}
      <FadeIn delay={0.05}>
      <Card className={cn(
        "mb-4 border-2",
        sigColors.kind === "strongBuy" ? "border-strong-buy/40" : sigColors.kind === "hold" ? "border-hold/40" : "border-strong-sell/40",
      )}>
        <CardContent className="p-6">
          <div className="flex flex-col sm:flex-row gap-4 items-start justify-between">
            <div>
              <div className="flex items-center gap-3 mb-1">
                <h2 className="text-2xl font-extrabold gradient-text">{name}</h2>
                <Badge variant="outline" className={cn(
                  "gap-1 rounded-md font-bold uppercase tracking-wide",
                  sigColors.kind === "strongBuy"
                    ? "border-strong-buy/30 bg-strong-buy/10 text-strong-buy"
                    : sigColors.kind === "hold"
                      ? "border-hold/30 bg-hold/10 text-hold"
                      : "border-strong-sell/30 bg-strong-sell/10 text-strong-sell",
                )}>
                  <span className="size-1.5 rounded-full bg-current" />
                  {sigColors.label}
                </Badge>
                <Badge className="font-semibold rounded-md" style={signalStyle(convolutionScore >= 65 ? "strongBuy" : convolutionScore >= 45 ? "hold" : "strongSell")}>
                  Conv: {convolutionScore}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                {data.ticker} · {priceStr} · {qm.market_cap_category} cap
              </p>
              {qm.weight_adjustments.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {qm.weight_adjustments.map((adj, i) => (
                    <Badge key={i} variant="outline" className="text-[0.7rem]">{adj}</Badge>
                  ))}
                </div>
              )}
            </div>
            <div className="flex gap-6 shrink-0">
              <div className="text-center">
                <p className="text-3xl font-bold leading-none" style={{ color: riskColor }}>
                  {qm.blended_score.toFixed(0)}
                </p>
                <p className="text-xs text-muted-foreground">Score</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold leading-none" style={{ color: riskColor }}>
                  {data.confidence.toFixed(0)}%
                </p>
                <p className="text-xs text-muted-foreground">Confidence</p>
              </div>
              {data.conv_technical?.score != null && (
                <div className="text-center">
                  <p className="text-2xl font-bold leading-none" style={{
                    color: data.conv_technical.score >= 60 ? signalHex("strongBuy") : signalHex("hold"),
                  }}>
                    {data.conv_technical.score.toFixed(0)}
                  </p>
                  <p className="text-xs text-muted-foreground">Tech Conv</p>
                </div>
              )}
              {data.conv_fundamental?.score != null && (
                <div className="text-center">
                  <p className="text-2xl font-bold leading-none" style={{
                    color: data.conv_fundamental.score >= 60 ? signalHex("strongBuy") : signalHex("hold"),
                  }}>
                    {data.conv_fundamental.score.toFixed(0)}
                  </p>
                  <p className="text-xs text-muted-foreground">Fund Conv</p>
                </div>
              )}
              {data.conv_technical?.pattern_majority != null && (
                <div className="text-center">
                  <p className="text-2xl font-bold leading-none" style={{
                    color: data.conv_technical.pattern_majority ? signalHex("strongBuy") : signalHex("sell"),
                  }}>
                    {data.conv_technical.pattern_majority ? "▲" : "▼"}
                  </p>
                  <p className="text-xs text-muted-foreground">Patterns</p>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
      </FadeIn>

      {/* Price Action Card */}
      <FadeIn delay={0.1}>
      <Card className="mb-4 border-border">
        <CardContent className="p-2.5">
          <div className="flex items-center justify-between mb-1.5">
            <h3 className="text-sm font-semibold flex items-center gap-1.5">
              <Target className="h-4 w-4 text-primary" />
              Price Action
              {priceTargets.direction === "BUY" && (
                <Badge className="ml-1 font-semibold rounded h-5 text-[0.65rem]" style={signalStyle("strongBuy")}>BUY</Badge>
              )}
              {priceTargets.direction === "SELL" && (
                <Badge className="ml-1 font-semibold rounded h-5 text-[0.65rem]" style={signalStyle("strongSell")}>SELL</Badge>
              )}
              {priceTargets.direction === "HOLD" && (
                <Badge className="ml-1 font-semibold rounded h-5 text-[0.65rem]" style={signalStyle("hold")}>HOLD</Badge>
              )}
            </h3>
            {priceTargets.riskReward > 0 && (
              <span className="text-xs font-semibold" style={{
                color: priceTargets.riskReward >= 1.5 ? signalHex("strongBuy") : priceTargets.riskReward >= 0.5 ? signalHex("hold") : signalHex("strongSell"),
              }}>
                R:R 1:{priceTargets.riskReward.toFixed(2)}
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <PriceTargetBox
              label="Entry"
              value={formatPrice(priceTargets.entry, data.ticker)}
              subtitle={priceTargets.direction === "BUY" ? "Market buy" : priceTargets.direction === "SELL" ? "Market short" : "Current"}
              color="var(--foreground)"
            />
            <PriceTargetBox
              label={`Target 1 · ${priceTargets.target1Label}`}
              value={formatPrice(priceTargets.target1, data.ticker)}
              subtitle={`${priceTargets.upsidePct >= 0 ? "+" : ""}${priceTargets.upsidePct.toFixed(2)}%`}
              color={signalHex("strongBuy")}
            />
            <PriceTargetBox
              label={`Target 2${priceTargets.target2Label ? ` · ${priceTargets.target2Label}` : ""}`}
              value={priceTargets.target2 ? formatPrice(priceTargets.target2, data.ticker) : "—"}
              subtitle={priceTargets.target2 ? `${priceTargets.totalUpsidePct >= 0 ? "+" : ""}${priceTargets.totalUpsidePct.toFixed(2)}%` : "N/A"}
              color={priceTargets.target2 ? signalHex("strongBuy") : "var(--muted-foreground)"}
            />
            <PriceTargetBox
              label={`Stop Loss · ${priceTargets.stopLossLabel}`}
              value={formatPrice(priceTargets.stopLoss, data.ticker)}
              subtitle={`${priceTargets.downsidePct >= 0 ? "-" : ""}${Math.abs(priceTargets.downsidePct).toFixed(2)}%`}
              color={signalHex("strongSell")}
            />
          </div>

          {priceTargets.atrValue && (
            <p className="text-[0.65rem] text-muted-foreground block mt-2">
              Expected daily move (ATR): ~{formatPrice(priceTargets.atrValue, data.ticker)} ({priceTargets.atrPct?.toFixed(2)}%)
            </p>
          )}
        </CardContent>
      </Card>
      </FadeIn>

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* Tabbed Analysis — Chart, Patterns, Fundamentals, Backtest */}
      {/* ═══════════════════════════════════════════════════════════ */}
      <FadeIn delay={0.15}>
      <Card className="mb-4 border-border">
        <Tabs value={activeTab} onValueChange={handleTabChange}>
          <TabsList className="w-full justify-start h-11 border-b border-border rounded-none bg-transparent p-0">
            <TabsTrigger value="chart" className="text-xs font-semibold h-11 rounded-none data-[state=active]:border-b-2 data-[state=active]:border-primary">
              <LineChart className="h-4 w-4 mr-1.5" /> Chart
            </TabsTrigger>
            <TabsTrigger value="patterns" className="text-xs font-semibold h-11 rounded-none data-[state=active]:border-b-2 data-[state=active]:border-primary">
              <LayoutGrid className="h-4 w-4 mr-1.5" /> Patterns ({chartPatterns.length + candlestickPatterns.length})
            </TabsTrigger>
            <TabsTrigger value="fundamentals" className="text-xs font-semibold h-11 rounded-none data-[state=active]:border-b-2 data-[state=active]:border-primary">
              <Wallet className="h-4 w-4 mr-1.5" /> Fundamentals
            </TabsTrigger>
            <TabsTrigger value="backtest" className="text-xs font-semibold h-11 rounded-none data-[state=active]:border-b-2 data-[state=active]:border-primary">
              <Bug className="h-4 w-4 mr-1.5" /> Backtest
            </TabsTrigger>
            <TabsTrigger value="technical" className="text-xs font-semibold h-11 rounded-none data-[state=active]:border-b-2 data-[state=active]:border-primary">
              <BarChart className="h-4 w-4 mr-1.5" /> Technical
            </TabsTrigger>
            <TabsTrigger value="report" className="text-xs font-semibold h-11 rounded-none data-[state=active]:border-b-2 data-[state=active]:border-primary">
              <FileText className="h-4 w-4 mr-1.5" /> Report
            </TabsTrigger>
          </TabsList>

          {/* TAB: Chart */}
          <TabsContent value="chart" className="pt-0">
            <div className="px-2.5 pb-2.5">
              <InteractiveChart ticker={data.ticker} backendPatterns={backendPatterns} />
            </div>
          </TabsContent>

          {/* TAB: Patterns (Chart + Candlestick) */}
          <TabsContent value="patterns" className="pt-0">
            <div className="px-2.5 pb-2.5">
              {/* Summary chips */}
              <div className="flex flex-wrap gap-1.5 mb-4">
                <Badge className="font-semibold bg-primary text-primary-foreground rounded-md">
                  {chartPatterns.length} Chart Patterns
                </Badge>
                <Badge className="font-semibold bg-secondary text-secondary-foreground rounded-md">
                  {candlestickPatterns.length} Candlestick Patterns
                </Badge>
                {csSummary.bullish > 0 && (
                  <Badge variant="outline" className="font-semibold rounded-md" style={{ backgroundColor: `${signalPair("strongBuy").bg}1a`, color: signalPair("strongBuy").bg, borderColor: signalPair("strongBuy").bg }}>
                    {csSummary.bullish} Bullish
                  </Badge>
                )}
                {csSummary.bearish > 0 && (
                  <Badge variant="outline" className="font-semibold rounded-md" style={{ backgroundColor: `${signalPair("strongSell").bg}1a`, color: signalPair("strongSell").bg, borderColor: signalPair("strongSell").bg }}>
                    {csSummary.bearish} Bearish
                  </Badge>
                )}
                <Badge className="font-bold rounded-md" style={signalStyle(convolutionScore >= 65 ? "strongBuy" : convolutionScore >= 45 ? "hold" : "strongSell")}>
                  Convolution: {convolutionScore}/100
                </Badge>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Chart Patterns */}
                <div>
                  <p className="text-xs font-bold text-primary uppercase tracking-wide block mb-2">
                    <TrendingUp className="h-3.5 w-3.5 inline mr-1 -mt-0.5" />
                    Chart Patterns
                  </p>
                  {chartPatterns.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-4 text-center">
                      No chart patterns detected in the current window
                    </p>
                  ) : (
                    chartPatterns.map((p, i) => (
                      <PatternRow key={`cp-${i}`} name={PATTERN_LABELS[p.type]?.full ?? p.type} confidence={p.confidence} direction={p.direction} type={p.status} status={p.status} entry={p.entry} stopLoss={p.stopLoss} target={p.target} riskReward={p.riskReward} confirmations={p.confirmations} />
                    ))
                  )}
                </div>

                {/* Candlestick Patterns */}
                <div>
                  <p className="text-xs font-bold text-primary uppercase tracking-wide block mb-2">
                    <CandlestickChart className="h-3.5 w-3.5 inline mr-1 -mt-0.5" />
                    Candlestick Patterns
                  </p>
                  {candlestickPatterns.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-4 text-center">
                      No candlestick patterns detected
                    </p>
                  ) : (
                    candlestickPatterns.map((p, i) => (
                      <PatternRow key={`cs-${i}`} name={p.name} confidence={p.confidence} direction={p.direction} type={p.category} />
                    ))
                  )}
                </div>
              </div>
            </div>
          </TabsContent>

          {/* TAB: Fundamentals */}
          <TabsContent value="fundamentals" className="pt-0">
            <div className="px-2.5 pb-2.5">
              {fundLoading ? (
                <div className="flex flex-col items-center py-4 gap-1">
                  <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                  <p className="text-xs text-muted-foreground">Loading fundamentals...</p>
                </div>
              ) : fundamentals ? (
                <>
                  {/* Overall % GOOD header */}
                  <div className="mb-4">
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <h3 className="text-sm font-bold">{fundamentals.name}</h3>
                        <p className="text-xs text-muted-foreground">{fundamentals.sector} · {fundamentals.industry}</p>
                      </div>
                      <div className="text-center">
                        <p className="text-2xl font-bold" style={{
                          color: fundamentals.overall?.score >= 75 ? signalHex("strongBuy") : fundamentals.overall?.score >= 60 ? signalHex("buy") : fundamentals.overall?.score >= 40 ? signalHex("hold") : signalHex("strongSell"),
                        }}>
                          {fundamentals.overall?.score ?? fundamentals.fundamental_score}
                        </p>
                        <p className="text-xs text-muted-foreground">Fund Score</p>
                      </div>
                    </div>

                    {/* Good / Neutral / Bad breakdown bar */}
                    {fundamentals.overall && (
                      <div className="rounded-lg border border-border p-2.5 bg-muted/30">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-[0.65rem] font-bold uppercase tracking-wide text-muted-foreground">
                            {fundamentals.overall.band} · {fundamentals.overall.confidence} confidence
                          </span>
                          <span className="text-[0.65rem] font-semibold text-muted-foreground">
                            {fundamentals.overall.good_pct}% Good · {fundamentals.overall.neutral_pct}% Neutral · {fundamentals.overall.bad_pct}% Bad
                          </span>
                        </div>
                        <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted">
                          <div className="bg-strong-buy" style={{ width: `${fundamentals.overall.good_pct}%` }} />
                          <div className="bg-hold" style={{ width: `${fundamentals.overall.neutral_pct}%` }} />
                          <div className="bg-strong-sell" style={{ width: `${fundamentals.overall.bad_pct}%` }} />
                        </div>
                        <div className="flex justify-between mt-1 text-[0.6rem] text-muted-foreground">
                          <span>{fundamentals.overall.good} good</span>
                          <span>{fundamentals.overall.neutral} neutral</span>
                          <span>{fundamentals.overall.bad} bad</span>
                          <span>{fundamentals.overall.na_data} no data</span>
                          <span>{fundamentals.overall.na_sector} n/a sector</span>
                        </div>
                      </div>
                    )}
                  </div>

                  <TooltipProvider>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Returns */}
                    <div>
                      <p className="text-xs font-bold text-strong-buy uppercase tracking-wide block mb-1">
                        Returns
                      </p>
                      <FundMetricRow label="ROIC" value={fmtPct(fundamentals.roic)} verdict={fundamentals.scorecard?.roic?.verdict ?? "N/A (data)"} explanation={METRIC_GLOSSARY.roic?.explanation} example={METRIC_GLOSSARY.roic?.example} />
                      <FundMetricRow label="ROE" value={fmtPct(fundamentals.roe)} verdict={fundamentals.scorecard?.roe?.verdict ?? "N/A (data)"} explanation={METRIC_GLOSSARY.roe?.explanation} example={METRIC_GLOSSARY.roe?.example} />
                      <FundMetricRow label="ROA" value={fmtPct(fundamentals.roa)} verdict={fundamentals.scorecard?.roa?.verdict ?? "N/A (data)"} explanation={METRIC_GLOSSARY.roa?.explanation} example={METRIC_GLOSSARY.roa?.example} />
                    </div>

                    {/* Profitability */}
                    <div>
                      <p className="text-xs font-bold text-strong-buy uppercase tracking-wide block mb-1">
                        Profitability
                      </p>
                      <FundMetricRow label="EBITDA" value={fmtCr(fundamentals.ebitda)} verdict={fundamentals.scorecard?.ebitda_margin?.verdict ?? "N/A (data)"} explanation={METRIC_GLOSSARY.ebitda?.explanation} example={METRIC_GLOSSARY.ebitda?.example} />
                      <FundMetricRow label="EBITDA Margin" value={fmtPct(fundamentals.ebitda_margin)} verdict={fundamentals.scorecard?.ebitda_margin?.verdict ?? "N/A (data)"} explanation={METRIC_GLOSSARY.ebitda_margin?.explanation} example={METRIC_GLOSSARY.ebitda_margin?.example} />
                      <FundMetricRow label="Gross Margin" value={fmtPct(fundamentals.gross_margin)} verdict={fundamentals.scorecard?.gross_margin?.verdict ?? "N/A (data)"} explanation={METRIC_GLOSSARY.gross_margin?.explanation} example={METRIC_GLOSSARY.gross_margin?.example} />
                      <FundMetricRow label="Operating Margin" value={fmtPct(fundamentals.operating_margin)} verdict={fundamentals.scorecard?.operating_margin?.verdict ?? "N/A (data)"} explanation={METRIC_GLOSSARY.operating_margin?.explanation} example={METRIC_GLOSSARY.operating_margin?.example} />
                      <FundMetricRow label="Net Profit Margin" value={fmtPct(fundamentals.profit_margin)} verdict={fundamentals.scorecard?.profit_margin?.verdict ?? "N/A (data)"} explanation={METRIC_GLOSSARY.profit_margin?.explanation} example={METRIC_GLOSSARY.profit_margin?.example} />
                      <FundMetricRow label="Revenue" value={fmtCr(fundamentals.revenue)} verdict="—" explanation={METRIC_GLOSSARY.revenue?.explanation} example={METRIC_GLOSSARY.revenue?.example} />
                      <FundMetricRow label="Net Income" value={fmtCr(fundamentals.net_income)} verdict="—" explanation={METRIC_GLOSSARY.net_income?.explanation} example={METRIC_GLOSSARY.net_income?.example} />
                    </div>

                    {/* Growth */}
                    <div>
                      <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide block mb-1">
                        Growth
                      </p>
                      <FundMetricRow label="Revenue Growth" value={fmtPct(fundamentals.revenue_growth)} verdict={fundamentals.scorecard?.revenue_growth?.verdict ?? "N/A (data)"} explanation={METRIC_GLOSSARY.revenue_growth?.explanation} example={METRIC_GLOSSARY.revenue_growth?.example} />
                      <FundMetricRow label="Earnings Growth" value={fmtPct(fundamentals.earnings_growth)} verdict={fundamentals.scorecard?.earnings_growth?.verdict ?? "N/A (data)"} explanation={METRIC_GLOSSARY.earnings_growth?.explanation} example={METRIC_GLOSSARY.earnings_growth?.example} />
                      <FundMetricRow label="Revenue / Share" value={fmtNum(fundamentals.revenue_per_share)} verdict="—" explanation={METRIC_GLOSSARY.revenue_per_share?.explanation} example={METRIC_GLOSSARY.revenue_per_share?.example} />
                    </div>

                    {/* Valuation */}
                    <div>
                      <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide block mb-1">
                        Valuation
                      </p>
                      <FundMetricRow label="Market Cap" value={fmtCr(fundamentals.market_cap)} verdict="—" explanation={METRIC_GLOSSARY.market_cap?.explanation} example={METRIC_GLOSSARY.market_cap?.example} />
                      <FundMetricRow label="P/E (Trail)" value={fmtNum(fundamentals.pe_trailing)} verdict={fundamentals.scorecard?.pe_trailing?.verdict ?? "N/A (data)"} explanation={METRIC_GLOSSARY.pe_trailing?.explanation} example={METRIC_GLOSSARY.pe_trailing?.example} />
                      <FundMetricRow label="P/E (Forward)" value={fmtNum(fundamentals.pe_forward)} verdict="—" explanation={METRIC_GLOSSARY.eps_forward?.explanation} example={METRIC_GLOSSARY.eps_forward?.example} />
                      <FundMetricRow label="P/B" value={fmtNum(fundamentals.pb_ratio)} verdict={fundamentals.scorecard?.pb_ratio?.verdict ?? "N/A (data)"} explanation={METRIC_GLOSSARY.pb_ratio?.explanation} example={METRIC_GLOSSARY.pb_ratio?.example} />
                      <FundMetricRow label="P/S" value={fmtNum(fundamentals.ps_ratio)} verdict={fundamentals.scorecard?.ps_ratio?.verdict ?? "N/A (data)"} explanation={METRIC_GLOSSARY.ps_ratio?.explanation} example={METRIC_GLOSSARY.ps_ratio?.example} />
                      <FundMetricRow label="EV/EBITDA" value={fmtNum(fundamentals.ev_to_ebitda)} verdict={fundamentals.scorecard?.ev_to_ebitda?.verdict ?? "N/A (data)"} explanation={METRIC_GLOSSARY.ev_to_ebitda?.explanation} example={METRIC_GLOSSARY.ev_to_ebitda?.example} />
                      <FundMetricRow label="PEG" value={fmtNum(fundamentals.peg_ratio)} verdict="—" explanation={METRIC_GLOSSARY.peg_ratio?.explanation} example={METRIC_GLOSSARY.peg_ratio?.example} />
                    </div>

                    {/* Leverage & Liquidity */}
                    <div>
                      <p className="text-xs font-bold text-hold uppercase tracking-wide block mb-1">
                        Leverage & Liquidity
                      </p>
                      <FundMetricRow label="Debt/Equity" value={fmtRatio(fundamentals.debt_to_equity)} verdict={fundamentals.scorecard?.debt_to_equity?.verdict ?? "N/A (data)"} explanation={METRIC_GLOSSARY.debt_to_equity?.explanation} example={METRIC_GLOSSARY.debt_to_equity?.example} />
                      <FundMetricRow label="Total Debt" value={fmtCr(fundamentals.total_debt)} verdict="—" explanation={METRIC_GLOSSARY.total_debt?.explanation} example={METRIC_GLOSSARY.total_debt?.example} />
                      <FundMetricRow label="Total Cash" value={fmtCr(fundamentals.total_cash)} verdict="—" explanation={METRIC_GLOSSARY.total_cash?.explanation} example={METRIC_GLOSSARY.total_cash?.example} />
                      <FundMetricRow label="Current Ratio" value={fmtRatio(fundamentals.current_ratio)} verdict="—" explanation={METRIC_GLOSSARY.current_ratio?.explanation} example={METRIC_GLOSSARY.current_ratio?.example} />
                      <FundMetricRow label="Free Cash Flow" value={fmtCr(fundamentals.free_cash_flow)} verdict={fundamentals.scorecard?.free_cash_flow?.verdict ?? "N/A (data)"} explanation={METRIC_GLOSSARY.free_cash_flow?.explanation} example={METRIC_GLOSSARY.free_cash_flow?.example} />
                      <FundMetricRow label="Book Value" value={fundamentals.book_value ? `₹${fundamentals.book_value.toFixed(0)}` : "—"} verdict="—" explanation={METRIC_GLOSSARY.book_value?.explanation} example={METRIC_GLOSSARY.book_value?.example} />
                    </div>

                    {/* Dividends & Risk */}
                    <div>
                      <p className="text-xs font-bold text-hold uppercase tracking-wide block mb-1">
                        Dividends & Risk
                      </p>
                      <FundMetricRow label="Dividend Yield" value={fundamentals.dividend_yield ? `${fundamentals.dividend_yield.toFixed(2)}%` : "—"} verdict={fundamentals.scorecard?.dividend_yield?.verdict ?? "N/A (data)"} explanation={METRIC_GLOSSARY.dividend_yield?.explanation} example={METRIC_GLOSSARY.dividend_yield?.example} />
                      <FundMetricRow label="Payout Ratio" value={fmtPct(fundamentals.payout_ratio)} verdict="—" explanation={METRIC_GLOSSARY.payout_ratio?.explanation} example={METRIC_GLOSSARY.payout_ratio?.example} />
                      <FundMetricRow label="Beta" value={fmtNum(fundamentals.beta)} verdict={fundamentals.scorecard?.beta?.verdict ?? "N/A (data)"} explanation={METRIC_GLOSSARY.beta?.explanation} example={METRIC_GLOSSARY.beta?.example} />
                      <FundMetricRow label="EPS (Trail)" value={fmtNum(fundamentals.eps_trailing)} verdict="—" explanation={METRIC_GLOSSARY.eps_trailing?.explanation} example={METRIC_GLOSSARY.eps_trailing?.example} />
                      <FundMetricRow label="EPS (Forward)" value={fmtNum(fundamentals.eps_forward)} verdict="—" explanation={METRIC_GLOSSARY.eps_forward?.explanation} example={METRIC_GLOSSARY.eps_forward?.example} />
                    </div>

                    {/* Analyst & Market */}
                    <div>
                      <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide block mb-1">
                        Analyst & Market
                      </p>
                      <FundMetricRow label="Analyst Target" value={fundamentals.analyst_target ? `₹${fundamentals.analyst_target.toFixed(0)}` : "—"} verdict="—" explanation={METRIC_GLOSSARY.analyst_target?.explanation} example={METRIC_GLOSSARY.analyst_target?.example} />
                      <FundMetricRow label="Target Range" value={fundamentals.target_low && fundamentals.target_high ? `₹${fundamentals.target_low.toFixed(0)}–₹${fundamentals.target_high.toFixed(0)}` : "—"} verdict="—" explanation={METRIC_GLOSSARY.target_range?.explanation} example={METRIC_GLOSSARY.target_range?.example} />
                      <FundMetricRow label="Analyst Upside" value={fmtPct(fundamentals.analyst_upside)} verdict={fundamentals.scorecard?.analyst_upside?.verdict ?? "N/A (data)"} explanation={METRIC_GLOSSARY.analyst_upside?.explanation} example={METRIC_GLOSSARY.analyst_upside?.example} />
                      <FundMetricRow label="Recommendation" value={fundamentals.analyst_recommendation || "—"} verdict="—" explanation={METRIC_GLOSSARY.recommendation?.explanation} example={METRIC_GLOSSARY.recommendation?.example} />
                      <FundMetricRow label="52W High" value={fundamentals.fifty_two_week_high ? `₹${fundamentals.fifty_two_week_high.toFixed(0)}` : "—"} verdict="—" explanation={METRIC_GLOSSARY.fifty_two_week_high?.explanation} example={METRIC_GLOSSARY.fifty_two_week_high?.example} />
                      <FundMetricRow label="52W Low" value={fundamentals.fifty_two_week_low ? `₹${fundamentals.fifty_two_week_low.toFixed(0)}` : "—"} verdict="—" explanation={METRIC_GLOSSARY.fifty_two_week_low?.explanation} example={METRIC_GLOSSARY.fifty_two_week_low?.example} />
                    </div>

                    {/* Ownership */}
                    <div>
                      <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide block mb-1">
                        Ownership
                      </p>
                      <FundMetricRow label="Insider Holding" value={fmtPct(fundamentals.held_by_insiders)} verdict={fundamentals.scorecard?.held_by_insiders?.verdict ?? "N/A (data)"} explanation={METRIC_GLOSSARY.held_by_insiders?.explanation} example={METRIC_GLOSSARY.held_by_insiders?.example} />
                      <FundMetricRow label="Institutional Holding" value={fmtPct(fundamentals.held_by_institutions)} verdict={fundamentals.scorecard?.held_by_institutions?.verdict ?? "N/A (data)"} explanation={METRIC_GLOSSARY.held_by_institutions?.explanation} example={METRIC_GLOSSARY.held_by_institutions?.example} />
                      <FundMetricRow label="Avg Volume" value={fundamentals.avg_volume ? `${(fundamentals.avg_volume / 1e6).toFixed(1)}M` : "—"} verdict="—" explanation={METRIC_GLOSSARY.avg_volume?.explanation} example={METRIC_GLOSSARY.avg_volume?.example} />
                    </div>
                  </div>
                  </TooltipProvider>
                </>
              ) : (
                <div className="text-center py-4">
                  <p className="text-sm text-muted-foreground mb-2">Click to load fundamental data</p>
                  <Button variant="outline" size="sm" onClick={fetchFundamentals}>
                    Load Fundamentals
                  </Button>
                </div>
              )}
            </div>
          </TabsContent>

          {/* TAB: Backtest */}
          <TabsContent value="backtest" className="pt-0">
            <div className="px-2.5 pb-2.5">
              {/* Controls */}
              <div className="flex flex-col sm:flex-row gap-3 mb-4">
                <div className="relative min-w-[180px]">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    value={btTicker}
                    onChange={(e) => setBtTicker(e.target.value)}
                    placeholder="Ticker (e.g. HDFCBANK)"
                    className="pl-8 text-[0.85rem]"
                  />
                </div>
                <Input
                  type="number"
                  placeholder="Min Confidence"
                  value={btMinConf}
                  onChange={(e) => setBtMinConf(Number(e.target.value))}
                  className="w-[130px] text-[0.85rem]"
                />
                <Button
                  onClick={runBacktest}
                  disabled={btLoading || !btTicker.trim()}
                  className="font-semibold gap-2"
                >
                  {btLoading ? <div className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" /> : <Bug className="h-4 w-4" />}
                  {btLoading ? "Running..." : "Run Backtest"}
                </Button>
              </div>

              {btError && (
                <div className="border-l-4 border-strong-sell bg-strong-sell/10 p-3 rounded mb-4 text-sm text-strong-sell">{btError}</div>
              )}

              {btLoading && (
                <div className="mb-4">
                  <Progress value={50} className="h-1.5 rounded-full" />
                  <p className="text-xs text-muted-foreground block mt-1 text-center">
                    Running pattern backtest on 2 years of data...
                  </p>
                </div>
              )}

              {/* Results */}
              {btResult && (
                <>
                  {/* Summary cards */}
                  <div className="flex flex-wrap gap-2 mb-4">
                    {[
                      { label: "Signal", value: (btResult.win_rate ?? 0) >= 55 ? "BUY" : (btResult.win_rate ?? 0) <= 45 ? "SELL" : "HOLD", color: (btResult.win_rate ?? 0) >= 55 ? signalHex("strongBuy") : (btResult.win_rate ?? 0) <= 45 ? signalHex("strongSell") : signalHex("hold") },
                      { label: "Trades", value: String(btResult.total_trades), color: "var(--foreground)" },
                      { label: "Wins", value: String(btResult.wins), color: signalHex("strongBuy") },
                      { label: "Losses", value: String(btResult.losses), color: signalHex("strongSell") },
                      { label: "Win Rate", value: `${(btResult.win_rate ?? 0).toFixed(1)}%`, color: (btResult.win_rate ?? 0) >= 55 ? signalHex("strongBuy") : signalHex("strongSell") },
                      { label: "Total R", value: (btResult.total_r ?? 0) >= 0 ? `+${(btResult.total_r ?? 0).toFixed(2)}R` : `${(btResult.total_r ?? 0).toFixed(2)}R`, color: (btResult.total_r ?? 0) >= 0 ? signalHex("strongBuy") : signalHex("strongSell") },
                      { label: "Avg Win", value: `+${(btResult.avg_win_r ?? 0).toFixed(2)}R`, color: signalHex("strongBuy") },
                      { label: "Avg Loss", value: `${(btResult.avg_loss_r ?? 0).toFixed(2)}R`, color: signalHex("strongSell") },
                    ].map((item, i) => (
                      <Card key={i} className="flex-1 min-w-[120px] border-border">
                        <CardContent className="p-1.5 text-center">
                          <p className="text-[0.6rem] uppercase tracking-wider text-muted-foreground">{item.label}</p>
                          <p className="text-base font-bold" style={{ color: item.color }}>{item.value}</p>
                        </CardContent>
                      </Card>
                    ))}
                  </div>

                  {/* Per-pattern breakdown */}
                  {Object.keys(btResult.per_pattern).length > 0 && (
                    <>
                      <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide block mb-2">
                        Per-Pattern Performance
                      </p>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                        {Object.entries(btResult.per_pattern).sort(([, a], [, b]) => (b.count ?? 0) - (a.count ?? 0)).map(([name, stats]) => (
                          <Card key={name} className="bg-muted/50 border-border">
                            <CardContent className="p-1.5">
                              <div className="flex justify-between mb-1">
                                <p className="text-xs font-bold text-[0.75rem]">{name}</p>
                                <Badge variant="secondary" className="h-4 text-[0.6rem]">{stats.count ?? 0}</Badge>
                              </div>
                              <div className="flex gap-4">
                                <div>
                                  <p className="text-[0.55rem] text-muted-foreground">Win%</p>
                                  <p className="text-xs font-semibold" style={{ color: (stats.win_rate ?? 0) >= 55 ? signalHex("strongBuy") : signalHex("strongSell") }}>
                                    {(stats.win_rate ?? 0).toFixed(1)}%
                                  </p>
                                </div>
                                <div>
                                  <p className="text-[0.55rem] text-muted-foreground">Avg R</p>
                                  <p className="text-xs font-semibold" style={{ color: (stats.avg_r ?? 0) >= 0 ? signalHex("strongBuy") : signalHex("strongSell") }}>
                                    {(stats.avg_r ?? 0) >= 0 ? "+" : ""}{(stats.avg_r ?? 0).toFixed(2)}
                                  </p>
                                </div>
                                <div>
                                  <p className="text-[0.55rem] text-muted-foreground">Total R</p>
                                  <p className="text-xs font-semibold">
                                    {(stats.total_r ?? 0) >= 0 ? "+" : ""}{(stats.total_r ?? 0).toFixed(2)}
                                  </p>
                                </div>
                              </div>
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    </>
                  )}

                  {/* Note */}
                  {btResult.note && (
                    <div className="border-l-4 border-border bg-muted/50 p-3 rounded mt-4 text-sm text-muted-foreground">{btResult.note}</div>
                  )}
                </>
              )}

              {!btResult && !btLoading && !btError && (
                <div className="text-center py-12 text-muted-foreground">
                  <Bug className="h-10 w-10 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">Enter a ticker and click "Run Backtest" to see pattern-based trading results</p>
                </div>
              )}
            </div>
          </TabsContent>

          {/* TAB: Technical Dashboard */}
          <TabsContent value="technical" className="pt-0">
            <div className="px-2.5 pb-2.5">
              <IndicatorDashboard
                indicators={data.indicators as any}
                trend={data.trend as any}
                evidence={qm.evidence}
                marketStructure={data.market_structure}
                price={data.price}
                ticker={data.ticker}
                signal={data.signal}
              />
            </div>
          </TabsContent>

          {/* TAB: Report */}
          <TabsContent value="report" className="pt-0">
            <div className="px-2.5 pb-2.5">
              {/* Humanised document */}
              <div className="p-6 mb-4 rounded-lg border border-border bg-muted/30 font-['Inter',monospace] text-[0.8125rem] leading-7 whitespace-pre-wrap">
                {humanisedDoc}
              </div>

              {/* Weighted Convolution breakdown (2026-09-05) */}
              {data.conv_technical?.components && (
                <Card className="mb-4 border-border">
                  <CardContent className="p-2.5">
                    <div className="flex items-center mb-2 gap-2">
                      <Gauge className="h-4 w-4 text-muted-foreground" />
                      <h3 className="text-sm font-bold">Weighted Convolution</h3>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
                      <div className="rounded-lg border border-border p-2">
                        <p className="text-[0.65rem] uppercase tracking-wide text-muted-foreground">Tech Conv</p>
                        <p className="text-xl font-bold" style={{ color: (data.conv_technical.score ?? 0) >= 65 ? signalHex("strongBuy") : signalHex("hold") }}>
                          {data.conv_technical.score?.toFixed(0)}
                          <span className="text-xs font-normal text-muted-foreground">/100</span>
                        </p>
                        <p className="text-[0.65rem] text-muted-foreground">
                          {data.conv_technical.score != null && data.conv_technical.score >= 60 ? "Passes BUY floor" : "Below BUY floor (60)"}
                        </p>
                      </div>
                      <div className="rounded-lg border border-border p-2">
                        <p className="text-[0.65rem] uppercase tracking-wide text-muted-foreground">Fund Conv</p>
                        <p className="text-xl font-bold" style={{ color: (data.conv_fundamental?.score ?? 0) >= 65 ? signalHex("strongBuy") : signalHex("hold") }}>
                          {data.conv_fundamental?.score?.toFixed(0)}
                          <span className="text-xs font-normal text-muted-foreground">/100</span>
                        </p>
                        <p className="text-[0.65rem] text-muted-foreground">
                          {data.conv_fundamental?.cap_applied ? "Capped (weak factor)" : "Weighted factors"}
                        </p>
                      </div>
                      <div className="rounded-lg border border-border p-2">
                        <p className="text-[0.65rem] uppercase tracking-wide text-muted-foreground">Pattern Vote</p>
                        <p className="text-xl font-bold" style={{ color: data.conv_technical.pattern_majority ? signalHex("strongBuy") : signalHex("sell") }}>
                          {data.conv_technical.pattern_majority ? "Bullish" : "Bearish"}
                        </p>
                        <p className="text-[0.65rem] text-muted-foreground">
                          {(() => {
                            const pv = data.conv_technical?.pattern_votes as any;
                            if (!pv) return "No patterns";
                            return `Bull ${pv.bull_weight ?? 0} · Bear ${pv.bear_weight ?? 0}`;
                          })()}
                        </p>
                      </div>
                      <div className="rounded-lg border border-border p-2">
                        <p className="text-[0.65rem] uppercase tracking-wide text-muted-foreground">Blend Weights</p>
                        <p className="text-xl font-bold">
                          {Math.round((qm.weights?.technical ?? 0.5) * 100)}/{Math.round((qm.weights?.fundamental ?? 0.5) * 100)}
                        </p>
                        <p className="text-[0.65rem] text-muted-foreground">Tech/Fund (50/50 base)</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                      {Object.entries(data.conv_technical.components).map(([key, comp]) => {
                        const c = comp as any;
                        const score = typeof c.score === "number" ? c.score : 0;
                        const weight = typeof c.weight === "number" ? c.weight : 0;
                        return (
                          <div key={key} className="flex items-center justify-between rounded-md border border-border/60 px-2 py-1.5">
                            <span className="text-[0.7rem] capitalize text-muted-foreground">{key}</span>
                            <span className="text-[0.7rem] font-semibold font-mono" style={{ color: score >= 0 ? signalHex("strongBuy") : signalHex("strongSell") }}>
                              {score >= 0 ? "+" : ""}{score.toFixed(1)}
                              <span className="text-muted-foreground font-normal">/{weight}</span>
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Support & Resistance */}
              {data.support_resistance && (
                <Card className="mb-4 border-border">
                  <CardContent className="p-2.5">
                    <div className="flex items-center mb-2 gap-2">
                      <Landmark className="h-4 w-4 text-muted-foreground" />
                      <h3 className="text-sm font-bold">Support & Resistance</h3>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-xs font-semibold text-strong-buy mb-2 block">Support</p>
                        {(Array.isArray((data.support_resistance as any).support)
                          ? (data.support_resistance as any).support.slice(0, 5) : []
                        ).map((s: any, i: number) => (
                          <div key={i} className="flex justify-between py-1 border-b border-border">
                            <span className="text-xs text-muted-foreground">{s.type || `L${i + 1}`}</span>
                            <span className="text-xs font-semibold font-mono">{formatPrice(s.price || 0, data.ticker)}</span>
                          </div>
                        ))}
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-strong-sell mb-2 block">Resistance</p>
                        {(Array.isArray((data.support_resistance as any).resistance)
                          ? (data.support_resistance as any).resistance.slice(0, 5) : []
                        ).map((r: any, i: number) => (
                          <div key={i} className="flex justify-between py-1 border-b border-border">
                            <span className="text-xs text-muted-foreground">{r.type || `L${i + 1}`}</span>
                            <span className="text-xs font-semibold font-mono">{formatPrice(r.price || 0, data.ticker)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Raw report */}
              {data.report_text && (
                <Card className="border-border">
                  <CardContent className="p-2.5">
                    <h3 className="text-sm font-bold mb-2">Detailed Report</h3>
                    <pre className="text-xs font-mono bg-muted p-4 rounded max-h-[400px] overflow-auto whitespace-pre-wrap">
                      {data.report_text.slice(0, 5000)}
                      {data.report_text.length > 5000 && "\n\n... (truncated)"}
                    </pre>
                  </CardContent>
                </Card>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </Card>
      </FadeIn>

      {/* Footer */}
      <div className="flex items-center justify-between pt-4 pb-8 border-t border-border mt-2">
        <span className="text-xs text-muted-foreground">VijayMaruthi Wealth Management v4.0</span>
        <Button variant="ghost" size="sm" onClick={fetchAnalysis} className="gap-2">
          <RefreshCw className="h-4 w-4" /> Refresh Analysis
        </Button>
      </div>
    </div>
  );
}
