/**
 * Humaniser — converts raw quantamental analysis data into
 * plain-English, human-readable text.
 *
 * No jargon, no raw numbers dumped on the user. Just clear,
 * actionable language.
 */

// ─── Helpers (hoisted — defined first) ───

/** Safely get a number value, defaulting to 0 */
function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** Safely get a string value */
function str(v: unknown, fallback = ""): string {
  return v != null ? String(v) : fallback;
}

// ─── Currency helpers ───

/** Detect if a ticker trades in ₹ (NSE/BSE) */
export function isIndianTicker(ticker: string): boolean {
  return ticker.endsWith(".NS") || ticker.endsWith(".BO");
}

/** Approximate USD→INR rate (kept updated or use live) */
const USD_INR_RATE = 83.5;

/** Format price in ₹ or $ with human-readable rounding */
export function formatPrice(price: unknown, ticker: string): string {
  const p = num(price);
  if (p <= 0 || !Number.isFinite(p)) return "N/A";
  if (isIndianTicker(ticker)) {
    return `₹${formatIndianNumber(p)}`;
  }
  // Show both currencies for US tickers
  const inr = p * USD_INR_RATE;
  return `$${p.toFixed(2)}  (≈ ₹${formatIndianNumber(inr)})`;
}

/** Format large Indian numbers (lakh, crore) */
export function formatIndianNumber(n: number): string {
  if (n >= 10_000_000) return `${(n / 10_000_000).toFixed(2)} Cr`;
  if (n >= 100_000) return `${(n / 100_000).toFixed(2)} L`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(2);
}

// ─── Humanised signal ───

const SIGNAL_LABELS: Record<string, { label: string; emoji: string; color: string }> = {
  BUY: { label: "Can Buy ✅", emoji: "✅", color: "text-green-400" },
  "CAUTIOUS BUY": { label: "Can Buy — but be careful ⚠️", emoji: "⚠️", color: "text-yellow-400" },
  HOLD: { label: "Hold for now ⏸️", emoji: "⏸️", color: "text-yellow-400" },
  SELL: { label: "Time to Sell ❌", emoji: "❌", color: "text-red-400" },
  "CAUTIOUS SELL": { label: "Consider Selling ⚠️", emoji: "⚠️", color: "text-red-400" },
};

export function humaniseSignal(signal: string): string {
  return SIGNAL_LABELS[signal]?.label ?? `Signal: ${signal}`;
}

// ─── Humanised verdict ───

interface VerdictInput {
  signal: string;
  confidence: number;
  price: number;
  ticker: string;
  techSignal: string;
  techScore: number;
  fundRating: string;
  fundScore: number;
  blendedRating: string;
  blendedScore: number;
  marketStructure?: Record<string, unknown>;
  trend?: Record<string, unknown>;
  evidence?: { technical: string[]; fundamental: string[] };
  capCategory?: string;
  weightAdjustments?: string[];
}

/** Generate a short, punchy one-line verdict for the list view */
export function shortVerdict(input: VerdictInput): string {
  const name = str(input.ticker).replace(".NS", "").replace(".BO", "");
  const signal = str(input.signal);
  const confidence = num(input.confidence);
  const blendedScore = num(input.blendedScore);
  const techScore = num(input.techScore);
  const fundScore = num(input.fundScore);
  const fundRating = str(input.fundRating);
  const techSignal = str(input.techSignal);

  if (signal === "BUY" || signal === "CAUTIOUS BUY") {
    const reasons: string[] = [];
    if (fundRating === "Buy" || fundRating === "Strong Buy") reasons.push("strong fundamentals");
    else if (techSignal === "BUY") reasons.push("good technical setup");
    else reasons.push("decent overall score");

    return `${name} — looking good for buying. ${reasons.join(" and ")}. Confidence ${confidence.toFixed(0)}%.`;
  }

  if (signal === "SELL" || signal === "CAUTIOUS SELL") {
    return `${name} — better to exit or avoid. Score ${blendedScore.toFixed(0)}/100 suggests weakness. Consider reducing exposure.`;
  }

  // HOLD
  const strengths: string[] = [];
  const weaknesses: string[] = [];
  if (fundScore > 60) strengths.push("decent fundamentals");
  else weaknesses.push("fundamentals could be better");
  if (techScore > 60) strengths.push("okay technicals");
  else weaknesses.push("technicals not fully supporting");

  const strengthText = strengths.length ? strengths.join(" and ") + ", but" : "";
  const weaknessText = weaknesses.join(" and ");

  return `${name} — hold for now. ${strengthText} ${weaknessText}. Score ${blendedScore.toFixed(0)}/100 — not strong enough to buy, not weak enough to sell.`;
}

