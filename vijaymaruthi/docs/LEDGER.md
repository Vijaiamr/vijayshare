# LEDGER.md — Ledger System Deep-Dive

> The personal financial ledger: bank-statement import → categorization → budgeting → tax tracking.
> Fully TypeScript since Phase 4 (Python ledger backend deleted). Live code:
> `frontend/app/api/ledger/*` + `frontend/lib/ledger/*`.

---

## 1. Architecture at a glance

```
Upload (.xlsx/.xls/.xlsm/.xlsb/.csv/.txt/.pdf)
   ↓
POST /api/ledger/upload (route.ts)
   ↓
parseUploadedFile (engine.ts)  ← pure, I/O-free, testable
   ├── sniffContentType (delimited.ts) — magic bytes: PDF/XLS/XLSX/text
   ├── parseStandardFile (engine.ts)   — header scoring + column mapping
   ├── parseUPI (upi.ts)               — PhonePe / GPay / Paytm
   ├── parseDelimited / parseFixedWidth (delimited.ts)
   └── parsePDF (pdf.ts)               — pdfjs-dist text extraction
   ↓
categorize (engine.ts) + corrections (db.ts)
   ↓
Two-tier dedup (exact + normalized) against existing rows
   ↓
Persist to Supabase ledger_transactions (owner-scoped) + Storage user-uploads
   ↓
Return full per-user list (re-uploads never blank the UI)
```

**Key principle:** the parsing/categorization engine (`engine.ts`) is a pure function — no I/O — so it's fully unit-testable. All I/O lives in the API routes and `db.ts`.

---

## 2. Supported formats (bank-agnostic)

| Format | Parser | Notes |
|---|---|---|
| UPI exports | `upi.ts` | PhonePe, GPay, Paytm → normalized `[Date, Description, Amount, Dr/Cr]` |
| Delimited | `delimited.ts` | Tab / semicolon / pipe; delimiter auto-detected |
| Fixed-width | `delimited.ts` | `parseFixedWidth` column slicing |
| Dr/Cr indicator | `engine.ts` | `dr|debit|paid|withdrawal|out|expense` → positive; `cr|credit|received|deposit|in|income` → negative |
| Credit cards | `engine.ts` | Standard statement layouts |
| PDF | `pdf.ts` | pdfjs-dist (legacy build, no worker) text extraction → column slicing by header x-positions |
| Excel | `engine.ts` | .xlsx/.xls/.xlsm/.xlsb via magic-byte sniffing |

**Sign convention:** amount > 0 = expense (withdrawal/debit); amount < 0 = income (deposit/credit).

---

## 3. Parsing pipeline (`engine.ts`, ~1000 lines)

### Header scoring
`scoreHeaderRow` scores candidate header rows; boilerplate rows (bank names, addresses, "STATEMENT SUMMARY") get penalties so they're never treated as headers.

### Column mapping
`autoDetectColumns` maps columns by header keywords: date, narration/description, withdrawal/debit, deposit/credit, amount, **balance** (added Phase 3). `ColumnMapping` includes `balance` for the continuity check.

### Date parsing (`parseDateStr`)
- Excel 5-digit serial numbers
- `dd/mm/yy`, `dd-mm-yyyy`, `dd.mm.yyyy`, `dd-mmm-yy`, `yyyy-mm-dd`
- Century heuristic (2-digit years)
- Timezone-safe ISO handling

### Amount parsing (`parseAmount`)
- Parentheses `(3,000)` = negative
- Trailing `-` = negative
- Dr/Cr suffix
- Indian comma grouping `1,42,709.09`

### `looksLikeDate` guard
Rejects totals/summary rows (e.g. HDFC "STATEMENT SUMMARY" row with `130541.94`). **Fixed the HDFC bug**: totals row was being parsed as a bogus transaction (124→123, 386→385 txns; income/expense now exactly match statement summary).

### Balance-continuity self-check
`parseBankStatement` walks rows computing `expected = prevBalance - amount` (amount positive = expense reduces balance), tolerance 0.01. Returns `balanceCheck: { checked: number; mismatches: BalanceMismatch[] }` where `BalanceMismatch = { date, description, amount, expectedBalance, actualBalance }`. Real HDFC files: 0 mismatches.

### Multi-line narration merge
Continuation lines (no date) merge into the previous transaction's description.

### Zero-amount rows
Always dropped — real statements never carry ₹0 transactions. This also prevents random CSVs from fabricating garbage rows via the positional fallback.

---

## 4. Categorization

- `categories.ts`: `CATEGORY_RULES` — 11 categories, ~190 lines, heavily 2026-annotated incl. South-India UPI QR merchants; `FALLBACK_BUDGETS`
- `categorize` (engine.ts): keyword rules; short (≤3 char) keywords are whole-word; UPI "20" space-decoding; learned-correction override via `findBestLearnedMatch` (similarity ≥0.65); personal-transfer heuristic for "PAYMENT FROM PHONE" minus merchant hints
- `extractUpiPayee`: UPI payee extraction
- Rent detection for HRA tax: `isRentPayment` (word-boundary) + `isRentTransaction` (respects rent-like categories)
- `detectRecurring`, `generateInsights`: recurring detection + insights

