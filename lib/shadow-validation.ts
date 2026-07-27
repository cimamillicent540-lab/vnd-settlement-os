import Decimal from "decimal.js";

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export const SHADOW_VALIDATION_RULES = Object.freeze({
  rulesVersion: "VND_SHADOW_VALIDATION_PERIOD_V1",
  validationDays: 7,
  timeZone: "Asia/Shanghai",
  topupAccuracyTolerance: "0.10",
  quoteEqualityTolerance: "0.000001",
  shadowMode: true,
  automaticPayment: false,
  automaticTopup: false,
  automaticQuoteChange: false,
  automaticTrading: false,
  automaticOptimization: false,
  actualExecutionPerformed: false,
});

type Amount = string | number;

type ActualRiskOutcome = {
  risk_code: string;
  realized: boolean;
  note?: string;
};

function decimal(value: Amount | null | undefined) {
  const parsed = new Decimal(value ?? 0);
  if (!parsed.isFinite()) {
    throw new Error("Shadow validation amount must be finite");
  }
  return parsed;
}

function nullableDecimal(value: Amount | null | undefined) {
  if (value === null || value === undefined) return null;
  return decimal(value);
}

function clampUnit(value: Decimal) {
  return Decimal.max(0, Decimal.min(1, value));
}

function amountAccuracy(predicted: Decimal, actual: Decimal) {
  if (predicted.eq(0) && actual.eq(0)) return new Decimal(1);
  const denominator = Decimal.max(
    predicted.abs(),
    actual.abs(),
    1,
  );
  return clampUnit(
    new Decimal(1).minus(predicted.minus(actual).abs().div(denominator)),
  );
}

function isoDateToEpochDay(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("Validation date must be YYYY-MM-DD");
  }
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error("Validation date is invalid");
  }
  return Math.floor(date.getTime() / 86_400_000);
}

export function validationPeriodDates(startDate: string) {
  const startDay = isoDateToEpochDay(startDate);
  const dates = Array.from(
    { length: SHADOW_VALIDATION_RULES.validationDays },
    (_, index) =>
      new Date((startDay + index) * 86_400_000)
        .toISOString()
        .slice(0, 10),
  );
  return {
    startDate: dates[0],
    endDate: dates[dates.length - 1],
    dates,
  };
}

export function validationDayNumber(
  startDate: string,
  validationDate: string,
) {
  const day =
    isoDateToEpochDay(validationDate) -
    isoDateToEpochDay(startDate) +
    1;
  if (day < 1 || day > SHADOW_VALIDATION_RULES.validationDays) {
    throw new Error("Validation date is outside the 7-day period");
  }
  return day;
}

export function predictedFxGainUsdt(input: {
  recommendedTopupUsdt: Amount | null;
  fxSpreadRatio: Amount | null;
}) {
  if (
    input.recommendedTopupUsdt === null ||
    input.fxSpreadRatio === null
  ) {
    return null;
  }
  return decimal(input.recommendedTopupUsdt)
    .mul(decimal(input.fxSpreadRatio))
    .toFixed(12);
}

export interface ValidationMetricInput {
  predictedTopupUsdt: Amount | null;
  predictedQuoteRate: Amount | null;
  predictedCashProfitUsdt: Amount | null;
  predictedEconomicProfitUsdt: Amount | null;
  predictedFxGainUsdt: Amount | null;
  predictedRiskCodes: string[];
  actualTopupUsdt: Amount;
  actualQuoteRate: Amount;
  actualCashProfitUsdt: Amount;
  actualEconomicProfitUsdt: Amount;
  actualFxGainUsdt: Amount;
  fundingPressureBeforeVnd: Amount;
  fundingPressureAfterVnd: Amount;
  actualRiskOutcomes: ActualRiskOutcome[];
  unexpectedRiskCount: number;
}

