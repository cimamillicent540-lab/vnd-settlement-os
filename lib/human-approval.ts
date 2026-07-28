import Decimal from "decimal.js";

export const HUMAN_APPROVAL_RULES = Object.freeze({
  modelVersion: "HUMAN_APPROVAL_CENTER_V1",
  learningWindowDays: 90,
  allowedRoles: ["admin", "settlement_operator"] as const,
  requestTypes: ["TOPUP", "QUOTE", "RISK"] as const,
});

export const HUMAN_APPROVAL_SHADOW_GUARD = Object.freeze({
  shadowMode: true,
  automaticPayment: false,
  automaticTopup: false,
  automaticQuoteChange: false,
  automaticTrading: false,
  actualExecutionPerformed: false,
});

export type ApprovalRiskLevel = "LOW" | "MEDIUM" | "HIGH";

export interface ApprovalRecommendation {
  id: string;
  recommendationTime: string;
  recommendedTopupUsdt: string | number | null;
  recommendedQuoteRate: string | number | null;
  targetMargin: string | number;
  riskAlerts: Array<{
    code: string;
    severity: "INFO" | "WARNING" | "HIGH";
    message: string;
  }>;
  p2pCostRate: string | number | null;
  predictedCashProfitUsdt: string | number | null;
  predictedEconomicProfitUsdt: string | number | null;
  dataCutoffSnapshot: Record<string, unknown>;
}

export interface ApprovalMerchantSuggestion {
  merchantName: string;
  currentQuoteRate: string | number | null;
  systemRecommendedQuoteRate: string | number | null;
  currentProfitMargin: string | number | null;
  targetProfitMargin: string | number;
  transactionVolumeUsdt: string | number;
  volumeLevel: "HIGH" | "MEDIUM" | "LOW";
  riskLevel: string;
  recommendationReason: string;
}

export interface ApprovalTopupContext {
  recommendedTime: string;
  reasons: string[];
  fundsRiskStatus: string;
}

function decimalString(
  value: string | number | null | undefined,
  scale: number,
) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  return new Decimal(value).toDecimalPlaces(scale).toFixed(scale);
}

export function approvalRiskLevel(
  severity: string | null | undefined,
): ApprovalRiskLevel {
  if (severity === "HIGH" || severity === "CRITICAL") return "HIGH";
  if (severity === "WARNING" || severity === "MEDIUM") return "MEDIUM";
  return "LOW";
}

export function approvalActionIsValid(
  requestType: "TOPUP" | "QUOTE" | "RISK",
  actionType: string,
) {
  return requestType === "RISK"
    ? ["CONFIRMED", "ADJUSTED", "IGNORED"].includes(actionType)
    : ["ACCEPTED", "MODIFIED", "REJECTED"].includes(actionType);
}

export function approvalReasonIsValid(
  reasonCode: string,
  reasonDetail: string,
) {
  return (
    /^[A-Z][A-Z0-9_]{2,79}$/.test(reasonCode) &&
    reasonDetail.trim().length > 0 &&
    reasonDetail.trim().length <= 1000
  );
}

export function calculateApprovalAdjustment(
  originalValue: string | number,
  finalValue: string | number,
) {
  const original = new Decimal(originalValue);
  const final = new Decimal(finalValue);
  const amount = final.minus(original);
  return {
    adjustmentAmount: amount.toFixed(12),
    adjustmentRatio: original.isZero()
      ? null
      : amount.dividedBy(original).toFixed(12),
  };
}

