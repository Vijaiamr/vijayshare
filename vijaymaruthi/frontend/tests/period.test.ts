/**
 * Ledger period logic unit tests — permanent regression suite.
 * Run with: npm test  (node --import tsx --test tests/*.test.ts)
 *
 * Covers the Phase 2.1 shared monthsSpanned helper (UTC-safe monthly span)
 * plus the period selection/filtering API used across the ledger page.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  monthsSpanned,
  periodLabel,
  periodShortLabel,
  periodDateRange,
  filterTransactionsByPeriod,
  availableMonths,
  availableYears,
  defaultPeriod,
  shiftMonth,
  shiftYear,
} from '../lib/ledger/period';
import type { Transaction } from '../lib/ledger/types';

const tx = (date: string): Transaction => ({ id: date, date, amount: 100, description: 'x', categories: ['Food & Dining'] });

describe('monthsSpanned', () => {
  it('returns 1 for empty input', () => assert.equal(monthsSpanned([]), 1));
  it('returns 1 for a single transaction', () => assert.equal(monthsSpanned([tx('2026-06-07')]), 1));
  it('returns 1 for same-month transactions', () =>
    assert.equal(monthsSpanned([tx('2026-06-01'), tx('2026-06-30')]), 1));
  it('returns 12 for Jan..Dec 2026', () =>
    assert.equal(monthsSpanned([tx('2026-01-05'), tx('2026-12-28')]), 12));
  it('returns 2 across a year boundary', () =>
    assert.equal(monthsSpanned([tx('2025-12-31'), tx('2026-01-01')]), 2));
  it('returns 3 for Mar..May 2026', () =>
    assert.equal(monthsSpanned([tx('2026-03-15'), tx('2026-05-02')]), 3));
  it('returns 1 for invalid dates', () =>
    assert.equal(monthsSpanned([{ ...tx('x'), date: 'nonsense' }]), 1));
  it('normalizes period totals to monthly averages', () => {
    const span = monthsSpanned([tx('2026-01-01'), tx('2026-12-31')]);
    assert.equal(60000 / span, 5000); // 12 months of ₹5,000/mo
  });
});

describe('periodLabel', () => {
  it('labels monthly periods', () => assert.equal(periodLabel({ view: 'monthly', key: '2026-06' }), 'June 2026'));
  it('labels yearly periods', () => assert.equal(periodLabel({ view: 'yearly', key: '2026' }), '2026'));
  it('labels all-time', () => assert.equal(periodLabel({ view: 'all', key: null }), 'All Time'));
});

describe('periodShortLabel', () => {
  it('labels monthly periods short', () => assert.equal(periodShortLabel({ view: 'monthly', key: '2026-06' }), 'Jun 2026'));
  it('labels all-time short', () => assert.equal(periodShortLabel({ view: 'all', key: null }), 'All Time'));
});

describe('periodDateRange', () => {
  it('returns month range', () => {
    const r = periodDateRange({ view: 'monthly', key: '2026-06' });
    assert.deepEqual(r, { start: '2026-06-01', end: '2026-06-30' });
  });
  it('returns year range', () => {
    const r = periodDateRange({ view: 'yearly', key: '2026' });
    assert.deepEqual(r, { start: '2026-01-01', end: '2026-12-31' });
  });
  it('returns null for all-time', () => assert.equal(periodDateRange({ view: 'all', key: null }), null));
});

describe('filterTransactionsByPeriod', () => {
  const txs = [tx('2026-05-15'), tx('2026-06-07'), tx('2026-06-20'), tx('2025-12-31')];
  it('filters to a month', () => {
    const r = filterTransactionsByPeriod(txs, { view: 'monthly', key: '2026-06' });
    assert.equal(r.length, 2);
  });
  it('filters to a year', () => {
    const r = filterTransactionsByPeriod(txs, { view: 'yearly', key: '2026' });
    assert.equal(r.length, 3);
  });
  it('returns everything for all-time', () => {
    const r = filterTransactionsByPeriod(txs, { view: 'all', key: null });
    assert.equal(r.length, 4);
  });
});

describe('availableMonths / availableYears', () => {
  const txs = [tx('2026-05-15'), tx('2026-06-07'), tx('2025-12-31')];
  it('lists months ascending (oldest-first)', () => {
    assert.deepEqual(availableMonths(txs), ['2025-12', '2026-05', '2026-06']);
  });
  it('lists years ascending (oldest-first)', () => {
    assert.deepEqual(availableYears(txs), ['2025', '2026']);
  });
});

describe('defaultPeriod', () => {
  it('defaults to the latest month', () => {
    const p = defaultPeriod([tx('2026-05-15'), tx('2026-06-07')]);
    assert.deepEqual(p, { view: 'monthly', key: '2026-06' });
  });
});

describe('shiftMonth / shiftYear', () => {
  it('shifts months forward/backward', () => {
    assert.equal(shiftMonth('2026-06', 1), '2026-07');
    assert.equal(shiftMonth('2026-01', -1), '2025-12');
    assert.equal(shiftMonth('2026-12', 1), '2027-01');
  });
  it('shifts years', () => {
    assert.equal(shiftYear('2026', 1), '2027');
    assert.equal(shiftYear('2026', -1), '2025');
  });
});