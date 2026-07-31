import Decimal from "decimal.js";

import {
  SETTLEMENT_INPUT_CONTRACT_VERSION,
  SETTLEMENT_INPUT_SHADOW_GUARD,
  shanghaiOperatingDate,
  stableSnapshotDigest,
  type FxRateInput,
  type InventoryBatchInput,
  type SettlementInputSnapshotV1,
  type SnapshotQualityStatus,
  type SnapshotSourceKey,
} from "./settlement-input-snapshot";

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export const SETTLEMENT_DETERMINISTIC_CONTRACT_VERSION =
  "SETTLEMENT_DETERMINISTIC_CALCULATION_OUTPUT_V1" as const;
export const SETTLEMENT_DETERMINISTIC_ENGINE_VERSION = "1.0.0" as const;
export const SETTLEMENT_DETERMINISTIC_RULESET_VERSION = "1.0.0" as const;

export const SETTLEMENT_DETERMINISTIC_RULES = Object.freeze({
  ruleset_code: "VND_DETERMINISTIC_CALCULATION_RULESET",
  ruleset_version: SETTLEMENT_DETERMINISTIC_RULESET_VERSION,
  input_ruleset_code: "VND_SETTLEMENT_INTELLIGENCE_RULESET",
  input_ruleset_version: "1.0.0",
  reserve_ratio: "0.50",
  settleable_ratio: "0.50",
  liquidity_safety_buffer: "0.10",
  minimum_margin: "0.002",
  target_margin: "0.005",
  inventory_cost_method: "FIFO_ACTUAL_TOPUP_V1",
  rate_direction: "VND_PER_USDT",
  peak_window: "16:00-23:00",
  decimal_precision: 40,
  rounding_mode: "ROUND_HALF_UP",
  derived_vnd_scale: 4,
  derived_usdt_scale: 12,
  rate_scale: 12,
  ratio_scale: 12,
  shadow_mode: true,
});

export const SETTLEMENT_DETERMINISTIC_SHADOW_GUARD =
  SETTLEMENT_INPUT_SHADOW_GUARD;

type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer U)[]
    ? readonly DeepReadonly<U>[]
    : T extends object
      ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
      : T;

export type CalculationStatus = SnapshotQualityStatus;
export type MarginBand =
  | "BELOW_PROTECTION"
  | "BETWEEN_PROTECTION_AND_TARGET"
  | "AT_OR_ABOVE_TARGET"
  | "NOT_EVALUATED";

export interface FormulaResultV1 {
  formula_id: string;
  formula_version: "1.0.0";
  status: CalculationStatus;
  input_paths: string[];
  output_path: string;
  value: string | null;
  evidence_refs: string[];
}

export interface CalculationSectionBase {
  status: CalculationStatus;
  limitations: string[];
  blocking_reasons: string[];
  evidence_refs: string[];
}

export interface LiquidityCalculationResultV1
  extends CalculationSectionBase {
  gross_balance_vnd: string | null;
  source_reserve_balance_vnd: string | null;
  calculated_reserve_balance_vnd: string | null;
  source_settleable_balance_vnd: string | null;
  calculated_settleable_balance_vnd: string | null;
  reserve_ratio: string;
  settleable_ratio: string;
  forecast_gross_payin_vnd: string | null;
  forecast_gross_payout_vnd: string | null;
  gross_net_flow_vnd: string | null;
  gross_net_demand_vnd: string | null;
  forecast_settleable_payin_vnd: string | null;
  forecast_settleable_payout_vnd: string | null;
  settleable_net_flow_vnd: string | null;
  settleable_net_demand_vnd: string | null;
  safety_buffer_vnd: string | null;
  required_opening_settleable_capacity_vnd: string | null;
  settleable_capacity_gap_vnd: string | null;
  projected_settleable_after_flows_vnd: string | null;
  gross_capacity_gap_equivalent_vnd: string | null;
  peak_window: "16:00-23:00";
  peak_forecast_gross_payin_vnd: string | null;
  peak_forecast_gross_payout_vnd: string | null;
  peak_settleable_net_demand_vnd: string | null;
}

export interface FifoAllocationV1 {
  allocation_sequence: number | null;
  batch_id: string;
  batch_date: string;
  batch_time: string | null;
  time_precision: "DATE_ONLY" | "EXACT";
  sequence_within_date: number | null;
  source: string;
  ordering_status: "DETERMINISTIC" | "UNRESOLVED_FULL_GROUP";
  cost_rate_vnd_per_usdt: string;
  consumed_vnd: string;
  cost_basis_usdt: string;
  remaining_after_vnd: string;
}

export interface FifoCostCalculationResultV1
  extends CalculationSectionBase {
  method: "FIFO_ACTUAL_TOPUP_V1";
  requested_consumption_vnd: string | null;
  allocated_vnd: string | null;
  unallocated_vnd: string | null;
  ordering_unresolved_vnd: string | null;
  cost_basis_usdt: string | null;
  weighted_cost_rate_vnd_per_usdt: string | null;
  is_fully_covered: boolean | null;
  ordering_status:
    | "DETERMINISTIC"
    | "UNRESOLVED_FULL_GROUP"
    | "BLOCKED_BY_AMBIGUOUS_PARTIAL_GROUP";
  allocations: FifoAllocationV1[];
}

export interface DailyProfitCalculationV1 {
  pricing_run_id: string;
  profit_date: string;
  merchant_principal_usdt: string;
  merchant_fee_revenue_usdt: string;
  signed_dcc_revenue_usdt: string;
  realized_fx_profit_usdt: string;
  channel_fees_usdt: string;
  other_actual_fees_usdt: string;
  cash_profit_usdt: string;
  source_cash_profit_usdt: string;
  cash_profit_difference_usdt: string;
  cash_profit_margin: string | null;
  signed_internal_funding_advantage_usdt: string;
  shadow_cost_usdt: string;
  opportunity_cost_usdt: string;
  unrealized_risk_cost_usdt: string;
  economic_profit_usdt: string;
  source_economic_profit_usdt: string;
  economic_profit_difference_usdt: string;
  economic_profit_margin: string | null;
  data_status: string;
}

export interface ProfitCalculationResultV1 extends CalculationSectionBase {
  daily_results: DailyProfitCalculationV1[];
  aggregate: {
    merchant_principal_usdt: string;
    merchant_fee_revenue_usdt: string;
    signed_dcc_revenue_usdt: string;
    realized_fx_profit_usdt: string;
    channel_fees_usdt: string;
    other_actual_fees_usdt: string;
    cash_profit_usdt: string;
    source_cash_profit_usdt: string;
    cash_profit_difference_usdt: string;
    cash_profit_margin: string | null;
    signed_internal_funding_advantage_usdt: string;
    shadow_cost_usdt: string;
    opportunity_cost_usdt: string;
    unrealized_risk_cost_usdt: string;
    economic_profit_usdt: string;
    source_economic_profit_usdt: string;
    economic_profit_difference_usdt: string;
    economic_profit_margin: string | null;
  } | null;
}

export interface FxSpreadValueV1 {
  absolute_vnd_per_usdt: string | null;
  ratio: string | null;
}

export interface FxSpreadCalculationResultV1
  extends CalculationSectionBase {
  rate_direction: "VND_PER_USDT";
  xe_rate: string | null;
  p2p_cost_rate: string | null;
  upstream_quote_rate: string | null;
  current_customer_quote_rate: string | null;
  weighted_fifo_cost_rate: string | null;
  p2p_minus_xe: FxSpreadValueV1;
  upstream_minus_xe: FxSpreadValueV1;
  fifo_minus_xe: FxSpreadValueV1;
  p2p_minus_fifo: FxSpreadValueV1;
  customer_quote_minus_fifo: FxSpreadValueV1;
  classification: "NOT_EVALUATED";
}

export interface BusinessRuleEvaluationResultV1
  extends CalculationSectionBase {
  reserve_ratio: "0.50";
  settleable_ratio: "0.50";
  liquidity_safety_buffer: "0.10";
  minimum_margin: "0.002";
  target_margin: "0.005";
  cash_profit_margin: string | null;
  cash_profit_margin_band: MarginBand;
  economic_profit_margin: string | null;
  economic_profit_margin_band: MarginBand;
  merchant_margin_evaluations: Array<{
    merchant_name: string;
    margin: string | null;
    margin_band: MarginBand;
  }>;
}

