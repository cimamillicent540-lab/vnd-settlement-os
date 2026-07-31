import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import Decimal from "decimal.js";

import { serverClient } from "./server-data";
import {
  buildSettlementInputSnapshotFromRepository,
  decimalString,
  type BalanceContextRead,
  type BalancePosition,
  type BuildSettlementInputSnapshotOptions,
  type FxContextRead,
  type FxRateInput,
  type HourlyLiquidityInput,
  type InventoryBatchInput,
  type InventoryContextRead,
  type LiquidityContextRead,
  type MarketContextInput,
  type MerchantContextInput,
  type ProfitContextRead,
  type ProfitMetricInput,
  type QuoteAdjustmentInput,
  type SettlementInputSnapshot,
  type SettlementReadBoundary,
  type SettlementReadEnvelope,
  type SettlementSnapshotReadRepository,
} from "./settlement-input-snapshot";

type DatabaseRow = Record<string, unknown>;

const PAGE_SIZE = 1_000;
const MAX_LIQUIDITY_PAGES = 100;

function queryData<T>(
  result: { data: T | null; error: unknown },
  code: string,
): T {
  if (result.error) throw new Error(`${code}_QUERY_FAILED`);
  if (result.data === null) throw new Error(`${code}_DATA_MISSING`);
  return result.data;
}

function queryRows(
  result: { data: unknown[] | null; error: unknown },
  code: string,
) {
  return queryData(result, code) as DatabaseRow[];
}

function queryRow(
  result: { data: unknown | null; error: unknown },
  code: string,
) {
  if (result.error) throw new Error(`${code}_QUERY_FAILED`);
  return (result.data ?? null) as DatabaseRow | null;
}

function value(row: DatabaseRow | null, field: string) {
  return row?.[field] ?? null;
}

function nullableString(input: unknown) {
  return input === null || input === undefined ? null : String(input);
}

function booleanValue(input: unknown) {
  return input === true;
}

function timestampValue(input: unknown) {
  const candidate = nullableString(input);
  if (!candidate) return null;
  const parsed = Date.parse(candidate);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function localDateStartUtc(localDate: string) {
  return new Date(`${localDate}T00:00:00+08:00`).toISOString();
}

function localDateEndUtc(localDate: string) {
  return new Date(`${localDate}T23:59:59.999+08:00`).toISOString();
}

function localHour(timestamp: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(timestamp));
  return Number(parts.find((part) => part.type === "hour")?.value ?? 0);
}