export function calculateShadowValidationMetrics(
  input: ValidationMetricInput,
) {
  const predictedTopup = decimal(input.predictedTopupUsdt ?? 0);
  const actualTopup = decimal(input.actualTopupUsdt);
  const actualQuote = decimal(input.actualQuoteRate);
  const actualCash = decimal(input.actualCashProfitUsdt);
  const actualEconomic = decimal(input.actualEconomicProfitUsdt);
  const actualFx = decimal(input.actualFxGainUsdt);
  const fundingBefore = decimal(input.fundingPressureBeforeVnd);
  const fundingAfter = decimal(input.fundingPressureAfterVnd);
  if (
    actualTopup.isNegative() ||
    actualQuote.lte(0) ||
    fundingBefore.isNegative() ||
    fundingAfter.isNegative()
  ) {
    throw new Error("Actual validation inputs are out of range");
  }
  if (
    !Number.isInteger(input.unexpectedRiskCount) ||
    input.unexpectedRiskCount < 0 ||
    input.unexpectedRiskCount > 100
  ) {
    throw new Error("Unexpected risk count must be an integer");
  }

  const uniquePredictedRiskCodes = [
    ...new Set(
      input.predictedRiskCodes
        .map((code) => code.trim())
        .filter(Boolean),
    ),
  ];
  if (
    input.actualRiskOutcomes.length !==
      uniquePredictedRiskCodes.length ||
    new Set(
      input.actualRiskOutcomes.map((outcome) => outcome.risk_code),
    ).size !== input.actualRiskOutcomes.length ||
    uniquePredictedRiskCodes.some(
      (code) =>
        !input.actualRiskOutcomes.some(
          (outcome) => outcome.risk_code === code,
        ),
    )
  ) {
    throw new Error(
      "Every predicted risk must have one actual outcome",
    );
  }

  const topupScore = amountAccuracy(predictedTopup, actualTopup);
  const topupRelativeError = new Decimal(1).minus(topupScore);
  const predictedQuote = nullableDecimal(input.predictedQuoteRate);
  const quoteDifference =
    predictedQuote === null
      ? null
      : predictedQuote.minus(actualQuote).abs();
  const quoteAdopted =
    predictedQuote === null
      ? null
      : quoteDifference!.lte(
          SHADOW_VALIDATION_RULES.quoteEqualityTolerance,
        );
  const quoteScore =
    quoteAdopted === null
      ? null
      : new Decimal(quoteAdopted ? 1 : 0);

  const predictedCash = nullableDecimal(
    input.predictedCashProfitUsdt,
  );
  const predictedEconomic = nullableDecimal(
    input.predictedEconomicProfitUsdt,
  );
  const cashError =
    predictedCash === null
      ? null
      : predictedCash.minus(actualCash).abs();
  const economicError =
    predictedEconomic === null
      ? null
      : predictedEconomic.minus(actualEconomic).abs();
  const profitScores = [
    predictedCash === null
      ? null
      : amountAccuracy(predictedCash, actualCash),
    predictedEconomic === null
      ? null
      : amountAccuracy(predictedEconomic, actualEconomic),
  ].filter((score): score is Decimal => score !== null);
  const profitScore =
    profitScores.length === 0
      ? null
      : Decimal.sum(...profitScores).div(profitScores.length);

  const realizedPredictedRisks = input.actualRiskOutcomes.filter(
    (outcome) => outcome.realized,
  ).length;
  const riskDenominator =
    uniquePredictedRiskCodes.length + input.unexpectedRiskCount;
  const riskScore =
    riskDenominator === 0
      ? new Decimal(1)
      : new Decimal(realizedPredictedRisks).div(riskDenominator);

  const predictedFx = nullableDecimal(input.predictedFxGainUsdt);
  const fxError =
    predictedFx === null ? null : predictedFx.minus(actualFx).abs();
  const componentScores = [
    topupScore,
    quoteScore,
    profitScore,
    riskScore,
  ].filter((score): score is Decimal => score !== null);
  const overallScore = Decimal.sum(...componentScores)
    .div(componentScores.length)
    .mul(100);

  return {
    topupAbsoluteErrorUsdt: predictedTopup
      .minus(actualTopup)
      .abs()
      .toFixed(12),
    topupRelativeError: topupRelativeError.toFixed(12),
    topupAccuracyScore: topupScore.toFixed(12),
    topupWithinTenPercent: topupRelativeError.lte(
      SHADOW_VALIDATION_RULES.topupAccuracyTolerance,
    ),
    quoteAbsoluteDeviation:
      quoteDifference?.toFixed(12) ?? null,
    quoteAdopted,
    quoteAdoptionScore: quoteScore?.toFixed(12) ?? null,
    cashProfitAbsoluteErrorUsdt:
      cashError?.toFixed(12) ?? null,
    economicProfitAbsoluteErrorUsdt:
      economicError?.toFixed(12) ?? null,
    profitPredictionScore:
      profitScore?.toFixed(12) ?? null,
    predictedRiskCount: uniquePredictedRiskCodes.length,
    realizedPredictedRiskCount: realizedPredictedRisks,
    unexpectedRiskCount: input.unexpectedRiskCount,
    riskPredictionAccuracyScore: riskScore.toFixed(12),
    predictedFxGainUsdt: predictedFx?.toFixed(12) ?? null,
    fxGainAbsoluteErrorUsdt: fxError?.toFixed(12) ?? null,
    fundingPressureImproved: fundingAfter.lt(fundingBefore),
    aiAccuracyScore: overallScore.toFixed(6),
    scoreComponentCount: componentScores.length,
    descriptiveStatisticsOnly: true,
    automaticOptimization: false,
  };
}

