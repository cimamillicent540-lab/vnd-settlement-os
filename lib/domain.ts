import Decimal from "decimal.js";

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export const RULES = Object.freeze({
  payinFeeRate: "0.008",
  upstreamPayinSuccessFeeVnd: "2500",
  upstreamPayinFailureFeeVnd: "0",
  internalTransferFeeVnd: "0",
  lowPoolThresholdUsdt: "50000",
  minimumNetMargin: "0.002",
  targetNetMargin: "0.005",
  timezone: "UTC",
});

export type OrderStatus = "SUCCESS" | "FAILED" | "TIMEOUT" | "CANCELLED" | "PENDING";
export type CostBasisStatus = "KNOWN" | "MISSING" | "ESTIMATED";

export function calculatePayinEconomics(amountVnd: string, status: OrderStatus = "SUCCESS") {
  const amount = new Decimal(amountVnd);
  if (!amount.isInteger() || amount.isNegative()) throw new Error("VND amount must be a non-negative integer");
  const expectedFeeRevenue = amount.mul(RULES.payinFeeRate).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  const upstreamFee = new Decimal(status === "SUCCESS" ? RULES.upstreamPayinSuccessFeeVnd : status === "FAILED" ? RULES.upstreamPayinFailureFeeVnd : "0");
  return {
    expectedFeeRevenueVnd: expectedFeeRevenue.toFixed(0),
    upstreamFeeAppliedVnd: upstreamFee.toFixed(0),
    netFeeContributionVnd: expectedFeeRevenue.minus(upstreamFee).toFixed(0),
  };
}

export function validateImportedFee(amountVnd: string, importedFeeVnd: string, toleranceVnd = "1") {
  const expected = new Decimal(calculatePayinEconomics(amountVnd).expectedFeeRevenueVnd);
  const difference = new Decimal(importedFeeVnd).minus(expected);
  return {
    expectedFeeRevenueVnd: expected.toFixed(0),
    differenceVnd: difference.toFixed(0),
    status: difference.abs().lte(toleranceVnd) ? "MATCH" as const : "MISMATCH" as const,
  };
}

export function validateAp(arRate: string, asRate: string, apImported: string, tolerance = "0.00000001") {
  const ar = new Decimal(arRate);
  if (ar.lte(0)) throw new Error("AR rate must be greater than zero");
  const calculated = new Decimal(asRate).div(ar).minus(1);
  const difference = new Decimal(apImported).minus(calculated);
  return {
    apCalculated: calculated.toFixed(12),
    difference: difference.toFixed(12),
    status: difference.abs().lte(tolerance) ? "MATCH" as const : "MISMATCH" as const,
  };
}

export function aqDiagnostics(ap: string, aq: string) {
  const total = new Decimal(ap);
  const included = new Decimal(aq);
  return {
    additiveResidual: total.minus(included).toFixed(12),
    multiplicativeResidual: new Decimal(1).plus(total).div(new Decimal(1).plus(included)).minus(1).toFixed(12),
    diagnosticOnly: true as const,
    relationshipLabel: "关系公式待确认" as const,
  };
}

export interface PoolBucketInput {
  id: string;
  sourceType: "OPENING" | "PAYIN" | "TOPUP" | "ADJUSTMENT";
  availableAmountVnd: string;
  fundingRateVndPerUsdt?: string | null;
  costBasisStatus: CostBasisStatus;
}

export interface PoolAllocation extends PoolBucketInput {
  balanceBeforeVnd: string;
  allocationRatio: string;
  allocatedVnd: string;
  balanceAfterVnd: string;
  allocatedCostUsdt: string | null;
}

export class InsufficientPoolBalanceError extends Error {
  constructor(public readonly availableVnd: string, public readonly requestedVnd: string) {
    super(`Insufficient VND pool balance: ${availableVnd} available, ${requestedVnd} requested`);
  }
}

export function allocatePayoutProportionally(buckets: PoolBucketInput[], payoutAmountVnd: string): PoolAllocation[] {
  const payout = new Decimal(payoutAmountVnd);
  if (!payout.isInteger() || payout.lte(0)) throw new Error("Payout VND must be a positive integer");
  const active = buckets.filter((bucket) => new Decimal(bucket.availableAmountVnd).gt(0));
  const total = active.reduce((sum, bucket) => sum.plus(bucket.availableAmountVnd), new Decimal(0));
  if (total.lt(payout)) throw new InsufficientPoolBalanceError(total.toFixed(0), payout.toFixed(0));

  let allocated = new Decimal(0);
  return active.map((bucket, index) => {
    const before = new Decimal(bucket.availableAmountVnd);
    const ratio = before.div(total);
    const amount = index === active.length - 1
      ? payout.minus(allocated)
      : payout.mul(ratio).toDecimalPlaces(0, Decimal.ROUND_DOWN);
    if (amount.gt(before)) throw new InsufficientPoolBalanceError(total.toFixed(0), payout.toFixed(0));
    allocated = allocated.plus(amount);
    const rate = bucket.fundingRateVndPerUsdt ? new Decimal(bucket.fundingRateVndPerUsdt) : null;
    return {
      ...bucket,
      balanceBeforeVnd: before.toFixed(0),
      allocationRatio: ratio.toFixed(12),
      allocatedVnd: amount.toFixed(0),
      balanceAfterVnd: before.minus(amount).toFixed(0),
      allocatedCostUsdt: rate && rate.gt(0) ? amount.div(rate).toFixed(8) : null,
    };
  });
}

export function shouldChangePool(status: OrderStatus) { return status === "SUCCESS"; }

export interface TopupInput { usdtSpent: string; additionalFeeUsdt?: string; netVndReceived: string; }

export function summarizeTopups(topups: TopupInput[]) {
  const totalUsdt = topups.reduce((sum, item) => sum.plus(item.usdtSpent).plus(item.additionalFeeUsdt ?? 0), new Decimal(0));
  const totalVnd = topups.reduce((sum, item) => sum.plus(item.netVndReceived), new Decimal(0));
  return {
    totalUsdt: totalUsdt.toFixed(8),
    totalVnd: totalVnd.toFixed(0),
    weightedAverageRate: totalVnd.div(totalUsdt).toDecimalPlaces(10, Decimal.ROUND_DOWN).toFixed(10),
  };
}

export function poolThresholdSnapshot(balanceVnd: string, rateVndPerUsdt: string) {
  const equivalent = new Decimal(balanceVnd).div(rateVndPerUsdt);
  return { equivalentUsdt: equivalent.toFixed(8), isLow: equivalent.lt(RULES.lowPoolThresholdUsdt) };
}

export function maskCardNumber(input: string) {
  const digits = input.replace(/\D/g, "");
  if (!digits) return "";
  return digits.length <= 4 ? `****${digits}` : `**** **** **** ${digits.slice(-4)}`;
}

export function sanitizeImportRow(row: Record<string, unknown>) {
  const blocked = /^(名字|姓名|姓|名|first.?name|last.?name|cardholder)$/i;
  const card = /(卡号|银行卡|card.?number|pan)/i;
  return Object.fromEntries(Object.entries(row).flatMap(([key, value]) => {
    if (blocked.test(key)) return [];
    if (card.test(key)) return [[key, maskCardNumber(String(value ?? ""))]];
    return [[key, value]];
  }));
}

export function fingerprintText(text: string) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16).padStart(8, "0");
}
