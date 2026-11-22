'use client';
import React, { useState, useRef, useEffect } from 'react';
import { CalendarRange, ChevronDown, ChevronLeft, ChevronRight, Check } from 'lucide-react';
import { PeriodSelection, periodLabel, shiftMonth, shiftYear } from '@/lib/ledger/period';

interface PeriodSelectorProps {
  selection: PeriodSelection;
  onChange: (sel: PeriodSelection) => void;
  months: string[];
  years: string[];
  theme?: 'light' | 'dark';
}

/**
 * Global period selector — the single source of truth for the ledger page.
 * Lets the user pick a specific month, a year, or All Time, and switch between
 * Monthly / Yearly / All Time views.
 */
export default function PeriodSelector({ selection, onChange, months, years, theme = 'dark' }: PeriodSelectorProps) {
  const isDark = theme === 'dark';
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const label = periodLabel(selection);

  const select = (sel: PeriodSelection) => {
    onChange(sel);
    setOpen(false);
  };

  const step = (delta: number) => {
    if (selection.view === 'monthly' && selection.key) {
      select({ view: 'monthly', key: shiftMonth(selection.key, delta) });
    } else if (selection.view === 'yearly' && selection.key) {
      select({ view: 'yearly', key: shiftYear(selection.key, delta) });
    }
  };

  return (
    <div className="flex items-center gap-1.5">
      {/* Prev / Next arrows (monthly & yearly only) */}
      {selection.view !== 'all' && selection.key && (
        <button id="period-prev" onClick={() => step(-1)}
          className="p-2 rounded-lg border border-border bg-card text-muted-foreground hover:text-foreground hover:border-primary/40 transition-all cursor-pointer"
          title="Previous period">
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>
      )}

      <div ref={ref} className="relative">
        <button
          id="period-selector"
          onClick={() => setOpen(v => !v)}
          className="flex items-center gap-2 text-xs border border-border font-medium px-3 py-2 rounded-lg cursor-pointer transition-all bg-card text-foreground hover:border-primary/40"
          title="Select the period for the entire ledger"
        >
          <CalendarRange className="w-3.5 h-3.5 text-primary" />
          <span className="font-semibold">{label}</span>
          <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>

        {open && (
          <div className="absolute left-0 md:left-auto md:right-0 mt-2 w-64 rounded-xl border border-border bg-popover shadow-2xl z-50 overflow-hidden">
            {/* View toggle */}
            <div className="flex p-1.5 gap-1 border-b border-border bg-muted/40">
              {(['monthly', 'yearly', 'all'] as const).map(v => (
                <button key={v} onClick={() => select({ view: v, key: v === 'all' ? null : (v === 'yearly' ? (years[years.length - 1] || null) : (months[months.length - 1] || null)) })}
                  className={`flex-1 px-2 py-1.5 rounded-md text-[11px] font-semibold capitalize transition-all cursor-pointer ${selection.view === v ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground'}`}>
                  {v === 'all' ? 'All Time' : v}
                </button>
              ))}
            </div>

            {/* Month list */}
            {selection.view === 'monthly' && (
              <div className="max-h-56 overflow-y-auto p-1.5">
                {months.length === 0 && <p className="text-[11px] text-muted-foreground p-2">No months in data yet.</p>}
                {months.slice().reverse().map(m => {
                  const [y, mo] = m.split('-').map(Number);
                  const lbl = new Date(y, mo - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
                  const active = selection.key === m;
                  return (
                    <button key={m} onClick={() => select({ view: 'monthly', key: m })}
                      className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-md text-xs transition-all cursor-pointer ${active ? 'bg-primary/15 text-primary font-semibold' : 'text-foreground hover:bg-muted'}`}>
                      {lbl}
                      {active && <Check className="w-3.5 h-3.5" />}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Year list */}
            {selection.view === 'yearly' && (
              <div className="max-h-56 overflow-y-auto p-1.5">
                {years.length === 0 && <p className="text-[11px] text-muted-foreground p-2">No years in data yet.</p>}
                {years.slice().reverse().map(y => {
                  const active = selection.key === y;
                  return (
                    <button key={y} onClick={() => select({ view: 'yearly', key: y })}
                      className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-md text-xs transition-all cursor-pointer ${active ? 'bg-primary/15 text-primary font-semibold' : 'text-foreground hover:bg-muted'}`}>
                      {y}
                      {active && <Check className="w-3.5 h-3.5" />}
                    </button>
                  );
                })}
              </div>
            )}

            {selection.view === 'all' && (
              <div className="p-3 text-[11px] text-muted-foreground">
                Showing the entire uploaded dataset across all periods.
              </div>
            )}
          </div>
        )}
      </div>

      {/* Next arrow */}
      {selection.view !== 'all' && selection.key && (
        <button id="period-next" onClick={() => step(1)}
          className="p-2 rounded-lg border border-border bg-card text-muted-foreground hover:text-foreground hover:border-primary/40 transition-all cursor-pointer"
          title="Next period">
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}
