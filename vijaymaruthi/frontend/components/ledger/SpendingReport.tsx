'use client';
import React, { useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, AreaChart, Area,
} from 'recharts';
import { Transaction } from '@/lib/ledger/types';
import { X, Download, Printer, TrendingUp, TrendingDown, PiggyBank, Percent, Calendar, Tag } from 'lucide-react';

// Categorical palette anchored on the app's chart tokens (emerald-led).
const COLORS = ['#10b981', '#e8b105', '#ee8b2c', '#f04e4e', '#0ea5e9', '#8b5cf6', '#14b8a6', '#84cc16', '#f97316', '#ec4899', '#06b6d4', '#a855f7'];

interface SpendingReportProps {
  transactions: Transaction[];
  onClose: () => void;
  theme: 'light' | 'dark';
}

export default function SpendingReport({ transactions, onClose, theme }: SpendingReportProps) {
  const isDark = theme === 'dark';

  const summary = useMemo(() => {
    let income = 0, expense = 0;
    transactions.forEach(t => { if (t.amount < 0) income += Math.abs(t.amount); else expense += t.amount; });
    const savings = income - expense;
    return { income, expense, savings, rate: income ? Math.round((savings / income) * 100) : 0 };
  }, [transactions]);

  const categoryData = useMemo(() => {
    const map: Record<string, number> = {};
    transactions.forEach(t => { if (t.amount > 0) (t.categories || ['Others']).forEach(c => { map[c] = (map[c] || 0) + t.amount; }); });
    return Object.entries(map).sort((a, b) => b[1] - a[1]).map(([name, value]) => ({ name, value: Math.round(value) }));
  }, [transactions]);

  const monthlyData = useMemo(() => {
    const map: Record<string, { income: number; expense: number }> = {};
    transactions.forEach(t => { const m = t.date.substring(0, 7); if (!map[m]) map[m] = { income: 0, expense: 0 }; if (t.amount < 0) map[m].income += Math.abs(t.amount); else map[m].expense += t.amount; });
    return Object.entries(map).sort().map(([month, v]) => ({ month, ...v }));
  }, [transactions]);

  const topSpend = categoryData.slice(0, 5);
  const otherSpend = categoryData.slice(5).reduce((s, c) => s + c.value, 0);
  const pieData = topSpend.length ? [...topSpend, ...(otherSpend > 0 ? [{ name: 'Others', value: otherSpend }] : [])] : [];

  const handlePrint = () => window.print();

  const handleDownload = () => {
    // Client-side CSV export (mirrors the old Python /export-report endpoint).
    // RFC-4180-safe: fields containing commas/quotes/newlines are quoted and
    // embedded quotes are doubled. Formula injection is neutralized by
    // prefixing cells that start with =, +, -, or @ with a single quote.
    const csvEscape = (v: string | number): string => {
      const s = String(v);
      const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
      return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
    };
    const lines: string[] = [];
    const totalIncome = transactions.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);
    const totalExpense = transactions.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
    const netSavings = totalIncome - totalExpense;
    lines.push('Spending Report,', `Generated,${csvEscape(new Date().toISOString().slice(0, 16).replace('T', ' '))}`, '');
    lines.push('Summary,', `Total Income,${csvEscape(`₹${totalIncome.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`)}`, `Total Expenses,${csvEscape(`₹${totalExpense.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`)}`, `Net Savings,${csvEscape(`₹${netSavings.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`)}`, `Savings Rate,${csvEscape(`${totalIncome ? Math.round((netSavings / totalIncome) * 100) : 0}%`)}`, '');
    lines.push('Category Breakdown,Amount,Percentage');
    const catTotals: Record<string, number> = {};
    transactions.forEach(t => { if (t.amount > 0) (t.categories || ['Others']).forEach(c => { catTotals[c] = (catTotals[c] || 0) + t.amount; }); });
    Object.entries(catTotals).sort((a, b) => b[1] - a[1]).forEach(([cat, amt]) => {
      lines.push(`${csvEscape(cat)},${csvEscape(`₹${amt.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`)},${csvEscape(`${totalExpense ? Math.round((amt / totalExpense) * 100) : 0}%`)}`);
    });
    lines.push('', 'Date,Description,Categories,Amount,Recurring');
    transactions.forEach(t => {
      const cats = (t.categories || []).join(', ');
      // Income is stored negative; present it with a leading minus for clarity.
      const amtStr = `${t.amount < 0 ? '-' : ''}₹${Math.abs(t.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
      lines.push(`${csvEscape(t.date)},${csvEscape(t.description)},${csvEscape(cats)},${csvEscape(amtStr)},${csvEscape(t.recurring ? 'Yes' : '')}`);
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'spending_report.csv'; a.click(); URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 print:p-0 print:static print:inset-auto">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm print:hidden" onClick={onClose} />
      <div className={`relative w-full max-w-5xl max-h-[90vh] overflow-y-auto rounded-xl border shadow-2xl transition-colors print:rounded-none print:max-h-none print:shadow-none print:overflow-visible bg-popover border-border`}>
        <div className={`sticky top-0 z-10 flex items-center justify-between px-6 py-4 border-b print:hidden bg-popover/95 backdrop-blur-xl border-border`}>
          <h2 className={`text-lg font-semibold text-foreground`}>Spending Report</h2>
          <div className="flex items-center gap-2">
            <button onClick={handleDownload} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all cursor-pointer bg-muted border-border text-muted-foreground hover:bg-muted/80`}><Download className="w-3.5 h-3.5" /> CSV</button>
            <button onClick={handlePrint} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all cursor-pointer bg-primary/10 border-primary/30 text-primary hover:bg-primary/20`}><Printer className="w-3.5 h-3.5" /> Print / PDF</button>
            <button onClick={onClose} className={`p-1.5 rounded-lg border transition-all cursor-pointer bg-muted border-border text-muted-foreground hover:bg-muted/80`}><X className="w-4 h-4" /></button>
          </div>
        </div>
        <div className="p-6 space-y-8">
          <div className={`text-center pb-4 border-b print:border-b border-border`}>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Financial Spending Report</h1>
            <p className={`text-sm mt-1 text-muted-foreground`}>Generated {new Date().toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' })} • {transactions.length} transactions</p>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: 'Total Income', value: `₹${summary.income.toLocaleString('en-IN')}`, icon: TrendingUp, color: 'text-primary', bg: 'bg-primary/10' },
              { label: 'Total Expenses', value: `₹${summary.expense.toLocaleString('en-IN')}`, icon: TrendingDown, color: 'text-strong-sell', bg: 'bg-strong-sell/10' },
              { label: 'Net Savings', value: `₹${summary.savings.toLocaleString('en-IN')}`, icon: PiggyBank, color: summary.savings >= 0 ? 'text-hold' : 'text-strong-sell', bg: summary.savings >= 0 ? 'bg-hold/10' : 'bg-strong-sell/10' },
              { label: 'Savings Rate', value: `${summary.rate}%`, icon: Percent, color: 'text-muted-foreground', bg: 'bg-muted' },
            ].map(card => (
              <div key={card.label} className={`rounded-xl p-4 border transition-colors bg-card border-border`}>
                <div className="flex items-center justify-between mb-2"><span className={`text-[10px] uppercase tracking-widest font-semibold text-muted-foreground`}>{card.label}</span><span className={`p-1.5 rounded-lg ${card.bg}`}><card.icon className={`w-4 h-4 ${card.color}`} /></span></div>
                <div className={`text-xl font-bold text-foreground`}>{card.value}</div>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className={`rounded-xl p-5 border transition-colors bg-card border-border`}>
              <h3 className={`text-sm font-semibold flex items-center gap-2 mb-4 text-foreground`}><Tag className="w-4 h-4 text-primary" />Category Breakdown</h3>
              {pieData.length > 0 ? (
                <div className="flex flex-col items-center">
                  <ResponsiveContainer width="100%" height={200}>
                    <PieChart><Pie data={pieData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} dataKey="value" paddingAngle={2}>{pieData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}</Pie><Tooltip formatter={(v: any) => `₹${Number(v).toLocaleString('en-IN')}`} /></PieChart>
                  </ResponsiveContainer>
                  <div className="flex flex-wrap justify-center gap-2 mt-2">{pieData.map((d, i) => <span key={d.name} className="flex items-center gap-1 text-[10px] font-medium text-muted-foreground"><span className="w-2 h-2 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />{d.name}</span>)}</div>
                </div>
              ) : <p className={`text-center text-sm py-8 text-muted-foreground`}>No expense data</p>}
            </div>
            <div className={`rounded-xl p-5 border transition-colors bg-card border-border`}>
              <h3 className={`text-sm font-semibold flex items-center gap-2 mb-4 text-foreground`}><Calendar className="w-4 h-4 text-primary" />Monthly Trend</h3>
              {monthlyData.length > 0 ? (
                <ResponsiveContainer width="100%" height={200}>
                  <AreaChart data={monthlyData}>
                    <defs>
                      <linearGradient id="incomeGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#10b981" stopOpacity={0.3} /><stop offset="100%" stopColor="#10b981" stopOpacity={0} /></linearGradient>
                      <linearGradient id="expenseGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#f04e4e" stopOpacity={0.3} /><stop offset="100%" stopColor="#f04e4e" stopOpacity={0} /></linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={isDark ? '#ffffff10' : '#e2e8f0'} />
                    <XAxis dataKey="month" tick={{ fontSize: 10 }} stroke={isDark ? '#475569' : '#94a3b8'} />
                    <YAxis tick={{ fontSize: 10 }} stroke={isDark ? '#475569' : '#94a3b8'} />
                    <Tooltip formatter={(v: any) => `₹${Number(v).toLocaleString('en-IN')}`} />
                    <Area type="monotone" dataKey="income" stroke="#10b981" fill="url(#incomeGrad)" name="Income" />
                    <Area type="monotone" dataKey="expense" stroke="#f04e4e" fill="url(#expenseGrad)" name="Expenses" />
                  </AreaChart>
                </ResponsiveContainer>
              ) : <p className={`text-center text-sm py-8 text-muted-foreground`}>No monthly data</p>}
            </div>
          </div>
          <div className={`rounded-xl p-5 border transition-colors bg-card border-border`}>
            <h3 className={`text-sm font-semibold flex items-center gap-2 mb-4 text-foreground`}><BarChart className="w-4 h-4 text-primary" />Spending by Category</h3>
            {categoryData.length > 0 ? (
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={categoryData} layout="vertical" margin={{ left: 80, right: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={isDark ? '#ffffff10' : '#e2e8f0'} />
                  <XAxis type="number" tick={{ fontSize: 11 }} stroke={isDark ? '#475569' : '#94a3b8'} tickFormatter={(v: number) => `₹${(v / 1000).toFixed(0)}k`} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} stroke={isDark ? '#475569' : '#94a3b8'} width={90} />
                  <Tooltip formatter={(v: any) => `₹${Number(v).toLocaleString('en-IN')}`} />
                  <Bar dataKey="value" radius={[0, 4, 4, 0]}>{categoryData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}</Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : <p className={`text-center text-sm py-8 text-muted-foreground`}>No data</p>}
          </div>
          <div className={`text-center text-[10px] pt-4 border-t print:block text-muted-foreground border-border`}>
            My Financial Ledger — Spending Report • Generated {new Date().toLocaleString('en-IN')}
          </div>
        </div>
      </div>
    </div>
  );
}