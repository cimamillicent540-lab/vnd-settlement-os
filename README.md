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

Open `http://localhost:3000`. Payout readiness and upstream-format payment preparation are available at `/payment-export`.

Apply Supabase migrations in filename order with the Supabase CLI or dashboard SQL editor. The UI can be previewed without credentials using verified demonstration snapshots; database writes require the three values in `.env.example`.

## Import mapping

The browser accepts `.xlsx`, `.xls` and `.csv`, reads the first worksheet, previews up to 20 validation rows, recognizes Chinese and English header aliases, and asks the operator to confirm mapping. Payin maps imported transaction fee separately from the computed 0.8% fee. Payout stores AR, AS, imported AP, computed AP and AQ without inventing an AQ composition formula. Invalid rows are isolated; duplicate rows use sanitized row fingerprints, while duplicate files use SHA-256.

Names and surnames with no business need are dropped. Card/PAN fields are masked to their last four digits before preview, validation, payload creation or error reporting.

## Payout execution guard

Task 2.6 integrates the approved `Batch Payment Templates_Local (1).xlsx` contract by SHA-256. The generated upload workbook preserves the three upstream sheet names and the exact 19-field payment header. Example payment rows and the dirty trailing country row are never imported.

Full beneficiary details are stored in a restricted RLS table and are masked in ordinary UI/readiness snapshots. Only `admin` and `settlement_operator` roles can prepare files. A database transaction rechecks the latest `READY` result, duplicate exports, and current settleable balance before registering an export. The output file is downloaded for manual review only; `submitted_to_upstream` and `automatic_execution` are constrained to `false`.

To verify or import the approved reference appendices:

```bash
node scripts/import-payment-template-reference.mjs --dry-run
npm run import:payment-template -- "/absolute/path/Batch Payment Templates_Local (1).xlsx"
```

## Pool allocation

`allocatePayoutProportionally` uses decimal.js and integer VND. The SQL function `allocate_payout_from_pool` repeats the rule transactionally with row locks. It snapshots active balances before the payout, floors each proportional allocation and assigns all integer residual to the last active bucket. It refuses insufficient balances, never permits a negative bucket, and writes an alert. Only final successful payouts with `completed_at` can be allocated.

## Commands

```bash
npm test
npm run typecheck
npm run build
npm run lint
```
