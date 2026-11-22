"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Home } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import { signalPair } from "@/lib/theme";

function formatINR(n: number): string {
  return "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function CalculatorPage() {
  const router = useRouter();
  const [buyPrice, setBuyPrice] = useState("");
  const [shares, setShares] = useState("");
  const [sellPrice, setSellPrice] = useState("");

  const results = useMemo(() => {
    const b = parseFloat(buyPrice);
    const n = parseInt(shares, 10);
    const s = parseFloat(sellPrice);
    if (isNaN(b) || b <= 0 || isNaN(n) || n <= 0 || isNaN(s) || s <= 0) return null;

    const investment = b * n;
    const totalSellValue = s * n;
    const totalProfit = totalSellValue - investment;
    const profitPerShare = s - b;
    const sharesToSellForMargin = Math.ceil(investment / s);
    const freeShares = n - sharesToSellForMargin;
    const freeSharesValue = freeShares * s;

    return {
      buyPrice: b,
      shares: n,
      sellPrice: s,
      investment,
      totalSellValue,
      totalProfit,
      profitPerShare,
      sharesToSellForMargin,
      freeShares,
      freeSharesValue,
    };
  }, [buyPrice, shares, sellPrice]);

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
        <span className="text-foreground font-semibold">Free Stock Calculator</span>
      </nav>

      <h1 className="gradient-text text-[1.6rem] font-bold tracking-tight mb-1">
        Free Stock Calculator
      </h1>
      <p className="mb-3 block text-xs text-muted-foreground">
        Sell just enough shares to recover your investment. The rest stay in your demat as free shares — zero cost.
      </p>

      <Card className="mb-3">
        <CardContent className="p-6">
          <div className="grid grid-cols-3 gap-2 mb-3">
            <Input
              type="number"
              placeholder="Buy Price (₹)"
              value={buyPrice}
              onChange={(e) => setBuyPrice(e.target.value)}
              min={0}
              step={0.05}
            />
            <Input
              type="number"
              placeholder="Shares Bought"
              value={shares}
              onChange={(e) => setShares(e.target.value)}
              min={1}
              step={1}
            />
            <Input
              type="number"
              placeholder="Sell Price (₹)"
              value={sellPrice}
              onChange={(e) => setSellPrice(e.target.value)}
              min={0}
              step={0.05}
            />
          </div>

          {results ? (
            <>
              <Card
                className="mb-2 border-0"
                style={
                  results.freeShares > 0
                    ? { backgroundColor: signalPair("strongBuy").bg, color: signalPair("strongBuy").fg }
                    : { backgroundColor: signalPair("hold").bg, color: signalPair("hold").fg }
                }
              >
                <CardContent className="p-5 text-center">
                  <div className="text-4xl font-extrabold">
                    {results.freeShares > 0 ? results.freeShares : 0}
                  </div>
                  <div className="opacity-85 text-sm mt-1">
                    {results.freeShares > 0
                      ? `Free Share${results.freeShares > 1 ? "s" : ""} in Demat (worth ${formatINR(results.freeSharesValue)})`
                      : "Cannot get free shares at this price — sell higher"}
                  </div>
                </CardContent>
              </Card>

              <Card className="mb-2">
                <CardContent className="p-5">
                  <p className="mb-1 block text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
                    How It Works
                  </p>
                  <div className="flex flex-col gap-1">
                    <div className="flex justify-between">
                      <span className="text-xs text-muted-foreground">Investment (buy {results.shares} × {formatINR(results.buyPrice)})</span>
                      <span className="text-sm font-semibold">{formatINR(results.investment)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-xs text-muted-foreground">Total Value at {formatINR(results.sellPrice)}</span>
                      <span className="text-sm font-semibold">{formatINR(results.totalSellValue)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-xs text-muted-foreground">Shares to Sell to Recover Investment</span>
                      <span className="text-sm font-bold text-strong-sell">{results.sharesToSellForMargin}</span>
                    </div>
                    <Separator />
                    <div className="flex justify-between">
                      <span className="text-sm font-semibold">Free Shares Remaining</span>
                      <span className="text-lg font-extrabold text-strong-buy">{results.freeShares > 0 ? results.freeShares : 0}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-xs text-muted-foreground">Profit per Share ({formatINR(results.sellPrice)} − {formatINR(results.buyPrice)})</span>
                      <span className="text-sm font-semibold text-strong-buy">{formatINR(results.profitPerShare)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-xs text-muted-foreground">Total Profit on All Shares</span>
                      <span className="text-sm font-semibold text-strong-buy">{formatINR(results.totalProfit)}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-5">
                  <p className="mb-1 block text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
                    Free Shares at Different Sell Prices
                  </p>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs font-bold text-muted-foreground">Sell Price</TableHead>
                        <TableHead className="text-right text-xs font-bold text-muted-foreground">Sell to Recover</TableHead>
                        <TableHead className="text-right text-xs font-bold text-muted-foreground">Free Shares</TableHead>
                        <TableHead className="text-right text-xs font-bold text-muted-foreground">Free Value</TableHead>
                        <TableHead className="text-right text-xs font-bold text-muted-foreground">Total Profit</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {results.profitPerShare > 0 ? (
                        (() => {
                          const steps = [];
                          for (let i = 1; i <= 5; i++) {
                            const price = results.buyPrice + results.profitPerShare * i;
                            const sharesToSell = Math.ceil(results.investment / price);
                            const free = results.shares - sharesToSell;
                            const freeVal = free > 0 ? free * price : 0;
                            const totalP = (price - results.buyPrice) * results.shares;
                            steps.push({ price, sharesToSell, free, freeVal, totalP });
                          }
                          return steps.map((step, i) => (
                            <TableRow
                              key={i}
                              className={Math.abs(step.price - results.sellPrice) < 0.01 ? "bg-muted/50" : ""}
                            >
                              <TableCell className="text-[0.8rem] font-bold">{formatINR(step.price)}</TableCell>
                              <TableCell className="text-right text-[0.8rem]">{step.sharesToSell}</TableCell>
                              <TableCell className={`text-right text-[0.8rem] font-bold ${step.free > 0 ? "text-strong-buy" : "text-muted-foreground/50"}`}>
                                {step.free > 0 ? step.free : 0}
                              </TableCell>
                              <TableCell className="text-right text-[0.8rem]">{step.freeVal > 0 ? formatINR(step.freeVal) : "—"}</TableCell>
                              <TableCell className="text-right text-[0.8rem] font-semibold text-strong-buy">{formatINR(step.totalP)}</TableCell>
                            </TableRow>
                          ));
                        })()
                      ) : (
                        <TableRow>
                          <TableCell colSpan={5} className="text-center text-muted-foreground/50 py-4">
                            Sell price must be above buy price to get free shares
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </>
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground/50">
              Enter buy price, quantity, and target sell price to see your free shares.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
