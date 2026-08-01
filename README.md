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

Open `http://localhost:3000`. Payout readiness and upstream-format payment preparation are available at `/payment-export`; the daily settlement decision layer is at `/settlement-intelligence`; Phase 1 human feedback and the 90-day learning history are at `/settlement-learning`; the consolidated daily operating view is at `/settlement-control-center`; frozen VND business rules and the operator confirmation center are at `/business-rules`.

The controlled AI area on `/settlement-intelligence` uses the server-only `OPENAI_API_KEY` when an authenticated `admin` or `settlement_operator` manually triggers it. The model and prompt version are pinned in the repository. If the secret is absent, the endpoint returns a safe `PROVIDER_NOT_CONFIGURED` state and makes no external call. For Cloudflare Workers, configure this value as a runtime secret; never expose it as a `NEXT_PUBLIC_` variable or commit it to an environment file.

Apply Supabase migrations in filename order with the Supabase CLI or dashboard SQL editor. The UI can be previewed without credentials using verified demonstration snapshots; database writes require the three values in `.env.example`.

## Import mapping

The browser accepts `.xlsx`, `.xls` and `.csv`, reads the first worksheet, previews up to 20 validation rows, recognizes Chinese and English header aliases, and asks the operator to confirm mapping. Payin maps imported transaction fee separately from the computed 0.8% fee. Payout stores AR, AS, imported AP, computed AP and AQ without inventing an AQ composition formula. Invalid rows are isolated; duplicate rows use sanitized row fingerprints, while duplicate files use SHA-256.

Names and surnames with no business need are dropped. Card/PAN fields are masked to their last four digits before preview, validation, payload creation or error reporting.

## Payout execution guard

Task 2.6 integrates the approved `Batch Payment Templates_Local (1).xlsx` contract by SHA-256. The generated upload workbook preserves the three upstream sheet names and the exact 19-field payment header. Example payment rows and the dirty trailing country row are never imported.

Full beneficiary details are stored in a restricted RLS table and are masked in ordinary UI/readiness snapshots. Only `admin` and `settlement_operator` roles can prepare files. A database transaction rechecks the latest `READY` result, duplicate exports, and current settleable balance before registering an export. The output file is downloaded for manual review only; `submitted_to_upstream` and `automatic_execution` are constrained to `false`.

Settlement Learning remains append-only and separated from execution. System recommendations, human decisions, adjustment reasons, merchant context, and per-risk judgments are retained as immutable VND learning records for a rolling 90-day analysis window. A recorded manual intent never performs a payment, topup, quote change, or trade.

The Settlement Control Center combines Shadow Pricing, liquidity intelligence, payout-readiness context, and the 90-day learning loop into immutable daily snapshots. Its maximum-inventory warning uses the approved 26,500 × 50,000 USDT base limit. Saving a snapshot or human risk review records audit evidence only and cannot trigger an external action.

Task 2.10 freezes confirmed topup, quote, margin, risk, and automation-stage rules as an immutable version. The operator confirmation center reuses the existing Settlement Learning recommendation and human-decision tables: accept, modify, and reject all require a reason and are retained for the 90-day model window. Stage 2 and Stage 3 remain unimplemented definitions only.

The daily operating view always presents Cash Profit and Economic Profit together. Cash Profit is the finance view based on actual signed revenues and paid fees; Economic Profit adds signed internal-funding advantage and deducts shadow, opportunity, and unrealized-risk costs. Both values and their component snapshot are persisted in new control-center and 90-day learning records. Missing future-cost inputs are marked unavailable rather than invented.

Task 2.11 adds an immutable CEO daily settlement report at `/settlement-daily-report`. It freezes the latest available Account History operating day, balances, actual daily flows, 16:00–23:00 pressure, topup advice, dual profit, merchant contribution, FX and risks. Human-observed outcomes are appended as versions and produce descriptive 90-day topup, quote, profit and risk accuracy statistics; they never optimize or execute decisions automatically.

Task 2.12 adds `/shadow-run-dashboard` as a read-only observation layer over the existing learning, control-center, business-rule, and daily-report evidence. It reports daily recommendation/decision counts and acceptance rates, compares system suggestions with reasoned human outcomes, derives descriptive accuracy and daily-review summaries, and stores immutable human market-context notes. Market notes never affect quotes or trigger financial actions.

Task 2.13 adds `/daily-operation` as the manual daily settlement workflow. It appends immutable 11:00 decision, 16:00 risk-check, and 23:00 review checkpoints, keeps Binance P2P, upstream, and XE observations manual, and links the final reasoned human decision plus Cash/Economic Profit back into the existing 90-day learning records. Every checkpoint remains advisory and cannot pay, top up, change a quote, collect market data, or trade.

Task 2.14 adds `/shadow-validation` for a manually started seven-day validation period. Each completed day links the existing AI recommendation, categorized human decision, 23:00 review, and a new versioned actual outcome; it then preserves topup accuracy, quote adoption, dual-profit error, FX gain evidence, funding pressure, risk accuracy, and an overall descriptive AI Accuracy Score. Periods and daily records are immutable and never optimize or execute actions.

Task 2.15 adds `/ai-decision-score` as a versioned scoring layer over completed Task 2.14 days. It separately evaluates topup quantity/reference cost/FX opportunity, quote profit/competition/transaction risk, dual-profit forecast error, and risk hits/false positives/misses, then applies the frozen 30%/30%/25%/15% overall weighting. Missing evidence stays explicit and no score can trigger or optimize a financial action.

Task 2.16 adds `/approval-center` as a Phase 1 human-approval workflow over immutable AI recommendations. Topup, merchant quote, and risk requests are reviewed only by `admin` or `settlement_operator`; every decision appends a versioned action, catalog reason, free-text explanation, adjustment, and separate Cash/Economic Profit evidence for the 90-day learning loop. Approval records intent only and cannot pay, top up, change a quote, or trade.

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
