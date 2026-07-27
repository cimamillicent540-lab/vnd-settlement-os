import Decimal from "decimal.js";

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export const DAILY_OPERATION_RULES = Object.freeze({
  rulesVersion: "VND_DAILY_OPERATION_WORKFLOW_V1",
  timeZone: "Asia/Shanghai",
  dayDecisionHour: 11,
  riskCheckHour: 16,
  endReviewHour: 23,
  settleableRatio: "0.50",
  safetyBufferRatio: "0.10",
  minimumProfitMargin: "0.002",
  arbitrageOpportunityThreshold: "0.002",
  learningWindowDays: 90,
  shadowMode: true,
  automaticPayment: false,
  automaticTopup: false,
  automaticQuoteChange: false,
  automaticMarketDataCollection: false,
  automaticTrading: false,
  actualExecutionPerformed: false,
});

export const DAILY_OPERATION_REASON_CATEGORIES = [
  "MARKET_COMPETITION",
  "MERCHANT_RELATIONSHIP",
  "FX_OPPORTUNITY",
  "RISK_CONTROL",
  "FUNDING_ARRANGEMENT",
  "OTHER",
] as const;

export type DailyOperationReasonCategory =
  (typeof DAILY_OPERATION_REASON_CATEGORIES)[number];

export type WorkflowCaptureStatus =
  | "EARLY_MANUAL_PREPARATION"
  | "ON_TIME"
  | "LATE_MANUAL_CAPTURE";

type Amount = string | number;

function decimal(value: Amount | null | undefined) {
  const parsed = new Decimal(value ?? 0);
  if (!parsed.isFinite()) {
    throw new Error("Daily operation amount must be finite");
  }
  return parsed;
}

export function captureStatusForCheckpoint(
  checkpointHour: 11 | 16 | 23,
  capturedAt: Date = new Date(),
): WorkflowCaptureStatus {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: DAILY_OPERATION_RULES.timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(capturedAt);
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  const localMinutes =
    Number(values.hour ?? 0) * 60 + Number(values.minute ?? 0);
  const scheduledMinutes = checkpointHour * 60;
  if (localMinutes < scheduledMinutes) {
    return "EARLY_MANUAL_PREPARATION";
  }
  if (localMinutes < scheduledMinutes + 60) return "ON_TIME";
  return "LATE_MANUAL_CAPTURE";
}

export function calculateManualFxOpportunity(input: {
  binanceP2pRate: Amount;
  upstreamQuoteRate: Amount;
  xeRate: Amount;
}) {
  const p2p = decimal(input.binanceP2pRate);
  const upstream = decimal(input.upstreamQuoteRate);
  const xe = decimal(input.xeRate);
  if (p2p.lte(0) || upstream.lte(0) || xe.lte(0)) {
    throw new Error("All manual FX rates must be positive");
  }
  const bestSourceRate = Decimal.max(p2p, upstream);
  const spread = bestSourceRate.minus(xe);
  const spreadRatio = spread.div(xe);
  const status = spreadRatio.gte(
    DAILY_OPERATION_RULES.arbitrageOpportunityThreshold,
  )
    ? ("ARBITRAGE_SPACE" as const)
    : spreadRatio.gte(0)
      ? ("NORMAL" as const)
      : ("RISK" as const);

  return {
    binanceP2pRate: p2p.toFixed(12),
    upstreamQuoteRate: upstream.toFixed(12),
    xeRate: xe.toFixed(12),
    bestSourceRate: bestSourceRate.toFixed(12),
    spreadVndPerUsdt: spread.toFixed(12),
    spreadRatio: spreadRatio.toFixed(12),
    opportunityStatus: status,
    arbitrageSpaceExists: status === "ARBITRAGE_SPACE",
    threshold: DAILY_OPERATION_RULES.arbitrageOpportunityThreshold,
    inputMode: "MANUAL_ONLY" as const,
  };
}

