import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { parseUploadedFile } from "../lib/ledger/engine";

/**
 * Fixture-driven regression suite.
 *
 * Every fixture is a synthetic bank statement in a distinct real-world layout
 * (HDFC/SBI/ICICI, UPI exports, delimited, fixed-width, PDF, credit card).
 * The assertions pin the transaction count, the sign convention
 * (positive = expense, negative = income), and balance continuity so future
 * parser changes cannot silently regress a format.
 */

const FIXTURES_DIR = path.join(__dirname, "fixtures");

interface FixtureCase {
  file: string;
  count: number;
  /** (index, expectedAmount) — spot-check the sign convention. */
  spotChecks: Array<[number, number]>;
  /** True when the fixture carries a Balance column that must reconcile. */
  hasBalance: boolean;
}

const CASES: FixtureCase[] = [
  { file: "hdfc-style.csv", count: 5, spotChecks: [[0, 543], [2, -85000]], hasBalance: true },
  { file: "icici-style.csv", count: 4, spotChecks: [[0, 543], [1, -85000]], hasBalance: true },
  { file: "sbi-style.csv", count: 4, spotChecks: [[0, 543], [1, -85000]], hasBalance: true },
  { file: "upi-phonepe.csv", count: 4, spotChecks: [[0, 543], [1, -85000]], hasBalance: false },
  { file: "upi-gpay.csv", count: 3, spotChecks: [[0, 543], [1, -85000]], hasBalance: false },
  { file: "upi-paytm.csv", count: 3, spotChecks: [[0, 543], [1, -85000]], hasBalance: false },
  { file: "tab-delimited.txt", count: 4, spotChecks: [[0, 543], [1, -85000]], hasBalance: true },
  { file: "semicolon.csv", count: 4, spotChecks: [[0, 543], [1, -85000]], hasBalance: true },
  { file: "pipe.csv", count: 4, spotChecks: [[0, 543], [1, -85000]], hasBalance: true },
  { file: "fixed-width.txt", count: 4, spotChecks: [[0, 543], [1, -85000]], hasBalance: true },
  { file: "drcr-indicator.csv", count: 4, spotChecks: [[0, 543], [1, -85000]], hasBalance: false },
  { file: "credit-card.csv", count: 4, spotChecks: [[0, 543], [1, -85000]], hasBalance: false },
  { file: "pdf-statement.pdf", count: 5, spotChecks: [[0, 543], [2, -85000]], hasBalance: true },
];

for (const c of CASES) {
  test(`fixture: ${c.file}`, async () => {
    const buf = fs.readFileSync(path.join(FIXTURES_DIR, c.file));
    const result = await parseUploadedFile(
      buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
      c.file,
    );

    assert.equal(result.transactions.length, c.count, `expected ${c.count} transactions`);

    for (const [idx, amount] of c.spotChecks) {
      const t = result.transactions[idx];
      assert.ok(t, `transaction ${idx} exists`);
      assert.equal(t.amount, amount, `transaction ${idx} amount sign/value`);
      assert.ok(t.date, `transaction ${idx} has a date`);
      assert.ok(t.description && t.description !== "Unknown Transaction", `transaction ${idx} has a description`);
    }

    if (c.hasBalance) {
      assert.ok(result.balanceCheck, "balance continuity should be reported");
      assert.equal(result.balanceCheck!.mismatches.length, 0, "no balance mismatches");
    }
  });
}