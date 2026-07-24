import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import {
  accountHistoryDedupeKey,
  aggregateExecutionValidation,
  calculateCompanyRevenue,
  calculateTask25EconomicProfit,
  estimateMerchantFeeFromPrincipal,
  exactPayoutIdentifierMatch,
  feeRateOnTotal,
  finalizePayoutExecution,
  merchantFeeRate,
  merchantPrincipalFromTotalDebit,
  netSettlementRealizedProfitEffect,
  originalPayoutOrderFromRefund,
  parseNetSettlementReason,
  refundAmountMatches,
  splitMerchantTotalDebit,
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

  it.each([
    ["100.5", "0.5", "0.005000000000000000"],
    ["100.8", "0.8", "0.008000000000000000"],
    ["101.5", "1.5", "0.015000000000000000"],
  ])(
    "uses principal, not total debit, for %s total and %s fee",
    (total, fee, expectedRate) => {
      const principal = merchantPrincipalFromTotalDebit(total, fee);
      expect(merchantFeeRate(fee, principal)).toBe(expectedRate);
      expect(merchantFeeRate(fee, principal)).not.toBe(
        feeRateOnTotal(fee, total),
      );
    },
  );

  it("derives merchant principal as total debit minus actual fee", () => {
    expect(merchantPrincipalFromTotalDebit("100.5", "0.5")).toBe(
      "100.00000000",
    );
  });

  it("allows different merchants to have different fee rates", () => {
    expect(merchantFeeRate("0.8", "100")).not.toBe(
      merchantFeeRate("0.5", "100"),
    );
  });

  it("estimates a new quote fee from merchant principal", () => {
    expect(estimateMerchantFeeFromPrincipal("100", "0.005")).toBe(
      "0.50000000",
    );
  });

  it("inverts total debit without charging the fee twice", () => {
    expect(splitMerchantTotalDebit("100.5", "0.005")).toEqual({
      merchantPrincipalUsdt: "100.00000000",
      merchantFeeUsdt: "0.50000000",
    });
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

  it("adds DCC once and keeps AQ outside the profit formula", () => {
    expect(
      calculateTask25EconomicProfit({
        merchantPrincipalUsdt: "100",
        merchantFeeUsdt: "5",
        dccRevenueUsdt: "2",
        fundingPrincipalCostUsdt: "99",
        upstreamPayoutFeeUsdt: "1",
      }).economicProfitUsdt,
    ).toBe("7.00000000");
  });

  it("keeps actual historical fee revenue and signed DCC independent", () => {
    expect(
      calculateCompanyRevenue({
        merchantFeeUsdt: "0.8",
        fiatDccRevenueUsdt: "-0.2",
      }),
    ).toEqual({
      merchantFeeUsdt: "0.80000000",
      dccRevenueUsdt: "-0.200000000000",
      totalCompanyRevenueUsdt: "0.600000000000",
    });
  });

  it("reproduces the confirmed company revenue totals", () => {
    expect(
      calculateCompanyRevenue({
        merchantFeeUsdt: "3567.03982060",
        fiatDccRevenueUsdt: "7604.331984581133",
      }),
    ).toEqual({
      merchantFeeUsdt: "3567.03982060",
      dccRevenueUsdt: "7604.331984581133",
      totalCompanyRevenueUsdt: "11171.371805181133",
    });
  });

  it("positive DCC increases and negative DCC reduces company revenue", () => {
    const positive = calculateCompanyRevenue({
      merchantFeeUsdt: "10",
      fiatDccRevenueUsdt: "2",
    });
    const negative = calculateCompanyRevenue({
      merchantFeeUsdt: "10",
      fiatDccRevenueUsdt: "-2",
    });
    expect(positive.totalCompanyRevenueUsdt).toBe("12.000000000000");
    expect(negative.totalCompanyRevenueUsdt).toBe("8.000000000000");
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

  it("does not promote aggregate validation to per-order VERIFIED", () => {
    expect(
      aggregateExecutionValidation({
        successfulUnrefundedRows: 902,
        exactPayoutMatches: 0,
      }),
    ).toEqual({
      status: "AGGREGATE_EXECUTION_VALIDATED",
      aggregateValidatedCount: 902,
      perOrderVerifiedCount: 0,
      equivalentToPerOrderVerified: false,
    });
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

  it("never rewrites the already-applied DCC subtraction migration", () => {
    const migration = readFileSync(
      new URL(
        "../supabase/migrations/20260723224500_fix_dcc_revenue_subtraction_v1.sql",
        import.meta.url,
      ),
    );
    expect(createHash("sha256").update(migration).digest("hex")).toBe(
      "69161120dadd13e06d50755aeedb8973b213a4983d64c94fe4e20e226ede924a",
    );
  });

  it("marks the wrong run SUPERSEDED and creates an immutable replacement", () => {
    const migration = readFileSync(
      new URL(
        "../supabase/migrations/20260724063823_restore_dcc_revenue_addition_v1.sql",
        import.meta.url,
      ),
      "utf8",
    );
    expect(migration).toContain("shadow_pricing_run_supersessions");
    expect(migration).toContain("effective_status = 'SUPERSEDED'");
    expect(migration).toContain("private.reject_shadow_pricing_mutation");
    expect(migration).toContain(
      "SHADOW_PRICING_MERCHANT_FEE_DENOMINATOR_DCC_SIGNED_ADDITION_V1",
    );
    expect(migration).toContain(
      "merchant_fee_usdt + dcc_revenue_usdt",
    );
  });
});