export interface DayDecisionSnapshotInput {
  clientRequestId: string;
  operatingDate: string;
  capturedAt: Date;
  createdBy: string;
  sourceLearningRecommendationId: string;
  sourceControlSnapshotId: string | null;
  balances: {
    grossBalanceVnd: Amount;
    settleableBalanceVnd: Amount;
    reserveBalanceVnd: Amount;
  };
  forecast: {
    payinVnd: Amount;
    payoutVnd: Amount;
    netDemandVnd: Amount;
    peakPressureVnd: Amount;
  };
  recommendedCoverageTime:
    | "NO_TOPUP"
    | "IMMEDIATE_MANUAL_REVIEW"
    | "BEFORE_16_00"
    | "WHEN_OPERATOR_CONFIRMS_P2P_QUOTE";
  sourceTopupReasons: string[];
  manualFx: {
    binanceP2pRate: Amount;
    upstreamQuoteRate: Amount;
    xeRate: Amount;
  };
  dataCutoffSnapshot: Record<string, unknown>;
}

export function buildDayDecisionSnapshotRecord(
  input: DayDecisionSnapshotInput,
) {
  const gross = decimal(input.balances.grossBalanceVnd);
  const settleable = decimal(
    input.balances.settleableBalanceVnd,
  );
  const reserve = decimal(input.balances.reserveBalanceVnd);
  if (gross.minus(settleable).minus(reserve).abs().gt("0.02")) {
    throw new Error(
      "Gross balance must equal reserve plus settleable balance",
    );
  }
  const forecastPayin = decimal(input.forecast.payinVnd);
  const forecastPayout = decimal(input.forecast.payoutVnd);
  const forecastNetDemand = decimal(input.forecast.netDemandVnd);
  const peakPressure = decimal(input.forecast.peakPressureVnd);
  const requiredSettleable = Decimal.max(
    forecastNetDemand,
    peakPressure,
  ).mul(new Decimal(1).plus(DAILY_OPERATION_RULES.safetyBufferRatio));
  const shortfall = Decimal.max(
    requiredSettleable.minus(settleable),
    0,
  );
  const grossTopup = shortfall.div(
    DAILY_OPERATION_RULES.settleableRatio,
  );
  const fx = calculateManualFxOpportunity(input.manualFx);
  const recommendedTopup = shortfall.gt(0)
    ? grossTopup.div(fx.bestSourceRate)
    : null;
  const reasons = [...input.sourceTopupReasons];
  if (shortfall.gt(0)) {
    reasons.push(
      "按50%可结算比例和10%安全缓冲计算后存在资金缺口",
    );
  } else {
    reasons.push("当前Settleable余额覆盖预测需求和10%安全缓冲");
  }
  reasons.push(
    `人工汇率观察：最佳VND来源 ${fx.bestSourceRate}，状态 ${fx.opportunityStatus}`,
  );

  return {
    client_request_id: input.clientRequestId,
    operating_date: input.operatingDate,
    checkpoint_type: "DAY_DECISION_11_00",
    scheduled_local_time: "11:00:00",
    captured_at: input.capturedAt.toISOString(),
    capture_status: captureStatusForCheckpoint(
      DAILY_OPERATION_RULES.dayDecisionHour,
      input.capturedAt,
    ),
    currency: "VND",
    source_learning_recommendation_id:
      input.sourceLearningRecommendationId,
    source_control_snapshot_id: input.sourceControlSnapshotId,
    gross_balance_vnd: gross.toFixed(2),
    settleable_balance_vnd: settleable.toFixed(2),
    reserve_balance_vnd: reserve.toFixed(2),
    available_funds_ratio: gross.gt(0)
      ? settleable.div(gross).toFixed(12)
      : "0.000000000000",
    settleable_ratio: DAILY_OPERATION_RULES.settleableRatio,
    safety_buffer_ratio: DAILY_OPERATION_RULES.safetyBufferRatio,
    forecast_payin_vnd: forecastPayin.toFixed(2),
    forecast_payout_vnd: forecastPayout.toFixed(2),
    forecast_net_demand_vnd: forecastNetDemand.toFixed(2),
    peak_16_23_pressure_vnd: peakPressure.toFixed(2),
    required_settleable_with_buffer_vnd:
      requiredSettleable.toFixed(2),
    projected_shortfall_vnd: shortfall.toFixed(2),
    required_gross_topup_vnd: grossTopup.toFixed(2),
    topup_recommended: shortfall.gt(0),
    recommended_topup_usdt:
      recommendedTopup?.toFixed(8) ?? null,
    recommended_coverage_time:
      shortfall.gt(0)
        ? input.recommendedCoverageTime === "NO_TOPUP"
          ? "BEFORE_16_00"
          : input.recommendedCoverageTime
        : "NO_TOPUP",
    topup_reasons: [...new Set(reasons)],
    binance_p2p_rate: fx.binanceP2pRate,
    upstream_quote_rate: fx.upstreamQuoteRate,
    xe_rate: fx.xeRate,
    best_vnd_source_rate: fx.bestSourceRate,
    fx_opportunity_spread_vnd_per_usdt:
      fx.spreadVndPerUsdt,
    fx_opportunity_spread_ratio: fx.spreadRatio,
    fx_opportunity_status: fx.opportunityStatus,
    arbitrage_space_exists: fx.arbitrageSpaceExists,
    fx_observation_snapshot: fx,
    data_cutoff_snapshot: input.dataCutoffSnapshot,
    rules_version: DAILY_OPERATION_RULES.rulesVersion,
    shadow_mode: true,
    automatic_payment: false,
    automatic_topup: false,
    automatic_quote_change: false,
    automatic_market_data_collection: false,
    automatic_trading: false,
    created_by: input.createdBy,
  } as const;
}

