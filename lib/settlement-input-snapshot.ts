import Decimal from "decimal.js";

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export const SETTLEMENT_INPUT_CONTRACT_VERSION =
  "SETTLEMENT_INTELLIGENCE_INPUT_V1" as const;

export const SETTLEMENT_INPUT_SHADOW_GUARD = Object.freeze({
  automatic_topup: false,
  automatic_payment: false,
  automatic_quote_change: false,
  automatic_trading: false,
  automatic_channel_switch: false,
  third_party_submission: false,
});

export type SettlementRunTrigger =
  | "MANUAL"
  | "SCHEDULED_1100"
  | "SCHEDULED_1600"
  | "SCHEDULED_2300";

export type FreshnessStatus =
  | "FRESH"
  | "AGING"
  | "STALE"
  | "MISSING"
  | "FUTURE_DATED";

export type CompletenessStatus =
  | "COMPLETE"
  | "PARTIAL"
  | "PARTIAL_AFTER_ACCOUNT_HISTORY_CUTOFF"
  | "UNAVAILABLE"
  | "INVALID";

export type SnapshotQualityStatus = "COMPLETE" | "LIMITED" | "BLOCKED";

export type SnapshotSourceKey =
  | "BALANCE_POSITION"
  | "LIQUIDITY_HISTORY"
  | "VND_INVENTORY"
  | "FX_MARKET_INPUTS"
  | "MERCHANT_CONTEXT"
  | "PROFIT_CONTEXT"
  | "MARKET_CONTEXT";

export interface SettlementReadBoundary {
  asOf: string;
  localDate: string;
  historyWindowStart: string;
}

export interface SettlementReadEnvelope<T> {
  data: T;
  observedAt: string;
  cutoffAt: string | null;
  recordCount: number;
  completenessStatus: CompletenessStatus;
  limitations: string[];
}

export interface BalancePosition {
  as_of: string;
  balance_source:
    | "POOL_LEDGER_ACTIVE"
    | "ACCOUNT_HISTORY"
    | "APPROVED_OPENING_BALANCE";
  gross_balance_vnd: string;
  reserve_ratio: string;
  reserve_balance_vnd: string;
  settleable_ratio: string;
  settleable_balance_vnd: string;
  account_history_cutoff_at: string | null;
  account_history_cutoff_local: string | null;
  account_history_timezone: string | null;
  topup_cutoff_date: string | null;
  payout_cutoff_at: string | null;
  reconciliation_status: string | null;
}

export interface BalanceContextRead {
  position: BalancePosition | null;
}

export interface HourlyLiquidityInput {
  local_hour: number;
  observed_days: number;
  forecast_payin_vnd: string;
  forecast_payout_vnd: string;
  forecast_net_demand_vnd: string;
  is_peak_window: boolean;
  payout_concentration_ratio: string;
}

export interface LiquidityContextRead {
  historical_window_days: number;
  history_window_start: string;
  history_window_end: string;
  forecast_window_start: string;
  forecast_window_end: string;
  forecast_payin_vnd: string;
  forecast_payout_vnd: string;
  forecast_net_demand_vnd: string;
  peak_window: "16:00-23:00";
  hourly_forecast: HourlyLiquidityInput[];
  forecast_method: "HISTORICAL_HOURLY_AVERAGE_INPUT_V1";
  forecast_version: "SETTLEMENT_READ_AGGREGATION_V1";
}

export interface InventoryBatchInput {
  id: string;
  topup_batch_id: string | null;
  batch_time: string | null;
  batch_date: string;
  time_precision: "DATE_ONLY" | "EXACT";
  usdt_amount: string;
  vnd_amount: string;
  cost_rate: string;
  source: string;
  remaining_amount: string;
  remaining_ratio: string;
  cost_source_type: string;
  historical_cost_locked: boolean;
  status: string;
  model_version: string;
}

export interface InventoryContextRead {
  cost_method: "FIFO_ACTUAL_TOPUP_V1";
  position_as_of: string;
  total_remaining_vnd: string;
  batches: InventoryBatchInput[];
  unmatched_inventory_status: "COMPLETE" | "LIMITED";
}

