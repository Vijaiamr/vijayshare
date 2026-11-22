"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Home, TrendingUp, TrendingDown, Minus, Database, BarChart3, RotateCcw } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

import { api } from "@/lib/api";
import type { DashboardResponse } from "@/lib/types";

function StatCard({
  title,
  value,
  subtitle,
  color,
  icon,
}: {
  title: string;
  value: string | number;
  subtitle?: string;
  color: string;
  icon: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-[0.7rem] font-semibold uppercase tracking-wider text-muted-foreground">
              {title}
            </p>
            <p className={`text-[2rem] font-bold leading-tight mt-1 ${color}`}>
              {value}
            </p>
            {subtitle && (
              <p className="mt-0.5 block text-[0.7rem] text-muted-foreground">
                {subtitle}
              </p>
            )}
          </div>
          <div className={`${color} opacity-30`}>{icon}</div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function AnalyticsPage() {
  const router = useRouter();
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getDashboard(false, "1y")
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="w-full max-w-[1200px] flex justify-center py-8">
        <div className="flex flex-col items-center gap-1">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <span className="text-xs text-muted-foreground">Loading analytics…</span>
        </div>
      </div>
    );
  }

  const rows = data?.rows ?? [];
  const buy = rows.filter((r) => r.qm_rating === "Strong Buy" || r.qm_rating === "Buy").length;
  const hold = rows.filter((r) => r.qm_rating === "Hold").length;
  const sell = rows.filter((r) => r.qm_rating === "Sell" || r.qm_rating === "Strong Sell").length;
  const total = rows.length;
  const improving = rows.filter((r) => r.trend === "improving").length;
  const deteriorating = rows.filter((r) => r.trend === "deteriorating").length;
  const stable = rows.filter((r) => r.trend === "stable").length;
  const avgScore = total > 0 ? (rows.reduce((s, r) => s + r.qm_score, 0) / total).toFixed(1) : "—";

  return (
    <div className="w-full max-w-[1200px]">
      <nav className="mb-1 flex items-center gap-1 text-xs text-muted-foreground">
        <span
          onClick={() => router.push("/")}
          className="flex cursor-pointer items-center gap-1 hover:text-foreground"
        >
          <Home size={14} />
          <span>Home</span>
        </span>
        <span className="text-foreground font-semibold">Analytics</span>
      </nav>

      <div className="mb-3 flex items-center justify-between">
        <div>
          <h1 className="text-[1.6rem] font-bold tracking-tight">
            Portfolio Analytics
          </h1>
          <p className="text-xs text-muted-foreground">
            Aggregate statistics across all analysed NSE stocks
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2 mb-3">
        <StatCard title="Total Stocks" value={total} icon={<Database size={28} />} color="text-primary" subtitle={`${data?.total_nse_count ?? "?"} total NSE`} />
        <StatCard title="Average Score" value={avgScore} icon={<BarChart3 size={28} />} color="text-blue-500" subtitle="0–100 blended score" />
        <StatCard title="Buy Signals" value={buy} icon={<TrendingUp size={28} />} color="text-green-600" subtitle={`${total > 0 ? ((buy / total) * 100).toFixed(1) : 0}% of portfolio`} />
        <StatCard title="Sell Signals" value={sell} icon={<TrendingDown size={28} />} color="text-red-600" subtitle={`${total > 0 ? ((sell / total) * 100).toFixed(1) : 0}% of portfolio`} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-3">
        <Card className="border-green-600/30 opacity-85">
          <CardContent className="p-5">
            <div className="flex items-center gap-2">
              <TrendingUp className="text-green-600" size={20} />
              <div>
                <p className="text-[1.5rem] font-bold leading-tight text-green-600">{improving}</p>
                <p className="text-[0.7rem] text-muted-foreground">Improving</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-amber-500/30 opacity-85">
          <CardContent className="p-5">
            <div className="flex items-center gap-2">
              <Minus className="text-amber-500" size={20} />
              <div>
                <p className="text-[1.5rem] font-bold leading-tight text-amber-500">{stable}</p>
                <p className="text-[0.7rem] text-muted-foreground">Stable</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-red-600/30 opacity-85">
          <CardContent className="p-5">
            <div className="flex items-center gap-2">
              <TrendingDown className="text-red-600" size={20} />
              <div>
                <p className="text-[1.5rem] font-bold leading-tight text-red-600">{deteriorating}</p>
                <p className="text-[0.7rem] text-muted-foreground">Deteriorating</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-5">
          <h3 className="mb-1.5 text-sm font-semibold">Rating Distribution</h3>
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline" className="font-semibold">Strong Buy: {rows.filter((r) => r.qm_rating === "Strong Buy").length}</Badge>
            <Badge variant="outline" className="font-semibold">Buy: {rows.filter((r) => r.qm_rating === "Buy").length}</Badge>
            <Badge variant="outline" className="font-semibold">Hold: {hold}</Badge>
            <Badge variant="outline" className="font-semibold">Sell: {rows.filter((r) => r.qm_rating === "Sell").length}</Badge>
            <Badge variant="outline" className="font-semibold">Strong Sell: {rows.filter((r) => r.qm_rating === "Strong Sell").length}</Badge>
          </div>
        </CardContent>
      </Card>

      <p className="block text-center pt-3 text-[0.7rem] text-muted-foreground/50">
        Data sourced from the most recent NSE analysis run. Scores are 0–100 blended ratings (40% technical + 40% fundamental + 10% sentiment + 10% cap adjustment).
      </p>
    </div>
  );
}
