'use client';
import React from 'react';
import { Sparkles, PiggyBank, AlertTriangle, TrendingUp, Info, ArrowUpRight, Lightbulb, ListChecks, ScanSearch } from 'lucide-react';
import { SpendingInsight } from '@/lib/ledger/types';
import GlassCard from './GlassCard';

interface InsightsPanelProps {
  insights: SpendingInsight[];
  apiKeyWarning?: boolean;
  periodLabel?: string;
  theme?: 'light' | 'dark';
}

export default function InsightsPanel({ insights, apiKeyWarning, periodLabel = '', theme = 'dark' }: InsightsPanelProps) {
  const isDark = theme === 'dark';

  const getIcon = (type: string) => {
    switch (type) {
      case 'saving':
        return <PiggyBank className="w-4 h-4 text-primary" />;
      case 'warning':
        return <AlertTriangle className="w-4 h-4 text-strong-sell" />;
      case 'trend':
        return <TrendingUp className="w-4 h-4 text-hold" />;
      default:
        return <Info className="w-4 h-4 text-muted-foreground" />;
    }
  };

  const getBadgeStyle = (type: string) => {
    switch (type) {
      case 'saving':
        return 'bg-primary/10 border-primary/30 text-primary';
      case 'warning':
        return 'bg-strong-sell/10 border-strong-sell/30 text-strong-sell';
      case 'trend':
        return 'bg-hold/10 border-hold/30 text-hold';
      default:
        return 'bg-muted border-border text-muted-foreground';
    }
  };

  const scrollToTransactions = () => {
    document.getElementById('transactions-workspace')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <GlassCard theme={theme} className="p-5 h-full flex flex-col">
      <div>
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-sm font-semibold tracking-tight flex items-center gap-2 text-foreground">
            <Sparkles className="text-primary w-4 h-4" />
            Smart Insights
          </h2>
          {apiKeyWarning && (
            <span className="text-[10px] bg-hold/10 border border-hold/30 text-hold px-2 py-0.5 rounded-full font-medium">
              Sample Data
            </span>
          )}
        </div>
        <p className="text-[0.7rem] text-muted-foreground mb-4">
          {periodLabel ? `What happened in ${periodLabel}, why it matters, and what to consider doing.` : 'What happened, why it matters, and what to consider doing.'}
        </p>

        {insights.length === 0 ? (
          <div className="text-muted-foreground text-xs text-center py-12">
            <p className="text-sm font-semibold text-foreground mb-1">Insights will appear here</p>
            <p>Upload transaction data to generate personalized financial insights.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {insights.map((insight) => (
              <div
                id={`insight-item-${insight.id}`}
                key={insight.id}
                className={`group relative p-3.5 rounded-xl transition-all duration-150 border border-border bg-card hover:bg-muted/50 hover:border-primary/30`}
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`shrink-0 p-1.5 rounded-lg flex items-center justify-center bg-muted`}>
                      {getIcon(insight.type)}
                    </span>
                    <h3 className="text-xs font-semibold tracking-wide text-foreground truncate">
                      {insight.title}
                    </h3>
                  </div>
                  {insight.impactValue && (
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold shrink-0 flex items-center gap-0.5 border ${getBadgeStyle(insight.type)}`}>
                      {insight.impactValue}
                      <ArrowUpRight className="w-2.5 h-2.5" />
                    </span>
                  )}
                </div>

                {/* Why it matters */}
                <p className="text-[11px] leading-relaxed font-normal text-muted-foreground">
                  {insight.description}
                </p>

                {/* Recommended action */}
                {insight.recommendation && (
                  <div className={`mt-2 flex items-start gap-1.5 rounded-lg border p-2.5 ${insight.type === 'warning' ? 'bg-strong-sell/5 border-strong-sell/20' : 'bg-primary/5 border-primary/15'}`}>
                    <Lightbulb className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${insight.type === 'warning' ? 'text-strong-sell' : 'text-primary'}`} />
                    <p className={`text-[11px] leading-relaxed font-medium ${insight.type === 'warning' ? 'text-strong-sell' : 'text-primary'}`}>
                      {insight.recommendation}
                    </p>
                  </div>
                )}

                {/* Action */}
                {insight.action === 'review' && (
                  <button onClick={scrollToTransactions}
                    className="mt-2.5 inline-flex items-center gap-1.5 text-[10px] font-semibold px-2.5 py-1.5 rounded-lg border transition-all cursor-pointer bg-muted border-border text-muted-foreground hover:text-foreground hover:border-primary/40">
                    <ListChecks className="w-3 h-3" />Review Transactions
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className={`mt-4 pt-3 border-t text-[11px] italic text-center text-muted-foreground flex items-center justify-center gap-1 ${isDark ? 'border-border' : 'border-border'}`}>
        <ScanSearch className="w-3 h-3 text-primary" />
        AI-assisted insights · derived from your ledger data
      </div>
    </GlassCard>
  );
}