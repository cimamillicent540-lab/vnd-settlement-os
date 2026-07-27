import Decimal from "decimal.js";

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export const AI_DECISION_SCORE_RULES = Object.freeze({
  modelVersion: "VND_AI_DECISION_SCORE_V1",
  recentDays: 7,
  overallWeights: Object.freeze({
    topup: "0.30",
    quote: "0.30",
    profit: "0.25",
    risk: "0.15",
  }),
  topupWeights: Object.freeze({
    quantity: "0.60",
    referenceCost: "0.20",
    fxOpportunity: "0.20",
  }),
  quoteWeights: Object.freeze({
    rate: "0.50",
    profit: "0.20",
    merchantCompetition: "0.15",
    transactionSafety: "0.15",
  }),
  competitionDeviationReference: "0.005",
  shadowMode: true,
  automaticPayment: false,
  automaticTopup: false,
  automaticQuoteChange: false,
  automaticTrading: false,
  automaticOptimization: false,
  actualExecutionPerformed: false,
});

type Amount = string | number;

type RiskAlert = {
  code?: unknown;
  severity?: unknown;
};

type RiskOutcome = {
  risk_code: string;
  realized: boolean;
  note?: string;
};

export interface AiDecisionScoreInput {
  aiTopupUsdt: Amount | null;
  humanTopupUsdt: Amount;
  referenceCostRateVndPerUsdt: Amount | null;
  predictedFxGainUsdt: Amount | null;
  actualFxGainUsdt: Amount;
  aiQuoteRate: Amount | null;
  humanQuoteRate: Amount;
  adjustmentReasonCategory: string;
  predictedCashProfitUsdt: Amount | null;
  actualCashProfitUsdt: Amount;
  predictedEconomicProfitUsdt: Amount | null;
  actualEconomicProfitUsdt: Amount;
  systemRiskLevel: "LOW" | "MEDIUM" | "HIGH";
  predictedRiskAlerts: RiskAlert[];
  actualRiskOutcomes: RiskOutcome[];
  unexpectedRiskCount: number;
}

