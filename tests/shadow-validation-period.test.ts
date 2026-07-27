import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildDailyValidationRecord,
  buildValidationPeriodRecord,
  calculateShadowValidationMetrics,
  predictedFxGainUsdt,
  SHADOW_VALIDATION_RULES,
  validationDayNumber,
  validationPeriodDates,
} from "../lib/shadow-validation";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260727140358_vnd_shadow_validation_period_v1.sql",
  ),
  "utf8",
);
const page = readFileSync(
  resolve(process.cwd(), "app/shadow-validation/page.tsx"),
  "utf8",
);
const route = readFileSync(
  resolve(
    process.cwd(),
    "app/api/shadow-validation/route.ts",
  ),
  "utf8",
);

describe("Task 2.14 seven-day period", () => {
  it("creates exactly Day 1/7 through Day 7/7", () => {
    expect(validationPeriodDates("2026-07-27")).toEqual({
      startDate: "2026-07-27",
      endDate: "2026-08-02",
      dates: [
        "2026-07-27",
        "2026-07-28",
        "2026-07-29",
        "2026-07-30",
        "2026-07-31",
        "2026-08-01",
        "2026-08-02",
      ],
    });
    expect(validationDayNumber("2026-07-27", "2026-08-02")).toBe(
      7,
    );
    expect(() =>
      validationDayNumber("2026-07-27", "2026-08-03"),
    ).toThrow("outside the 7-day period");
  });

  it("builds an immutable Shadow-only period declaration", () => {
    expect(
      buildValidationPeriodRecord({
        clientRequestId:
          "11111111-1111-4111-8111-111111111111",
        startDate: "2026-07-27",
        createdBy: "22222222-2222-4222-8222-222222222222",
      }),
    ).toMatchObject({
      currency: "VND",
      start_date: "2026-07-27",
      end_date: "2026-08-02",
      validation_days: 7,
      shadow_mode: true,
      automatic_payment: false,
      automatic_topup: false,
      automatic_quote_change: false,
      automatic_trading: false,
      automatic_optimization: false,
    });
  });
});

describe("Task 2.14 accuracy score", () => {
  const metrics = calculateShadowValidationMetrics({
    predictedTopupUsdt: "100",
    predictedQuoteRate: "26500",
    predictedCashProfitUsdt: "100",
    predictedEconomicProfitUsdt: "200",
    predictedFxGainUsdt: "1",
    predictedRiskCodes: ["LOW_POOL", "FX_RISK"],
    actualTopupUsdt: "90",
    actualQuoteRate: "26500",
    actualCashProfitUsdt: "80",
    actualEconomicProfitUsdt: "180",
    actualFxGainUsdt: "0.75",
    fundingPressureBeforeVnd: "1000000",
    fundingPressureAfterVnd: "800000",
    actualRiskOutcomes: [
      {
        risk_code: "LOW_POOL",
        realized: true,
        note: "实际发生",
      },
      {
        risk_code: "FX_RISK",
        realized: false,
        note: "未发生",
      },
    ],
    unexpectedRiskCount: 1,
  });

  it("scores topup, quote, dual profit and risk separately", () => {
    expect(metrics).toMatchObject({
      topupAbsoluteErrorUsdt: "10.000000000000",
      topupRelativeError: "0.100000000000",
      topupAccuracyScore: "0.900000000000",
      topupWithinTenPercent: true,
      quoteAbsoluteDeviation: "0.000000000000",
      quoteAdopted: true,
      quoteAdoptionScore: "1.000000000000",
      cashProfitAbsoluteErrorUsdt: "20.000000000000",
      economicProfitAbsoluteErrorUsdt: "20.000000000000",
      profitPredictionScore: "0.850000000000",
      riskPredictionAccuracyScore: "0.333333333333",
      fxGainAbsoluteErrorUsdt: "0.250000000000",
      fundingPressureImproved: true,
      aiAccuracyScore: "77.083333",
      scoreComponentCount: 4,
    });
  });

  it("derives predicted FX gain without a market API", () => {
    expect(
      predictedFxGainUsdt({
        recommendedTopupUsdt: "100",
        fxSpreadRatio: "0.01",
      }),
    ).toBe("1.000000000000");
    expect(
      predictedFxGainUsdt({
        recommendedTopupUsdt: null,
        fxSpreadRatio: "0.01",
      }),
    ).toBeNull();
  });

  it("builds a linked immutable daily validation record", () => {
    const record = buildDailyValidationRecord({
      clientRequestId:
        "33333333-3333-4333-8333-333333333333",
      periodId: "44444444-4444-4444-8444-444444444444",
      periodStartDate: "2026-07-27",
      validationDate: "2026-07-28",
      sourceEndReviewId:
        "55555555-5555-4555-8555-555555555555",
      recommendationId:
        "66666666-6666-4666-8666-666666666666",
      humanDecisionId:
        "77777777-7777-4777-8777-777777777777",
      decisionOutcomeId:
        "88888888-8888-4888-8888-888888888888",
      reasonClassificationId:
        "99999999-9999-4999-8999-999999999999",
      acceptanceStatus: "MODIFIED",
      adjustmentReasonCategory: "RISK_CONTROL",
      adjustmentReason: " 人工根据晚间压力降低补U ",
      predicted: {
        topupRecommended: true,
        topupUsdt: "100",
        quoteRate: "26500",
        cashProfitUsdt: "100",
        economicProfitUsdt: "200",
        fxGainUsdt: "1",
        riskAlerts: [
          { code: "LOW_POOL", severity: "HIGH" },
          { code: "FX_RISK", severity: "WARNING" },
        ],
        riskLevel: "HIGH",
      },
      actual: {
        topupUsdt: "90",
        quoteRate: "26500",
        cashProfitUsdt: "80",
        economicProfitUsdt: "180",
        fxGainUsdt: "0.75",
        fundingPressureBeforeVnd: "1000000",
        fundingPressureAfterVnd: "800000",
        riskOutcomes: [
          { risk_code: "LOW_POOL", realized: true, note: "" },
          { risk_code: "FX_RISK", realized: false, note: "" },
        ],
        unexpectedRiskCount: 1,
        unexpectedRiskNotes: "出现新的通道拥堵风险",
      },
      metrics,
      dataCutoffSnapshot: { status: "PARTIAL" },
      recordedBy: "22222222-2222-4222-8222-222222222222",
    });
    expect(record).toMatchObject({
      validation_date: "2026-07-28",
      day_number: 2,
      acceptance_status: "MODIFIED",
      adjustment_reason_category: "RISK_CONTROL",
      adjustment_reason: "人工根据晚间压力降低补U",
      actual_cash_profit_usdt: "80.000000000000",
      actual_economic_profit_usdt: "180.000000000000",
      ai_accuracy_score: "77.083333",
      shadow_mode: true,
      actual_execution_performed: false,
    });
  });
});

