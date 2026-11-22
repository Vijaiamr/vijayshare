'use client';
import React, { useState, useMemo } from 'react';
import { getCurrentMode } from '@/lib/theme';
import { Sparkles, CircleHelp, LayoutDashboard, Calculator, Download, Wallet, TrendingDown, PiggyBank, Percent, Upload, FileSpreadsheet } from 'lucide-react';
import { calculateSummary } from '@/lib/ledger/sampleData';
import { Transaction, SpendingInsight, BudgetRecommendation } from '@/lib/ledger/types';
import { formatDisplayDate } from '@/lib/ledger/merchant';
import { PeriodSelection, filterTransactionsByPeriod, availableMonths, availableYears, defaultPeriod, periodLabel, periodDateRange } from '@/lib/ledger/period';
import { mergeTransactions, extractUpiPayee } from '@/lib/ledger/engine';
import ExcelImporter from './ExcelImporter';
import ChartsDashboard from './ChartsDashboard';
import InsightsPanel from './InsightsPanel';
import BudgetSummary from './BudgetSummary';
import TransactionTable from './TransactionTable';
import TransactionDrawer from './TransactionDrawer';
import TaxTracker from './TaxTracker';
import SpendingReport from './SpendingReport';
import PeriodSelector from './PeriodSelector';

const EMPTY_TRANSACTIONS: Transaction[] = [];
const EMPTY_BUDGETS: BudgetRecommendation[] = [];

function generateInsights(transactions: Transaction[], budgets: BudgetRecommendation[]): SpendingInsight[] {
  if (transactions.length === 0) return [];
  const insights: SpendingInsight[] = [];
  const catSpend: Record<string, number> = {};
  let totalSpent = 0;
  let totalIncome = 0;
  let min = Infinity, max = -Infinity;
  transactions.forEach(t => {
    const ts = new Date(`${t.date}T00:00:00Z`).getTime();
    if (!isNaN(ts)) { min = Math.min(min, ts); max = Math.max(max, ts); }
    if (t.amount > 0) {
      totalSpent += t.amount;
      (t.categories || ['Others']).forEach(c => {
        if (c !== 'Income') catSpend[c] = (catSpend[c] || 0) + t.amount;
      });
    } else {
      totalIncome += Math.abs(t.amount);
    }
  });
  const months = min === Infinity ? 1 : Math.max(1, (new Date(max).getFullYear() - new Date(min).getFullYear()) * 12 + new Date(max).getMonth() - new Date(min).getMonth() + 1);

  // ── Budget overages (monthly basis, mirroring BudgetSummary) ────────────
  const monthlyIncome = totalIncome / months;
  const configured = new Map(budgets.map(b => [b.category, b.limitAmount]));
  const overages: { category: string; spent: number; limit: number; pct: number; overage: number }[] = [];
  Object.entries(catSpend).forEach(([cat, spent]) => {
    const limit = configured.get(cat) ?? Math.max(Math.round(monthlyIncome * 0.05), 1000);
    if (limit > 0 && spent > limit) {
      overages.push({ category: cat, spent, limit, pct: Math.round((spent / limit) * 100), overage: spent - limit });
    }
  });
  overages.sort((a, b) => b.overage - a.overage);

  overages.slice(0, 3).forEach((o, i) => {
    insights.push({
      id: `insight-budget-${i}`, type: 'warning',
      title: `${o.category} Over Budget`,
      description: `₹${o.spent.toLocaleString('en-IN')} spent against a ₹${o.limit.toLocaleString('en-IN')} monthly budget — ${Math.min(o.pct, 999)}% of the limit.`,
      recommendation: `Reduce ${o.category.toLowerCase()} spending by ₹${o.overage.toLocaleString('en-IN')} to get back on track.`,
      impactValue: `${Math.min(o.pct, 999)}%`,
      action: 'review',
    });
  });

  // ── Savings rate ─────────────────────────────────────────────────────────
  if (totalIncome > 0) {
    const netSavings = totalIncome - totalSpent;
    const rate = Math.round((netSavings / totalIncome) * 100);
    insights.push({
      id: 'insight-savings', type: rate >= 20 ? 'saving' : 'trend',
      title: rate >= 20 ? 'Healthy Savings Rate' : 'Savings Rate',
      description: rate >= 20
        ? `You're saving ${rate}% of income — a healthy rate. Keep it up.`
        : rate >= 10
          ? `You're saving ${rate}% — decent, but try to push beyond 20%.`
          : `You're saving ${rate}% — consider cutting discretionary spending.`,
      recommendation: rate >= 20
        ? 'Maintain current habits and consider investing the surplus.'
        : 'Set a 20% savings target and automate a transfer on payday.',
      impactValue: `${rate}% saved`,
    });
  }

  // ── Top spending category ────────────────────────────────────────────────
  const top = Object.entries(catSpend).sort((a, b) => b[1] - a[1])[0];
  if (top && totalSpent > 0) {
    const share = Math.round((top[1] / totalSpent) * 100);
    insights.push({
      id: 'insight-top-cat', type: 'trend',
      title: 'Top Spending Category',
      description: `Your biggest expense is "${top[0]}" at ₹${top[1].toLocaleString('en-IN')} — ${share}% of total outflow.`,
      impactValue: `${share}%`,
    });
  }

  // ── Recurring charges ────────────────────────────────────────────────────
  const recCount = transactions.filter(t => t.recurring).length;
  insights.push({
    id: 'insight-recurring', type: 'saving',
    title: recCount > 0 ? 'Recurring Charges Detected' : 'Smart Spending Tip',
    description: recCount > 0
      ? `You have ${recCount} recurring payment(s). Reviewing unused subscriptions could save up to ₹2,500/month.`
      : 'Setting daily spending alerts could help you save up to 10% of discretionary outflow.',
    recommendation: recCount > 0 ? 'Audit subscriptions and cancel any you no longer use.' : 'Set a daily spending alert to stay aware of discretionary outflow.',
    impactValue: recCount > 0 ? `${recCount} recurring` : '10% Savings',
  });

  return insights;
}

