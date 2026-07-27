import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  AI_DECISION_SCORE_RULES,
  buildAiDecisionScoreSnapshot,
  calculateAiDecisionScore,
} from "../lib/ai-decision-score";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260727145542_vnd_ai_decision_score_v1.sql",
  ),
  "utf8",
);
const page = readFileSync(
  resolve(process.cwd(), "app/ai-decision-score/page.tsx"),
  "utf8",
);
const route = readFileSync(
  resolve(
    process.cwd(),
    "app/api/ai-decision-score/route.ts",
  ),
  "utf8",
);

const completeInput = {
  aiTopupUsdt: "100",
  humanTopupUsdt: "80",
  referenceCostRateVndPerUsdt: "26000",
  predictedFxGainUsdt: "10",
  actualFxGainUsdt: "5",
  aiQuoteRate: "26500",
  humanQuoteRate: "26400",
  adjustmentReasonCategory: "MARKET_COMPETITION",
  predictedCashProfitUsdt: "100",
  actualCashProfitUsdt: "90",
  predictedEconomicProfitUsdt: "200",
  actualEconomicProfitUsdt: "180",
  systemRiskLevel: "HIGH" as const,
  predictedRiskAlerts: [
    { code: "LOW_POOL", severity: "HIGH" },
    { code: "FX_RISK", severity: "WARNING" },
  ],
  actualRiskOutcomes: [
    { risk_code: "LOW_POOL", realized: true },
    { risk_code: "FX_RISK", realized: false },
  ],
  unexpectedRiskCount: 1,
};

describe("Task 2.15 component scores", () => {
  const result = calculateAiDecisionScore(completeInput);

  it("scores topup quantity, cost difference and FX opportunity loss", () => {
    expect(result).toMatchObject({
      topupAbsoluteDeviationUsdt: "20.000000000000",
      referenceCostRateVndPerUsdt: "26000.000000000000",
      aiTopupReferenceCostVnd: "2600000.00",
      humanTopupReferenceCostVnd: "2080000.00",
      topupReferenceCostDifferenceVnd: "520000.00",
      topupCostEvidenceStatus: "DECISION_TIME_P2P_REFERENCE",
      fxOpportunityLossUsdt: "5.000000000000",
      topupQuantityScore: "80.000000",
      topupReferenceCostScore: "80.000000",
      topupFxOpportunityScore: "50.000000",
      topupDecisionScore: "74.000000",
    });
  });

  it("scores quote profit, competition impact and transaction risk", () => {
    expect(result.merchantCompetitionConcern).toBe(true);
    expect(result.merchantCompetitionImpactRatio).toBe(
      "0.003773584906",
    );
    expect(result.transactionRiskRate).toBe("0.666666666667");
    expect(Number(result.quoteRateScore)).toBeCloseTo(99.622642, 6);
    expect(result.quoteProfitScore).toBe("90.000000");
    expect(Number(result.quoteCompetitionScore)).toBeCloseTo(
      24.528302,
      6,
    );
    expect(Number(result.quoteDecisionScore)).toBeCloseTo(
      76.490566,
      6,
    );
  });

  it("reports risk hit, false-positive and miss rates", () => {
    expect(result).toMatchObject({
      riskTruePositiveCount: 1,
      riskFalsePositiveCount: 1,
      riskFalseNegativeCount: 1,
      riskHitRate: "0.500000000000",
      riskFalsePositiveRate: "0.500000000000",
      riskMissRate: "0.500000000000",
      systemRiskLevel: "HIGH",
      actualRiskLevel: "HIGH",
      riskLevelMatched: true,
      riskClassificationF1: "0.500000000000",
      riskScore: "65.000000",
    });
  });

  it("uses the frozen 30/30/25/15 overall composition", () => {
    expect(AI_DECISION_SCORE_RULES.overallWeights).toEqual({
      topup: "0.30",
      quote: "0.30",
      profit: "0.25",
      risk: "0.15",
    });
    expect(result.profitPredictionScore).toBe("90.000000");
    expect(Number(result.aiDecisionScore)).toBeCloseTo(
      77.39717,
      5,
    );
    expect(result.evaluationStatus).toBe("COMPLETE");
  });

  it("marks missing quote or profit evidence partial without inventing a score", () => {
    const partial = calculateAiDecisionScore({
      ...completeInput,
      referenceCostRateVndPerUsdt: null,
      aiQuoteRate: null,
      predictedCashProfitUsdt: null,
      predictedEconomicProfitUsdt: null,
    });
    expect(partial).toMatchObject({
      topupCostEvidenceStatus: "MISSING_REFERENCE_COST",
      topupReferenceCostDifferenceVnd: null,
      quoteDecisionScore: null,
      profitPredictionScore: null,
      evaluationStatus: "PARTIAL_INSUFFICIENT_EVIDENCE",
      aiDecisionScore: null,
    });
  });
});

