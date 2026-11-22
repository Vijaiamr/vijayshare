'use client';
import React, { useMemo, useState } from 'react';
import { HeartPulse, TrendingUp, Wallet, Target, CalendarCheck } from 'lucide-react';
import { Transaction, BudgetRecommendation } from '@/lib/ledger/types';
import { monthsSpanned } from '@/lib/ledger/period';
import GlassCard from './GlassCard';

interface FinancialHealthProps {
  transactions: Transaction[];
  budgets: BudgetRecommendation[];
  theme?: 'light' | 'dark';
}

export interface HealthDimension {
  key: 'savings' | 'spending' | 'budgeting' | 'consistency';
  label: string;
  status: 'Strong' | 'Moderate' | 'Weak' | 'Critical';
  score: number;
  detail: string;
}

type Status = HealthDimension['status'];

function statusFor(score: number, bands: [number, Status][]): Status {
  for (const [min, s] of bands) {
    if (score >= min) return s;
  }
  return 'Critical';
}

/**
 * Financial Health — 4 explainable dimensions, all derived from real data:
 *
 *  Savings     → savings rate (net ÷ income)
 *  Spending    → spend ratio (expenses ÷ income)
 *  Budgeting   → % of budget categories within their monthly limit
 *  Consistency → account activity across months (income + expense coverage)
 *
 * Overall = 0.30×Savings + 0.25×Spending + 0.25×Budgeting + 0.20×Consistency.
 */
export function computeFinancialHealth(
  transactions: Transaction[],
  budgets: BudgetRecommendation[],
): { score: number; dimensions: HealthDimension[] } {
  if (transactions.length === 0) {
    return {
      score: 0,
      dimensions: [
        { key: 'savings', label: 'Savings', status: 'Critical', score: 0, detail: 'No data loaded yet.' },
        { key: 'spending', label: 'Spending', status: 'Critical', score: 0, detail: 'No data loaded yet.' },
        { key: 'budgeting', label: 'Budgeting', status: 'Critical', score: 0, detail: 'No data loaded yet.' },
        { key: 'consistency', label: 'Consistency', status: 'Critical', score: 0, detail: 'No data loaded yet.' },
      ],
    };
  }

  // ── Month span + monthly aggregates ─────────────────────────────────────
  let totalIncome = 0, totalSpent = 0;
  const catSpend: Record<string, number> = {};
  const monthsWithIncome = new Set<string>();
  const monthsWithExpense = new Set<string>();

  transactions.forEach(t => {
    const month = t.date.slice(0, 7);
    if (t.amount < 0) {
      totalIncome += Math.abs(t.amount);
      monthsWithIncome.add(month);
    } else {
      totalSpent += t.amount;
      monthsWithExpense.add(month);
      (t.categories || ['Others']).forEach(c => {
        if (c !== 'Income') catSpend[c] = (catSpend[c] || 0) + t.amount;
      });
    }
  });

  const totalMonths = monthsSpanned(transactions);

  // ── Savings ─────────────────────────────────────────────────────────────
  const savingsRate = totalIncome > 0 ? (totalIncome - totalSpent) / totalIncome : 0;
  const savingsScore = savingsRate >= 0.3 ? 85 : savingsRate >= 0.2 ? 70 : savingsRate >= 0.1 ? 55 : 35;
  const savingsStatus = statusFor(savingsScore, [[85, 'Strong'], [70, 'Moderate'], [55, 'Weak'], [35, 'Critical']]);

  // ── Spending ────────────────────────────────────────────────────────────
  const spendRatio = totalIncome > 0 ? totalSpent / totalIncome : 1;
  const spendingScore = spendRatio <= 0.4 ? 90 : spendRatio <= 0.6 ? 70 : spendRatio <= 0.75 ? 50 : 30;
  const spendingStatus = statusFor(spendingScore, [[90, 'Strong'], [70, 'Moderate'], [50, 'Weak'], [30, 'Critical']]);

  // ── Budgeting ───────────────────────────────────────────────────────────
  // Merge configured budgets with fallbacks for every spending category
  // (5% of monthly income, min ₹1,000) — mirrors BudgetSummary.
  const monthlyIncome = totalIncome / totalMonths;
  const configured = new Map(budgets.map(b => [b.category, b.limitAmount]));
  const allCats = Object.keys(catSpend);
  let withinLimit = 0;
  allCats.forEach(cat => {
    const limit = configured.get(cat) ?? Math.max(Math.round(monthlyIncome * 0.05), 1000);
    // Budgets are monthly limits; compare against the monthly-average spend.
    if (limit > 0 && (catSpend[cat] || 0) / totalMonths <= limit) withinLimit++;
  });
  const adherence = allCats.length > 0 ? withinLimit / allCats.length : 0;
  const budgetingScore = Math.round(adherence * 100);
  const budgetingStatus = statusFor(budgetingScore, [[80, 'Strong'], [60, 'Moderate'], [40, 'Weak'], [0, 'Critical']]);

  // ── Consistency ─────────────────────────────────────────────────────────
  const incomeMonths = monthsWithIncome.size;
  const expenseMonths = monthsWithExpense.size;
  const consistencyScore = Math.round((100 * (incomeMonths + expenseMonths)) / (2 * totalMonths));
  const consistencyStatus = statusFor(consistencyScore, [[70, 'Strong'], [50, 'Moderate'], [30, 'Weak'], [0, 'Critical']]);

  const dimensions: HealthDimension[] = [
    {
      key: 'savings', label: 'Savings', status: savingsStatus, score: savingsScore,
      detail: `Saving ${Math.round(savingsRate * 100)}% of income`,
    },
    {
      key: 'spending', label: 'Spending', status: spendingStatus, score: spendingScore,
      detail: `Spending ${Math.round(spendRatio * 100)}% of income`,
    },
    {
      key: 'budgeting', label: 'Budgeting', status: budgetingStatus, score: budgetingScore,
      detail: `${withinLimit} of ${allCats.length} categories within budget`,
    },
    {
      key: 'consistency', label: 'Consistency', status: consistencyStatus, score: consistencyScore,
      detail: `Income in ${incomeMonths} of ${totalMonths} months · Active ${expenseMonths} of ${totalMonths}`,
    },
  ];

  const score = Math.round(0.3 * savingsScore + 0.25 * spendingScore + 0.25 * budgetingScore + 0.2 * consistencyScore);
  return { score, dimensions };
}