export default function LedgerApp() {
  // Follow the app-wide theme (set by the global ThemeSwitcher in the sidebar).
  // Theme state starts at the server-safe default ("dark") and syncs to the
  // real mode after mount — this avoids the SSR/client hydration mismatch that
  // occurs when reading documentElement at render. A MutationObserver keeps the
  // ledger charts in sync when the user switches theme via the sidebar toggle.
  const [themeMode, setThemeMode] = useState<'light' | 'dark'>('dark');
  React.useEffect(() => {
    setThemeMode(getCurrentMode());
    const observer = new MutationObserver(() => setThemeMode(getCurrentMode()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);
  const theme: 'light' | 'dark' = themeMode;
  const isDark = theme === 'dark';

  const [transactions, setTransactions] = useState<Transaction[]>(EMPTY_TRANSACTIONS);
  const [budgets, setBudgets] = useState<BudgetRecommendation[]>(EMPTY_BUDGETS);
  const [isSampleActive, setIsSampleActive] = useState(false);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'tax'>('dashboard');
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'unsaved'>('saved');
  const [showReport, setShowReport] = useState(false);
  const [selectedTxId, setSelectedTxId] = useState<string | null>(null);
  const [period, setPeriod] = useState<PeriodSelection>({ view: 'all', key: null });
  const loadedRef = React.useRef(false);

  React.useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    refreshData(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-fetch the user's real data from the server (Supabase via route handlers).
  // Used on first load and by the "Refresh" button. `resetPeriod` is true only
  // on first load (default to the latest month); the Refresh button keeps the
  // current period so it refreshes the data on the page alone.
  const refreshData = async (resetPeriod = false) => {
    try {
      const [txData, budgetData] = await Promise.all([
        fetch('/api/ledger/transactions', { cache: 'no-store' }).then(r => r.json()),
        fetch('/api/ledger/budgets', { cache: 'no-store' }).then(r => r.json()),
      ]);
      if (txData?.transactions?.length) {
        setTransactions(txData.transactions);
        setIsSampleActive(false);
        if (resetPeriod) {
          // Default to the most recent month present in the data (never All Time).
          setPeriod(defaultPeriod(txData.transactions));
        }
      }
      if (budgetData?.budgets?.length) {
        setBudgets(budgetData.budgets);
      }
    } catch {
      // Keep current state on failure; the upload path still works.
    }
  };

  const persistStatus = (status: 'saved' | 'saving' | 'unsaved') => setSaveStatus(status);

  // ── Period-aware single source of truth ────────────────────────────────
  // Every component below receives `filteredTransactions` (not the full set),
  // so the selected period drives ALL calculations and visualizations.
  const months = useMemo(() => availableMonths(transactions), [transactions]);
  const years = useMemo(() => availableYears(transactions), [transactions]);
  const filteredTransactions = useMemo(
    () => filterTransactionsByPeriod(transactions, period),
    [transactions, period],
  );
  const periodRange = useMemo(() => periodDateRange(period), [period]);
  const periodLabelText = useMemo(() => periodLabel(period), [period]);

  const insights = useMemo(() => generateInsights(filteredTransactions, budgets), [filteredTransactions, budgets]);
  const summary = useMemo(() => calculateSummary(filteredTransactions), [filteredTransactions]);
  const savingsRate = useMemo(() => {
    if (summary.totalIncome === 0) return 0;
    return Math.max(0, (summary.netSavings / summary.totalIncome) * 100);
  }, [summary]);

  // Live drawer transaction — resolves the selected id against current state
  // so edits reflect immediately and deletion closes the drawer.
  const selectedTx = selectedTxId ? transactions.find(t => t.id === selectedTxId) ?? null : null;

  // Data provenance (financial trust): period, source, freshness.
  const provenancePeriod = useMemo(() => {
    if (filteredTransactions.length === 0) return '—';
    const dates = filteredTransactions.map(t => t.date).filter(Boolean).sort();
    if (dates.length === 0) return '—';
    return `${formatDisplayDate(dates[0])} – ${formatDisplayDate(dates[dates.length - 1])}`;
  }, [filteredTransactions]);

  const lastProcessed = useMemo(() => {
    if (transactions.length === 0) return '—';
    return new Date().toLocaleString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
      timeZone: 'Asia/Kolkata', hour12: false,
    }).replace(',', ' ·') + ' IST';
  }, [transactions]);

  function fmtAmount(val: number) { return val.toLocaleString('en-IN', { minimumFractionDigits: 0 }); }
  function fmtAmount2(val: number) { return val.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

  const scrollToTransactions = () => {
    document.getElementById('transactions-workspace')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const scrollToImporter = () => {
    document.getElementById('excel-importer-panel')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const handleDataImported = (importedTransactions: Transaction[], _insights: any[], importedBudgets: BudgetRecommendation[]) => {
    // Upload route already persisted to Supabase; hydrate state. Merge by the
    // same exact dedup key as the server (defense in depth) so overlapping
    // uploads never duplicate rows in the UI either.
    setTransactions(prev => mergeTransactions(prev, importedTransactions));
    // Never clobber the user's existing budgets with the upload's fallback
    // recommendations. Preserve every configured budget and only add fallback
    // categories that are not already present (a first upload still gets the
    // sensible defaults).
    setBudgets(prev => {
      const existing = new Map(prev.map(b => [b.category, b]));
      const merged = [...prev];
      importedBudgets.forEach(b => {
        if (existing.has(b.category)) return;
        const actual = importedTransactions.filter(t => t.categories?.includes(b.category) && t.amount > 0).reduce((sum, t) => sum + t.amount, 0);
        merged.push({ ...b, currentSpend: actual });
      });
      return merged;
    });
    setIsSampleActive(false);
    // After an upload, reset to All Time so the user immediately sees their
    // freshly imported data instead of being stuck on the latest-month default
    // (which may only contain a couple of rows and look like the upload failed).
    setPeriod({ view: 'all', key: null });
    persistStatus('saved');
  };

  const handleAddTransaction = (newTx: Omit<Transaction, 'id'>) => {
    const optimistic: Transaction = { ...newTx, id: `manual-${Date.now()}` };
    setTransactions(prev => [optimistic, ...prev]);
    setIsSampleActive(false);
    persistStatus('saving');
    fetch('/api/ledger/transactions', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transaction: newTx }),
    }).then(r => r.json()).then(data => {
      if (data?.transaction?.id) {
        setTransactions(prev => prev.map(t => t.id === optimistic.id ? data.transaction : t));
      }
      persistStatus('saved');
    }).catch(() => persistStatus('saved'));
  };

  const handleDeleteTransaction = (id: string) => {
    setTransactions(prev => prev.filter(t => t.id !== id));
    setIsSampleActive(false);
    persistStatus('saving');
    fetch(`/api/ledger/transactions?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
      .then(() => persistStatus('saved'))
      .catch(() => persistStatus('saved'));
  };

  const handleEditTransaction = (id: string, updates: Partial<Transaction>) => {
    setTransactions(prev => {
      const tx = prev.find(t => t.id === id);
      if (!tx || !updates.categories) return prev.map(t => t.id === id ? { ...t, ...updates } : t);
      if (JSON.stringify(tx.categories) === JSON.stringify(updates.categories)) return prev.map(t => t.id === id ? { ...t, ...updates } : t);
      const payee = extractUpiPayee(tx.description);
      const payeeTxnIds = payee ? new Set(prev.filter(t => t.id !== id && extractUpiPayee(t.description) === payee).map(t => t.id)) : new Set<string>();
      // Learn the correction per-user (applies to future uploads).
      fetch('/api/ledger/corrections', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: tx.description, categories: updates.categories, payee }),
      }).catch(() => {});
      const updatedCategories = updates.categories;
      return prev.map(t => {
        if (t.id === id) return { ...t, ...updates };
        if (payeeTxnIds.has(t.id)) return { ...t, categories: updatedCategories };
        return t;
      });
    });
    setIsSampleActive(false);
    persistStatus('saving');
    fetch('/api/ledger/transactions', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, updates }),
    }).then(() => persistStatus('saved')).catch(() => persistStatus('saved'));
  };

  const handleUpdateBudget = (category: string, limitAmount: number) => {
    setBudgets(prev => {
      const exists = prev.find(b => b.category === category);
      const next = exists
        ? prev.map(b => b.category === category ? { ...b, limitAmount } : b)
        : [...prev, { category, limitAmount, suggestedPercentage: 5, currentSpend: 0 }];
      persistStatus('saving');
      fetch('/api/ledger/budgets', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ budgets: next }),
      }).then(() => persistStatus('saved')).catch(() => persistStatus('saved'));
      return next;
    });
  };

  const handleClearData = () => { setTransactions(EMPTY_TRANSACTIONS); setBudgets(EMPTY_BUDGETS); setIsSampleActive(false); };

  // ── KPI cards — same StatCard language as the NSE Market Intelligence page ──
  const kpiCards = [
    {
      id: 'kpi-income', label: 'Total Income', value: `₹${fmtAmount2(summary.totalIncome)}`,
      subtitle: 'Total Earnings', color: 'text-primary', icon: <Wallet className="w-7 h-7" />,
    },
    {
      id: 'kpi-expenses', label: 'Total Expenses', value: `₹${fmtAmount2(summary.totalSpent)}`,
      subtitle: 'Total Outflow', color: 'text-strong-sell', icon: <TrendingDown className="w-7 h-7" />,
    },
    {
      id: 'kpi-savings', label: 'Net Savings', value: `${summary.netSavings < 0 ? '-' : ''}₹${fmtAmount2(Math.abs(summary.netSavings))}`,
      subtitle: 'Money Saved', color: summary.netSavings < 0 ? 'text-strong-sell' : 'text-primary', icon: <PiggyBank className="w-7 h-7" />,
    },
    {
      id: 'kpi-rate', label: 'Savings Rate', value: `${savingsRate.toFixed(2)}%`,
      subtitle: 'Savings Ratio', color: 'text-primary', icon: <Percent className="w-7 h-7" />,
    },
  ];

  return (
    <div className={`min-h-screen font-sans relative overflow-x-hidden transition-colors duration-500 ${isDark ? 'bg-transparent text-foreground' : 'bg-transparent text-foreground'}`}>
      <div className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8 py-8 relative z-10 space-y-6">
        {/* ── Page header — matches Market Rotation & Relative Strength ── */}
        <div id="main-header" className={`flex flex-col md:flex-row md:items-end justify-between gap-4 pb-6 border-b ${isDark ? 'border-border' : 'border-border'}`}>
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <div className="w-2 h-2 bg-primary rounded-full" />
              <p className="text-[10px] font-semibold uppercase tracking-widest text-primary">My Financial Ledger</p>
            </div>
            <h1 className="text-[1.6rem] font-bold tracking-tight mb-1 text-foreground">
              My Financial Ledger
            </h1>
            <p className="text-xs text-muted-foreground">Track, understand, and optimize your finances.</p>
          </div>
          <div className="flex items-center gap-2.5">
            {transactions.length > 0 && (
              <PeriodSelector
                selection={period}
                onChange={setPeriod}
                months={months}
                years={years}
                theme={theme}
              />
            )}
            {transactions.length > 0 && (
              <button onClick={() => setShowReport(true)}
                className="text-xs border border-border font-medium px-3 py-2 rounded-lg flex items-center gap-1.5 cursor-pointer transition-all bg-card text-muted-foreground hover:text-foreground hover:border-primary/40"
                title="Generate visual spending report">
                <Download className="w-3.5 h-3.5" />Report
              </button>
            )}
            {transactions.length > 0 && (
              <span className={`text-[10px] border font-semibold px-2.5 py-1.5 rounded-full flex items-center gap-1.5 ${isSampleActive ? 'border-hold/40 bg-hold/10 text-hold' : 'border-primary/40 bg-primary/10 text-primary'}`}>
                <Sparkles className="w-3 h-3" />{isSampleActive ? 'Sample Data' : 'Data Loaded'}
              </span>
            )}
            {transactions.length > 0 && (
              <span className={`text-[10px] px-2.5 py-1.5 rounded-full font-medium flex items-center gap-1.5 ${
                saveStatus === 'saved' ? 'text-primary bg-primary/10 border border-primary/30' :
                saveStatus === 'saving' ? 'text-hold bg-hold/10 border border-hold/30' :
                'text-muted-foreground bg-muted border border-border'
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full ${saveStatus === 'saved' ? 'bg-primary' : saveStatus === 'saving' ? 'bg-hold animate-pulse' : 'bg-muted-foreground'}`} />
                {saveStatus === 'saved' ? 'Saved' : saveStatus === 'saving' ? 'Saving...' : 'Unsaved'}
              </span>
            )}
          </div>
        </div>

        {/* ── Product-level tabs ── */}
        <div className={`flex border-b pb-1 gap-2 ${isDark ? 'border-border' : 'border-border'}`}>
          <button onClick={() => setActiveTab('dashboard')}
            className={`px-4 py-2 text-xs font-semibold flex items-center gap-1.5 border-b-2 transition-all cursor-pointer ${activeTab === 'dashboard' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
            <LayoutDashboard className="w-3.5 h-3.5" />Ledger & Dashboard
          </button>
          <button onClick={() => setActiveTab('tax')}
            className={`px-4 py-2 text-xs font-semibold flex items-center gap-1.5 border-b-2 transition-all cursor-pointer ${activeTab === 'tax' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
            <Calculator className="w-3.5 h-3.5" />Indian Tax exemption & Rebate Tracker
          </button>
        </div>

        {activeTab === 'dashboard' ? (
          transactions.length === 0 ? (
            <>
              {/* ── First-run empty state — focused guidance instead of zero-value panels ── */}
              <div id="empty-state" className="rounded-2xl border border-border bg-card p-8 sm:p-10 text-center">
                <div className="mx-auto w-14 h-14 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mb-4">
                  <FileSpreadsheet className="w-7 h-7" />
                </div>
                <h2 className="text-lg font-bold tracking-tight text-foreground">Your ledger is ready for its first statement</h2>
                <p className="text-xs text-muted-foreground mt-2 max-w-md mx-auto leading-relaxed">
                  Upload a bank statement or UPI export and the ledger will parse, categorize, and deduplicate it
                  automatically — then show your spending, budgets, and tax position.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-6 max-w-2xl mx-auto text-left">
                  {[
                    { step: '1', title: 'Upload', desc: 'Drag & drop an .xlsx, .xls, .csv, .txt, or .pdf statement.' },
                    { step: '2', title: 'Auto-categorize', desc: 'Date, description, and amount columns are detected automatically.' },
                    { step: '3', title: 'Track', desc: 'Budgets, insights, and the tax tracker update instantly.' },
                  ].map(s => (
                    <div key={s.step} className="rounded-xl border border-border bg-muted/40 p-4">
                      <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-primary/15 text-primary text-[10px] font-bold mb-2">{s.step}</span>
                      <p className="text-xs font-semibold text-foreground">{s.title}</p>
                      <p className="text-[10px] text-muted-foreground mt-1 leading-relaxed">{s.desc}</p>
                    </div>
                  ))}
                </div>
                <button onClick={scrollToImporter}
                  className="mt-6 inline-flex items-center gap-2 bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold px-5 py-2.5 rounded-lg transition-all cursor-pointer">
                  <Upload className="w-4 h-4" />Upload a statement
                </button>
              </div>

              {/* ── Upload importer — the primary action on first run ── */}
              <div className="max-w-2xl mx-auto">
                <ExcelImporter
                  onDataImported={handleDataImported}
                  onRefresh={refreshData}
                  onClearData={handleClearData}
                  isSampleActive={isSampleActive}
                  transactionCount={filteredTransactions.length}
                  period={provenancePeriod}
                  theme={theme}
                />
              </div>
            </>
          ) : (
            <>
              {/* ── Top financial summary — StatCard language ── */}
              <div id="metrics-panel" className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2">
                {kpiCards.map(m => (
                  <button key={m.id} id={m.id} onClick={scrollToTransactions}
                    className="text-left rounded-xl border border-border bg-card p-5 transition-all duration-150 hover:border-primary/30 cursor-pointer group"
                    title="View transactions">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-[0.7rem] font-semibold uppercase tracking-wider text-muted-foreground">{m.label}</p>
                        <p className={`text-[1.5rem] xl:text-[2rem] font-bold leading-tight mt-1 tabular-nums whitespace-nowrap ${m.color}`}>
                          {m.value}
                        </p>
                        <p className="mt-0.5 block text-[0.7rem] text-muted-foreground">{m.subtitle}</p>
                      </div>
                      <div className={`${m.color} opacity-30 shrink-0 group-hover:opacity-50 transition-opacity`}>{m.icon}</div>
                    </div>
                  </button>
                ))}
              </div>

              {/* ── Row 1: Spending Analysis (68%) + Upload Statement (32%) ── */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
                <div className="lg:col-span-8">
                  <ChartsDashboard transactions={filteredTransactions} budgets={budgets} period={provenancePeriod} lastProcessed={lastProcessed} isSampleActive={isSampleActive} periodLabel={periodLabelText} periodView={period.view} theme={theme} />
                </div>
                <div className="lg:col-span-4 h-full">
                  <ExcelImporter
                    onDataImported={handleDataImported}
                    onRefresh={refreshData}
                    onClearData={handleClearData}
                    isSampleActive={isSampleActive}
                    transactionCount={filteredTransactions.length}
                    period={provenancePeriod}
                    theme={theme}
                  />
                </div>
              </div>

              {/* ── Row 2: Smart Insights (68%) + Monthly Budgets (32%) ── */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
                <div className="lg:col-span-8">
                  <InsightsPanel insights={insights} theme={theme} periodLabel={periodLabelText} />
                </div>
                <div className="lg:col-span-4 h-full">
                  <BudgetSummary budgets={budgets} transactions={filteredTransactions} theme={theme} onUpdateBudget={handleUpdateBudget} periodLabel={periodLabelText} />
                </div>
              </div>

              {/* ── Row 3: Transactions — primary work area ── */}
              <div id="transactions-workspace" className="grid grid-cols-1 gap-4 items-start scroll-mt-24">
                <TransactionTable transactions={filteredTransactions} onAddTransaction={handleAddTransaction} onDeleteTransaction={handleDeleteTransaction} onEditTransaction={handleEditTransaction} onOpenDrawer={(tx) => setSelectedTxId(tx.id)} defaultDateRange={periodRange} periodLabel={periodLabelText} theme={theme} />
              </div>
            </>
          )
        ) : (
          <TaxTracker transactions={transactions} theme={theme} />
        )}

        <div className={`pt-8 border-t text-center text-xs ${isDark ? 'border-border text-muted-foreground' : 'border-border text-muted-foreground'}`}>
          <p>My Financial Ledger</p>
          <p className="mt-1 flex items-center justify-center gap-1">
            <CircleHelp className="w-3.5 h-3.5" />
            Upload Excel/CSV files with Date, Description, and Amount columns.
          </p>
        </div>
      </div>

      {showReport && <SpendingReport transactions={filteredTransactions} onClose={() => setShowReport(false)} theme={theme} />}
      {selectedTx && (
        <TransactionDrawer
          transaction={selectedTx}
          budgets={budgets}
          transactions={filteredTransactions}
          onClose={() => setSelectedTxId(null)}
          onEdit={handleEditTransaction}
          onDelete={handleDeleteTransaction}
          theme={theme}
        />
      )}
    </div>
  );
}