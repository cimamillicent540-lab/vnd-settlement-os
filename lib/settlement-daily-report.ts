import Decimal from "decimal.js";

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export const SHADOW_OPERATION_VALIDATION_RULES = Object.freeze({
  rulesVersion: "SHADOW_OPERATION_VALIDATION_V1",
  learningWindowDays: 90,
  peakWindow: "16:00-23:00",
  shadowMode: true,
  automaticPayment: false,
  automaticTopup: false,
  automaticQuoteChange: false,
  automaticMarketDataCollection: false,
  automaticTrading: false,
});

export type DailyAccountActivityRow = {
  event_type: string;
  gross_change_vnd: string | number | null;
  gross_signed_change_vnd: string | number | null;
};

function amount(value: string | number | null | undefined) {
  const parsed = new Decimal(value ?? 0);
  if (!parsed.isFinite()) {
    throw new Error("Daily settlement amount must be finite");
  }
  return parsed;
}

export function operatingDateFromAccountCutoff(
  sourceLocalTime: string | null | undefined,
) {
  const matched = sourceLocalTime?.match(/^(\d{4}-\d{2}-\d{2})/);
  return matched?.[1] ?? null;
}

export function nextIsoDate(date: string) {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("Operating date must be YYYY-MM-DD");
  }
  parsed.setUTCDate(parsed.getUTCDate() + 1);
  return parsed.toISOString().slice(0, 10);
}

export function summarizeDailyAccountActivity(
  rows: DailyAccountActivityRow[],
) {
  let payin = new Decimal(0);
  let payout = new Decimal(0);
  let net = new Decimal(0);

  for (const row of rows) {
    const grossChange = amount(row.gross_change_vnd).abs();
    const signedChange = amount(row.gross_signed_change_vnd);
    if (row.event_type === "PAYIN_INFLOW") {
      payin = payin.plus(grossChange);
    }
    if (row.event_type === "PAYOUT_OUTFLOW") {
      payout = payout.plus(grossChange);
    }
    net = net.plus(signedChange);
  }

  return {
    todayPayinVnd: payin.toFixed(2),
    todayPayoutVnd: payout.toFixed(2),
    netFundsChangeVnd: net.toFixed(2),
  };
}

export interface DailyOperationSnapshotInput {
  clientRequestId: string;
  operatingDate: string;
  createdBy: string;
  sourceControlSnapshotId: string | null;
  sourceLearningRecommendationId: string | null;
  balances: {
    grossBalanceVnd: string | number;
    settleableBalanceVnd: string | number;
    reserveBalanceVnd: string | number;
  };
  activity: ReturnType<typeof summarizeDailyAccountActivity>;
  pressure: {
    forecastPayoutVnd: string;
    forecastPayinVnd: string;
    forecastNetDemandVnd: string;
    peakPressureVnd: string;
  };
  topup: {
    topupRecommended: boolean;
    settleableShortfallVnd: string;
    recommendedTopupUsdt: string | null;
    recommendedTime: string;
    reasons: string[];
    objectives: string[];
    requiredSettleableVnd: string;
    requiredGrossTopupVnd: string;
  };
  profit: {
    cashProfitUsdt: string | number;
    cashProfitMargin: string | number | null;
    economicProfitUsdt: string | number;
    economicProfitMargin: string | number | null;
    snapshot: Record<string, unknown>;
  };
  merchantProfitContributions: Record<string, unknown>[];
  fx: {
    xeRate: string | null;
    p2pCostRate: string | null;
    companyQuoteRate: string | null;
    spreadVndPerUsdt: string | null;
    spreadRatio: string | null;
    opportunityStatus: string;
  };
  risks: Array<{
    code: string;
    severity: "INFO" | "WARNING" | "HIGH";
    message: string;
    source?: string;
  }>;
  learning90dSnapshot: Record<string, unknown>;
  decisionAccuracySnapshot: Record<string, unknown>;
  dataCutoffSnapshot: Record<string, unknown>;
  dataCompletenessStatus:
    | "COMPLETE"
    | "PARTIAL_AFTER_ACCOUNT_HISTORY_CUTOFF"
    | "NO_ACCOUNT_HISTORY";
}