export function buildApprovalRequestRows(input: {
  batchId: string;
  requestedBy: string;
  operatingDate: string;
  recommendation: ApprovalRecommendation;
  topup: ApprovalTopupContext;
  merchants: ApprovalMerchantSuggestion[];
}) {
  const recommendation = input.recommendation;
  const topupUsdt =
    decimalString(recommendation.recommendedTopupUsdt ?? 0, 8) ??
    "0.00000000";
  const p2pRate = decimalString(recommendation.p2pCostRate, 12);
  const estimatedCost =
    p2pRate === null
      ? null
      : new Decimal(topupUsdt)
          .times(p2pRate)
          .toDecimalPlaces(2)
          .toFixed(2);
  const predictedCash = decimalString(
    recommendation.predictedCashProfitUsdt,
    12,
  );
  const predictedEconomic = decimalString(
    recommendation.predictedEconomicProfitUsdt,
    12,
  );
  const common = {
    request_batch_id: input.batchId,
    recommendation_id: recommendation.id,
    request_version: 1,
    operating_date: input.operatingDate,
    recommendation_time: recommendation.recommendationTime,
    currency: "VND",
    predicted_cash_profit_usdt: predictedCash,
    predicted_economic_profit_usdt: predictedEconomic,
    data_cutoff_snapshot: recommendation.dataCutoffSnapshot,
    model_version: HUMAN_APPROVAL_RULES.modelVersion,
    learning_window_days: HUMAN_APPROVAL_RULES.learningWindowDays,
    requested_by: input.requestedBy,
    shadow_mode: true,
    automatic_payment: false,
    automatic_topup: false,
    automatic_quote_change: false,
    automatic_trading: false,
  } as const;

  const highestRisk = [
    approvalRiskLevel(input.topup.fundsRiskStatus),
    ...recommendation.riskAlerts.map((risk) =>
      approvalRiskLevel(risk.severity),
    ),
  ].reduce<ApprovalRiskLevel>((highest, current) => {
    const weight = { LOW: 1, MEDIUM: 2, HIGH: 3 };
    return weight[current] > weight[highest] ? current : highest;
  }, "LOW");

  const rows: Array<Record<string, unknown>> = [
    {
      ...common,
      client_request_id: crypto.randomUUID(),
      request_type: "TOPUP",
      request_key: "VND_DAILY_TOPUP",
      ai_original_suggestion: {
        requestType: "TOPUP",
        recommendedTopupUsdt: topupUsdt,
        estimatedTopupCostVnd: estimatedCost,
        estimatedCoverageTime: input.topup.recommendedTime,
        riskLevel: highestRisk,
        reasons: input.topup.reasons,
        p2pCostRate: p2pRate,
      },
      ai_reason:
        input.topup.reasons.join("；") ||
        "当前模型未识别资金缺口，保留人工复核。",
      ai_topup_usdt: topupUsdt,
      estimated_topup_cost_vnd: estimatedCost,
      estimated_coverage_time: input.topup.recommendedTime,
      ai_risk_level: highestRisk,
    },
  ];

  for (const merchant of input.merchants) {
    const currentQuote = decimalString(
      merchant.currentQuoteRate,
      12,
    );
    const recommendedQuote = decimalString(
      merchant.systemRecommendedQuoteRate,
      12,
    );
    if (currentQuote === null || recommendedQuote === null) continue;
    const currentMargin = decimalString(
      merchant.currentProfitMargin,
      12,
    );
    const targetMargin =
      decimalString(merchant.targetProfitMargin, 12) ??
      decimalString(recommendation.targetMargin, 12) ??
      "0.000000000000";
    const volume =
      decimalString(merchant.transactionVolumeUsdt, 8) ??
      "0.00000000";
    const marginDelta = new Decimal(targetMargin).minus(
      currentMargin ?? 0,
    );
    const profitImpact = new Decimal(volume)
      .times(marginDelta)
      .toDecimalPlaces(12)
      .toFixed(12);

    rows.push({
      ...common,
      client_request_id: crypto.randomUUID(),
      request_type: "QUOTE",
      request_key: merchant.merchantName,
      ai_original_suggestion: {
        requestType: "QUOTE",
        merchantName: merchant.merchantName,
        currentQuoteRate: currentQuote,
        recommendedQuoteRate: recommendedQuote,
        currentProfitMargin: currentMargin,
        targetProfitMargin: targetMargin,
        transactionVolumeUsdt: volume,
        predictedProfitImpactUsdt: profitImpact,
        merchantTier: merchant.volumeLevel,
        riskLevel: merchant.riskLevel,
      },
      ai_reason: merchant.recommendationReason,
      merchant_name: merchant.merchantName,
      current_quote_rate: currentQuote,
      ai_quote_rate: recommendedQuote,
      predicted_profit_impact_usdt: profitImpact,
      predicted_profit_impact_ratio: marginDelta.toFixed(12),
      merchant_tier: merchant.volumeLevel,
      ai_risk_level: approvalRiskLevel(merchant.riskLevel),
    });
  }

  for (const risk of recommendation.riskAlerts) {
    rows.push({
      ...common,
      client_request_id: crypto.randomUUID(),
      request_type: "RISK",
      request_key: risk.code,
      ai_original_suggestion: {
        requestType: "RISK",
        riskCode: risk.code,
        riskLevel: approvalRiskLevel(risk.severity),
        originalSeverity: risk.severity,
        message: risk.message,
      },
      ai_reason: risk.message,
      risk_code: risk.code,
      risk_message: risk.message,
      ai_risk_level: approvalRiskLevel(risk.severity),
    });
  }

  return rows;
}
