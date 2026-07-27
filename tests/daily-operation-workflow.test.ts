import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildDayDecisionSnapshotRecord,
  buildEndReviewRecord,
  buildRiskCheckRecord,
  calculateManualFxOpportunity,
  captureStatusForCheckpoint,
  DAILY_OPERATION_RULES,
} from "../lib/daily-operation";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260727125700_vnd_daily_operation_workflow_v1.sql",
  ),
  "utf8",
);
const page = readFileSync(
  resolve(process.cwd(), "app/daily-operation/page.tsx"),
  "utf8",
);
const actions = readFileSync(
  resolve(
    process.cwd(),
    "components/daily-operation-actions.tsx",
  ),
  "utf8",
);
const route = readFileSync(
  resolve(process.cwd(), "app/api/daily-operation/route.ts"),
  "utf8",
);

describe("Task 2.13 11:00 day decision", () => {
  it("uses Settleable, 50% ratio and 10% buffer for advice only", () => {
    const record = buildDayDecisionSnapshotRecord({
      clientRequestId: "11111111-1111-4111-8111-111111111111",
      operatingDate: "2026-07-27",
      capturedAt: new Date("2026-07-27T03:15:00.000Z"),
      createdBy: "22222222-2222-4222-8222-222222222222",
      sourceLearningRecommendationId:
        "33333333-3333-4333-8333-333333333333",
      sourceControlSnapshotId: null,
      balances: {
        grossBalanceVnd: "2000000000",
        reserveBalanceVnd: "1000000000",
        settleableBalanceVnd: "1000000000",
      },
      forecast: {
        payinVnd: "200000000",
        payoutVnd: "1200000000",
        netDemandVnd: "1000000000",
        peakPressureVnd: "1200000000",
      },
      recommendedCoverageTime: "BEFORE_16_00",
      sourceTopupReasons: ["晚间资金压力"],
      manualFx: {
        binanceP2pRate: "26500",
        upstreamQuoteRate: "26600",
        xeRate: "26400",
      },
      dataCutoffSnapshot: { status: "PARTIAL" },
    });

    expect(record.available_funds_ratio).toBe("0.500000000000");
    expect(record.required_settleable_with_buffer_vnd).toBe(
      "1320000000.00",
    );
    expect(record.projected_shortfall_vnd).toBe("320000000.00");
    expect(record.required_gross_topup_vnd).toBe("640000000.00");
    expect(record.recommended_topup_usdt).toBe("24060.15037594");
    expect(record.capture_status).toBe("ON_TIME");
    expect(record).toMatchObject({
      settleable_ratio: "0.50",
      safety_buffer_ratio: "0.10",
      topup_recommended: true,
      shadow_mode: true,
      automatic_payment: false,
      automatic_topup: false,
      automatic_quote_change: false,
      automatic_market_data_collection: false,
      automatic_trading: false,
    });
  });

  it("calculates opportunity only from manually supplied rates", () => {
    expect(
      calculateManualFxOpportunity({
        binanceP2pRate: "26500",
        upstreamQuoteRate: "26600",
        xeRate: "26400",
      }),
    ).toMatchObject({
      bestSourceRate: "26600.000000000000",
      spreadVndPerUsdt: "200.000000000000",
      opportunityStatus: "ARBITRAGE_SPACE",
      arbitrageSpaceExists: true,
      inputMode: "MANUAL_ONLY",
    });
    expect(captureStatusForCheckpoint(16, new Date("2026-07-27T07:59:00Z"))).toBe(
      "EARLY_MANUAL_PREPARATION",
    );
  });
});