export interface FxRateInput {
  id: string;
  rate_type:
    | "XE_BASE_RATE"
    | "P2P_COST_RATE"
    | "UPSTREAM_QUOTE_RATE"
    | "CURRENT_CUSTOMER_QUOTE_RATE";
  rate_value: string;
  source: string;
  record_time: string;
  operator_id: string | null;
}

export interface QuoteAdjustmentInput {
  id: string;
  base_source: string;
  adjustment: string;
  reason: string;
  effective_time: string;
  operator_id: string | null;
  status: string;
}

export interface FxContextRead {
  xe_rate: FxRateInput | null;
  p2p_cost_rates: FxRateInput[];
  upstream_quote_rate: FxRateInput | null;
  current_customer_quote_rate: FxRateInput | null;
  quote_adjustment: QuoteAdjustmentInput | null;
}

export interface MerchantContextInput {
  merchant_name: string;
  payout_count: string;
  channel_count: string;
  transaction_volume_usdt: string;
  contribution_usdt: string;
  current_quote_rate: string | null;
  current_profit_margin: string | null;
  merchant_fee_rate_on_principal: string | null;
  source_rules_version: string;
  source_run_time: string;
}

export interface ProfitMetricInput {
  pricing_run_id: string;
  pricing_rules_version: string;
  pricing_run_time: string;
  profit_date: string;
  payout_count: string;
  merchant_principal_usdt: string;
  merchant_fee_revenue_usdt: string;
  signed_dcc_revenue_usdt: string;
  realized_fx_profit_usdt: string;
  channel_fees_usdt: string;
  other_actual_fees_usdt: string;
  cash_profit_usdt: string;
  cash_profit_margin: string | null;
  signed_internal_funding_advantage_usdt: string;
  shadow_cost_usdt: string;
  opportunity_cost_usdt: string;
  unrealized_risk_cost_usdt: string;
  economic_profit_usdt: string;
  economic_profit_margin: string | null;
  data_status: string;
}

export interface ProfitContextRead {
  daily_metrics: ProfitMetricInput[];
}

export interface MarketContextInput {
  id: string;
  context_date: string;
  observed_at: string;
  context_category: string;
  severity: string;
  title: string;
  observation_reason: string;
  evidence_reference: string | null;
  shadow_mode: true;
  quote_impact_applied: false;
  automatic_action: false;
}

export interface SettlementSnapshotReadRepository {
  readBalanceContext(
    boundary: SettlementReadBoundary,
  ): Promise<SettlementReadEnvelope<BalanceContextRead>>;
  readLiquidityContext(
    boundary: SettlementReadBoundary,
  ): Promise<SettlementReadEnvelope<LiquidityContextRead>>;
  readInventoryContext(
    boundary: SettlementReadBoundary,
  ): Promise<SettlementReadEnvelope<InventoryContextRead>>;
  readFxContext(
    boundary: SettlementReadBoundary,
  ): Promise<SettlementReadEnvelope<FxContextRead>>;
  readMerchantContexts(
    boundary: SettlementReadBoundary,
  ): Promise<SettlementReadEnvelope<MerchantContextInput[]>>;
  readProfitContext(
    boundary: SettlementReadBoundary,
  ): Promise<SettlementReadEnvelope<ProfitContextRead>>;
  readMarketContext(
    boundary: SettlementReadBoundary,
  ): Promise<SettlementReadEnvelope<MarketContextInput[]>>;
}

export interface SnapshotSourceManifest {
  source_key: SnapshotSourceKey;
  source_type: "SUPABASE_SELECT";
  source_system: "VND_SETTLEMENT_OS";
  observed_at: string;
  cutoff_at: string | null;
  record_count: number;
  freshness_policy_key: string;
  freshness_status: FreshnessStatus;
  completeness_status: CompletenessStatus;
  content_digest: string;
  evidence_ids: string[];
  limitations: string[];
}

