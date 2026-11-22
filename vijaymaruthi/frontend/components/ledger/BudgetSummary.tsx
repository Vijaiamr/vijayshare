'use client';
import React, { useState, useRef, useEffect } from 'react';
import { Target, AlertCircle, Sparkles, Edit3, BarChart3, X, Info, Percent, Wallet } from 'lucide-react';
import { BudgetRecommendation, Transaction } from '@/lib/ledger/types';
import { monthsSpanned } from '@/lib/ledger/period';
import GlassCard from './GlassCard';

interface BudgetSummaryProps {
  budgets: BudgetRecommendation[];
  transactions: Transaction[];
  onUpdateBudget?: (category: string, limitAmount: number) => void;
  periodLabel?: string;
  theme?: 'light' | 'dark';
}

export default function BudgetSummary({ budgets, transactions, theme = 'dark', onUpdateBudget, periodLabel = '' }: BudgetSummaryProps) {
  const isDark = theme === 'dark';
  const [editingCat, setEditingCat] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<string>('');
  const [showCalc, setShowCalc] = useState(false);
  const [calcIncome, setCalcIncome] = useState(0);
  const [calcPcts, setCalcPcts] = useState<Record<string, number>>({});
  const editRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (editingCat && editRef.current) editRef.current.focus(); }, [editingCat]);
  const totalAllocatedPct: number = (Object.values(calcPcts) as number[]).reduce((s, v) => s + v, 0);

  const actualCategorySpends = React.useMemo(() => {
    const map: Record<string, number> = {};
    transactions.forEach(t => {
      if (t.amount > 0) {
        (t.categories || ['Others']).forEach(cat => {
          if (cat !== 'Income') map[cat] = (map[cat] || 0) + t.amount;
        });
      }
    });
    return map;
  }, [transactions]);

  const totalIncome = React.useMemo(() => {
    return transactions.filter(t => t.amount < 0).reduce((sum, t) => sum + Math.abs(t.amount), 0);
  }, [transactions]);

  const categoriesForCalc = React.useMemo(() => {
    const set = new Set<string>();
    transactions.forEach(t => {
      if (t.amount > 0) (t.categories || ['Others']).forEach(c => { if (c !== 'Income') set.add(c); });
    });
    return Array.from(set).sort();
  }, [transactions]);

  const mergedBudgets = React.useMemo(() => {
    const configured = new Map(budgets.map(b => [b.category, b]));
    const allCats = new Set<string>();
    transactions.forEach(t => {
      if (t.amount > 0) (t.categories || ['Others']).forEach(c => { if (c !== 'Income') allCats.add(c); });
    });
    const result: BudgetRecommendation[] = [];
    allCats.forEach(cat => {
      if (configured.has(cat)) result.push(configured.get(cat)!);
      else {
        const monthlyIncome = totalIncome / monthsSpanned(transactions);
        const pct = 5;
        const limitAmount = Math.round(monthlyIncome * pct / 100);
        result.push({ category: cat, suggestedPercentage: pct, limitAmount: Math.max(limitAmount, 1000), currentSpend: actualCategorySpends[cat] || 0 });
      }
    });
    budgets.forEach(b => { if (!allCats.has(b.category)) result.push(b); });
    return result;
  }, [budgets, transactions, actualCategorySpends, totalIncome]);

  useEffect(() => {
    if (!showCalc) return;
    const monthly = totalIncome / monthsSpanned(transactions);
    setCalcIncome(Math.round(monthly));
    const initPcts: Record<string, number> = {};
    categoriesForCalc.forEach(c => { initPcts[c] = mergedBudgets.find(b => b.category === c)?.suggestedPercentage ?? 5; });
    setCalcPcts(initPcts);
  }, [showCalc]);

  return (<>
    <GlassCard theme={theme} className="p-5 h-full flex flex-col justify-between">
      <div>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-sm font-semibold tracking-tight flex items-center gap-2 text-foreground">
              <Target className="text-primary w-4 h-4" />
              Monthly Budgets
            </h2>
            <p className="text-[0.7rem] text-muted-foreground mt-0.5">
              {periodLabel ? `Spending vs budget · ${periodLabel}.` : 'Spending vs budget.'}
            </p>
          </div>
          {mergedBudgets.length > 0 && (
            <button onClick={() => setShowCalc(true)}
              className={`text-[10px] font-semibold px-2.5 py-1.5 rounded-lg border flex items-center gap-1 transition-all cursor-pointer bg-muted border-border text-muted-foreground hover:bg-muted/80`}
              title="View budget calculation breakdown">
              <BarChart3 className="w-3.5 h-3.5" />Calc
            </button>
          )}
        </div>

        {mergedBudgets.length === 0 ? (
          <div className="text-muted-foreground text-xs text-center py-12">No budgets set yet. Upload a statement or ledger to get started.</div>
        ) : (
          <div className="space-y-4 max-h-[360px] overflow-y-auto pr-1">
            {mergedBudgets.map((budget) => {
              const actual = actualCategorySpends[budget.category] || 0;
              const limit = budget.limitAmount || 1;
              // Budgets are monthly limits; normalize the period-total spend to
              // a monthly average so multi-month periods ("All Time") compare
              // fairly against the /mo limit.
              const actualMonthly = actual / monthsSpanned(transactions);
              const rawPct = Math.round((actualMonthly / limit) * 100);
              const capped = Math.min(rawPct, 999);
              // Visual hierarchy: <100% on track · 100–199% over · ≥200% critical.
              // The 999% cap is an exception state — labelled "Critical", never a literal ratio.
              const status = capped >= 200 ? 'critical' : capped >= 100 ? 'over' : 'on-track';
              let progressColor = 'bg-primary';
              let textColor = 'text-primary';
              let badgeColor = 'bg-primary/10 border-primary/30';
              let statusLabel = 'On track';
              if (status === 'critical') { progressColor = 'bg-strong-sell'; textColor = 'text-strong-sell'; badgeColor = 'bg-strong-sell/10 border-strong-sell/30'; statusLabel = 'Critical'; }
              else if (status === 'over') { progressColor = 'bg-hold'; textColor = 'text-hold'; badgeColor = 'bg-hold/10 border-hold/30'; statusLabel = 'Over budget'; }
              const isEditing = editingCat === budget.category;
              const handleEdit = () => { setEditingCat(budget.category); setEditValue(String(limit)); };
              return (
                <div id={`budget-item-${budget.category}`} key={budget.category} className="space-y-1.5">
                  <div className={`flex justify-between text-xs font-medium ${!isEditing ? 'cursor-pointer' : ''}`} onClick={!isEditing ? handleEdit : undefined}>
                    <span className="text-foreground">{budget.category}</span>
                    <div className="flex items-center gap-1.5">
                      <span className="text-muted-foreground text-[10px]">
                        ₹{actualMonthly.toLocaleString(undefined, { maximumFractionDigits: 0 })}/mo of 
                        {isEditing ? (
                          <input ref={editRef} type="number" value={editValue} onClick={e => e.stopPropagation()}
                            onChange={(e) => setEditValue(e.target.value)}
                            onBlur={() => { const val = parseInt(editValue); if (!isNaN(val) && val > 0 && onUpdateBudget) onUpdateBudget(budget.category, val); setEditingCat(null); }}
                            onKeyDown={(e) => { if (e.key === 'Enter') { const val = parseInt(editValue); if (!isNaN(val) && val > 0 && onUpdateBudget) onUpdateBudget(budget.category, val); setEditingCat(null); } if (e.key === 'Escape') setEditingCat(null); }}
                            className={`w-20 ml-1 px-1 py-0.5 text-[10px] rounded border bg-background border-input text-foreground`} />
                        ) : (
                          <span className="group inline-flex items-center gap-1">
                            <span className="underline decoration-dotted decoration-primary/40 hover:decoration-primary/80">₹{limit.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>/mo
                            <Edit3 className="w-2.5 h-2.5 opacity-0 group-hover:opacity-60 transition-opacity text-primary pointer-events-none" />
                          </span>
                        )}
                      </span>
                      <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-md border whitespace-nowrap ${badgeColor} ${textColor}`}>{capped}% {statusLabel}</span>
                    </div>
                  </div>
                  <div className={`h-2 w-full rounded-full overflow-hidden relative bg-muted border border-border`}>
                    <div className={`h-full rounded-full transition-all duration-500 ${progressColor}`} style={{ width: `${Math.min(capped, 100)}%` }} />
                  </div>
                  {status !== 'on-track' && (
                    <div className="flex items-center gap-1 text-[9px] text-strong-sell">
                      <AlertCircle className="w-3 h-3" /><span>Over budget by ₹{(actualMonthly - limit).toLocaleString('en-IN')}/mo</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className={`mt-4 pt-4 rounded-xl p-3 flex gap-2 items-start border bg-primary/5 border-primary/15`}>
        <Sparkles className="w-4 h-4 text-primary shrink-0 mt-0.5 animate-pulse" />
        <p className={`text-[10px] leading-relaxed font-normal text-muted-foreground`}>
          <span className={`font-semibold text-primary`}>Suggestion:</span> Budgets are suggested using the standard 50/30/20 rule to keep your spending on track.
        </p>
      </div>
    </GlassCard>

    {showCalc && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in" onClick={() => setShowCalc(false)}>
        <div className={`relative w-full max-w-lg max-h-[80vh] overflow-y-auto rounded-xl p-6 shadow-2xl border bg-popover border-border`} onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between mb-5">
            <h3 className={`text-base font-semibold flex items-center gap-1.5 text-foreground`}>
              <BarChart3 className="w-4 h-4 text-primary" />Budget Calculator
            </h3>
            <button onClick={() => setShowCalc(false)} className={`p-1 rounded-lg transition-all cursor-pointer text-muted-foreground hover:text-foreground hover:bg-muted`}>
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="space-y-4">
            <div className={`p-4 rounded-xl border bg-primary/5 border-primary/15`}>
              <label className={`text-xs font-semibold flex items-center gap-1.5 mb-2 text-primary`}>
                <Wallet className="w-4 h-4" />Monthly Income
              </label>
              <input type="number" value={calcIncome}
                onChange={e => {
                  const v = parseInt(e.target.value) || 0; setCalcIncome(v);
                  const newPcts: Record<string, number> = {};
                  categoriesForCalc.forEach(c => { newPcts[c] = Math.round((v > 0 ? (actualCategorySpends[c] || 0) / monthsSpanned(transactions) / v * 100 : 5)); });
                  setCalcPcts(newPcts);
                }}
                className={`w-full rounded-lg p-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring bg-background border border-input text-foreground`} />
            </div>
            <div className={`text-xs font-semibold text-muted-foreground mb-2`}>Category Budgets</div>
            {categoriesForCalc.map(cat => {
              const actual = actualCategorySpends[cat] || 0;
              const pct = calcPcts[cat] ?? 5;
              const calcLimit = Math.max(Math.round(calcIncome * pct / 100), 500);
              const usage = Math.min(Math.round((actual / monthsSpanned(transactions) / calcLimit) * 100), 999);
              return (
                <div key={cat} className={`p-3 rounded-xl border bg-muted/40 border-border`}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className={`text-xs font-semibold text-foreground`}>{cat}</span>
                    <span className={`text-[10px] font-semibold text-muted-foreground`}>₹{calcLimit.toLocaleString('en-IN')}/mo</span>
                  </div>
                  <div className="flex items-center gap-2 mb-1.5">
                    <input type="range" min={0} max={100} value={pct} onChange={e => setCalcPcts(prev => ({ ...prev, [cat]: parseInt(e.target.value) }))} className="flex-1 h-1.5 accent-primary cursor-pointer" />
                    <input type="number" value={pct} onChange={e => setCalcPcts(prev => ({ ...prev, [cat]: Math.max(0, Math.min(100, parseInt(e.target.value) || 0)) }))} className={`w-14 text-center text-[10px] rounded-lg p-1 border bg-background border-input text-foreground`} />
                    <span className="text-[10px] text-muted-foreground">%</span>
                  </div>
                  <div className="flex items-center gap-2 text-[10px] flex-wrap">
                    <span className="text-muted-foreground">₹{Math.round(actual / monthsSpanned(transactions)).toLocaleString('en-IN')}/mo actual</span>
                    <div className={`h-1 flex-1 rounded-full overflow-hidden bg-muted`}>
                      <div className={`h-full rounded-full ${usage >= 100 ? 'bg-strong-sell' : usage >= 80 ? 'bg-hold' : 'bg-primary'}`} style={{ width: `${Math.min(usage, 100)}%` }} />
                    </div>
                    <span className={`${usage >= 100 ? 'text-strong-sell' : 'text-muted-foreground'}`}>{usage}%</span>
                  </div>
                </div>
              );
            })}
            {categoriesForCalc.length > 0 && (
              <button onClick={() => { categoriesForCalc.forEach(cat => { const pct = calcPcts[cat] ?? 5; const calcLimit = Math.max(Math.round(calcIncome * pct / 100), 500); if (onUpdateBudget) onUpdateBudget(cat, calcLimit); }); setShowCalc(false); }}
                className="w-full bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg py-2.5 text-xs font-semibold transition-all cursor-pointer">
                Apply Calculated Budgets
              </button>
            )}
            <div className={`p-3 rounded-xl border flex items-center gap-2 bg-muted/40 border-border`}>
              <Percent className="w-4 h-4 text-primary shrink-0" />
              <div className="text-[11px] flex-1">
                <span className="text-muted-foreground">Total allocated: <strong className="text-foreground">{totalAllocatedPct}%</strong> of ₹{calcIncome.toLocaleString('en-IN')}/mo</span>
                <div className={`h-1.5 w-full rounded-full overflow-hidden mt-1 bg-muted`}>
                  <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(totalAllocatedPct, 100)}%` }} />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    )}
  </>);
}