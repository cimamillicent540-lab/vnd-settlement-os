import "server-only";

import { createClient } from "@supabase/supabase-js";

import {
  allocateFifoInventory,
  buildSettlementRiskAlerts,
  calculateFxIntelligence,
  forecastProfit,
  recommendCustomerQuote,
  recommendTargetMargin,
  recommendTopup,
  SHADOW_MODE_GUARD,
  summarizePeakWindow,
  type HourlyLiquidityRow,
  type VndInventoryBatch,
} from "./settlement-intelligence";
import { normalizeSupabaseUrl } from "./supabase-url";

export function serverClient() {
  const configured = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret =
    process.env.SUPABASE_SECRET_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!configured || !secret) {
    throw new Error("Supabase server configuration is missing");
  }
  const url = normalizeSupabaseUrl(configured);
  if (!url) throw new Error("Supabase URL is invalid");
  return createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function getImportBatches() {
  const { data, error } = await serverClient()
    .from("import_batches")
    .select(
      "id,source_type,original_file_name,imported_at,total_rows,valid_rows,invalid_rows,duplicate_rows,status",
    )
    .order("imported_at", { ascending: false });
  if (error) throw error;
  return data;
}

export async function getTopups() {
  const { data, error } = await serverClient()
    .from("topup_batches")
    .select(
      "id,execution_date,sequence_within_date,channel,usdt_spent,gross_vnd_received,remaining_vnd,calculated_rate,time_precision,status,account_history_match_status,gross_ledger_treatment,settleable_increase_vnd",
    )
    .order("execution_date", { ascending: false })
    .order("sequence_within_date", { ascending: false });
  if (error) throw error;
  return data;
}

export async function getPaymentExecutionData() {
  const db = serverClient();
  const [
    { data: summary, error: summaryError },
    { data: checks, error: checksError },
    { data: template, error: templateError },
    { count: bankCount, error: bankError },
    { count: countryCount, error: countryError },
    { data: exportBatches, error: exportError },
    { data: blockReasons, error: blockReasonError },
    { data: readyChecks, error: readyError },
  ] = await Promise.all([
    db
      .from("payment_readiness_summary")
      .select(
        "check_status,risk_level,order_count,payout_principal_vnd,required_gross_debit_vnd",
      ),
    db
      .from("payment_readiness_latest")
      .select(
        "id,payout_order_id,check_status,risk_level,blocking_codes,warning_codes,payout_principal_vnd,required_gross_debit_vnd,beneficiary_snapshot_masked,created_at",
      )
      .order("created_at", { ascending: false })
      .limit(50),
    db
      .from("payment_template_versions")
      .select(
        "id,version,source_file_name,source_file_hash,source_bank_rows,source_country_rows,source_example_rows_excluded,status,shadow_mode",
      )
      .eq("template_code", "LOCAL_BATCH_PAYMENT")
      .eq("version", "LOCAL_BATCH_PAYMENT_V1")
      .single(),
    db
      .from("bank_reference")
      .select("id", { count: "exact", head: true }),
    db
      .from("country_currency_reference")
      .select("id", { count: "exact", head: true }),
    db
      .from("payment_export_batches")
      .select(
        "id,file_name,order_count,total_payout_principal_vnd,estimated_gross_debit_vnd,status,submitted_to_upstream,shadow_mode,created_at",
      )
      .order("created_at", { ascending: false })
      .limit(10),
    db
      .from("payment_block_reason_summary")
      .select("code,order_count")
      .order("order_count", { ascending: false })
      .limit(5),
    db
      .from("payment_readiness_latest")
      .select(
        "id,payout_order_id,check_status,risk_level,blocking_codes,warning_codes,payout_principal_vnd,required_gross_debit_vnd,beneficiary_snapshot_masked,created_at",
      )
      .eq("check_status", "READY")
      .order("created_at", { ascending: false })
      .limit(500),
  ]);
  const error =
    summaryError ??
    checksError ??
    templateError ??
    bankError ??
    countryError ??
    exportError ??
    blockReasonError ??
    readyError;
  if (error) throw error;

  const payoutIds = [
    ...new Set(
      [...(checks ?? []), ...(readyChecks ?? [])].map(
        (row) => row.payout_order_id,
      ),
    ),
  ];
  const { data: payouts, error: payoutError } = payoutIds.length
    ? await db
        .from("payout_orders")
        .select(
          "id,order_number,merchant_name,status,currency,payout_amount_vnd",
        )
        .in("id", payoutIds)
    : { data: [], error: null };
  if (payoutError) throw payoutError;
  const payoutById = new Map(
    (payouts ?? []).map((row) => [row.id, row]),
  );

  return {
    summary: summary ?? [],
    checks: (checks ?? []).map((check) => ({
      ...check,
      payout: payoutById.get(check.payout_order_id) ?? null,
    })),
    readyChecks: (readyChecks ?? []).map((check) => ({
      ...check,
      payout: payoutById.get(check.payout_order_id) ?? null,
    })),
    template,
    bankCount: bankCount ?? 0,
    countryCount: countryCount ?? 0,
    exportBatches: exportBatches ?? [],
    topBlockReasons: (blockReasons ?? []).map((row) => ({
      code: row.code,
      count: Number(row.order_count ?? 0),
    })),
  };
}

