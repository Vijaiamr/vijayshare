'use client';
import React, { useState, useMemo } from 'react';
import {
  X, Pencil, Tag, Trash2, Calendar, CreditCard, FileText, Check, ArrowLeft,
  Wallet, AlertTriangle, RefreshCw,
} from 'lucide-react';
import { Transaction, BudgetRecommendation, DEFAULT_CATEGORIES } from '@/lib/ledger/types';
import { normalizeMerchant, detectPaymentMethod, formatDisplayDate } from '@/lib/ledger/merchant';

interface TransactionDrawerProps {
  transaction: Transaction | null;
  budgets: BudgetRecommendation[];
  transactions: Transaction[];
  onClose: () => void;
  onEdit: (id: string, updates: Partial<Transaction>) => void;
  onDelete: (id: string) => void;
  theme?: 'light' | 'dark';
}

/** Full-period spend per category — the same basis as BudgetSummary and the
 *  KPI cards (full-period totals ÷ configured limits), so the drawer's budget
 *  status always matches the Monthly Budgets panel. */
function useCategorySpend(transactions: Transaction[]) {
  return useMemo(() => {
    const totals: Record<string, number> = {};
    transactions.forEach(t => {
      if (t.amount > 0) {
        (t.categories || ['Others']).forEach(c => {
          if (c !== 'Income') totals[c] = (totals[c] || 0) + t.amount;
        });
      }
    });
    return totals;
  }, [transactions]);
}