function decimal(value: Amount | null | undefined) {
  const parsed = new Decimal(value ?? 0);
  if (!parsed.isFinite()) {
    throw new Error("AI decision score input must be finite");
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

function weightedAvailable(
  components: Array<{
    value: Decimal | null;
    weight: Decimal.Value;
  }>,
) {
  const available = components.filter(
    (
      component,
    ): component is { value: Decimal; weight: Decimal.Value } =>
      component.value !== null,
  );
  if (available.length === 0) return null;
  const denominator = Decimal.sum(
    ...available.map((component) => new Decimal(component.weight)),
  );
  return Decimal.sum(
    ...available.map((component) =>
      component.value.mul(component.weight),
    ),
  ).div(denominator);
}

function riskSeverity(value: unknown) {
  const normalized = String(value ?? "").toUpperCase();
  if (normalized === "HIGH") return 3;
  if (normalized === "WARNING" || normalized === "MEDIUM") return 2;
  if (normalized === "INFO" || normalized === "LOW") return 1;
  return 2;
}

function scoreString(value: Decimal | null) {
  return value?.mul(100).toFixed(6) ?? null;
}

export function calculateAiDecisionScore(
  input: AiDecisionScoreInput,
) {
  if (
    !Number.isInteger(input.unexpectedRiskCount) ||
    input.unexpectedRiskCount < 0 ||
    input.unexpectedRiskCount > 100
  ) {
    throw new Error("Unexpected risk count must be an integer");
  }

  const aiTopup = decimal(input.aiTopupUsdt ?? 0);
  const humanTopup = decimal(input.humanTopupUsdt);
  const actualFxGain = decimal(input.actualFxGainUsdt);
  const humanQuote = decimal(input.humanQuoteRate);
  const actualCashProfit = decimal(input.actualCashProfitUsdt);
  const actualEconomicProfit = decimal(
    input.actualEconomicProfitUsdt,
  );
  if (
    aiTopup.isNegative() ||
    humanTopup.isNegative() ||
    humanQuote.lte(0)
  ) {
    throw new Error("AI decision score input is out of range");
  }

  const topupAbsoluteDeviation = aiTopup
    .minus(humanTopup)
    .abs();
  const topupQuantityScore = amountAccuracy(aiTopup, humanTopup);
  const referenceCostRate = nullableDecimal(
    input.referenceCostRateVndPerUsdt,
  );
  if (referenceCostRate?.lte(0)) {
    throw new Error("Reference topup cost rate must be positive");
  }
  const aiReferenceCost =
    referenceCostRate?.mul(aiTopup) ?? null;
  const humanReferenceCost =
    referenceCostRate?.mul(humanTopup) ?? null;
  const referenceCostDifference =
    aiReferenceCost !== null && humanReferenceCost !== null
      ? aiReferenceCost.minus(humanReferenceCost).abs()
      : null;
  const referenceCostScore =
    aiReferenceCost && humanReferenceCost
      ? amountAccuracy(aiReferenceCost, humanReferenceCost)
      : null;
  const predictedFxGain = nullableDecimal(
    input.predictedFxGainUsdt,
  );
  const fxOpportunityLoss =
    predictedFxGain === null
      ? null
      : Decimal.max(0, predictedFxGain.minus(actualFxGain));
  const fxOpportunityScore =
    predictedFxGain === null
      ? null
      : amountAccuracy(predictedFxGain, actualFxGain);
  const topupScore = weightedAvailable([
    {
      value: topupQuantityScore,
      weight: AI_DECISION_SCORE_RULES.topupWeights.quantity,
    },
    {
      value: referenceCostScore,
      weight:
        AI_DECISION_SCORE_RULES.topupWeights.referenceCost,
    },
    {
      value: fxOpportunityScore,
      weight:
        AI_DECISION_SCORE_RULES.topupWeights.fxOpportunity,
    },
  ])!;

  const aiQuote = nullableDecimal(input.aiQuoteRate);
  const quoteAbsoluteDeviation =
    aiQuote?.minus(humanQuote).abs() ?? null;
  const quoteRelativeDeviation =
    aiQuote === null
      ? null
      : quoteAbsoluteDeviation!.div(
          Decimal.max(aiQuote.abs(), humanQuote.abs(), 1),
        );
  const quoteRateScore =
    aiQuote === null ? null : amountAccuracy(aiQuote, humanQuote);

  const predictedCashProfit = nullableDecimal(
    input.predictedCashProfitUsdt,
  );
  const predictedEconomicProfit = nullableDecimal(
    input.predictedEconomicProfitUsdt,
  );
  const cashProfitDifference =
    predictedCashProfit?.minus(actualCashProfit) ?? null;
  const economicProfitDifference =
    predictedEconomicProfit?.minus(actualEconomicProfit) ?? null;
  const cashProfitScore =
    predictedCashProfit === null
      ? null
      : amountAccuracy(predictedCashProfit, actualCashProfit);
  const economicProfitScore =
    predictedEconomicProfit === null
      ? null
      : amountAccuracy(
          predictedEconomicProfit,
          actualEconomicProfit,
        );
  const profitScore = weightedAvailable([
    { value: cashProfitScore, weight: 1 },
    { value: economicProfitScore, weight: 1 },
  ]);

  const competitionConcern = [
    "MARKET_COMPETITION",
    "MERCHANT_RELATIONSHIP",
  ].includes(input.adjustmentReasonCategory);
  const competitionImpactRatio =
    competitionConcern && quoteRelativeDeviation !== null
      ? quoteRelativeDeviation
      : new Decimal(0);
  const competitionScore =
    aiQuote === null
      ? null
      : clampUnit(
          new Decimal(1).minus(
            competitionImpactRatio.div(
              AI_DECISION_SCORE_RULES.competitionDeviationReference,
            ),
          ),
        );

  const predictedAlerts = input.predictedRiskAlerts
    .map((alert) => ({
      code: String(alert.code ?? "").trim(),
      severity: riskSeverity(alert.severity),
    }))
    .filter((alert) => alert.code);
  const uniquePredicted = new Map(
    predictedAlerts.map((alert) => [alert.code, alert]),
  );
  const actualOutcomes = new Map(
    input.actualRiskOutcomes.map((outcome) => [
      outcome.risk_code.trim(),
      outcome,
    ]),
  );
  if (
    actualOutcomes.size !== uniquePredicted.size ||
    [...uniquePredicted.keys()].some(
      (code) => !actualOutcomes.has(code),
    )
  ) {
    throw new Error(
      "Every predicted risk must have one actual outcome",
    );
  }

  const truePositiveCount = [...actualOutcomes.values()].filter(
    (outcome) => outcome.realized,
  ).length;
  const falsePositiveCount =
    uniquePredicted.size - truePositiveCount;
  const falseNegativeCount = input.unexpectedRiskCount;
  const hitRate =
    uniquePredicted.size === 0
      ? new Decimal(falseNegativeCount === 0 ? 1 : 0)
      : new Decimal(truePositiveCount).div(uniquePredicted.size);
  const falsePositiveRate =
    uniquePredicted.size === 0
      ? new Decimal(0)
      : new Decimal(falsePositiveCount).div(
          uniquePredicted.size,
        );
  const actualPositiveCount =
    truePositiveCount + falseNegativeCount;
  const missRate =
    actualPositiveCount === 0
      ? new Decimal(0)
      : new Decimal(falseNegativeCount).div(actualPositiveCount);
  const f1Denominator =
    2 * truePositiveCount +
    falsePositiveCount +
    falseNegativeCount;
  const classificationF1 =
    f1Denominator === 0
      ? new Decimal(1)
      : new Decimal(2 * truePositiveCount).div(f1Denominator);

  const realizedSeverities = [...uniquePredicted.values()]
    .filter(
      (alert) => actualOutcomes.get(alert.code)?.realized === true,
    )
    .map((alert) => alert.severity);
  const actualRiskLevel: "LOW" | "MEDIUM" | "HIGH" =
    falseNegativeCount > 0 ||
    realizedSeverities.some((severity) => severity >= 3)
      ? "HIGH"
      : realizedSeverities.length > 0
        ? "MEDIUM"
        : "LOW";
  const riskLevelMatched =
    input.systemRiskLevel === actualRiskLevel;
  const riskLevelScore = new Decimal(riskLevelMatched ? 1 : 0);
  const riskScore = classificationF1
    .mul("0.70")
    .plus(riskLevelScore.mul("0.30"));

  const transactionRiskRate =
    uniquePredicted.size + falseNegativeCount === 0
      ? new Decimal(0)
      : new Decimal(
          truePositiveCount + falseNegativeCount,
        ).div(uniquePredicted.size + falseNegativeCount);
  const transactionSafetyScore = new Decimal(1).minus(
    transactionRiskRate,
  );
  const quoteScore =
    aiQuote === null
      ? null
      : weightedAvailable([
          {
            value: quoteRateScore,
            weight: AI_DECISION_SCORE_RULES.quoteWeights.rate,
          },
          {
            value: profitScore,
            weight: AI_DECISION_SCORE_RULES.quoteWeights.profit,
          },
          {
            value: competitionScore,
            weight:
              AI_DECISION_SCORE_RULES.quoteWeights
                .merchantCompetition,
          },
          {
            value: transactionSafetyScore,
            weight:
              AI_DECISION_SCORE_RULES.quoteWeights
                .transactionSafety,
          },
        ]);

  const evaluationStatus =
    quoteScore !== null && profitScore !== null
      ? "COMPLETE"
      : "PARTIAL_INSUFFICIENT_EVIDENCE";
  const overallScore =
    evaluationStatus === "COMPLETE"
      ? topupScore
          .mul(AI_DECISION_SCORE_RULES.overallWeights.topup)
          .plus(
            quoteScore!.mul(
              AI_DECISION_SCORE_RULES.overallWeights.quote,
            ),
          )
          .plus(
            profitScore!.mul(
              AI_DECISION_SCORE_RULES.overallWeights.profit,
            ),
          )
          .plus(
            riskScore.mul(
              AI_DECISION_SCORE_RULES.overallWeights.risk,
            ),
          )
      : null;

  return {
    topupAbsoluteDeviationUsdt:
      topupAbsoluteDeviation.toFixed(12),
    topupRelativeDeviation: new Decimal(1)
      .minus(topupQuantityScore)
      .toFixed(12),
    referenceCostRateVndPerUsdt:
      referenceCostRate?.toFixed(12) ?? null,
    aiTopupReferenceCostVnd:
      aiReferenceCost?.toFixed(2) ?? null,
    humanTopupReferenceCostVnd:
      humanReferenceCost?.toFixed(2) ?? null,
    topupReferenceCostDifferenceVnd:
      referenceCostDifference?.toFixed(2) ?? null,
    topupCostEvidenceStatus:
      referenceCostRate === null
        ? "MISSING_REFERENCE_COST"
        : "DECISION_TIME_P2P_REFERENCE",
    fxOpportunityLossUsdt:
      fxOpportunityLoss?.toFixed(12) ?? null,
    topupQuantityScore: scoreString(topupQuantityScore)!,
    topupReferenceCostScore: scoreString(referenceCostScore),
    topupFxOpportunityScore: scoreString(fxOpportunityScore),
    topupDecisionScore: scoreString(topupScore)!,
    quoteAbsoluteDeviation:
      quoteAbsoluteDeviation?.toFixed(12) ?? null,
    quoteRelativeDeviation:
      quoteRelativeDeviation?.toFixed(12) ?? null,
    quoteProfitDifferenceUsdt:
      economicProfitDifference?.toFixed(12) ??
      cashProfitDifference?.toFixed(12) ??
      null,
    merchantCompetitionConcern: competitionConcern,
    merchantCompetitionImpactRatio:
      competitionImpactRatio.toFixed(12),
    transactionRiskRate: transactionRiskRate.toFixed(12),
    quoteRateScore: scoreString(quoteRateScore),
    quoteProfitScore: scoreString(profitScore),
    quoteCompetitionScore: scoreString(competitionScore),
    quoteTransactionSafetyScore: scoreString(
      transactionSafetyScore,
    )!,
    quoteDecisionScore: scoreString(quoteScore),
    cashProfitDifferenceUsdt:
      cashProfitDifference?.toFixed(12) ?? null,
    economicProfitDifferenceUsdt:
      economicProfitDifference?.toFixed(12) ?? null,
    cashProfitAbsoluteErrorUsdt:
      cashProfitDifference?.abs().toFixed(12) ?? null,
    economicProfitAbsoluteErrorUsdt:
      economicProfitDifference?.abs().toFixed(12) ?? null,
    profitPredictionScore: scoreString(profitScore),
    riskTruePositiveCount: truePositiveCount,
    riskFalsePositiveCount: falsePositiveCount,
    riskFalseNegativeCount: falseNegativeCount,
    riskHitRate: hitRate.toFixed(12),
    riskFalsePositiveRate: falsePositiveRate.toFixed(12),
    riskMissRate: missRate.toFixed(12),
    systemRiskLevel: input.systemRiskLevel,
    actualRiskLevel,
    riskLevelMatched,
    riskClassificationF1: classificationF1.toFixed(12),
    riskScore: scoreString(riskScore)!,
    evaluationStatus,
    aiDecisionScore: scoreString(overallScore),
    descriptiveStatisticsOnly: true,
    shadowMode: true,
    automaticOptimization: false,
    automaticAction: false,
  } as const;
}

export function buildAiDecisionScoreSnapshot(input: {
  clientRequestId: string;
  validationRecord: {
    id: string;
    period_id: string;
    validation_date: string;
    system_recommended_topup_usdt: Amount | null;
    actual_topup_usdt: Amount;
    system_predicted_fx_gain_usdt: Amount | null;
    actual_fx_gain_usdt: Amount;
    system_recommended_quote_rate: Amount | null;
    actual_quote_rate: Amount;
    adjustment_reason_category: string;
    system_predicted_cash_profit_usdt: Amount | null;
    actual_cash_profit_usdt: Amount;
    system_predicted_economic_profit_usdt: Amount | null;
    actual_economic_profit_usdt: Amount;
    system_risk_level: "LOW" | "MEDIUM" | "HIGH";
    system_predicted_risk_alerts: RiskAlert[];
    actual_risk_outcomes: RiskOutcome[];
    unexpected_risk_count: number;
    data_cutoff_snapshot: Record<string, unknown>;
  };
  referenceCostRateVndPerUsdt: Amount | null;
  scoreVersion: number;
  supersedesSnapshotId: string | null;
  createdBy: string;
}) {
  const source = input.validationRecord;
  const score = calculateAiDecisionScore({
    aiTopupUsdt: source.system_recommended_topup_usdt,
    humanTopupUsdt: source.actual_topup_usdt,
    referenceCostRateVndPerUsdt:
      input.referenceCostRateVndPerUsdt,
    predictedFxGainUsdt: source.system_predicted_fx_gain_usdt,
    actualFxGainUsdt: source.actual_fx_gain_usdt,
    aiQuoteRate: source.system_recommended_quote_rate,
    humanQuoteRate: source.actual_quote_rate,
    adjustmentReasonCategory:
      source.adjustment_reason_category,
    predictedCashProfitUsdt:
      source.system_predicted_cash_profit_usdt,
    actualCashProfitUsdt: source.actual_cash_profit_usdt,
    predictedEconomicProfitUsdt:
      source.system_predicted_economic_profit_usdt,
    actualEconomicProfitUsdt:
      source.actual_economic_profit_usdt,
    systemRiskLevel: source.system_risk_level,
    predictedRiskAlerts: source.system_predicted_risk_alerts,
    actualRiskOutcomes: source.actual_risk_outcomes,
    unexpectedRiskCount: source.unexpected_risk_count,
  });

  if (
    !Number.isInteger(input.scoreVersion) ||
    input.scoreVersion < 1
  ) {
    throw new Error("Score version must be a positive integer");
  }
  if (
    (input.scoreVersion === 1) !==
    (input.supersedesSnapshotId === null)
  ) {
    throw new Error("Score version chain is invalid");
  }

  return {
    client_request_id: input.clientRequestId,
    validation_record_id: source.id,
    period_id: source.period_id,
    score_date: source.validation_date,
    score_version: input.scoreVersion,
    supersedes_snapshot_id: input.supersedesSnapshotId,
    model_version: AI_DECISION_SCORE_RULES.modelVersion,
    ai_topup_usdt:
      source.system_recommended_topup_usdt === null
        ? null
        : decimal(
            source.system_recommended_topup_usdt,
          ).toFixed(8),
    human_topup_usdt: decimal(source.actual_topup_usdt).toFixed(8),
    predicted_fx_gain_usdt:
      source.system_predicted_fx_gain_usdt === null
        ? null
        : decimal(
            source.system_predicted_fx_gain_usdt,
          ).toFixed(12),
    actual_fx_gain_usdt: decimal(source.actual_fx_gain_usdt).toFixed(12),
    ai_quote_rate:
      source.system_recommended_quote_rate === null
        ? null
        : decimal(
            source.system_recommended_quote_rate,
          ).toFixed(12),
    human_quote_rate: decimal(source.actual_quote_rate).toFixed(12),
    predicted_cash_profit_usdt:
      source.system_predicted_cash_profit_usdt === null
        ? null
        : decimal(
            source.system_predicted_cash_profit_usdt,
          ).toFixed(12),
    actual_cash_profit_usdt: decimal(
      source.actual_cash_profit_usdt,
    ).toFixed(12),
    predicted_economic_profit_usdt:
      source.system_predicted_economic_profit_usdt === null
        ? null
        : decimal(
            source.system_predicted_economic_profit_usdt,
          ).toFixed(12),
    actual_economic_profit_usdt: decimal(
      source.actual_economic_profit_usdt,
    ).toFixed(12),
    ...{
      topup_absolute_deviation_usdt:
        score.topupAbsoluteDeviationUsdt,
      topup_relative_deviation: score.topupRelativeDeviation,
      reference_cost_rate_vnd_per_usdt:
        score.referenceCostRateVndPerUsdt,
      ai_topup_reference_cost_vnd:
        score.aiTopupReferenceCostVnd,
      human_topup_reference_cost_vnd:
        score.humanTopupReferenceCostVnd,
      topup_reference_cost_difference_vnd:
        score.topupReferenceCostDifferenceVnd,
      topup_cost_evidence_status:
        score.topupCostEvidenceStatus,
      fx_opportunity_loss_usdt:
        score.fxOpportunityLossUsdt,
      topup_quantity_score: score.topupQuantityScore,
      topup_reference_cost_score:
        score.topupReferenceCostScore,
      topup_fx_opportunity_score:
        score.topupFxOpportunityScore,
      topup_decision_score: score.topupDecisionScore,
      quote_absolute_deviation: score.quoteAbsoluteDeviation,
      quote_relative_deviation: score.quoteRelativeDeviation,
      quote_profit_difference_usdt:
        score.quoteProfitDifferenceUsdt,
      merchant_competition_concern:
        score.merchantCompetitionConcern,
      merchant_competition_impact_ratio:
        score.merchantCompetitionImpactRatio,
      transaction_risk_rate: score.transactionRiskRate,
      quote_rate_score: score.quoteRateScore,
      quote_profit_score: score.quoteProfitScore,
      quote_competition_score: score.quoteCompetitionScore,
      quote_transaction_safety_score:
        score.quoteTransactionSafetyScore,
      quote_decision_score: score.quoteDecisionScore,
      cash_profit_difference_usdt:
        score.cashProfitDifferenceUsdt,
      economic_profit_difference_usdt:
        score.economicProfitDifferenceUsdt,
      cash_profit_absolute_error_usdt:
        score.cashProfitAbsoluteErrorUsdt,
      economic_profit_absolute_error_usdt:
        score.economicProfitAbsoluteErrorUsdt,
      profit_prediction_score: score.profitPredictionScore,
      system_risk_level: score.systemRiskLevel,
      actual_risk_level: score.actualRiskLevel,
      risk_true_positive_count:
        score.riskTruePositiveCount,
      risk_false_positive_count:
        score.riskFalsePositiveCount,
      risk_false_negative_count:
        score.riskFalseNegativeCount,
      risk_hit_rate: score.riskHitRate,
      risk_false_positive_rate:
        score.riskFalsePositiveRate,
      risk_miss_rate: score.riskMissRate,
      risk_level_matched: score.riskLevelMatched,
      risk_classification_f1: score.riskClassificationF1,
      risk_score: score.riskScore,
      evaluation_status: score.evaluationStatus,
      ai_decision_score: score.aiDecisionScore,
    },
    calculation_snapshot: {
      modelVersion: AI_DECISION_SCORE_RULES.modelVersion,
      overallWeights: AI_DECISION_SCORE_RULES.overallWeights,
      topupWeights: AI_DECISION_SCORE_RULES.topupWeights,
      quoteWeights: AI_DECISION_SCORE_RULES.quoteWeights,
      competitionDeviationReference:
        AI_DECISION_SCORE_RULES.competitionDeviationReference,
      sourceValidationRecordId: source.id,
      descriptiveStatisticsOnly: true,
      automaticOptimization: false,
    },
    data_cutoff_snapshot: source.data_cutoff_snapshot,
    created_by: input.createdBy,
    shadow_mode: true,
    automatic_payment: false,
    automatic_topup: false,
    automatic_quote_change: false,
    automatic_trading: false,
    automatic_optimization: false,
    actual_execution_performed: false,
  } as const;
}
