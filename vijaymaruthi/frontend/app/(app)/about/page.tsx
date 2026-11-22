"use client";

import { useRouter } from "next/navigation";
import { Home, Info } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

export default function AboutPage() {
  const router = useRouter();

  return (
    <div className="w-full max-w-[800px]">
      <nav className="mb-1 flex items-center gap-1 text-xs text-muted-foreground">
        <span
          onClick={() => router.push("/")}
          className="flex cursor-pointer items-center gap-1 hover:text-foreground"
        >
          <Home size={14} />
          <span>Home</span>
        </span>
        <span className="text-foreground font-semibold">About</span>
      </nav>

      <h1 className="mb-3 text-[1.6rem] font-bold tracking-tight">
        About VijayMaruthi Wealth Management
      </h1>

      <Card className="mb-2">
        <CardContent className="p-5">
          <h3 className="mb-1 text-sm font-semibold">Platform Overview</h3>
          <Separator className="mb-1.5" />
          <p className="mb-1.5 text-[0.85rem] leading-relaxed text-muted-foreground">
            The VijayMaruthi Wealth Management platform provides institutional-grade
            quantitative and fundamental analysis for the Indian stock market (NSE).
            It combines technical analysis, fundamental screening, sentiment signals,
            and market-cap-weighted scoring into a single blended rating system.
          </p>
          <p className="text-[0.85rem] leading-relaxed text-muted-foreground">
            Every NSE-listed equity is scored on a 0–100 scale, with ratings ranging
            from Strong Buy to Strong Sell. The system tracks score changes over time
            to identify improving or deteriorating trends. All results are cached with
            configurable TTL to avoid redundant analysis.
          </p>
        </CardContent>
      </Card>

      <Card className="mb-2">
        <CardContent className="p-5">
          <h3 className="mb-1 text-sm font-semibold">Scoring Methodology</h3>
          <Separator className="mb-1.5" />
          <div className="flex flex-col gap-3">
            <div>
              <div className="mb-0.5 flex items-center gap-2">
                <Badge className="min-w-[48px] text-[0.65rem] font-bold">40%</Badge>
                <span className="text-[0.85rem] font-semibold">Technical Analysis</span>
              </div>
              <p className="text-[0.75rem] text-muted-foreground">
                RSI, MACD, ADX, Bollinger Bands, ATR, Volume analysis, Candlestick patterns,
                Support &amp; Resistance, Market Structure, Wyckoff, Gann, Elliott Wave
              </p>
            </div>
            <div>
              <div className="mb-0.5 flex items-center gap-2">
                <Badge className="min-w-[48px] text-[0.65rem] font-bold">40%</Badge>
                <span className="text-[0.85rem] font-semibold">Fundamental Analysis</span>
              </div>
              <p className="text-[0.75rem] text-muted-foreground">
                PE / PB / ROE / ROCE ratios, Debt-to-Equity, Profit Margins, Revenue Growth,
                Market Cap analysis, Dividend Yield, Quick Ratings, Risk &amp; Moat assessment
              </p>
            </div>
            <div>
              <div className="mb-0.5 flex items-center gap-2">
                <Badge className="min-w-[48px] text-[0.65rem] font-bold">10%</Badge>
                <span className="text-[0.85rem] font-semibold">Sentiment Analysis</span>
              </div>
              <p className="text-[0.75rem] text-muted-foreground">
                News headline sentiment, article volume, and media tone scoring
              </p>
            </div>
            <div>
              <div className="mb-0.5 flex items-center gap-2">
                <Badge className="min-w-[48px] text-[0.65rem] font-bold">10%</Badge>
                <span className="text-[0.85rem] font-semibold">Market Cap Adjustment</span>
              </div>
              <p className="text-[0.75rem] text-muted-foreground">
                Size-based weighting adjustments for large, mid, and small cap stocks
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="mb-2">
        <CardContent className="p-5">
          <h3 className="mb-1 text-sm font-semibold">Technology Stack</h3>
          <Separator className="mb-1.5" />
          <div className="flex flex-wrap gap-1">
            {["Python", "FastAPI", "Pandas", "NumPy", "yfinance", "TA-Lib", "Next.js", "React", "MUI v9", "TypeScript", "SQLite", "Plotly"].map((tech) => (
              <Badge key={tech} variant="outline" className="text-[0.7rem] font-medium">
                {tech}
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>

      <p className="block text-center pt-2 text-[0.7rem] text-muted-foreground/50">
        Version 4.0.0 &middot; VijayMaruthi Wealth Management &middot; {new Date().getFullYear()}
      </p>
    </div>
  );
}
