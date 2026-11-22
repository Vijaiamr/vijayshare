'use client';
import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Search, Calendar, Landmark, Plus, Trash2, ArrowUpDown, Filter, X, RefreshCw, Eye } from 'lucide-react';
import { Transaction, DEFAULT_CATEGORIES } from '@/lib/ledger/types';
import { normalizeMerchant } from '@/lib/ledger/merchant';
import GlassCard from './GlassCard';

interface TransactionTableProps {
  transactions: Transaction[];
  onAddTransaction: (transaction: Omit<Transaction, 'id'>) => void;
  onDeleteTransaction: (id: string) => void;
  onEditTransaction: (id: string, updates: Partial<Transaction>) => void;
  onOpenDrawer?: (transaction: Transaction) => void;
  defaultDateRange?: { start: string; end: string } | null;
  periodLabel?: string;
  theme?: 'light' | 'dark';
}

function todayLocalISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export default function TransactionTable({ transactions, onAddTransaction, onDeleteTransaction, onEditTransaction, onOpenDrawer, defaultDateRange = null, periodLabel = '', theme = 'dark' }: TransactionTableProps) {
  const isDark = theme === 'dark';
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [sortBy, setSortBy] = useState<string>('date-desc');
  const [isAdding, setIsAdding] = useState(false);
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const editRef = useRef<HTMLDivElement>(null);
  const [isCatMenuOpen, setIsCatMenuOpen] = useState(false);
  const catFilterRef = useRef<HTMLDivElement>(null);

  // Keep the table's date filter in sync with the global period selector.
  // The period is the single source of truth: when it changes, the table's
  // date range defaults to the selected month/year (All Time → no filter).
  const prevRangeKey = useRef<string>('');
  useEffect(() => {
    const key = defaultDateRange ? `${defaultDateRange.start}|${defaultDateRange.end}` : 'all';
    if (key === prevRangeKey.current) return;
    prevRangeKey.current = key;
    setStartDate(defaultDateRange?.start ?? '');
    setEndDate(defaultDateRange?.end ?? '');
  }, [defaultDateRange]);

  const [newTx, setNewTx] = useState({
    date: todayLocalISO(),
    description: '',
    amount: '',
    categories: [] as string[],
    recurring: false
  });

  const [newCategoryInput, setNewCategoryInput] = useState('');

  const allCategories = useMemo(() => {
    const set = new Set(DEFAULT_CATEGORIES);
    transactions.forEach(t => t.categories?.forEach(c => set.add(c)));
    return Array.from(set).sort();
  }, [transactions]);

  const filteredAndSortedTransactions = useMemo(() => {
    let result = [...transactions];
    if (searchTerm.trim() !== '') {
      const term = searchTerm.toLowerCase();
      result = result.filter(t => t.description.toLowerCase().includes(term) || t.categories?.some(c => c.toLowerCase().includes(term)));
    }
    if (selectedCategories.length > 0) result = result.filter(t => t.categories?.some(c => selectedCategories.includes(c)));
    if (startDate) result = result.filter(t => t.date >= startDate);
    if (endDate) result = result.filter(t => t.date <= endDate);
    result.sort((a, b) => {
      const rev = sortBy.endsWith('-desc') ? -1 : 1;
      const col = sortBy.replace(/-(asc|desc)$/, '');
      if (col === 'date') return rev * (new Date(b.date).getTime() - new Date(a.date).getTime());
      if (col === 'amount') return rev * (b.amount - a.amount);
      if (col === 'description') return rev * a.description.localeCompare(b.description);
      if (col === 'category') return rev * (a.categories || []).join(', ').localeCompare((b.categories || []).join(', '));
      return 0;
    });
    return result;
  }, [transactions, searchTerm, selectedCategories, startDate, endDate, sortBy]);

  useEffect(() => { if (editingCategoryId && editRef.current) { const input = editRef.current.querySelector('input'); input?.focus(); } }, [editingCategoryId]);

  useEffect(() => {
    if (!isCatMenuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (catFilterRef.current && !catFilterRef.current.contains(e.target as Node)) {
        setIsCatMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isCatMenuOpen]);

  const handleCategoryToggle = (id: string, cat: string) => {
    const tx = transactions.find(t => t.id === id);
    if (!tx) return;
    const current = tx.categories || [];
    const updated = current.includes(cat) ? current.filter(c => c !== cat) : [...current, cat];
    onEditTransaction(id, { categories: updated.length ? updated : ['Others'] });
  };

  const handleAddNewCategory = (id: string) => {
    if (!newCategoryInput.trim()) return;
    const tx = transactions.find(t => t.id === id);
    if (!tx) return;
    onEditTransaction(id, { categories: [...(tx.categories || []), newCategoryInput.trim()] });
    setNewCategoryInput('');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTx.description || !newTx.amount || newTx.categories.length === 0) return;
    const raw = parseFloat(newTx.amount.replace(/,/g, ''));
    if (isNaN(raw)) return;
    // Ledger convention: income is stored as a negative amount, expenses as
    // positive. The Income category always produces a negative amount so the
    // rest of the page (summary, budgets, charts) treats it as income.
    const isIncome = newTx.categories.includes('Income');
    const amount = isIncome ? -Math.abs(raw) : Math.abs(raw);
    onAddTransaction({ date: newTx.date, description: newTx.description.trim(), amount, categories: newTx.categories, recurring: newTx.recurring });
    setNewTx({ date: todayLocalISO(), description: '', amount: '', categories: [], recurring: false });
    setIsAdding(false);
  };

  const toggleFilterCategory = (cat: string) => setSelectedCategories(prev => prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat]);

  return (
    <GlassCard id="transactions-workspace" theme={theme} className="p-5">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-5">
        <div>
          <h2 className="text-sm font-semibold tracking-tight flex items-center gap-2 text-foreground">
            <Landmark className="text-primary w-4 h-4" />Transactions
          </h2>
          <p className="text-xs mt-1 text-muted-foreground">
            {periodLabel ? `View, search, and manage your transactions · ${periodLabel}.` : 'View, search, and manage your transactions.'}
          </p>
        </div>
        <button id="btn-trigger-add-tx" onClick={() => setIsAdding(true)} className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold py-2 px-3.5 rounded-lg text-xs flex items-center gap-1.5 transition-all self-start md:self-auto cursor-pointer">
          <Plus className="w-4 h-4" />Add Record
        </button>
      </div>

      <div className="space-y-3 mb-5">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-2.5 w-4 h-4 text-muted-foreground" />
            <input id="search-tx" type="text" placeholder="Search merchants..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
              className={`w-full rounded-lg py-2 pl-9 pr-8 text-xs transition-colors focus:outline-none focus:ring-1 focus:ring-ring ${isDark ? 'bg-background border border-input text-foreground placeholder-muted-foreground' : 'bg-background border border-input text-foreground placeholder-muted-foreground'}`} />
            {searchTerm && <button onClick={() => setSearchTerm('')} className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground cursor-pointer"><X className="w-3.5 h-3.5" /></button>}
          </div>
          <div className="relative" ref={catFilterRef}>
            <Filter className="absolute left-3 top-2.5 w-4 h-4 text-muted-foreground pointer-events-none" />
            <div role="button" tabIndex={0} onClick={() => setIsCatMenuOpen(v => !v)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setIsCatMenuOpen(v => !v); } }}
              className={`w-full rounded-lg py-2 pl-9 pr-4 text-xs transition-colors cursor-pointer flex flex-wrap items-center gap-1 min-h-[34px] ${isDark ? 'bg-background border border-input text-foreground' : 'bg-background border border-input text-foreground'}`}>
              {selectedCategories.length === 0 ? <span className="text-muted-foreground">All Categories</span> : selectedCategories.map(cat => (
                <span key={cat} onClick={(e) => { e.stopPropagation(); toggleFilterCategory(cat); }} className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-medium cursor-pointer ${isDark ? 'bg-primary/15 text-primary border border-primary/30' : 'bg-primary/10 text-primary border border-primary/30'}`}>{cat}<X className="w-2.5 h-2.5" /></span>
              ))}
              <ArrowUpDown className="w-3 h-3 text-muted-foreground ml-auto shrink-0 pointer-events-none" />
            </div>
            {isCatMenuOpen && (
              <div className={`absolute right-0 top-full mt-1 z-50 min-w-[180px] rounded-lg border p-2 shadow-xl ${isDark ? 'bg-popover border-border' : 'bg-popover border-border'}`}>
                {allCategories.map(cat => (
                  <label key={cat} className={`flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs cursor-pointer transition-colors ${isDark ? 'hover:bg-muted text-foreground' : 'hover:bg-muted text-foreground'}`}>
                    <input type="checkbox" checked={selectedCategories.includes(cat)} onChange={() => toggleFilterCategory(cat)} className="rounded accent-primary" />{cat}
                  </label>
                ))}
                {selectedCategories.length > 0 && <button onClick={() => setSelectedCategories([])} className="w-full mt-1 text-center text-[10px] font-semibold py-1 text-strong-sell hover:text-strong-sell/80 cursor-pointer">Clear all</button>}
              </div>
            )}
          </div>
          <div className="relative">
            <ArrowUpDown className="absolute left-3 top-2.5 w-4 h-4 text-muted-foreground" />
            <select id="sort-tx" value={sortBy} onChange={(e) => setSortBy(e.target.value as any)}
              className={`w-full rounded-lg py-2 pl-9 pr-4 text-xs focus:outline-none focus:ring-1 focus:ring-ring transition-colors appearance-none cursor-pointer ${isDark ? 'bg-background border border-input text-foreground' : 'bg-background border border-input text-foreground'}`}>
              <option value="date-desc" className={isDark ? 'bg-popover text-foreground' : 'bg-popover text-foreground'}>Date: Newest first</option>
              <option value="date-asc" className={isDark ? 'bg-popover text-foreground' : 'bg-popover text-foreground'}>Date: Oldest first</option>
              <option value="amount-desc" className={isDark ? 'bg-popover text-foreground' : 'bg-popover text-foreground'}>Value: Highest first</option>
              <option value="amount-asc" className={isDark ? 'bg-popover text-foreground' : 'bg-popover text-foreground'}>Value: Lowest first</option>
            </select>
          </div>
        </div>

        <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-lg border ${isDark ? 'bg-muted/50 border-border' : 'bg-muted/50 border-border'}`}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-semibold flex items-center gap-1.5 shrink-0 text-muted-foreground"><Calendar className="w-3.5 h-3.5 text-primary" />Date Range:</span>
            <div className="flex items-center gap-1.5">
              <input id="filter-start-date" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={`rounded-lg py-1 px-2 text-[11px] transition-colors focus:outline-none focus:ring-1 focus:ring-ring cursor-pointer ${isDark ? 'bg-background border border-input text-foreground' : 'bg-background border border-input text-foreground'}`} />
              <span className="text-[10px] text-muted-foreground">to</span>
              <input id="filter-end-date" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className={`rounded-lg py-1 px-2 text-[11px] transition-colors focus:outline-none focus:ring-1 focus:ring-ring cursor-pointer ${isDark ? 'bg-background border border-input text-foreground' : 'bg-background border border-input text-foreground'}`} />
            </div>
          </div>
          {(searchTerm || selectedCategories.length > 0 || startDate || endDate) && (
            <button id="btn-clear-filters" onClick={() => { setSearchTerm(''); setSelectedCategories([]); setStartDate(''); setEndDate(''); }}
              className="text-[11px] font-semibold flex items-center gap-1 px-2.5 py-1 rounded-lg border transition-all cursor-pointer text-strong-sell bg-strong-sell/10 border-strong-sell/30 hover:bg-strong-sell/20">
              <X className="w-3 h-3" />Clear Filters
            </button>
          )}
        </div>
      </div>

      {/* ── Mobile: compact transaction cards ── */}
      <div className="md:hidden space-y-2">
        {filteredAndSortedTransactions.length === 0 ? (
          <div className="rounded-lg border border-border bg-card py-10 text-center text-muted-foreground">
            <div className="flex flex-col items-center gap-2">
              <span className="text-sm font-semibold text-foreground">{transactions.length === 0 ? (periodLabel ? `No transactions in ${periodLabel}` : 'No data loaded') : 'No matching records'}</span>
              <span className="text-xs text-muted-foreground">{transactions.length === 0 ? (periodLabel ? 'Try a different period or switch to All Time.' : 'Upload your bank statement using the panel above to get started.') : 'Try adjusting your filters or search terms.'}</span>
            </div>
          </div>
        ) : filteredAndSortedTransactions.map((tx) => {
          const isIncome = tx.amount < 0;
          const merchant = normalizeMerchant(tx);
          return (
            <div key={tx.id} onClick={() => onOpenDrawer?.(tx)}
              className={`rounded-lg border border-border bg-card p-3 transition-colors ${onOpenDrawer ? 'cursor-pointer hover:border-primary/30' : ''}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium text-xs text-foreground truncate">{merchant.name}</span>
                    {tx.recurring && <span title="Monthly Recurring / Subscription" className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold shrink-0 bg-primary/10 text-primary border border-primary/30"><RefreshCw className="w-2.5 h-2.5" />Sub</span>}
                  </div>
                  <p className="text-[9px] text-muted-foreground truncate">{merchant.meta}</p>
                </div>
                <span className={`text-xs font-semibold font-mono shrink-0 ${isIncome ? 'text-primary' : 'text-foreground'}`}>
                  {isIncome ? '-' : ''}₹{Math.abs(tx.amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2 mt-2">
                <div className="flex flex-wrap gap-1 min-w-0">
                  {(tx.categories || []).map(cat => (
                    <span key={cat} className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-medium border bg-muted border-border text-muted-foreground">{cat}</span>
                  ))}
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="text-[9px] font-mono text-muted-foreground">{tx.date}</span>
                  <button id={`btn-delete-tx-mobile-${tx.id}`} onClick={(e) => { e.stopPropagation(); onDeleteTransaction(tx.id); }} className="p-1 rounded-md transition-all cursor-pointer text-muted-foreground hover:text-strong-sell hover:bg-strong-sell/10" title="Delete record"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Desktop: dense table ── */}
      <div className={`hidden md:block overflow-x-auto overflow-y-auto max-h-[500px] rounded-lg border ${isDark ? 'border-border' : 'border-border'}`}>
        <table className="w-full text-left border-collapse">
          <thead className={`sticky top-0 z-10 ${isDark ? 'bg-card' : 'bg-card'}`}>
            <tr className={`border-b text-[11px] font-semibold uppercase tracking-wider ${isDark ? 'bg-muted/60 border-border text-muted-foreground' : 'bg-muted/60 border-border text-muted-foreground'}`}>
              {(['date', 'description', 'category', 'amount'] as const).map(col => {
                const dir = sortBy.startsWith(col) ? (sortBy.endsWith('-asc') ? 'asc' : 'desc') : null;
                return (
                  <th key={col} onClick={() => setSortBy(dir === 'desc' ? `${col}-asc` : `${col}-desc`)} className={`py-3 px-4 cursor-pointer select-none hover:text-primary transition-colors ${col === 'amount' ? 'text-right' : ''}`}>
                    <span className="inline-flex items-center gap-1">
                      {col === 'date' ? 'Date' : col === 'description' ? 'Merchant' : col === 'category' ? 'Category' : 'Amount'}
                      <span className={`inline-flex flex-col leading-none text-[8px] opacity-40 ${dir ? 'text-primary opacity-100' : ''}`}>
                        <span className={dir === 'asc' ? 'text-primary' : ''}>▲</span>
                        <span className={dir === 'desc' ? 'text-primary' : ''}>▼</span>
                      </span>
                    </span>
                  </th>
                );
              })}
              <th className="py-3 px-4 text-center w-12">Actions</th>
            </tr>
          </thead>
          <tbody className={`divide-y text-xs ${isDark ? 'divide-border' : 'divide-border'}`}>
            {filteredAndSortedTransactions.length === 0 ? (
              <tr><td colSpan={5} className="py-10 text-center text-muted-foreground">
                <div className="flex flex-col items-center gap-2">
                  <span className="text-sm font-semibold text-foreground">{transactions.length === 0 ? (periodLabel ? `No transactions in ${periodLabel}` : 'No data loaded') : 'No matching records'}</span>
                  <span className="text-xs text-muted-foreground">{transactions.length === 0 ? (periodLabel ? 'Try a different period or switch to All Time.' : 'Upload your bank statement using the panel on the right to get started.') : 'Try adjusting your filters or search terms.'}</span>
                </div>
              </td></tr>
            ) : filteredAndSortedTransactions.map((tx) => {
              const isIncome = tx.amount < 0;
              const merchant = normalizeMerchant(tx);
              return (
                <tr id={`tx-row-${tx.id}`} key={tx.id}
                  onClick={() => onOpenDrawer?.(tx)}
                  className={`group transition-colors ${onOpenDrawer ? 'cursor-pointer' : ''} ${isDark ? 'hover:bg-muted/50 text-muted-foreground' : 'hover:bg-muted/50 text-muted-foreground'}`}>
                  <td className={`py-3 px-4 font-mono whitespace-nowrap ${isDark ? 'text-muted-foreground' : 'text-muted-foreground'}`}>{tx.date}</td>
                  <td className={`py-3 px-4 max-w-[200px] md:max-w-[300px] ${isDark ? 'text-foreground' : 'text-foreground'}`}>
                    <div className="flex items-center gap-1.5 min-w-0">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="font-medium truncate">{merchant.name}</span>
                          {tx.recurring && <span title="Monthly Recurring / Subscription" className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold shrink-0 ${isDark ? 'bg-primary/10 text-primary border border-primary/30' : 'bg-primary/10 text-primary border border-primary/30'}`}><RefreshCw className="w-2.5 h-2.5" />Sub</span>}
                        </div>
                        <p className="text-[9px] text-muted-foreground truncate">{merchant.meta}</p>
                      </div>
                      {onOpenDrawer && <Eye className="w-3 h-3 text-muted-foreground/40 group-hover:text-primary shrink-0 ml-auto" />}
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    {editingCategoryId === tx.id ? (
                      <div ref={editRef} className="flex flex-wrap gap-1 max-w-[200px]">
                        {allCategories.map(cat => {
                          const isSelected = (tx.categories || []).includes(cat);
                          return <button key={cat} onClick={() => handleCategoryToggle(tx.id, cat)} className={`text-[9px] px-1.5 py-0.5 rounded-full border transition-all cursor-pointer ${isSelected ? isDark ? 'bg-primary/20 border-primary/50 text-primary' : 'bg-primary/15 border-primary/50 text-primary' : isDark ? 'bg-muted border-border text-muted-foreground hover:bg-muted/80' : 'bg-muted border-border text-muted-foreground hover:bg-muted/80'}`}>{isSelected ? '✓ ' : '+ '}{cat}</button>;
                        })}
                        <div className="flex gap-1 w-full mt-1">
                          <input type="text" placeholder="New category..." value={newCategoryInput} onChange={(e) => setNewCategoryInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') handleAddNewCategory(tx.id); }} className={`flex-1 text-[9px] px-1.5 py-0.5 rounded border outline-none min-w-0 ${isDark ? 'bg-background border-input text-foreground placeholder-muted-foreground' : 'bg-background border-input text-foreground placeholder-muted-foreground'}`} />
                          <button onClick={() => handleAddNewCategory(tx.id)} className={`text-[9px] px-1.5 py-0.5 rounded font-semibold cursor-pointer ${isDark ? 'bg-primary/20 text-primary hover:bg-primary/30' : 'bg-primary/15 text-primary hover:bg-primary/25'}`}>Add</button>
                        </div>
                        <button onClick={() => { setEditingCategoryId(null); setNewCategoryInput(''); }} className="text-[9px] text-strong-sell hover:text-strong-sell/80 mt-1 cursor-pointer">Done</button>
                      </div>
                    ) : (
                      <div onClick={(e) => { e.stopPropagation(); setEditingCategoryId(tx.id); }} className="flex flex-wrap gap-1 cursor-pointer max-w-[200px]">
                        {(tx.categories || []).map(cat => (
                          <span key={cat} title={tx.matchedKeywords?.[cat] ? `Matched: "${tx.matchedKeywords[cat]}"` : undefined} className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-medium border transition-all hover:border-primary/50 ${isDark ? 'bg-muted border-border text-muted-foreground' : 'bg-muted border-border text-muted-foreground'}`}>
                            {tx.confidence && tx.confidence !== 'high' && <span className={`w-1.5 h-1.5 rounded-full mr-0.5 ${tx.confidence === 'medium' ? 'bg-hold' : 'bg-muted-foreground'}`} />}
                            {tx.learned && <span className="w-1.5 h-1.5 rounded-full mr-0.5 bg-primary" title="Validated from past correction" />}
                            {cat}
                          </span>
                        ))}
                        {tx.confidence === 'low' && <span className="text-[8px] px-1 py-0.5 rounded-full border border-hold/40 text-hold bg-hold/10">needs review</span>}
                      </div>
                    )}
                  </td>
                  <td className={`py-3 px-4 text-right font-semibold font-mono ${isIncome ? 'text-primary' : isDark ? 'text-foreground' : 'text-foreground'}`}>
                    {isIncome ? '-' : ''}₹{Math.abs(tx.amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  <td className="py-3 px-4 text-center">
                    <button id={`btn-delete-tx-${tx.id}`} onClick={(e) => { e.stopPropagation(); onDeleteTransaction(tx.id); }} className={`p-1 rounded-md transition-all cursor-pointer ${isDark ? 'text-muted-foreground hover:text-strong-sell hover:bg-strong-sell/10' : 'text-muted-foreground hover:text-strong-sell hover:bg-strong-sell/10'}`} title="Delete record"><Trash2 className="w-3.5 h-3.5" /></button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {isAdding && (
        <div id="add-tx-modal" className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in">
          <div className={`relative w-full max-w-md overflow-hidden rounded-xl p-6 shadow-2xl border ${isDark ? 'bg-popover border-border' : 'bg-popover border-border'}`}>
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-base font-semibold flex items-center gap-1.5 text-foreground"><Calendar className="w-4 h-4 text-primary" />Add Transaction</h3>
              <button id="btn-close-modal" onClick={() => setIsAdding(false)} className={`p-1 rounded-lg transition-all cursor-pointer ${isDark ? 'text-muted-foreground hover:text-foreground hover:bg-muted' : 'text-muted-foreground hover:text-foreground hover:bg-muted'}`}><X className="w-4 h-4" /></button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className={`block text-xs font-semibold mb-1 ${isDark ? 'text-foreground' : 'text-foreground'}`}>Transaction Date</label>
                <input id="input-tx-date" type="date" required value={newTx.date} onChange={(e) => setNewTx({ ...newTx, date: e.target.value })}
                  className={`w-full rounded-lg p-2.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring ${isDark ? 'bg-background border border-input text-foreground' : 'bg-background border border-input text-foreground'}`} />
              </div>
              <div>
                <label className={`block text-xs font-semibold mb-1 ${isDark ? 'text-foreground' : 'text-foreground'}`}>Merchant / Description</label>
                <input id="input-tx-desc" type="text" required placeholder="e.g. Starbucks Coffee" value={newTx.description} onChange={(e) => setNewTx({ ...newTx, description: e.target.value })}
                  className={`w-full rounded-lg p-2.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring ${isDark ? 'bg-background border border-input text-foreground placeholder-muted-foreground' : 'bg-background border border-input text-foreground placeholder-muted-foreground'}`} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={`block text-xs font-semibold mb-1 ${isDark ? 'text-foreground' : 'text-foreground'}`}>Amount (₹)</label>
                  <input id="input-tx-amount" type="number" step="0.01" required placeholder="e.g. 500" value={newTx.amount} onChange={(e) => setNewTx({ ...newTx, amount: e.target.value })}
                    className={`w-full rounded-lg p-2.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring ${isDark ? 'bg-background border border-input text-foreground placeholder-muted-foreground' : 'bg-background border border-input text-foreground placeholder-muted-foreground'}`} />
                </div>
                <div>
                  <label className={`block text-xs font-semibold mb-1 ${isDark ? 'text-foreground' : 'text-foreground'}`}>Categories</label>
                  <div className={`w-full rounded-lg p-2 text-xs border flex flex-wrap gap-1 min-h-[38px] ${isDark ? 'bg-background border-input text-foreground' : 'bg-background border-input text-foreground'}`}>
                    {allCategories.map(cat => {
                      const isSelected = newTx.categories.includes(cat);
                      return <button type="button" key={cat} onClick={() => setNewTx(prev => ({ ...prev, categories: isSelected ? prev.categories.filter(c => c !== cat) : [...prev.categories, cat] }))}
                        className={`text-[9px] px-1.5 py-0.5 rounded-full border transition-all cursor-pointer ${isSelected ? isDark ? 'bg-primary/20 border-primary/50 text-primary' : 'bg-primary/15 border-primary/50 text-primary' : isDark ? 'bg-muted border-border text-muted-foreground hover:bg-muted/80' : 'bg-muted border-border text-muted-foreground hover:bg-muted/80'}`}>{isSelected ? '✓ ' : '+ '}{cat}</button>;
                    })}
                  </div>
                </div>
              </div>
              <div className={`flex items-center justify-between p-3 rounded-lg border ${isDark ? 'bg-muted/50 border-border' : 'bg-muted/50 border-border'}`}>
                <div className="flex flex-col">
                  <span className="text-xs font-semibold text-foreground">Recurring / Subscription</span>
                  <span className="text-[10px] text-muted-foreground">Mark as a monthly subscription or fixed cost</span>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input id="checkbox-tx-recurring" type="checkbox" checked={newTx.recurring || false} onChange={(e) => setNewTx({ ...newTx, recurring: e.target.checked })} className="sr-only peer" />
                  <div className={`w-9 h-5 rounded-full relative transition-all duration-300 after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all ${isDark ? 'bg-muted-foreground/40 peer-checked:bg-primary peer-checked:after:translate-x-4' : 'bg-muted-foreground/40 peer-checked:bg-primary peer-checked:after:translate-x-4'}`} />
                </label>
              </div>
              <div className="flex gap-2 pt-3">
                <button id="btn-cancel-modal" type="button" onClick={() => setIsAdding(false)} className={`flex-1 rounded-lg py-2 text-xs font-semibold border transition-all cursor-pointer ${isDark ? 'bg-muted hover:bg-muted/80 text-foreground border-border' : 'bg-muted hover:bg-muted/80 text-foreground border-border'}`}>Cancel</button>
                <button id="btn-submit-tx" type="submit" className="flex-1 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg py-2 text-xs font-semibold transition-all cursor-pointer">Save Record</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </GlassCard>
  );
}