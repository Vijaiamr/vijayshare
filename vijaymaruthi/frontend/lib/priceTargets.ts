/**
 * Price Target Calculator — computes entry, targets, and stop-loss
 * from the existing support/resistance and ATR data.
 */

export interface PriceTargets {
  /** Current market price */
  currentPrice: number;
  /** Suggested entry price */
  entry: number;
  /** Short-term target (first resistance above price for Buy, first support below for Sell) */
  target1: number;
  target1Label: string;
  /** Medium-term target (second resistance/support if available) */
  target2: number | null;
  target2Label: string | null;
  /** Stop loss level */
  stopLoss: number;
  stopLossLabel: string;
  /** Upside percentage from entry to target1 */
  upsidePct: number;
  /** Downside percentage from entry to stop loss */
  downsidePct: number;
  /** Total potential upside (target2 if available, else target1) */
  totalUpsidePct: number;
  /** Risk:Reward ratio (upside / downside) */
  riskReward: number;
  /** ATR-based expected daily move */
  atrValue: number | null;
  atrPct: number | null;
  /** Signal direction */
  direction: "BUY" | "SELL" | "HOLD";
}

interface SRLevel {
  price: number;
  strength?: string;
  distance_pct?: number;
}

interface SupportResistance {
  support?: SRLevel[];
  resistance?: SRLevel[];
}

interface IndicatorATC {
  atr?: number;
  percent_of_price?: number;
}

/**
 * Compute price targets from support/resistance + ATR data.
 */
