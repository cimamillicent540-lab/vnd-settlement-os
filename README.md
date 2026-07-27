# VND Shadow Pricing & Liquidity OS

The project implements the VND data foundation, real-data reconciliation, shadow pricing, cost allocation, merchant-fee/DCC economics, and a payout execution guard. It is deliberately **Shadow Mode only**: no real quote changes, payments, topups, channel switching, upstream payment submission, or external trading APIs exist.

## Stack

- Next.js App Router, strict TypeScript, Tailwind CSS and shadcn-style UI primitives
- Supabase PostgreSQL with RLS, Zod, decimal.js, SheetJS and Vitest
- UTC for all exact timestamps; date-only business facts remain explicitly `DATE_ONLY`

## Local setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open `http://localhost:3000`. Payout readiness and upstream-format payment preparation are available at `/payment-export`; the daily settlement decision layer is at `/settlement-intelligence`; Phase 1 human feedback and the 90-day learning history are at `/settlement-learning`; the consolidated daily operating view is at `/settlement-control-center`.

Apply Supabase migrations in filename order with the Supabase CLI or dashboard SQL editor. The UI can be previewed without credentials using verified demonstration snapshots; database writes require the three values in `.env.example`.

## Import mapping

The browser accepts `.xlsx`, `.xls` and `.csv`, reads the first worksheet, previews up to 20 validation rows, recognizes Chinese and English header aliases, and asks the operator to confirm mapping. Payin maps imported transaction fee separately from the computed 0.8% fee. Payout stores AR, AS, imported AP, computed AP and AQ without inventing an AQ composition formula. Invalid rows are isolated; duplicate rows use sanitized row fingerprints, while duplicate files use SHA-256.

Names and surnames with no business need are dropped. Card/PAN fields are masked to their last four digits before preview, validation, payload creation or error reporting.

## Payout execution guard

Task 2.6 integrates the approved `Batch Payment Templates_Local (1).xlsx` contract by SHA-256. The generated upload workbook preserves the three upstream sheet names and the exact 19-field payment header. Example payment rows and the dirty trailing country row are never imported.

Full beneficiary details are stored in a restricted RLS table and are masked in ordinary UI/readiness snapshots. Only `admin` and `settlement_operator` roles can prepare files. A database transaction rechecks the latest `READY` result, duplicate exports, and current settleable balance before registering an export. The output file is downloaded for manual review only; `submitted_to_upstream` and `automatic_execution` are constrained to `false`.

Settlement Learning remains append-only and separated from execution. System recommendations, human decisions, adjustment reasons, merchant context, and per-risk judgments are retained as immutable VND learning records for a rolling 90-day analysis window. A recorded manual intent never performs a payment, topup, quote change, or trade.

The Settlement Control Center combines Shadow Pricing, liquidity intelligence, payout-readiness context, and the 90-day learning loop into immutable daily snapshots. Its maximum-inventory warning uses the approved 26,500 × 50,000 USDT base limit. Saving a snapshot or human risk review records audit evidence only and cannot trigger an external action.

To verify or import the approved reference appendices:

```bash
node scripts/import-payment-template-reference.mjs --dry-run
npm run import:payment-template -- "/absolute/path/Batch Payment Templates_Local (1).xlsx"
```

## Settlement intelligence

Task 2.7 keeps current manual `XE_BASE_RATE` and `P2P_COST_RATE` observations separate from immutable historical topup costs. Each approved topup becomes an actual-cost VND inventory batch; date-only topups remain date-only. Forecast cost allocation uses FIFO and reports the batch source, cost rate, and USDT cost basis.

The dashboard aggregates the 16:00–23:00 local liquidity profile, compares forecast Payout against forecast Payin and settleable balance, and recommends a manual topup amount when needed. Customer quote suggestions use `XE + Company Adjustment` with a 0.2% minimum and dynamic target-margin protection. All recommendation and snapshot records constrain automatic payment, topup, quote change, and trading flags to `false`.

## Pool allocation

`allocatePayoutProportionally` uses decimal.js and integer VND. The SQL function `allocate_payout_from_pool` repeats the rule transactionally with row locks. It snapshots active balances before the payout, floors each proportional allocation and assigns all integer residual to the last active bucket. It refuses insufficient balances, never permits a negative bucket, and writes an alert. Only final successful payouts with `completed_at` can be allocated.

## Commands

```bash
npm test
npm run typecheck
npm run build
npm run lint
```
