// Quick engine smoke test — run with: npx tsx scripts/ledger-engine-test.ts
import { categorize, parseUploadedFile, extractUpiPayee, detectRecurring } from "../lib/ledger/engine";
import type { Transaction } from "../lib/ledger/types";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`  PASS ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}\n    expected ${e}\n    actual   ${a}`);
  }
}

console.log("== categorize (golden from Python engine) ==");
const samples: Array<[string, number, string, string]> = [
  ["UPI-ADYAR ANANDA BHAVAN -AMZNPLA2B100170@YAPL-YESB0APLUPI-938065476857-PAYMENT FROM PHONE", 683, "Food & Dining", "medium"],
  ["5741510892/CSHFRESWIGGY", 543, "Food & Dining", "medium"],
  ["UPI-ZEPTO-ZEPTOONLINE@YBL-YESB0YBLUPI-166158272654-PAYMENT FROM PHONE", 201, "Food & Dining", "medium"],
  ["NEFT/IBD/ACB000000 SUBWAY", 350, "Food & Dining", "medium"],
  ["BY TRANSFER ZERODHA BROKING LIMITED", 5000, "Investment", "medium"],
  ["ATM CASH WITHDRAWAL SBI ATM 00413", 2000, "ATM", "high"],
  ["INSURANCE PREMIUM HDFC ERGO", 1200, "Utilities & Bills", "medium"],
  ["POS PURCHASE RELIANCE TRENDS", 1500, "Shopping", "medium"],
  ["SALARY CREDIT FOR JUNE 2026", -85000, "Income", "high"],
  // Regression: AUTOPAY must not match Travel & Transport ('auto' keyword)
  ["UPI-AUTOPAY-BAJAJ FINANCE LTD-BFLAUTOPAY@HDFCB-123456789012-PAYMENT FROM PHONE", 3641, "Loan", "medium"],
  // Regression: UPI "20" space-encoding must normalize before matching
  ["UPI-AUTOPAY-BAJAJ20FINANCE20LIMI-BFLAUTOPAY@HDFCB-123456789012-PAYMENT FROM PHONE", 9992, "Loan", "medium"],
  // Regression: 'rent' must not match TRENT (Westside A Unit of Trent)
  ["UPI-WESTSIDE A UNIT OF T-WESTSIDEAUNITOFTRENT.123@YBL-123456789012-PAYMENT FROM PHONE", 499, "Shopping", "medium"],
  // Regression: person-to-person UPI transfer → Personal
  ["UPI-SELVI B-PAYTM.S272G3Y@PTY-YESB0MCHUPI-850537768696-PAYMENT FROM PHONE", 200, "Personal", "medium"],
  // Regression: merchant QR (@PTYS) must NOT become Personal
  ["UPI-SURESH SUPER STORE-PAYTM.S1F81ZL@PTY-YESB0MCHUPI-146643638975-PAYMENT FROM PHONE", 80, "Shopping", "medium"],
];
for (const [desc, amt, cat, conf] of samples) {
  const r = categorize(desc, amt);
  check(`categorize(${desc.slice(0, 30)}...)`, [r.categories[0], r.confidence], [cat, conf]);
}

console.log("== extractUpiPayee (golden from current Python engine) ==");
check("upi payee", extractUpiPayee("UPI-ZEPTO-ZEPTOONLINE@YBL-YESB0YBLUPI-166158272654-PAYMENT FROM PHONE"), "zepto zeptoonline yesb0yblupi phone");
check("non-upi", extractUpiPayee("POS PURCHASE RELIANCE TRENDS"), "pos purchase reliance trends");

console.log("== parseUploadedFile (bank statement CSV) ==");
const csv = `Date,Narration,Chq./Ref.No.,Value Dt,Withdrawal Amt,Deposit Amt,Closing Balance
01-06-2026,UPI-SWIGGY-SWIGGYIN@YBL-123456789012-PAYMENT FROM PHONE,,01-06-2026,543.00,,45200.00
02-06-2026,BY TRANSFER ZERODHA BROKING LIMITED,,02-06-2026,5000.00,,40200.00
03-06-2026,SALARY CREDIT FOR JUNE,,03-06-2026,,85000.00,125200.00
04-06-2026,ATM CASH WITHDRAWAL SBI ATM 00413,,04-06-2026,2000.00,,123200.00
05-06-2026,UPI-ZEPTO-ZEPTOONLINE@YBL-166158272654-PAYMENT FROM PHONE,,05-06-2026,201.00,,122999.00
`;
const result = await parseUploadedFile(csv, "statement.csv");
check("tx count", result.transactions.length, 5);
check("tx1 cat", result.transactions[0]?.categories, ["Food & Dining"]);
check("tx2 cat", result.transactions[1]?.categories, ["Investment"]);
check("tx3 cat (income)", result.transactions[2]?.categories, ["Income"]);
check("tx3 amount negative", result.transactions[2]?.amount < 0, true);
check("tx4 cat", result.transactions[3]?.categories, ["ATM"]);
check("insights present", result.insights.length > 0, true);
check("budgets present", result.budgets.length > 0, true);

console.log("== detectRecurring ==");
const txs: Transaction[] = [
  { id: "a", date: "2026-06-01", description: "Netflix", amount: 649, categories: ["Entertainment"] },
  { id: "b", date: "2026-07-01", description: "Netflix", amount: 649, categories: ["Entertainment"] },
  { id: "c", date: "2026-06-05", description: "One-off", amount: 100, categories: ["Others"] },
];
const rec = detectRecurring(txs);
check("netflix recurring", rec[0]?.recurring, true);
check("one-off not recurring", rec[2]?.recurring, undefined);

console.log(failures === 0 ? "\nALL TESTS PASSED" : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);