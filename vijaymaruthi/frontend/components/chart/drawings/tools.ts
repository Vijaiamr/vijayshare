// Drawing geometry helpers — pure math used by the DrawingLayer.

import type { ChartTime, DrawingType } from "../types";

export interface Pt {
  x: number;
  y: number;
}

export const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.272, 1.414, 1.618];

/** Fibonacci extension levels projected beyond the A→B leg. */
export const FIB_EXT_LEVELS = [0.618, 1, 1.618, 2.618, 3.618];

/** Fibonacci fan ratios (fractions of the A→B range). */
export const FIB_FAN_LEVELS = [0.236, 0.382, 0.5, 0.618, 0.786];

/** Fibonacci time-zone bar counts. */
export const FIB_TIME_BARS = [1, 2, 3, 5, 8, 13, 21, 34, 55, 89];

/** Gann fan angles (time × price). */
export const GANN_RATIOS: { label: string; slope: number }[] = [
  { label: "1×1", slope: 1 },
  { label: "1×2", slope: 2 },
  { label: "1×3", slope: 3 },
  { label: "2×1", slope: 0.5 },
  { label: "3×1", slope: 1 / 3 },
  { label: "1×4", slope: 4 },
  { label: "4×1", slope: 0.25 },
];

// ─── Tool metadata ───

export interface DrawingToolMeta {
  type: DrawingType;
  label: string;
  /** lucide icon name (consumed by the toolbar). */
  icon: string;
  /** Number of clicks required to finalize the drawing. */
  points: number;
  description: string;
}

/** Number of clicks required to finalize each drawing tool. */
export const TOOL_POINT_COUNTS: Record<DrawingType, number> = {
  cursor: 0,
  trendline: 2,
  ray: 2,
  extended: 2,
  hline: 1,
  vline: 1,
  channel: 3,
  fib: 2,
  fibExt: 3,
  fibFan: 2,
  fibTime: 1,
  gannFan: 1,
  pitchfork: 3,
  rect: 2,
  ellipse: 2,
  text: 1,
  label: 1,
  arrow: 2,
  measure: 2,
  abcd: 4,
  xabcd: 5,
  elliott: 5,
};

/** Full tool metadata — mirrors DRAWING_TOOLS in types.ts, extended with
 *  icon name, required point count and a description. */
export const DRAWING_TOOL_META: DrawingToolMeta[] = [
  { type: "cursor", label: "Cursor", icon: "MousePointer2", points: 0, description: "Select, move and edit drawings" },
  { type: "trendline", label: "Trendline", icon: "TrendingUp", points: 2, description: "Straight line between two points" },
  { type: "ray", label: "Ray", icon: "ArrowUpRight", points: 2, description: "Line from A through B extending in B's direction" },
  { type: "extended", label: "Extended", icon: "Minus", points: 2, description: "Line through A and B extending in both directions" },
  { type: "hline", label: "Horizontal Line", icon: "MoveHorizontal", points: 1, description: "Horizontal line at a price level" },
  { type: "vline", label: "Vertical Line", icon: "MoveVertical", points: 1, description: "Vertical line at a time" },
  { type: "channel", label: "Channel", icon: "PanelTop", points: 3, description: "Two parallel lines through A, B and C" },
  { type: "fib", label: "Fib Retracement", icon: "GitCompareArrows", points: 2, description: "Fibonacci retracement levels" },
  { type: "fibExt", label: "Fib Extension", icon: "GitCompareArrows", points: 3, description: "Fibonacci extension projected beyond B" },
  { type: "fibFan", label: "Fib Fan", icon: "Fan", points: 2, description: "Fibonacci fan rays from A through B" },
  { type: "fibTime", label: "Fib Time Zones", icon: "Clock", points: 1, description: "Vertical lines at Fibonacci bar counts" },
  { type: "gannFan", label: "Gann Fan", icon: "Sun", points: 1, description: "Gann angle fan from a pivot point" },
  { type: "pitchfork", label: "Pitchfork", icon: "Forklift", points: 3, description: "Andrews pitchfork median with parallels" },
  { type: "rect", label: "Rectangle", icon: "Square", points: 2, description: "Rectangle from two corners" },
  { type: "ellipse", label: "Ellipse", icon: "Circle", points: 2, description: "Ellipse fitted to a bounding box" },
  { type: "text", label: "Text", icon: "Type", points: 1, description: "Free text annotation" },
  { type: "label", label: "Label", icon: "Tag", points: 1, description: "Text label with a background pill" },
  { type: "arrow", label: "Arrow", icon: "ArrowUpRight", points: 2, description: "Arrow from A to B with a head at B" },
  { type: "measure", label: "Measure", icon: "Ruler", points: 2, description: "Distance and percentage measure" },
  { type: "abcd", label: "ABCD", icon: "Shapes", points: 4, description: "ABCD harmonic pattern" },
  { type: "xabcd", label: "XABCD", icon: "Shapes", points: 5, description: "XABCD harmonic pattern" },
  { type: "elliott", label: "Elliott Wave", icon: "Waves", points: 5, description: "5-wave Elliott impulse" },
];

