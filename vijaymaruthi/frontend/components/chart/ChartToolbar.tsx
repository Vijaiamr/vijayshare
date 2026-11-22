"use client";

// Chart toolbar: lookback tabs, interval tabs, chart-type switcher, categorized
// indicator menu, drawing tools, compare, symbol search, replay, export,
// snapshot, template, fullscreen and settings.

import {
  AreaChart, ArrowUpRight, BarChart3, Bell, Camera, CandlestickChart, Circle,
  Clock, Fan, Forklift, GitCompareArrows, LayoutGrid, LineChart, Maximize2,
  Minimize2, Minus, MousePointer2, MoveHorizontal, MoveVertical, PanelTop,
  Pencil, Play, Ruler, Search, Settings2, Shapes, Square, Sun, Tag, TrendingUp,
  Type, Waves,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuGroup,
  DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type {
  BarInterval, ChartType, CompareSeries, DrawingType, Lookback, PriceScaleMode,
  ToggleKey, ToggleState,
} from "./types";
import { CHART_TYPES, DRAWING_TOOLS, INDICATOR_CATEGORIES, INTERVALS, LOOKBACKS } from "./types";
import { DRAWING_TOOL_META } from "./drawings/tools";

interface Props {
  lookback: Lookback;
  onLookbackChange: (l: Lookback) => void;
  interval: BarInterval;
  onIntervalChange: (i: BarInterval) => void;
  chartType: ChartType;
  onChartTypeChange: (t: ChartType) => void;
  toggles: ToggleState;
  onToggleChange: (k: ToggleKey, v: boolean) => void;
  activeTool: DrawingType | "cursor";
  onToolChange: (t: DrawingType | "cursor") => void;
  drawingColor: string;
  onDrawingColorChange: (c: string) => void;
  compare: CompareSeries[];
  onCompareChange: (c: CompareSeries[]) => void;
  onReplay: () => void;
  onExport: () => void;
  onSnapshot: () => void;
  onFullscreen: () => void;
  onOpenSettings: () => void;
  onOpenAlerts: () => void;
  onOpenLayouts: () => void;
  onOpenTemplates: () => void;
  onOpenSymbolSearch: () => void;
  isFullscreen: boolean;
}

const TOOL_ICONS: Record<DrawingType, React.ReactNode> = {
  cursor: <MousePointer2 className="size-3.5" />,
  trendline: <TrendingUp className="size-3.5" />,
  ray: <ArrowUpRight className="size-3.5" />,
  extended: <Minus className="size-3.5" />,
  hline: <MoveHorizontal className="size-3.5" />,
  vline: <MoveVertical className="size-3.5" />,
  channel: <PanelTop className="size-3.5" />,
  fib: <GitCompareArrows className="size-3.5" />,
  fibExt: <GitCompareArrows className="size-3.5" />,
  fibFan: <Fan className="size-3.5" />,
  fibTime: <Clock className="size-3.5" />,
  gannFan: <Sun className="size-3.5" />,
  pitchfork: <Forklift className="size-3.5" />,
  rect: <Square className="size-3.5" />,
  ellipse: <Circle className="size-3.5" />,
  text: <Type className="size-3.5" />,
  label: <Tag className="size-3.5" />,
  arrow: <ArrowUpRight className="size-3.5" />,
  measure: <Ruler className="size-3.5" />,
  abcd: <Shapes className="size-3.5" />,
  xabcd: <Shapes className="size-3.5" />,
  elliott: <Waves className="size-3.5" />,
};

const TOOL_LABELS: Record<DrawingType, string> = Object.fromEntries(
  DRAWING_TOOL_META.map((m) => [m.type, m.label]),
) as Record<DrawingType, string>;

const CHART_TYPE_ICONS: Record<ChartType, React.ReactNode> = {
  candle: <CandlestickChart className="size-3.5" />,
  line: <LineChart className="size-3.5" />,
  area: <AreaChart className="size-3.5" />,
  bar: <BarChart3 className="size-3.5" />,
  hollow: <CandlestickChart className="size-3.5" />,
  heikin: <CandlestickChart className="size-3.5" />,
  renko: <CandlestickChart className="size-3.5" />,
  baseline: <LineChart className="size-3.5" />,
  kagi: <LineChart className="size-3.5" />,
  pointfigure: <BarChart3 className="size-3.5" />,
  range: <BarChart3 className="size-3.5" />,
  linebreak: <LineChart className="size-3.5" />,
};

const COMPARE_OPTIONS = ["NIFTY 50", "SENSEX", "RELIANCE", "TCS", "HDFCBANK", "INFY", "SBIN", "TATAMOTORS"];

function ToolButton({
  label, active, onClick, children,
}: { label: string; active?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant={active ? "secondary" : "ghost"}
            size="icon-sm"
            aria-label={label}
            onClick={onClick}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export default function ChartToolbar({
  lookback, onLookbackChange, interval, onIntervalChange, chartType, onChartTypeChange,
  toggles, onToggleChange, activeTool, onToolChange, drawingColor, onDrawingColorChange,
  compare, onCompareChange, onReplay, onExport, onSnapshot, onFullscreen, onOpenSettings,
  onOpenAlerts, onOpenLayouts, onOpenTemplates, onOpenSymbolSearch, isFullscreen,
}: Props) {
  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-border/60 bg-background/80 px-2 py-1.5 backdrop-blur">
      {/* Lookback */}
      <div className="flex items-center gap-0.5">
        {LOOKBACKS.map((l) => (
          <Button
            key={l.value}
            variant={lookback === l.value ? "secondary" : "ghost"}
            size="xs"
            onClick={() => onLookbackChange(l.value)}
          >
            {l.label}
          </Button>
        ))}
      </div>

      <div className="mx-1 h-5 w-px bg-border" />

      {/* Interval */}
      <div className="flex items-center gap-0.5">
        {INTERVALS.map((i) => (
          <Button
            key={i.value}
            variant={interval === i.value ? "secondary" : "ghost"}
            size="xs"
            onClick={() => onIntervalChange(i.value)}
          >
            {i.label}
          </Button>
        ))}
      </div>

      <div className="mx-1 h-5 w-px bg-border" />

      {/* Chart type */}
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="sm" />}>
          {CHART_TYPE_ICONS[chartType]}
          <span className="hidden lg:inline">{chartType}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuGroup>
            <DropdownMenuLabel>Chart type</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={chartType} onValueChange={(v) => onChartTypeChange(v as ChartType)}>
              {CHART_TYPES.map((t) => (
                <DropdownMenuRadioItem key={t.value} value={t.value} closeOnClick>
                  {t.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Indicators — categorized (TradingView-style) */}
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="sm" />}>
          <LineChart className="size-3.5" />
          <span className="hidden lg:inline">Indicators</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="max-h-[28rem] w-56 overflow-y-auto">
          {INDICATOR_CATEGORIES.map((cat) => (
            <DropdownMenuGroup key={cat.label}>
              <DropdownMenuLabel>{cat.label}</DropdownMenuLabel>
              {cat.keys.map((k) => (
                <DropdownMenuCheckboxItem
                  key={k}
                  checked={toggles[k]}
                  onCheckedChange={(v) => onToggleChange(k, v)}
                >
                  {k}
                </DropdownMenuCheckboxItem>
              ))}
              <DropdownMenuSeparator />
            </DropdownMenuGroup>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <div className="mx-1 h-5 w-px bg-border" />

      {/* Drawing tools */}
      {(Object.keys(TOOL_ICONS) as DrawingType[]).map((t) => (
        <ToolButton
          key={t}
          label={TOOL_LABELS[t]}
          active={activeTool === t}
          onClick={() => onToolChange(activeTool === t ? "cursor" : t)}
        >
          {TOOL_ICONS[t]}
        </ToolButton>
      ))}
      <input
        type="color"
        value={drawingColor}
        onChange={(e) => onDrawingColorChange(e.target.value)}
        title="Drawing color"
        className="h-6 w-6 cursor-pointer rounded border border-border bg-transparent p-0.5"
      />

      <div className="mx-1 h-5 w-px bg-border" />

      {/* Compare */}
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="sm" />}>
          <GitCompareArrows className="size-3.5" />
          <span className="hidden lg:inline">Compare</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuGroup>
            <DropdownMenuLabel>Compare with</DropdownMenuLabel>
            {COMPARE_OPTIONS.map((s) => {
              const active = compare.some((c) => c.ticker === s);
              return (
                <DropdownMenuCheckboxItem
                  key={s}
                  checked={active}
                  onCheckedChange={(v) => {
                    if (v) onCompareChange([...compare, { ticker: s, color: `#${Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, "0")}`, data: [] }]);
                    else onCompareChange(compare.filter((c) => c.ticker !== s));
                  }}
                >
                  {s}
                </DropdownMenuCheckboxItem>
              );
            })}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <div className="flex-1" />

      {/* Actions */}
      <ToolButton label="Symbol search" onClick={onOpenSymbolSearch}>
        <Search className="size-3.5" />
      </ToolButton>
      <ToolButton label="Replay" onClick={onReplay}>
        <Play className="size-3.5" />
      </ToolButton>
      <ToolButton label="Alerts" onClick={onOpenAlerts}>
        <Bell className="size-3.5" />
      </ToolButton>
      <ToolButton label="Layouts" onClick={onOpenLayouts}>
        <LayoutGrid className="size-3.5" />
      </ToolButton>
      <ToolButton label="Templates" onClick={onOpenTemplates}>
        <Shapes className="size-3.5" />
      </ToolButton>
      <ToolButton label="Export PNG" onClick={onExport}>
        <Camera className="size-3.5" />
      </ToolButton>
      <ToolButton label="Snapshot" onClick={onSnapshot}>
        <Camera className="size-3.5" />
      </ToolButton>
      <ToolButton label={isFullscreen ? "Exit fullscreen" : "Fullscreen"} onClick={onFullscreen}>
        {isFullscreen ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
      </ToolButton>
      <ToolButton label="Settings" onClick={onOpenSettings}>
        <Settings2 className="size-3.5" />
      </ToolButton>
    </div>
  );
}