export interface RiskCheckInput {
  clientRequestId: string;
  operatingDate: string;
  capturedAt: Date;
  createdBy: string;
  dayDecisionSnapshotId: string;
  settleableBalanceVnd: Amount;
  projectedShortfallVnd: Amount;
  maximumHourlyPayoutConcentration: Amount | null;
  economicProfitMargin: Amount | null;
  fxSpreadRatio: Amount | null;
  systemRiskAlerts: Array<{
    code: string;
    severity: "INFO" | "WARNING" | "HIGH";
    message: string;
  }>;
  internationalMarketNotes: Array<{
    id: string;
    category: string;
    severity: string;
    title: string;
    reason: string;
  }>;
  dataCutoffSnapshot: Record<string, unknown>;
}

export function buildRiskCheckRecord(input: RiskCheckInput) {
  const systemCodes = new Set(
    input.systemRiskAlerts.map((alert) => alert.code),
  );
  const concentration = input.maximumHourlyPayoutConcentration;
  const profitMargin =
    input.economicProfitMargin === null
      ? null
      : decimal(input.economicProfitMargin);
  const fxSpread =
    input.fxSpreadRatio === null
      ? null
      : decimal(input.fxSpreadRatio);
  const payoutConcentrationRisk =
    systemCodes.has("PAYOUT_CONCENTRATION") ||
    (concentration !== null && decimal(concentration).gte("0.35"));
  const settleableInsufficientRisk =
    decimal(input.projectedShortfallVnd).gt(0) ||
    systemCodes.has("SETTLEABLE_SHORTFALL") ||
    systemCodes.has("SETTLEABLE_CAPACITY_RISK");
  const profitRisk =
    (profitMargin !== null &&
      profitMargin.lt(DAILY_OPERATION_RULES.minimumProfitMargin)) ||
    systemCodes.has("PROFIT_BELOW_0_2_PERCENT") ||
    systemCodes.has("MERCHANT_PROFIT_BELOW_0_2_PERCENT");
  const fxRisk =
    (fxSpread !== null && fxSpread.lt(0)) ||
    systemCodes.has("HIGH_FX_VOLATILITY") ||
    systemCodes.has("FX_INPUT_RISK") ||
    systemCodes.has("MISSING_MANUAL_FX_INPUT");
  const internationalRisk = input.internationalMarketNotes.some(
    (note) =>
      note.severity === "WARNING" || note.severity === "HIGH",
  );
  const flags = [
    payoutConcentrationRisk,
    settleableInsufficientRisk,
    profitRisk,
    fxRisk,
    internationalRisk,
  ];
  const riskScore = flags.filter(Boolean).length;
  const riskLevel =
    settleableInsufficientRisk || riskScore >= 3
      ? ("HIGH" as const)
      : riskScore > 0
        ? ("MEDIUM" as const)
        : ("LOW" as const);
  const alerts = [
    payoutConcentrationRisk
      ? {
          code: "PAYOUT_CONCENTRATION",
          severity: "WARNING",
          message: "Payout在部分小时集中，需人工关注流动性压力",
        }
      : null,
    settleableInsufficientRisk
      ? {
          code: "SETTLEABLE_INSUFFICIENT",
          severity: "HIGH",
          message: "Settleable余额不足以覆盖预测资金需求",
        }
      : null,
    profitRisk
      ? {
          code: "PROFIT_BELOW_0_2_PERCENT",
          severity: "WARNING",
          message: "Economic Profit margin低于千2保护线",
        }
      : null,
    fxRisk
      ? {
          code: "FX_ANOMALY",
          severity: "WARNING",
          message: "人工汇率观察或系统波动指标出现异常",
        }
      : null,
    internationalRisk
      ? {
          code: "INTERNATIONAL_MARKET_RISK",
          severity: "WARNING",
          message: "存在人工记录的国际市场风险背景",
        }
      : null,
  ].filter(
    (
      alert,
    ): alert is {
      code: string;
      severity: string;
      message: string;
    } => alert !== null,
  );

  return {
    client_request_id: input.clientRequestId,
    operating_date: input.operatingDate,
    checkpoint_type: "RISK_CHECK_16_00",
    scheduled_local_time: "16:00:00",
    captured_at: input.capturedAt.toISOString(),
    capture_status: captureStatusForCheckpoint(
      DAILY_OPERATION_RULES.riskCheckHour,
      input.capturedAt,
    ),
    currency: "VND",
    day_decision_snapshot_id: input.dayDecisionSnapshotId,
    settleable_balance_vnd: decimal(
      input.settleableBalanceVnd,
    ).toFixed(2),
    projected_shortfall_vnd: decimal(
      input.projectedShortfallVnd,
    ).toFixed(2),
    maximum_hourly_payout_concentration:
      concentration === null
        ? null
        : decimal(concentration).toFixed(12),
    economic_profit_margin:
      profitMargin?.toFixed(12) ?? null,
    fx_spread_ratio: fxSpread?.toFixed(12) ?? null,
    payout_concentration_risk: payoutConcentrationRisk,
    settleable_insufficient_risk: settleableInsufficientRisk,
    profit_below_0_2_percent_risk: profitRisk,
    fx_anomaly_risk: fxRisk,
    international_market_risk: internationalRisk,
    risk_score: riskScore,
    risk_level: riskLevel,
    risk_alerts: alerts,
    international_market_notes: input.internationalMarketNotes,
    data_cutoff_snapshot: input.dataCutoffSnapshot,
    rules_version: DAILY_OPERATION_RULES.rulesVersion,
    shadow_mode: true,
    automatic_payment: false,
    automatic_topup: false,
    automatic_quote_change: false,
    automatic_trading: false,
    created_by: input.createdBy,
  } as const;
}