describe("Task 2.15 immutable snapshot", () => {
  it("builds a versioned Shadow-only snapshot from Task 2.14 evidence", () => {
    const snapshot = buildAiDecisionScoreSnapshot({
      clientRequestId:
        "11111111-1111-4111-8111-111111111111",
      validationRecord: {
        id: "22222222-2222-4222-8222-222222222222",
        period_id: "33333333-3333-4333-8333-333333333333",
        validation_date: "2026-07-27",
        system_recommended_topup_usdt: "100",
        actual_topup_usdt: "80",
        system_predicted_fx_gain_usdt: "10",
        actual_fx_gain_usdt: "5",
        system_recommended_quote_rate: "26500",
        actual_quote_rate: "26400",
        adjustment_reason_category: "MARKET_COMPETITION",
        system_predicted_cash_profit_usdt: "100",
        actual_cash_profit_usdt: "90",
        system_predicted_economic_profit_usdt: "200",
        actual_economic_profit_usdt: "180",
        system_risk_level: "HIGH",
        system_predicted_risk_alerts:
          completeInput.predictedRiskAlerts,
        actual_risk_outcomes: completeInput.actualRiskOutcomes,
        unexpected_risk_count: 1,
        data_cutoff_snapshot: { status: "PARTIAL" },
      },
      referenceCostRateVndPerUsdt: "26000",
      scoreVersion: 1,
      supersedesSnapshotId: null,
      createdBy: "44444444-4444-4444-8444-444444444444",
    });
    expect(snapshot).toMatchObject({
      score_date: "2026-07-27",
      score_version: 1,
      supersedes_snapshot_id: null,
      model_version: "VND_AI_DECISION_SCORE_V1",
      topup_decision_score: "74.000000",
      profit_prediction_score: "90.000000",
      evaluation_status: "COMPLETE",
      shadow_mode: true,
      automatic_payment: false,
      automatic_topup: false,
      automatic_quote_change: false,
      automatic_trading: false,
      automatic_optimization: false,
      actual_execution_performed: false,
    });
  });
});

describe("Task 2.15 database and UI safety", () => {
  it("uses RLS, audit, immutable history and explicit versioning", () => {
    expect(migration).toContain(
      "alter table public.ai_decision_score_snapshots\n  enable row level security",
    );
    expect(migration).toContain(
      "ai_decision_score_snapshots_immutable",
    );
    expect(migration).toContain(
      "audit_ai_decision_score_snapshots",
    );
    expect(migration).toContain("supersedes_snapshot_id");
    expect(migration).toContain("security_invoker = true");
    expect(migration).toContain(
      "AI_DECISION_SCORE_MUST_NOT_HAVE_MUTATION_POLICIES",
    );
    expect(migration).not.toMatch(
      /grant (?:update|delete)|for (?:update|delete)/i,
    );
  });

  it("freezes the required overall weights in database and code", () => {
    expect(migration).toContain(
      "overall_topup_weight numeric(5,4) not null default 0.30",
    );
    expect(migration).toContain(
      "new.topup_decision_score * 0.30",
    );
    expect(migration).toContain(
      "new.quote_decision_score * 0.30",
    );
    expect(migration).toContain(
      "new.profit_prediction_score * 0.25",
    );
    expect(migration).toContain("new.risk_score * 0.15");
  });

  it("shows the recent seven-day trend and never performs an action", () => {
    expect(page).toContain("最近7天评分趋势");
    expect(page).toContain("补U准确率");
    expect(page).toContain("报价准确率");
    expect(page).toContain("利润预测准确度");
    expect(page).toContain("风险预测准确率");
    expect(page).toContain("不会自动补U、付款、修改报价、交易或优化模型");
    expect(route).toContain("system_p2p_cost_rate");
    expect(route).toContain("automaticAction: false");
    expect(route).not.toMatch(
      /execute|payment|transfer|trade|quote[_-]?change/i,
    );
  });
});
