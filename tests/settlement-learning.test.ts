import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildSettlementLearningRecommendation,
  SETTLEMENT_LEARNING_RULES,
  SETTLEMENT_LEARNING_SHADOW_GUARD,
} from "../lib/settlement-learning";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260727120459_settlement_learning_feedback_v1.sql",
);
const migration = readFileSync(migrationPath, "utf8");

describe("Settlement Learning recommendation records", () => {
  it("captures topup, quote, risk, profit and FX recommendations", () => {
    const record = buildSettlementLearningRecommendation({
      clientRequestId: "11111111-1111-4111-8111-111111111111",
      currency: "vnd",
      generatedBy: "22222222-2222-4222-8222-222222222222",
      topupRecommended: true,
      recommendedTopupUsdt: "100.00000000",
      requiredGrossTopupVnd: "2625000.00",
      recommendedQuoteRate: "26120.000000000000",
      targetMargin: "0.005000000000",
      riskAlerts: [
        {
          code: "SETTLEABLE_SHORTFALL",
          severity: "HIGH",
          message: "可结算余额不足",
        },
      ],
      expectedProfitUsdt: "50.000000000000",
      expectedProfitMargin: "0.005000000000",
      cashProfitUsdt: "30.000000000000",
      cashProfitMargin: "0.003000000000",
      economicProfitUsdt: "50.000000000000",
      economicProfitMargin: "0.005000000000",
      profitMetricsSnapshot: {
        dataStatus: "FORECAST_PARTIAL_ACTUAL_FEES_NOT_AVAILABLE",
      },
      fxJudgment: "BUY_VND_OPPORTUNITY",
      xeRate: "26000.000000000000",
      p2pCostRate: "26250.000000000000",
      fxSpreadRatio: "0.009615384615",
      systemPayload: { source: "settlement-intelligence" },
      dataCutoffSnapshot: { accountHistoryUtc: "2026-07-18" },
    });

    expect(record).toMatchObject({
      currency: "VND",
      learning_phase: "PHASE_1_HUMAN_REVIEW",
      learning_window_days: 90,
      system_topup_recommended: true,
      system_recommended_topup_usdt: "100.00000000",
      system_recommended_quote_rate: "26120.000000000000",
      system_expected_profit_usdt: "50.000000000000",
      system_cash_profit_usdt: "30.000000000000",
      system_economic_profit_usdt: "50.000000000000",
      system_fx_judgment: "BUY_VND_OPPORTUNITY",
      shadow_mode: true,
    });
    expect(record.system_risk_alerts).toHaveLength(1);
  });

  it("keeps the learning window at 90 days and isolates currencies", () => {
    expect(SETTLEMENT_LEARNING_RULES.learningWindowDays).toBe(90);
    expect(migration).toContain(
      "recommendation.currency",
    );
    expect(migration).toContain(
      "group by recommendation.currency",
    );
    expect(migration).toContain("currency ~ '^[A-Z]{3}$'");
  });
});

describe("Human decision feedback", () => {
  it("requires an adjustment reason and stores final human outcomes", () => {
    expect(migration).toContain("adjustment_reason text not null");
    expect(migration).toContain("ADJUSTMENT_REASON_REQUIRED");
    expect(migration).toContain("final_topup_usdt");
    expect(migration).toContain("final_quote_rate");
    expect(migration).toContain("final_execution_decision");
    expect(migration).toContain("accepted_system_suggestion");
  });

  it("stores merchant quote context and structured risk judgment", () => {
    expect(migration).toContain("merchant_name text");
    expect(migration).toContain("transaction_volume_usdt");
    expect(migration).toContain("profit_contribution_usdt");
    expect(migration).toContain(
      "human_judgment in ('CONFIRMED', 'IGNORED')",
    );
    expect(migration).toContain(
      "ALL_SYSTEM_RISKS_REQUIRE_HUMAN_JUDGMENT",
    );
  });

  it("appends decision versions without mutating history", () => {
    expect(migration).toContain("decision_version integer not null");
    expect(migration).toContain("supersedes_decision_id");
    expect(migration).toContain(
      "SETTLEMENT_LEARNING_HISTORY_IS_IMMUTABLE",
    );
    expect(migration).toContain(
      "before update or delete on public.settlement_human_decisions",
    );
  });
});

describe("Phase 1 execution boundary", () => {
  it("disables every automatic or actual execution path", () => {
    expect(SETTLEMENT_LEARNING_SHADOW_GUARD).toEqual({
      automaticPayment: false,
      automaticTopup: false,
      automaticQuoteChange: false,
      automaticTrading: false,
      actualExecutionPerformed: false,
    });
    expect(migration).toContain(
      "actual_execution_performed = false",
    );
    expect(migration).toContain("automatic_payment = false");
    expect(migration).toContain("automatic_topup = false");
    expect(migration).toContain("automatic_quote_change = false");
    expect(migration).toContain("automatic_trading = false");
  });

  it("contains no outbound execution mechanism", () => {
    expect(migration).not.toMatch(
      /net\.http|http_post|pg_net|submitted_to_upstream/i,
    );
  });
});