export default function TransactionDrawer({
  transaction, budgets, transactions, onClose, onEdit, onDelete, theme = 'dark',
}: TransactionDrawerProps) {
  const isDark = theme === 'dark';
  const [mode, setMode] = useState<'view' | 'edit' | 'recategorize'>('view');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editForm, setEditForm] = useState({ description: '', amount: '', date: '' });
  const [newCategoryInput, setNewCategoryInput] = useState('');

  const categorySpendByCat = useCategorySpend(transactions);

  // Reset transient state whenever a different transaction opens.
  const txId = transaction?.id ?? null;
  React.useEffect(() => {
    setMode('view');
    setConfirmDelete(false);
    setNewCategoryInput('');
    if (transaction) {
      setEditForm({
        description: transaction.description,
        amount: String(Math.abs(transaction.amount)),
        date: transaction.date,
      });
    }
  }, [txId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Mobile behavior: lock background scroll while the drawer is open and
  // close on Escape (backdrop click already closes).
  React.useEffect(() => {
    if (!transaction) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [transaction, onClose]);

  const allCategories = useMemo(() => {
    const set = new Set(DEFAULT_CATEGORIES);
    transactions.forEach(t => t.categories?.forEach(c => set.add(c)));
    return Array.from(set).sort();
  }, [transactions]);

  if (!transaction) return null;

  const isIncome = transaction.amount < 0;
  const merchant = normalizeMerchant(transaction);
  const paymentMethod = detectPaymentMethod(transaction.description);
  const primaryCategory = (transaction.categories || [])[0] || 'Others';

  // Budget status for the primary category (full-period basis, matches
  // BudgetSummary). Categories without a configured limit use the same
  // fallback as BudgetSummary: 5% of monthly income, min ₹1,000.
  const totalIncome = useMemo(
    () => transactions.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0),
    [transactions],
  );
  const monthsSpanned = useMemo(() => {
    if (transactions.length === 0) return 1;
    const dates = transactions.map(t => new Date(t.date)).filter(d => !isNaN(d.getTime()));
    if (dates.length === 0) return 1;
    const min = new Date(Math.min(...dates.map(d => d.getTime())));
    const max = new Date(Math.max(...dates.map(d => d.getTime())));
    return Math.max(1, (max.getFullYear() - min.getFullYear()) * 12 + max.getMonth() - min.getMonth() + 1);
  }, [transactions]);
  const fallbackLimit = Math.max(Math.round((totalIncome / monthsSpanned) * 0.05), 1000);

  const budget = budgets.find(b => b.category === primaryCategory);
  const limit = budget ? budget.limitAmount : fallbackLimit;
  const categorySpend = categorySpendByCat[primaryCategory] || 0;
  const budgetPct = limit > 0 ? Math.round((categorySpend / limit) * 100) : null;
  const budgetCapped = budgetPct !== null ? Math.min(budgetPct, 999) : null;
  const budgetStatus = budgetCapped === null ? null
    : budgetCapped >= 200 ? 'critical'
    : budgetCapped >= 100 ? 'over'
    : 'on-track';

  const budgetBadgeClass = budgetStatus === 'critical' ? 'text-strong-sell bg-strong-sell/10 border-strong-sell/30'
    : budgetStatus === 'over' ? 'text-hold bg-hold/10 border-hold/30'
    : 'text-primary bg-primary/10 border-primary/30';

  const handleSaveEdit = () => {
    const amount = parseFloat(editForm.amount);
    if (!editForm.description.trim() || isNaN(amount) || amount <= 0 || !editForm.date) return;
    onEdit(transaction.id, {
      description: editForm.description.trim(),
      amount: isIncome ? -amount : amount,
      date: editForm.date,
    });
    setMode('view');
  };

  const toggleCategory = (cat: string) => {
    const current = transaction.categories || [];
    const updated = current.includes(cat) ? current.filter(c => c !== cat) : [...current, cat];
    onEdit(transaction.id, { categories: updated.length ? updated : ['Others'] });
  };

  const addNewCategory = () => {
    if (!newCategoryInput.trim()) return;
    onEdit(transaction.id, { categories: [...(transaction.categories || []), newCategoryInput.trim()] });
    setNewCategoryInput('');
  };

  const handleDelete = () => {
    if (!confirmDelete) { setConfirmDelete(true); return; }
    onDelete(transaction.id);
    onClose();
  };

  const inputCls = `w-full rounded-lg p-2.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring bg-background border border-input text-foreground placeholder-muted-foreground`;

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-fade-in" onClick={onClose} />
      <aside
        id="tx-drawer"
        className={`absolute right-0 top-0 h-full w-full max-w-md overflow-y-auto border-l shadow-2xl animate-slide-in-right ${isDark ? 'bg-popover border-border' : 'bg-popover border-border'}`}
        role="dialog"
        aria-modal="true"
        aria-label="Transaction details"
      >
        {/* Header */}
        <div className={`sticky top-0 z-10 flex items-start justify-between gap-3 p-5 border-b backdrop-blur-md ${isDark ? 'bg-popover/95 border-border' : 'bg-popover/95 border-border'}`}>
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className={`w-1.5 h-1.5 rounded-full ${isIncome ? 'bg-primary' : 'bg-hold'}`} />
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                {isIncome ? 'Income' : 'Expense'} · {merchant.meta}
              </p>
            </div>
            <h3 className="text-lg font-semibold tracking-tight text-foreground truncate">{merchant.name}</h3>
          </div>
          <button onClick={onClose} className={`p-1.5 rounded-lg transition-all cursor-pointer shrink-0 ${isDark ? 'text-muted-foreground hover:text-foreground hover:bg-muted' : 'text-muted-foreground hover:text-foreground hover:bg-muted'}`} aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* Amount */}
          <div className={`rounded-xl border p-4 ${isIncome ? 'border-primary/25 bg-primary/5' : 'border-border bg-muted/40'}`}>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">Amount</p>
            <p className={`text-2xl font-semibold font-mono tracking-tight ${isIncome ? 'text-primary' : 'text-foreground'}`}>
              {isIncome ? '-' : ''}₹{Math.abs(transaction.amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
          </div>

          {/* Meta grid */}
          <div className="grid grid-cols-2 gap-3">
            <div className={`rounded-lg border p-3 ${isDark ? 'border-border bg-muted/30' : 'border-border bg-muted/30'}`}>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground flex items-center gap-1 mb-1"><Calendar className="w-3 h-3" />Date</p>
              <p className="text-xs font-semibold text-foreground">{formatDisplayDate(transaction.date)}</p>
            </div>
            <div className={`rounded-lg border p-3 ${isDark ? 'border-border bg-muted/30' : 'border-border bg-muted/30'}`}>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground flex items-center gap-1 mb-1"><CreditCard className="w-3 h-3" />Payment</p>
              <p className="text-xs font-semibold text-foreground">{paymentMethod}</p>
            </div>
          </div>

          {/* Category */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground flex items-center gap-1"><Tag className="w-3 h-3" />Category</p>
              {mode !== 'recategorize' && (
                <button onClick={() => setMode('recategorize')} className={`text-[10px] font-semibold px-2 py-1 rounded-md border flex items-center gap-1 transition-all cursor-pointer ${isDark ? 'bg-muted border-border text-muted-foreground hover:text-foreground' : 'bg-muted border-border text-muted-foreground hover:text-foreground'}`}>
                  <Pencil className="w-2.5 h-2.5" />Recategorize
                </button>
              )}
            </div>

            {mode === 'recategorize' ? (
              <div className={`rounded-xl border p-3 space-y-2 ${isDark ? 'border-border bg-muted/30' : 'border-border bg-muted/30'}`}>
                <div className="flex flex-wrap gap-1.5">
                  {allCategories.map(cat => {
                    const isSelected = (transaction.categories || []).includes(cat);
                    return (
                      <button key={cat} onClick={() => toggleCategory(cat)}
                        className={`text-[10px] px-2 py-1 rounded-full border transition-all cursor-pointer ${isSelected ? 'bg-primary/20 border-primary/50 text-primary' : 'bg-muted border-border text-muted-foreground hover:bg-muted/80'}`}>
                        {isSelected ? '✓ ' : '+ '}{cat}
                      </button>
                    );
                  })}
                </div>
                <div className="flex gap-1.5">
                  <input type="text" placeholder="New category..." value={newCategoryInput}
                    onChange={(e) => setNewCategoryInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') addNewCategory(); }}
                    className={`flex-1 text-[10px] px-2 py-1.5 rounded-lg border outline-none min-w-0 ${isDark ? 'bg-background border-input text-foreground placeholder-muted-foreground' : 'bg-background border-input text-foreground placeholder-muted-foreground'}`} />
                  <button onClick={addNewCategory} className={`text-[10px] px-2.5 py-1.5 rounded-lg font-semibold cursor-pointer ${isDark ? 'bg-primary/20 text-primary hover:bg-primary/30' : 'bg-primary/15 text-primary hover:bg-primary/25'}`}>Add</button>
                </div>
                <button onClick={() => setMode('view')} className="text-[10px] font-semibold text-muted-foreground hover:text-foreground cursor-pointer flex items-center gap-1">
                  <ArrowLeft className="w-3 h-3" />Done
                </button>
              </div>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {(transaction.categories || []).map(cat => (
                  <span key={cat} className={`inline-flex items-center gap-0.5 px-2 py-1 rounded-full text-[10px] font-medium border ${isDark ? 'bg-muted border-border text-muted-foreground' : 'bg-muted border-border text-muted-foreground'}`}>{cat}</span>
                ))}
              </div>
            )}
          </div>

          {/* Budget status (configured limit or 5%-of-income fallback) */}
          {budgetStatus && limit > 0 && (
            <div className={`rounded-xl border p-3 flex items-center justify-between gap-3 ${budgetStatus === 'critical' ? 'border-strong-sell/30 bg-strong-sell/5' : budgetStatus === 'over' ? 'border-hold/30 bg-hold/5' : 'border-primary/20 bg-primary/5'}`}>
              <div className="flex items-center gap-2 min-w-0">
                <Wallet className={`w-4 h-4 shrink-0 ${budgetStatus === 'critical' ? 'text-strong-sell' : budgetStatus === 'over' ? 'text-hold' : 'text-primary'}`} />
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Budget</p>
                  <p className="text-xs font-semibold text-foreground truncate">{primaryCategory} · {budgetCapped}%</p>
                </div>
              </div>
              <span className={`text-[10px] font-semibold px-2 py-1 rounded-full border shrink-0 ${budgetBadgeClass}`}>
                {budgetStatus === 'critical' ? 'Critical' : budgetStatus === 'over' ? 'Over budget' : 'On track'}
              </span>
            </div>
          )}

          {/* Notes — raw description */}
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground flex items-center gap-1 mb-2"><FileText className="w-3 h-3" />Notes</p>
            <p className={`text-[11px] leading-relaxed font-mono rounded-lg border p-3 break-words ${isDark ? 'bg-muted/40 border-border text-muted-foreground' : 'bg-muted/40 border-border text-muted-foreground'}`}>
              {transaction.description}
            </p>
          </div>

          {/* Actions */}
          <div className="pt-2 space-y-2">
            {mode === 'edit' ? (
              <div className={`rounded-xl border p-4 space-y-3 ${isDark ? 'border-border bg-muted/30' : 'border-border bg-muted/30'}`}>
                <div>
                  <label className="block text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">Merchant / Description</label>
                  <input type="text" value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} className={inputCls} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">Amount (₹)</label>
                    <input type="number" step="0.01" value={editForm.amount} onChange={(e) => setEditForm({ ...editForm, amount: e.target.value })} className={inputCls} />
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">Date</label>
                    <input type="date" value={editForm.date} onChange={(e) => setEditForm({ ...editForm, date: e.target.value })} className={inputCls} />
                  </div>
                </div>
                <div className="flex gap-2 pt-1">
                  <button onClick={() => setMode('view')} className={`flex-1 rounded-lg py-2 text-xs font-semibold border transition-all cursor-pointer ${isDark ? 'bg-muted hover:bg-muted/80 text-foreground border-border' : 'bg-muted hover:bg-muted/80 text-foreground border-border'}`}>Cancel</button>
                  <button onClick={handleSaveEdit} className="flex-1 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg py-2 text-xs font-semibold transition-all cursor-pointer flex items-center justify-center gap-1"><Check className="w-3.5 h-3.5" />Save</button>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                <button onClick={() => setMode('edit')} className={`rounded-lg py-2 text-xs font-semibold border flex items-center justify-center gap-1.5 transition-all cursor-pointer ${isDark ? 'bg-muted hover:bg-muted/80 text-foreground border-border' : 'bg-muted hover:bg-muted/80 text-foreground border-border'}`}>
                  <Pencil className="w-3.5 h-3.5" />Edit
                </button>
                <button onClick={() => setMode('recategorize')} className={`rounded-lg py-2 text-xs font-semibold border flex items-center justify-center gap-1.5 transition-all cursor-pointer ${isDark ? 'bg-muted hover:bg-muted/80 text-foreground border-border' : 'bg-muted hover:bg-muted/80 text-foreground border-border'}`}>
                  <Tag className="w-3.5 h-3.5" />Recategorize
                </button>
                <button onClick={handleDelete}
                  className={`rounded-lg py-2 text-xs font-semibold border flex items-center justify-center gap-1.5 transition-all cursor-pointer ${confirmDelete ? 'bg-strong-sell text-white border-strong-sell' : 'text-strong-sell bg-strong-sell/10 border-strong-sell/30 hover:bg-strong-sell/20'}`}>
                  {confirmDelete ? <><Check className="w-3.5 h-3.5" />Confirm</> : <><Trash2 className="w-3.5 h-3.5" />Delete</>}
                </button>
              </div>
            )}

            {confirmDelete && (
              <p className="text-[10px] text-strong-sell flex items-center gap-1">
                <AlertTriangle className="w-3 h-3 shrink-0" />Click Delete again to permanently remove this record.
              </p>
            )}

            {transaction.recurring && (
              <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                <RefreshCw className="w-3 h-3" />Marked as recurring / subscription
              </p>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}