export interface SnapshotEvidenceItem {
  evidence_id: string;
  source_key: SnapshotSourceKey;
  source_type: "SUPABASE_SELECT";
  observed_at: string;
  cutoff_at: string | null;
  content_digest: string;
  extraction_version: "SETTLEMENT_READ_AGGREGATION_V1";
  classification: "INTERNAL_OPERATIONAL_DATA";
  redaction_status: "NO_SECRETS_INCLUDED";
}

export interface SettlementInputSnapshot {
  contract_version: typeof SETTLEMENT_INPUT_CONTRACT_VERSION;
  snapshot_id: string;
  request_id: string;
  requested_at: string;
  created_at: string;
  as_of: string;
  currency: "VND";
  operating_timezone: "Asia/Shanghai";
  run_trigger: SettlementRunTrigger;
  mode: "SHADOW";
  ruleset_ref: {
    ruleset_code: "VND_SETTLEMENT_INTELLIGENCE_RULESET";
    ruleset_version: "1.0.0";
    ruleset_digest: string;
  };
  input_digest: string;
  data_sources: SnapshotSourceManifest[];
  balance_position: BalancePosition | null;
  liquidity_context: LiquidityContextRead;
  inventory_context: InventoryContextRead;
  fx_context: FxContextRead;
  merchant_contexts: MerchantContextInput[];
  profit_context: ProfitContextRead;
  market_context: MarketContextInput[];
  data_quality: {
    status: SnapshotQualityStatus;
    limitations: string[];
    blocking_reasons: string[];
  };
  input_evidence: SnapshotEvidenceItem[];
  shadow_guard: typeof SETTLEMENT_INPUT_SHADOW_GUARD;
}

export interface BuildSettlementInputSnapshotOptions {
  asOf: string;
  requestId?: string;
  snapshotId?: string;
  requestedAt?: string;
  runTrigger?: SettlementRunTrigger;
}

interface SourcePolicy {
  sourceKey: SnapshotSourceKey;
  freshnessPolicyKey: string;
  softAgeSeconds: number;
  maxAgeSeconds: number;
  requiredForComplete: boolean;
  blocking: boolean;
}

export const SETTLEMENT_INPUT_FRESHNESS_POLICIES = [
  {
    sourceKey: "BALANCE_POSITION",
    freshnessPolicyKey: "BALANCE_POSITION_OPERATIONAL_V1",
    softAgeSeconds: 15 * 60,
    maxAgeSeconds: 24 * 60 * 60,
    requiredForComplete: true,
    blocking: true,
  },
  {
    sourceKey: "LIQUIDITY_HISTORY",
    freshnessPolicyKey: "LIQUIDITY_HISTORY_OPERATIONAL_V1",
    softAgeSeconds: 15 * 60,
    maxAgeSeconds: 24 * 60 * 60,
    requiredForComplete: true,
    blocking: false,
  },
  {
    sourceKey: "VND_INVENTORY",
    freshnessPolicyKey: "VND_INVENTORY_POSITION_V1",
    softAgeSeconds: 24 * 60 * 60,
    maxAgeSeconds: 7 * 24 * 60 * 60,
    requiredForComplete: true,
    blocking: false,
  },
  {
    sourceKey: "FX_MARKET_INPUTS",
    freshnessPolicyKey: "FX_MARKET_INPUTS_MANUAL_V1",
    softAgeSeconds: 30 * 60,
    maxAgeSeconds: 2 * 60 * 60,
    requiredForComplete: true,
    blocking: false,
  },
  {
    sourceKey: "MERCHANT_CONTEXT",
    freshnessPolicyKey: "MERCHANT_CONTEXT_SHADOW_RUN_V1",
    softAgeSeconds: 24 * 60 * 60,
    maxAgeSeconds: 7 * 24 * 60 * 60,
    requiredForComplete: true,
    blocking: false,
  },
  {
    sourceKey: "PROFIT_CONTEXT",
    freshnessPolicyKey: "PROFIT_CONTEXT_SHADOW_RUN_V1",
    softAgeSeconds: 24 * 60 * 60,
    maxAgeSeconds: 7 * 24 * 60 * 60,
    requiredForComplete: true,
    blocking: false,
  },
  {
    sourceKey: "MARKET_CONTEXT",
    freshnessPolicyKey: "MARKET_CONTEXT_HUMAN_NOTES_V1",
    softAgeSeconds: 7 * 24 * 60 * 60,
    maxAgeSeconds: 30 * 24 * 60 * 60,
    requiredForComplete: false,
    blocking: false,
  },
] as const satisfies readonly SourcePolicy[];