// ─── Basic helpers ───

/** SVG stroke-dasharray for a drawing line style. */
export function lineDashFor(style: "solid" | "dashed" | "dotted" | undefined): string | undefined {
  if (style === "dashed") return "6 4";
  if (style === "dotted") return "2 3";
  return undefined;
}

export function dist(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function hitTestPoint(p: Pt, target: Pt, tol: number): boolean {
  return dist(p, target) <= tol;
}

export function hitTestSegment(p: Pt, a: Pt, b: Pt, tol: number): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return dist(p, a) <= tol;
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const proj = { x: a.x + t * dx, y: a.y + t * dy };
  return dist(p, proj) <= tol;
}

export function midPoint(a: Pt, b: Pt): Pt {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** Hit-test a polyline (any segment within tolerance). */
export function hitTestPolyline(p: Pt, pts: Pt[], tol: number): boolean {
  for (let i = 0; i < pts.length - 1; i++) {
    if (hitTestSegment(p, pts[i], pts[i + 1], tol)) return true;
  }
  return false;
}

/** Fibonacci retracement level y-coordinates between two anchor points. */
export function fibLevels(a: Pt, b: Pt): { level: number; y: number }[] {
  const top = Math.max(a.y, b.y);
  const bottom = Math.min(a.y, b.y);
  const diff = bottom - top;
  return FIB_LEVELS.map((l) => ({ level: l, y: top + diff * l }));
}

/** Price distance label for the measure tool. */
export function measureLabel(a: Pt, b: Pt, priceA: number, priceB: number): string {
  const pct = priceA === 0 ? 0 : ((priceB - priceA) / priceA) * 100;
  return `${Math.abs(priceB - priceA).toFixed(2)} (${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%)`;
}

/** Human-readable time distance between two chart times (bars/days/hours). */
export function measureTimeDistance(t0: ChartTime, t1: ChartTime): string {
  if (typeof t0 === "number" && typeof t1 === "number") {
    const diff = Math.abs(t1 - t0);
    const days = diff / 86400;
    if (days >= 1) return `${Math.round(days)}d`;
    const hours = diff / 3600;
    if (hours >= 1) return `${Math.round(hours)}h`;
    const mins = diff / 60;
    if (mins >= 1) return `${Math.round(mins)}m`;
    return `${Math.round(diff)}s`;
  }
  if (typeof t0 === "string" && typeof t1 === "string") {
    const d0 = new Date(t0).getTime();
    const d1 = new Date(t1).getTime();
    if (!Number.isNaN(d0) && !Number.isNaN(d1)) {
      const days = Math.abs(d1 - d0) / 86400000;
      if (days >= 1) return `${Math.round(days)}d`;
      return `${Math.max(1, Math.round(days * 24))}h`;
    }
  }
  return "";
}

/** Full measure label: vertical movement (price) + % change + time distance. */
export function measureFullLabel(
  priceA: number, priceB: number, t0: ChartTime, t1: ChartTime,
): string {
  const pct = priceA === 0 ? 0 : ((priceB - priceA) / priceA) * 100;
  const pricePart = `${Math.abs(priceB - priceA).toFixed(2)} (${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%)`;
  const td = measureTimeDistance(t0, t1);
  return td ? `${pricePart} · ${td}` : pricePart;
}

// ─── Line / ray / channel geometry ───

/** Clip the infinite line through a and b to the rectangle [x0,x1]×[y0,y1]
 *  (Liang–Barsky). Returns null when the line misses the rectangle. */
export function clipLineToRect(a: Pt, b: Pt, x0: number, y0: number, x1: number, y1: number): [Pt, Pt] | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) return null;
  let t0 = -Infinity;
  let t1 = Infinity;
  const clip = (p: number, q: number): boolean => {
    if (Math.abs(p) < 1e-9) return q >= 0;
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };
  if (!clip(-dx, a.x - x0)) return null;
  if (!clip(dx, x1 - a.x)) return null;
  if (!clip(-dy, a.y - y0)) return null;
  if (!clip(dy, y1 - a.y)) return null;
  if (t1 < t0) return null;
  return [
    { x: a.x + t0 * dx, y: a.y + t0 * dy },
    { x: a.x + t1 * dx, y: a.y + t1 * dy },
  ];
}

