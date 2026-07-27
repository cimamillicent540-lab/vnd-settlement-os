import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildControlCenterRisks,
  buildTopupControl,
  calculateDailyPressure,
  classifyFundsStatus,
  CONTROL_CENTER_RULES,
  CONTROL_CENTER_SHADOW_GUARD,
  controlCenterSnapshotDate,
  recommendMerchantQuotes,
  summarizeExecutionGuard,
} from "../lib/settlement-control-center";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260727123319_vnd_settlement_control_center_v1.sql",
  ),
  "utf8",
);

describe("Daily settlement control aggregation", () => {
  it("combines historical daily and 16:00-23:00 pressure", () => {
    const rows = Array.from({ length: 24 }, (_, localHour) => ({
      localHour,
      forecastPayinVnd: localHour >= 16 ? "10" : "100",
      forecastPayoutVnd: localHour >= 16 ? "30" : "50",
      payoutConcentrationRatio: "0.10",
    }));
    const pressure = calculateDailyPressure(rows);
    expect(pressure.forecastPayoutVnd).toBe("1040.00");
    expect(pressure.forecastPayinVnd).toBe("1680.00");
    expect(pressure.forecastNetDemandVnd).toBe("0.00");
    expect(pressure.peakPressureVnd).toBe("160.00");
  });

  it("applies positive 90-day human topup learning adjustment", () => {
    const pressure = calculateDailyPressure(
      [
        {
          localHour: 16,
          forecastPayinVnd: "0",
          forecastPayoutVnd: "1000",
        },
      ],
      {
        averageSystemTopupUsdt: "100",
        averageHumanTopupUsdt: "120",
        p2pCostRate: "26500",
      },
    );
    expect(pressure.learningAdjustmentVnd).toBe("265000.00");
    expect(pressure.forecastNetDemandVnd).toBe("266000.00");
    expect(pressure.learningApplied).toBe(true);
  });

  it("classifies funds with settleable coverage, not gross balance", () => {
    expect(
      classifyFundsStatus({
        grossBalanceVnd: "1000",
        settleableBalanceVnd: "100",
        forecastNetDemandVnd: "200",
        peakPressureVnd: "200",
      }).status,
    ).toBe("CRITICAL");
    expect(
      classifyFundsStatus({
        grossBalanceVnd: "1000",
        settleableBalanceVnd: "500",
        forecastNetDemandVnd: "100",
        peakPressureVnd: "100",
      }).status,
    ).toBe("NORMAL");
  });
});

describe("Topup and inventory control", () => {
  it("uses the 26,500 × 50,000 VND inventory limit", () => {
    expect(CONTROL_CENTER_RULES.maximumInventoryVnd).toBe(
      "1325000000",
    );
    expect(
      Number(CONTROL_CENTER_RULES.inventoryLimitRate) *
        Number(CONTROL_CENTER_RULES.maximumInventoryUsdt),
    ).toBe(1325000000);
  });

  it("recommends only and requires human confirmation above the limit", () => {
    const result = buildTopupControl({
      settleableBalanceVnd: "0",
      forecastNetDemandVnd: "1000000",
      peakPressureVnd: "500000",
      currentInventoryVnd: "1325000000",
      p2pCostRate: "25000",
      fxOpportunityStatus: "NORMAL",
      weightedInventoryRate: "24000",
      fundsRiskStatus: "CRITICAL",
    });
    expect(result.topupRecommended).toBe(true);
    expect(result.requiredGrossTopupVnd).toBe("2200000.00");
    expect(result.recommendedTopupUsdt).toBe("88.00000000");
    expect(result.manualConfirmationRequired).toBe(true);
    expect(result.inventoryLimitStatus).toBe(
      "MANUAL_CONFIRMATION_REQUIRED",
    );
    expect(result.automaticTopup).toBe(false);
  });
});

