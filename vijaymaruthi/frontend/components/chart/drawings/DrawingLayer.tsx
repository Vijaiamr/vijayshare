"use client";

// DrawingLayer — SVG overlay on top of the main chart that renders user
// drawings (trendline, h/v line, fib, rect, text, measure, ray, extended,
// channel, fibExt, fibFan, fibTime, gannFan, pitchfork, ellipse, label,
// arrow, abcd, xabcd, elliott) and handles mouse drawing + selection/editing.
// Coordinates are converted through the ChartHandle so drawings stay glued to
// price/time while panning/zooming.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChartDrawing, ChartHandle, ChartTime, DrawingType } from "../types";
import {
  FIB_TIME_BARS, TOOL_POINT_COUNTS, arrowHead, clipLineToRect, fibExtLevels,
  fibFanRays, fibLevels, fibTimeXs, gannBoxSide, gannFanRays, hitTestPoint,
  hitTestPolyline, hitTestSegment, lineDashFor, measureFullLabel, midPoint,
  pitchforkLines, rayEnd, type Pt,
} from "./tools";

interface Props {
  handle: ChartHandle | null;
  drawings: ChartDrawing[];
  activeTool: DrawingType | "cursor";
  color: string;
  width: number;
  height: number;
  onAdd: (d: ChartDrawing) => void;
  onUpdate: (d: ChartDrawing) => void;
  onDelete: (id: string) => void;
  /** Controlled selection (object tree ↔ layer sync). Optional. */
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  /** Context-menu actions (wired by the parent). */
  onDuplicate?: (id: string) => void;
  onToggleLock?: (id: string) => void;
  onReorder?: (id: string, dir: "front" | "back") => void;
}

interface Draft {
  type: DrawingType;
  points: Pt[];
  text?: string;
}

interface TextInputState {
  x: number;
  y: number;
  value: string;
  type: "text" | "label";
  /** Set when editing an existing drawing (double-click). */
  editId?: string;
}

const TOL = 8;
const HANDLE_R = 4;