export interface SettlementDeterministicCalculationResultV1 {
  contract_version: typeof SETTLEMENT_DETERMINISTIC_CONTRACT_VERSION;
  engine_version: typeof SETTLEMENT_DETERMINISTIC_ENGINE_VERSION;
  snapshot_id: string;
  request_id: string;
  input_digest: string;
  ruleset_version: typeof SETTLEMENT_DETERMINISTIC_RULESET_VERSION;
  ruleset_ref: {
    ruleset_code: "VND_DETERMINISTIC_CALCULATION_RULESET";
    ruleset_version: typeof SETTLEMENT_DETERMINISTIC_RULESET_VERSION;
    ruleset_digest: string;
    input_ruleset_code: string;
    input_ruleset_version: string;
    input_ruleset_digest: string;
  };
  as_of: string;
  currency: "VND";
  mode: "SHADOW";
  status: CalculationStatus;
  liquidity_result: LiquidityCalculationResultV1 | null;
  fifo_cost_result: FifoCostCalculationResultV1 | null;
  profit_result: ProfitCalculationResultV1 | null;
  fx_result: FxSpreadCalculationResultV1 | null;
  business_rule_result: BusinessRuleEvaluationResultV1 | null;
  formula_results: FormulaResultV1[];
  evidence_refs: string[];
  limitations: string[];
  blocking_reasons: string[];
  result_digest: string;
  shadow_guard: typeof SETTLEMENT_DETERMINISTIC_SHADOW_GUARD;
}

interface SourceAssessment {
  status: CalculationStatus;
  usable: boolean;
  limitations: string[];
  blockingReasons: string[];
  evidenceRefs: string[];
}

interface SectionCalculation<T> {
  result: T;
  formulas: FormulaResultV1[];
}

interface ParsedInventoryBatch {
  source: DeepReadonly<InventoryBatchInput>;
  remaining: Decimal;
  rate: Decimal;
  sequence: number | null;
}

const STATUS_RANK: Record<CalculationStatus, number> = {
  COMPLETE: 0,
  LIMITED: 1,
  BLOCKED: 2,
};

const VND_SCALE = SETTLEMENT_DETERMINISTIC_RULES.derived_vnd_scale;
const USDT_SCALE = SETTLEMENT_DETERMINISTIC_RULES.derived_usdt_scale;
const RATE_SCALE = SETTLEMENT_DETERMINISTIC_RULES.rate_scale;
const RATIO_SCALE = SETTLEMENT_DETERMINISTIC_RULES.ratio_scale;
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;

function combineStatus(
  ...statuses: CalculationStatus[]
): CalculationStatus {
  return statuses.reduce((highest, status) =>
    STATUS_RANK[status] > STATUS_RANK[highest] ? status : highest,
  "COMPLETE");
}

function sortedUnique(values: readonly string[]) {
  return [...new Set(values)].sort((left, right) =>
    left.localeCompare(right),
  );
}

