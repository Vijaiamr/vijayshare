/**
 * Merchant display + formatting unit tests — permanent regression suite.
 * Run with: npm test  (node --import tsx --test tests/*.test.ts)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  titleCase,
  detectPaymentMethod,
  normalizeMerchant,
  formatCompactLakh,
  formatDisplayDate,
} from '../lib/ledger/merchant';
import type { Transaction } from '../lib/ledger/types';

describe('titleCase', () => {
  it('capitalizes words, keeps short words lowercase', () => {
    assert.equal(titleCase('LULU HYPERMARKET'), 'Lulu Hypermarket');
    assert.equal(titleCase('THE BIG BAZAAR'), 'The Big Bazaar');
  });
});

describe('detectPaymentMethod', () => {
  it('detects UPI', () => assert.equal(detectPaymentMethod('UPI/123/Swiggy'), 'UPI'));
  it('detects Paytm', () => assert.equal(detectPaymentMethod('PAYTM/ABC'), 'Paytm'));
  it('detects PhonePe', () => assert.equal(detectPaymentMethod('PHONEPE XYZ'), 'PhonePe'));
  it('detects NEFT', () => assert.equal(detectPaymentMethod('NEFT CREDIT'), 'NEFT'));
  it('detects ATM', () => assert.equal(detectPaymentMethod('ATM WITHDRAWAL'), 'ATM'));
  it('detects Card', () => assert.equal(detectPaymentMethod('CARD PURCHASE'), 'Card'));
  it('falls back to Bank', () => assert.equal(detectPaymentMethod('SOME OTHER'), 'Bank'));
});

describe('normalizeMerchant', () => {
  it('parses UPI merchant segment with canonical alias', () => {
    const m = normalizeMerchant({ description: 'UPI-LULU COIMBATORE-123456@ybl-REF' } as Transaction);
    assert.equal(m.name, 'Lulu Hypermarket');
    assert.ok(m.meta.includes('UPI'));
  });
  it('falls back to payee key', () => {
    const m = normalizeMerchant({ description: 'x', payee: 'swiggy' } as Transaction);
    assert.equal(m.name, 'Swiggy');
  });
  it('falls back to raw description', () => {
    const m = normalizeMerchant({ description: 'Some Raw Text' } as Transaction);
    assert.equal(m.name, 'Some Raw Text');
  });
});

describe('formatCompactLakh', () => {
  it('formats lakhs', () => assert.equal(formatCompactLakh(142709), '₹1.43L'));
  it('formats thousands', () => assert.equal(formatCompactLakh(8500), '₹8.5K'));
  it('formats small values', () => assert.equal(formatCompactLakh(450), '₹450'));
});

describe('formatDisplayDate', () => {
  it('formats YYYY-MM-DD UTC-safe', () => assert.equal(formatDisplayDate('2026-07-31'), '31 Jul 2026'));
  it('passes through invalid input', () => assert.equal(formatDisplayDate('nonsense'), 'nonsense'));
});