export function computePriceTargets(
  price: number,
  signal: "BUY" | "HOLD" | "SELL",
  sr: SupportResistance | null,
  atrData: IndicatorATC | null,
): PriceTargets {
  const currentPrice = price;

  // Default fallback targets when no S/R data
  const defaultTarget = {
    entry: currentPrice,
    target1: currentPrice,
    target1Label: "N/A",
    target2: null as number | null,
    target2Label: null as string | null,
    stopLoss: currentPrice,
    stopLossLabel: "N/A",
    upsidePct: 0,
    downsidePct: 0,
    totalUpsidePct: 0,
    riskReward: 0,
    atrValue: null as number | null,
    atrPct: null as number | null,
  };

  if (!sr) {
    return {
      currentPrice,
      direction: signal,
      ...defaultTarget,
    };
  }

  const supportLevels: SRLevel[] = Array.isArray(sr.support) ? sr.support : [];
  const resistanceLevels: SRLevel[] = Array.isArray(sr.resistance) ? sr.resistance : [];

  // Find nearest support below current price
  const supportsBelow = supportLevels
    .filter((s) => s.price < currentPrice)
    .sort((a, b) => b.price - a.price); // closest first
  const s1 = supportsBelow.length > 0 ? supportsBelow[0] : null;
  const s2 = supportsBelow.length > 1 ? supportsBelow[1] : null;

  // Find nearest resistance above current price
  const resistancesAbove = resistanceLevels
    .filter((r) => r.price > currentPrice)
    .sort((a, b) => a.price - b.price); // closest first
  const r1 = resistancesAbove.length > 0 ? resistancesAbove[0] : null;
  const r2 = resistancesAbove.length > 1 ? resistancesAbove[1] : null;

  // ATR
  const atrValue = atrData?.atr ?? null;
  const atrPct = atrData?.percent_of_price ?? null;

  if (signal === "BUY") {
    // Entry = current price (market buy)
    const entry = currentPrice;
    const target1 = r1 ? r1.price : currentPrice * (1 + (atrPct ? atrPct / 100 * 2 : 0.02));
    const target1Label = r1 ? `R1${r1.strength ? ` (${r1.strength})` : ""}` : "ATR × 2";
    const target2 = r2 ? r2.price : null;
    const target2Label = r2 ? `R2${r2.strength ? ` (${r2.strength})` : ""}` : null;
    const stopLoss = s1 ? s1.price : currentPrice * (1 - (atrPct ? atrPct / 100 * 1.5 : 0.015));
    const stopLossLabel = s1 ? `S1${s1.strength ? ` (${s1.strength})` : ""}` : "ATR × 1.5";

    const upsidePct = ((target1 - entry) / entry) * 100;
    const downsidePct = ((entry - stopLoss) / entry) * 100;
    const totalUpsidePct = target2 ? ((target2 - entry) / entry) * 100 : upsidePct;
    const riskReward = downsidePct > 0 ? upsidePct / downsidePct : 0;

    // Degenerate-trade guard (2026-09-04): the nearest S/R level can sit
    // arbitrarily close to the current price, producing a stop/target that is
    // essentially at the entry (guaranteed stop-out or meaningless "win").
    // Enforce a minimum distance from entry and a minimum risk:reward so the
    // pilot never opens a structurally broken trade on the fallback path.
    const MIN_STOP_PCT = 1.5;
    const MIN_TARGET_PCT = 1.5;
    const MIN_RR = 1.0;
    const atrFloor = atrPct && atrPct > 0 ? atrPct : 2.0;
    const stopFloor = entry * (1 - Math.max(MIN_STOP_PCT, 1.5 * atrFloor) / 100);
    const tgtFloor = entry * (1 + Math.max(MIN_TARGET_PCT, 2.0 * atrFloor) / 100);
    // If the S/R stop is CLOSER to entry than the floor (degenerate), widen it
    // to the floor. stopLoss sits below entry, so "too close" means stopLoss >
    // stopFloor (a higher stop = closer to entry).
    const effStop = stopLoss > stopFloor ? stopFloor : stopLoss;
    // If the S/R target is CLOSER to entry than the floor (degenerate), raise
    // it to the floor. target1 sits above entry, so "too close" means target1
    // < tgtFloor (a lower target = closer to entry).
    const effTarget = target1 < tgtFloor ? tgtFloor : target1;
    const effDownside = ((entry - effStop) / entry) * 100;
    const effUpside = ((effTarget - entry) / entry) * 100;
    const effRR = effDownside > 0 ? effUpside / effDownside : 0;
    const finalTarget = effRR >= MIN_RR ? effTarget : entry + (entry - effStop) * MIN_RR;
    const finalUpside = ((finalTarget - entry) / entry) * 100;
    const finalRR = effDownside > 0 ? finalUpside / effDownside : 0;

    return {
      currentPrice,
      direction: "BUY",
      entry,
      target1: finalTarget,
      target1Label,
      target2,
      target2Label,
      stopLoss: effStop,
      stopLossLabel,
      upsidePct: finalUpside,
      downsidePct: effDownside,
      totalUpsidePct: target2 ? ((target2 - entry) / entry) * 100 : finalUpside,
      riskReward: finalRR,
      atrValue,
      atrPct,
    };
  }

  if (signal === "SELL") {
    // Short entry = current price
    const entry = currentPrice;
    const target1 = s1 ? s1.price : currentPrice * (1 - (atrPct ? atrPct / 100 * 2 : 0.02));
    const target1Label = s1 ? `S1${s1.strength ? ` (${s1.strength})` : ""}` : "ATR × 2";
    const target2 = s2 ? s2.price : null;
    const target2Label = s2 ? `S2${s2.strength ? ` (${s2.strength})` : ""}` : null;
    const stopLoss = r1 ? r1.price : currentPrice * (1 + (atrPct ? atrPct / 100 * 1.5 : 0.015));
    const stopLossLabel = r1 ? `R1${r1.strength ? ` (${r1.strength})` : ""}` : "ATR × 1.5";

    // For SELL: downside is the gain (price falling), upside is the risk (price rising)
    const downsidePct = ((entry - target1) / entry) * 100; // potential gain
    const upsidePct = ((stopLoss - entry) / entry) * 100; // risk
    const totalUpsidePct = target2 ? ((entry - target2) / entry) * 100 : downsidePct;
    const riskReward = upsidePct > 0 ? downsidePct / upsidePct : 0;

    return {
      currentPrice,
      direction: "SELL",
      entry,
      target1,
      target1Label,
      target2,
      target2Label,
      stopLoss,
      stopLossLabel,
      upsidePct: downsidePct, // naming: potential gain
      downsidePct: upsidePct, // naming: risk
      totalUpsidePct,
      riskReward,
      atrValue,
      atrPct,
    };
  }

  // HOLD — show neutral levels
  const entry = currentPrice;
  const target1 = r1 ? r1.price : currentPrice * 1.02;
  const target1Label = r1 ? `R1${r1.strength ? ` (${r1.strength})` : ""}` : "Est. +2%";
  const target2 = r2 ? r2.price : null;
  const target2Label = r2 ? `R2${r2.strength ? ` (${r2.strength})` : ""}` : null;
  const stopLoss = s1 ? s1.price : currentPrice * 0.98;
  const stopLossLabel = s1 ? `S1${s1.strength ? ` (${s1.strength})` : ""}` : "Est. -2%";

  const upsidePct = ((target1 - entry) / entry) * 100;
  const downsidePct = ((entry - stopLoss) / entry) * 100;
  const totalUpsidePct = target2 ? ((target2 - entry) / entry) * 100 : upsidePct;
  const riskReward = downsidePct > 0 ? upsidePct / downsidePct : 0;

  return {
    currentPrice,
    direction: "HOLD",
    entry,
    target1,
    target1Label,
    target2,
    target2Label,
    stopLoss,
    stopLossLabel,
    upsidePct,
    downsidePct,
    totalUpsidePct,
    riskReward,
    atrValue,
    atrPct,
  };
}
