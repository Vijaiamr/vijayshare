/**
 * One-off verification: parse Vijay's real bank statement (.xls) with the TS engine.
 * Run: npx tsx scripts/verify-real-statement.ts
 */
import * as fs from "fs";
import * as path from "path";
import { parseUploadedFile } from "../lib/ledger/engine";
import type { Transaction } from "../lib/ledger/types";

const filePath = process.argv[2] ?? "/Users/vijaykumar/projecs /opencode/Acct Statement_8816_30082026_12.07.41.xls";

async function main() {
  const buf = fs.readFileSync(filePath);
  const result = await parseUploadedFile(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), path.basename(filePath), {});

  console.log(`File: ${path.basename(filePath)} (${buf.length} bytes)`);
  console.log(`Parsed: ${result.transactions.length} transactions | isFallback=${result.isFallback}`);
  console.log("");

  if (result.transactions.length === 0) {
    console.log("NO TRANSACTIONS PARSED — parser did not recognize the layout.");
    process.exit(1);
  }

  // Summary
  let income = 0, expense = 0;
  const byCat: Record<string, number> = {};
  for (const t of result.transactions) {
    if (t.amount < 0) income += Math.abs(t.amount);
    else {
      expense += t.amount;
      for (const c of t.categories?.length ? t.categories : ["Others"]) {
        if (c !== "Income") byCat[c] = (byCat[c] ?? 0) + t.amount;
      }
    }
  }
  console.log(`Income: ₹${income.toLocaleString("en-IN")} | Expense: ₹${expense.toLocaleString("en-IN")} | Net: ₹${(income - expense).toLocaleString("en-IN")}`);
  console.log("");
  console.log("Category breakdown:");
  for (const [c, v] of Object.entries(byCat).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${c.padEnd(22)} ₹${Math.round(v).toLocaleString("en-IN")}`);
  }
  console.log("");

  // Sample rows
  console.log("First 25 transactions:");
  for (const t of result.transactions.slice(0, 25)) {
    const cats = (t.categories ?? []).join("|");
    const conf = t.confidence ?? "";
    console.log(`  ${t.date}  ${String(t.amount).padStart(10)}  ${(t.description || "").slice(0, 46).padEnd(46)}  ${cats.padEnd(24)} ${conf}${t.recurring ? " 🔁" : ""}`);
  }
  console.log("");

  // Uncategorized / low confidence
  const low = result.transactions.filter((t) => t.amount > 0 && (!t.categories?.length || t.categories.includes("Others")));
  console.log(`Uncategorized/Others: ${low.length} of ${result.transactions.length}`);
  for (const t of low.slice(0, 15)) {
    console.log(`  ${t.date}  ${String(t.amount).padStart(10)}  ${(t.description || "").slice(0, 60)}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});