function uid(): string {
  return `d_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export default function DrawingLayer({
  handle, drawings, activeTool, color, width, height, onAdd, onUpdate, onDelete,
  selectedId: controlledSelectedId, onSelect, onDuplicate, onToggleLock, onReorder,
}: Props) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [preview, setPreview] = useState<Pt | null>(null);
  const [internalSelectedId, setInternalSelectedId] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ id: string; mode: "move" | "handle"; handleIdx: number; start: Pt; startPoints: Pt[] } | null>(null);
  const [textInput, setTextInput] = useState<TextInputState | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const [styleEditor, setStyleEditor] = useState<{ x: number; y: number; id: string } | null>(null);
  const [tick, setTick] = useState(0);
  const svgRef = useRef<SVGSVGElement>(null);
  const drawingMode = activeTool !== "cursor";

  // Controlled selection: when the parent provides selectedId/onSelect, use
  // them as the source of truth; otherwise fall back to internal state.
  const selectedId = controlledSelectedId !== undefined ? controlledSelectedId : internalSelectedId;
  const setSelectedId = useCallback((id: string | null) => {
    if (onSelect) onSelect(id);
    else setInternalSelectedId(id);
  }, [onSelect]);

  // Redraw when the visible range changes (pan/zoom) or data changes.
  useEffect(() => {
    if (!handle) return;
    const bump = () => setTick((t) => t + 1);
    handle.subscribeVisibleRange(bump);
    return () => handle.unsubscribeVisibleRange(bump);
  }, [handle]);

  // ── Coordinate conversion ──
  const toPx = useCallback((d: ChartDrawing): Pt[] => {
    if (!handle) return [];
    return d.points
      .map((p) => {
        const x = handle.timeToCoordinate(p.time);
        const y = handle.priceToCoordinate(p.price);
        return x != null && y != null ? { x, y } : null;
      })
      .filter((p): p is Pt => p !== null);
  }, [handle, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  const toData = useCallback((pts: Pt[]): { time: ChartTime; price: number }[] => {
    if (!handle) return [];
    return pts
      .map((p) => {
        // Magnet: snap to the nearest bar time + OHLC when close enough.
        const snapped = handle.snapPoint?.(p.x, p.y);
        if (snapped) return snapped;
        const t = handle.coordinateToTime(p.x);
        const pr = handle.coordinateToPrice(p.y);
        return t != null && pr != null ? { time: t, price: pr } : null;
      })
      .filter((p): p is { time: ChartTime; price: number } => p !== null);
  }, [handle]);

  // ── Hit testing ──
  const hitTest = useCallback((d: ChartDrawing, pts: Pt[], p: Pt): { mode: "move" | "handle"; handleIdx: number } | null => {
    if (pts.length === 0) return null;
    // Handles first (only for selected)
    if (selectedId === d.id) {
      for (let i = 0; i < pts.length; i++) {
        if (hitTestPoint(p, pts[i], TOL + 2)) return { mode: "handle", handleIdx: i };
      }
    }
    if (d.type === "hline") {
      if (Math.abs(p.y - pts[0].y) <= TOL) return { mode: "move", handleIdx: 0 };
    } else if (d.type === "vline") {
      if (Math.abs(p.x - pts[0].x) <= TOL) return { mode: "move", handleIdx: 0 };
    } else if (d.type === "text" || d.type === "label") {
      if (hitTestPoint(p, pts[0], TOL + 4)) return { mode: "move", handleIdx: 0 };
    } else if (d.type === "rect" || d.type === "ellipse") {
      if (pts.length >= 2) {
        const x1 = Math.min(pts[0].x, pts[1].x), x2 = Math.max(pts[0].x, pts[1].x);
        const y1 = Math.min(pts[0].y, pts[1].y), y2 = Math.max(pts[0].y, pts[1].y);
        if (p.x >= x1 - TOL && p.x <= x2 + TOL && p.y >= y1 - TOL && p.y <= y2 + TOL) return { mode: "move", handleIdx: 0 };
      }
    } else if (d.type === "channel") {
      if (pts.length >= 3) {
        if (hitTestSegment(p, pts[0], pts[1], TOL)) return { mode: "move", handleIdx: 0 };
        const dir = { x: pts[1].x - pts[0].x, y: pts[1].y - pts[0].y };
        if (hitTestSegment(p, pts[2], { x: pts[2].x + dir.x, y: pts[2].y + dir.y }, TOL)) return { mode: "move", handleIdx: 0 };
      }
    } else if (d.type === "pitchfork") {
      if (pts.length >= 3) {
        const m = midPoint(pts[1], pts[2]);
        if (hitTestSegment(p, pts[0], m, TOL)) return { mode: "move", handleIdx: 0 };
      }
    } else if (d.type === "fibTime" || d.type === "gannFan") {
      if (pts.length >= 1 && hitTestPoint(p, pts[0], TOL + 4)) return { mode: "move", handleIdx: 0 };
    } else if (d.type === "abcd" || d.type === "xabcd" || d.type === "elliott") {
      if (pts.length >= 2 && hitTestPolyline(p, pts, TOL)) return { mode: "move", handleIdx: 0 };
    } else {
      // trendline / ray / extended / fib / fibExt / fibFan / measure / arrow — segment hit
      if (pts.length >= 2 && hitTestSegment(p, pts[0], pts[1], TOL)) return { mode: "move", handleIdx: 0 };
    }
    return null;
  }, [selectedId]);

  // ── Pointer handlers ──
  const getPos = (e: React.PointerEvent): Pt => {
    const rect = svgRef.current?.getBoundingClientRect();
    return { x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) };
  };

  const commitDraft = useCallback((d: Draft) => {
    const data = toData(d.points);
    if (data.length === 0) return;
    if (d.type === "text" || d.type === "label") {
      setTextInput({ x: d.points[0].x, y: d.points[0].y, value: "", type: d.type === "label" ? "label" : "text" });
      setDraft(null);
      setPreview(null);
      return;
    }
    const drawing: ChartDrawing = {
      id: uid(),
      type: d.type,
      points: data,
      text: d.text,
      color,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    onAdd(drawing);
    setDraft(null);
    setPreview(null);
  }, [toData, color, onAdd]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (!drawingMode || !handle) return;
    e.preventDefault();
    const p = getPos(e);
    if (draft && draft.type === activeTool) {
      // Continue an in-progress drawing: append the click, finalize when the
      // required point count is reached.
      const pts = [...draft.points, p];
      if (pts.length >= TOOL_POINT_COUNTS[draft.type]) {
        commitDraft({ ...draft, points: pts });
      } else {
        setDraft({ ...draft, points: pts });
      }
      return;
    }
    setDraft({ type: activeTool as DrawingType, points: [p] });
    setSelectedId(null);
  }, [drawingMode, handle, draft, activeTool, commitDraft]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!handle) return;
    const p = getPos(e);
    if (drag) {
      const dx = p.x - drag.start.x;
      const dy = p.y - drag.start.y;
      const moved = drag.startPoints.map((pt, i) => {
        if (drag.mode === "move") return { x: pt.x + dx, y: pt.y + dy };
        return i === drag.handleIdx ? { x: pt.x + dx, y: pt.y + dy } : pt;
      });
      const data = toData(moved);
      if (data.length > 0) {
        const existing = drawings.find((d) => d.id === drag.id);
        if (existing) {
          onUpdate({ ...existing, points: data, updatedAt: new Date().toISOString() });
        }
      }
      return;
    }
    if (draft) {
      // Live magnet preview: snap the cursor to the nearest bar/OHLC.
      const snapped = handle.snapPoint?.(p.x, p.y);
      if (snapped) {
        const sx = handle.timeToCoordinate(snapped.time);
        const sy = handle.priceToCoordinate(snapped.price);
        setPreview(sx != null && sy != null ? { x: sx, y: sy } : p);
      } else {
        setPreview(p);
      }
    }
  }, [handle, drag, drawings, onUpdate, toData, draft]);

  const onPointerUp = useCallback(() => {
    if (drag) { setDrag(null); return; }
    if (draft) {
      const count = TOOL_POINT_COUNTS[draft.type];
      if (count === 1 || draft.points.length >= count) {
        commitDraft(draft);
      }
      // multi-point tools stay in draft until the required clicks are placed
    }
  }, [drag, draft, commitDraft]);

  // ── Selection (cursor mode) ──
  const onShapePointerDown = useCallback((e: React.PointerEvent, d: ChartDrawing) => {
    if (drawingMode) return;
    if (e.button !== 0) return; // left button only — right-click opens the context menu
    e.stopPropagation();
    const p = getPos(e);
    const pts = toPx(d);
    const hit = hitTest(d, pts, p);
    if (hit) {
      setSelectedId(d.id);
      // Locked drawings can be selected but not moved/edited.
      if (!d.locked) {
        setDrag({ id: d.id, mode: hit.mode, handleIdx: hit.handleIdx, start: p, startPoints: pts });
      }
    } else {
      setSelectedId(d.id);
    }
  }, [drawingMode, toPx, hitTest]);

  const onShapeDoubleClick = useCallback((e: React.MouseEvent, d: ChartDrawing) => {
    if (drawingMode || d.locked) return;
    if (d.type === "text" || d.type === "label") {
      e.stopPropagation();
      const p = toPx(d)[0];
      if (p) setTextInput({ x: p.x, y: p.y, value: d.text ?? "", type: d.type, editId: d.id });
    }
  }, [drawingMode, toPx]);

  const onShapeContextMenu = useCallback((e: React.MouseEvent, d: ChartDrawing) => {
    if (drawingMode) return;
    e.preventDefault();
    e.stopPropagation();
    setSelectedId(d.id);
    setCtxMenu({ x: e.clientX, y: e.clientY, id: d.id });
  }, [drawingMode]);

  // ── Keyboard delete ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSelectedId(null);
        setDraft(null);
        setPreview(null);
        setCtxMenu(null);
        setStyleEditor(null);
        return;
      }
      if (!selectedId) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        const d = drawings.find((x) => x.id === selectedId);
        if (d?.locked) return; // locked drawings can't be deleted
        e.preventDefault();
        onDelete(selectedId);
        setSelectedId(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId, onDelete, drawings]);

  // ── Render helpers ──
  const renderShape = useCallback((d: ChartDrawing, pts: Pt[], isSelected: boolean) => {
    const stroke = d.color;
    const dash = lineDashFor(d.lineStyle);
    const common = {
      stroke,
      strokeWidth: d.lineWidth ?? 1.5,
      fill: "none",
      opacity: d.opacity ?? 1,
      ...(dash ? { strokeDasharray: dash } : {}),
    };
    const labelStyle = { fill: stroke, fontSize: 10, fontFamily: "ui-monospace, monospace", opacity: d.opacity ?? 1 };
    const elements: React.ReactNode[] = [];

    const polyline = (key: string, p: Pt[]) => {
      elements.push(<polyline key={key} points={p.map((q) => `${q.x},${q.y}`).join(" ")} {...common} />);
    };

    if (d.type === "trendline" && pts.length >= 2) {
      elements.push(<line key="l" x1={pts[0].x} y1={pts[0].y} x2={pts[1].x} y2={pts[1].y} {...common} />);
    } else if (d.type === "ray" && pts.length >= 2) {
      const xEdge = pts[1].x >= pts[0].x ? width : 0;
      const end = rayEnd(pts[0], pts[1], xEdge);
      elements.push(<line key="l" x1={pts[0].x} y1={pts[0].y} x2={end.x} y2={end.y} {...common} />);
    } else if (d.type === "extended" && pts.length >= 2) {
      const seg = clipLineToRect(pts[0], pts[1], 0, 0, width, height);
      if (seg) elements.push(<line key="l" x1={seg[0].x} y1={seg[0].y} x2={seg[1].x} y2={seg[1].y} {...common} />);
    } else if (d.type === "hline" && pts.length >= 1) {
      elements.push(<line key="l" x1={0} y1={pts[0].y} x2={width} y2={pts[0].y} {...common} strokeDasharray={dash ?? "4 3"} />);
      elements.push(<text key="t" x={4} y={pts[0].y - 4} {...labelStyle}>{d.points[0]?.price?.toFixed(2)}</text>);
    } else if (d.type === "vline" && pts.length >= 1) {
      elements.push(<line key="l" x1={pts[0].x} y1={0} x2={pts[0].x} y2={height} {...common} strokeDasharray={dash ?? "4 3"} />);
    } else if (d.type === "channel" && pts.length >= 3) {
      const seg1 = clipLineToRect(pts[0], pts[1], 0, 0, width, height);
      if (seg1) elements.push(<line key="l1" x1={seg1[0].x} y1={seg1[0].y} x2={seg1[1].x} y2={seg1[1].y} {...common} />);
      const dir = { x: pts[1].x - pts[0].x, y: pts[1].y - pts[0].y };
      const seg2 = clipLineToRect(pts[2], { x: pts[2].x + dir.x, y: pts[2].y + dir.y }, 0, 0, width, height);
      if (seg2) elements.push(<line key="l2" x1={seg2[0].x} y1={seg2[0].y} x2={seg2[1].x} y2={seg2[1].y} {...common} strokeDasharray={dash ?? "4 3"} />);
    } else if (d.type === "fib" && pts.length >= 2) {
      elements.push(<line key="axis" x1={pts[0].x} y1={pts[0].y} x2={pts[1].x} y2={pts[1].y} {...common} strokeDasharray={dash ?? "2 2"} />);
      fibLevels(pts[0], pts[1]).forEach((lv, i) => {
        const price = handle?.coordinateToPrice(lv.y);
        elements.push(
          <line key={`lv${i}`} x1={0} y1={lv.y} x2={width} y2={lv.y} stroke={stroke} strokeWidth={0.75} strokeDasharray={dash ?? "5 4"} opacity={0.7 * (d.opacity ?? 1)} />,
        );
        elements.push(<text key={`lb${i}`} x={4} y={lv.y - 3} {...labelStyle} opacity={0.85 * (d.opacity ?? 1)}>{lv.level.toFixed(3)}{price != null ? ` · ${price.toFixed(2)}` : ""}</text>);
      });
    } else if (d.type === "fibExt" && pts.length >= 3) {
      elements.push(<line key="axis" x1={pts[0].x} y1={pts[0].y} x2={pts[1].x} y2={pts[1].y} {...common} />);
      elements.push(<line key="retr" x1={pts[1].x} y1={pts[1].y} x2={pts[2].x} y2={pts[2].y} {...common} strokeDasharray={dash ?? "2 2"} opacity={0.6 * (d.opacity ?? 1)} />);
      fibExtLevels(pts[0], pts[1], pts[2]).forEach((lv, i) => {
        const price = handle?.coordinateToPrice(lv.y);
        elements.push(<line key={`lv${i}`} x1={pts[2].x} y1={lv.y} x2={width} y2={lv.y} stroke={stroke} strokeWidth={0.75} strokeDasharray={dash ?? "5 4"} opacity={0.7 * (d.opacity ?? 1)} />);
        elements.push(<text key={`lb${i}`} x={pts[2].x + 4} y={lv.y - 3} {...labelStyle} opacity={0.85 * (d.opacity ?? 1)}>{lv.level.toFixed(3)}{price != null ? ` · ${price.toFixed(2)}` : ""}</text>);
      });
    } else if (d.type === "fibFan" && pts.length >= 2) {
      const xEdge = pts[1].x >= pts[0].x ? width : 0;
      elements.push(<line key="axis" x1={pts[0].x} y1={pts[0].y} x2={pts[1].x} y2={pts[1].y} {...common} />);
      fibFanRays(pts[0], pts[1], xEdge).forEach((r, i) => {
        const price = handle?.coordinateToPrice(r.to.y);
        elements.push(<line key={`r${i}`} x1={pts[0].x} y1={pts[0].y} x2={r.to.x} y2={r.to.y} stroke={stroke} strokeWidth={0.75} strokeDasharray={dash ?? "4 3"} opacity={0.75 * (d.opacity ?? 1)} />);
        elements.push(<text key={`lb${i}`} x={Math.max(4, r.to.x - 36)} y={r.to.y - 3} {...labelStyle} opacity={0.85 * (d.opacity ?? 1)}>{r.level.toFixed(3)}{price != null ? ` · ${price.toFixed(2)}` : ""}</text>);
      });
    } else if (d.type === "fibTime" && pts.length >= 1) {
      const range = handle?.getVisibleRange();
      const barSpacing = range && range.to > range.from ? width / (range.to - range.from) : 8;
      fibTimeXs(pts[0].x, barSpacing).forEach((x, i) => {
        if (x < 0 || x > width) return;
        elements.push(<line key={`v${i}`} x1={x} y1={0} x2={x} y2={height} stroke={stroke} strokeWidth={0.75} strokeDasharray={dash ?? "4 3"} opacity={0.7 * (d.opacity ?? 1)} />);
        elements.push(<text key={`lb${i}`} x={x + 2} y={10} {...labelStyle} opacity={0.85 * (d.opacity ?? 1)}>{FIB_TIME_BARS[i]}</text>);
      });
    } else if (d.type === "gannFan" && pts.length >= 1) {
      const S = gannBoxSide(pts[0], width, height);
      gannFanRays(pts[0], width, height).forEach((r, i) => {
        elements.push(<line key={`r${i}`} x1={pts[0].x} y1={pts[0].y} x2={r.to.x} y2={r.to.y} stroke={stroke} strokeWidth={0.75} strokeDasharray={dash ?? "4 3"} opacity={0.75 * (d.opacity ?? 1)} />);
        elements.push(<text key={`lb${i}`} x={Math.max(4, r.to.x - 30)} y={r.to.y - 3} {...labelStyle} opacity={0.85 * (d.opacity ?? 1)}>{r.label}</text>);
      });
      elements.push(<rect key="box" x={pts[0].x} y={pts[0].y - S} width={S} height={S} stroke={stroke} strokeWidth={0.5} fill="none" opacity={0.25 * (d.opacity ?? 1)} strokeDasharray={dash ?? "2 2"} />);
    } else if (d.type === "pitchfork" && pts.length >= 3) {
      pitchforkLines(pts[0], pts[1], pts[2], 0, 0, width, height).forEach((ln, i) => {
        elements.push(<line key={`l${i}`} x1={ln.from.x} y1={ln.from.y} x2={ln.to.x} y2={ln.to.y} {...common} strokeDasharray={ln.kind === "median" ? dash : (dash ?? "4 3")} />);
      });
    } else if (d.type === "rect" && pts.length >= 2) {
      const x = Math.min(pts[0].x, pts[1].x), y = Math.min(pts[0].y, pts[1].y);
      elements.push(<rect key="r" x={x} y={y} width={Math.abs(pts[1].x - pts[0].x)} height={Math.abs(pts[1].y - pts[0].y)} {...common} fill={stroke} fillOpacity={0.06 * (d.opacity ?? 1)} />);
    } else if (d.type === "ellipse" && pts.length >= 2) {
      const x = Math.min(pts[0].x, pts[1].x), y = Math.min(pts[0].y, pts[1].y);
      const w = Math.abs(pts[1].x - pts[0].x), h = Math.abs(pts[1].y - pts[0].y);
      elements.push(<ellipse key="e" cx={x + w / 2} cy={y + h / 2} rx={w / 2} ry={h / 2} {...common} fill={stroke} fillOpacity={0.06 * (d.opacity ?? 1)} />);
    } else if (d.type === "text" && pts.length >= 1) {
      elements.push(<text key="t" x={pts[0].x + 6} y={pts[0].y - 6} {...labelStyle} fontSize={12}>{d.text ?? ""}</text>);
    } else if (d.type === "label" && pts.length >= 1) {
      const text = d.text ?? "";
      const tw = Math.max(24, text.length * 6.2 + 14);
      elements.push(<rect key="bg" x={pts[0].x + 4} y={pts[0].y - 12} width={tw} height={18} rx={9} fill={stroke} fillOpacity={0.15 * (d.opacity ?? 1)} stroke={stroke} strokeWidth={0.75} />);
      elements.push(<text key="t" x={pts[0].x + 11} y={pts[0].y + 1} {...labelStyle} fontSize={11}>{text}</text>);
    } else if (d.type === "arrow" && pts.length >= 2) {
      elements.push(<line key="l" x1={pts[0].x} y1={pts[0].y} x2={pts[1].x} y2={pts[1].y} {...common} />);
      const head = arrowHead(pts[1], pts[0]);
      elements.push(<polygon key="h" points={head.map((p) => `${p.x},${p.y}`).join(" ")} fill={stroke} stroke={stroke} strokeWidth={0.5} />);
    } else if (d.type === "measure" && pts.length >= 2) {
      // TradingView-style measure: shaded area between the two points,
      // diagonal line, corner markers, and a label with the vertical
      // movement (price distance), % change and time distance.
      const x = Math.min(pts[0].x, pts[1].x), y = Math.min(pts[0].y, pts[1].y);
      const w = Math.abs(pts[1].x - pts[0].x), h = Math.abs(pts[1].y - pts[0].y);
      elements.push(<rect key="area" x={x} y={y} width={w} height={h} fill={stroke} fillOpacity={0.05} stroke="none" />);
      elements.push(<line key="l" x1={pts[0].x} y1={pts[0].y} x2={pts[1].x} y2={pts[1].y} {...common} />);
      elements.push(<circle key="c0" cx={pts[0].x} cy={pts[0].y} r={2.5} fill={stroke} stroke="none" />);
      elements.push(<circle key="c1" cx={pts[1].x} cy={pts[1].y} r={2.5} fill={stroke} stroke="none" />);
      const mid = midPoint(pts[0], pts[1]);
      const label = measureFullLabel(
        d.points[0]?.price ?? 0, d.points[1]?.price ?? 0,
        d.points[0]?.time, d.points[1]?.time,
      );
      elements.push(<text key="t" x={mid.x + 6} y={mid.y - 6} {...labelStyle}>{label}</text>);
    } else if (d.type === "abcd" && pts.length >= 4) {
      polyline("l", pts);
      ["A", "B", "C", "D"].forEach((lb, i) => {
        elements.push(<text key={`lb${i}`} x={pts[i].x + 5} y={pts[i].y - 5} {...labelStyle} fontWeight={700}>{lb}</text>);
      });
    } else if (d.type === "xabcd" && pts.length >= 5) {
      polyline("l", pts);
      ["X", "A", "B", "C", "D"].forEach((lb, i) => {
        elements.push(<text key={`lb${i}`} x={pts[i].x + 5} y={pts[i].y - 5} {...labelStyle} fontWeight={700}>{lb}</text>);
      });
    } else if (d.type === "elliott" && pts.length >= 5) {
      polyline("l", pts);
      ["1", "2", "3", "4", "5"].forEach((lb, i) => {
        elements.push(<text key={`lb${i}`} x={pts[i].x + 5} y={pts[i].y - 5} {...labelStyle} fontWeight={700}>{lb}</text>);
      });
    }

    if (isSelected) {
      pts.forEach((p, i) => {
        elements.push(<circle key={`h${i}`} cx={p.x} cy={p.y} r={HANDLE_R} fill="#20d6a0" stroke="#04110b" strokeWidth={1} />);
      });
    }
    return elements;
  }, [width, height, handle]);

  const rendered = useMemo(() => {
    return drawings.map((d) => {
      const pts = toPx(d);
      if (pts.length === 0) return null;
      const isSelected = selectedId === d.id;
      // Invisible wide hit-path so line-based drawings are easy to grab in
      // cursor mode (the container is pointer-events:none there, so only the
      // groups opt in via visiblePainted).
      const hitPath =
        !drawingMode && pts.length >= 2 && d.type !== "rect" && d.type !== "ellipse" && d.type !== "text" && d.type !== "label"
          ? <path key="hit" d={pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ")} stroke="transparent" strokeWidth={12} fill="none" pointerEvents="stroke" />
          : null;
      return (
        <g
          key={d.id}
          onPointerDown={(e) => onShapePointerDown(e, d)}
          onDoubleClick={(e) => onShapeDoubleClick(e, d)}
          onContextMenu={(e) => onShapeContextMenu(e, d)}
          style={{ cursor: drawingMode ? "crosshair" : "pointer", opacity: d.locked ? 0.85 : 1, pointerEvents: drawingMode ? "none" : "visiblePainted" }}
        >
          {hitPath}
          {renderShape(d, pts, isSelected)}
          {d.locked && isSelected && (
            <text x={pts[0].x + 8} y={pts[0].y - 8} fill="#f59e0b" fontSize={9} fontFamily="ui-monospace, monospace">🔒</text>
          )}
        </g>
      );
    });
  }, [drawings, toPx, selectedId, onShapePointerDown, onShapeDoubleClick, onShapeContextMenu, drawingMode, renderShape]);

  const draftEls = useMemo(() => {
    if (!draft) return null;
    const pts = preview && draft.points.length < Math.max(2, TOOL_POINT_COUNTS[draft.type]) ? [...draft.points, preview] : draft.points;
    if (pts.length === 0) return null;
    const d: ChartDrawing = {
      id: "draft", type: draft.type, points: [], color, createdAt: "", updatedAt: "",
    };
    return <g pointerEvents="none">{renderShape(d, pts, false)}</g>;
  }, [draft, preview, color, renderShape]);

  return (
    <div className="absolute inset-0 z-20 overflow-hidden" style={{ pointerEvents: drawingMode ? "auto" : "none" }}>
      <svg
        ref={svgRef}
        width={width}
        height={height}
        className="absolute inset-0"
        style={{ pointerEvents: drawingMode ? "auto" : "none", touchAction: "none" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => { if (draft && draft.points.length < Math.max(2, TOOL_POINT_COUNTS[draft.type])) setPreview(null) }}
      >
        {rendered}
        {draftEls}
      </svg>

      {textInput && (
        <input
          autoFocus
          value={textInput.value}
          placeholder={textInput.type === "label" ? "Label…" : "Annotation…"}
          className="absolute z-30 h-7 w-40 rounded border border-border bg-background px-2 text-xs shadow-lg outline-none"
          style={{ left: textInput.x, top: textInput.y, pointerEvents: "auto" }}
          onChange={(e) => setTextInput({ ...textInput, value: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              const data = toData([{ x: textInput.x, y: textInput.y }]);
              if (data.length > 0) {
                if (textInput.editId) {
                  // Editing an existing text/label drawing.
                  const existing = drawings.find((d) => d.id === textInput.editId);
                  if (existing) {
                    onUpdate({ ...existing, text: textInput.value || existing.text, updatedAt: new Date().toISOString() });
                  }
                } else {
                  onAdd({
                    id: uid(), type: textInput.type, points: data,
                    text: textInput.value || (textInput.type === "label" ? "Label" : "Note"),
                    color, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
                  });
                }
              }
              setTextInput(null);
            } else if (e.key === "Escape") {
              setTextInput(null);
            }
          }}
          onBlur={() => setTextInput(null)}
        />
      )}

      {/* Right-click context menu */}
      {ctxMenu && (() => {
        const d = drawings.find((x) => x.id === ctxMenu.id);
        const locked = d?.locked ?? false;
        const item = "flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs hover:bg-muted";
        return (
          <div
            className="fixed z-50 w-44 rounded-lg border border-border/60 bg-background/95 p-1 shadow-xl backdrop-blur"
            style={{ left: Math.min(ctxMenu.x, window.innerWidth - 190), top: Math.min(ctxMenu.y, window.innerHeight - 220), pointerEvents: "auto" }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <button className={item} onClick={() => { setStyleEditor({ id: ctxMenu.id, x: ctxMenu.x, y: ctxMenu.y }); setCtxMenu(null); }}>
              ⚙ Settings…
            </button>
            <button className={item} onClick={() => { onDuplicate?.(ctxMenu.id); setCtxMenu(null); }}>
              ⧉ Duplicate
            </button>
            <button className={item} onClick={() => { onToggleLock?.(ctxMenu.id); setCtxMenu(null); }}>
              {locked ? "🔓 Unlock" : "🔒 Lock"}
            </button>
            <button className={item} onClick={() => { onReorder?.(ctxMenu.id, "front"); setCtxMenu(null); }}>
              ⤴ Bring to front
            </button>
            <button className={item} onClick={() => { onReorder?.(ctxMenu.id, "back"); setCtxMenu(null); }}>
              ⤵ Send to back
            </button>
            <div className="my-1 border-t border-border/60" />
            <button
              className={`${item} text-red-600`}
              onClick={() => { if (!locked) onDelete(ctxMenu.id); setCtxMenu(null); }}
            >
              🗑 Delete
            </button>
          </div>
        );
      })()}

      {/* Per-drawing settings popover */}
      {styleEditor && (() => {
        const d = drawings.find((x) => x.id === styleEditor.id);
        if (!d) return null;
        const patch = (p: Partial<ChartDrawing>) =>
          onUpdate({ ...d, ...p, updatedAt: new Date().toISOString() });
        return (
          <div
            className="fixed z-50 w-52 rounded-lg border border-border/60 bg-background/95 p-3 shadow-xl backdrop-blur"
            style={{ left: Math.min(styleEditor.x, window.innerWidth - 230), top: Math.min(styleEditor.y, window.innerHeight - 260), pointerEvents: "auto" }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <p className="mb-2 text-[0.65rem] font-semibold text-muted-foreground">Drawing settings</p>
            <label className="mb-1 flex items-center justify-between text-xs">
              Color
              <input
                type="color"
                value={d.color}
                onChange={(e) => patch({ color: e.target.value })}
                className="h-6 w-8 cursor-pointer rounded border border-border bg-transparent p-0.5"
              />
            </label>
            <label className="mb-1 flex items-center justify-between text-xs">
              Style
              <select
                value={d.lineStyle ?? "solid"}
                onChange={(e) => patch({ lineStyle: e.target.value as ChartDrawing["lineStyle"] })}
                className="h-6 rounded border border-border bg-background px-1 text-xs"
              >
                <option value="solid">Solid</option>
                <option value="dashed">Dashed</option>
                <option value="dotted">Dotted</option>
              </select>
            </label>
            <label className="mb-1 flex items-center justify-between text-xs">
              Width
              <select
                value={d.lineWidth ?? 1}
                onChange={(e) => patch({ lineWidth: Number(e.target.value) as ChartDrawing["lineWidth"] })}
                className="h-6 rounded border border-border bg-background px-1 text-xs"
              >
                {[1, 2, 3, 4].map((w) => <option key={w} value={w}>{w}</option>)}
              </select>
            </label>
            <label className="mb-1 flex items-center justify-between text-xs">
              Opacity
              <input
                type="range"
                min={0.1}
                max={1}
                step={0.05}
                value={d.opacity ?? 1}
                onChange={(e) => patch({ opacity: Number(e.target.value) })}
                className="w-20"
              />
            </label>
            <button
              className="mt-2 w-full rounded border border-border/60 px-2 py-1 text-xs hover:bg-muted"
              onClick={() => setStyleEditor(null)}
            >
              Done
            </button>
          </div>
        );
      })()}
    </div>
  );
}