### Merchant helpers (`merchant.ts`)
- `MERCHANT_ALIASES`, 60+ Indian `CITY_NAMES`
- `detectPaymentMethod`, `normalizeMerchant` (UPI "UPI-MERCHANT-ID@BANK-REF" regex)
- `formatCompactLakh` (₹L/₹K), `formatDisplayDate` (UTC-safe)

### Periods (`period.ts`)
- `PeriodSelection` (monthly/yearly/all) as single source of truth
- `filterTransactionsByPeriod`, `availableMonths/Years`, `defaultPeriod` (latest month), `monthsSpanned` (UTC-normalized for budget math)

---

## 5. Persistence (`db.ts`)

Service-role PostgREST helpers, all owner-scoped (RLS + service-role defense-in-depth):
- `ledger_transactions` — CRUD + month/range scoping with date filters
- `ledger_budgets` — replace-all
- `ledger_corrections` — upsert on_conflict=(owner_id, description); keyed `desc::`/`payee::`
- `getSummary` — aggregated widget data

Uploads also persist the original file to Storage bucket `user-uploads` (path `{userId}/{ts}_{source}_{filename}`) — best-effort, never fails the import.

---

## 6. API endpoints

| Endpoint | Purpose |
|---|---|
| `POST /api/ledger/upload` | Parse → dedup → persist → return full per-user list. 10 MB max, 7 extensions. **422 with clear message when 0 transactions extracted** (never silent 200). |
| `GET/POST/PATCH/DELETE /api/ledger/transactions` | Transaction CRUD |
| `GET /api/ledger/budgets` / replace | Budget read / replace-all |
| `GET /api/ledger/summary` | Aggregated widget data |
| `POST /api/ledger/corrections` | Learn per-user category override |

---

## 7. UI (`components/ledger/`)

- `LedgerApp.tsx` (~530 lines): tabs **Ledger & Dashboard** / **Indian Tax exemption & Rebate Tracker** (`TaxTracker`); KPI cards (Total Income, Total Expenses, Net Savings, Savings Rate); 3-row grid (ChartsDashboard 68% + ExcelImporter 32%, InsightsPanel + BudgetSummary, TransactionTable); empty-state first-run guidance; PeriodSelector; SpendingReport modal; TransactionDrawer; optimistic add/edit/delete with save-status pill (`Saved/Saving.../Unsaved`); edit of categories fires `/api/ledger/corrections` to learn per-user; budget updates replace full list
- Sub-panels: `ExcelImporter`, `TaxTracker`, `TransactionTable`, `TransactionDrawer`, `ChartsDashboard`, `SpendingReport`, `SpendingSnapshot`, `BudgetSummary`, `FinancialHealth`, `InsightsPanel`, `PeriodSelector`, `GlassCard`

---

## 8. Failure handling (verified behavior)

| Scenario | Result |
|---|---|
| Wrong file type | Clear error (400) |
| File > 10 MB | Clear error (413) |
| Corrupt file (parser throws) | Clear error (400) |
| Unrecognized layout / junk / empty | **422 with actionable message** (added 2026) — no more silent empty dashboard |
| Random CSV | 0 transactions (zero-amount rows dropped) — no garbage fabrication |
| Valid statement | Parses + categorizes + dedupes normally |

---

## 9. Tests & verification

- **Runner**: `cd frontend && npm test` (`node --import tsx --test tests/*.test.ts`) — **130 tests, 26 suites**
- **Regression harness**: `tests/fixtures.test.ts` — 13 fixture files in `tests/fixtures/` (hdfc-style, icici-style, sbi-style, upi-phonepe, upi-gpay, upi-paytm, tab-delimited, semicolon, pipe, fixed-width, drcr-indicator, credit-card, pdf-statement) pinning counts/signs/balance
- **Unit tests**: `tests/engine.test.ts` — looksLikeDate, balance column detection, balance continuity (incl. HDFC summary exclusion), random-CSV/junk-binary → 0 transactions
- **Real HDFC verification**: `frontend/scripts/verify-real-statement.ts` against `/Users/vijaykumar/projecs /opencode/Acct Statement_8816_*.xls` — 123 & 385 txns, 0 balance mismatches, income/expense match statement summary exactly
- **Legacy harnesses** (kept for reference): `frontend/scripts/ledger-db-live-test.ts`, `ledger-engine-test.ts`

---

## 10. Schema (Supabase)

`ledger_transactions`, `ledger_budgets`, `ledger_corrections` — owner-scoped RLS. Legacy `sync/ledger_schema.sql` exists but is not actively synced by `sync_to_supabase.py` (ledger data is written directly by the Next.js API routes).