function decimal(
  value: unknown,
  label: string,
  sign: "ANY" | "NON_NEGATIVE" | "POSITIVE" = "ANY",
) {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a decimal string`);
  }
  const parsed = new Decimal(value);
  if (!parsed.isFinite()) {
    throw new Error(`${label} must be finite`);
  }
  if (sign === "NON_NEGATIVE" && parsed.isNegative()) {
    throw new Error(`${label} must be non-negative`);
  }
  if (sign === "POSITIVE" && parsed.lte(0)) {
    throw new Error(`${label} must be positive`);
  }
  return parsed;
}

function fixed(value: Decimal, scale: number) {
  const rounded = value.toDecimalPlaces(scale, Decimal.ROUND_HALF_UP);
  return (rounded.isZero() ? new Decimal(0) : rounded).toFixed(scale);
}

function vnd(value: Decimal) {
  return fixed(value, VND_SCALE);
}

function usdt(value: Decimal) {
  return fixed(value, USDT_SCALE);
}

function rate(value: Decimal) {
  return fixed(value, RATE_SCALE);
}

function ratio(value: Decimal) {
  return fixed(value, RATIO_SCALE);
}

function validTimestamp(value: string) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function assessSource(
  snapshot: DeepReadonly<SettlementInputSnapshotV1>,
  sourceKey: SnapshotSourceKey,
  critical: boolean,
): SourceAssessment {
  const source = snapshot.data_sources.find(
    (candidate) => candidate.source_key === sourceKey,
  );
  if (!source) {
    const code = `${sourceKey}_MANIFEST_MISSING`;
    return {
      status: critical ? "BLOCKED" : "LIMITED",
      usable: false,
      limitations: critical ? [] : [code],
      blockingReasons: critical ? [code] : [],
      evidenceRefs: [],
    };
  }

  const limitations = [...source.limitations];
  const blockingReasons: string[] = [];
  let status: CalculationStatus = "COMPLETE";
  let usable = true;

  if (
    source.freshness_status === "FUTURE_DATED" ||
    source.completeness_status === "INVALID"
  ) {
    status = "BLOCKED";
    usable = false;
    if (source.freshness_status === "FUTURE_DATED") {
      blockingReasons.push(`${sourceKey}_FUTURE_DATED`);
    }
    if (source.completeness_status === "INVALID") {
      blockingReasons.push(`${sourceKey}_INVALID`);
    }
  } else if (
    source.freshness_status === "MISSING" ||
    source.completeness_status === "UNAVAILABLE"
  ) {
    status = critical ? "BLOCKED" : "LIMITED";
    usable = false;
    const code = `${sourceKey}_UNAVAILABLE`;
    if (critical) blockingReasons.push(code);
    else limitations.push(code);
  } else if (
    source.freshness_status === "STALE" &&
    critical
  ) {
    status = "BLOCKED";
    usable = false;
    blockingReasons.push(`${sourceKey}_STALE`);
  } else if (
    source.freshness_status !== "FRESH" ||
    source.completeness_status !== "COMPLETE" ||
    source.limitations.length > 0
  ) {
    status = "LIMITED";
    if (source.freshness_status !== "FRESH") {
      limitations.push(`${sourceKey}_${source.freshness_status}`);
    }
    if (source.completeness_status !== "COMPLETE") {
      limitations.push(`${sourceKey}_${source.completeness_status}`);
    }
  }

  return {
    status,
    usable,
    limitations: sortedUnique(limitations),
    blockingReasons: sortedUnique(blockingReasons),
    evidenceRefs: sortedUnique([...source.evidence_ids]),
  };
}

function formula(
  formulaId: string,
  status: CalculationStatus,
  inputPaths: string[],
  outputPath: string,
  value: string | null,
  evidenceRefs: string[],
): FormulaResultV1 {
  return {
    formula_id: formulaId,
    formula_version: "1.0.0",
    status,
    input_paths: inputPaths,
    output_path: outputPath,
    value,
    evidence_refs: evidenceRefs,
  };
}

function blockedLiquidity(
  assessment: SourceAssessment,
  reasons: string[],
): SectionCalculation<LiquidityCalculationResultV1> {
  return {
    result: {
      status: "BLOCKED",
      limitations: assessment.limitations,
      blocking_reasons: sortedUnique([
        ...assessment.blockingReasons,
        ...reasons,
      ]),
      evidence_refs: assessment.evidenceRefs,
      gross_balance_vnd: null,
      source_reserve_balance_vnd: null,
      calculated_reserve_balance_vnd: null,
      source_settleable_balance_vnd: null,
      calculated_settleable_balance_vnd: null,
      reserve_ratio: SETTLEMENT_DETERMINISTIC_RULES.reserve_ratio,
      settleable_ratio:
        SETTLEMENT_DETERMINISTIC_RULES.settleable_ratio,
      forecast_gross_payin_vnd: null,
      forecast_gross_payout_vnd: null,
      gross_net_flow_vnd: null,
      gross_net_demand_vnd: null,
      forecast_settleable_payin_vnd: null,
      forecast_settleable_payout_vnd: null,
      settleable_net_flow_vnd: null,
      settleable_net_demand_vnd: null,
      safety_buffer_vnd: null,
      required_opening_settleable_capacity_vnd: null,
      settleable_capacity_gap_vnd: null,
      projected_settleable_after_flows_vnd: null,
      gross_capacity_gap_equivalent_vnd: null,
      peak_window: "16:00-23:00",
      peak_forecast_gross_payin_vnd: null,
      peak_forecast_gross_payout_vnd: null,
      peak_settleable_net_demand_vnd: null,
    },
    formulas: [],
  };
}

function calculateLiquidity(
  snapshot: DeepReadonly<SettlementInputSnapshotV1>,
): SectionCalculation<LiquidityCalculationResultV1> {
  const balanceAssessment = assessSource(
    snapshot,
    "BALANCE_POSITION",
    true,
  );
  const liquidityAssessment = assessSource(
    snapshot,
    "LIQUIDITY_HISTORY",
    false,
  );
  const assessment: SourceAssessment = {
    status: combineStatus(
      balanceAssessment.status,
      liquidityAssessment.status,
    ),
    usable: balanceAssessment.usable && liquidityAssessment.usable,
    limitations: sortedUnique([
      ...balanceAssessment.limitations,
      ...liquidityAssessment.limitations,
    ]),
    blockingReasons: sortedUnique([
      ...balanceAssessment.blockingReasons,
      ...liquidityAssessment.blockingReasons,
    ]),
    evidenceRefs: sortedUnique([
      ...balanceAssessment.evidenceRefs,
      ...liquidityAssessment.evidenceRefs,
    ]),
  };
  if (!snapshot.balance_position || !balanceAssessment.usable) {
    return blockedLiquidity(assessment, ["BALANCE_POSITION_MISSING"]);
  }

  try {
    const source = snapshot.balance_position;
    const gross = decimal(
      source.gross_balance_vnd,
      "gross_balance_vnd",
      "NON_NEGATIVE",
    );
    const sourceReserveRatio = decimal(
      source.reserve_ratio,
      "reserve_ratio",
      "NON_NEGATIVE",
    );
    const sourceSettleableRatio = decimal(
      source.settleable_ratio,
      "settleable_ratio",
      "NON_NEGATIVE",
    );
    const frozenReserveRatio = new Decimal(
      SETTLEMENT_DETERMINISTIC_RULES.reserve_ratio,
    );
    const frozenSettleableRatio = new Decimal(
      SETTLEMENT_DETERMINISTIC_RULES.settleable_ratio,
    );
    const sourceReserve = decimal(
      source.reserve_balance_vnd,
      "reserve_balance_vnd",
      "NON_NEGATIVE",
    );
    const sourceSettleable = decimal(
      source.settleable_balance_vnd,
      "settleable_balance_vnd",
      "NON_NEGATIVE",
    );
    const calculatedReserve = gross.mul(frozenReserveRatio);
    const calculatedSettleable = gross.mul(frozenSettleableRatio);
    const tolerance = new Decimal("0.00005");
    const invariantFailures: string[] = [];

    if (
      !sourceReserveRatio.eq(frozenReserveRatio) ||
      !sourceSettleableRatio.eq(frozenSettleableRatio) ||
      !sourceReserveRatio.plus(sourceSettleableRatio).eq(1)
    ) {
      invariantFailures.push("LIQUIDITY_RATIO_INVARIANT_MISMATCH");
    }
    if (
      sourceReserve.minus(calculatedReserve).abs().gt(tolerance) ||
      sourceSettleable.minus(calculatedSettleable).abs().gt(tolerance)
    ) {
      invariantFailures.push("LIQUIDITY_BALANCE_INVARIANT_MISMATCH");
    }
    if (invariantFailures.length > 0) {
      return blockedLiquidity(assessment, invariantFailures);
    }

    if (!liquidityAssessment.usable) {
      return {
        result: {
          status: "LIMITED",
          limitations: sortedUnique([
            ...assessment.limitations,
            "LIQUIDITY_FORECAST_UNAVAILABLE",
          ]),
          blocking_reasons: assessment.blockingReasons,
          evidence_refs: assessment.evidenceRefs,
          gross_balance_vnd: vnd(gross),
          source_reserve_balance_vnd: vnd(sourceReserve),
          calculated_reserve_balance_vnd: vnd(calculatedReserve),
          source_settleable_balance_vnd: vnd(sourceSettleable),
          calculated_settleable_balance_vnd: vnd(
            calculatedSettleable,
          ),
          reserve_ratio: SETTLEMENT_DETERMINISTIC_RULES.reserve_ratio,
          settleable_ratio:
            SETTLEMENT_DETERMINISTIC_RULES.settleable_ratio,
          forecast_gross_payin_vnd: null,
          forecast_gross_payout_vnd: null,
          gross_net_flow_vnd: null,
          gross_net_demand_vnd: null,
          forecast_settleable_payin_vnd: null,
          forecast_settleable_payout_vnd: null,
          settleable_net_flow_vnd: null,
          settleable_net_demand_vnd: null,
          safety_buffer_vnd: null,
          required_opening_settleable_capacity_vnd: null,
          settleable_capacity_gap_vnd: null,
          projected_settleable_after_flows_vnd: null,
          gross_capacity_gap_equivalent_vnd: null,
          peak_window: "16:00-23:00",
          peak_forecast_gross_payin_vnd: null,
          peak_forecast_gross_payout_vnd: null,
          peak_settleable_net_demand_vnd: null,
        },
        formulas: [],
      };
    }

    const payin = decimal(
      snapshot.liquidity_context.forecast_payin_vnd,
      "forecast_payin_vnd",
      "NON_NEGATIVE",
    );
    const payout = decimal(
      snapshot.liquidity_context.forecast_payout_vnd,
      "forecast_payout_vnd",
      "NON_NEGATIVE",
    );
    const grossNetFlow = payin.minus(payout);
    const grossNetDemand = Decimal.max(payout.minus(payin), 0);
    const settleablePayin = payin.mul(frozenSettleableRatio);
    const settleablePayout = payout.mul(frozenSettleableRatio);
    const settleableNetFlow = settleablePayin.minus(settleablePayout);
    const settleableNetDemand = Decimal.max(
      settleablePayout.minus(settleablePayin),
      0,
    );
    const safetyBuffer = settleableNetDemand.mul(
      SETTLEMENT_DETERMINISTIC_RULES.liquidity_safety_buffer,
    );
    const requiredCapacity = settleableNetDemand.plus(safetyBuffer);
    const capacityGap = Decimal.max(
      requiredCapacity.minus(sourceSettleable),
      0,
    );
    const projectedSettleable = sourceSettleable
      .plus(settleablePayin)
      .minus(settleablePayout);
    const grossGapEquivalent = capacityGap.div(frozenSettleableRatio);

    const peakRows = snapshot.liquidity_context.hourly_forecast.filter(
      (row) =>
        row.is_peak_window ||
        (row.local_hour >= 16 && row.local_hour <= 23),
    );
    let peakPayin: Decimal | null = null;
    let peakPayout: Decimal | null = null;
    let peakSettleableNetDemand: Decimal | null = null;
    const limitations = [...assessment.limitations];
    let sectionStatus = assessment.status;
    if (peakRows.length === 0) {
      limitations.push("PEAK_WINDOW_FORECAST_MISSING");
      sectionStatus = combineStatus(sectionStatus, "LIMITED");
    } else {
      peakPayin = peakRows.reduce(
        (sum, row) =>
          sum.plus(
            decimal(
              row.forecast_payin_vnd,
              "hourly_forecast.forecast_payin_vnd",
              "NON_NEGATIVE",
            ),
          ),
        new Decimal(0),
      );
      peakPayout = peakRows.reduce(
        (sum, row) =>
          sum.plus(
            decimal(
              row.forecast_payout_vnd,
              "hourly_forecast.forecast_payout_vnd",
              "NON_NEGATIVE",
            ),
          ),
        new Decimal(0),
      );
      peakSettleableNetDemand = Decimal.max(
        peakPayout.minus(peakPayin).mul(frozenSettleableRatio),
        0,
      );
    }

    const result: LiquidityCalculationResultV1 = {
      status: sectionStatus,
      limitations: sortedUnique(limitations),
      blocking_reasons: assessment.blockingReasons,
      evidence_refs: assessment.evidenceRefs,
      gross_balance_vnd: vnd(gross),
      source_reserve_balance_vnd: vnd(sourceReserve),
      calculated_reserve_balance_vnd: vnd(calculatedReserve),
      source_settleable_balance_vnd: vnd(sourceSettleable),
      calculated_settleable_balance_vnd: vnd(calculatedSettleable),
      reserve_ratio: SETTLEMENT_DETERMINISTIC_RULES.reserve_ratio,
      settleable_ratio: SETTLEMENT_DETERMINISTIC_RULES.settleable_ratio,
      forecast_gross_payin_vnd: vnd(payin),
      forecast_gross_payout_vnd: vnd(payout),
      gross_net_flow_vnd: vnd(grossNetFlow),
      gross_net_demand_vnd: vnd(grossNetDemand),
      forecast_settleable_payin_vnd: vnd(settleablePayin),
      forecast_settleable_payout_vnd: vnd(settleablePayout),
      settleable_net_flow_vnd: vnd(settleableNetFlow),
      settleable_net_demand_vnd: vnd(settleableNetDemand),
      safety_buffer_vnd: vnd(safetyBuffer),
      required_opening_settleable_capacity_vnd: vnd(requiredCapacity),
      settleable_capacity_gap_vnd: vnd(capacityGap),
      projected_settleable_after_flows_vnd: vnd(projectedSettleable),
      gross_capacity_gap_equivalent_vnd: vnd(grossGapEquivalent),
      peak_window: "16:00-23:00",
      peak_forecast_gross_payin_vnd:
        peakPayin === null ? null : vnd(peakPayin),
      peak_forecast_gross_payout_vnd:
        peakPayout === null ? null : vnd(peakPayout),
      peak_settleable_net_demand_vnd:
        peakSettleableNetDemand === null
          ? null
          : vnd(peakSettleableNetDemand),
    };
    const formulas = [
      formula(
        "LIQUIDITY_RESERVE_BALANCE_V1",
        sectionStatus,
        [
          "balance_position.gross_balance_vnd",
          "ruleset.reserve_ratio",
        ],
        "liquidity_result.calculated_reserve_balance_vnd",
        result.calculated_reserve_balance_vnd,
        assessment.evidenceRefs,
      ),
      formula(
        "LIQUIDITY_SETTLEABLE_BALANCE_V1",
        sectionStatus,
        [
          "balance_position.gross_balance_vnd",
          "ruleset.settleable_ratio",
        ],
        "liquidity_result.calculated_settleable_balance_vnd",
        result.calculated_settleable_balance_vnd,
        assessment.evidenceRefs,
      ),
      formula(
        "LIQUIDITY_SETTLEABLE_NET_DEMAND_V1",
        sectionStatus,
        [
          "liquidity_context.forecast_payin_vnd",
          "liquidity_context.forecast_payout_vnd",
          "ruleset.settleable_ratio",
        ],
        "liquidity_result.settleable_net_demand_vnd",
        result.settleable_net_demand_vnd,
        assessment.evidenceRefs,
      ),
      formula(
        "LIQUIDITY_CAPACITY_GAP_V1",
        sectionStatus,
        [
          "balance_position.settleable_balance_vnd",
          "liquidity_result.settleable_net_demand_vnd",
          "ruleset.liquidity_safety_buffer",
        ],
        "liquidity_result.settleable_capacity_gap_vnd",
        result.settleable_capacity_gap_vnd,
        assessment.evidenceRefs,
      ),
    ];
    return { result, formulas };
  } catch {
    return blockedLiquidity(assessment, ["LIQUIDITY_INPUT_INVALID"]);
  }
}

function batchOrderIsDeterministic(batches: ParsedInventoryBatch[]) {
  if (batches.length <= 1) return true;
  const sequences = batches.map((batch) => batch.sequence);
  if (
    sequences.every((sequence) => sequence !== null) &&
    new Set(sequences).size === batches.length
  ) {
    return true;
  }
  if (
    batches.every(
      (batch) =>
        batch.source.time_precision === "EXACT" &&
        batch.source.batch_time !== null,
    )
  ) {
    return (
      new Set(batches.map((batch) => batch.source.batch_time)).size ===
      batches.length
    );
  }
  return false;
}

function orderDeterministicBatches(batches: ParsedInventoryBatch[]) {
  return [...batches].sort((left, right) => {
    if (
      left.source.batch_time !== null &&
      right.source.batch_time !== null
    ) {
      const timeOrder = left.source.batch_time.localeCompare(
        right.source.batch_time,
      );
      if (timeOrder !== 0) return timeOrder;
    }
    if (
      left.sequence !== null &&
      right.sequence !== null &&
      left.sequence !== right.sequence
    ) {
      return left.sequence - right.sequence;
    }
    return left.source.id.localeCompare(right.source.id);
  });
}

function blockedFifo(
  assessment: SourceAssessment,
  requested: Decimal | null,
  allocated: Decimal | null,
  allocations: FifoAllocationV1[],
  limitations: string[],
  reasons: string[],
): SectionCalculation<FifoCostCalculationResultV1> {
  const unresolved =
    requested !== null && allocated !== null
      ? Decimal.max(requested.minus(allocated), 0)
      : null;
  return {
    result: {
      status: "BLOCKED",
      limitations: sortedUnique([
        ...assessment.limitations,
        ...limitations,
      ]),
      blocking_reasons: sortedUnique([
        ...assessment.blockingReasons,
        ...reasons,
      ]),
      evidence_refs: assessment.evidenceRefs,
      method: "FIFO_ACTUAL_TOPUP_V1",
      requested_consumption_vnd: requested === null ? null : vnd(requested),
      allocated_vnd: allocated === null ? null : vnd(allocated),
      unallocated_vnd: unresolved === null ? null : vnd(unresolved),
      ordering_unresolved_vnd: unresolved === null ? null : vnd(unresolved),
      cost_basis_usdt: null,
      weighted_cost_rate_vnd_per_usdt: null,
      is_fully_covered: null,
      ordering_status: "BLOCKED_BY_AMBIGUOUS_PARTIAL_GROUP",
      allocations,
    },
    formulas: [],
  };
}

function calculateFifoCost(
  snapshot: DeepReadonly<SettlementInputSnapshotV1>,
): SectionCalculation<FifoCostCalculationResultV1> {
  const assessment = assessSource(snapshot, "VND_INVENTORY", false);
  let requested: Decimal | null = null;
  try {
    requested = decimal(
      snapshot.liquidity_context.forecast_payout_vnd,
      "forecast_payout_vnd",
      "NON_NEGATIVE",
    );
  } catch {
    return blockedFifo(
      assessment,
      null,
      null,
      [],
      [],
      ["FIFO_REQUEST_INVALID"],
    );
  }

  if (!assessment.usable) {
    return {
      result: {
        status: assessment.status,
        limitations: sortedUnique([
          ...assessment.limitations,
          "FIFO_INVENTORY_UNAVAILABLE",
        ]),
        blocking_reasons: assessment.blockingReasons,
        evidence_refs: assessment.evidenceRefs,
        method: "FIFO_ACTUAL_TOPUP_V1",
        requested_consumption_vnd: vnd(requested),
        allocated_vnd: null,
        unallocated_vnd: null,
        ordering_unresolved_vnd: null,
        cost_basis_usdt: null,
        weighted_cost_rate_vnd_per_usdt: null,
        is_fully_covered: null,
        ordering_status: "DETERMINISTIC",
        allocations: [],
      },
      formulas: [],
    };
  }

  const asOfMs = validTimestamp(snapshot.as_of);
  if (asOfMs === null) {
    return blockedFifo(
      assessment,
      requested,
      new Decimal(0),
      [],
      [],
      ["FIFO_AS_OF_INVALID"],
    );
  }
  const localDate = shanghaiOperatingDate(snapshot.as_of);
  const limitations = [...assessment.limitations];
  const parsedBatches: ParsedInventoryBatch[] = [];

  if (
    snapshot.inventory_context.cost_method !==
    SETTLEMENT_DETERMINISTIC_RULES.inventory_cost_method
  ) {
    return blockedFifo(
      assessment,
      requested,
      new Decimal(0),
      [],
      limitations,
      ["FIFO_COST_METHOD_INVALID"],
    );
  }
  const positionAsOf = validTimestamp(
    snapshot.inventory_context.position_as_of,
  );
  if (positionAsOf === null || positionAsOf > asOfMs) {
    return blockedFifo(
      assessment,
      requested,
      new Decimal(0),
      [],
      limitations,
      ["FIFO_POSITION_AS_OF_INVALID"],
    );
  }

  try {
    for (const batch of snapshot.inventory_context.batches) {
      const remaining = decimal(
        batch.remaining_amount,
        `inventory batch ${batch.id} remaining_amount`,
        "NON_NEGATIVE",
      );
      if (remaining.eq(0)) continue;
      if (!batch.historical_cost_locked) {
        limitations.push("FIFO_UNLOCKED_BATCH_EXCLUDED");
        continue;
      }
      if (batch.status !== "OPEN") {
        limitations.push("FIFO_INELIGIBLE_STATUS_EXCLUDED");
        continue;
      }
      const costRate = decimal(
        batch.cost_rate,
        `inventory batch ${batch.id} cost_rate`,
        "POSITIVE",
      );
      if (batch.time_precision === "EXACT") {
        if (!batch.batch_time) {
          return blockedFifo(
            assessment,
            requested,
            new Decimal(0),
            [],
            limitations,
            ["FIFO_EXACT_BATCH_TIME_MISSING"],
          );
        }
        const batchTime = validTimestamp(batch.batch_time);
        if (batchTime === null) {
          return blockedFifo(
            assessment,
            requested,
            new Decimal(0),
            [],
            limitations,
            ["FIFO_BATCH_TIME_INVALID"],
          );
        }
        if (batchTime > asOfMs) {
          return blockedFifo(
            assessment,
            requested,
            new Decimal(0),
            [],
            limitations,
            ["FIFO_BATCH_AFTER_AS_OF"],
          );
        }
      } else {
        if (batch.batch_time !== null) {
          return blockedFifo(
            assessment,
            requested,
            new Decimal(0),
            [],
            limitations,
            ["FIFO_DATE_ONLY_BATCH_HAS_TIME"],
          );
        }
        if (batch.batch_date >= localDate) {
          limitations.push("FIFO_DATE_ONLY_AS_OF_DATE_EXCLUDED");
          continue;
        }
      }
      const sequence =
        typeof batch.sequence_within_date === "number" &&
        Number.isInteger(batch.sequence_within_date) &&
        batch.sequence_within_date > 0
          ? batch.sequence_within_date
          : null;
      parsedBatches.push({
        source: batch,
        remaining,
        rate: costRate,
        sequence,
      });
    }
  } catch {
    return blockedFifo(
      assessment,
      requested,
      new Decimal(0),
      [],
      limitations,
      ["FIFO_BATCH_INVALID"],
    );
  }

  try {
    const declaredTotal = decimal(
      snapshot.inventory_context.total_remaining_vnd,
      "inventory_context.total_remaining_vnd",
      "NON_NEGATIVE",
    );
    const parsedTotal = snapshot.inventory_context.batches.reduce(
      (sum, batch) =>
        sum.plus(
          decimal(
            batch.remaining_amount,
            `inventory batch ${batch.id} remaining_amount`,
            "NON_NEGATIVE",
          ),
        ),
      new Decimal(0),
    );
    if (declaredTotal.minus(parsedTotal).abs().gt("0.00005")) {
      limitations.push("FIFO_TOTAL_REMAINING_MISMATCH");
    }
  } catch {
    limitations.push("FIFO_TOTAL_REMAINING_UNVERIFIED");
  }
  if (
    snapshot.inventory_context.unmatched_inventory_status === "LIMITED"
  ) {
    limitations.push("FIFO_UNMATCHED_INVENTORY_LIMITED");
  }

  const groups = new Map<string, ParsedInventoryBatch[]>();
  for (const batch of parsedBatches) {
    const group = groups.get(batch.source.batch_date) ?? [];
    group.push(batch);
    groups.set(batch.source.batch_date, group);
  }

  let remainingRequest = requested;
  let allocated = new Decimal(0);
  let totalCost = new Decimal(0);
  let sequence = 1;
  let unresolvedFullGroup = false;
  let unresolvedFullGroupAmount = new Decimal(0);
  const allocations: FifoAllocationV1[] = [];

  for (const batchDate of [...groups.keys()].sort()) {
    if (remainingRequest.eq(0)) break;
    const group = groups.get(batchDate) ?? [];
    const deterministic = batchOrderIsDeterministic(group);
    const groupTotal = group.reduce(
      (sum, batch) => sum.plus(batch.remaining),
      new Decimal(0),
    );
    if (!deterministic && remainingRequest.lt(groupTotal)) {
      return blockedFifo(
        assessment,
        requested,
        allocated,
        allocations,
        [...limitations, "DATE_ONLY_FIFO_ORDER_UNRESOLVED"],
        ["FIFO_AMBIGUOUS_PARTIAL_GROUP"],
      );
    }

    const ordered = deterministic
      ? orderDeterministicBatches(group)
      : [...group].sort((left, right) =>
          left.source.id.localeCompare(right.source.id),
        );
    if (!deterministic) {
      unresolvedFullGroup = true;
      unresolvedFullGroupAmount =
        unresolvedFullGroupAmount.plus(groupTotal);
      limitations.push("DATE_ONLY_FIFO_ORDER_UNRESOLVED");
    }

    for (const batch of ordered) {
      if (remainingRequest.eq(0)) break;
      const consumed = Decimal.min(batch.remaining, remainingRequest);
      const costBasis = consumed.div(batch.rate);
      totalCost = totalCost.plus(costBasis);
      allocated = allocated.plus(consumed);
      remainingRequest = remainingRequest.minus(consumed);
      allocations.push({
        allocation_sequence: deterministic ? sequence : null,
        batch_id: batch.source.id,
        batch_date: batch.source.batch_date,
        batch_time: batch.source.batch_time,
        time_precision: batch.source.time_precision,
        sequence_within_date: batch.sequence,
        source: batch.source.source,
        ordering_status: deterministic
          ? "DETERMINISTIC"
          : "UNRESOLVED_FULL_GROUP",
        cost_rate_vnd_per_usdt: rate(batch.rate),
        consumed_vnd: vnd(consumed),
        cost_basis_usdt: usdt(costBasis),
        remaining_after_vnd: vnd(batch.remaining.minus(consumed)),
      });
      if (deterministic) sequence += 1;
    }
  }

  const sectionStatus = combineStatus(
    assessment.status,
    limitations.length > 0 ? "LIMITED" : "COMPLETE",
  );
  const weightedRate = totalCost.gt(0)
    ? allocated.div(totalCost)
    : null;
  const result: FifoCostCalculationResultV1 = {
    status: sectionStatus,
    limitations: sortedUnique(limitations),
    blocking_reasons: assessment.blockingReasons,
    evidence_refs: assessment.evidenceRefs,
    method: "FIFO_ACTUAL_TOPUP_V1",
    requested_consumption_vnd: vnd(requested),
    allocated_vnd: vnd(allocated),
    unallocated_vnd: vnd(remainingRequest),
    ordering_unresolved_vnd: vnd(unresolvedFullGroupAmount),
    cost_basis_usdt: usdt(totalCost),
    weighted_cost_rate_vnd_per_usdt:
      weightedRate === null ? null : rate(weightedRate),
    is_fully_covered: remainingRequest.eq(0),
    ordering_status: unresolvedFullGroup
      ? "UNRESOLVED_FULL_GROUP"
      : "DETERMINISTIC",
    allocations,
  };
  const formulas = [
    formula(
      "FIFO_COST_BASIS_V1",
      sectionStatus,
      [
        "liquidity_context.forecast_payout_vnd",
        "inventory_context.batches[].remaining_amount",
        "inventory_context.batches[].cost_rate",
      ],
      "fifo_cost_result.cost_basis_usdt",
      result.cost_basis_usdt,
      assessment.evidenceRefs,
    ),
    formula(
      "FIFO_WEIGHTED_COST_RATE_V1",
      sectionStatus,
      [
        "fifo_cost_result.allocated_vnd",
        "fifo_cost_result.cost_basis_usdt",
      ],
      "fifo_cost_result.weighted_cost_rate_vnd_per_usdt",
      result.weighted_cost_rate_vnd_per_usdt,
      assessment.evidenceRefs,
    ),
  ];
  return { result, formulas };
}

interface ProfitComponents {
  merchantPrincipal: Decimal;
  merchantFee: Decimal;
  dcc: Decimal;
  realizedFx: Decimal;
  channelFees: Decimal;
  otherActualFees: Decimal;
  sourceCashProfit: Decimal;
  internalFundingAdvantage: Decimal;
  shadowCost: Decimal;
  opportunityCost: Decimal;
  unrealizedRiskCost: Decimal;
  sourceEconomicProfit: Decimal;
}

function parseProfitComponents(
  metric: DeepReadonly<
    SettlementInputSnapshotV1["profit_context"]["daily_metrics"][number]
  >,
): ProfitComponents {
  return {
    merchantPrincipal: decimal(
      metric.merchant_principal_usdt,
      "merchant_principal_usdt",
      "NON_NEGATIVE",
    ),
    merchantFee: decimal(
      metric.merchant_fee_revenue_usdt,
      "merchant_fee_revenue_usdt",
      "NON_NEGATIVE",
    ),
    dcc: decimal(
      metric.signed_dcc_revenue_usdt,
      "signed_dcc_revenue_usdt",
    ),
    realizedFx: decimal(
      metric.realized_fx_profit_usdt,
      "realized_fx_profit_usdt",
    ),
    channelFees: decimal(
      metric.channel_fees_usdt,
      "channel_fees_usdt",
      "NON_NEGATIVE",
    ),
    otherActualFees: decimal(
      metric.other_actual_fees_usdt,
      "other_actual_fees_usdt",
      "NON_NEGATIVE",
    ),
    sourceCashProfit: decimal(
      metric.cash_profit_usdt,
      "cash_profit_usdt",
    ),
    internalFundingAdvantage: decimal(
      metric.signed_internal_funding_advantage_usdt,
      "signed_internal_funding_advantage_usdt",
    ),
    shadowCost: decimal(
      metric.shadow_cost_usdt,
      "shadow_cost_usdt",
      "NON_NEGATIVE",
    ),
    opportunityCost: decimal(
      metric.opportunity_cost_usdt,
      "opportunity_cost_usdt",
      "NON_NEGATIVE",
    ),
    unrealizedRiskCost: decimal(
      metric.unrealized_risk_cost_usdt,
      "unrealized_risk_cost_usdt",
      "NON_NEGATIVE",
    ),
    sourceEconomicProfit: decimal(
      metric.economic_profit_usdt,
      "economic_profit_usdt",
    ),
  };
}

function calculateProfitValues(components: ProfitComponents) {
  const cashProfit = components.merchantFee
    .plus(components.dcc)
    .plus(components.realizedFx)
    .minus(components.channelFees)
    .minus(components.otherActualFees);
  const economicProfit = cashProfit
    .plus(components.internalFundingAdvantage)
    .minus(components.shadowCost)
    .minus(components.opportunityCost)
    .minus(components.unrealizedRiskCost);
  return {
    cashProfit,
    economicProfit,
    cashMargin: components.merchantPrincipal.gt(0)
      ? cashProfit.div(components.merchantPrincipal)
      : null,
    economicMargin: components.merchantPrincipal.gt(0)
      ? economicProfit.div(components.merchantPrincipal)
      : null,
  };
}

function zeroProfitComponents(): ProfitComponents {
  return {
    merchantPrincipal: new Decimal(0),
    merchantFee: new Decimal(0),
    dcc: new Decimal(0),
    realizedFx: new Decimal(0),
    channelFees: new Decimal(0),
    otherActualFees: new Decimal(0),
    sourceCashProfit: new Decimal(0),
    internalFundingAdvantage: new Decimal(0),
    shadowCost: new Decimal(0),
    opportunityCost: new Decimal(0),
    unrealizedRiskCost: new Decimal(0),
    sourceEconomicProfit: new Decimal(0),
  };
}

function addProfitComponents(
  total: ProfitComponents,
  value: ProfitComponents,
) {
  for (const key of Object.keys(total) as (keyof ProfitComponents)[]) {
    total[key] = total[key].plus(value[key]);
  }
}

function calculateProfit(
  snapshot: DeepReadonly<SettlementInputSnapshotV1>,
): SectionCalculation<ProfitCalculationResultV1> {
  const assessment = assessSource(snapshot, "PROFIT_CONTEXT", false);
  if (!assessment.usable) {
    return {
      result: {
        status: assessment.status,
        limitations: sortedUnique([
          ...assessment.limitations,
          "PROFIT_CONTEXT_UNAVAILABLE",
        ]),
        blocking_reasons: assessment.blockingReasons,
        evidence_refs: assessment.evidenceRefs,
        daily_results: [],
        aggregate: null,
      },
      formulas: [],
    };
  }
  if (snapshot.profit_context.daily_metrics.length === 0) {
    return {
      result: {
        status: "LIMITED",
        limitations: sortedUnique([
          ...assessment.limitations,
          "PROFIT_CONTEXT_EMPTY",
        ]),
        blocking_reasons: assessment.blockingReasons,
        evidence_refs: assessment.evidenceRefs,
        daily_results: [],
        aggregate: null,
      },
      formulas: [],
    };
  }

  const limitations = [...assessment.limitations];
  const total = zeroProfitComponents();
  const dailyResults: DailyProfitCalculationV1[] = [];
  const orderedMetrics = [...snapshot.profit_context.daily_metrics].sort(
    (left, right) => {
      const dateOrder = left.profit_date.localeCompare(right.profit_date);
      return dateOrder !== 0
        ? dateOrder
        : left.pricing_run_id.localeCompare(right.pricing_run_id);
    },
  );

  try {
    for (const metric of orderedMetrics) {
      const runTime = validTimestamp(metric.pricing_run_time);
      const asOf = validTimestamp(snapshot.as_of);
      if (runTime === null || asOf === null || runTime > asOf) {
        return {
          result: {
            status: "BLOCKED",
            limitations: sortedUnique(limitations),
            blocking_reasons: sortedUnique([
              ...assessment.blockingReasons,
              "PROFIT_METRIC_AFTER_AS_OF_OR_INVALID",
            ]),
            evidence_refs: assessment.evidenceRefs,
            daily_results: [],
            aggregate: null,
          },
          formulas: [],
        };
      }
      if (metric.data_status !== "COMPLETE") {
        limitations.push(`PROFIT_DATA_STATUS_${metric.data_status}`);
      }
      const components = parseProfitComponents(metric);
      const values = calculateProfitValues(components);
      if (
        values.cashProfit
          .minus(components.sourceCashProfit)
          .abs()
          .gte("0.0000000000005")
      ) {
        limitations.push("CASH_PROFIT_RECONCILIATION_DIFFERENCE");
      }
      if (
        values.economicProfit
          .minus(components.sourceEconomicProfit)
          .abs()
          .gte("0.0000000000005")
      ) {
        limitations.push("ECONOMIC_PROFIT_RECONCILIATION_DIFFERENCE");
      }
      addProfitComponents(total, components);
      dailyResults.push({
        pricing_run_id: metric.pricing_run_id,
        profit_date: metric.profit_date,
        merchant_principal_usdt: usdt(components.merchantPrincipal),
        merchant_fee_revenue_usdt: usdt(components.merchantFee),
        signed_dcc_revenue_usdt: usdt(components.dcc),
        realized_fx_profit_usdt: usdt(components.realizedFx),
        channel_fees_usdt: usdt(components.channelFees),
        other_actual_fees_usdt: usdt(components.otherActualFees),
        cash_profit_usdt: usdt(values.cashProfit),
        source_cash_profit_usdt: usdt(components.sourceCashProfit),
        cash_profit_difference_usdt: usdt(
          values.cashProfit.minus(components.sourceCashProfit),
        ),
        cash_profit_margin:
          values.cashMargin === null ? null : ratio(values.cashMargin),
        signed_internal_funding_advantage_usdt: usdt(
          components.internalFundingAdvantage,
        ),
        shadow_cost_usdt: usdt(components.shadowCost),
        opportunity_cost_usdt: usdt(components.opportunityCost),
        unrealized_risk_cost_usdt: usdt(
          components.unrealizedRiskCost,
        ),
        economic_profit_usdt: usdt(values.economicProfit),
        source_economic_profit_usdt: usdt(
          components.sourceEconomicProfit,
        ),
        economic_profit_difference_usdt: usdt(
          values.economicProfit.minus(components.sourceEconomicProfit),
        ),
        economic_profit_margin:
          values.economicMargin === null
            ? null
            : ratio(values.economicMargin),
        data_status: metric.data_status,
      });
    }
  } catch {
    return {
      result: {
        status: "BLOCKED",
        limitations: sortedUnique(limitations),
        blocking_reasons: sortedUnique([
          ...assessment.blockingReasons,
          "PROFIT_INPUT_INVALID",
        ]),
        evidence_refs: assessment.evidenceRefs,
        daily_results: [],
        aggregate: null,
      },
      formulas: [],
    };
  }

  const aggregateValues = calculateProfitValues(total);
  const sectionStatus = combineStatus(
    assessment.status,
    limitations.length > 0 ? "LIMITED" : "COMPLETE",
  );
  const aggregate = {
    merchant_principal_usdt: usdt(total.merchantPrincipal),
    merchant_fee_revenue_usdt: usdt(total.merchantFee),
    signed_dcc_revenue_usdt: usdt(total.dcc),
    realized_fx_profit_usdt: usdt(total.realizedFx),
    channel_fees_usdt: usdt(total.channelFees),
    other_actual_fees_usdt: usdt(total.otherActualFees),
    cash_profit_usdt: usdt(aggregateValues.cashProfit),
    source_cash_profit_usdt: usdt(total.sourceCashProfit),
    cash_profit_difference_usdt: usdt(
      aggregateValues.cashProfit.minus(total.sourceCashProfit),
    ),
    cash_profit_margin:
      aggregateValues.cashMargin === null
        ? null
        : ratio(aggregateValues.cashMargin),
    signed_internal_funding_advantage_usdt: usdt(
      total.internalFundingAdvantage,
    ),
    shadow_cost_usdt: usdt(total.shadowCost),
    opportunity_cost_usdt: usdt(total.opportunityCost),
    unrealized_risk_cost_usdt: usdt(total.unrealizedRiskCost),
    economic_profit_usdt: usdt(aggregateValues.economicProfit),
    source_economic_profit_usdt: usdt(total.sourceEconomicProfit),
    economic_profit_difference_usdt: usdt(
      aggregateValues.economicProfit.minus(total.sourceEconomicProfit),
    ),
    economic_profit_margin:
      aggregateValues.economicMargin === null
        ? null
        : ratio(aggregateValues.economicMargin),
  };
  const result: ProfitCalculationResultV1 = {
    status: sectionStatus,
    limitations: sortedUnique(limitations),
    blocking_reasons: assessment.blockingReasons,
    evidence_refs: assessment.evidenceRefs,
    daily_results: dailyResults,
    aggregate,
  };
  const formulas = [
    formula(
      "CASH_PROFIT_V1",
      sectionStatus,
      [
        "profit_context.daily_metrics[].merchant_fee_revenue_usdt",
        "profit_context.daily_metrics[].signed_dcc_revenue_usdt",
        "profit_context.daily_metrics[].realized_fx_profit_usdt",
        "profit_context.daily_metrics[].channel_fees_usdt",
        "profit_context.daily_metrics[].other_actual_fees_usdt",
      ],
      "profit_result.aggregate.cash_profit_usdt",
      aggregate.cash_profit_usdt,
      assessment.evidenceRefs,
    ),
    formula(
      "ECONOMIC_PROFIT_V1",
      sectionStatus,
      [
        "profit_result.aggregate.cash_profit_usdt",
        "profit_context.daily_metrics[].signed_internal_funding_advantage_usdt",
        "profit_context.daily_metrics[].shadow_cost_usdt",
        "profit_context.daily_metrics[].opportunity_cost_usdt",
        "profit_context.daily_metrics[].unrealized_risk_cost_usdt",
      ],
      "profit_result.aggregate.economic_profit_usdt",
      aggregate.economic_profit_usdt,
      assessment.evidenceRefs,
    ),
  ];
  return { result, formulas };
}

function selectRate(
  input: DeepReadonly<FxRateInput> | null,
  expectedType: FxRateInput["rate_type"],
  asOfMs: number,
  limitations: string[],
  blockingReasons: string[],
) {
  if (!input) return null;
  if (input.rate_type !== expectedType) {
    blockingReasons.push(`FX_RATE_TYPE_INVALID_${expectedType}`);
    return null;
  }
  const recordTime = validTimestamp(input.record_time);
  if (recordTime === null || recordTime > asOfMs) {
    blockingReasons.push(`FX_RATE_AFTER_AS_OF_OR_INVALID_${expectedType}`);
    return null;
  }
  try {
    return decimal(input.rate_value, expectedType, "POSITIVE");
  } catch {
    limitations.push(`FX_RATE_VALUE_INVALID_${expectedType}`);
    return null;
  }
}

function calculateSpread(
  left: Decimal | null,
  right: Decimal | null,
) {
  if (left === null || right === null || right.eq(0)) {
    return {
      absolute_vnd_per_usdt: null,
      ratio: null,
    };
  }
  const difference = left.minus(right);
  return {
    absolute_vnd_per_usdt: rate(difference),
    ratio: ratio(difference.div(right)),
  };
}

function calculateFxSpreads(
  snapshot: DeepReadonly<SettlementInputSnapshotV1>,
  fifo: FifoCostCalculationResultV1,
): SectionCalculation<FxSpreadCalculationResultV1> {
  const assessment = assessSource(snapshot, "FX_MARKET_INPUTS", false);
  if (!assessment.usable) {
    return {
      result: {
        status: assessment.status,
        limitations: sortedUnique([
          ...assessment.limitations,
          "FX_MARKET_INPUTS_UNAVAILABLE",
        ]),
        blocking_reasons: assessment.blockingReasons,
        evidence_refs: sortedUnique([
          ...assessment.evidenceRefs,
          ...fifo.evidence_refs,
        ]),
        rate_direction: "VND_PER_USDT",
        xe_rate: null,
        p2p_cost_rate: null,
        upstream_quote_rate: null,
        current_customer_quote_rate: null,
        weighted_fifo_cost_rate: null,
        p2p_minus_xe: {
          absolute_vnd_per_usdt: null,
          ratio: null,
        },
        upstream_minus_xe: {
          absolute_vnd_per_usdt: null,
          ratio: null,
        },
        fifo_minus_xe: {
          absolute_vnd_per_usdt: null,
          ratio: null,
        },
        p2p_minus_fifo: {
          absolute_vnd_per_usdt: null,
          ratio: null,
        },
        customer_quote_minus_fifo: {
          absolute_vnd_per_usdt: null,
          ratio: null,
        },
        classification: "NOT_EVALUATED",
      },
      formulas: [],
    };
  }

  const asOfMs = validTimestamp(snapshot.as_of);
  const limitations = [...assessment.limitations];
  const blockingReasons = [...assessment.blockingReasons];
  if (asOfMs === null) {
    blockingReasons.push("FX_AS_OF_INVALID");
  }

  const validAsOf = asOfMs ?? 0;
  const xe = selectRate(
    snapshot.fx_context.xe_rate,
    "XE_BASE_RATE",
    validAsOf,
    limitations,
    blockingReasons,
  );
  const upstream = selectRate(
    snapshot.fx_context.upstream_quote_rate,
    "UPSTREAM_QUOTE_RATE",
    validAsOf,
    limitations,
    blockingReasons,
  );
  const customer = selectRate(
    snapshot.fx_context.current_customer_quote_rate,
    "CURRENT_CUSTOMER_QUOTE_RATE",
    validAsOf,
    limitations,
    blockingReasons,
  );

  const eligibleP2p = snapshot.fx_context.p2p_cost_rates
    .filter((candidate) => {
      if (candidate.rate_type !== "P2P_COST_RATE") {
        blockingReasons.push("FX_RATE_TYPE_INVALID_P2P_COST_RATE");
        return false;
      }
      const timestamp = validTimestamp(candidate.record_time);
      if (timestamp === null || timestamp > validAsOf) {
        blockingReasons.push("FX_RATE_AFTER_AS_OF_OR_INVALID_P2P_COST_RATE");
        return false;
      }
      return true;
    })
    .sort((left, right) => {
      const timeOrder = right.record_time.localeCompare(left.record_time);
      return timeOrder !== 0 ? timeOrder : left.id.localeCompare(right.id);
    });
  let p2p: Decimal | null = null;
  if (eligibleP2p.length > 0) {
    try {
      p2p = decimal(
        eligibleP2p[0].rate_value,
        "P2P_COST_RATE",
        "POSITIVE",
      );
    } catch {
      limitations.push("FX_RATE_VALUE_INVALID_P2P_COST_RATE");
    }
  }

  if (xe === null) limitations.push("FX_XE_RATE_MISSING");
  if (p2p === null) limitations.push("FX_P2P_COST_RATE_MISSING");
  if (upstream === null) limitations.push("FX_UPSTREAM_QUOTE_RATE_MISSING");
  if (customer === null) {
    limitations.push("FX_CURRENT_CUSTOMER_QUOTE_RATE_MISSING");
  }

  let fifoRate: Decimal | null = null;
  if (fifo.weighted_cost_rate_vnd_per_usdt !== null) {
    try {
      fifoRate = decimal(
        fifo.weighted_cost_rate_vnd_per_usdt,
        "weighted_fifo_cost_rate",
        "POSITIVE",
      );
    } catch {
      limitations.push("FX_FIFO_RATE_INVALID");
    }
  } else if (
    fifo.requested_consumption_vnd !== "0.0000"
  ) {
    limitations.push("FX_FIFO_RATE_UNAVAILABLE");
  }

  const sectionStatus = blockingReasons.length
    ? "BLOCKED"
    : combineStatus(
        assessment.status,
        fifo.status,
        limitations.length > 0 ? "LIMITED" : "COMPLETE",
      );
  const evidenceRefs = sortedUnique([
    ...assessment.evidenceRefs,
    ...fifo.evidence_refs,
  ]);
  const result: FxSpreadCalculationResultV1 = {
    status: sectionStatus,
    limitations: sortedUnique(limitations),
    blocking_reasons: sortedUnique(blockingReasons),
    evidence_refs: evidenceRefs,
    rate_direction: "VND_PER_USDT",
    xe_rate: xe === null ? null : rate(xe),
    p2p_cost_rate: p2p === null ? null : rate(p2p),
    upstream_quote_rate: upstream === null ? null : rate(upstream),
    current_customer_quote_rate:
      customer === null ? null : rate(customer),
    weighted_fifo_cost_rate:
      fifoRate === null ? null : rate(fifoRate),
    p2p_minus_xe: calculateSpread(p2p, xe),
    upstream_minus_xe: calculateSpread(upstream, xe),
    fifo_minus_xe: calculateSpread(fifoRate, xe),
    p2p_minus_fifo: calculateSpread(p2p, fifoRate),
    customer_quote_minus_fifo: calculateSpread(customer, fifoRate),
    classification: "NOT_EVALUATED",
  };
  const formulas = [
    formula(
      "FX_P2P_MINUS_XE_V1",
      sectionStatus,
      ["fx_context.p2p_cost_rates", "fx_context.xe_rate"],
      "fx_result.p2p_minus_xe.absolute_vnd_per_usdt",
      result.p2p_minus_xe.absolute_vnd_per_usdt,
      evidenceRefs,
    ),
    formula(
      "FX_P2P_MINUS_FIFO_V1",
      sectionStatus,
      [
        "fx_context.p2p_cost_rates",
        "fifo_cost_result.weighted_cost_rate_vnd_per_usdt",
      ],
      "fx_result.p2p_minus_fifo.absolute_vnd_per_usdt",
      result.p2p_minus_fifo.absolute_vnd_per_usdt,
      evidenceRefs,
    ),
  ];
  return { result, formulas };
}

function marginBand(value: string | null): MarginBand {
  if (value === null) return "NOT_EVALUATED";
  const parsed = new Decimal(value);
  if (!parsed.isFinite()) return "NOT_EVALUATED";
  if (parsed.lt(SETTLEMENT_DETERMINISTIC_RULES.minimum_margin)) {
    return "BELOW_PROTECTION";
  }
  if (parsed.lt(SETTLEMENT_DETERMINISTIC_RULES.target_margin)) {
    return "BETWEEN_PROTECTION_AND_TARGET";
  }
  return "AT_OR_ABOVE_TARGET";
}

function evaluateBusinessRules(
  snapshot: DeepReadonly<SettlementInputSnapshotV1>,
  profit: ProfitCalculationResultV1,
): SectionCalculation<BusinessRuleEvaluationResultV1> {
  const merchantAssessment = assessSource(
    snapshot,
    "MERCHANT_CONTEXT",
    false,
  );
  const limitations = [...merchantAssessment.limitations];
  const merchantMarginEvaluations = [...snapshot.merchant_contexts]
    .sort((left, right) =>
      left.merchant_name.localeCompare(right.merchant_name),
    )
    .map((merchant) => {
      let normalizedMargin: string | null = null;
      if (merchant.current_profit_margin !== null) {
        try {
          normalizedMargin = ratio(
            decimal(
              merchant.current_profit_margin,
              "merchant.current_profit_margin",
            ),
          );
        } catch {
          limitations.push("MERCHANT_MARGIN_INVALID");
        }
      } else {
        limitations.push("MERCHANT_MARGIN_MISSING");
      }
      return {
        merchant_name: merchant.merchant_name,
        margin: normalizedMargin,
        margin_band: marginBand(normalizedMargin),
      };
    });

  const cashMargin = profit.aggregate?.cash_profit_margin ?? null;
  const economicMargin =
    profit.aggregate?.economic_profit_margin ?? null;
  if (!profit.aggregate) limitations.push("PROFIT_MARGIN_UNAVAILABLE");
  const sectionStatus = combineStatus(
    merchantAssessment.status,
    profit.status,
    limitations.length > 0 ? "LIMITED" : "COMPLETE",
  );
  const evidenceRefs = sortedUnique([
    ...merchantAssessment.evidenceRefs,
    ...profit.evidence_refs,
  ]);
  const result: BusinessRuleEvaluationResultV1 = {
    status: sectionStatus,
    limitations: sortedUnique(limitations),
    blocking_reasons: sortedUnique([
      ...merchantAssessment.blockingReasons,
      ...profit.blocking_reasons,
    ]),
    evidence_refs: evidenceRefs,
    reserve_ratio: "0.50",
    settleable_ratio: "0.50",
    liquidity_safety_buffer: "0.10",
    minimum_margin: "0.002",
    target_margin: "0.005",
    cash_profit_margin: cashMargin,
    cash_profit_margin_band: marginBand(cashMargin),
    economic_profit_margin: economicMargin,
    economic_profit_margin_band: marginBand(economicMargin),
    merchant_margin_evaluations: merchantMarginEvaluations,
  };
  const formulas = [
    formula(
      "BUSINESS_RULE_CASH_MARGIN_BAND_V1",
      sectionStatus,
      [
        "profit_result.aggregate.cash_profit_margin",
        "ruleset.minimum_margin",
        "ruleset.target_margin",
      ],
      "business_rule_result.cash_profit_margin_band",
      result.cash_profit_margin_band,
      evidenceRefs,
    ),
    formula(
      "BUSINESS_RULE_ECONOMIC_MARGIN_BAND_V1",
      sectionStatus,
      [
        "profit_result.aggregate.economic_profit_margin",
        "ruleset.minimum_margin",
        "ruleset.target_margin",
      ],
      "business_rule_result.economic_profit_margin_band",
      result.economic_profit_margin_band,
      evidenceRefs,
    ),
  ];
  return { result, formulas };
}

function globalContractBlockers(
  snapshot: DeepReadonly<SettlementInputSnapshotV1>,
) {
  const blockers: string[] = [];
  if (
    snapshot.contract_version !== SETTLEMENT_INPUT_CONTRACT_VERSION
  ) {
    blockers.push("INPUT_CONTRACT_VERSION_UNSUPPORTED");
  }
  if (snapshot.currency !== "VND") blockers.push("INPUT_CURRENCY_INVALID");
  if (snapshot.mode !== "SHADOW") blockers.push("INPUT_MODE_NOT_SHADOW");
  if (validTimestamp(snapshot.as_of) === null) {
    blockers.push("INPUT_AS_OF_INVALID");
  }
  if (!SHA256_PATTERN.test(snapshot.input_digest)) {
    blockers.push("INPUT_DIGEST_INVALID");
  }
  if (
    snapshot.ruleset_ref.ruleset_code !==
      SETTLEMENT_DETERMINISTIC_RULES.input_ruleset_code ||
    snapshot.ruleset_ref.ruleset_version !==
      SETTLEMENT_DETERMINISTIC_RULES.input_ruleset_version ||
    !SHA256_PATTERN.test(snapshot.ruleset_ref.ruleset_digest)
  ) {
    blockers.push("INPUT_RULESET_UNSUPPORTED_OR_INVALID");
  }
  for (const [key] of Object.entries(
    SETTLEMENT_DETERMINISTIC_SHADOW_GUARD,
  )) {
    if (
      (snapshot.shadow_guard as Record<string, unknown> | undefined)?.[
        key
      ] !== false
    ) {
      blockers.push(`SHADOW_GUARD_INVALID_${key.toUpperCase()}`);
    }
  }
  return sortedUnique(blockers);
}

async function blockedResult(
  snapshot: DeepReadonly<SettlementInputSnapshotV1>,
  rulesetDigest: string,
  blockers: string[],
): Promise<SettlementDeterministicCalculationResultV1> {
  const resultWithoutDigest = {
    contract_version: SETTLEMENT_DETERMINISTIC_CONTRACT_VERSION,
    engine_version: SETTLEMENT_DETERMINISTIC_ENGINE_VERSION,
    snapshot_id: snapshot.snapshot_id,
    request_id: snapshot.request_id,
    input_digest: snapshot.input_digest,
    ruleset_version: SETTLEMENT_DETERMINISTIC_RULESET_VERSION,
    ruleset_ref: {
      ruleset_code: "VND_DETERMINISTIC_CALCULATION_RULESET" as const,
      ruleset_version: SETTLEMENT_DETERMINISTIC_RULESET_VERSION,
      ruleset_digest: rulesetDigest,
      input_ruleset_code: snapshot.ruleset_ref.ruleset_code,
      input_ruleset_version: snapshot.ruleset_ref.ruleset_version,
      input_ruleset_digest: snapshot.ruleset_ref.ruleset_digest,
    },
    as_of: snapshot.as_of,
    currency: "VND" as const,
    mode: "SHADOW" as const,
    status: "BLOCKED" as const,
    liquidity_result: null,
    fifo_cost_result: null,
    profit_result: null,
    fx_result: null,
    business_rule_result: null,
    formula_results: [],
    evidence_refs: sortedUnique(
      snapshot.input_evidence.map((item) => item.evidence_id),
    ),
    limitations: sortedUnique(snapshot.data_quality.limitations),
    blocking_reasons: sortedUnique([
      ...snapshot.data_quality.blocking_reasons,
      ...blockers,
    ]),
    shadow_guard: SETTLEMENT_DETERMINISTIC_SHADOW_GUARD,
  };
  return {
    ...resultWithoutDigest,
    result_digest: await stableSnapshotDigest(resultWithoutDigest),
  };
}

export async function calculateSettlementDeterministicResult(
  snapshot: DeepReadonly<SettlementInputSnapshotV1>,
): Promise<SettlementDeterministicCalculationResultV1> {
  const rulesetDigest = await stableSnapshotDigest(
    SETTLEMENT_DETERMINISTIC_RULES,
  );
  const contractBlockers = globalContractBlockers(snapshot);
  if (contractBlockers.length > 0) {
    return blockedResult(snapshot, rulesetDigest, contractBlockers);
  }

  const liquidity = calculateLiquidity(snapshot);
  const fifo = calculateFifoCost(snapshot);
  const profit = calculateProfit(snapshot);
  const fx = calculateFxSpreads(snapshot, fifo.result);
  const businessRules = evaluateBusinessRules(snapshot, profit.result);
  const formulaResults = [
    ...liquidity.formulas,
    ...fifo.formulas,
    ...profit.formulas,
    ...fx.formulas,
    ...businessRules.formulas,
  ];
  const sectionResults = [
    liquidity.result,
    fifo.result,
    profit.result,
    fx.result,
    businessRules.result,
  ];
  const status = combineStatus(
    snapshot.data_quality.status,
    ...sectionResults.map((section) => section.status),
  );
  const evidenceRefs = sortedUnique([
    ...snapshot.input_evidence.map((item) => item.evidence_id),
    ...sectionResults.flatMap((section) => section.evidence_refs),
  ]);
  const limitations = sortedUnique([
    ...snapshot.data_quality.limitations,
    ...sectionResults.flatMap((section) => section.limitations),
  ]);
  const blockingReasons = sortedUnique([
    ...snapshot.data_quality.blocking_reasons,
    ...sectionResults.flatMap((section) => section.blocking_reasons),
  ]);
  const resultWithoutDigest = {
    contract_version: SETTLEMENT_DETERMINISTIC_CONTRACT_VERSION,
    engine_version: SETTLEMENT_DETERMINISTIC_ENGINE_VERSION,
    snapshot_id: snapshot.snapshot_id,
    request_id: snapshot.request_id,
    input_digest: snapshot.input_digest,
    ruleset_version: SETTLEMENT_DETERMINISTIC_RULESET_VERSION,
    ruleset_ref: {
      ruleset_code: "VND_DETERMINISTIC_CALCULATION_RULESET" as const,
      ruleset_version: SETTLEMENT_DETERMINISTIC_RULESET_VERSION,
      ruleset_digest: rulesetDigest,
      input_ruleset_code: snapshot.ruleset_ref.ruleset_code,
      input_ruleset_version: snapshot.ruleset_ref.ruleset_version,
      input_ruleset_digest: snapshot.ruleset_ref.ruleset_digest,
    },
    as_of: snapshot.as_of,
    currency: "VND" as const,
    mode: "SHADOW" as const,
    status,
    liquidity_result: liquidity.result,
    fifo_cost_result: fifo.result,
    profit_result: profit.result,
    fx_result: fx.result,
    business_rule_result: businessRules.result,
    formula_results: formulaResults,
    evidence_refs: evidenceRefs,
    limitations,
    blocking_reasons: blockingReasons,
    shadow_guard: SETTLEMENT_DETERMINISTIC_SHADOW_GUARD,
  };
  return {
    ...resultWithoutDigest,
    result_digest: await stableSnapshotDigest(resultWithoutDigest),
  };
}
