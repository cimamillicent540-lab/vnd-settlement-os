import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { calculateDualProfitMetrics } from "../lib/profit-metrics";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260727153010_freeze_dual_profit_metrics_v1.sql",
  ),
  "utf8",
);

describe("Cash Profit and Economic Profit", () => {
  it("calculates and retains both metrics", () => {
    const result = calculateDualProfitMetrics({
      merchantPrincipalUsdt: "1000",
      merchantFeeRevenueUsdt: "100",
      signedDccRevenueUsdt: "20",
      realizedFxProfitUsdt: "10",
      channelFeesUsdt: "5",
      otherActualFeesUsdt: "2",
      signedInternalFundingAdvantageUsdt: "30",
      shadowCostUsdt: "4",
      opportunityCostUsdt: "3",
      unrealizedRiskCostUsdt: "1",
    });
    expect(result.cashProfitUsdt).toBe("123.000000000000");
    expect(result.cashProfitMargin).toBe("0.123000000000");
    expect(result.economicProfitUsdt).toBe(
      "145.000000000000",
    );
    expect(result.economicProfitMargin).toBe("0.145000000000");
  });

  it("uses signed DCC so a discount reduces Cash Profit", () => {
    const positive = calculateDualProfitMetrics({
      merchantPrincipalUsdt: "1000",
      merchantFeeRevenueUsdt: "10",
      signedDccRevenueUsdt: "5",
    });
    const negative = calculateDualProfitMetrics({
      merchantPrincipalUsdt: "1000",
      merchantFeeRevenueUsdt: "10",
      signedDccRevenueUsdt: "-5",
    });
    expect(positive.cashProfitUsdt).toBe("15.000000000000");
    expect(negative.cashProfitUsdt).toBe("5.000000000000");
  });

  it("does not allow a negative cost component", () => {
    expect(() =>
      calculateDualProfitMetrics({
        merchantPrincipalUsdt: "1000",
        merchantFeeRevenueUsdt: "10",
        signedDccRevenueUsdt: "0",
        opportunityCostUsdt: "-1",
      }),
    ).toThrow("Profit cost component cannot be negative");
  });
});

describe("Dual-profit persistence and learning", () => {
  it("adds both metrics to control snapshots and learning data", () => {
    expect(migration).toContain(
      "system_cash_profit_usdt numeric(38,12)",
    );
    expect(migration).toContain(
      "system_economic_profit_usdt numeric(38,12)",
    );
    expect(migration).toContain(
      "cash_profit_usdt numeric(38,12)",
    );
    expect(migration).toContain(
      "economic_profit_usdt numeric(38,12)",
    );
    expect(migration).toContain(
      "'PROFIT_DUAL_METRICS_90D_LEARNING'",
    );
  });

  it("freezes version 2 with BOTH_REQUIRED display", () => {
    expect(migration).toContain(
      "'VND_BUSINESS_RULES_FREEZE_V2'",
    );
    expect(migration).toContain(
      '"display_mode": "BOTH_REQUIRED"',
    );
    expect(migration).toContain(
      "'PROFIT_DUAL_METRICS_REQUIRED'",
    );
  });

  it("marks unavailable future costs without inventing values", () => {
    expect(migration).toContain(
      "'NOT_AVAILABLE_ZERO_NOT_INVENTED'",
    );
    expect(migration).toContain(
      "0::numeric(38,12) as opportunity_cost_usdt",
    );
    expect(migration).toContain(
      "0::numeric(38,12) as unrealized_risk_cost_usdt",
    );
  });

  it("remains a read-only Shadow Mode calculation", () => {
    expect(migration).toContain("with (security_invoker = true)");
    expect(migration).not.toMatch(
      /net\.http|http_post|pg_net|submitted_to_upstream/i,
    );
    expect(migration).toContain(
      "automatic_topup",
    );
    expect(migration).toContain(
      "automatic_quote_change",
    );
  });
});