export function buildValidationPeriodRecord(input: {
  clientRequestId: string;
  startDate: string;
  createdBy: string;
}) {
  const period = validationPeriodDates(input.startDate);
  return {
    client_request_id: input.clientRequestId,
    currency: "VND",
    start_date: period.startDate,
    end_date: period.endDate,
    validation_days: SHADOW_VALIDATION_RULES.validationDays,
    rules_version: SHADOW_VALIDATION_RULES.rulesVersion,
    created_by: input.createdBy,
    shadow_mode: true,
    automatic_payment: false,
    automatic_topup: false,
    automatic_quote_change: false,
    automatic_trading: false,
    automatic_optimization: false,
  } as const;
}

export interface DailyValidationRecordInput {
  clientRequestId: string;
  periodId: string;
  periodStartDate: string;
  validationDate: string;
  sourceEndReviewId: string;
  recommendationId: string;
  humanDecisionId: string;
  decisionOutcomeId: string;
  reasonClassificationId: string;
  acceptanceStatus: "ACCEPTED" | "MODIFIED" | "REJECTED";
  adjustmentReasonCategory: string;
  adjustmentReason: string;
  predicted: {
    topupRecommended: boolean;
    topupUsdt: Amount | null;
    quoteRate: Amount | null;
    cashProfitUsdt: Amount | null;
    economicProfitUsdt: Amount | null;
    fxGainUsdt: Amount | null;
    riskAlerts: Array<Record<string, unknown>>;
    riskLevel: "LOW" | "MEDIUM" | "HIGH";
  };
  actual: {
    topupUsdt: Amount;
    quoteRate: Amount;
    cashProfitUsdt: Amount;
    economicProfitUsdt: Amount;
    fxGainUsdt: Amount;
    fundingPressureBeforeVnd: Amount;
    fundingPressureAfterVnd: Amount;
    riskOutcomes: ActualRiskOutcome[];
    unexpectedRiskCount: number;
    unexpectedRiskNotes: string;
  };
  metrics: ReturnType<typeof calculateShadowValidationMetrics>;
  dataCutoffSnapshot: Record<string, unknown>;
  recordedBy: string;
}