export interface EndReviewRecordInput {
  clientRequestId: string;
  operatingDate: string;
  capturedAt: Date;
  createdBy: string;
  dayDecisionSnapshotId: string;
  riskCheckId: string;
  sourceDailyReportSnapshotId: string | null;
  sourceLearningRecommendationId: string;
  humanDecisionId: string;
  reasonClassificationId: string;
  decisionOutcomeId: string;
  cashProfitUsdt: Amount;
  economicProfitUsdt: Amount;
  systemRecommendationsSnapshot: Record<string, unknown>;
  humanFinalDecisionSnapshot: Record<string, unknown>;
  acceptanceStatus: "ACCEPTED" | "MODIFIED" | "REJECTED";
  reasonCategory: DailyOperationReasonCategory;
  adjustmentReason: string;
  finalTopupUsdt: Amount | null;
  finalQuoteRate: Amount | null;
  finalExecutionDecision:
    | "ACCEPT_FOR_MANUAL_EXECUTION"
    | "DO_NOT_EXECUTE"
    | "DEFER"
    | "NOT_APPLICABLE";
  riskFeedbackSnapshot: Record<string, unknown>[];
  dataCutoffSnapshot: Record<string, unknown>;
}

export function buildEndReviewRecord(input: EndReviewRecordInput) {
  const reason = input.adjustmentReason.trim();
  if (!reason || reason.length > 1000) {
    throw new Error("End review adjustment reason is required");
  }
  if (
    !DAILY_OPERATION_REASON_CATEGORIES.includes(
      input.reasonCategory,
    )
  ) {
    throw new Error("End review reason category is invalid");
  }

  return {
    client_request_id: input.clientRequestId,
    operating_date: input.operatingDate,
    checkpoint_type: "END_REVIEW_23_00",
    scheduled_local_time: "23:00:00",
    captured_at: input.capturedAt.toISOString(),
    capture_status: captureStatusForCheckpoint(
      DAILY_OPERATION_RULES.endReviewHour,
      input.capturedAt,
    ),
    currency: "VND",
    day_decision_snapshot_id: input.dayDecisionSnapshotId,
    risk_check_id: input.riskCheckId,
    source_daily_report_snapshot_id:
      input.sourceDailyReportSnapshotId,
    source_learning_recommendation_id:
      input.sourceLearningRecommendationId,
    human_decision_id: input.humanDecisionId,
    reason_classification_id: input.reasonClassificationId,
    decision_outcome_id: input.decisionOutcomeId,
    cash_profit_usdt: decimal(input.cashProfitUsdt).toFixed(12),
    economic_profit_usdt: decimal(
      input.economicProfitUsdt,
    ).toFixed(12),
    system_recommendations_snapshot:
      input.systemRecommendationsSnapshot,
    human_final_decision_snapshot:
      input.humanFinalDecisionSnapshot,
    acceptance_status: input.acceptanceStatus,
    adjustment_reason_category: input.reasonCategory,
    adjustment_reason: reason,
    final_topup_usdt:
      input.finalTopupUsdt === null
        ? null
        : decimal(input.finalTopupUsdt).toFixed(8),
    final_quote_rate:
      input.finalQuoteRate === null
        ? null
        : decimal(input.finalQuoteRate).toFixed(12),
    final_execution_decision: input.finalExecutionDecision,
    risk_feedback_snapshot: input.riskFeedbackSnapshot,
    learning_record_snapshot: {
      systemOriginal:
        input.systemRecommendationsSnapshot,
      humanFinal: input.humanFinalDecisionSnapshot,
      adjustmentReasonCategory: input.reasonCategory,
      adjustmentReason: reason,
      finalCashProfitUsdt: decimal(
        input.cashProfitUsdt,
      ).toFixed(12),
      finalEconomicProfitUsdt: decimal(
        input.economicProfitUsdt,
      ).toFixed(12),
      learningWindowDays:
        DAILY_OPERATION_RULES.learningWindowDays,
      automaticOptimization: false,
    },
    data_cutoff_snapshot: input.dataCutoffSnapshot,
    learning_window_days:
      DAILY_OPERATION_RULES.learningWindowDays,
    rules_version: DAILY_OPERATION_RULES.rulesVersion,
    shadow_mode: true,
    actual_execution_performed: false,
    automatic_payment: false,
    automatic_topup: false,
    automatic_quote_change: false,
    automatic_trading: false,
    created_by: input.createdBy,
  } as const;
}