describe("Task 2.14 database and UI safety", () => {
  it("reuses immutable recommendations, decisions, outcomes and reviews", () => {
    expect(migration).toContain(
      "references public.daily_operation_end_reviews(id)",
    );
    expect(migration).toContain(
      "references public.settlement_learning_recommendations(id)",
    );
    expect(migration).toContain(
      "references public.settlement_human_decisions(id)",
    );
    expect(migration).toContain(
      "references public.settlement_decision_outcomes(id)",
    );
    expect(route).toContain(
      "record_settlement_decision_outcome_v1",
    );
    expect(migration).not.toMatch(
      /create table public\.(?:shadow_validation_)?(?:learning_recommendations|human_decisions|decision_outcomes)/i,
    );
  });

  it("enables RLS, least privilege, audit and immutable history", () => {
    expect(migration).toContain(
      "alter table public.shadow_validation_periods\n  enable row level security",
    );
    expect(migration).toContain(
      "alter table public.shadow_validation_daily_records\n  enable row level security",
    );
    expect(migration).toContain(
      "SHADOW_VALIDATION_TABLES_MUST_NOT_HAVE_MUTATION_POLICIES",
    );
    expect(migration).toContain(
      "shadow_validation_daily_records_immutable",
    );
    expect(migration).toContain(
      "audit_shadow_validation_daily_records",
    );
    expect(migration).toContain("security_invoker = true");
    expect(migration).not.toMatch(
      /grant (?:update|delete)|for (?:update|delete)/i,
    );
  });

  it("shows Day 1/7, comparisons and all four accuracy metrics", () => {
    expect(page).toContain("captured_days} / 7");
    expect(page).toContain("AI建议 vs 人工与实际结果");
    expect(page).toContain("补U建议准确率");
    expect(page).toContain("报价建议采纳率");
    expect(page).toContain("利润预测准确率");
    expect(page).toContain("风险预测准确率");
  });

  it("cannot optimize or execute a financial action", () => {
    expect(SHADOW_VALIDATION_RULES).toMatchObject({
      validationDays: 7,
      shadowMode: true,
      automaticPayment: false,
      automaticTopup: false,
      automaticQuoteChange: false,
      automaticTrading: false,
      automaticOptimization: false,
      actualExecutionPerformed: false,
    });
    expect(route).not.toMatch(
      /fetch\(['"`]https?:|net\.http|http_post|execute_payment|execute_topup/i,
    );
    expect(migration).toContain(
      "TASK_2_14_SHADOW_GUARD_FAILED",
    );
  });
});