describe("Task 2.13 16:00 and 23:00 workflow", () => {
  it("checks all five risk dimensions and returns LOW/MEDIUM/HIGH", () => {
    const record = buildRiskCheckRecord({
      clientRequestId: "44444444-4444-4444-8444-444444444444",
      operatingDate: "2026-07-27",
      capturedAt: new Date("2026-07-27T08:10:00Z"),
      createdBy: "22222222-2222-4222-8222-222222222222",
      dayDecisionSnapshotId:
        "55555555-5555-4555-8555-555555555555",
      settleableBalanceVnd: "1000000000",
      projectedShortfallVnd: "320000000",
      maximumHourlyPayoutConcentration: "0.40",
      economicProfitMargin: "0.0015",
      fxSpreadRatio: "-0.001",
      systemRiskAlerts: [],
      internationalMarketNotes: [
        {
          id: "note-1",
          category: "INTERNATIONAL_GEOPOLITICS",
          severity: "WARNING",
          title: "国际风险",
          reason: "人工备注",
        },
      ],
      dataCutoffSnapshot: {},
    });
    expect(record.risk_score).toBe(5);
    expect(record.risk_level).toBe("HIGH");
    expect(record.risk_alerts).toHaveLength(5);
    expect(record.automatic_trading).toBe(false);
  });

  it("saves Cash and Economic Profit together with required reason", () => {
    const record = buildEndReviewRecord({
      clientRequestId: "66666666-6666-4666-8666-666666666666",
      operatingDate: "2026-07-27",
      capturedAt: new Date("2026-07-27T15:20:00Z"),
      createdBy: "22222222-2222-4222-8222-222222222222",
      dayDecisionSnapshotId:
        "55555555-5555-4555-8555-555555555555",
      riskCheckId: "77777777-7777-4777-8777-777777777777",
      sourceDailyReportSnapshotId: null,
      sourceLearningRecommendationId:
        "33333333-3333-4333-8333-333333333333",
      humanDecisionId: "88888888-8888-4888-8888-888888888888",
      reasonClassificationId:
        "99999999-9999-4999-8999-999999999999",
      decisionOutcomeId:
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      cashProfitUsdt: "123.45",
      economicProfitUsdt: "98.76",
      systemRecommendationsSnapshot: { topup: "24060" },
      humanFinalDecisionSnapshot: { topup: "20000" },
      acceptanceStatus: "MODIFIED",
      reasonCategory: "FUNDING_ARRANGEMENT",
      adjustmentReason: " 晚间交易预测下降，保守安排资金 ",
      finalTopupUsdt: "20000",
      finalQuoteRate: "26480",
      finalExecutionDecision: "DEFER",
      riskFeedbackSnapshot: [],
      dataCutoffSnapshot: {},
    });
    expect(record).toMatchObject({
      cash_profit_usdt: "123.450000000000",
      economic_profit_usdt: "98.760000000000",
      adjustment_reason_category: "FUNDING_ARRANGEMENT",
      adjustment_reason: "晚间交易预测下降，保守安排资金",
      learning_window_days: 90,
      actual_execution_performed: false,
    });
    expect(record.learning_record_snapshot).toMatchObject({
      finalCashProfitUsdt: "123.450000000000",
      finalEconomicProfitUsdt: "98.760000000000",
      automaticOptimization: false,
    });
  });
});

describe("Task 2.13 persistence and safety", () => {
  it("uses immutable RLS tables, audit triggers, FKs and indexes", () => {
    for (const table of [
      "daily_operation_decision_snapshots",
      "daily_operation_risk_checks",
      "settlement_decision_reason_classifications",
      "daily_operation_end_reviews",
    ]) {
      expect(migration).toContain(
        `alter table public.${table}\n  enable row level security`,
      );
      expect(migration).toContain(`audit_${table}`);
    }
    expect(migration).toContain(
      "DAILY_OPERATION_TABLES_MUST_NOT_HAVE_MUTATION_POLICIES",
    );
    expect(migration).toContain(
      "daily_operation_risk_day_decision_idx",
    );
    expect(migration).toContain(
      "daily_operation_end_learning_idx",
    );
    expect(migration).toContain("security_invoker = true");
  });

  it("extends the existing learning system instead of duplicating it", () => {
    expect(migration).toContain(
      "public.record_settlement_human_decision_v1(",
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
    expect(migration).not.toMatch(
      /create table public\.(?:daily_operation_)?(?:learning_recommendations|human_decisions)/i,
    );
  });

  it("exposes three manual checkpoints and no execution path", () => {
    expect(page).toContain("11:00 日间决策");
    expect(page).toContain("16:00 资金压力检查");
    expect(page).toContain("23:00 日终复盘");
    expect(actions).toContain("调整原因");
    expect(actions).toContain("逐条风险判断");
    expect(route).not.toMatch(
      /fetch\(['"`]https?:|net\.http|http_post|execute_payment|execute_topup/i,
    );
    expect(DAILY_OPERATION_RULES).toMatchObject({
      shadowMode: true,
      automaticPayment: false,
      automaticTopup: false,
      automaticQuoteChange: false,
      automaticMarketDataCollection: false,
      automaticTrading: false,
      actualExecutionPerformed: false,
    });
  });
});