export function buildDailyOperationSnapshotRecord(
  input: DailyOperationSnapshotInput,
) {
  const gross = amount(input.balances.grossBalanceVnd);
  const settleable = amount(input.balances.settleableBalanceVnd);
  const reserve = amount(input.balances.reserveBalanceVnd);
  if (gross.minus(settleable).minus(reserve).abs().gt("0.02")) {
    throw new Error(
      "Gross balance must equal reserve plus settleable balance",
    );
  }
  const shortfall = amount(input.topup.settleableShortfallVnd);

  return {
    client_request_id: input.clientRequestId,
    operating_date: input.operatingDate,
    currency: "VND",
    source_control_snapshot_id: input.sourceControlSnapshotId,
    source_learning_recommendation_id:
      input.sourceLearningRecommendationId,
    gross_balance_vnd: gross.toFixed(2),
    settleable_balance_vnd: settleable.toFixed(2),
    reserve_balance_vnd: reserve.toFixed(2),
    today_payin_vnd: input.activity.todayPayinVnd,
    today_payout_vnd: input.activity.todayPayoutVnd,
    net_funds_change_vnd: input.activity.netFundsChangeVnd,
    forecast_payout_vnd: input.pressure.forecastPayoutVnd,
    forecast_payin_vnd: input.pressure.forecastPayinVnd,
    forecast_net_demand_vnd: input.pressure.forecastNetDemandVnd,
    peak_16_23_pressure_vnd: input.pressure.peakPressureVnd,
    funding_shortfall_exists: shortfall.gt(0),
    projected_shortfall_vnd: shortfall.toFixed(2),
    topup_recommended: input.topup.topupRecommended,
    recommended_topup_usdt: input.topup.recommendedTopupUsdt,
    recommended_topup_time: input.topup.recommendedTime,
    topup_recommendation_snapshot: {
      requiredSettleableVnd: input.topup.requiredSettleableVnd,
      requiredGrossTopupVnd:
        input.topup.requiredGrossTopupVnd,
      reasons: input.topup.reasons,
      objectives: input.topup.objectives,
      adviceOnly: true,
    },
    cash_profit_usdt: amount(input.profit.cashProfitUsdt).toFixed(12),
    cash_profit_margin: input.profit.cashProfitMargin,
    economic_profit_usdt: amount(
      input.profit.economicProfitUsdt,
    ).toFixed(12),
    economic_profit_margin: input.profit.economicProfitMargin,
    profit_metrics_snapshot: {
      ...input.profit.snapshot,
      bothMetricsRequired: true,
    },
    merchant_profit_contributions:
      input.merchantProfitContributions,
    xe_rate: input.fx.xeRate,
    p2p_cost_rate: input.fx.p2pCostRate,
    company_quote_rate: input.fx.companyQuoteRate,
    fx_opportunity_status: input.fx.opportunityStatus,
    fx_snapshot: {
      spreadVndPerUsdt: input.fx.spreadVndPerUsdt,
      spreadRatio: input.fx.spreadRatio,
      inputMode: "MANUAL_ONLY",
    },
    risk_alerts: input.risks,
    learning_90d_snapshot: input.learning90dSnapshot,
    decision_accuracy_snapshot:
      input.decisionAccuracySnapshot,
    data_cutoff_snapshot: input.dataCutoffSnapshot,
    data_completeness_status: input.dataCompletenessStatus,
    rules_version:
      SHADOW_OPERATION_VALIDATION_RULES.rulesVersion,
    shadow_mode: true,
    automatic_payment: false,
    automatic_topup: false,
    automatic_quote_change: false,
    automatic_market_data_collection: false,
    automatic_trading: false,
    created_by: input.createdBy,
  } as const;
}
