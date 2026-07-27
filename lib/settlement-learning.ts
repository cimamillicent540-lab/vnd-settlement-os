export const SETTLEMENT_LEARNING_RULES = Object.freeze({
  phase: "PHASE_1_HUMAN_REVIEW",
  learningWindowDays: 90,
  modelVersion: "SETTLEMENT_LEARNING_V1",
  supportedDecisionScopes: [
    "FULL_REVIEW",
    "TOPUP",
    "QUOTE",
    "RISK",
  ] as const,
});

export const SETTLEMENT_LEARNING_SHADOW_GUARD = Object.freeze({
  automaticPayment: false,
  automaticTopup: false,
  automaticQuoteChange: false,
  automaticTrading: false,
  actualExecutionPerformed: false,
});

export interface LearningRiskAlert {
  code: string;
  severity: "INFO" | "WARNING" | "HIGH";
  message: string;
}

export interface LearningRecommendationInput {
  clientRequestId: string;
  currency: string;
  generatedBy: string;
  topupRecommended: boolean;
  recommendedTopupUsdt: string | null;
  requiredGrossTopupVnd: string;
  recommendedQuoteRate: string | null;
  targetMargin: string;
  riskAlerts: LearningRiskAlert[];
  expectedProfitUsdt: string | null;
  expectedProfitMargin: string | null;
  cashProfitUsdt: string | null;
  cashProfitMargin: string | null;
  economicProfitUsdt: string | null;
  economicProfitMargin: string | null;
  profitMetricsSnapshot: Record<string, unknown>;
  fxJudgment:
    | "BUY_VND_OPPORTUNITY"
    | "NORMAL"
    | "RISK"
    | "WAITING_INPUT";
  xeRate: string | null;
  p2pCostRate: string | null;
  fxSpreadRatio: string | null;
  systemPayload: Record<string, unknown>;
  dataCutoffSnapshot: Record<string, unknown>;
}

export function buildSettlementLearningRecommendation(
  input: LearningRecommendationInput,
) {
  const currency = input.currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new Error("Currency must be an ISO-style three-letter code");
  }
  if (!input.clientRequestId || !input.generatedBy) {
    throw new Error("Recommendation identity is required");
  }

  return {
    client_request_id: input.clientRequestId,
    currency,
    learning_phase: SETTLEMENT_LEARNING_RULES.phase,
    learning_window_days:
      SETTLEMENT_LEARNING_RULES.learningWindowDays,
    system_topup_recommended: input.topupRecommended,
    system_recommended_topup_usdt: input.recommendedTopupUsdt,
    system_required_gross_topup_vnd: input.requiredGrossTopupVnd,
    system_recommended_quote_rate: input.recommendedQuoteRate,
    system_target_margin: input.targetMargin,
    system_risk_alerts: input.riskAlerts,
    system_expected_profit_usdt: input.expectedProfitUsdt,
    system_expected_profit_margin: input.expectedProfitMargin,
    system_cash_profit_usdt: input.cashProfitUsdt,
    system_cash_profit_margin: input.cashProfitMargin,
    system_economic_profit_usdt: input.economicProfitUsdt,
    system_economic_profit_margin: input.economicProfitMargin,
    profit_metrics_snapshot: input.profitMetricsSnapshot,
    system_fx_judgment: input.fxJudgment,
    system_xe_rate: input.xeRate,
    system_p2p_cost_rate: input.p2pCostRate,
    system_fx_spread_ratio: input.fxSpreadRatio,
    system_payload: input.systemPayload,
    data_cutoff_snapshot: input.dataCutoffSnapshot,
    model_version: SETTLEMENT_LEARNING_RULES.modelVersion,
    shadow_mode: true,
    automatic_payment:
      SETTLEMENT_LEARNING_SHADOW_GUARD.automaticPayment,
    automatic_topup:
      SETTLEMENT_LEARNING_SHADOW_GUARD.automaticTopup,
    automatic_quote_change:
      SETTLEMENT_LEARNING_SHADOW_GUARD.automaticQuoteChange,
    automatic_trading:
      SETTLEMENT_LEARNING_SHADOW_GUARD.automaticTrading,
    generated_by: input.generatedBy,
  } as const;
}

export function defaultRiskFeedback(alerts: LearningRiskAlert[]) {
  return alerts.map((alert) => ({
    risk_code: alert.code,
    human_judgment: "CONFIRMED" as const,
    human_note: "",
  }));
}
