'use client';
import React, { useState, useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, AreaChart, Area, LineChart, Line,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Legend
} from 'recharts';
import { TrendingUp, PieChart as PieIcon, BarChart3, CalendarDays, Sparkles, ArrowDownWideNarrow, ArrowUpWideNarrow, ArrowUpAZ, RotateCcw, HeartPulse, Database, FileSpreadsheet, CalendarRange, IndianRupee, Clock } from 'lucide-react';
import { Transaction, BudgetRecommendation } from '@/lib/ledger/types';
import { formatCompactLakh } from '@/lib/ledger/merchant';
import { monthsSpanned } from '@/lib/ledger/period';
import GlassCard from './GlassCard';
import FinancialHealth from './FinancialHealth';

interface ChartsDashboardProps {
  transactions: Transaction[];
  budgets: BudgetRecommendation[];
  period?: string;
  lastProcessed?: string;
  isSampleActive?: boolean;
  periodLabel?: string;
  periodView?: 'monthly' | 'yearly' | 'all';
  theme?: 'light' | 'dark';
}

// Categorical palette anchored on the app's chart tokens (emerald-led,
// desaturated complements). Matches the Institutional Terminal ramp.
// Restrained by design — semantic hues only, no neon.
const PALETTE = ['#10b981', '#e8b105', '#ee8b2c', '#f05252', '#0ea5e9', '#8b5cf6', '#14b8a6', '#84cc16', '#f97316', '#ec4899', '#06b6d4', '#a855f7'];

function catColor(name: string, idx: number): string {
  const staticMap: Record<string, string> = {
    'Food & Dining': '#10b981', 'Utilities & Bills': '#0ea5e9', 'Entertainment': '#8b5cf6',
    'Shopping': '#e8b105', 'Travel & Transport': '#14b8a6', 'Health & Wellness': '#ec4899',
    'Commitment': '#f97316', 'Loan': '#f04e4e', 'ATM': '#06b6d4', 'Investment': '#0e8a5f',
    'Income': '#10b981', 'Others': '#6b7280',
  };
  return staticMap[name] || PALETTE[idx % PALETTE.length];
}