export async function getPoolSnapshot() {
  const db = serverClient();
  const [
    { data: ledger, error: ledgerError },
    { data: opening, error: openingError },
    { data: recon, error: reconError },
    { data: accountCutoff, error: accountCutoffError },
    { data: topupCutoff, error: topupCutoffError },
    { data: payoutCutoff, error: payoutCutoffError },
    { data: task25Validation, error: task25Error },
    { data: netSettlements, error: settlementError },
    { data: refunds, error: refundError },
  ] = await Promise.all([
    db
      .from("pool_ledger_entries")
      .select(
        "event_time,event_date,event_type,source_type,gross_signed_amount_vnd,gross_balance_after_vnd,reserve_balance_after_vnd,settleable_signed_amount_vnd,settleable_balance_after_vnd,data_confidence,notes",
      )
      .eq("record_status", "ACTIVE")
      .order("event_date", { ascending: false })
      .order("event_time", { ascending: false, nullsFirst: false })
      .limit(50),
    db
      .from("opening_balances")
      .select(
        "gross_opening_balance_vnd,reserve_ratio,reserve_opening_balance_vnd,settleable_ratio,settleable_opening_balance_vnd,effective_at,approval_status,model_version",
      )
      .eq("currency", "VND")
      .eq("approval_status", "APPROVED")
      .limit(1)
      .maybeSingle(),
    db
      .from("reconciliation_runs")
      .select("*")
      .eq("record_status", "ACTIVE")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    db
      .from("account_history_entries")
      .select("source_local_time,source_timezone,transaction_time")
      .order("transaction_time", { ascending: false })
      .order("source_row_number", { ascending: true })
      .limit(1)
      .maybeSingle(),
    db
      .from("topup_batches")
      .select("execution_date")
      .order("execution_date", { ascending: false })
      .limit(1)
      .maybeSingle(),
    db
      .from("payout_orders")
      .select("completed_at")
      .not("completed_at", "is", null)
      .order("completed_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    db
      .from("task25_validation_runs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    db
      .from("net_settlements")
      .select(
        "id,settled_at,settlement_direction,usdt_amount,vnd_amount,actual_rate_vnd_per_usdt,verification_status,counter_leg_status,realized_profit_effect_usdt",
      )
      .not("account_history_entry_id", "is", null)
      .order("settled_at"),
    db
      .from("account_history_payout_executions")
      .select(
        "final_payout_status,refund_credit_vnd,refund_reversal_status,final_upstream_fee_vnd,final_gross_outflow_vnd",
      )
      .eq("final_payout_status", "REFUNDED"),
  ]);
  const error =
    ledgerError ??
    openingError ??
    reconError ??
    accountCutoffError ??
    topupCutoffError ??
    payoutCutoffError ??
    task25Error ??
    settlementError ??
    refundError;
  if (error) throw error;
  return {
    ledger: ledger ?? [],
    opening,
    recon,
    task25Validation,
    netSettlements: netSettlements ?? [],
    refunds: refunds ?? [],
    dataCutoffs: {
      accountHistoryLocal: accountCutoff?.source_local_time ?? null,
      accountHistoryTimezone: accountCutoff?.source_timezone ?? null,
      accountHistoryUtc: accountCutoff?.transaction_time ?? null,
      topupDate: topupCutoff?.execution_date ?? null,
      payoutUtc: payoutCutoff?.completed_at ?? null,
    },
  };
}

export async function getQualitySnapshot() {
  const db = serverClient();
  const { data: run, error: runError } = await db
    .from("shadow_pricing_runs")
    .select("id")
    .eq(
      "rules_version",
      "SHADOW_PRICING_MERCHANT_FEE_DENOMINATOR_DCC_SIGNED_ADDITION_V1",
    )
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (runError) throw runError;

  const [
    { count: feeMismatch, error: a },
    { count: balanceMismatch, error: b },
    { count: continuityMismatch, error: c },
    { count: unmatchedTransfers, error: d },
    { count: auditCount, error: e },
    { count: payoutUnmatched, error: f },
    { count: refundAllocationPending, error: g },
    { count: settlementCounterLegPending, error: h },
    { count: verified, error: i },
    { count: partial, error: j },
    { count: estimated, error: k },
    { data: validation, error: l },
  ] = await Promise.all([
    db
      .from("payin_orders")
      .select("id", { count: "exact", head: true })
      .eq("currency", "VND")
      .eq("fee_validation_status", "MISMATCH"),
    db
      .from("account_history_entries")
      .select("id", { count: "exact", head: true })
      .eq("balance_validation_status", "MISMATCH"),
    db
      .from("account_history_entries")
      .select("id", { count: "exact", head: true })
      .eq("continuity_status", "MISMATCH"),
    db
      .from("account_history_entries")
      .select("id", { count: "exact", head: true })
      .eq("transfer_pair_status", "UNMATCHED"),
    db.from("audit_logs").select("id", { count: "exact", head: true }),
    db
      .from("account_history_payout_executions")
      .select("id", { count: "exact", head: true })
      .eq("match_method", "NO_EXACT_IDENTIFIER_MATCH"),
    db
      .from("account_history_payout_executions")
      .select("id", { count: "exact", head: true })
      .eq("refund_reversal_status", "NO_PAYOUT_ALLOCATION_LINK"),
    db
      .from("net_settlements")
      .select("id", { count: "exact", head: true })
      .eq("counter_leg_status", "PENDING_DIRECTION_CONFIRMATION"),
    db
      .from("payout_profit_calculations")
      .select("id", { count: "exact", head: true })
      .eq("pricing_run_id", run?.id ?? "")
      .eq("profit_verification_status", "VERIFIED"),
    db
      .from("payout_profit_calculations")
      .select("id", { count: "exact", head: true })
      .eq("pricing_run_id", run?.id ?? "")
      .eq("profit_verification_status", "PARTIAL"),
    db
      .from("payout_profit_calculations")
      .select("id", { count: "exact", head: true })
      .eq("pricing_run_id", run?.id ?? "")
      .eq("profit_verification_status", "ESTIMATED"),
    db
      .from("task25_validation_runs")
      .select(
        "source_file_name,total_source_rows,vnd_source_rows,imported_rows,duplicate_rows,excluded_non_vnd_rows,payout_exact_match_rows,payout_unmatched_rows,successful_unrefunded_rows,aggregate_execution_validation_status,aggregate_execution_validated_count,refund_matched_rows,refund_unmatched_rows,balance_mismatch_rows,continuity_mismatch_rows",
      )
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const error = a ?? b ?? c ?? d ?? e ?? f ?? g ?? h ?? i ?? j ?? k ?? l;
  if (error) throw error;
  return {
    feeMismatch: feeMismatch ?? 0,
    balanceMismatch: balanceMismatch ?? 0,
    continuityMismatch: continuityMismatch ?? 0,
    unmatchedTransfers: unmatchedTransfers ?? 0,
    auditCount: auditCount ?? 0,
    payoutUnmatched: payoutUnmatched ?? 0,
    refundAllocationPending: refundAllocationPending ?? 0,
    settlementCounterLegPending: settlementCounterLegPending ?? 0,
    verified: verified ?? 0,
    partial: partial ?? 0,
    estimated: estimated ?? 0,
    validation,
  };
}

export async function getShadowPricingData() {
  const db = serverClient();
  const [
    { data: buckets, error: a },
    { data: orders, error: b },
    { data: rate, error: c },
  ] = await Promise.all([
    db
      .from("pool_buckets")
      .select(
        "id,source_type,gross_available_amount_vnd,settleable_available_amount_vnd,settleable_ratio,funding_rate_vnd_per_usdt,cost_basis_status",
      )
      .eq("status", "OPEN")
      .gt("settleable_available_amount_vnd", 0)
      .order("source_type"),
    db.from("payout_orders").select("merchant,channel").limit(30000),
    db
      .from("rate_snapshots")
      .select(
        "rate_vnd_per_usdt,rate_date,time_precision,source,confidence",
      )
      .eq("approval_status", "APPROVED")
      .order("rate_date", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (a || b || c) throw a ?? b ?? c;
  const total = (buckets ?? []).reduce(
    (sum, row) => sum + Number(row.settleable_available_amount_vnd ?? 0),
    0,
  );
  return {
    sources: (buckets ?? []).map((row) => ({
      ...row,
      allocationRatio: total
        ? Number(row.settleable_available_amount_vnd) / total
        : 0,
    })),
    merchants: [
      ...new Set((orders ?? []).map((row) => row.merchant).filter(Boolean)),
    ].sort(),
    channels: [
      ...new Set((orders ?? []).map((row) => row.channel).filter(Boolean)),
    ].sort(),
    replacementRate: rate,
    dataCompletenessStatus:
      "PARTIAL_AFTER_ACCOUNT_HISTORY_CUTOFF" as const,
  };
}

export async function getPortfolioData() {
  const db = serverClient();
  const { data: run, error: runError } = await db
    .from("shadow_pricing_runs")
    .select(
      "id,run_version,rules_version,created_at,data_cutoff_snapshot,status,shadow_mode",
    )
    .eq("run_type", "HISTORICAL_BACKTEST")
    .eq(
      "rules_version",
      "SHADOW_PRICING_MERCHANT_FEE_DENOMINATOR_DCC_SIGNED_ADDITION_V1",
    )
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (runError) throw runError;
  if (!run) {
    return {
      run: null,
      summaries: [],
      calculations: [],
      sources: [],
      fees: [],
      merchantFees: [],
      settlements: [],
      validation: null,
    };
  }

  const [
    { data: summaries, error: a },
    { data: calculations, error: b },
    { data: sources, error: c },
    { data: fees, error: d },
    { data: merchantFees, error: e },
    { data: settlements, error: f },
    { data: validation, error: g },
  ] = await Promise.all([
    db
      .from("daily_portfolio_summaries")
      .select("*")
      .eq("pricing_run_id", run.id)
      .order("summary_date"),
    db
      .from("payout_profit_calculations")
      .select(
        "id,payout_order_id,economic_profit_usdt,economic_profit_margin,profit_verification_status,data_completeness_status,current_manual_as_rate,minimum_margin_quote,target_margin_quote,merchant_total_debit_usdt,merchant_principal_usdt,merchant_fee_usdt,merchant_fee_rate,fee_rate_on_total,dcc_revenue_usdt,total_company_revenue_usdt,payout_execution_cost_status,final_payout_status,aggregate_execution_validation_status,created_at",
      )
      .eq("pricing_run_id", run.id)
      .order("economic_profit_margin")
      .limit(30),
    db
      .from("pool_buckets")
      .select(
        "id,source_type,gross_available_amount_vnd,settleable_available_amount_vnd,funding_rate_vnd_per_usdt,cost_basis_status",
      )
      .eq("status", "OPEN")
      .order("source_type"),
    db
      .from("account_history_payout_executions")
      .select(
        "original_payout_principal_vnd,original_upstream_fee_vnd,final_upstream_fee_vnd,final_gross_outflow_vnd,final_payout_status",
      )
      .eq("final_payout_status", "SUCCESS"),
    db
      .from("payout_merchant_fee_summary")
      .select("*")
      .order("merchant_fee_usdt", { ascending: false }),
    db
      .from("net_settlements")
      .select(
        "settled_at,settlement_direction,usdt_amount,vnd_amount,actual_rate_vnd_per_usdt,verification_status,counter_leg_status,realized_profit_effect_usdt",
      )
      .not("account_history_entry_id", "is", null)
      .order("settled_at"),
    db
      .from("task25_validation_runs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const error = a ?? b ?? c ?? d ?? e ?? f ?? g;
  if (error) throw error;
  return {
    run,
    summaries: summaries ?? [],
    calculations: calculations ?? [],
    sources: sources ?? [],
    fees: fees ?? [],
    merchantFees: merchantFees ?? [],
    settlements: settlements ?? [],
    validation,
  };
}

export async function getPayoutPricing(calculationId: string) {
  const db = serverClient();
  const { data: calculation, error: a } = await db
    .from("payout_profit_calculations")
    .select("*")
    .eq("id", calculationId)
    .maybeSingle();
  if (a) throw a;
  if (!calculation) return null;
  const calculationSnapshot =
    calculation.calculation_snapshot &&
    typeof calculation.calculation_snapshot === "object"
      ? (calculation.calculation_snapshot as Record<string, unknown>)
      : {};
  const allocationRunId = String(
    calculationSnapshot.source_allocation_run_id ??
      calculation.pricing_run_id,
  );

  const [
    { data: order, error: b },
    { data: match, error: c },
    { data: allocations, error: d },
    { data: execution, error: e },
    { data: identifiers, error: f },
  ] = await Promise.all([
    db
      .from("payout_orders")
      .select(
        "id,order_number,merchant,merchant_code,channel,received_usdt,amount_usdt,merchant_total_debit_usdt,merchant_principal_usdt,merchant_fee_usdt,merchant_fee_rate,fee_rate_on_total,at_dcc_revenue,dcc_revenue_usdt,total_company_revenue_usdt,payout_amount_vnd,total_fee_usdt,status,completed_at",
      )
      .eq("id", calculation.payout_order_id)
      .single(),
    db
      .from("payout_account_history_matches")
      .select("match_method,match_confidence,review_status,evidence")
      .eq("payout_order_id", calculation.payout_order_id)
      .maybeSingle(),
    db
      .from("payout_pool_allocations")
      .select(
        "id,pool_bucket_id,source_type,allocation_ratio,allocated_gross_outflow_vnd,allocated_settleable_impact_vnd,economic_rate_vnd_per_usdt,cost_method,external_cash_cost_usdt,economic_cost_usdt,internal_netting_advantage_usdt,cost_confidence,allocation_status",
      )
      .eq("pricing_run_id", allocationRunId)
      .eq("payout_order_id", calculation.payout_order_id)
      .order("source_type"),
    db
      .from("account_history_payout_executions")
      .select(
        "match_method,match_confidence,match_evidence,original_upstream_fee_vnd,final_upstream_fee_vnd,final_gross_outflow_vnd,final_payout_status,payout_execution_cost_status,profit_verification_status,refund_reversal_status",
      )
      .eq("payout_order_id", calculation.payout_order_id)
      .maybeSingle(),
    db
      .from("payout_order_identifiers")
      .select(
        "order_number,channel_order_number,cp_order_number,cp_payment_order_number,merchant_order_number,payment_order_number,provider_order_number",
      )
      .eq("payout_order_id", calculation.payout_order_id)
      .maybeSingle(),
  ]);
  const error = b ?? c ?? d ?? e ?? f;
  if (error) throw error;
  return {
    calculation,
    order,
    match,
    execution,
    identifiers,
    allocations: allocations ?? [],
  };
}

export async function getSettlementIntelligenceData() {
  const db = serverClient();
  const now = new Date().toISOString();
  const [
    { data: poolRows, error: poolError },
    { data: hourlyRows, error: hourlyError },
    { data: inventoryRows, error: inventoryError },
    { data: xeInput, error: xeError },
    { data: p2pInputs, error: p2pError },
    { data: adjustmentRule, error: adjustmentError },
    { data: revenueBenchmark, error: revenueError },
    { data: accountCutoff, error: accountCutoffError },
    { data: topupCutoff, error: topupCutoffError },
    { data: payoutCutoff, error: payoutCutoffError },
  ] = await Promise.all([
    db
      .from("pool_buckets")
      .select(
        "gross_available_amount_vnd,reserve_amount_vnd,settleable_available_amount_vnd",
      )
      .eq("currency", "VND")
      .eq("status", "OPEN"),
    db
      .from("hourly_liquidity_forecast")
      .select(
        "local_hour,observed_days,forecast_payin_vnd,forecast_payout_vnd,forecast_net_demand_vnd,is_peak_window,payout_concentration_ratio",
      )
      .order("local_hour"),
    db
      .from("vnd_inventory_positions")
      .select(
        "id,topup_batch_id,batch_time,batch_date,time_precision,usdt_amount,vnd_amount,cost_rate,source,remaining_amount,remaining_ratio,cost_source_type,historical_cost_locked,status,model_version,shadow_mode",
      )
      .gt("remaining_amount", 0)
      .order("batch_date")
      .order("batch_time", { nullsFirst: true }),
    db
      .from("fx_market_inputs")
      .select("id,rate_value,source,record_time,operator")
      .eq("currency", "VND")
      .eq("rate_type", "XE_BASE_RATE")
      .order("record_time", { ascending: false })
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle(),
    db
      .from("fx_market_inputs")
      .select("id,rate_value,source,record_time,operator")
      .eq("currency", "VND")
      .eq("rate_type", "P2P_COST_RATE")
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
      .lte("effective_time", now)
      .order("effective_time", { ascending: false })
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle(),
    db
      .from("settlement_revenue_rate_benchmarks")
      .select("*")
      .maybeSingle(),
    db
      .from("account_history_entries")
      .select("source_local_time,source_timezone,transaction_time")
      .order("transaction_time", { ascending: false })
      .order("source_row_number")
      .limit(1)
      .maybeSingle(),
    db
      .from("topup_batches")
      .select("execution_date,time_precision")
      .order("execution_date", { ascending: false })
      .order("sequence_within_date", { ascending: false })
      .limit(1)
      .maybeSingle(),
    db
      .from("payout_orders")
      .select("completed_at")
      .not("completed_at", "is", null)
      .order("completed_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const error =
    poolError ??
    hourlyError ??
    inventoryError ??
    xeError ??
    p2pError ??
    adjustmentError ??
    revenueError ??
    accountCutoffError ??
    topupCutoffError ??
    payoutCutoffError;
  if (error) throw error;

  const balances = (poolRows ?? []).reduce(
    (totals, row) => ({
      grossBalanceVnd:
        totals.grossBalanceVnd +
        Number(row.gross_available_amount_vnd ?? 0),
      reserveBalanceVnd:
        totals.reserveBalanceVnd + Number(row.reserve_amount_vnd ?? 0),
      settleableBalanceVnd:
        totals.settleableBalanceVnd +
        Number(row.settleable_available_amount_vnd ?? 0),
    }),
    {
      grossBalanceVnd: 0,
      reserveBalanceVnd: 0,
      settleableBalanceVnd: 0,
    },
  );
  const hourly = (hourlyRows ?? []).map((row) => ({
    localHour: Number(row.local_hour),
    observedDays: Number(row.observed_days ?? 0),
    forecastPayinVnd: String(row.forecast_payin_vnd ?? 0),
    forecastPayoutVnd: String(row.forecast_payout_vnd ?? 0),
    forecastNetDemandVnd: String(row.forecast_net_demand_vnd ?? 0),
    isPeakWindow: Boolean(row.is_peak_window),
    payoutConcentrationRatio: String(
      row.payout_concentration_ratio ?? 0,
    ),
  }));
  const peakWindow = summarizePeakWindow(
    hourly satisfies HourlyLiquidityRow[],
  );
  const latestP2p = p2pInputs?.[0] ?? null;
  const topupRecommendation = recommendTopup({
    currentSettleableBalanceVnd: String(
      balances.settleableBalanceVnd,
    ),
    forecastPayoutVnd: peakWindow.forecastPayoutVnd,
    expectedPayinVnd: peakWindow.forecastPayinVnd,
    p2pCostRate: latestP2p?.rate_value
      ? String(latestP2p.rate_value)
      : null,
  });
  const fxIntelligence =
    xeInput?.rate_value && latestP2p?.rate_value
      ? calculateFxIntelligence({
          xeRate: String(xeInput.rate_value),
          p2pCostRate: String(latestP2p.rate_value),
          recentP2pRates: (p2pInputs ?? []).map((row) =>
            String(row.rate_value),
          ),
        })
      : null;
  const marginRecommendation = recommendTargetMargin({
    projectedShortfallVnd:
      topupRecommendation.projectedShortfallVnd,
    fxVolatility: fxIntelligence?.volatility ?? null,
    competitionAdjustment:
      adjustmentRule?.reason === "market_competition"
        ? "-0.001"
        : null,
  });
  const quoteRecommendation = xeInput?.rate_value
    ? recommendCustomerQuote({
        xeRate: String(xeInput.rate_value),
        companyAdjustment: String(adjustmentRule?.adjustment ?? 0),
        p2pCostRate: latestP2p?.rate_value
          ? String(latestP2p.rate_value)
          : null,
        targetMargin: marginRecommendation.targetMargin,
      })
    : null;
  const inventoryBatches: VndInventoryBatch[] = (
    inventoryRows ?? []
  ).map((row) => ({
    id: String(row.id),
    batchDate: String(row.batch_date),
    batchTime: row.batch_time ? String(row.batch_time) : null,
    usdtAmount: String(row.usdt_amount),
    vndAmount: String(row.vnd_amount),
    costRate: String(row.cost_rate),
    source: String(row.source),
    remainingAmount: String(row.remaining_amount),
  }));
  const fifoForecast = allocateFifoInventory(
    inventoryBatches,
    peakWindow.forecastPayoutVnd,
  );
  const profitForecast =
    quoteRecommendation && fifoForecast.isFullyCovered
      ? forecastProfit({
          forecastPayoutVnd: peakWindow.forecastPayoutVnd,
          customerQuoteRate:
            quoteRecommendation.recommendedQuoteRate,
          fifoCostBasisUsdt: fifoForecast.costBasisUsdt,
          merchantFeeRate: String(
            revenueBenchmark?.merchant_fee_rate ?? 0,
          ),
          dccRevenueRate: String(
            revenueBenchmark?.dcc_revenue_rate ?? 0,
          ),
        })
      : null;
  const riskAlerts = buildSettlementRiskAlerts({
    projectedShortfallVnd:
      topupRecommendation.projectedShortfallVnd,
    expectedProfitMargin:
      profitForecast?.expectedProfitMargin ?? null,
    fxVolatility: fxIntelligence?.volatility ?? null,
    maximumHourlyPayoutConcentration:
      peakWindow.maximumHourlyPayoutConcentration,
    hasXeRate: Boolean(xeInput?.rate_value),
    hasP2pCostRate: Boolean(latestP2p?.rate_value),
  });

  return {
    balances,
    hourly,
    peakWindow,
    topupRecommendation,
    fxIntelligence,
    xeInput,
    latestP2p,
    p2pInputs: p2pInputs ?? [],
    adjustmentRule,
    marginRecommendation,
    quoteRecommendation,
    inventoryRows: inventoryRows ?? [],
    fifoForecast,
    revenueBenchmark,
    profitForecast,
    riskAlerts,
    shadowModeGuard: SHADOW_MODE_GUARD,
    dataCutoffs: {
      accountHistoryLocal: accountCutoff?.source_local_time ?? null,
      accountHistoryTimezone: accountCutoff?.source_timezone ?? null,
      accountHistoryUtc: accountCutoff?.transaction_time ?? null,
      topupDate: topupCutoff?.execution_date ?? null,
      topupTimePrecision: topupCutoff?.time_precision ?? null,
      payoutUtc: payoutCutoff?.completed_at ?? null,
      completeness: "PARTIAL_AFTER_ACCOUNT_HISTORY_CUTOFF",
    },
  };
}