const STATUS_STYLES: Record<Status, { badge: string; bar: string; text: string }> = {
  Strong: { badge: 'text-primary bg-primary/10 border-primary/30', bar: 'bg-primary', text: 'text-primary' },
  Moderate: { badge: 'text-hold bg-hold/10 border-hold/30', bar: 'bg-hold', text: 'text-hold' },
  Weak: { badge: 'text-strong-sell bg-strong-sell/10 border-strong-sell/30', bar: 'bg-strong-sell', text: 'text-strong-sell' },
  Critical: { badge: 'text-strong-sell bg-strong-sell/15 border-strong-sell/40', bar: 'bg-strong-sell', text: 'text-strong-sell' },
};

const DIMENSION_ICONS: Record<HealthDimension['key'], React.ReactNode> = {
  savings: <TrendingUp className="w-3.5 h-3.5" />,
  spending: <Wallet className="w-3.5 h-3.5" />,
  budgeting: <Target className="w-3.5 h-3.5" />,
  consistency: <CalendarCheck className="w-3.5 h-3.5" />,
};

export default function FinancialHealth({ transactions, budgets, theme = 'dark' }: FinancialHealthProps) {
  const isDark = theme === 'dark';
  const [showFactors, setShowFactors] = useState(false);
  const { score, dimensions } = useMemo(() => computeFinancialHealth(transactions, budgets), [transactions, budgets]);

  // Explainable factors — derived from the same data as the score, never
  // fabricated. Positive = what is working; Attention = what needs review.
  const factors = useMemo(() => {
    const positive: string[] = [];
    const attention: string[] = [];
    if (transactions.length === 0) return { positive, attention };

    let totalIncome = 0, totalSpent = 0;
    const catSpend: Record<string, number> = {};
    const monthsWithIncome = new Set<string>();
    const monthsWithExpense = new Set<string>();
    transactions.forEach(t => {
      const month = t.date.slice(0, 7);
      if (t.amount < 0) { totalIncome += Math.abs(t.amount); monthsWithIncome.add(month); }
      else {
        totalSpent += t.amount; monthsWithExpense.add(month);
        (t.categories || ['Others']).forEach(c => { if (c !== 'Income') catSpend[c] = (catSpend[c] || 0) + t.amount; });
      }
    });

    const savingsRate = totalIncome > 0 ? (totalIncome - totalSpent) / totalIncome : 0;
    if (savingsRate >= 0.2) positive.push(`Strong savings rate of ${Math.round(savingsRate * 100)}%`);
    else if (totalIncome > 0) attention.push(`Savings rate of ${Math.round(savingsRate * 100)}% is below the 20% target`);

    if (monthsWithIncome.size > 0 && monthsWithIncome.size === monthsWithExpense.size) positive.push('Consistent income and activity across all months');
    if ((catSpend['Investment'] || 0) > 0) positive.push(`Regular investment of ₹${Math.round(catSpend['Investment']).toLocaleString('en-IN')}`);

    const configured = new Map(budgets.map(b => [b.category, b.limitAmount]));
    const span = monthsSpanned(transactions);
    const monthlyIncome = totalIncome / Math.max(1, span);
    const overBudget: { cat: string; overage: number }[] = [];
    Object.entries(catSpend).forEach(([cat, spent]) => {
      const limit = configured.get(cat) ?? Math.max(Math.round(monthlyIncome * 0.05), 1000);
      // Budgets are monthly limits; compare against the monthly-average spend.
      if (limit > 0 && spent / span > limit) overBudget.push({ cat, overage: spent / span - limit });
    });
    overBudget.sort((a, b) => b.overage - a.overage);
    overBudget.slice(0, 3).forEach(o => attention.push(`${o.cat} is ₹${Math.round(o.overage).toLocaleString('en-IN')}/mo over budget`));

    const commitmentShare = totalSpent > 0 ? (catSpend['Commitment'] || 0) / totalSpent : 0;
    if (commitmentShare > 0.4) attention.push(`Commitment allocation is ${Math.round(commitmentShare * 100)}% of outflow — review fixed costs`);

    return { positive, attention };
  }, [transactions, budgets]);

  const scoreColor = score >= 70 ? 'text-primary' : score >= 50 ? 'text-hold' : 'text-strong-sell';
  const ringColor = score >= 70 ? 'stroke-primary' : score >= 50 ? 'stroke-hold' : 'stroke-strong-sell';

  return (
    <GlassCard id="financial-health" theme={theme} className="p-5 h-full flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold tracking-tight flex items-center gap-2 text-foreground">
          <HeartPulse className="text-primary w-4 h-4" />
          Financial Health
        </h2>
        <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium border ${score >= 70 ? 'text-primary bg-primary/10 border-primary/30' : score >= 50 ? 'text-hold bg-hold/10 border-hold/30' : 'text-strong-sell bg-strong-sell/10 border-strong-sell/30'}`}>
          {score >= 70 ? 'Healthy' : score >= 50 ? 'Watch' : 'At risk'}
        </span>
      </div>

      <div className="flex items-center gap-5 mb-5">
        {/* Score ring — click to reveal the factors behind the score */}
        <button
          onClick={() => setShowFactors(v => !v)}
          className="relative w-24 h-24 shrink-0 cursor-pointer group"
          title={showFactors ? 'Hide factors' : 'Show what drives this score'}
          aria-expanded={showFactors}
        >
          <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
            <circle cx="50" cy="50" r="42" fill="none" strokeWidth="9" className="stroke-muted" />
            <circle
              cx="50" cy="50" r="42" fill="none" strokeWidth="9" strokeLinecap="round"
              className={`${ringColor} transition-all duration-700 group-hover:opacity-80`}
              strokeDasharray={`${(score / 100) * 264} 264`}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className={`text-2xl font-semibold font-mono tracking-tight ${scoreColor}`}>{score}</span>
            <span className="text-[9px] text-muted-foreground font-medium">/ 100</span>
          </div>
        </button>

        <div className="min-w-0">
          <p className="text-xs font-semibold text-foreground mb-1">Overall score</p>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {score >= 70
              ? 'Your finances are in good shape. Keep the momentum going.'
              : score >= 50
                ? 'Some areas need attention — focus on the weak dimensions below.'
                : 'Your finances need immediate attention. Review the weak areas below.'}
          </p>
          <button onClick={() => setShowFactors(v => !v)}
            className="mt-2 text-[10px] font-semibold text-primary hover:text-primary/80 flex items-center gap-1 cursor-pointer">
            {showFactors ? 'Hide factors' : 'Show what drives this score'}
            <span className={`transition-transform duration-150 ${showFactors ? 'rotate-180' : ''}`}>▾</span>
          </button>
        </div>
      </div>

      {/* Explainable factors — positive vs attention */}
      {showFactors && (
        <div className="mb-4 grid grid-cols-1 sm:grid-cols-2 gap-3 animate-fade-in">
          <div className={`rounded-lg border p-3 ${isDark ? 'border-primary/25 bg-primary/5' : 'border-primary/25 bg-primary/5'}`}>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-primary mb-2">Positive</p>
            {factors.positive.length === 0 ? (
              <p className="text-[10px] text-muted-foreground">No positive signals detected yet.</p>
            ) : (
              <ul className="space-y-1.5">
                {factors.positive.map((f, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-[11px] text-foreground">
                    <span className="text-primary shrink-0 mt-0.5">✓</span>{f}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className={`rounded-lg border p-3 ${isDark ? 'border-hold/25 bg-hold/5' : 'border-hold/25 bg-hold/5'}`}>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-hold mb-2">Attention</p>
            {factors.attention.length === 0 ? (
              <p className="text-[10px] text-muted-foreground">Nothing needs attention right now.</p>
            ) : (
              <ul className="space-y-1.5">
                {factors.attention.map((f, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-[11px] text-foreground">
                    <span className="text-hold shrink-0 mt-0.5">!</span>{f}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* Dimensions — 2-col grid in the wide layout, stacked on mobile */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {dimensions.map(dim => {
          const s = STATUS_STYLES[dim.status];
          return (
            <div key={dim.key} className={`rounded-lg border p-3 ${isDark ? 'border-border bg-muted/30' : 'border-border bg-muted/30'}`}>
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <span className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                  <span className={`${s.text}`}>{DIMENSION_ICONS[dim.key]}</span>
                  {dim.label}
                </span>
                <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full border ${s.badge}`}>{dim.status}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-1.5 flex-1 rounded-full overflow-hidden bg-muted">
                  <div className={`h-full rounded-full transition-all duration-500 ${s.bar}`} style={{ width: `${dim.score}%` }} />
                </div>
                <span className="text-[10px] font-mono text-muted-foreground w-7 text-right">{dim.score}</span>
              </div>
              <p className="text-[10px] text-muted-foreground mt-1.5">{dim.detail}</p>
            </div>
          );
        })}
      </div>
    </GlassCard>
  );
}