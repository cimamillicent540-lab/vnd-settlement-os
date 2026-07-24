import crypto from "node:crypto";
import Decimal from "decimal.js";

export type ExactIdentifierRecord = {
  payoutOrderId: string;
  orderNumber?: string | null;
  providerOrderNumber?: string | null;
  cpPaymentOrderNumber?: string | null;
  paymentOrderNumber?: string | null;
  channelOrderNumber?: string | null;
  cpOrderNumber?: string | null;
  merchantOrderNumber?: string | null;
};

export function accountHistoryDedupeKey(input: {
  currency: string;
  businessOrderNumber: string;
  transactionTime: string;
  transactionType: string;
  direction: string;
  changeAmount: string;
}) {
  const canonical = [
    input.currency,
    input.businessOrderNumber.trim(),
    new Date(input.transactionTime).toISOString(),
    input.transactionType,
    input.direction,
    new Decimal(input.changeAmount).toFixed(2),
  ].join("\u001f");
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

export function exactPayoutIdentifierMatch(
  businessOrderNumber: string,
  identifiers: ExactIdentifierRecord[],
) {
  const value = businessOrderNumber.trim();
  const priorities: Array<
    [keyof ExactIdentifierRecord, "FULL_ORDER_NUMBER" | "CHANNEL_ORDER_NUMBER"]
  > = [
    ["orderNumber", "FULL_ORDER_NUMBER"],
    ["providerOrderNumber", "FULL_ORDER_NUMBER"],
    ["cpPaymentOrderNumber", "FULL_ORDER_NUMBER"],
    ["paymentOrderNumber", "FULL_ORDER_NUMBER"],
    ["channelOrderNumber", "CHANNEL_ORDER_NUMBER"],
    ["cpOrderNumber", "FULL_ORDER_NUMBER"],
    ["merchantOrderNumber", "FULL_ORDER_NUMBER"],
  ];
  for (const [field, method] of priorities) {
    const matches = identifiers.filter(
      (row) => String(row[field] ?? "").trim() === value,
    );
    if (matches.length === 1) {
      return {
        payoutOrderId: matches[0].payoutOrderId,
        method,
        confidence: "HIGH" as const,
        conflict: false,
      };
    }
    if (matches.length > 1) {
      return {
        payoutOrderId: null,
        method: "CONFLICT" as const,
        confidence: "NONE" as const,
        conflict: true,
      };
    }
  }
  return {
    payoutOrderId: null,
    method: "NO_EXACT_IDENTIFIER_MATCH" as const,
    confidence: "NONE" as const,
    conflict: false,
  };
}

export function originalPayoutOrderFromRefund(refundOrderId: string) {
  const value = refundOrderId.trim();
  return value.endsWith("R") ? value.slice(0, -1) : value;
}

export function refundAmountMatches(input: {
  refundCreditVnd: string;
  originalPrincipalVnd: string;
  originalUpstreamFeeVnd: string;
}) {
  return new Decimal(input.refundCreditVnd).eq(
    new Decimal(input.originalPrincipalVnd).plus(
      input.originalUpstreamFeeVnd,
    ),
  );
}

export function finalizePayoutExecution(input: {
  principalVnd: string;
  upstreamFeeVnd: string;
  refundCreditVnd?: string | null;
}) {
  const originalGross = new Decimal(input.principalVnd).plus(
    input.upstreamFeeVnd,
  );
  const refunded =
    input.refundCreditVnd != null &&
    new Decimal(input.refundCreditVnd).eq(originalGross);
  return {
    finalPayoutStatus: refunded ? ("REFUNDED" as const) : ("SUCCESS" as const),
    finalUpstreamFeeVnd: refunded
      ? "0.00"
      : new Decimal(input.upstreamFeeVnd).toFixed(2),
    finalGrossOutflowVnd: refunded ? "0.00" : originalGross.toFixed(2),
  };
}

export function merchantFeeRate(
  merchantFeeUsdt: string,
  merchantPrincipalUsdt: string,
) {
  const principal = new Decimal(merchantPrincipalUsdt);
  if (!principal.gt(0)) return null;
  return new Decimal(merchantFeeUsdt).div(principal).toFixed(18);
}

export function merchantPrincipalFromTotalDebit(
  merchantTotalDebitUsdt: string,
  merchantFeeUsdt: string,
) {
  const principal = new Decimal(merchantTotalDebitUsdt).minus(
    merchantFeeUsdt,
  );
  if (principal.isNegative()) {
    throw new Error("Merchant fee cannot exceed total debit");
  }
  return principal.toFixed(8);
}

export function feeRateOnTotal(
  merchantFeeUsdt: string,
  merchantTotalDebitUsdt: string,
) {
  const total = new Decimal(merchantTotalDebitUsdt);
  if (!total.gt(0)) return null;
  return new Decimal(merchantFeeUsdt).div(total).toFixed(18);
}

export function estimateMerchantFeeFromPrincipal(
  merchantPrincipalUsdt: string,
  approvedMerchantFeeRate: string,
) {
  return new Decimal(merchantPrincipalUsdt)
    .mul(approvedMerchantFeeRate)
    .toFixed(8);
}

export function splitMerchantTotalDebit(
  merchantTotalDebitUsdt: string,
  approvedMerchantFeeRate: string,
) {
  const total = new Decimal(merchantTotalDebitUsdt);
  const rate = new Decimal(approvedMerchantFeeRate);
  if (total.isNegative() || rate.isNegative()) {
    throw new Error("Merchant total debit and fee rate must be non-negative");
  }
  const principal = total.div(rate.plus(1));
  return {
    merchantPrincipalUsdt: principal.toFixed(8),
    merchantFeeUsdt: total.minus(principal).toFixed(8),
  };
}

export function calculateCompanyRevenue(input: {
  merchantFeeUsdt: string;
  fiatDccRevenueUsdt?: string | null;
  cryptoDccRevenueUsdt?: string | null;
}) {
  const merchantFee = new Decimal(input.merchantFeeUsdt);
  const dccRevenue = new Decimal(input.fiatDccRevenueUsdt ?? 0).plus(
    input.cryptoDccRevenueUsdt ?? 0,
  );
  return {
    merchantFeeUsdt: merchantFee.toFixed(8),
    dccRevenueUsdt: dccRevenue.toFixed(12),
    totalCompanyRevenueUsdt: merchantFee.plus(dccRevenue).toFixed(12),
  };
}

export function calculateTask25EconomicProfit(input: {
  merchantPrincipalUsdt: string;
  merchantFeeUsdt: string;
  dccRevenueUsdt: string;
  fundingPrincipalCostUsdt: string;
  upstreamPayoutFeeUsdt: string;
  otherCompanyCostUsdt?: string;
}) {
  const revenue = new Decimal(input.merchantPrincipalUsdt)
    .plus(input.merchantFeeUsdt)
    .plus(input.dccRevenueUsdt);
  const cost = new Decimal(input.fundingPrincipalCostUsdt)
    .plus(input.upstreamPayoutFeeUsdt)
    .plus(input.otherCompanyCostUsdt ?? 0);
  const profit = revenue.minus(cost);
  return {
    economicProfitUsdt: profit.toFixed(8),
    economicProfitMargin: new Decimal(input.merchantPrincipalUsdt).gt(0)
      ? profit.div(input.merchantPrincipalUsdt).toFixed(12)
      : null,
  };
}

export function aggregateExecutionValidation(input: {
  successfulUnrefundedRows: number;
  exactPayoutMatches: number;
}) {
  return {
    status:
      input.successfulUnrefundedRows > 0
        ? ("AGGREGATE_EXECUTION_VALIDATED" as const)
        : ("NOT_APPLICABLE" as const),
    aggregateValidatedCount: input.successfulUnrefundedRows,
    perOrderVerifiedCount: input.exactPayoutMatches,
    equivalentToPerOrderVerified: false as const,
  };
}

export function parseNetSettlementReason(reason: string) {
  const match = reason.replace(/,/g, "").match(
    /([0-9]+(?:\.[0-9]+)?)\s*\*\s*([0-9]+(?:\.[0-9]+)?)\s*usdt\s*=\s*([0-9]+(?:\.[0-9]+)?)\s*vnd/i,
  );
  if (!match) return null;
  const [, statedRate, usdtAmount, vndAmount] = match;
  const actualRate = new Decimal(vndAmount).div(usdtAmount);
  return {
    statedRate: new Decimal(statedRate).toFixed(12),
    usdtAmount: new Decimal(usdtAmount).toFixed(8),
    vndAmount: new Decimal(vndAmount).toFixed(2),
    actualRateVndPerUsdt: actualRate.toFixed(12),
    rateMatches: actualRate.minus(statedRate).abs().lte("0.000001"),
    classification: "NET_SETTLEMENT" as const,
  };
}

export function netSettlementRealizedProfitEffect(
  counterLegStatus:
    | "VERIFIED"
    | "PENDING_DIRECTION_CONFIRMATION"
    | "MISSING",
) {
  return counterLegStatus === "PENDING_DIRECTION_CONFIRMATION"
    ? "0.00000000"
    : null;
}

export function task25ProfitVerification(input: {
  hasExactPayoutMatch: boolean;
  hasMerchantFee: boolean;
  hasDccValidation: boolean;
  hasFundingCost: boolean;
  netSettlementComplete: boolean;
  refunded: boolean;
}) {
  if (input.refunded) return "NOT_CALCULABLE" as const;
  if (!input.hasExactPayoutMatch) return "ESTIMATED" as const;
  if (
    input.hasMerchantFee &&
    input.hasDccValidation &&
    input.hasFundingCost &&
    input.netSettlementComplete
  ) {
    return "VERIFIED" as const;
  }
  return "PARTIAL" as const;
}
