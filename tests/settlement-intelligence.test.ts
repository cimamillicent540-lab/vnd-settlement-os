import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  allocateFifoInventory,
  buildSettlementRiskAlerts,
  calculateFxIntelligence,
  recommendCustomerQuote,
  recommendTopup,
  SHADOW_MODE_GUARD,
  summarizePeakWindow,
  type VndInventoryBatch,
} from "../lib/settlement-intelligence";

const batches: VndInventoryBatch[] = [
  {
    id: "batch-1",
    batchDate: "2026-07-19",
    usdtAmount: "4",
    vndAmount: "100",
    costRate: "25",
    source: "TOPUP_BATCH:1",
    remainingAmount: "100",
  },
  {
    id: "batch-2",
    batchDate: "2026-07-20",
    usdtAmount: "5",
    vndAmount: "100",
    costRate: "20",
    source: "TOPUP_BATCH:2",
    remainingAmount: "100",
  },
];

describe("VND inventory cost model", () => {
  it("stores actual topup cost lots without using a daily P2P average", () => {
    const migration = readFileSync(
      resolve(
        process.cwd(),
        "supabase/migrations/20260724142639_vnd_settlement_intelligence_v1.sql",
      ),
      "utf8",
    );
    expect(migration).toContain("cost_source_type = 'ACTUAL_TOPUP'");
    expect(migration).toContain("historical_cost_locked");
    expect(migration).toContain("topup.effective_rate_vnd_per_usdt");
    expect(migration).not.toMatch(/daily_p2p|p2p_average/i);
  });

  it("consumes inventory in FIFO order", () => {
    const result = allocateFifoInventory(batches, "150");
    expect(result.isFullyCovered).toBe(true);
    expect(result.allocations).toHaveLength(2);
    expect(result.allocations[0]).toMatchObject({
      inventoryBatchId: "batch-1",
      vndConsumed: "100.00",
      costBasisUsdt: "4.00000000",
    });
    expect(result.allocations[1]).toMatchObject({
      inventoryBatchId: "batch-2",
      vndConsumed: "50.00",
      costBasisUsdt: "2.50000000",
    });
    expect(result.costBasisUsdt).toBe("6.50000000");
  });

  it("keeps different topup prices as different cost allocations", () => {
    const result = allocateFifoInventory(batches, "150");
    expect(result.allocations.map((row) => row.costRate)).toEqual([
      "25.000000000000",
      "20.000000000000",
    ]);
    expect(result.weightedCostRate).toBe("23.076923076923");
  });
});

describe("FX, liquidity and quote intelligence", () => {
  it("calculates XE/P2P spread and opportunity correctly", () => {
    const result = calculateFxIntelligence({
      xeRate: "26000",
      p2pCostRate: "26250",
      recentP2pRates: ["26100", "26200"],
    });
    expect(result.spreadVndPerUsdt).toBe("250.000000000000");
    expect(result.spreadRatio).toBe("0.009615384615");
    expect(result.opportunity).toBe("BUY_VND_OPPORTUNITY");
  });

  it("raises an alert when expected profit is below 0.2%", () => {
    const alerts = buildSettlementRiskAlerts({
      projectedShortfallVnd: "0",
      expectedProfitMargin: "0.0019",
      fxVolatility: "0",
      maximumHourlyPayoutConcentration: "0.10",
      hasXeRate: true,
      hasP2pCostRate: true,
    });
    expect(alerts.map((alert) => alert.code)).toContain(
      "PROFIT_BELOW_0_2_PERCENT",
    );
  });

  it("raises an alert and recommends topup when settleable is insufficient", () => {
    const recommendation = recommendTopup({
      currentSettleableBalanceVnd: "0",
      forecastPayoutVnd: "1000000",
      expectedPayinVnd: "0",
      p2pCostRate: "25000",
    });
    expect(recommendation.recommendationStatus).toBe(
      "TOPUP_RECOMMENDED",
    );
    expect(recommendation.requiredGrossTopupVnd).toBe("2200000.00");
    expect(recommendation.recommendedTopupUsdt).toBe("88.00000000");
    expect(recommendation.automaticTopup).toBe(false);
    const alerts = buildSettlementRiskAlerts({
      projectedShortfallVnd: recommendation.projectedShortfallVnd,
      expectedProfitMargin: "0.005",
      fxVolatility: "0",
      maximumHourlyPayoutConcentration: "0.10",
      hasXeRate: true,
      hasP2pCostRate: true,
    });
    expect(alerts.map((alert) => alert.code)).toContain(
      "SETTLEABLE_SHORTFALL",
    );
  });

  it("uses only 16:00 through 23:00 for the peak forecast", () => {
    const rows = Array.from({ length: 24 }, (_, localHour) => ({
      localHour,
      forecastPayinVnd: localHour >= 16 ? "10" : "1000",
      forecastPayoutVnd: localHour >= 16 ? "20" : "2000",
      payoutConcentrationRatio: "0.05",
    }));
    const result = summarizePeakWindow(rows);
    expect(result.forecastPayinVnd).toBe("80.00");
    expect(result.forecastPayoutVnd).toBe("160.00");
    expect(result.forecastNetDemandVnd).toBe("80.00");
  });

  it("uses actual Account History changes for the hourly forecast", () => {
    const migration = readFileSync(
      resolve(
        process.cwd(),
        "supabase/migrations/20260724145054_fix_settlement_hourly_forecast_source_v1.sql",
      ),
      "utf8",
    );
    expect(migration).toContain("public.account_history_entries");
    expect(migration).toContain("abs(entry.gross_change_vnd)");
    expect(migration).not.toContain("payin.payin_amount_vnd");
  });

  it("never auto-applies a quote recommendation", () => {
    const quote = recommendCustomerQuote({
      xeRate: "25000",
      companyAdjustment: "-100",
      p2pCostRate: "26000",
      targetMargin: "0.005",
    });
    expect(quote.formula).toBe("XE_RATE_PLUS_COMPANY_ADJUSTMENT");
    expect(quote.adjustedQuoteRate).toBe("24900.000000000000");
    expect(quote.automaticQuoteChange).toBe(false);
  });
});

describe("Shadow Mode execution boundary", () => {
  it("does not automatically top up", () => {
    expect(SHADOW_MODE_GUARD.automaticTopup).toBe(false);
  });

  it("does not automatically change customer quotes", () => {
    expect(SHADOW_MODE_GUARD.automaticQuoteChange).toBe(false);
  });

  it("does not automatically pay or trade", () => {
    expect(SHADOW_MODE_GUARD.automaticPayment).toBe(false);
    expect(SHADOW_MODE_GUARD.automaticTrading).toBe(false);
    const migration = readFileSync(
      resolve(
        process.cwd(),
        "supabase/migrations/20260724142639_vnd_settlement_intelligence_v1.sql",
      ),
      "utf8",
    );
    expect(migration).not.toMatch(/net\.http|http_post|pg_net/i);
  });
});
