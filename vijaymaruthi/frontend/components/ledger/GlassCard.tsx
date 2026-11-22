'use client';
import React from 'react';

interface GlassCardProps {
  children: React.ReactNode;
  className?: string;
  hoverEffect?: boolean;
  id?: string;
  theme?: 'light' | 'dark';
}

/**
 * Card primitive for the ledger — uses the app's "Institutional Terminal"
 * tokens (bg-card / border-border / text-foreground) so the ledger matches
 * the rest of VijayMaruthi. Solid surface, app radius scale.
 */
export default function GlassCard({ children, className = '', hoverEffect = false, id, theme = 'dark' }: GlassCardProps) {
  const isDark = theme === 'dark';
  return (
    <div
      id={id}
      className={`
        relative overflow-hidden rounded-xl border bg-card text-foreground transition-colors duration-150
        ${isDark ? 'border-border' : 'border-border'}
        ${hoverEffect
          ? isDark
            ? 'hover:bg-muted/70 hover:border-primary/30'
            : 'hover:bg-muted/70 hover:border-primary/30'
          : ''
        }
        ${className}
      `}
    >
      <div className="relative h-full w-full">
        {children}
      </div>
    </div>
  );
}