const DEFAULT_RULESET_BASIS = Object.freeze({
  ruleset_code: "VND_SETTLEMENT_INTELLIGENCE_RULESET",
  ruleset_version: "1.0.0",
  reserve_ratio: "0.50",
  settleable_ratio: "0.50",
  liquidity_safety_buffer: "0.10",
  minimum_margin: "0.002",
  target_margin: "0.005",
  inventory_cost_method: "FIFO_ACTUAL_TOPUP_V1",
  freshness_policies: SETTLEMENT_INPUT_FRESHNESS_POLICIES,
  shadow_mode: true,
});

function validTimestamp(value: string, label: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new Error(`${label} must be an RFC 3339 timestamp`);
  }
  return timestamp;
}

export function shanghaiOperatingDate(timestamp: string) {
  const date = new Date(validTimestamp(timestamp, "asOf"));
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

export function decimalString(
  value: unknown,
  fallback = "0",
) {
  if (
    value !== null &&
    value !== undefined &&
    typeof value !== "string" &&
    typeof value !== "number"
  ) {
    throw new Error("Decimal value must be a string or number");
  }
  const raw = value === null || value === undefined ? fallback : String(value);
  const decimal = new Decimal(raw);
  if (!decimal.isFinite()) {
    throw new Error("Decimal value must be finite");
  }
  return raw;
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalize(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map(
      (key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`,
    )
    .join(",")}}`;
}

export async function stableSnapshotDigest(value: unknown) {
  const bytes = new TextEncoder().encode(canonicalize(value));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}

export function classifyFreshness(
  asOf: string,
  cutoffAt: string | null,
  policy: Pick<SourcePolicy, "softAgeSeconds" | "maxAgeSeconds">,
): FreshnessStatus {
  const asOfMs = validTimestamp(asOf, "asOf");
  if (!cutoffAt) return "MISSING";
  const cutoffMs = validTimestamp(cutoffAt, "cutoffAt");
  if (cutoffMs > asOfMs + 60_000) return "FUTURE_DATED";
  const ageSeconds = Math.max(0, (asOfMs - cutoffMs) / 1000);
  if (ageSeconds <= policy.softAgeSeconds) return "FRESH";
  if (ageSeconds <= policy.maxAgeSeconds) return "AGING";
  return "STALE";
}

function unavailableEnvelope<T>(
  data: T,
  observedAt: string,
  sourceKey: SnapshotSourceKey,
): SettlementReadEnvelope<T> {
  return {
    data,
    observedAt,
    cutoffAt: null,
    recordCount: 0,
    completenessStatus: "UNAVAILABLE",
    limitations: [`${sourceKey}_QUERY_FAILED`],
  };
}

function defaultBalanceContext(): BalanceContextRead {
  return { position: null };
}

function defaultLiquidityContext(
  boundary: SettlementReadBoundary,
): LiquidityContextRead {
  return {
    historical_window_days: 90,
    history_window_start: boundary.historyWindowStart,
    history_window_end: boundary.asOf,
    forecast_window_start: boundary.asOf,
    forecast_window_end: boundary.asOf,
    forecast_payin_vnd: "0",
    forecast_payout_vnd: "0",
    forecast_net_demand_vnd: "0",
    peak_window: "16:00-23:00",
    hourly_forecast: [],
    forecast_method: "HISTORICAL_HOURLY_AVERAGE_INPUT_V1",
    forecast_version: "SETTLEMENT_READ_AGGREGATION_V1",
  };
}

function defaultInventoryContext(asOf: string): InventoryContextRead {
  return {
    cost_method: "FIFO_ACTUAL_TOPUP_V1",
    position_as_of: asOf,
    total_remaining_vnd: "0",
    batches: [],
    unmatched_inventory_status: "LIMITED",
  };
}

function defaultFxContext(): FxContextRead {
  return {
    xe_rate: null,
    p2p_cost_rates: [],
    upstream_quote_rate: null,
    current_customer_quote_rate: null,
    quote_adjustment: null,
  };
}

function defaultProfitContext(): ProfitContextRead {
  return { daily_metrics: [] };
}

function makeBoundary(asOf: string): SettlementReadBoundary {
  const asOfMs = validTimestamp(asOf, "asOf");
  return {
    asOf: new Date(asOfMs).toISOString(),
    localDate: shanghaiOperatingDate(asOf),
    historyWindowStart: new Date(
      asOfMs - 90 * 24 * 60 * 60 * 1000,
    ).toISOString(),
  };
}

function settledEnvelope<T>(
  result: PromiseSettledResult<SettlementReadEnvelope<T>>,
  fallback: T,
  observedAt: string,
  sourceKey: SnapshotSourceKey,
) {
  return result.status === "fulfilled"
    ? result.value
    : unavailableEnvelope(fallback, observedAt, sourceKey);
}

export async function buildSettlementInputSnapshotFromRepository(
  options: BuildSettlementInputSnapshotOptions,
  repository: SettlementSnapshotReadRepository,
): Promise<SettlementInputSnapshot> {
  const boundary = makeBoundary(options.asOf);
  const requestedAt = new Date(
    validTimestamp(
      options.requestedAt ?? new Date().toISOString(),
      "requestedAt",
    ),
  ).toISOString();
  const snapshotId = options.snapshotId ?? globalThis.crypto.randomUUID();
  const requestId = options.requestId ?? globalThis.crypto.randomUUID();

  const results = await Promise.allSettled([
    repository.readBalanceContext(boundary),
    repository.readLiquidityContext(boundary),
    repository.readInventoryContext(boundary),
    repository.readFxContext(boundary),
    repository.readMerchantContexts(boundary),
    repository.readProfitContext(boundary),
    repository.readMarketContext(boundary),
  ]);

  const balance = settledEnvelope(
    results[0],
    defaultBalanceContext(),
    requestedAt,
    "BALANCE_POSITION",
  );
  const liquidity = settledEnvelope(
    results[1],
    defaultLiquidityContext(boundary),
    requestedAt,
    "LIQUIDITY_HISTORY",
  );
  const inventory = settledEnvelope(
    results[2],
    defaultInventoryContext(boundary.asOf),
    requestedAt,
    "VND_INVENTORY",
  );
  const fx = settledEnvelope(
    results[3],
    defaultFxContext(),
    requestedAt,
    "FX_MARKET_INPUTS",
  );
  const merchants = settledEnvelope(
    results[4],
    [],
    requestedAt,
    "MERCHANT_CONTEXT",
  );
  const profit = settledEnvelope(
    results[5],
    defaultProfitContext(),
    requestedAt,
    "PROFIT_CONTEXT",
  );
  const market = settledEnvelope(
    results[6],
    [],
    requestedAt,
    "MARKET_CONTEXT",
  );

  const envelopes = [
    balance,
    liquidity,
    inventory,
    fx,
    merchants,
    profit,
    market,
  ] as const;

  const manifests = await Promise.all(
    SETTLEMENT_INPUT_FRESHNESS_POLICIES.map(async (policy, index) => {
      const envelope = envelopes[index];
      const evidenceId = globalThis.crypto.randomUUID();
      return {
        source_key: policy.sourceKey,
        source_type: "SUPABASE_SELECT",
        source_system: "VND_SETTLEMENT_OS",
        observed_at: envelope.observedAt,
        cutoff_at: envelope.cutoffAt,
        record_count: envelope.recordCount,
        freshness_policy_key: policy.freshnessPolicyKey,
        freshness_status: classifyFreshness(
          boundary.asOf,
          envelope.cutoffAt,
          policy,
        ),
        completeness_status: envelope.completenessStatus,
        content_digest: await stableSnapshotDigest(envelope.data),
        evidence_ids: [evidenceId],
        limitations: [...envelope.limitations],
      } satisfies SnapshotSourceManifest;
    }),
  );

  const blockingReasons = manifests.flatMap((manifest, index) => {
    const policy = SETTLEMENT_INPUT_FRESHNESS_POLICIES[index];
    if (!policy.blocking) return [];
    if (
      manifest.freshness_status === "MISSING" ||
      manifest.freshness_status === "STALE" ||
      manifest.freshness_status === "FUTURE_DATED" ||
      manifest.completeness_status === "UNAVAILABLE" ||
      manifest.completeness_status === "INVALID"
    ) {
      return [`${manifest.source_key}_BLOCKED`];
    }
    return [];
  });
  if (!balance.data.position) {
    blockingReasons.push("BALANCE_POSITION_MISSING");
  }

  const limitations = [
    ...new Set(
      manifests.flatMap((manifest, index) => {
        const policy = SETTLEMENT_INPUT_FRESHNESS_POLICIES[index];
        const statusLimitations =
          policy.requiredForComplete &&
          (manifest.freshness_status !== "FRESH" ||
            manifest.completeness_status !== "COMPLETE")
            ? [
                `${manifest.source_key}_${manifest.freshness_status}`,
                `${manifest.source_key}_${manifest.completeness_status}`,
              ]
            : [];
        return [...manifest.limitations, ...statusLimitations];
      }),
    ),
  ];
  const qualityStatus: SnapshotQualityStatus =
    blockingReasons.length > 0
      ? "BLOCKED"
      : limitations.length > 0
        ? "LIMITED"
        : "COMPLETE";

  const rulesetDigest = await stableSnapshotDigest(
    DEFAULT_RULESET_BASIS,
  );
  const inputDigest = await stableSnapshotDigest({
    contract_version: SETTLEMENT_INPUT_CONTRACT_VERSION,
    as_of: boundary.asOf,
    currency: "VND",
    operating_timezone: "Asia/Shanghai",
    ruleset_digest: rulesetDigest,
    source_digests: manifests.map((manifest) => ({
      source_key: manifest.source_key,
      content_digest: manifest.content_digest,
      cutoff_at: manifest.cutoff_at,
      completeness_status: manifest.completeness_status,
    })),
    balance_position: balance.data.position,
    liquidity_context: liquidity.data,
    inventory_context: inventory.data,
    fx_context: fx.data,
    merchant_contexts: merchants.data,
    profit_context: profit.data,
    market_context: market.data,
    shadow_guard: SETTLEMENT_INPUT_SHADOW_GUARD,
  });

  return {
    contract_version: SETTLEMENT_INPUT_CONTRACT_VERSION,
    snapshot_id: snapshotId,
    request_id: requestId,
    requested_at: requestedAt,
    created_at: new Date().toISOString(),
    as_of: boundary.asOf,
    currency: "VND",
    operating_timezone: "Asia/Shanghai",
    run_trigger: options.runTrigger ?? "MANUAL",
    mode: "SHADOW",
    ruleset_ref: {
      ruleset_code: "VND_SETTLEMENT_INTELLIGENCE_RULESET",
      ruleset_version: "1.0.0",
      ruleset_digest: rulesetDigest,
    },
    input_digest: inputDigest,
    data_sources: manifests,
    balance_position: balance.data.position,
    liquidity_context: liquidity.data,
    inventory_context: inventory.data,
    fx_context: fx.data,
    merchant_contexts: merchants.data,
    profit_context: profit.data,
    market_context: market.data,
    data_quality: {
      status: qualityStatus,
      limitations,
      blocking_reasons: [...new Set(blockingReasons)],
    },
    input_evidence: manifests.map((manifest) => ({
      evidence_id: manifest.evidence_ids[0],
      source_key: manifest.source_key,
      source_type: "SUPABASE_SELECT",
      observed_at: manifest.observed_at,
      cutoff_at: manifest.cutoff_at,
      content_digest: manifest.content_digest,
      extraction_version: "SETTLEMENT_READ_AGGREGATION_V1",
      classification: "INTERNAL_OPERATIONAL_DATA",
      redaction_status: "NO_SECRETS_INCLUDED",
    })),
    shadow_guard: SETTLEMENT_INPUT_SHADOW_GUARD,
  };
}
