'use client';
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Percent, Info, ShieldCheck, Calculator, RefreshCw, Wallet } from 'lucide-react';
import GlassCard from './GlassCard';
import { Transaction } from '@/lib/ledger/types';
import { isRentTransaction } from '@/lib/ledger/engine';
import { analytics } from '@/lib/analytics/client-tracker';

interface TaxTrackerProps {
  transactions: Transaction[];
  theme: 'light' | 'dark';
}

export default function TaxTracker({ transactions, theme }: TaxTrackerProps) {
  const isDark = theme === 'dark';
  const [grossSalary, setGrossSalary] = useState<number>(0);
  const [sec80C, setSec80C] = useState<number>(0);
  const [sec80D, setSec80D] = useState<number>(0);
  const [sec80CCD, setSec80CCD] = useState<number>(0);
  const [sec24b, setSec24b] = useState<number>(0);
  const [isHraModalOpen, setIsHraModalOpen] = useState(false);
  const [basicSalary, setBasicSalary] = useState<number>(500000);
  const [rentPaid, setRentPaid] = useState<number>(0);
  const [isMetro, setIsMetro] = useState<boolean>(true);
  const [hraReceived, setHraReceived] = useState<number>(0);
  const [slipMonthlyBasic, setSlipMonthlyBasic] = useState<number>(0);
  const [slipMonthlyHra, setSlipMonthlyHra] = useState<number>(0);
  const [claimedHra, setClaimedHra] = useState<number>(0);
  const [otherExemptions, setOtherExemptions] = useState<number>(0);

  const autoDetected = useMemo(() => {
    const incomeTxs = transactions.filter(t => t.amount < 0);
    const sumIncome = Math.abs(incomeTxs.reduce((sum, t) => sum + t.amount, 0));
    // Period-aware annualization: scale the observed sum to a full year based on
    // the actual date span of the ledger (1 month of data -> x12, 12 months -> x1).
    const dates = transactions.map(t => new Date(t.date)).filter(d => !isNaN(d.getTime()));
    let monthsSpan = 1;
    if (dates.length > 0) {
      const minDate = new Date(Math.min(...dates.map(d => d.getTime())));
      const maxDate = new Date(Math.max(...dates.map(d => d.getTime())));
      monthsSpan = Math.max(1, (maxDate.getFullYear() - minDate.getFullYear()) * 12 + (maxDate.getMonth() - minDate.getMonth()) + 1);
    }
    const annualIncome = sumIncome > 0 ? Math.round(sumIncome * (12 / monthsSpan)) : 0;
    const expenseTxs = transactions.filter(t => t.amount > 0);
    const matchesKeyword = (desc: string, keywords: string[]) => { const l = desc.toLowerCase(); return keywords.some(k => l.includes(k)); };
    const annualize = (periodSum: number) => Math.round(periodSum * (12 / monthsSpan));
    // HRA received: some employers credit the HRA component separately (or the
    // salary credit description mentions it). Word-boundary match avoids
    // false hits on unrelated words containing "hra".
    const hraIncome = incomeTxs.filter(t => /\bhra\b/i.test(t.description)).reduce((s, t) => s + Math.abs(t.amount), 0);
    const annualHra = annualize(hraIncome);
    // 80C insurance: exclude health/medical/mediclaim — those belong to 80D.
    const sec80C_insurance = expenseTxs.filter(t => matchesKeyword(t.description, ['insurance', 'lic', 'policy']) && !matchesKeyword(t.description, ['health', 'medical', 'mediclaim'])).reduce((s, t) => s + t.amount, 0);
    const sec80C_ppf = expenseTxs.filter(t => matchesKeyword(t.description, ['ppf', 'public provident fund'])).reduce((s, t) => s + t.amount, 0);
    const sec80C_epf = expenseTxs.filter(t => matchesKeyword(t.description, ['epf', 'employee provident fund', 'vpf', 'voluntary provident fund'])).reduce((s, t) => s + t.amount, 0);
    const sec80C_elss = expenseTxs.filter(t => matchesKeyword(t.description, ['elss', 'tax saving', 'tax saver'])).reduce((s, t) => s + t.amount, 0);
    // NOTE: generic 'mutual fund'/'sip' are intentionally NOT counted — only ELSS
    // (equity-linked savings schemes) qualify for the 80C deduction.
    const monthly80C = sec80C_insurance + sec80C_ppf + sec80C_epf + sec80C_elss;
    const sec80C_val = Math.min(150000, annualize(monthly80C));
    const monthly80D = expenseTxs.filter(t => matchesKeyword(t.description, ['health insurance', 'medical insurance', 'mediclaim'])).reduce((s, t) => s + t.amount, 0);
    const sec80D_val = Math.min(75000, annualize(monthly80D));
    // Rent detection: description keyword match OR a user-applied rent-like
    // category tag ("Rent", "House Rent", "Housing", ...). Manual
    // recategorization therefore feeds the HRA calculation directly.
    const monthlyRent = expenseTxs.filter(t => isRentTransaction(t)).reduce((s, t) => s + t.amount, 0);
    const annualRent = annualize(monthlyRent);
    const monthlyHomeLoan = expenseTxs.filter(t => matchesKeyword(t.description, ['home loan', 'housing loan', 'home loan interest'])).reduce((s, t) => s + t.amount, 0);
    const sec24b_val = Math.min(200000, annualize(monthlyHomeLoan));
    const monthlyNps = expenseTxs.filter(t => matchesKeyword(t.description, ['nps', 'national pension', 'pension scheme'])).reduce((s, t) => s + t.amount, 0);
    const sec80CCD_val = Math.min(50000, annualize(monthlyNps));
    return { annualIncome, sec80C: sec80C_val, sec80D: sec80D_val, sec80CCD: sec80CCD_val, sec24b: sec24b_val, annualRent, annualHra };
  }, [transactions]);

  // Auto-fill syncs detected values into the inputs, but only for fields the
  // user has NOT manually edited. Manual edits are tracked per-field so that
  // recategorizing a transaction (which changes detected rent without changing
  // the transaction count) still updates the HRA inputs.
  const manualEditsRef = useRef<Set<string>>(new Set());
  const markManual = (key: string) => { manualEditsRef.current.add(key); };
  useEffect(() => {
    if (transactions.length === 0) return;
    if (!manualEditsRef.current.has('grossSalary')) setGrossSalary(autoDetected.annualIncome);
    if (!manualEditsRef.current.has('sec80C')) setSec80C(autoDetected.sec80C);
    if (!manualEditsRef.current.has('sec80D')) setSec80D(autoDetected.sec80D);
    if (!manualEditsRef.current.has('sec80CCD')) setSec80CCD(autoDetected.sec80CCD);
    if (!manualEditsRef.current.has('sec24b')) setSec24b(autoDetected.sec24b);
    // Only rent paid is auto-filled. The HRA exemption is NOT the full rent —
    // it is min(HRA received, rent - 10% basic, 50%/40% basic), so it must be
    // computed via the HRA calculator and applied consciously.
    if (!manualEditsRef.current.has('rentPaid')) setRentPaid(autoDetected.annualRent);
    // HRA received is auto-filled only when the ledger actually shows an HRA
    // credit (some employers pay it separately). A manual entry is never
    // overwritten with 0.
    if (!manualEditsRef.current.has('hraReceived') && autoDetected.annualHra > 0) setHraReceived(autoDetected.annualHra);
  }, [autoDetected.annualIncome, autoDetected.sec80C, autoDetected.sec80D, autoDetected.sec80CCD, autoDetected.sec24b, autoDetected.annualRent, autoDetected.annualHra, transactions.length]);

  const calculatedHraExemption = useMemo(() => {
    const tenPercentBasic = basicSalary * 0.1;
    const rentMinusBasic = Math.max(0, rentPaid - tenPercentBasic);
    const percentageBasic = basicSalary * (isMetro ? 0.5 : 0.4);
    return Math.min(hraReceived, rentMinusBasic, percentageBasic);
  }, [basicSalary, rentPaid, isMetro, hraReceived]);

  const applyHraExemption = () => { setClaimedHra(Math.round(calculatedHraExemption)); setIsHraModalOpen(false); analytics.track('conversion', { goal: 'hra_exemption', value: Math.round(calculatedHraExemption) }); };

  const oldRegimeCalcs = useMemo(() => {
    const stdDeduction = 50000;
    const total80CDeductions = Math.min(150000, sec80C);
    const total80DDeductions = Math.min(75000, sec80D);
    const totalNpsDeductions = Math.min(50000, sec80CCD);
    const totalHomeLoanInterest = Math.min(200000, sec24b);
    const totalDeductions = stdDeduction + total80CDeductions + total80DDeductions + totalNpsDeductions + totalHomeLoanInterest + claimedHra + otherExemptions;
    const taxableIncome = Math.max(0, grossSalary - totalDeductions);
    let tax = 0;
    const slabs = [
      { name: 'Up to ₹2.5L', rate: 0, min: 0, max: 250000, taxInSlab: 0 },
      { name: '₹2.5L - ₹5L', rate: 5, min: 250000, max: 500000, taxInSlab: 0 },
      { name: '₹5L - ₹10L', rate: 20, min: 500000, max: 1000000, taxInSlab: 0 },
      { name: 'Above ₹10L', rate: 30, min: 1000000, max: Infinity, taxInSlab: 0 },
    ];
    if (taxableIncome > 250000) {
      if (taxableIncome <= 500000) slabs[1].taxInSlab = (taxableIncome - 250000) * 0.05;
      else { slabs[1].taxInSlab = 250000 * 0.05; if (taxableIncome <= 1000000) slabs[2].taxInSlab = (taxableIncome - 500000) * 0.20; else { slabs[2].taxInSlab = 500000 * 0.20; slabs[3].taxInSlab = (taxableIncome - 1000000) * 0.30; } }
    }
    tax = slabs.reduce((sum, s) => sum + s.taxInSlab, 0);
    let rebate = 0;
    if (taxableIncome <= 500000) rebate = tax;
    const taxAfterRebate = Math.max(0, tax - rebate);
    const cess = Math.round(taxAfterRebate * 0.04);
    return { taxableIncome, totalDeductions, slabs, rawTax: tax, rebate, cess, finalTax: taxAfterRebate + cess };
  }, [grossSalary, sec80C, sec80D, sec80CCD, sec24b, claimedHra, otherExemptions]);

  const newRegimeCalcs = useMemo(() => {
    const stdDeduction = 75000;
    const taxableIncome = Math.max(0, grossSalary - stdDeduction);
    let tax = 0;
    // FY 2025-26 new regime slabs (Finance Act 2025)
    const slabs = [
      { name: 'Up to ₹4L', rate: 0, min: 0, max: 400000, taxInSlab: 0 },
      { name: '₹4L - ₹8L', rate: 5, min: 400000, max: 800000, taxInSlab: 0 },
      { name: '₹8L - ₹12L', rate: 10, min: 800000, max: 1200000, taxInSlab: 0 },
      { name: '₹12L - ₹16L', rate: 15, min: 1200000, max: 1600000, taxInSlab: 0 },
      { name: '₹16L - ₹20L', rate: 20, min: 1600000, max: 2000000, taxInSlab: 0 },
      { name: '₹20L - ₹24L', rate: 25, min: 2000000, max: 2400000, taxInSlab: 0 },
      { name: 'Above ₹24L', rate: 30, min: 2400000, max: Infinity, taxInSlab: 0 },
    ];
    if (taxableIncome > 400000) {
      if (taxableIncome <= 800000) slabs[1].taxInSlab = (taxableIncome - 400000) * 0.05;
      else { slabs[1].taxInSlab = 400000 * 0.05; if (taxableIncome <= 1200000) slabs[2].taxInSlab = (taxableIncome - 800000) * 0.10; else { slabs[2].taxInSlab = 400000 * 0.10; if (taxableIncome <= 1600000) slabs[3].taxInSlab = (taxableIncome - 1200000) * 0.15; else { slabs[3].taxInSlab = 400000 * 0.15; if (taxableIncome <= 2000000) slabs[4].taxInSlab = (taxableIncome - 1600000) * 0.20; else { slabs[4].taxInSlab = 400000 * 0.20; if (taxableIncome <= 2400000) slabs[5].taxInSlab = (taxableIncome - 2000000) * 0.25; else { slabs[5].taxInSlab = 400000 * 0.25; slabs[6].taxInSlab = (taxableIncome - 2400000) * 0.30; } } } } }
    }
    tax = slabs.reduce((sum, s) => sum + s.taxInSlab, 0);
    let rebate = 0;
    let hasMarginalRelief = false;
    // FY 2025-26: 87A rebate up to ₹12L taxable income (max ₹60,000), with
    // marginal relief for income just above ₹12L (up to ~₹12,70,588).
    if (taxableIncome <= 1200000) rebate = tax;
    else if (taxableIncome > 1200000 && taxableIncome <= 1270588) { const taxWithoutRelief = tax; const restrictedTax = taxableIncome - 1200000; rebate = taxWithoutRelief - restrictedTax; hasMarginalRelief = true; }
    const taxAfterRebate = Math.max(0, tax - rebate);
    const cess = Math.round(taxAfterRebate * 0.04);
    return { taxableIncome, slabs, rawTax: tax, rebate, cess, finalTax: taxAfterRebate + cess, hasMarginalRelief };
  }, [grossSalary]);

  const recommendation = useMemo(() => {
    const diff = Math.abs(oldRegimeCalcs.finalTax - newRegimeCalcs.finalTax);
    const oldBetter = oldRegimeCalcs.finalTax < newRegimeCalcs.finalTax;
    return { betterRegime: oldBetter ? 'Old Tax Regime' : 'New Tax Regime', savings: diff, isClose: diff < 2000 };
  }, [oldRegimeCalcs.finalTax, newRegimeCalcs.finalTax]);

  const regimeCards = [
    { title: 'New Regime (FY 2025-26)', desc: 'Default, lower slab rates', calcs: newRegimeCalcs, borderClass: 'border-l-primary', finalTaxClass: 'text-primary', stdDed: 75000, exemptText: 'None allowed', exemptAmount: 0 },
    { title: 'Old Regime', desc: 'Requires active proof of investment', calcs: oldRegimeCalcs, borderClass: 'border-l-hold', finalTaxClass: 'text-hold', stdDed: 50000, exemptText: `-${(oldRegimeCalcs.totalDeductions - 50000).toLocaleString('en-IN')}`, exemptAmount: oldRegimeCalcs.totalDeductions - 50000 }
  ];

  // ── Deduction tracker — Used / Eligible / Remaining / Est. benefit ──────
  // Marginal rate estimate for the "Estimated Benefit" column (old regime).
  const marginalRate = grossSalary > 1000000 ? 0.3 : grossSalary > 500000 ? 0.2 : grossSalary > 250000 ? 0.05 : 0;
  const deductionTrackers = [
    { key: '80C', label: '80C', used: sec80C, eligible: 150000, tip: 'PPF · EPF · ELSS · Insurance · Home loan principal' },
    { key: '80D', label: '80D', used: sec80D, eligible: 75000, tip: 'Health insurance premiums' },
    { key: 'HRA', label: 'HRA', used: claimedHra, eligible: Math.max(calculatedHraExemption, claimedHra), tip: 'House rent allowance exemption' },
    { key: 'Home Loan', label: 'Home Loan', used: sec24b, eligible: 200000, tip: 'Home loan interest (Sec 24b)' },
    { key: 'NPS', label: 'NPS', used: sec80CCD, eligible: 50000, tip: 'National Pension System (80CCD)' },
    { key: 'Other', label: 'Other', used: otherExemptions, eligible: 0, tip: 'Other eligible deductions' },
  ];

  return (
    <div className="space-y-6">
      {/* ── Deduction tracker strip ── */}
      <GlassCard theme={theme} className="p-5">
        <div className="flex items-center justify-between mb-4 pb-3 border-b border-border">
          <h3 className={`font-semibold text-sm flex items-center gap-2 text-foreground`}><ShieldCheck className="w-4 h-4 text-primary" />Deduction Tracker</h3>
          <span className="text-[10px] text-muted-foreground">Used vs eligible · estimated benefit at {Math.round(marginalRate * 100)}% marginal rate</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {deductionTrackers.map(t => {
            const remaining = Math.max(0, t.eligible - t.used);
            const pct = t.eligible > 0 ? Math.min(100, Math.round((t.used / t.eligible) * 100)) : 0;
            const benefit = Math.round(remaining * marginalRate);
            return (
              <div key={t.key} className={`rounded-lg border p-3 ${isDark ? 'border-border bg-muted/30' : 'border-border bg-muted/30'}`} title={t.tip}>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-semibold text-foreground">{t.label}</span>
                  <span className={`text-[10px] font-semibold tabular-nums ${pct >= 100 ? 'text-strong-sell' : pct >= 80 ? 'text-hold' : 'text-primary'}`}>{pct}%</span>
                </div>
                <div className="h-1.5 w-full rounded-full overflow-hidden bg-muted mb-2">
                  <div className={`h-full rounded-full transition-all duration-500 ${pct >= 100 ? 'bg-strong-sell' : pct >= 80 ? 'bg-hold' : 'bg-primary'}`} style={{ width: `${pct}%` }} />
                </div>
                <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                  <span>Used <span className="font-semibold text-foreground">₹{t.used.toLocaleString('en-IN')}</span></span>
                  <span>Eligible <span className="font-semibold text-foreground">{t.eligible > 0 ? `₹${t.eligible.toLocaleString('en-IN')}` : '—'}</span></span>
                </div>
                <div className="flex items-center justify-between text-[10px] mt-1">
                  <span>Remaining <span className={`font-semibold ${t.eligible > 0 && remaining === 0 ? 'text-strong-sell' : 'text-foreground'}`}>{t.eligible > 0 ? `₹${remaining.toLocaleString('en-IN')}` : '—'}</span></span>
                  <span>Est. benefit <span className="font-semibold text-primary">₹{benefit.toLocaleString('en-IN')}</span></span>
                </div>
              </div>
            );
          })}
        </div>
      </GlassCard>

    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      <div className="lg:col-span-5 space-y-6">
        <GlassCard theme={theme} className="p-5">
          <div className="flex items-center justify-between mb-4 pb-3 border-b border-border">
            <h3 className={`font-semibold text-sm flex items-center gap-2 text-foreground`}><Calculator className="w-4 h-4 text-primary" />Tax Calculator Inputs</h3>
            {autoDetected.annualIncome > 0 && <span className="text-[10px] font-medium text-primary flex items-center gap-1 border border-primary/30 bg-primary/10 px-2.5 py-1 rounded-lg"><RefreshCw className="w-3 h-3" />Auto-filled from Ledger</span>}
          </div>
          <div className="space-y-4">
            <div>
              <div className="flex justify-between items-center mb-1">
                <label className={`text-xs font-semibold text-foreground`}>Gross Annual Income (₹)</label>
                <span className={`text-[10px] font-semibold text-muted-foreground`}>₹{(grossSalary / 100000).toFixed(2)} Lakhs</span>
              </div>
              <div className="relative">
                <span className="absolute left-3 top-2.5 text-xs text-muted-foreground font-medium">₹</span>
                <input type="number" value={grossSalary === 0 ? '' : grossSalary} onChange={(e) => { markManual('grossSalary'); setGrossSalary(Number(e.target.value)); }} placeholder="e.g. 1200000"
                  className={`w-full pl-7 pr-3 py-2 text-xs rounded-lg focus:outline-none focus:ring-1 focus:ring-ring bg-background border border-input text-foreground placeholder-muted-foreground`} />
              </div>
              <input type="range" min="300000" max="5000000" step="50000" value={grossSalary} onChange={(e) => { markManual('grossSalary'); setGrossSalary(Number(e.target.value)); }} className="w-full accent-primary mt-2 cursor-pointer h-1 bg-muted rounded-lg appearance-none" />
            </div>
            <div className={`p-4 rounded-xl border bg-muted/40 border-border`}>
              <div className="flex items-center gap-1.5 mb-3"><ShieldCheck className="w-4 h-4 text-primary" /><span className={`text-xs font-bold text-foreground`}>Exemptions & Deductions (Old Regime)</span></div>
              <div className="space-y-4">
                {[
                  { key: 'sec80C', label: 'Section 80C', tip: 'Investments in PPF, EPF, ELSS, Insurance premiums, home loan principal, etc. Capped at ₹1.5L.', value: sec80C, max: 150000, step: 5000, limit: '1.5L', onChange: setSec80C },
                  { key: 'sec80D', label: 'Section 80D (Health Insurance)', tip: 'Health insurance premiums. Up to ₹25,000 for self/family and ₹50,000 for senior citizen parents.', value: sec80D, max: 75000, step: 5000, limit: '75k', onChange: setSec80D },
                  { key: 'sec24b', label: 'Home Loan Interest (Sec 24b)', tip: 'Interest paid on home loan for self-occupied house. Max deduction is ₹2,00,000.', value: sec24b, max: 200000, step: 10000, limit: '2L', onChange: setSec24b },
                  { key: 'sec80CCD', label: 'National Pension System (80CCD)', tip: 'Deduction for voluntary contributions to National Pension System (NPS). Capped at ₹50,000.', value: sec80CCD, max: 50000, step: 5000, limit: '50k', onChange: setSec80CCD },
                ].map(item => (
                  <div key={item.label}>
                    <div className="flex justify-between text-[11px] mb-1">
                      <span className={`flex items-center gap-1 text-muted-foreground`}>{item.label}
                        <span className="group relative"><Info className="w-3 h-3 text-muted-foreground cursor-help" /><span className="absolute bottom-full left-1/2 -translate-x-1/2 hidden group-hover:block bg-popover text-foreground text-[9px] p-2 rounded-lg w-48 shadow-xl border border-border z-20">{item.tip}</span></span>
                      </span>
                      <span className="text-foreground">₹{item.value.toLocaleString('en-IN')} / {item.limit}</span>
                    </div>
                    <input type="range" min="0" max={item.max} step={item.step} value={item.value} onChange={(e) => { markManual(item.key); item.onChange(Number(e.target.value)); }} className="w-full accent-primary cursor-pointer h-1 bg-muted rounded-lg appearance-none" />
                  </div>
                ))}
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <div className="flex items-center gap-1"><span className={`text-[11px] text-muted-foreground`}>House Rent Allowance (HRA)</span><button onClick={() => setIsHraModalOpen(true)} className="text-[10px] text-primary hover:underline flex items-center gap-0.5">(Calculate)</button></div>
                    <span className={`text-[11px] font-semibold text-foreground`}>₹{claimedHra.toLocaleString('en-IN')}</span>
                  </div>
                  <div className="relative">
                    <span className="absolute left-2 top-1.5 text-[10px] text-muted-foreground font-medium">₹</span>
                    <input type="number" value={claimedHra === 0 ? '' : claimedHra} onChange={(e) => setClaimedHra(Number(e.target.value))} placeholder="Enter direct exemption amount"
                      className={`w-full pl-5 pr-2 py-1.5 text-[11px] rounded-lg focus:outline-none focus:ring-1 focus:ring-ring bg-background border border-input text-foreground placeholder-muted-foreground`} />
                  </div>
                  {autoDetected.annualRent > 0 && claimedHra === 0 && (
                    <div className="mt-2 flex items-start gap-1.5 rounded-lg border border-hold/30 bg-hold/10 p-2.5">
                      <Info className="w-3.5 h-3.5 text-hold shrink-0 mt-0.5" />
                      <p className="text-[10px] leading-relaxed text-muted-foreground">
                        We detected <strong className="text-foreground">₹{autoDetected.annualRent.toLocaleString('en-IN')}</strong> in rent payments.
                        Claim your HRA exemption via{' '}
                        <button onClick={() => setIsHraModalOpen(true)} className="text-primary hover:underline font-semibold cursor-pointer">Calculate</button>
                        {' '}to reduce old-regime tax.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className={`p-4 rounded-xl border flex gap-3 items-start bg-primary/5 border-primary/15`}>
              <Info className="w-4 h-4 text-primary shrink-0 mt-0.5" />
              <p className={`text-[11px] leading-relaxed text-muted-foreground`}><strong className="text-foreground">Quick Note:</strong> Standard Deductions are automatically calculated (₹50,000 for Old, ₹75,000 for New).</p>
            </div>
          </div>
        </GlassCard>
      </div>

      <div className="lg:col-span-7 space-y-6">
        <div className={`relative overflow-hidden p-6 rounded-xl border transition-all duration-300 bg-primary/10 border-primary/20`}>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 relative z-10">
            <div>
              <span className="text-[10px] uppercase font-bold tracking-widest text-primary bg-primary/10 border border-primary/30 px-2 py-0.5 rounded-full">AI Recommendation</span>
              <h2 className={`text-2xl font-light mt-2 text-foreground`}>Choose the <span className="font-bold text-primary">{recommendation.betterRegime}</span></h2>
              <p className={`text-xs mt-1 text-muted-foreground`}>{recommendation.savings > 0 ? `Based on your declared investments, choosing this regime saves you ₹${recommendation.savings.toLocaleString('en-IN')} in tax annually.` : 'Both regimes yield the exact same tax for your profile.'}</p>
            </div>
            <div className="text-left sm:text-right shrink-0">
              <span className={`text-xs block text-muted-foreground`}>Annual Tax Saved</span>
              <span className="text-3xl font-extrabold text-primary">₹{recommendation.savings.toLocaleString('en-IN')}</span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {regimeCards.map(regime => (
            <GlassCard key={regime.title} theme={theme} className={`p-5 border-l-4 ${regime.borderClass}`}>
              <div className="flex justify-between items-start mb-3">
                <div><h4 className={`font-semibold text-sm text-foreground`}>{regime.title}</h4><p className={`text-[10px] mt-0.5 text-muted-foreground`}>{regime.desc}</p></div>
                {recommendation.betterRegime === (regime.title.includes('New') ? 'New Tax Regime' : 'Old Tax Regime') && <span className="bg-primary/15 text-primary border border-primary/30 text-[9px] px-2 py-0.5 rounded-full font-bold">Recommended</span>}
              </div>
              <div className="space-y-2 mt-4 pt-3 border-t border-border">
                <div className="flex justify-between text-xs"><span className="text-muted-foreground">Gross Salary</span><span className={`font-medium text-foreground`}>₹{grossSalary.toLocaleString('en-IN')}</span></div>
                <div className="flex justify-between text-xs"><span className="text-muted-foreground">Standard Deduction</span><span className="text-strong-sell font-medium">-₹{regime.stdDed.toLocaleString('en-IN')}</span></div>
                <div className="flex justify-between text-xs pb-2 border-b border-border"><span className="text-muted-foreground">Exemptions claimed</span><span className="text-muted-foreground">{regime.exemptText}</span></div>
                <div className="flex justify-between text-xs"><span className="text-muted-foreground">Taxable Income</span><span className={`font-bold text-foreground`}>₹{regime.calcs.taxableIncome.toLocaleString('en-IN')}</span></div>
                <div className="flex justify-between text-xs"><span className="text-muted-foreground">Raw Slab Tax</span><span className="text-foreground">₹{regime.calcs.rawTax.toLocaleString('en-IN')}</span></div>
                <div className="flex justify-between text-xs text-primary pb-2 border-b border-border"><span>Section 87A Rebate</span><span>-₹{regime.calcs.rebate.toLocaleString('en-IN')}</span></div>
                <div className="flex justify-between text-xs pb-2 border-b border-border"><span className="text-muted-foreground">Cess (4%)</span><span className="text-foreground">₹{regime.calcs.cess.toLocaleString('en-IN')}</span></div>
                <div className="flex justify-between items-baseline pt-2"><span className={`text-xs font-semibold text-muted-foreground`}>Final Tax Payable</span><span className={`text-lg font-bold ${regime.finalTaxClass}`}>₹{regime.calcs.finalTax.toLocaleString('en-IN')}</span></div>
              </div>
            </GlassCard>
          ))}
        </div>

        <GlassCard theme={theme} className="p-5">
          <h4 className={`font-semibold text-sm mb-4 flex items-center gap-1.5 text-foreground`}><Percent className="w-4 h-4 text-primary" />Tax Bracket Slabs & Breakdown (New Regime)</h4>
          <div className="space-y-3">
            {newRegimeCalcs.slabs.map((slab, idx) => {
              const slabSize = slab.max - slab.min;
              const coveredInSlab = Math.max(0, Math.min(slab.max, newRegimeCalcs.taxableIncome) - slab.min);
              const percentageFilled = slabSize === Infinity ? (newRegimeCalcs.taxableIncome > slab.min ? 100 : 0) : (coveredInSlab / slabSize) * 100;
              return (
                <div key={idx} className="space-y-1">
                  <div className="flex justify-between text-[11px]">
                    <span className={`font-medium text-foreground`}>{slab.name} <span className="text-muted-foreground">({slab.rate}%)</span></span>
                    <span className={`font-semibold text-muted-foreground`}>₹{slab.taxInSlab.toLocaleString('en-IN')} tax</span>
                  </div>
                  <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                    <div className={`h-full transition-all duration-500 rounded-full ${slab.rate === 0 ? 'bg-primary' : slab.rate < 15 ? 'bg-hold' : 'bg-strong-sell'}`} style={{ width: `${percentageFilled}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </GlassCard>
      </div>

      {isHraModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className={`w-full max-w-md rounded-xl p-6 border shadow-2xl transition-all bg-popover border-border text-foreground`}>
            <div className="flex items-center justify-between pb-4 border-b border-border mb-4">
              <h3 className="font-semibold text-sm flex items-center gap-1.5"><Calculator className="w-4 h-4 text-primary" />HRA Exemption Calculator</h3>
              <button onClick={() => setIsHraModalOpen(false)} className="text-muted-foreground hover:text-foreground transition-colors text-xs font-semibold px-2 py-1 rounded-lg">Close</button>
            </div>
            <div className="space-y-4">
              <div><label className="block text-[11px] font-semibold mb-1">Basic Salary (Annualized)</label><input type="number" value={basicSalary} onChange={(e) => setBasicSalary(Number(e.target.value))} className={`w-full p-2 text-xs rounded-lg focus:outline-none focus:ring-1 focus:ring-ring bg-background border border-input text-foreground`} /></div>
              <div><label className="block text-[11px] font-semibold mb-1">Actual HRA Received (Annualized)</label><input type="number" value={hraReceived} onChange={(e) => { markManual('hraReceived'); setHraReceived(Number(e.target.value)); }} className={`w-full p-2 text-xs rounded-lg focus:outline-none focus:ring-1 focus:ring-ring bg-background border border-input text-foreground`} /></div>
              <div><label className="block text-[11px] font-semibold mb-1">Total Rent Paid (Annualized)</label><input type="number" value={rentPaid} onChange={(e) => { markManual('rentPaid'); setRentPaid(Number(e.target.value)); }} className={`w-full p-2 text-xs rounded-lg focus:outline-none focus:ring-1 focus:ring-ring bg-background border border-input text-foreground`} /></div>
              <div>
                <label className="block text-[11px] font-semibold mb-1.5">City Status</label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-1.5 text-xs font-normal cursor-pointer"><input type="radio" checked={isMetro} onChange={() => setIsMetro(true)} className="accent-primary cursor-pointer" />Metro</label>
                  <label className="flex items-center gap-1.5 text-xs font-normal cursor-pointer"><input type="radio" checked={!isMetro} onChange={() => setIsMetro(false)} className="accent-primary cursor-pointer" />Non-Metro</label>
                </div>
              </div>
              <div className={`rounded-xl border p-3 bg-muted/40 border-border`}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] font-semibold text-foreground flex items-center gap-1"><Wallet className="w-3.5 h-3.5 text-primary" />Salary Slip Breakdown</span>
                  <span className="text-[9px] text-muted-foreground">Optional · auto-annualized</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] font-semibold mb-1 text-muted-foreground">Monthly Basic (₹)</label>
                    <input type="number" value={slipMonthlyBasic === 0 ? '' : slipMonthlyBasic} onChange={(e) => setSlipMonthlyBasic(Number(e.target.value))} placeholder="e.g. 41667" className={`w-full p-2 text-xs rounded-lg focus:outline-none focus:ring-1 focus:ring-ring bg-background border border-input text-foreground`} />
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold mb-1 text-muted-foreground">Monthly HRA (₹)</label>
                    <input type="number" value={slipMonthlyHra === 0 ? '' : slipMonthlyHra} onChange={(e) => setSlipMonthlyHra(Number(e.target.value))} placeholder="e.g. 20000" className={`w-full p-2 text-xs rounded-lg focus:outline-none focus:ring-1 focus:ring-ring bg-background border border-input text-foreground`} />
                  </div>
                </div>
                <button
                  onClick={() => { if (slipMonthlyBasic > 0) { markManual('basicSalary'); setBasicSalary(slipMonthlyBasic * 12); } if (slipMonthlyHra > 0) { markManual('hraReceived'); setHraReceived(slipMonthlyHra * 12); } }}
                  disabled={slipMonthlyBasic <= 0 && slipMonthlyHra <= 0}
                  className="mt-2 w-full px-3 py-1.5 bg-primary/10 hover:bg-primary/20 text-primary border border-primary/30 rounded-lg text-[11px] font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Apply breakdown → Basic ₹{slipMonthlyBasic > 0 ? (slipMonthlyBasic * 12).toLocaleString('en-IN') : '—'} · HRA ₹{slipMonthlyHra > 0 ? (slipMonthlyHra * 12).toLocaleString('en-IN') : '—'} (annual)
                </button>
                <p className="text-[9px] text-muted-foreground mt-1.5 leading-relaxed">Enter the figures from your salary slip — we annualize them (×12) and fill the Basic Salary and HRA Received fields above.</p>
              </div>
              <div className={`p-4 rounded-xl border mt-2 bg-muted/40 border-border`}>
                <div className="flex justify-between items-center"><span className="text-xs font-semibold text-muted-foreground">Calculated Exemption:</span><span className="text-sm font-bold text-primary">₹{Math.round(calculatedHraExemption).toLocaleString('en-IN')}</span></div>
                <p className="text-[10px] text-muted-foreground mt-1 leading-normal">Minimum of: actual HRA received (₹{hraReceived.toLocaleString('en-IN')}), Rent paid minus 10% basic (₹{(rentPaid - basicSalary * 0.1).toLocaleString('en-IN')}), or {isMetro ? '50%' : '40%'} basic (₹{(basicSalary * (isMetro ? 0.5 : 0.4)).toLocaleString('en-IN')}).</p>
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t border-border">
                <button onClick={() => setIsHraModalOpen(false)} className={`px-3 py-1.5 rounded-lg text-xs hover:bg-muted transition-all`}>Cancel</button>
                <button onClick={applyHraExemption} className="px-4 py-1.5 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg text-xs font-semibold transition-all">Apply Exemption</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
    </div>
  );
}