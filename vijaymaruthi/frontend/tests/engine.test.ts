/**
 * Ledger engine unit tests — permanent regression suite.
 * Run with: npm test  (node --import tsx --test tests/*.test.ts)
 *
 * Covers the Phase 1 data-integrity fixes (parseAmount, parseDateStr,
 * parseFileToRows date-cell handling) and the Phase 2.3 UPI payee dedupe.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import {
  parseAmount,
  parseDateStr,
  extractUpiPayee,
  isRentPayment,
  isRentTransaction,
  dedupKeys,
  mergeTransactions,
  categorize,
  autoDetectColumns,
  parseCsv,
  parseFileToRows,
  parseUploadedFile,
  looksLikeDate,
} from '../lib/ledger/engine';
import type { Transaction } from '../lib/ledger/types';

describe('parseAmount', () => {
  it('parses "Dr. 500" as 500 (not 0.5)', () => assert.equal(parseAmount('Dr. 500'), 500));
  it('parses "Cr. 250" as 250', () => assert.equal(parseAmount('Cr. 250'), 250));
  it('parses "(3,000)" as -3000 (parenthesized = negative)', () => assert.equal(parseAmount('(3,000)'), -3000));
  it('parses "(3,000.50)" as -3000.5', () => assert.equal(parseAmount('(3,000.50)'), -3000.5));
  it('parses "Rs.1,234.56" as 1234.56', () => assert.equal(parseAmount('Rs.1,234.56'), 1234.56));
  it('parses "-500" as -500', () => assert.equal(parseAmount('-500'), -500));
  it('parses "500" as 500', () => assert.equal(parseAmount('500'), 500));
  it('parses "1,000.00" as 1000', () => assert.equal(parseAmount('1,000.00'), 1000));
  it('parses number input 42.5 as 42.5', () => assert.equal(parseAmount(42.5), 42.5));
  it('returns 0 for empty string', () => assert.equal(parseAmount(''), 0));
  it('returns 0 for null', () => assert.equal(parseAmount(null), 0));
  it('returns 0 for garbage', () => assert.equal(parseAmount('abc'), 0));
  // Dr/Cr suffix direction (debit = expense/positive, credit = income/negative)
  it('parses "500 Dr" as 500 (debit)', () => assert.equal(parseAmount('500 Dr'), 500));
  it('parses "500 Cr" as -500 (credit)', () => assert.equal(parseAmount('500 Cr'), -500));
  it('parses "1,234.56 Cr" as -1234.56', () => assert.equal(parseAmount('1,234.56 Cr'), -1234.56));
  it('parses "500.00 DB" as 500 (debit)', () => assert.equal(parseAmount('500.00 DB'), 500));
  it('parses "500-" as -500 (trailing minus)', () => assert.equal(parseAmount('500-'), -500));
  it('parses "₹1,234.56" as 1234.56', () => assert.equal(parseAmount('₹1,234.56'), 1234.56));
  it('parses "INR 500" as 500', () => assert.equal(parseAmount('INR 500'), 500));
});

describe('parseDateStr', () => {
  it('parses "07-Jun-26"', () => assert.equal(parseDateStr('07-Jun-26'), '2026-06-07'));
  it('parses "07/06/2026"', () => assert.equal(parseDateStr('07/06/2026'), '2026-06-07'));
  it('parses "7/6/26"', () => assert.equal(parseDateStr('7/6/26'), '2026-06-07'));
  it('passes through ISO "2026-06-07"', () => assert.equal(parseDateStr('2026-06-07'), '2026-06-07'));
  it('parses "June 7, 2026"', () => assert.equal(parseDateStr('June 7, 2026'), '2026-06-07'));
  it('parses "07.06.2026" (dot separators)', () => assert.equal(parseDateStr('07.06.2026'), '2026-06-07'));
  it('parses "07-Jun-2026" (4-digit year + month name)', () => assert.equal(parseDateStr('07-Jun-2026'), '2026-06-07'));
  it('parses "31/12/99" as 1999 (century heuristic)', () => assert.equal(parseDateStr('31/12/99'), '1999-12-31'));
  it('parses Excel serial "46000" to a valid date', () => {
    const d = parseDateStr('46000');
    assert.match(d, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(d, '2025-12-09');
  });
});

describe('extractUpiPayee', () => {
  it('strips UPI prefix + ref, keeps merchant', () =>
    assert.equal(extractUpiPayee('UPI/123456789012/PAYTM/ABC Store'), 'paytm abc store'));
  it('handles P2A + handle segments', () =>
    assert.equal(extractUpiPayee('UPI-P2A-9876543210@ybl-ABC Store'), 'p2a abc store'));
  it('handles PhonePe UPI', () =>
    assert.equal(extractUpiPayee('PhonePe UPI 123456789012@ybl Merchant Name'), 'merchant name'));
  it('handles Google Pay txn refs', () =>
    assert.equal(extractUpiPayee('Google Pay txn 1234567890123456 at Cafe'), 'at cafe'));
  it('keeps merchant words after stop words', () =>
    assert.equal(extractUpiPayee('Payment to XYZ Traders via UPI'), 'xyz traders upi'));
  it('handles CREDIT refs', () =>
    assert.equal(extractUpiPayee('UPI/123456789012/CREDIT/Flipkart'), 'flipkart'));
  it('removes 3-letter-prefix refs (UTX style)', () =>
    assert.equal(extractUpiPayee('UPI/UTX1234567890/Amazon Pay'), 'amazon pay'));
  it('removes alphanumeric refs', () =>
    assert.equal(extractUpiPayee('UPI/abcd12345678/Swiggy'), 'swiggy'));
  it('removes TXN-prefixed refs', () =>
    assert.equal(extractUpiPayee('UPI/TXN1234567890/Myntra'), 'myntra'));
  it('returns null for empty', () => assert.equal(extractUpiPayee(''), null));
});

describe('isRentPayment', () => {
  it('matches house rent phrases', () => {
    assert.equal(isRentPayment('UPI/123/RENT PAID'), true);
    assert.equal(isRentPayment('HOUSE RENT'), true);
    assert.equal(isRentPayment('Monthly rent payment'), true);
    assert.equal(isRentPayment('RENT'), true);
  });
  it('rejects rentals and rent-a-X', () => {
    assert.equal(isRentPayment('RENTAL CAR'), false);
    assert.equal(isRentPayment('RENTED EQUIPMENT'), false);
    assert.equal(isRentPayment('RENT A CAR'), false);
    assert.equal(isRentPayment('RENT A MOVIE'), false);
    assert.equal(isRentPayment('BIKE RENTAL'), false);
    assert.equal(isRentPayment('GROCERY STORE'), false);
  });
});

describe('isRentTransaction', () => {
  it('matches by description keyword', () => {
    assert.equal(isRentTransaction({ description: 'RENT PAID' }), true);
    assert.equal(isRentTransaction({ description: 'HOUSE RENT' }), true);
  });
  it('matches by user-applied rent category tag', () => {
    assert.equal(isRentTransaction({ description: 'GROCERY STORE', categories: ['Rent'] }), true);
    assert.equal(isRentTransaction({ description: 'GROCERY STORE', categories: ['House Rent'] }), true);
    assert.equal(isRentTransaction({ description: 'GROCERY STORE', categories: ['Housing'] }), true);
  });
  it('does not match non-rent categories', () => {
    assert.equal(isRentTransaction({ description: 'GROCERY STORE', categories: ['Utilities & Bills'] }), false);
    assert.equal(isRentTransaction({ description: 'GROCERY STORE', categories: ['Food & Dining'] }), false);
  });
  it('does not false-positive on words containing "rent"', () => {
    assert.equal(isRentTransaction({ description: 'GROCERY STORE', categories: ['Current'] }), false);
    assert.equal(isRentTransaction({ description: 'GROCERY STORE', categories: ['Parent'] }), false);
  });
  it('still rejects rentals', () => {
    assert.equal(isRentTransaction({ description: 'RENTAL CAR', categories: ['Travel & Transport'] }), false);
    assert.equal(isRentTransaction({ description: 'RENT A MOVIE' }), false);
  });
});

describe('dedupKeys', () => {
  it('builds exact + normalized keys', () => {
    const keys = dedupKeys({ date: '2026-06-07', description: 'UPI/123456789012/Swiggy', amount: 250 });
    assert.equal(keys.exact, '2026-06-07::upi/123456789012/swiggy::250');
    assert.equal(keys.normalized, '2026-06-07::swiggy::250');
  });
  it('rounds amounts to 2dp', () => {
    const a = dedupKeys({ date: '2026-06-07', description: 'x', amount: 644 });
    const b = dedupKeys({ date: '2026-06-07', description: 'x', amount: 644.0 });
    assert.equal(a.exact, b.exact);
  });
});

describe('mergeTransactions', () => {
  it('dedupes by exact key, preserving order', () => {
    const existing: Transaction[] = [
      { id: '1', date: '2026-06-07', description: 'Swiggy', amount: 250, categories: ['Food & Dining'] },
    ];
    const incoming: Transaction[] = [
      { id: '2', date: '2026-06-07', description: 'Swiggy', amount: 250, categories: ['Food & Dining'] },
      { id: '3', date: '2026-06-08', description: 'Zomato', amount: 300, categories: ['Food & Dining'] },
    ];
    const merged = mergeTransactions(existing, incoming);
    assert.equal(merged.length, 2);
    assert.equal(merged[0].id, '1');
    assert.equal(merged[1].id, '3');
  });
});

describe('categorize', () => {
  it('classifies negative amounts as Income', () => {
    const r = categorize('Salary credit', -50000);
    assert.deepEqual(r.categories, ['Income']);
    assert.equal(r.confidence, 'high');
  });
  it('classifies Swiggy as Food & Dining', () => {
    const r = categorize('UPI/123456789012/SWIGGY', 250);
    assert.ok(r.categories.includes('Food & Dining'));
  });
  it('falls back to Others for unknown', () => {
    const r = categorize('XYZQWERTY UNKNOWN MERCHANT', 100);
    assert.deepEqual(r.categories, ['Others']);
    assert.equal(r.confidence, 'low');
  });
  it('applies learned corrections', () => {
    const r = categorize('My Local Shop', 100, { 'desc::My Local Shop': ['Shopping'] });
    assert.deepEqual(r.categories, ['Shopping']);
    assert.equal(r.learned, true);
  });
});

describe('autoDetectColumns', () => {
  it('detects date/description/withdrawal columns', () => {
    const m = autoDetectColumns(['Transaction Date', 'Narration', 'Withdrawal Amt']);
    assert.equal(m.date, 'Transaction Date');
    assert.equal(m.description, 'Narration');
    assert.equal(m.withdrawal, 'Withdrawal Amt');
  });
  it('detects separate debit/credit columns (ICICI/SBI style)', () => {
    const m = autoDetectColumns(['Transaction Date', 'Value Date', 'Description', 'Ref No./Cheque No.', 'Debit', 'Credit', 'Balance']);
    assert.equal(m.date, 'Transaction Date');
    assert.equal(m.description, 'Description');
    assert.equal(m.withdrawal, 'Debit');
    assert.equal(m.deposit, 'Credit');
  });
  it('detects single amount column with Dr/Cr indicator', () => {
    const m = autoDetectColumns(['Date', 'Particulars', 'Dr/Cr', 'Amount']);
    assert.equal(m.date, 'Date');
    assert.equal(m.description, 'Particulars');
    assert.equal(m.drCr, 'Dr/Cr');
    assert.equal(m.amount, 'Amount');
  });
  it('detects HDFC layout (Date + Value Dt → keeps Date)', () => {
    const m = autoDetectColumns(['Date', 'Narration', 'Chq./Ref.No.', 'Value Dt', 'Withdrawal Amt.', 'Deposit Amt.', 'Closing Balance']);
    assert.equal(m.date, 'Date');
    assert.equal(m.description, 'Narration');
    assert.equal(m.withdrawal, 'Withdrawal Amt.');
    assert.equal(m.deposit, 'Deposit Amt.');
  });
  it('falls back to positional mapping', () => {
    const m = autoDetectColumns(['A', 'B', 'C']);
    assert.equal(m.date, 'A');
    assert.equal(m.description, 'B');
    assert.equal(m.amount, 'C');
  });
  it('detects the Balance column for continuity self-check', () => {
    const m = autoDetectColumns(['Date', 'Narration', 'Withdrawal Amt.', 'Deposit Amt.', 'Closing Balance']);
    assert.equal(m.balance, 'Closing Balance');
  });
});

describe('looksLikeDate', () => {
  it('accepts common statement date formats', () => {
    assert.equal(looksLikeDate('01/06/2026'), true);
    assert.equal(looksLikeDate('01-06-2026'), true);
    assert.equal(looksLikeDate('01.06.2026'), true);
    assert.equal(looksLikeDate('01-Jun-2026'), true);
    assert.equal(looksLikeDate('2026-06-07'), true);
    assert.equal(looksLikeDate('46000'), true); // Excel serial
  });
  it('rejects totals and non-date values', () => {
    assert.equal(looksLikeDate('130541.94'), false); // Opening Balance total
    assert.equal(looksLikeDate(''), false);
    assert.equal(looksLikeDate('SALARY'), false);
    assert.equal(looksLikeDate('142709.09'), false); // Debits total
  });
});

describe('balance continuity self-check', () => {
  it('reports no mismatches when balances reconcile', async () => {
    const csv = `Date,Narration,Withdrawal,Deposit,Balance
01-06-2026,UPI-SWIGGY,543.00,,45200.00
02-06-2026,SALARY,,85000.00,130200.00
03-06-2026,ATM WITHDRAWAL,2000.00,,128200.00`;
    const res = await parseUploadedFile(csv, 'statement.csv');
    assert.ok(res.balanceCheck);
    assert.equal(res.balanceCheck!.checked, 2);
    assert.equal(res.balanceCheck!.mismatches.length, 0);
  });
  it('flags a row whose balance does not reconcile', async () => {
    const csv = `Date,Narration,Withdrawal,Deposit,Balance
01-06-2026,UPI-SWIGGY,543.00,,45200.00
02-06-2026,SALARY,,85000.00,130200.00
03-06-2026,ATM WITHDRAWAL,2000.00,,128200.00
04-06-2026,UPI-ZEPTO,201.00,,128000.00`;
    const res = await parseUploadedFile(csv, 'statement.csv');
    assert.ok(res.balanceCheck);
    assert.equal(res.balanceCheck!.mismatches.length, 1);
    assert.equal(res.balanceCheck!.mismatches[0]!.description, 'UPI-ZEPTO');
  });
  it('excludes HDFC-style STATEMENT SUMMARY totals from transactions', async () => {
    const csv = `Date,Narration,Chq./Ref.No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance
01/06/26,UPI-SWIGGY,0000123456789012,01/06/26,543.00,,45200.00
02/06/26,SALARY CREDIT,0000112233445566,02/06/26,,85000.00,130200.00
STATEMENT SUMMARY :-,,,,,,
Opening Balance,,,,Debits,Credits,Closing Bal
130541.94,,,,142709.09,135866.6,123699.45`;
    const res = await parseUploadedFile(csv, 'hdfc.csv');
    assert.equal(res.transactions.length, 2);
    assert.ok(res.balanceCheck);
    assert.equal(res.balanceCheck!.mismatches.length, 0);
  });
  it('returns zero transactions for a random CSV (no garbage fabrication)', async () => {
    const res = await parseUploadedFile(
      'hello world, this is not a bank statement\nfoo,bar,baz\n1,2,3',
      'statement.csv',
    );
    assert.equal(res.transactions.length, 0);
  });
  it('returns zero transactions for junk binary renamed .xlsx', async () => {
    const junk = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09]);
    const res = await parseUploadedFile(junk.buffer, 'statement.xlsx');
    assert.equal(res.transactions.length, 0);
  });
});

describe('parseCsv', () => {
  it('parses simple CSV with header', () => {
    const rows = parseCsv('Date,Description,Amount\n2026-06-07,Swiggy,250\n');
    assert.equal(rows.length, 2);
    assert.deepEqual(rows[0], ['Date', 'Description', 'Amount']);
    assert.deepEqual(rows[1], ['2026-06-07', 'Swiggy', '250']);
  });
});

describe('parseFileToRows + parseUploadedFile (.xlsx round-trip)', () => {
  // Real Excel file: date cells stored as serial numbers with a date format.
  // Serial for a calendar date is the day count from 1899-12-30 (Excel epoch).
  const serial = (y: number, m: number, d: number) =>
    Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000);

  function buildXlsx(): ArrayBuffer {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ['Date', 'Description', 'Amount'],
      [serial(2026, 6, 7), 'Salary', 50000],
      [serial(2026, 6, 15), 'Rent', -12000],
    ]);
    ws['A2'].z = 'dd/mm/yyyy';
    ws['A3'].z = 'dd/mm/yyyy';
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  }

  it('preserves date display strings from date-formatted cells', async () => {
    const rows = await parseFileToRows(buildXlsx(), 'statement.xlsx');
    assert.equal(rows[1]?.[0], '07/06/2026');
    assert.equal(rows[2]?.[0], '15/06/2026');
    assert.equal(rows[1]?.[2], '50000');
  });

  it('parses end-to-end with correct dates and signs', async () => {
    const res = await parseUploadedFile(buildXlsx(), 'statement.xlsx');
    assert.equal(res.transactions.length, 2);
    assert.equal(res.transactions[0]?.date, '2026-06-07');
    assert.equal(res.transactions[1]?.date, '2026-06-15');
    assert.equal(res.transactions[0]?.amount, 50000);
    assert.equal(res.transactions[1]?.amount, -12000);
  });
});