/** Endpoint of the ray starting at `from` and passing through `through`,
 *  evaluated at x = xEdge (the visible left/right edge). */
export function rayEnd(from: Pt, through: Pt, xEdge: number): Pt {
  const dx = through.x - from.x;
  if (Math.abs(dx) < 1e-9) return { x: from.x, y: through.y };
  const slope = (through.y - from.y) / dx;
  return { x: xEdge, y: from.y + slope * (xEdge - from.x) };
}

// ─── Fibonacci tools ───

/** Fib extension level y-coordinates: anchored at C, projected by the A→B
 *  leg: y = C.y + (B.y − A.y) × level. */
export function fibExtLevels(a: Pt, b: Pt, c: Pt): { level: number; y: number }[] {
  const diff = b.y - a.y;
  return FIB_EXT_LEVELS.map((level) => ({ level, y: c.y + diff * level }));
}

/** Fib fan rays from A through the fraction points of the A→B range,
 *  extended to x = xEdge. */
export function fibFanRays(a: Pt, b: Pt, xEdge: number): { level: number; to: Pt }[] {
  const dx = b.x - a.x;
  if (Math.abs(dx) < 1e-9) return [];
  const dy = b.y - a.y;
  return FIB_FAN_LEVELS.map((level) => ({
    level,
    to: { x: xEdge, y: a.y + ((dy * level) / dx) * (xEdge - a.x) },
  }));
}

/** Fib time-zone x positions for the given bar spacing (px per bar). */
export function fibTimeXs(ax: number, barSpacing: number): number[] {
  return FIB_TIME_BARS.map((n) => ax + n * barSpacing);
}

// ─── Gann fan ───

/** Gann fan rays from A. The box side is the largest square that fits from
 *  A to the right edge within the visible price range (chart height). */
export function gannFanRays(a: Pt, width: number, height: number): { label: string; to: Pt }[] {
  const S = Math.min(width - a.x, height);
  const xEdge = width;
  return GANN_RATIOS.map((r) => ({
    label: r.label,
    to: { x: xEdge, y: a.y - r.slope * (xEdge - a.x) },
  }));
}

/** Gann fan box side (px) — largest square from A to the right edge within
 *  the visible price range. */
export function gannBoxSide(a: Pt, width: number, height: number): number {
  return Math.min(width - a.x, height);
}

// ─── Andrews pitchfork ───

/** Pitchfork lines: median from A through the midpoint of B–C, plus the
 *  parallels through B and C, all extended to the visible edge. */
export function pitchforkLines(
  a: Pt, b: Pt, c: Pt, x0: number, y0: number, x1: number, y1: number,
): { kind: "median" | "upper" | "lower"; from: Pt; to: Pt }[] {
  const m = midPoint(b, c);
  const dirX = m.x - a.x;
  const dirY = m.y - a.y;
  const xEdge = dirX >= 0 ? x1 : x0;
  return [
    { kind: "median", from: a, to: rayEnd(a, m, xEdge) },
    { kind: "upper", from: b, to: rayEnd(b, { x: b.x + dirX, y: b.y + dirY }, xEdge) },
    { kind: "lower", from: c, to: rayEnd(c, { x: c.x + dirX, y: c.y + dirY }, xEdge) },
  ];
}

// ─── Arrow head ───

/** Arrow-head polygon (3 points) at the tip `b`, pointing back toward `a`. */
export function arrowHead(b: Pt, a: Pt): Pt[] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return [b, b, b];
  const ux = dx / len;
  const uy = dy / len;
  const px = -uy;
  const py = ux;
  const size = 10;
  const half = 4;
  return [
    b,
    { x: b.x - ux * size + px * half, y: b.y - uy * size + py * half },
    { x: b.x - ux * size - px * half, y: b.y - uy * size - py * half },
  ];
}