describe("Merchant quote control", () => {
  it("uses the 0.2% protection and 0.5% target lines", () => {
    const recommendations = recommendMerchantQuotes({
      merchants: [
        {
          merchantName: "Low Margin Merchant",
          transactionVolumeUsdt: "100",
          contributionUsdt: "1",
          currentQuoteRate: "26000",
          currentProfitMargin: "0.0019",
          payoutCount: 10,
          channelCount: 1,
        },
        {
          merchantName: "Target Merchant",
          transactionVolumeUsdt: "100",
          contributionUsdt: "1",
          currentQuoteRate: "26000",
          currentProfitMargin: "0.005",
          payoutCount: 10,
          channelCount: 1,
        },
      ],
      globalRecommendedQuoteRate: "26000",
      p2pCostRate: "26500",
      targetMargin: "0.005",
    });
    expect(recommendations[0].riskLevel).toBe("CRITICAL");
    expect(recommendations[0].targetProfitMargin).toBe(
      "0.006000000000",
    );
    expect(recommendations[1].riskLevel).toBe("NORMAL");
    expect(recommendations[1].targetProfitMargin).toBe(
      "0.005000000000",
    );
    expect(
      recommendations.every(
        (recommendation) =>
          recommendation.automaticQuoteChange === false,
      ),
    ).toBe(true);
  });
});

describe("Risk, audit and Shadow Mode boundary", () => {
  it("aggregates Payout Execution Guard without executing payment", () => {
    const guard = summarizeExecutionGuard([
      {
        checkStatus: "BLOCKED",
        riskLevel: "HIGH",
        orderCount: 10,
        payoutPrincipalVnd: "1000",
        requiredGrossDebitVnd: "1005",
      },
      {
        checkStatus: "READY",
        riskLevel: "LOW",
        orderCount: 3,
        payoutPrincipalVnd: "300",
        requiredGrossDebitVnd: "301.5",
      },
    ]);
    expect(guard.status).toBe("CRITICAL");
    expect(guard.readyCount).toBe(3);
    expect(guard.blockedCount).toBe(10);
    expect(guard.totalRequiredGrossDebitVnd).toBe("1306.50");
    expect(guard.automaticPayment).toBe(false);
  });

  it("uses the UTC+8 operating date for immutable snapshots", () => {
    expect(
      controlCenterSnapshotDate(
        new Date("2026-07-27T16:30:00.000Z"),
      ),
    ).toBe("2026-07-28");
  });

  it("includes international market review and low-margin risk", () => {
    const risks = buildControlCenterRisks({
      fundsRiskStatus: "WARNING",
      maximumHourlyPayoutConcentration: "0.25",
      merchantRecommendations: [{ riskLevel: "CRITICAL" }],
      fxOpportunityStatus: "WAITING_INPUT",
      inventoryManualConfirmationRequired: true,
    });
    expect(risks.map((risk) => risk.code)).toEqual(
      expect.arrayContaining([
        "SETTLEABLE_CAPACITY_RISK",
        "PAYOUT_CONCENTRATION",
        "MERCHANT_PROFIT_BELOW_0_2_PERCENT",
        "FX_INPUT_RISK",
        "INVENTORY_LIMIT_MANUAL_CONFIRMATION",
        "INTERNATIONAL_MARKET_RISK",
      ]),
    );
  });

  it("keeps snapshots and human reviews immutable and audited", () => {
    expect(migration).toContain(
      "before update or delete\non public.settlement_control_center_snapshots",
    );
    expect(migration).toContain(
      "CONTROL_CENTER_HISTORY_IS_IMMUTABLE",
    );
    expect(migration).toContain(
      "audit_settlement_control_center_snapshots",
    );
    expect(migration).toContain(
      "source_learning_recommendation_id uuid",
    );
    expect(migration).toContain("enable row level security");
  });

  it("has no automatic operation or market data collection", () => {
    expect(CONTROL_CENTER_SHADOW_GUARD).toEqual({
      automaticPayment: false,
      automaticTopup: false,
      automaticQuoteChange: false,
      automaticMarketDataCollection: false,
      automaticTrading: false,
    });
    expect(migration).not.toMatch(
      /net\.http|http_post|pg_net|submitted_to_upstream/i,
    );
    expect(migration).toContain(
      "automatic_market_data_collection = false",
    );
  });
});