/** Generate a full analysis document in plain English */
export function fullAnalysisDocument(input: VerdictInput): string {
  const name = str(input.ticker).replace(".NS", "").replace(".BO", "");
  const priceStr = formatPrice(input.price, input.ticker);
  const sig = str(input.signal);
  const signalInfo = SIGNAL_LABELS[sig] ?? { label: sig || "N/A", emoji: "📊", color: "" };
  const confidence = num(input.confidence);
  const blendedScore = num(input.blendedScore);
  const techScore = num(input.techScore);
  const fundScore = num(input.fundScore);
  const techSig = str(input.techSignal);
  const fundRat = str(input.fundRating);
  const blendRat = str(input.blendedRating);
  const capCat = str(input.capCategory);

  const sections: string[] = [];

  // ── Header ──
  sections.push(
    `📄 Analysis Report: ${name}`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `Current Price: ${priceStr}`,
    `Verdict: ${signalInfo.emoji} ${signalInfo.label}`,
    `Confidence: ${confidence.toFixed(0)}%`,
    `Overall Score: ${blendedScore.toFixed(0)}/100`,
    ``,
  );

  // ── Executive Summary ──
  sections.push(`📋 Executive Summary`);
  sections.push(shortVerdict(input), ``);

  // ── Technical Summary ──
  const techEvidence = input.evidence?.technical;
  if (techEvidence && techEvidence.length > 0) {
    sections.push(`📈 Technical Analysis — In Plain English`);
    sections.push(
      techEvidence.map((item) => `  • ${String(item).replace(/^[A-Z]{3,6}\s/, "").toLowerCase()}`).join("\n"),
      ``,
    );
  }

  // ── Fundamental Summary ──
  const fundEvidence = input.evidence?.fundamental;
  if (fundEvidence && fundEvidence.length > 0) {
    sections.push(`🏢 Fundamentals — What This Means`);
    sections.push(
      fundEvidence.map((item) => `  • ${String(item).toLowerCase()}`).join("\n"),
      ``,
    );
  }

  // ── Scores Breakdown ──
  sections.push(`📊 Score Breakdown`);
  sections.push(
    `  Technical Score: ${techScore.toFixed(0)}/100  →  ${techSig}`,
    `  Fundamental Score: ${fundScore.toFixed(0)}/100  →  ${fundRat}`,
    `  Blended: ${blendedScore.toFixed(0)}/100  →  ${blendRat}`,
    ``,
  );

  // ── Weight Adjustments ──
  const adjustments = input.weightAdjustments;
  if (adjustments && adjustments.length > 0) {
    sections.push(`🔧 Special Adjustments Made`);
    sections.push(adjustments.map((adj) => `  • ${adj}`).join("\n"), ``);
  }

  // ── Market Context ──
  if (input.marketStructure) {
    const ms = input.marketStructure;
    const trend = str((ms as any).trend || (ms as any).direction || "mixed");
    sections.push(`🌐 Market Context`);
    sections.push(
      `  The stock is in a ${trend} phase.${capCat ? ` It's a ${capCat}-cap company.` : ""}`,
      ``,
    );
  }

  // ── What Should You Do? ──
  sections.push(`🎯 What Should You Do?`);
  if (sig === "BUY") {
    sections.push(
      `  This stock looks ready for buying. The combination of technical and fundamental`,
      `  factors is favourable. You can consider adding it to your portfolio with proper`,
      `  position sizing. Keep a stop-loss in place to manage downside risk.`,
    );
  } else if (sig === "CAUTIOUS BUY") {
    sections.push(
      `  The stock shows some promise but not all signals align. If you're already`,
      `  following it, this could be an entry point — but only with a smaller position`,
      `  size and a tight stop-loss.`,
    );
  } else if (sig === "HOLD") {
    sections.push(
      `  No urgent action needed. If you already own this stock, hold onto it.`,
      `  If you don't, wait for a clearer signal. The score isn't compelling enough`,
      `  to buy right now, but not weak enough to sell.`,
    );
  } else {
    sections.push(
      `  Consider reducing or exiting your position. The analysis suggests the stock`,
      `  is facing headwinds. It may be better to deploy capital elsewhere.`,
    );
  }
  sections.push(``);

  // ── Footer ──
  sections.push(
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `Generated by VijayMaruthi Wealth Management v4.0`,
    `This is an AI-assisted analysis. Always do your own research.`,
  );

  return sections.join("\n");
}

/** Generate a risk assessment in plain language */
export function humanisedRisk(input: VerdictInput): string {
  const score = num(input.blendedScore);
  if (score >= 75) return "Low Risk — the stock shows strong health across both technical and fundamental factors.";
  if (score >= 55) return "Moderate Risk — some areas are strong, others need watching. Manage position size.";
  return "Higher Risk — multiple signals are weak. Consider avoiding until conditions improve.";
}

/** Generate a company description from available data */
export function companyDescription(fundamentals: Record<string, unknown>): string {
  if (!fundamentals || Object.keys(fundamentals).length === 0) return "";
  const meta = fundamentals.metadata as Record<string, unknown> || {};
  const qr = fundamentals.quick_ratings as Record<string, string> || {};
  const name = String(meta.company_name || meta.shortName || "");
  const sector = String(meta.sector || meta.industry || "");
  const parts: string[] = [];
  if (name) parts.push(name);
  if (sector) parts.push(`(${sector})`);
  return parts.join(" ");
}