export default function ChartsDashboard({ transactions, budgets, period = '—', lastProcessed = '—', isSampleActive = false, periodLabel = '', periodView = 'monthly', theme = 'dark' }: ChartsDashboardProps) {
  const isDark = theme === 'dark';
  const [activeTab, setActiveTab] = useState<'category' | 'trends' | 'budgets' | 'projection' | 'health'>('category');
  const [categoryFormat, setCategoryFormat] = useState<'pie' | 'donut' | 'bar'>('donut');
  const [trendFormat, setTrendFormat] = useState<'line' | 'area'>('line');
  const [budgetFormat, setBudgetFormat] = useState<'bar' | 'radar'>('bar');
  const [projectionFormat, setProjectionFormat] = useState<'comparison' | 'composition'>('comparison');
  const [hiddenCats, setHiddenCats] = useState<Set<string>>(new Set());
  const [legendSort, setLegendSort] = useState<'value-desc' | 'value-asc' | 'name'>('value-desc');

  const categoryData = useMemo(() => {
    const map: Record<string, number> = {};
    transactions.forEach(t => {
      if (t.amount > 0) {
        (t.categories || ['Others']).forEach(cat => {
          if (cat !== 'Income') map[cat] = (map[cat] || 0) + t.amount;
        });
      }
    });
    return Object.entries(map)
      .map(([name, value], idx) => ({ name, value: parseFloat(value.toFixed(2)), color: catColor(name, idx) }))
      .sort((a, b) => b.value - a.value);
  }, [transactions]);

  // Category view: visibility-filtered + sortable slice set (donut/pie/bar).
  const visibleCategoryData = useMemo(() => {
    let data = categoryData.filter(d => !hiddenCats.has(d.name));
    if (legendSort === 'value-asc') data = [...data].sort((a, b) => a.value - b.value);
    else if (legendSort === 'name') data = [...data].sort((a, b) => a.name.localeCompare(b.name));
    else data = [...data].sort((a, b) => b.value - a.value);
    return data;
  }, [categoryData, hiddenCats, legendSort]);

  const categoryTotal = useMemo(() => categoryData.reduce((s, d) => s + d.value, 0), [categoryData]);

  // True total spent (each transaction counted once) — the donut's center
  // metric. Category slices can sum higher because multi-category transactions
  // are counted per category; the center always shows the honest total.
  const totalSpent = useMemo(
    () => transactions.reduce((s, t) => s + (t.amount > 0 ? t.amount : 0), 0),
    [transactions],
  );

  const toggleCategory = (name: string) => {
    setHiddenCats(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  };

  const dailyData = useMemo(() => {
    const map: Record<string, { spent: number; income: number }> = {};
    transactions.forEach(t => {
      const dateStr = t.date;
      if (!map[dateStr]) map[dateStr] = { spent: 0, income: 0 };
      if (t.amount > 0) map[dateStr].spent += t.amount;
      else map[dateStr].income += Math.abs(t.amount);
    });
    const sortedDates = Object.keys(map).sort();
    let cumulativeSpend = 0;
    return sortedDates.map(date => {
      cumulativeSpend += map[date].spent;
      const parsedDate = new Date(date);
      const formattedDate = parsedDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
      return {
        date, formattedDate,
        spent: parseFloat(map[date].spent.toFixed(2)),
        income: parseFloat(map[date].income.toFixed(2)),
        cumulative: parseFloat(cumulativeSpend.toFixed(2))
      };
    });
  }, [transactions]);

  // Yearly view: aggregate spend/income by calendar month (Jan → Dec).
  const monthlyData = useMemo(() => {
    const map: Record<string, { spent: number; income: number }> = {};
    transactions.forEach(t => {
      const m = t.date?.slice(0, 7);
      if (!m) return;
      if (!map[m]) map[m] = { spent: 0, income: 0 };
      if (t.amount > 0) map[m].spent += t.amount;
      else map[m].income += Math.abs(t.amount);
    });
    const sortedMonths = Object.keys(map).sort();
    let cumulativeSpend = 0;
    return sortedMonths.map(m => {
      cumulativeSpend += map[m].spent;
      const [y, mo] = m.split('-').map(Number);
      // Build at UTC midnight so the label matches the data's month on every
      // host timezone (local-midnight construction + UTC formatting shifted
      // the label back one month on UTC+ahead hosts).
      const formattedDate = new Date(Date.UTC(y, mo - 1, 1)).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
      return {
        date: m, formattedDate,
        spent: parseFloat(map[m].spent.toFixed(2)),
        income: parseFloat(map[m].income.toFixed(2)),
        cumulative: parseFloat(cumulativeSpend.toFixed(2))
      };
    });
  }, [transactions]);

  const trendsData = periodView === 'yearly' ? monthlyData : dailyData;

  const budgetComparisonData = useMemo(() => {
    // Budgets are monthly limits; normalize the period-total spend to a
    // monthly average so the chart compares like-for-like on any period.
    const span = monthsSpanned(transactions);
    return budgets.map((b, idx) => {
      const actual = transactions
        .filter(t => (t.categories || []).includes(b.category) && t.amount > 0)
        .reduce((sum, t) => sum + t.amount, 0);
      return {
        category: b.category,
        Budget: parseFloat(b.limitAmount.toFixed(2)),
        Spent: parseFloat((actual / span).toFixed(2)),
        color: catColor(b.category, idx)
      };
    });
  }, [budgets, transactions]);

  const daysSpanned = useMemo(() => {
    const expenseTx = transactions.filter(t => t.amount > 0 && !(t.categories || []).includes('Income'));
    if (expenseTx.length === 0) return 30;
    const dates = expenseTx.map(t => new Date(t.date).getTime());
    const diffTime = Math.abs(Math.max(...dates) - Math.min(...dates));
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays > 0 ? diffDays : 30;
  }, [transactions]);

  const projectionData = useMemo(() => {
    const cats = new Set<string>();
    transactions.forEach(t => {
      if (t.amount > 0) (t.categories || ['Others']).forEach(c => { if (c !== 'Income') cats.add(c); });
    });
    const categories = Array.from(cats);
    return categories.map((cat, idx) => {
      const catTx = transactions.filter(t => t.amount > 0 && (t.categories || []).includes(cat));
      const actualSpent = catTx.reduce((sum, t) => sum + t.amount, 0);
      const recurringSpent = catTx.filter(t => t.recurring).reduce((sum, t) => sum + t.amount, 0);
      const nonRecurringSpent = catTx.filter(t => !t.recurring).reduce((sum, t) => sum + t.amount, 0);
      const scaleDays = Math.max(daysSpanned, 15);
      const projectedNonRecurring = (nonRecurringSpent / scaleDays) * 30;
      const projectedSpent = recurringSpent + projectedNonRecurring;
      return {
        category: cat,
        'Current Spend': parseFloat(actualSpent.toFixed(2)),
        'Projected Spend': parseFloat(projectedSpent.toFixed(2)),
        'Fixed/Recurring': parseFloat(recurringSpent.toFixed(2)),
        'Variable (Projected)': parseFloat(projectedNonRecurring.toFixed(2)),
        color: catColor(cat, idx)
      };
    }).sort((a, b) => b['Projected Spend'] - a['Projected Spend']);
  }, [transactions, daysSpanned]);

  const projectionSummary = useMemo(() => {
    let totalProjected = 0, totalRecurring = 0;
    projectionData.forEach(p => { totalProjected += p['Projected Spend']; totalRecurring += p['Fixed/Recurring']; });
    const recurringPercentage = totalProjected > 0 ? (totalRecurring / totalProjected) * 100 : 0;
    return { totalProjected, totalRecurring, recurringPercentage: parseFloat(recurringPercentage.toFixed(1)) };
  }, [projectionData]);

  const GlassyTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className={`border px-3 py-2.5 rounded-lg text-xs shadow-xl bg-popover border-border text-foreground`}>
          <p className={`font-semibold mb-1 text-muted-foreground`}>{label}</p>
          {payload.map((p: any, i: number) => (
            <div key={i} className="flex items-center gap-2 mt-0.5">
              <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: p.color || p.fill }} />
              <span className="text-muted-foreground">{p.name}:</span>
              <span className={`font-bold text-foreground`}>₹{Number(p.value).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>
          ))}
        </div>
      );
    }
    return null;
  };

  // Format toggle options per tab — rendered as a compact overlay pill.
  // The health tab has no chart formats — it renders Health + Provenance.
  const formatOptions: { id: string; label: string; active: boolean; onClick: () => void }[] =
    activeTab === 'category'
      ? ([['donut', 'Donut'], ['pie', 'Pie'], ['bar', 'Bars']] as const).map(([f, label]) => ({ id: `btn-cat-${f}`, label, active: categoryFormat === f, onClick: () => setCategoryFormat(f) }))
      : activeTab === 'trends'
        ? ([['line', 'Line'], ['area', 'Area']] as const).map(([f, label]) => ({ id: `btn-trend-${f}`, label, active: trendFormat === f, onClick: () => setTrendFormat(f) }))
        : activeTab === 'budgets'
          ? ([['bar', 'Bars'], ['radar', 'Radar']] as const).map(([f, label]) => ({ id: `btn-budget-${f}`, label, active: budgetFormat === f, onClick: () => setBudgetFormat(f) }))
          : activeTab === 'projection'
            ? ([['comparison', 'Current vs Projected'], ['composition', 'Composition']] as const).map(([f, label]) => ({ id: `btn-projection-${f}`, label, active: projectionFormat === f, onClick: () => setProjectionFormat(f) }))
            : [];

  const hasData = activeTab === 'category' ? categoryData.length > 0
    : activeTab === 'trends' ? trendsData.length > 0
    : activeTab === 'budgets' ? budgetComparisonData.length > 0
    : activeTab === 'projection' ? projectionData.length > 0
    : true; // health tab always renders (empty states included)

  return (
    <GlassCard theme={theme} className="p-5">
      <div className={`flex flex-col md:flex-row md:items-center justify-between gap-3 mb-4 pb-3 border-b border-border`}>
        <div>
          <h2 className="text-sm font-semibold tracking-tight flex items-center gap-2 text-foreground">
            <BarChart3 className="text-primary w-4 h-4" />
            Spending Analysis
          </h2>
          <p className="text-[0.7rem] text-muted-foreground mt-0.5">
            Understand where your money is going
            {periodLabel ? (
              <span className="block">· {periodLabel}</span>
            ) : null}
          </p>
        </div>
        <div className={`flex flex-wrap p-0.5 rounded-lg text-xs self-start md:self-auto bg-muted border border-border`}>
          {(['category', 'trends', 'budgets', 'projection', 'health'] as const).map(tab => (
            <button key={tab} id={`tab-chart-${tab}`} onClick={() => setActiveTab(tab)}
              className={`px-2.5 py-1.5 rounded-md flex items-center gap-1.5 font-medium transition-all cursor-pointer ${activeTab === tab ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground'}`}
            >
              {tab === 'category' && <><PieIcon className="w-3.5 h-3.5" />Category</>}
              {tab === 'trends' && <><TrendingUp className="w-3.5 h-3.5" />Trends</>}
              {tab === 'budgets' && <><CalendarDays className="w-3.5 h-3.5" />Budgets</>}
              {tab === 'projection' && <><Sparkles className="w-3.5 h-3.5" />Projection</>}
              {tab === 'health' && <><HeartPulse className="w-3.5 h-3.5" />Health</>}
            </button>
          ))}
        </div>
      </div>

      {activeTab === 'health' ? (
        /* ── Health tab: Financial Health + Data Provenance, clubbed ── */
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2">
            <FinancialHealth transactions={transactions} budgets={budgets} theme={theme} />
          </div>
          <div className="lg:col-span-1">
            <GlassCard theme={theme} className="p-5 h-full">
              <h2 className="text-sm font-semibold tracking-tight flex items-center gap-2 text-foreground mb-4">
                <Database className="text-primary w-4 h-4" />Data Provenance
              </h2>
              <div className="space-y-3 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground flex items-center gap-1.5"><FileSpreadsheet className="w-3.5 h-3.5" />Transactions</span>
                  <span className="font-semibold text-foreground tabular-nums">{transactions.length}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground flex items-center gap-1.5"><CalendarRange className="w-3.5 h-3.5" />Period</span>
                  <span className="font-semibold text-foreground text-right">{period}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground flex items-center gap-1.5"><IndianRupee className="w-3.5 h-3.5" />Currency</span>
                  <span className="font-semibold text-foreground">INR</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground flex items-center gap-1.5"><Database className="w-3.5 h-3.5" />Source</span>
                  <span className="font-semibold text-foreground">{isSampleActive ? 'Sample data' : 'Uploaded statement'}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground flex items-center gap-1.5"><Clock className="w-3.5 h-3.5" />Last processed</span>
                  <span className="font-semibold text-foreground text-right">{lastProcessed}</span>
                </div>
              </div>
              <div className={`mt-4 pt-4 border-t text-[10px] leading-relaxed text-muted-foreground ${isDark ? 'border-border' : 'border-border'}`}>
                All figures are derived from your uploaded statement. Amounts are estimates where the parser could not confirm a category.
              </div>
            </GlassCard>
          </div>
        </div>
      ) : (
      <div className="relative h-[320px] w-full">
        {/* Compact format toggle — overlay pill, no separate toolbar row */}
        {hasData && (
          <div className="absolute top-0 right-0 z-10 flex items-center gap-0.5 p-0.5 rounded-lg border border-border bg-card/95 backdrop-blur-sm shadow-sm">
            {formatOptions.map(opt => (
              <button key={opt.id} id={opt.id} onClick={opt.onClick}
                className={`px-2 py-1 rounded-md text-[10px] font-medium transition-all cursor-pointer ${opt.active ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground'}`}
              >{opt.label}</button>
            ))}
          </div>
        )}

        {/* Donut center metric — true total spent (each transaction once) */}
        {activeTab === 'category' && categoryFormat === 'donut' && visibleCategoryData.length > 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="text-center">
              <p className="text-xl font-semibold font-mono tracking-tight text-foreground">{formatCompactLakh(totalSpent)}</p>
              <p className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground mt-0.5">Total Spent</p>
            </div>
          </div>
        )}

        {!hasData ? (
          <div className="h-full flex items-center justify-center">
            <div className="text-muted-foreground text-xs text-center py-12">
              {transactions.length === 0
                ? 'Upload a statement to see your spending breakdown.'
                : 'No data available for this view yet.'}
            </div>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            {activeTab === 'category' ? (
              categoryFormat === 'bar' ? (
                <BarChart data={visibleCategoryData} layout="vertical" margin={{ left: 10, right: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={isDark ? "rgba(255,255,255,0.06)" : "rgba(17,18,20,0.06)"} horizontal={false} />
                  <XAxis type="number" stroke={isDark ? "rgba(255,255,255,0.4)" : "rgba(17,18,20,0.4)"} fontSize={9} tickLine={false} />
                  <YAxis dataKey="name" type="category" stroke={isDark ? "rgba(255,255,255,0.4)" : "rgba(17,18,20,0.4)"} fontSize={9} width={90} tickLine={false} />
                  <Tooltip content={<GlassyTooltip />} defaultIndex={null} />
                  <Bar dataKey="value" name="Amount Spent" radius={[0, 4, 4, 0]}>
                    {visibleCategoryData.map((entry, index) => (<Cell key={`cell-${index}`} fill={entry.color} />))}
                  </Bar>
                </BarChart>
              ) : (
                <PieChart>
                  <Pie data={visibleCategoryData} cx="50%" cy="50%" innerRadius={categoryFormat === 'donut' ? 70 : 0} outerRadius={100} paddingAngle={categoryFormat === 'donut' ? 3 : 0} dataKey="value">
                    {visibleCategoryData.map((entry, index) => (<Cell key={`cell-${index}`} fill={entry.color} />))}
                  </Pie>
                  <Tooltip content={<GlassyTooltip />} defaultIndex={null} />
                </PieChart>
              )
            ) : activeTab === 'trends' ? (
              trendFormat === 'area' ? (
                <AreaChart data={trendsData}>
                  <defs>
                    <linearGradient id="colorSpent" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#10b981" stopOpacity={0.35}/><stop offset="95%" stopColor="#10b981" stopOpacity={0.0}/></linearGradient>
                    <linearGradient id="colorCumulative" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#e8b105" stopOpacity={0.3}/><stop offset="95%" stopColor="#e8b105" stopOpacity={0.0}/></linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={isDark ? "rgba(255,255,255,0.06)" : "rgba(17,18,20,0.06)"} />
                  <XAxis dataKey="formattedDate" stroke={isDark ? "rgba(255,255,255,0.4)" : "rgba(17,18,20,0.4)"} fontSize={9} tickLine={false} />
                  <YAxis stroke={isDark ? "rgba(255,255,255,0.4)" : "rgba(17,18,20,0.4)"} fontSize={9} tickLine={false} tickFormatter={(v) => `₹${v}`} />
                  <Tooltip content={<GlassyTooltip />} defaultIndex={null} />
                  <Area type="monotone" dataKey="spent" name={periodView === 'yearly' ? 'Monthly Spend' : 'Daily Spend'} stroke="#10b981" strokeWidth={2} fillOpacity={1} fill="url(#colorSpent)" />
                  <Area type="monotone" dataKey="cumulative" name="Cumulative Spend" stroke="#e8b105" strokeWidth={2} fillOpacity={1} fill="url(#colorCumulative)" />
                </AreaChart>
              ) : (
                <LineChart data={trendsData}>
                  <CartesianGrid strokeDasharray="3 3" stroke={isDark ? "rgba(255,255,255,0.06)" : "rgba(17,18,20,0.06)"} />
                  <XAxis dataKey="formattedDate" stroke={isDark ? "rgba(255,255,255,0.4)" : "rgba(17,18,20,0.4)"} fontSize={9} tickLine={false} />
                  <YAxis stroke={isDark ? "rgba(255,255,255,0.4)" : "rgba(17,18,20,0.4)"} fontSize={9} tickLine={false} tickFormatter={(v) => `₹${v}`} />
                  <Tooltip content={<GlassyTooltip />} defaultIndex={null} />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: '11px' }} />
                  <Line type="monotone" dataKey="spent" name={periodView === 'yearly' ? 'Monthly Outflow' : 'Daily Outflow'} stroke="#10b981" strokeWidth={2.5} dot={{ r: 3, stroke: '#10b981', strokeWidth: 1, fill: isDark ? '#131417' : '#ffffff' }} activeDot={{ r: 5 }} />
                  <Line type="monotone" dataKey="cumulative" name="Cumulative Flow" stroke="#e8b105" strokeWidth={2.5} dot={{ r: 3, stroke: '#e8b105', strokeWidth: 1, fill: isDark ? '#131417' : '#ffffff' }} activeDot={{ r: 5 }} />
                </LineChart>
              )
            ) : activeTab === 'budgets' ? (
              budgetFormat === 'radar' ? (
                <RadarChart cx="50%" cy="50%" outerRadius="80%" data={budgetComparisonData}>
                  <PolarGrid stroke={isDark ? "rgba(255,255,255,0.08)" : "rgba(17,18,20,0.08)"} />
                  <PolarAngleAxis dataKey="category" tick={{ fill: isDark ? 'rgba(255,255,255,0.5)' : 'rgba(17,18,20,0.6)', fontSize: 9 }} />
                  <PolarRadiusAxis stroke={isDark ? "rgba(255,255,255,0.15)" : "rgba(17,18,20,0.15)"} angle={30} domain={[0, 'auto']} tick={{ fill: isDark ? 'rgba(255,255,255,0.4)' : 'rgba(17,18,20,0.5)', fontSize: 7 }} />
                  <Radar name="Budget Limit" dataKey="Budget" stroke="#0ea5e9" fill="#0ea5e9" fillOpacity={0.15} />
                  <Radar name="Avg Monthly Spend" dataKey="Spent" stroke="#f04e4e" fill="#f04e4e" fillOpacity={0.3} />
                  <Tooltip content={<GlassyTooltip />} defaultIndex={null} />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: '11px', paddingTop: '5px' }} />
                </RadarChart>
              ) : (
                <BarChart data={budgetComparisonData}>
                  <CartesianGrid strokeDasharray="3 3" stroke={isDark ? "rgba(255,255,255,0.06)" : "rgba(17,18,20,0.06)"} />
                  <XAxis dataKey="category" stroke={isDark ? "rgba(255,255,255,0.4)" : "rgba(17,18,20,0.4)"} fontSize={9} tickLine={false} />
                  <YAxis stroke={isDark ? "rgba(255,255,255,0.4)" : "rgba(17,18,20,0.4)"} fontSize={9} tickLine={false} tickFormatter={(v) => `₹${v}`} />
                  <Tooltip content={<GlassyTooltip />} defaultIndex={null} />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }} />
                  <Bar dataKey="Budget" name="Limit Target" fill={isDark ? "rgba(255, 255, 255, 0.12)" : "rgba(17, 18, 20, 0.08)"} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Spent" name="Avg Monthly Spend" fill="#f04e4e" radius={[4, 4, 0, 0]}>
                    {budgetComparisonData.map((entry, index) => (<Cell key={`cell-${index}`} fill={entry.color} />))}
                  </Bar>
                </BarChart>
              )
            ) : (
              projectionFormat === 'composition' ? (
                <BarChart data={projectionData} margin={{ top: 10, right: 10, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={isDark ? "rgba(255,255,255,0.06)" : "rgba(17,18,20,0.06)"} />
                  <XAxis dataKey="category" stroke={isDark ? "rgba(255,255,255,0.4)" : "rgba(17,18,20,0.4)"} fontSize={9} tickLine={false} />
                  <YAxis stroke={isDark ? "rgba(255,255,255,0.4)" : "rgba(17,18,20,0.4)"} fontSize={9} tickLine={false} tickFormatter={(v) => `₹${v}`} />
                  <Tooltip content={<GlassyTooltip />} defaultIndex={null} />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }} />
                  <Bar dataKey="Fixed/Recurring" name="Fixed/Recurring" stackId="a" fill="#0ea5e9" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="Variable (Projected)" name="Variable (Projected)" stackId="a" fill="#e8b105" radius={[4, 4, 0, 0]} />
                </BarChart>
              ) : (
                <BarChart data={projectionData} margin={{ top: 10, right: 10, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={isDark ? "rgba(255,255,255,0.06)" : "rgba(17,18,20,0.06)"} />
                  <XAxis dataKey="category" stroke={isDark ? "rgba(255,255,255,0.4)" : "rgba(17,18,20,0.4)"} fontSize={9} tickLine={false} />
                  <YAxis stroke={isDark ? "rgba(255,255,255,0.4)" : "rgba(17,18,20,0.4)"} fontSize={9} tickLine={false} tickFormatter={(v) => `₹${v}`} />
                  <Tooltip content={<GlassyTooltip />} defaultIndex={null} />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }} />
                  <Bar dataKey="Current Spend" name="Current Spent" fill={isDark ? "rgba(255, 255, 255, 0.15)" : "rgba(17, 18, 20, 0.1)"} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Projected Spend" name="Projected Spent" fill="#10b981" radius={[4, 4, 0, 0]} />
                </BarChart>
              )
            )}
          </ResponsiveContainer>
        )}
      </div>
      )}

      {activeTab === 'category' && categoryData.length > 0 && categoryFormat !== 'bar' && (
        <div className="mt-4 pt-4 border-t border-border">
          <div className="flex items-center justify-between gap-2 mb-2.5">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              Breakdown {hiddenCats.size > 0 && <span className="text-hold">· {visibleCategoryData.length} shown</span>}
            </span>
            <div className="flex items-center gap-0.5 p-0.5 rounded-lg border border-border bg-muted">
              {([
                ['value-desc', <ArrowDownWideNarrow key="d" className="w-3 h-3" />],
                ['value-asc', <ArrowUpWideNarrow key="a" className="w-3 h-3" />],
                ['name', <ArrowUpAZ key="n" className="w-3 h-3" />],
              ] as const).map(([id, icon]) => (
                <button key={id} id={`btn-legend-sort-${id}`} onClick={() => setLegendSort(id)}
                  className={`p-1 rounded-md transition-all cursor-pointer ${legendSort === id ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground'}`}
                  title={id === 'value-desc' ? 'Sort by value (high → low)' : id === 'value-asc' ? 'Sort by value (low → high)' : 'Sort alphabetically'}>
                  {icon}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 max-h-[150px] overflow-y-auto pr-1">
            {visibleCategoryData.map(entry => {
              const pct = categoryTotal > 0 ? Math.round((entry.value / categoryTotal) * 100) : 0;
              return (
                <button key={entry.name} onClick={() => toggleCategory(entry.name)}
                  className="flex items-center justify-between gap-2 text-xs group cursor-pointer rounded-md px-1.5 py-1 hover:bg-muted/60 transition-colors"
                  title={hiddenCats.has(entry.name) ? 'Hidden — click to show' : 'Click to hide'}>
                  <span className="flex items-center gap-1.5 min-w-0">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: entry.color }} />
                    <span className="truncate text-muted-foreground group-hover:text-foreground">{entry.name}</span>
                  </span>
                  <span className="flex items-center gap-1.5 shrink-0">
                    <span className="font-semibold text-foreground">₹{entry.value.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
                    <span className="text-[9px] text-muted-foreground w-9 text-right">{pct}%</span>
                  </span>
                </button>
              );
            })}
          </div>
          {hiddenCats.size > 0 && (
            <button onClick={() => setHiddenCats(new Set())} className="mt-2 text-[10px] font-semibold text-primary hover:text-primary/80 flex items-center gap-1 cursor-pointer">
              <RotateCcw className="w-3 h-3" />Show all categories
            </button>
          )}
        </div>
      )}

      {activeTab === 'projection' && projectionData.length > 0 && (
        <div className={`grid grid-cols-2 gap-4 mt-4 pt-4 border-t border-border text-xs`}>
          <div className="flex flex-col gap-1">
            <span className="text-muted-foreground">Total Projected Spend (Next Month)</span>
            <span className="text-base font-bold text-foreground">₹{projectionSummary.totalProjected.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-muted-foreground">Fixed Subscription Commitments</span>
            <span className="text-base font-bold text-primary">₹{projectionSummary.totalRecurring.toLocaleString('en-IN', { maximumFractionDigits: 0 })} ({projectionSummary.recurringPercentage}%)</span>
          </div>
        </div>
      )}
    </GlassCard>
  );
}