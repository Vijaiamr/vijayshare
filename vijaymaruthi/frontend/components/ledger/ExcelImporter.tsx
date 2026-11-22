'use client';
import React, { useState, useRef } from 'react';
import { Upload, FileSpreadsheet, RefreshCw, AlertTriangle, Sparkles, X } from 'lucide-react';
import { Transaction } from '@/lib/ledger/types';
import GlassCard from './GlassCard';

interface ExcelImporterProps {
  onDataImported: (transactions: Transaction[], insights: any[], budgets: any[]) => void;
  onRefresh: () => void;
  onClearData?: () => void;
  isSampleActive: boolean;
  transactionCount?: number;
  period?: string;
  theme?: 'light' | 'dark';
}

export default function ExcelImporter({ onDataImported, onRefresh, onClearData, isSampleActive, transactionCount = 0, period = '', theme = 'dark' }: ExcelImporterProps) {
  const isDark = theme === 'dark';
  const [isDragging, setIsDragging] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [step, setStep] = useState<'upload' | 'analyzing'>('upload');
  const [loadingMessage, setLoadingMessage] = useState('Uploading spreadsheet to Python backend...');
  const [error, setError] = useState<string | null>(null);
  const [lastImport, setLastImport] = useState<{
    added: number;
    skippedExact: number;
    skippedNormalized: number;
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    if (!file) return;
    setError(null);
    setLastImport(null);
    setFileName(file.name);
    setStep('analyzing');

    const loadingTips = [
      'Uploading statement...',
      'Parsing spreadsheet...',
      'Auto-detecting column mappings...',
      'Categorizing transactions...',
      'Checking for duplicates...',
      'Preparing dashboard visualization...'
    ];

    let currentTipIdx = 0;
    setLoadingMessage(loadingTips[0]);

    const interval = setInterval(() => {
      currentTipIdx = (currentTipIdx + 1) % loadingTips.length;
      setLoadingMessage(loadingTips[currentTipIdx]);
    }, 2500);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch('/api/ledger/upload', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        let msg = `Server returned ${response.status}`;
        try {
          const errBody = await response.json();
          if (errBody.error) msg = errBody.error;
        } catch (_) {}
        throw new Error(msg);
      }

      const data = await response.json();
      clearInterval(interval);
      onDataImported(data.transactions, data.insights, data.budgets);
      setLastImport({
        added: data.importedCount ?? 0,
        skippedExact: data.skippedExact ?? 0,
        skippedNormalized: data.skippedNormalized ?? 0,
      });
      setStep('upload');
    } catch (err: any) {
      console.error(err);
      clearInterval(interval);
      setError(`Failed to process file: ${err.message || 'Check your connection and try again.'}`);
      setStep('upload');
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      handleFile(files[0]);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleFile(files[0]);
    }
  };

  return (
    <GlassCard id="excel-importer-panel" theme={theme} className="p-5 h-full flex flex-col justify-between">
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold tracking-tight flex items-center gap-2 text-foreground">
            <FileSpreadsheet className="text-primary w-4 h-4" />
            Upload Statement
          </h2>
          <div className="flex items-center gap-1.5">
            {onClearData && (
              <button
                id="btn-clear-data"
                onClick={onClearData}
                className="text-[11px] px-2.5 py-1 rounded-md transition-all flex items-center gap-1 cursor-pointer text-strong-sell bg-strong-sell/10 hover:bg-strong-sell/20 border border-strong-sell/30"
                title="Clear all transactions"
              >
                <X className="w-3 h-3" />
                Clear
              </button>
            )}
            {!isSampleActive && (
              <button
                id="btn-refresh-data"
                onClick={() => onRefresh()}
                className="text-[11px] px-2.5 py-1 rounded-md transition-all flex items-center gap-1 cursor-pointer text-muted-foreground bg-muted hover:bg-muted/80 border border-border"
                title="Refresh data from the server"
              >
                <RefreshCw className="w-3 h-3" />
                Refresh
              </button>
            )}
          </div>
        </div>

        {error && (
          <div className="mb-4 bg-strong-sell/10 border border-strong-sell/30 text-strong-sell text-xs rounded-lg p-3 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold">Statement could not be processed.</span>
              <p className="mt-0.5 text-[11px] leading-relaxed">{error}</p>
              <p className="mt-1 text-[10px] text-muted-foreground">Check that the file contains Date, Description, and Amount columns.</p>
              <button onClick={() => setError(null)} className="mt-2 text-[10px] font-semibold px-2.5 py-1 rounded-lg border border-strong-sell/40 bg-strong-sell/10 hover:bg-strong-sell/20 transition-all cursor-pointer">
                Try Again
              </button>
            </div>
          </div>
        )}

        {step === 'upload' && (
          <div
            id="drag-drop-zone"
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`
              border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all duration-300 flex flex-col items-center justify-center min-h-[200px]
              ${isDragging 
                ? 'border-primary bg-primary/10 scale-[0.98]' 
                : 'border-border bg-muted/40 hover:bg-muted/70 hover:border-primary/50'}
            `}
          >
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              accept=".xlsx,.xls,.xlsm,.xlsb,.csv,.txt,.pdf"
              className="hidden"
            />
            <div className="p-3.5 rounded-full mb-3 bg-primary/10 text-primary">
              <Upload className="w-7 h-7" />
            </div>
            <p className="text-sm font-medium mb-1 text-foreground">
              Drag & drop Excel, CSV, TXT, or PDF statements
            </p>
            <p className="text-xs max-w-xs mx-auto mb-3 text-muted-foreground">
              Statements are parsed, categorized, and deduplicated automatically.
            </p>
            <span className="font-semibold px-2.5 py-1 rounded-full border text-xs text-primary bg-primary/10 border-primary/30">
              Browse Files
            </span>
          </div>
        )}

        {step === 'analyzing' && (
          <div id="analyzing-panel" className="py-12 flex flex-col items-center justify-center min-h-[200px]">
            <div className="relative flex items-center justify-center mb-6">
              <div className="animate-spin rounded-full h-14 w-14 border-2 border-primary/30 border-t-primary" />
              <FileSpreadsheet className="absolute text-primary w-5 h-5 animate-pulse" />
            </div>
            <p className="text-sm font-semibold tracking-wide animate-pulse text-foreground">
              Processing statement
            </p>
            <p className="text-xs text-center mt-2 max-w-xs px-4 min-h-[32px] italic transition-all duration-300 text-muted-foreground">
              {loadingMessage}
            </p>
          </div>
        )}
      </div>

      <div className={`mt-5 pt-4 border-t flex flex-col gap-1.5 text-[11px] ${isDark ? 'border-border text-muted-foreground' : 'border-border text-muted-foreground'}`}>
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${isSampleActive ? 'bg-hold' : transactionCount > 0 ? 'bg-primary' : 'bg-muted-foreground'}`} />
            {transactionCount > 0
              ? <span className="font-semibold text-foreground">{isSampleActive ? 'Sample Data Loaded' : 'Data Loaded'}</span>
              : 'No Data — Upload a file'}
          </span>
          <span className="flex items-center gap-1">
            <Sparkles className="w-3 h-3 text-primary" />
            Auto-categorized · Supabase
          </span>
        </div>
        {transactionCount > 0 && (
          <p className="text-[10px] text-muted-foreground">
            {transactionCount} transaction{transactionCount === 1 ? '' : 's'}
            {period && period !== '—' ? ` · ${period}` : ''} · Last updated just now
          </p>
        )}
        {lastImport && (
          <p
            id="import-feedback"
            className={`text-[10px] font-medium ${lastImport.added === 0 ? 'text-hold' : 'text-primary'}`}
          >
            {lastImport.added > 0
              ? `Imported ${lastImport.added} new`
              : 'No new transactions'}
            {lastImport.skippedExact + lastImport.skippedNormalized > 0
              ? ` · skipped ${lastImport.skippedExact + lastImport.skippedNormalized} duplicate${lastImport.skippedExact + lastImport.skippedNormalized === 1 ? '' : 's'}`
              : ''}
            {lastImport.skippedNormalized > 0
              ? ` · merged ${lastImport.skippedNormalized} near-duplicate${lastImport.skippedNormalized === 1 ? '' : 's'}`
              : ''}
            {lastImport.added === 0 && lastImport.skippedExact + lastImport.skippedNormalized > 0
              ? ' — this statement was already imported.'
              : ''}
          </p>
        )}
      </div>
    </GlassCard>
  );
}