export function buildDailyValidationRecord(
  input: DailyValidationRecordInput,
) {
  const reason = input.adjustmentReason.trim();
  const unexpectedRiskNotes = input.actual.unexpectedRiskNotes.trim();
  if (!reason) {
    throw new Error("Human adjustment reason is required");
  }
  if (
    input.actual.unexpectedRiskCount > 0 &&
    !unexpectedRiskNotes
  ) {
    throw new Error("Unexpected risk notes are required");
  }
  const predictedRiskCodes = input.predicted.riskAlerts.map((risk) =>
    String(risk.code ?? ""),
  );
  const recalculated = calculateShadowValidationMetrics({
    predictedTopupUsdt: input.predicted.topupUsdt,
    predictedQuoteRate: input.predicted.quoteRate,
    predictedCashProfitUsdt: input.predicted.cashProfitUsdt,
    predictedEconomicProfitUsdt:
      input.predicted.economicProfitUsdt,
    predictedFxGainUsdt: input.predicted.fxGainUsdt,
    predictedRiskCodes,
    actualTopupUsdt: input.actual.topupUsdt,
    actualQuoteRate: input.actual.quoteRate,
    actualCashProfitUsdt: input.actual.cashProfitUsdt,
    actualEconomicProfitUsdt:
      input.actual.economicProfitUsdt,
    actualFxGainUsdt: input.actual.fxGainUsdt,
    fundingPressureBeforeVnd:
      input.actual.fundingPressureBeforeVnd,
    fundingPressureAfterVnd:
      input.actual.fundingPressureAfterVnd,
    actualRiskOutcomes: input.actual.riskOutcomes,
    unexpectedRiskCount: input.actual.unexpectedRiskCount,
  });
  if (
    JSON.stringify(recalculated) !== JSON.stringify(input.metrics)
  ) {
    throw new Error("Validation metrics must match source evidence");
  }

  return {
    client_request_id: input.clientRequestId,
    period_id: input.periodId,
    validation_date: input.validationDate,
    day_number: validationDayNumber(
      input.periodStartDate,
      input.validationDate,
    ),
    currency: "VND",
    source_end_review_id: input.sourceEndReviewId,
    recommendation_id: input.recommendationId,
    human_decision_id: input.humanDecisionId,
    decision_outcome_id: input.decisionOutcomeId,
    reason_classification_id: input.reasonClassificationId,
    system_topup_recommended: input.predicted.topupRecommended,
    system_recommended_topup_usdt:
      input.predicted.topupUsdt === null
        ? null
        : decimal(input.predicted.topupUsdt).toFixed(8),
    system_recommended_quote_rate:
      input.predicted.quoteRate === null
        ? null
        : decimal(input.predicted.quoteRate).toFixed(12),
    system_predicted_cash_profit_usdt:
      input.predicted.cashProfitUsdt === null
        ? null
        : decimal(input.predicted.cashProfitUsdt).toFixed(12),
    system_predicted_economic_profit_usdt:
      input.predicted.economicProfitUsdt === null
        ? null
        : decimal(input.predicted.economicProfitUsdt).toFixed(12),
    system_predicted_fx_gain_usdt:
      input.predicted.fxGainUsdt === null
        ? null
        : decimal(input.predicted.fxGainUsdt).toFixed(12),
    system_predicted_risk_alerts: input.predicted.riskAlerts,
    system_risk_level: input.predicted.riskLevel,
    acceptance_status: input.acceptanceStatus,
    adjustment_reason_category:
      input.adjustmentReasonCategory,
    adjustment_reason: reason,
    actual_topup_usdt: decimal(input.actual.topupUsdt).toFixed(8),
    actual_quote_rate: decimal(input.actual.quoteRate).toFixed(12),
    actual_cash_profit_usdt: decimal(
      input.actual.cashProfitUsdt,
    ).toFixed(12),
    actual_economic_profit_usdt: decimal(
      input.actual.economicProfitUsdt,
    ).toFixed(12),
    actual_fx_gain_usdt: decimal(
      input.actual.fxGainUsdt,
    ).toFixed(12),
    actual_funding_pressure_before_vnd: decimal(
      input.actual.fundingPressureBeforeVnd,
    ).toFixed(2),
    actual_funding_pressure_after_vnd: decimal(
      input.actual.fundingPressureAfterVnd,
    ).toFixed(2),
    actual_risk_outcomes: input.actual.riskOutcomes,
    unexpected_risk_count: input.actual.unexpectedRiskCount,
    unexpected_risk_notes: unexpectedRiskNotes || null,
    topup_absolute_error_usdt:
      input.metrics.topupAbsoluteErrorUsdt,
    topup_relative_error: input.metrics.topupRelativeError,
    topup_accuracy_score: input.metrics.topupAccuracyScore,
    topup_within_ten_percent:
      input.metrics.topupWithinTenPercent,
    quote_absolute_deviation:
      input.metrics.quoteAbsoluteDeviation,
    quote_adopted: input.metrics.quoteAdopted,
    quote_adoption_score: input.metrics.quoteAdoptionScore,
    cash_profit_absolute_error_usdt:
      input.metrics.cashProfitAbsoluteErrorUsdt,
    economic_profit_absolute_error_usdt:
      input.metrics.economicProfitAbsoluteErrorUsdt,
    profit_prediction_score:
      input.metrics.profitPredictionScore,
    predicted_risk_count: input.metrics.predictedRiskCount,
    realized_predicted_risk_count:
      input.metrics.realizedPredictedRiskCount,
    risk_prediction_accuracy_score:
      input.metrics.riskPredictionAccuracyScore,
    fx_gain_absolute_error_usdt:
      input.metrics.fxGainAbsoluteErrorUsdt,
    funding_pressure_improved:
      input.metrics.fundingPressureImproved,
    ai_accuracy_score: input.metrics.aiAccuracyScore,
    score_component_count: input.metrics.scoreComponentCount,
    data_cutoff_snapshot: input.dataCutoffSnapshot,
    rules_version: SHADOW_VALIDATION_RULES.rulesVersion,
    recorded_by: input.recordedBy,
    shadow_mode: true,
    automatic_payment: false,
    automatic_topup: false,
    automatic_quote_change: false,
    automatic_trading: false,
    automatic_optimization: false,
    actual_execution_performed: false,
  } as const;
}
