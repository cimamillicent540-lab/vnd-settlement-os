import Decimal from "decimal.js";

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

function amount(value: string | number | null | undefined) {
  const parsed = new Decimal(value ?? 0);
  if (!parsed.isFinite()) throw new Error("Profit amount must be finite");
  return parsed;
}

function cost(value: string | number | null | undefined) {
  const parsed = amount(value);
  if (parsed.isNegative()) {
    throw new Error("Profit cost component cannot be negative");
  }
  return parsed;
}

export function calculateDualProfitMetrics(input: {
  merchantPrincipalUsdt: string | number;
  merchantFeeRevenueUsdt: string | number;
  signedDccRevenueUsdt: string | number;
  realizedFxProfitUsdt?: string | number | null;
  channelFeesUsdt?: string | number | null;
  otherActualFeesUsdt?: string | number | null;
  signedInternalFundingAdvantageUsdt?: string | number | null;
  shadowCostUsdt?: string | number | null;
  opportunityCostUsdt?: string | number | null;
  unrealizedRiskCostUsdt?: string | number | null;
  dataStatus?: string;
}) {
  const principal = cost(input.merchantPrincipalUsdt);
  const merchantFee = amount(input.merchantFeeRevenueUsdt);
  const dcc = amount(input.signedDccRevenueUsdt);
  const realizedFx = amount(input.realizedFxProfitUsdt);
  const channelFees = cost(input.channelFeesUsdt);
  const otherActualFees = cost(input.otherActualFeesUsdt);
  const internalAdvantage = amount(
    input.signedInternalFundingAdvantageUsdt,
  );
  const shadowCost = cost(input.shadowCostUsdt);
  const opportunityCost = cost(input.opportunityCostUsdt);
  const unrealizedRiskCost = cost(input.unrealizedRiskCostUsdt);
  const cashProfit = merchantFee
    .plus(dcc)
    .plus(realizedFx)
    .minus(channelFees)
    .minus(otherActualFees);
  const economicProfit = cashProfit
    .plus(internalAdvantage)
    .minus(shadowCost)
    .minus(opportunityCost)
    .minus(unrealizedRiskCost);

  return {
    merchantPrincipalUsdt: principal.toFixed(12),
    merchantFeeRevenueUsdt: merchantFee.toFixed(12),
    signedDccRevenueUsdt: dcc.toFixed(12),
    realizedFxProfitUsdt: realizedFx.toFixed(12),
    channelFeesUsdt: channelFees.toFixed(12),
    otherActualFeesUsdt: otherActualFees.toFixed(12),
    cashProfitUsdt: cashProfit.toFixed(12),
    cashProfitMargin:
      principal.gt(0)
        ? cashProfit.div(principal).toFixed(12)
        : "0.000000000000",
    signedInternalFundingAdvantageUsdt:
      internalAdvantage.toFixed(12),
    shadowCostUsdt: shadowCost.toFixed(12),
    opportunityCostUsdt: opportunityCost.toFixed(12),
    unrealizedRiskCostUsdt: unrealizedRiskCost.toFixed(12),
    economicProfitUsdt: economicProfit.toFixed(12),
    economicProfitMargin:
      principal.gt(0)
        ? economicProfit.div(principal).toFixed(12)
        : "0.000000000000",
    dataStatus: input.dataStatus ?? "COMPLETE",
    formulas: {
      cash:
        "MERCHANT_FEE + SIGNED_DCC + REALIZED_FX - CHANNEL_FEES - OTHER_ACTUAL_FEES",
      economic:
        "CASH_PROFIT + SIGNED_INTERNAL_FUNDING_ADVANTAGE - SHADOW_COST - OPPORTUNITY_COST - UNREALIZED_RISK_COST",
    },
  };
}