function localDate(timestamp: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(timestamp));
  const fields = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${fields.year}-${fields.month}-${fields.day}`;
}

function latestTimestamp(values: Array<string | null>) {
  return values
    .filter((item): item is string => Boolean(item))
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0] ?? null;
}

function latestDatedRow(
  rows: DatabaseRow[],
  timestampField: string,
  dateField: string,
) {
  return [...rows].sort((left, right) => {
    const leftValue =
      timestampValue(left[timestampField]) ??
      (left[dateField]
        ? localDateStartUtc(String(left[dateField]))
        : "1970-01-01T00:00:00.000Z");
    const rightValue =
      timestampValue(right[timestampField]) ??
      (right[dateField]
        ? localDateStartUtc(String(right[dateField]))
        : "1970-01-01T00:00:00.000Z");
    return Date.parse(rightValue) - Date.parse(leftValue);
  })[0] ?? null;
}

function chooseBalancePosition(input: {
  boundary: SettlementReadBoundary;
  account: DatabaseRow | null;
  ledger: DatabaseRow | null;
  opening: DatabaseRow | null;
  topupCutoffDate: string | null;
  payoutCutoffAt: string | null;
  reconciliationStatus: string | null;
}): BalancePosition | null {
  const accountAt = timestampValue(value(input.account, "transaction_time"));
  const accountLocalDate = nullableString(
    value(input.account, "source_local_time"),
  )?.slice(0, 10);
  const ledgerAt = timestampValue(value(input.ledger, "event_time"));
  const ledgerDate = nullableString(value(input.ledger, "event_date"));
  const ledgerIsNewer =
    input.ledger &&
    (ledgerAt
      ? !accountAt || Date.parse(ledgerAt) >= Date.parse(accountAt)
      : Boolean(
          ledgerDate &&
            (!accountLocalDate || ledgerDate > accountLocalDate),
        ));

  if (
    ledgerIsNewer &&
    value(input.ledger, "gross_balance_after_vnd") !== null &&
    value(input.ledger, "settleable_balance_after_vnd") !== null
  ) {
    return {
      as_of: input.boundary.asOf,
      balance_source: "POOL_LEDGER_ACTIVE",
      gross_balance_vnd: decimalString(
        value(input.ledger, "gross_balance_after_vnd"),
      ),
      reserve_ratio: decimalString(
        value(input.ledger, "reserve_ratio"),
        "0.50",
      ),
      reserve_balance_vnd: decimalString(
        value(input.ledger, "reserve_balance_after_vnd"),
      ),
      settleable_ratio: decimalString(
        value(input.ledger, "settleable_ratio"),
        "0.50",
      ),
      settleable_balance_vnd: decimalString(
        value(input.ledger, "settleable_balance_after_vnd"),
      ),
      account_history_cutoff_at: accountAt,
      account_history_cutoff_local: nullableString(
        value(input.account, "source_local_time"),
      ),
      account_history_timezone: nullableString(
        value(input.account, "source_timezone"),
      ),
      topup_cutoff_date: input.topupCutoffDate,
      payout_cutoff_at: input.payoutCutoffAt,
      reconciliation_status: input.reconciliationStatus,
    };
  }

  if (
    input.account &&
    value(input.account, "gross_balance_after_vnd") !== null &&
    value(input.account, "settleable_balance_vnd") !== null
  ) {
    return {
      as_of: input.boundary.asOf,
      balance_source: "ACCOUNT_HISTORY",
      gross_balance_vnd: decimalString(
        value(input.account, "gross_balance_after_vnd"),
      ),
      reserve_ratio: decimalString(
        value(input.account, "reserve_ratio"),
        "0.50",
      ),
      reserve_balance_vnd: decimalString(
        value(input.account, "reserve_amount_vnd"),
      ),
      settleable_ratio: decimalString(
        value(input.account, "settleable_ratio"),
        "0.50",
      ),
      settleable_balance_vnd: decimalString(
        value(input.account, "settleable_balance_vnd"),
      ),
      account_history_cutoff_at: accountAt,
      account_history_cutoff_local: nullableString(
        value(input.account, "source_local_time"),
      ),
      account_history_timezone: nullableString(
        value(input.account, "source_timezone"),
      ),
      topup_cutoff_date: input.topupCutoffDate,
      payout_cutoff_at: input.payoutCutoffAt,
      reconciliation_status: input.reconciliationStatus,
    };
  }

  if (input.opening) {
    return {
      as_of: input.boundary.asOf,
      balance_source: "APPROVED_OPENING_BALANCE",
      gross_balance_vnd: decimalString(
        value(input.opening, "gross_opening_balance_vnd"),
      ),
      reserve_ratio: decimalString(
        value(input.opening, "reserve_ratio"),
        "0.50",
      ),
      reserve_balance_vnd: decimalString(
        value(input.opening, "reserve_opening_balance_vnd"),
      ),
      settleable_ratio: decimalString(
        value(input.opening, "settleable_ratio"),
        "0.50",
      ),
      settleable_balance_vnd: decimalString(
        value(input.opening, "settleable_opening_balance_vnd"),
      ),
      account_history_cutoff_at: accountAt,
      account_history_cutoff_local: nullableString(
        value(input.account, "source_local_time"),
      ),
      account_history_timezone: nullableString(
        value(input.account, "source_timezone"),
      ),
      topup_cutoff_date: input.topupCutoffDate,
      payout_cutoff_at: input.payoutCutoffAt,
      reconciliation_status: input.reconciliationStatus,
    };
  }

  return null;
}

function accountHistoryIsPartial(
  account: DatabaseRow | null,
  topupCutoffDate: string | null,
  payoutCutoffAt: string | null,
) {
  const accountAt = timestampValue(value(account, "transaction_time"));
  const accountLocal = nullableString(value(account, "source_local_time"));
  const accountDate = accountLocal?.slice(0, 10) ?? null;
  return Boolean(
    (accountDate &&
      topupCutoffDate &&
      topupCutoffDate > accountDate) ||
      (accountAt &&
        payoutCutoffAt &&
        Date.parse(payoutCutoffAt) > Date.parse(accountAt)),
  );
}

async function readBalanceContext(
  db: SupabaseClient,
  boundary: SettlementReadBoundary,
): Promise<SettlementReadEnvelope<BalanceContextRead>> {
  const observedAt = new Date().toISOString();
  const [
    accountResult,
    exactLedgerResult,
    dateOnlyLedgerResult,
    openingResult,
    reconciliationResult,
    exactTopupResult,
    dateOnlyTopupResult,
    payoutResult,
  ] = await Promise.all([
    db
      .from("account_history_entries")
      .select(
        "id,transaction_time,source_local_time,source_timezone,source_row_number,gross_balance_after_vnd,reserve_ratio,reserve_amount_vnd,settleable_ratio,settleable_balance_vnd,balance_validation_status,continuity_status",
      )
      .eq("currency", "VND")
      .lte("transaction_time", boundary.asOf)
      .order("transaction_time", { ascending: false })
      .order("source_row_number", { ascending: true })
      .limit(1)
      .maybeSingle(),
    db
      .from("pool_ledger_entries")
      .select(
        "id,event_time,event_date,time_precision,event_type,gross_balance_after_vnd,reserve_ratio,reserve_balance_after_vnd,settleable_ratio,settleable_balance_after_vnd,model_version",
      )
      .eq("record_status", "ACTIVE")
      .not("event_time", "is", null)
      .lte("event_time", boundary.asOf)
      .order("event_time", { ascending: false })
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle(),
    db
      .from("pool_ledger_entries")
      .select(
        "id,event_time,event_date,time_precision,event_type,gross_balance_after_vnd,reserve_ratio,reserve_balance_after_vnd,settleable_ratio,settleable_balance_after_vnd,model_version",
      )
      .eq("record_status", "ACTIVE")
      .is("event_time", null)
      .lt("event_date", boundary.localDate)
      .order("event_date", { ascending: false })
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle(),
    db
      .from("opening_balances")
      .select(
        "id,effective_at,gross_opening_balance_vnd,reserve_ratio,reserve_opening_balance_vnd,settleable_ratio,settleable_opening_balance_vnd,approval_status,model_version",
      )
      .eq("currency", "VND")
      .eq("approval_status", "APPROVED")
      .lte("effective_at", boundary.asOf)
      .order("effective_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle(),
    db
      .from("reconciliation_runs")
      .select("id,started_at,completed_at,status,record_status")
      .eq("record_status", "ACTIVE")
      .lte("started_at", boundary.asOf)
      .order("started_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle(),
    db
      .from("topup_batches")
      .select("id,execution_date,executed_at,time_precision")
      .not("executed_at", "is", null)
      .lte("executed_at", boundary.asOf)
      .order("executed_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle(),
    db
      .from("topup_batches")
      .select("id,execution_date,executed_at,time_precision")
      .is("executed_at", null)
      .lt("execution_date", boundary.localDate)
      .order("execution_date", { ascending: false })
      .order("sequence_within_date", { ascending: false })
      .limit(1)
      .maybeSingle(),
    db
      .from("payout_orders")
      .select("id,completed_at")
      .eq("currency", "VND")
      .not("completed_at", "is", null)
      .lte("completed_at", boundary.asOf)
      .order("completed_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const account = queryRow(accountResult, "ACCOUNT_HISTORY_POSITION");
  const ledger = latestDatedRow(
    [
      queryRow(exactLedgerResult, "POOL_LEDGER_EXACT"),
      queryRow(dateOnlyLedgerResult, "POOL_LEDGER_DATE_ONLY"),
    ].filter((row): row is DatabaseRow => Boolean(row)),
    "event_time",
    "event_date",
  );
  const opening = queryRow(openingResult, "OPENING_BALANCE");
  const reconciliation = queryRow(
    reconciliationResult,
    "RECONCILIATION",
  );
  const topup = latestDatedRow(
    [
      queryRow(exactTopupResult, "TOPUP_EXACT"),
      queryRow(dateOnlyTopupResult, "TOPUP_DATE_ONLY"),
    ].filter((row): row is DatabaseRow => Boolean(row)),
    "executed_at",
    "execution_date",
  );
  const payout = queryRow(payoutResult, "PAYOUT_CUTOFF");
  const topupCutoffDate = nullableString(value(topup, "execution_date"));
  const payoutCutoffAt = timestampValue(value(payout, "completed_at"));
  const position = chooseBalancePosition({
    boundary,
    account,
    ledger,
    opening,
    topupCutoffDate,
    payoutCutoffAt,
    reconciliationStatus: nullableString(value(reconciliation, "status")),
  });
  const partial = accountHistoryIsPartial(
    account,
    topupCutoffDate,
    payoutCutoffAt,
  );
  const accountCutoff = timestampValue(value(account, "transaction_time"));
  const ledgerCutoff = timestampValue(value(ledger, "event_time"));
  const openingCutoff = timestampValue(value(opening, "effective_at"));
  const cutoffAt = latestTimestamp([
    accountCutoff,
    ledgerCutoff,
    openingCutoff,
  ]);
  const limitations = [
    ...(partial ? ["PARTIAL_AFTER_ACCOUNT_HISTORY_CUTOFF"] : []),
    ...(ledger && value(ledger, "event_time") === null
      ? ["DATE_ONLY_LEDGER_POSITION"]
      : []),
    ...(!position ? ["BALANCE_POSITION_MISSING"] : []),
  ];

  return {
    data: { position },
    observedAt,
    cutoffAt,
    recordCount: [account, ledger, opening, reconciliation, topup, payout].filter(
      Boolean,
    ).length,
    completenessStatus: !position
      ? "UNAVAILABLE"
      : partial
        ? "PARTIAL_AFTER_ACCOUNT_HISTORY_CUTOFF"
        : "COMPLETE",
    limitations,
  };
}

async function readLiquidityRows(
  db: SupabaseClient,
  boundary: SettlementReadBoundary,
) {
  const rows: DatabaseRow[] = [];
  let pageLimitReached = false;
  for (let page = 0; page < MAX_LIQUIDITY_PAGES; page += 1) {
    const start = page * PAGE_SIZE;
    const result = await db
      .from("account_history_entries")
      .select(
        "id,transaction_time,source_row_number,event_type,gross_change_vnd",
      )
      .eq("currency", "VND")
      .in("event_type", ["PAYIN_INFLOW", "PAYOUT_OUTFLOW"])
      .gte("transaction_time", boundary.historyWindowStart)
      .lte("transaction_time", boundary.asOf)
      .order("transaction_time", { ascending: true })
      .order("source_row_number", { ascending: false })
      .range(start, start + PAGE_SIZE - 1);
    const pageRows = queryRows(result, "LIQUIDITY_HISTORY");
    rows.push(...pageRows);
    if (pageRows.length < PAGE_SIZE) break;
    if (page === MAX_LIQUIDITY_PAGES - 1) pageLimitReached = true;
  }
  return { rows, pageLimitReached };
}

function aggregateLiquidity(
  rows: DatabaseRow[],
  boundary: SettlementReadBoundary,
): LiquidityContextRead {
  const dates = new Set(
    rows
      .map((row) => timestampValue(row.transaction_time))
      .filter((item): item is string => Boolean(item))
      .map(localDate),
  );
  const observedDays = dates.size;
  const buckets = Array.from({ length: 24 }, () => ({
    payin: new Decimal(0),
    payout: new Decimal(0),
  }));
  for (const row of rows) {
    const transactionTime = timestampValue(row.transaction_time);
    if (!transactionTime) continue;
    const hour = localHour(transactionTime);
    const amount = new Decimal(decimalString(row.gross_change_vnd));
    if (String(row.event_type) === "PAYIN_INFLOW") {
      buckets[hour].payin = buckets[hour].payin.plus(amount);
    } else if (String(row.event_type) === "PAYOUT_OUTFLOW") {
      buckets[hour].payout = buckets[hour].payout.plus(amount);
    }
  }
  const denominator = new Decimal(Math.max(observedDays, 1));
  const totalPayout = buckets.reduce(
    (sum, bucket) => sum.plus(bucket.payout),
    new Decimal(0),
  );
  const hourlyForecast: HourlyLiquidityInput[] = buckets.map(
    (bucket, hour) => {
      const payin = bucket.payin.div(denominator);
      const payout = bucket.payout.div(denominator);
      return {
        local_hour: hour,
        observed_days: observedDays,
        forecast_payin_vnd: payin.toFixed(2),
        forecast_payout_vnd: payout.toFixed(2),
        forecast_net_demand_vnd: Decimal.max(
          payout.minus(payin),
          0,
        ).toFixed(2),
        is_peak_window: hour >= 16 && hour <= 23,
        payout_concentration_ratio: totalPayout.gt(0)
          ? bucket.payout.div(totalPayout).toFixed(12)
          : "0.000000000000",
      };
    },
  );
  const forecastPayin = hourlyForecast.reduce(
    (sum, row) => sum.plus(row.forecast_payin_vnd),
    new Decimal(0),
  );
  const forecastPayout = hourlyForecast.reduce(
    (sum, row) => sum.plus(row.forecast_payout_vnd),
    new Decimal(0),
  );

  return {
    historical_window_days: 90,
    history_window_start: boundary.historyWindowStart,
    history_window_end: boundary.asOf,
    forecast_window_start: localDateStartUtc(boundary.localDate),
    forecast_window_end: localDateEndUtc(boundary.localDate),
    forecast_payin_vnd: forecastPayin.toFixed(2),
    forecast_payout_vnd: forecastPayout.toFixed(2),
    forecast_net_demand_vnd: Decimal.max(
      forecastPayout.minus(forecastPayin),
      0,
    ).toFixed(2),
    peak_window: "16:00-23:00",
    hourly_forecast: hourlyForecast,
    forecast_method: "HISTORICAL_HOURLY_AVERAGE_INPUT_V1",
    forecast_version: "SETTLEMENT_READ_AGGREGATION_V1",
  };
}

async function readLiquidityContext(
  db: SupabaseClient,
  boundary: SettlementReadBoundary,
): Promise<SettlementReadEnvelope<LiquidityContextRead>> {
  const observedAt = new Date().toISOString();
  const { rows, pageLimitReached } = await readLiquidityRows(db, boundary);
  const cutoffAt = latestTimestamp(
    rows.map((row) => timestampValue(row.transaction_time)),
  );
  return {
    data: aggregateLiquidity(rows, boundary),
    observedAt,
    cutoffAt,
    recordCount: rows.length,
    completenessStatus:
      rows.length === 0
        ? "UNAVAILABLE"
        : pageLimitReached
          ? "PARTIAL"
          : "COMPLETE",
    limitations: [
      ...(rows.length === 0 ? ["LIQUIDITY_HISTORY_EMPTY"] : []),
      ...(pageLimitReached ? ["LIQUIDITY_PAGE_LIMIT_REACHED"] : []),
    ],
  };
}

function mapInventoryBatch(row: DatabaseRow): InventoryBatchInput {
  return {
    id: String(row.id),
    topup_batch_id: nullableString(row.topup_batch_id),
    batch_time: timestampValue(row.batch_time),
    batch_date: String(row.batch_date),
    time_precision:
      row.time_precision === "EXACT" ? "EXACT" : "DATE_ONLY",
    usdt_amount: decimalString(row.usdt_amount),
    vnd_amount: decimalString(row.vnd_amount),
    cost_rate: decimalString(row.cost_rate),
    source: String(row.source),
    remaining_amount: decimalString(row.remaining_amount),
    remaining_ratio: decimalString(row.remaining_ratio),
    cost_source_type: String(row.cost_source_type),
    historical_cost_locked: booleanValue(row.historical_cost_locked),
    status: String(row.status),
    model_version: String(row.model_version),
  };
}

async function readInventoryContext(
  db: SupabaseClient,
  boundary: SettlementReadBoundary,
): Promise<SettlementReadEnvelope<InventoryContextRead>> {
  const observedAt = new Date().toISOString();
  const selection =
    "id,topup_batch_id,batch_time,batch_date,time_precision,usdt_amount,vnd_amount,cost_rate,source,remaining_amount,remaining_ratio,cost_source_type,historical_cost_locked,status,model_version,shadow_mode";
  const [exactResult, dateOnlyResult] = await Promise.all([
    db
      .from("vnd_inventory_positions")
      .select(selection)
      .gt("remaining_amount", 0)
      .not("batch_time", "is", null)
      .lte("batch_time", boundary.asOf)
      .order("batch_time", { ascending: true })
      .order("id", { ascending: true }),
    db
      .from("vnd_inventory_positions")
      .select(selection)
      .gt("remaining_amount", 0)
      .is("batch_time", null)
      .lt("batch_date", boundary.localDate)
      .order("batch_date", { ascending: true })
      .order("id", { ascending: true }),
  ]);
  const rows = [
    ...queryRows(exactResult, "INVENTORY_EXACT"),
    ...queryRows(dateOnlyResult, "INVENTORY_DATE_ONLY"),
  ].sort((left, right) => {
    const dateOrder = String(left.batch_date).localeCompare(
      String(right.batch_date),
    );
    if (dateOrder !== 0) return dateOrder;
    const timeOrder = String(left.batch_time ?? "").localeCompare(
      String(right.batch_time ?? ""),
    );
    return timeOrder !== 0
      ? timeOrder
      : String(left.id).localeCompare(String(right.id));
  });
  const batches = rows.map(mapInventoryBatch);
  const totalRemaining = batches.reduce(
    (sum, batch) => sum.plus(batch.remaining_amount),
    new Decimal(0),
  );
  const hasDateOnly = batches.some(
    (batch) => batch.time_precision === "DATE_ONLY",
  );
  const cutoffAt = latestTimestamp(
    batches.map((batch) => batch.batch_time),
  );
  return {
    data: {
      cost_method: "FIFO_ACTUAL_TOPUP_V1",
      position_as_of: boundary.asOf,
      total_remaining_vnd: totalRemaining.toFixed(2),
      batches,
      unmatched_inventory_status:
        rows.length > 0 ? "COMPLETE" : "LIMITED",
    },
    observedAt,
    cutoffAt,
    recordCount: rows.length,
    completenessStatus:
      rows.length === 0 ? "PARTIAL" : hasDateOnly ? "PARTIAL" : "COMPLETE",
    limitations: [
      ...(rows.length === 0 ? ["INVENTORY_POSITION_EMPTY"] : []),
      ...(hasDateOnly ? ["INVENTORY_CUTOFF_DATE_ONLY"] : []),
      "INVENTORY_POSITION_VIEW_NOT_HISTORICALLY_VERSIONED",
    ],
  };
}

function mapFxRate(
  row: DatabaseRow | null,
  rateType: FxRateInput["rate_type"],
): FxRateInput | null {
  if (!row) return null;
  const recordTime = timestampValue(row.record_time);
  if (!recordTime) return null;
  return {
    id: String(row.id),
    rate_type: rateType,
    rate_value: decimalString(row.rate_value),
    source: String(row.source),
    record_time: recordTime,
    operator_id: nullableString(row.operator),
  };
}

async function readFxContext(
  db: SupabaseClient,
  boundary: SettlementReadBoundary,
): Promise<SettlementReadEnvelope<FxContextRead>> {
  const observedAt = new Date().toISOString();
  const [xeResult, p2pResult, adjustmentResult] = await Promise.all([
    db
      .from("fx_market_inputs")
      .select("id,rate_value,source,record_time,operator")
      .eq("currency", "VND")
      .eq("rate_type", "XE_BASE_RATE")
      .lte("record_time", boundary.asOf)
      .order("record_time", { ascending: false })
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle(),
    db
      .from("fx_market_inputs")
      .select("id,rate_value,source,record_time,operator")
      .eq("currency", "VND")
      .eq("rate_type", "P2P_COST_RATE")
      .lte("record_time", boundary.asOf)
      .order("record_time", { ascending: false })
      .order("id", { ascending: false })
      .limit(20),
    db
      .from("quote_adjustment_rules")
      .select(
        "id,base_source,adjustment,reason,effective_time,operator,status",
      )
      .eq("currency", "VND")
      .eq("base_source", "XE")
      .eq("status", "ACTIVE")
      .lte("effective_time", boundary.asOf)
      .order("effective_time", { ascending: false })
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const xe = mapFxRate(
    queryRow(xeResult, "FX_XE_RATE"),
    "XE_BASE_RATE",
  );
  const p2p = queryRows(p2pResult, "FX_P2P_RATE")
    .map((row) => mapFxRate(row, "P2P_COST_RATE"))
    .filter((row): row is FxRateInput => Boolean(row));
  const adjustmentRow = queryRow(
    adjustmentResult,
    "QUOTE_ADJUSTMENT",
  );
  const quoteAdjustment: QuoteAdjustmentInput | null = adjustmentRow
    ? {
        id: String(adjustmentRow.id),
        base_source: String(adjustmentRow.base_source),
        adjustment: decimalString(adjustmentRow.adjustment),
        reason: String(adjustmentRow.reason),
        effective_time:
          timestampValue(adjustmentRow.effective_time) ?? boundary.asOf,
        operator_id: nullableString(adjustmentRow.operator),
        status: String(adjustmentRow.status),
      }
    : null;
  const cutoffAt = latestTimestamp([
    xe?.record_time ?? null,
    ...p2p.map((row) => row.record_time),
  ]);
  const limitations = [
    ...(!xe ? ["XE_RATE_MISSING"] : []),
    ...(p2p.length === 0 ? ["P2P_COST_RATE_MISSING"] : []),
  ];
  return {
    data: {
      xe_rate: xe,
      p2p_cost_rates: p2p,
      upstream_quote_rate: null,
      current_customer_quote_rate: null,
      quote_adjustment: quoteAdjustment,
    },
    observedAt,
    cutoffAt,
    recordCount: Number(Boolean(xe)) + p2p.length + Number(Boolean(quoteAdjustment)),
    completenessStatus: limitations.length > 0 ? "PARTIAL" : "COMPLETE",
    limitations,
  };
}

function mapMerchant(row: DatabaseRow): MerchantContextInput {
  return {
    merchant_name: String(row.merchant_name),
    payout_count: decimalString(row.payout_count),
    channel_count: decimalString(row.channel_count),
    transaction_volume_usdt: decimalString(row.transaction_volume_usdt),
    contribution_usdt: decimalString(row.contribution_usdt),
    current_quote_rate:
      row.current_quote_rate === null
        ? null
        : decimalString(row.current_quote_rate),
    current_profit_margin:
      row.current_profit_margin === null
        ? null
        : decimalString(row.current_profit_margin),
    merchant_fee_rate_on_principal:
      row.merchant_fee_rate === null
        ? null
        : decimalString(row.merchant_fee_rate),
    source_rules_version: String(row.source_rules_version),
    source_run_time:
      timestampValue(row.source_run_time) ?? "1970-01-01T00:00:00.000Z",
  };
}

async function readMerchantContexts(
  db: SupabaseClient,
  boundary: SettlementReadBoundary,
): Promise<SettlementReadEnvelope<MerchantContextInput[]>> {
  const observedAt = new Date().toISOString();
  const result = await db
    .from("settlement_control_center_merchant_baseline")
    .select(
      "merchant_name,payout_count,channel_count,transaction_volume_usdt,contribution_usdt,current_quote_rate,current_profit_margin,merchant_fee_rate,source_rules_version,source_run_time",
    )
    .lte("source_run_time", boundary.asOf)
    .order("transaction_volume_usdt", { ascending: false })
    .order("merchant_name", { ascending: true });
  const merchants = queryRows(result, "MERCHANT_CONTEXT").map(mapMerchant);
  return {
    data: merchants,
    observedAt,
    cutoffAt: latestTimestamp(
      merchants.map((merchant) => merchant.source_run_time),
    ),
    recordCount: merchants.length,
    completenessStatus: merchants.length > 0 ? "COMPLETE" : "PARTIAL",
    limitations:
      merchants.length > 0
        ? ["MERCHANT_BASELINE_VIEW_USES_LATEST_RUN"]
        : ["MERCHANT_CONTEXT_EMPTY"],
  };
}

function mapProfitMetric(row: DatabaseRow): ProfitMetricInput {
  return {
    pricing_run_id: String(row.pricing_run_id),
    pricing_rules_version: String(row.pricing_rules_version),
    pricing_run_time:
      timestampValue(row.pricing_run_time) ??
      "1970-01-01T00:00:00.000Z",
    profit_date: String(row.profit_date),
    payout_count: decimalString(row.payout_count),
    merchant_principal_usdt: decimalString(row.merchant_principal_usdt),
    merchant_fee_revenue_usdt: decimalString(
      row.merchant_fee_revenue_usdt,
    ),
    signed_dcc_revenue_usdt: decimalString(row.dcc_revenue_usdt),
    realized_fx_profit_usdt: decimalString(row.realized_fx_profit_usdt),
    channel_fees_usdt: decimalString(row.channel_fees_usdt),
    other_actual_fees_usdt: decimalString(row.other_actual_fees_usdt),
    cash_profit_usdt: decimalString(row.cash_profit_usdt),
    cash_profit_margin:
      row.cash_profit_margin === null
        ? null
        : decimalString(row.cash_profit_margin),
    signed_internal_funding_advantage_usdt: decimalString(
      row.internal_funding_advantage_usdt,
    ),
    shadow_cost_usdt: decimalString(row.shadow_cost_usdt),
    opportunity_cost_usdt: decimalString(row.opportunity_cost_usdt),
    unrealized_risk_cost_usdt: decimalString(
      row.unrealized_risk_cost_usdt,
    ),
    economic_profit_usdt: decimalString(row.economic_profit_usdt),
    economic_profit_margin:
      row.economic_profit_margin === null
        ? null
        : decimalString(row.economic_profit_margin),
    data_status: String(row.profit_data_status),
  };
}

async function readProfitContext(
  db: SupabaseClient,
  boundary: SettlementReadBoundary,
): Promise<SettlementReadEnvelope<ProfitContextRead>> {
  const observedAt = new Date().toISOString();
  const result = await db
    .from("settlement_daily_profit_dual_metrics")
    .select(
      "pricing_run_id,pricing_rules_version,pricing_run_time,profit_date,payout_count,merchant_principal_usdt,merchant_fee_revenue_usdt,dcc_revenue_usdt,realized_fx_profit_usdt,channel_fees_usdt,other_actual_fees_usdt,cash_profit_usdt,cash_profit_margin,internal_funding_advantage_usdt,shadow_cost_usdt,opportunity_cost_usdt,unrealized_risk_cost_usdt,economic_profit_usdt,economic_profit_margin,profit_data_status",
    )
    .lte("pricing_run_time", boundary.asOf)
    .lte("profit_date", boundary.localDate)
    .order("profit_date", { ascending: false })
    .limit(90);
  const metrics = queryRows(result, "PROFIT_CONTEXT").map(mapProfitMetric);
  return {
    data: { daily_metrics: metrics },
    observedAt,
    cutoffAt: latestTimestamp(
      metrics.map((metric) => metric.pricing_run_time),
    ),
    recordCount: metrics.length,
    completenessStatus: metrics.length > 0 ? "COMPLETE" : "PARTIAL",
    limitations:
      metrics.length > 0
        ? ["PROFIT_VIEW_USES_LATEST_IMMUTABLE_PRICING_RUN"]
        : ["PROFIT_CONTEXT_EMPTY"],
  };
}

function mapMarketContext(row: DatabaseRow): MarketContextInput {
  return {
    id: String(row.id),
    context_date: String(row.context_date),
    observed_at:
      timestampValue(row.observed_at) ?? "1970-01-01T00:00:00.000Z",
    context_category: String(row.context_category),
    severity: String(row.severity),
    title: String(row.title),
    observation_reason: String(row.observation_reason),
    evidence_reference: nullableString(row.evidence_reference),
    shadow_mode: true,
    quote_impact_applied: false,
    automatic_action: false,
  };
}

async function readMarketContext(
  db: SupabaseClient,
  boundary: SettlementReadBoundary,
): Promise<SettlementReadEnvelope<MarketContextInput[]>> {
  const observedAt = new Date().toISOString();
  const result = await db
    .from("shadow_run_market_context_notes")
    .select(
      "id,context_date,observed_at,context_category,severity,title,observation_reason,evidence_reference,shadow_mode,quote_impact_applied,automatic_action",
    )
    .eq("currency", "VND")
    .lte("observed_at", boundary.asOf)
    .order("observed_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(100);
  const notes = queryRows(result, "MARKET_CONTEXT").map(mapMarketContext);
  return {
    data: notes,
    observedAt,
    cutoffAt: latestTimestamp(notes.map((note) => note.observed_at)),
    recordCount: notes.length,
    completenessStatus: "COMPLETE",
    limitations: [],
  };
}

export function createSupabaseSettlementSnapshotReadRepository(
  db: SupabaseClient,
): SettlementSnapshotReadRepository {
  return {
    readBalanceContext: (boundary) => readBalanceContext(db, boundary),
    readLiquidityContext: (boundary) =>
      readLiquidityContext(db, boundary),
    readInventoryContext: (boundary) =>
      readInventoryContext(db, boundary),
    readFxContext: (boundary) => readFxContext(db, boundary),
    readMerchantContexts: (boundary) =>
      readMerchantContexts(db, boundary),
    readProfitContext: (boundary) => readProfitContext(db, boundary),
    readMarketContext: (boundary) => readMarketContext(db, boundary),
  };
}

export async function buildSettlementInputSnapshot(
  options: BuildSettlementInputSnapshotOptions,
): Promise<SettlementInputSnapshot> {
  const repository = createSupabaseSettlementSnapshotReadRepository(
    serverClient(),
  );
  return buildSettlementInputSnapshotFromRepository(options, repository);
}
