import { readFileSync } from "node:fs";
import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import {
  accountHistoryDedupeKey,
  calculateCompanyRevenue,
  calculateTask25EconomicProfit,
  exactPayoutIdentifierMatch,
  finalizePayoutExecution,
  merchantFeeRate,
  netSettlementRealizedProfitEffect,
  originalPayoutOrderFromRefund,
  parseNetSettlementReason,
  refundAmountMatches,
  task25ProfitVerification,
} from "../lib/task25";

describe("Task 2.5 Account History import and exact matching", () => {
  it("deduplicates the same business order, timestamp and amount", () => {
    const input = {
      currency: "VND",
      businessOrderNumber: "ORDER-1",
      transactionTime: "2026-07-20T00:00:00Z",
      transactionType: "代付",
      direction: "减少",
      changeAmount: "1005",
    };
    expect(accountHistoryDedupeKey(input)).toBe(
      accountHistoryDedupeKey({ ...input }),
    );
  });

  it("matches a complete upstream order number exactly", () => {
    expect(
      exactPayoutIdentifierMatch("UPSTREAM-1", [
        { payoutOrderId: "p1", providerOrderNumber: "UPSTREAM-1" },
      ]),
    ).toMatchObject({
      payoutOrderId: "p1",
      method: "FULL_ORDER_NUMBER",
      confidence: "HIGH",
    });
  });

  it("never promotes an unmatched amount/time candidate", () => {
    expect(exactPayoutIdentifierMatch("MISSING", [])).toMatchObject({
      payoutOrderId: null,
      method: "NO_EXACT_IDENTIFIER_MATCH",
      confidence: "NONE",
    });
  });
});

describe("Task 2.5 refunds", () => {
  it("removes the R suffix to find the original payout", () => {
    expect(originalPayoutOrderFromRefund("ORDER-1R")).toBe("ORDER-1");
  });

  it("requires refund credit to equal principal plus upstream fee", () => {
    expect(
      refundAmountMatches({
        refundCreditVnd: "1005000",
        originalPrincipalVnd: "1000000",
        originalUpstreamFeeVnd: "5000",
      }),
    ).toBe(true);
  });

  it("sets final upstream fee and Gross outflow to zero after refund", () => {
    expect(
      finalizePayoutExecution({
        principalVnd: "1000000",
        upstreamFeeVnd: "5000",
        refundCreditVnd: "1005000",
      }),
    ).toEqual({
      finalPayoutStatus: "REFUNDED",
      finalUpstreamFeeVnd: "0.00",
      finalGrossOutflowVnd: "0.00",
    });
  });
});

describe("Task 2.5 upstream and merchant fees", () => {
  it("keeps the actual Account History fee for a successful payout", () => {
    expect(
      finalizePayoutExecution({
        principalVnd: "47237146",
        upstreamFeeVnd: "236185.73",
      }).finalUpstreamFeeVnd,
    ).toBe("236185.73");
  });

  it("validates the observed upstream fee near 0.5 percent", () => {
    expect(
      new Decimal("236185.73").div("47237146").toFixed(12),
    ).toBe("0.005000000000");
  });

  it("calculates merchant fee rate per order", () => {
    expect(merchantFeeRate("0.5", "100")).toBe("0.005000000000000000");
  });

  it("allows different merchants to have different fee rates", () => {
    expect(merchantFeeRate("0.8", "100")).not.toBe(
      merchantFeeRate("0.5", "100"),
    );
  });
});

describe("Task 2.5 DCC and profit separation", () => {
  it("separates DCC revenue from merchant fee revenue", () => {
    expect(
      calculateCompanyRevenue({
        merchantFeeUsdt: "5",
        fiatDccRevenueUsdt: "2",
      }),
    ).toEqual({
      merchantFeeUsdt: "5.00000000",
      dccRevenueUsdt: "2.000000000000",
      totalCompanyRevenueUsdt: "7.000000000000",
    });
  });

  it("does not deduct DCC or AQ a second time", () => {
    expect(
      calculateTask25EconomicProfit({
        amountUsdt: "100",
        merchantFeeUsdt: "5",
        dccRevenueUsdt: "2",
        fundingPrincipalCostUsdt: "99",
        upstreamPayoutFeeUsdt: "1",
      }).economicProfitUsdt,
    ).toBe("7.00000000");
  });
});

describe("Task 2.5 Net Settlement", () => {
  const reasons = [
    "【可用余额】settlement\n26,616*70000usdt=1,863,120,000vnd",
    "【可用余额】settlement\n26,705*70000usdt=1,869,350,000vnd",
    "【可用余额】settlement\n26,461*90000usdt=2,381,490,000vnd",
  ];

  it("parses all three verified VND settlement legs", () => {
    const parsed = reasons.map((reason) => parseNetSettlementReason(reason));
    expect(parsed.every((row) => row?.rateMatches)).toBe(true);
    expect(
      Decimal.sum(...parsed.map((row) => row?.usdtAmount ?? 0)).toFixed(8),
    ).toBe("230000.00000000");
    expect(
      Decimal.sum(...parsed.map((row) => row?.vndAmount ?? 0)).toFixed(2),
    ).toBe("6113960000.00");
  });

  it("classifies settlement separately from TOPUP", () => {
    expect(parseNetSettlementReason(reasons[0])?.classification).toBe(
      "NET_SETTLEMENT",
    );
  });

  it("keeps realized profit effect at zero while direction is pending", () => {
    expect(
      netSettlementRealizedProfitEffect("PENDING_DIRECTION_CONFIRMATION"),
    ).toBe("0.00000000");
  });
});

describe("Task 2.5 confidence and safety", () => {
  it("keeps unmatched Payout profit ESTIMATED", () => {
    expect(
      task25ProfitVerification({
        hasExactPayoutMatch: false,
        hasMerchantFee: true,
        hasDccValidation: true,
        hasFundingCost: true,
        netSettlementComplete: false,
        refunded: false,
      }),
    ).toBe("ESTIMATED");
  });

  it("keeps the importer in Shadow Mode without automatic fund actions", () => {
    const importer = readFileSync(
      new URL(
        "../scripts/import-task25-account-history.mjs",
        import.meta.url,
      ),
      "utf8",
    );
    expect(importer).toContain("automatic_funds_actions: false");
    expect(importer).not.toMatch(/automatic[_-](payment|topup|channel)/i);
  });
});
