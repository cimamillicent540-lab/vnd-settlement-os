import Decimal from "decimal.js";

import { calculateDualProfitMetrics } from "./profit-metrics";

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export const SETTLEMENT_INTELLIGENCE_RULES = Object.freeze({
  minimumMargin: "0.002",
  targetMargin: "0.005",
  highVolatilityThreshold: "0.01",
  riskSpreadThreshold: "-0.002",
  buyOpportunityThreshold: "0.005",
  peakWindowStartHour: 16,
  peakWindowEndHour: 23,
  settleableRatio: "0.50",
  liquiditySafetyBuffer: "0.10",
  payoutConcentrationThreshold: "0.20",
});

export interface VndInventoryBatch {
  id: string;
  batchDate: string;
  batchTime?: string | null;
  usdtAmount: string;
  vndAmount: string;
  costRate: string;
  source: string;
  remainingAmount: string;
}

export interface FifoInventoryAllocation {
  inventoryBatchId: string;
  inventoryBatchSource: string;
  batchDate: string;
  costRate: string;
  vndConsumed: string;
  costBasisUsdt: string;
  remainingAfterVnd: string;
}

function nonNegative(value: string | number, label: string) {
  const decimal = new Decimal(value);
  if (!decimal.isFinite() || decimal.isNegative()) {
    throw new Error(`${label} must be a non-negative number`);
  }
  return decimal;
}

function positive(value: string | number, label: string) {
  const decimal = new Decimal(value);
  if (!decimal.isFinite() || decimal.lte(0)) {
    throw new Error(`${label} must be greater than zero`);
  }
  return decimal;
}

export function allocateFifoInventory(
  batches: VndInventoryBatch[],
  requestedVnd: string,
) {
  const requested = nonNegative(requestedVnd, "Requested VND");
  let remainingRequest = requested;
  let totalCost = new Decimal(0);
  const allocations: FifoInventoryAllocation[] = [];
  const ordered = [...batches]
    .filter((batch) => new Decimal(batch.remainingAmount).gt(0))
    .sort((left, right) => {
      const dateOrder = left.batchDate.localeCompare(right.batchDate);
      if (dateOrder !== 0) return dateOrder;
      const timeOrder = (left.batchTime ?? "").localeCompare(
        right.batchTime ?? "",
      );
      return timeOrder !== 0 ? timeOrder : left.id.localeCompare(right.id);
    });

  for (const batch of ordered) {
    if (remainingRequest.eq(0)) break;
    const available = nonNegative(
      batch.remainingAmount,
      "Batch remaining VND",
    );
    const rate = positive(batch.costRate, "Batch cost rate");
    const consumed = Decimal.min(available, remainingRequest);
    const cost = consumed.div(rate);
    allocations.push({
      inventoryBatchId: batch.id,
      inventoryBatchSource: batch.source,
      batchDate: batch.batchDate,
      costRate: rate.toFixed(12),
      vndConsumed: consumed.toFixed(2),
      costBasisUsdt: cost.toFixed(8),
      remainingAfterVnd: available.minus(consumed).toFixed(2),
    });
    totalCost = totalCost.plus(cost);
    remainingRequest = remainingRequest.minus(consumed);
  }

  const fulfilled = requested.minus(remainingRequest);
  return {
    method: "FIFO_ACTUAL_TOPUP_V1" as const,
    requestedVnd: requested.toFixed(2),
    fulfilledVnd: fulfilled.toFixed(2),
    shortageVnd: remainingRequest.toFixed(2),
    costBasisUsdt: totalCost.toFixed(8),
    weightedCostRate:
      totalCost.gt(0) ? fulfilled.div(totalCost).toFixed(12) : null,
    inventoryBatchSource: allocations.map(
      (allocation) => allocation.inventoryBatchSource,
    ),
    allocations,
    isFullyCovered: remainingRequest.eq(0),
  };
}

export function calculateFxIntelligence(input: {
  xeRate: string;
  p2pCostRate: string;
  recentP2pRates?: string[];
}) {
  const xe = positive(input.xeRate, "XE rate");
  const p2p = positive(input.p2pCostRate, "P2P cost rate");
  const spread = p2p.minus(xe);
  const spreadRatio = spread.div(xe);
  const recentRates = (input.recentP2pRates ?? [])
    .map((rate) => positive(rate, "Recent P2P rate"))
    .concat(p2p);
  const average = recentRates
    .reduce((sum, rate) => sum.plus(rate), new Decimal(0))
    .div(recentRates.length);
  const volatility = Decimal.max(...recentRates)
    .minus(Decimal.min(...recentRates))
    .div(average);

  const opportunity = spreadRatio.gte(
    SETTLEMENT_INTELLIGENCE_RULES.buyOpportunityThreshold,
  )
    ? "BUY_VND_OPPORTUNITY"
    : spreadRatio.lte(
          SETTLEMENT_INTELLIGENCE_RULES.riskSpreadThreshold,
        )
      ? "RISK"
      : "NORMAL";

  return {
    xeRate: xe.toFixed(12),
    p2pCostRate: p2p.toFixed(12),
    spreadVndPerUsdt: spread.toFixed(12),
    spreadRatio: spreadRatio.toFixed(12),
    volatility: volatility.toFixed(12),
    opportunity,
  };
}

export interface HourlyLiquidityRow {
  localHour: number;
  forecastPayinVnd: string;
  forecastPayoutVnd: string;
  payoutConcentrationRatio?: string;
}

export function summarizePeakWindow(rows: HourlyLiquidityRow[]) {
  const peakRows = rows.filter(
    (row) =>
      row.localHour >=
        SETTLEMENT_INTELLIGENCE_RULES.peakWindowStartHour &&
      row.localHour <=
        SETTLEMENT_INTELLIGENCE_RULES.peakWindowEndHour,
  );
  const payin = peakRows.reduce(
    (sum, row) => sum.plus(row.forecastPayinVnd),
    new Decimal(0),
  );
  const payout = peakRows.reduce(
    (sum, row) => sum.plus(row.forecastPayoutVnd),
    new Decimal(0),
  );
  const maximumConcentration = rows.reduce(
    (maximum, row) =>
      Decimal.max(maximum, row.payoutConcentrationRatio ?? 0),
    new Decimal(0),
  );
  return {
    window: "16:00-23:00" as const,
    forecastPayinVnd: payin.toFixed(2),
    forecastPayoutVnd: payout.toFixed(2),
    forecastNetDemandVnd: Decimal.max(
      payout.minus(payin),
      0,
    ).toFixed(2),
    maximumHourlyPayoutConcentration:
      maximumConcentration.toFixed(12),
  };
}

export function recommendTopup(input: {
  currentSettleableBalanceVnd: string;
  forecastPayoutVnd: string;
  expectedPayinVnd: string;
  p2pCostRate?: string | null;
  settleableRatio?: string;
  safetyBufferRate?: string;
}) {
  const balance = nonNegative(
    input.currentSettleableBalanceVnd,
    "Settleable balance",
  );
  const payout = nonNegative(input.forecastPayoutVnd, "Forecast payout");
  const payin = nonNegative(input.expectedPayinVnd, "Expected payin");
  const ratio = positive(
    input.settleableRatio ??
      SETTLEMENT_INTELLIGENCE_RULES.settleableRatio,
    "Settleable ratio",
  );
  if (ratio.gt(1)) throw new Error("Settleable ratio cannot exceed one");
  const buffer = nonNegative(
    input.safetyBufferRate ??
      SETTLEMENT_INTELLIGENCE_RULES.liquiditySafetyBuffer,
    "Safety buffer",
  );
  const forecastNetDemand = Decimal.max(payout.minus(payin), 0);
  const requiredSettleable = forecastNetDemand.mul(
    new Decimal(1).plus(buffer),
  );
  const shortfall = Decimal.max(requiredSettleable.minus(balance), 0);
  const requiredGrossTopupVnd = shortfall.div(ratio);
  const hasRate = Boolean(input.p2pCostRate);
  const recommendedTopupUsdt = hasRate
    ? requiredGrossTopupVnd.div(
        positive(input.p2pCostRate!, "P2P cost rate"),
      )
    : null;
  const topupRequired = shortfall.gt(0);

  return {
    recommendationStatus: !topupRequired
      ? ("NO_TOPUP" as const)
      : recommendedTopupUsdt
        ? ("TOPUP_RECOMMENDED" as const)
        : ("INSUFFICIENT_MARKET_DATA" as const),
    topupRequired,
    forecastNetDemandVnd: forecastNetDemand.toFixed(2),
    safetyBufferVnd: requiredSettleable
      .minus(forecastNetDemand)
      .toFixed(2),
    requiredSettleableVnd: requiredSettleable.toFixed(2),
    projectedShortfallVnd: shortfall.toFixed(2),
    requiredGrossTopupVnd: requiredGrossTopupVnd.toFixed(2),
    recommendedTopupUsdt: recommendedTopupUsdt?.toFixed(8) ?? null,
    automaticTopup: false as const,
    reasons: topupRequired
      ? [
          "16:00-23:00预计净Payout需求及安全缓冲超过当前Settleable余额",
          hasRate
            ? "建议USDT数量按当前人工P2P成本价和50%可结算比例换算"
            : "缺少当前人工P2P成本价，暂时只能给出VND缺口",
        ]
      : ["当前Settleable余额足以覆盖预测净需求和安全缓冲"],
  };
}

export function recommendTargetMargin(input: {
  projectedShortfallVnd: string;
  fxVolatility?: string | null;
  competitionAdjustment?: string | null;
}) {
  const minimum = new Decimal(
    SETTLEMENT_INTELLIGENCE_RULES.minimumMargin,
  );
  let target = new Decimal(
    SETTLEMENT_INTELLIGENCE_RULES.targetMargin,
  );
  const reasons = ["基础目标利润率0.5%"];
  if (new Decimal(input.projectedShortfallVnd).gt(0)) {
    target = target.plus("0.002");
    reasons.push("资金压力提高目标利润率0.2%");
  }
  if (
    input.fxVolatility &&
    new Decimal(input.fxVolatility).gte(
      SETTLEMENT_INTELLIGENCE_RULES.highVolatilityThreshold,
    )
  ) {
    target = target.plus("0.002");
    reasons.push("高汇率波动提高目标利润率0.2%");
  }
  if (input.competitionAdjustment) {
    target = target.plus(input.competitionAdjustment);
    reasons.push("纳入人工市场竞争调整");
  }
  target = Decimal.max(target, minimum);
  return {
    minimumMargin: minimum.toFixed(12),
    targetMargin: target.toFixed(12),
    reasons,
  };
}

export function recommendCustomerQuote(input: {
  xeRate: string;
  companyAdjustment: string;
  p2pCostRate?: string | null;
  targetMargin: string;
}) {
  const xe = positive(input.xeRate, "XE rate");
  const adjustedQuote = xe.plus(input.companyAdjustment);
  if (adjustedQuote.lte(0)) {
    throw new Error("XE rate plus company adjustment must be positive");
  }
  if (!input.p2pCostRate) {
    return {
      formula: "XE_RATE_PLUS_COMPANY_ADJUSTMENT" as const,
      xeRate: xe.toFixed(12),
      companyAdjustment: new Decimal(
        input.companyAdjustment,
      ).toFixed(12),
      adjustedQuoteRate: adjustedQuote.toFixed(12),
      targetProtectedQuoteRate: null,
      recommendedQuoteRate: adjustedQuote.toFixed(12),
      expectedQuoteMargin: null,
      automaticQuoteChange: false as const,
      confidence: "MISSING_P2P_COST_RATE" as const,
    };
  }
  const p2p = positive(input.p2pCostRate, "P2P cost rate");
  const target = nonNegative(input.targetMargin, "Target margin");
  const targetProtectedRate = p2p.div(new Decimal(1).plus(target));
  const recommended = Decimal.min(adjustedQuote, targetProtectedRate);
  return {
    formula: "XE_RATE_PLUS_COMPANY_ADJUSTMENT" as const,
    xeRate: xe.toFixed(12),
    companyAdjustment: new Decimal(
      input.companyAdjustment,
    ).toFixed(12),
    adjustedQuoteRate: adjustedQuote.toFixed(12),
    targetProtectedQuoteRate: targetProtectedRate.toFixed(12),
    recommendedQuoteRate: recommended.toFixed(12),
    expectedQuoteMargin: p2p.div(recommended).minus(1).toFixed(12),
    automaticQuoteChange: false as const,
    confidence: "SHADOW_RECOMMENDATION" as const,
  };
}

export function forecastProfit(input: {
  forecastPayoutVnd: string;
  customerQuoteRate: string;
  fifoCostBasisUsdt: string;
  merchantFeeRate: string;
  dccRevenueRate: string;
}) {
  const payout = nonNegative(input.forecastPayoutVnd, "Forecast payout");
  const quote = positive(input.customerQuoteRate, "Customer quote rate");
  const inventoryCost = nonNegative(
    input.fifoCostBasisUsdt,
    "FIFO inventory cost",
  );
  const principal = payout.div(quote);
  const quoteRevenue = principal.minus(inventoryCost);
  const merchantFee = principal.mul(input.merchantFeeRate);
  const dcc = principal.mul(input.dccRevenueRate);
  const total = quoteRevenue.plus(merchantFee).plus(dcc);
  const dualProfit = calculateDualProfitMetrics({
    merchantPrincipalUsdt: principal.toString(),
    merchantFeeRevenueUsdt: merchantFee.toString(),
    signedDccRevenueUsdt: dcc.toString(),
    realizedFxProfitUsdt: 0,
    channelFeesUsdt: 0,
    otherActualFeesUsdt: 0,
    signedInternalFundingAdvantageUsdt: quoteRevenue.toString(),
    shadowCostUsdt: 0,
    opportunityCostUsdt: 0,
    unrealizedRiskCostUsdt: 0,
    dataStatus: "FORECAST_PARTIAL_ACTUAL_FEES_NOT_AVAILABLE",
  });
  return {
    merchantPrincipalUsdt: principal.toFixed(12),
    quoteRevenueUsdt: quoteRevenue.toFixed(12),
    inventoryCostUsdt: inventoryCost.toFixed(12),
    merchantFeeRevenueUsdt: merchantFee.toFixed(12),
    dccRevenueUsdt: dcc.toFixed(12),
    cashProfitUsdt: dualProfit.cashProfitUsdt,
    cashProfitMargin: dualProfit.cashProfitMargin,
    economicProfitUsdt: dualProfit.economicProfitUsdt,
    economicProfitMargin: dualProfit.economicProfitMargin,
    profitMetricsSnapshot: dualProfit,
    expectedProfitUsdt: total.toFixed(12),
    expectedProfitMargin:
      principal.gt(0) ? total.div(principal).toFixed(12) : "0.000000000000",
  };
}

export interface SettlementRiskAlert {
  code: string;
  severity: "INFO" | "WARNING" | "HIGH";
  message: string;
}

export function buildSettlementRiskAlerts(input: {
  projectedShortfallVnd: string;
  expectedProfitMargin?: string | null;
  fxVolatility?: string | null;
  maximumHourlyPayoutConcentration: string;
  hasXeRate: boolean;
  hasP2pCostRate: boolean;
}) {
  const alerts: SettlementRiskAlert[] = [];
  if (new Decimal(input.projectedShortfallVnd).gt(0)) {
    alerts.push({
      code: "SETTLEABLE_SHORTFALL",
      severity: "HIGH",
      message: "Settleable余额不足以覆盖预测需求和安全缓冲。",
    });
  }
  if (
    input.expectedProfitMargin &&
    new Decimal(input.expectedProfitMargin).lt(
      SETTLEMENT_INTELLIGENCE_RULES.minimumMargin,
    )
  ) {
    alerts.push({
      code: "PROFIT_BELOW_0_2_PERCENT",
      severity: "HIGH",
      message: "预计利润率低于最低保护线0.2%。",
    });
  }
  if (
    input.fxVolatility &&
    new Decimal(input.fxVolatility).gte(
      SETTLEMENT_INTELLIGENCE_RULES.highVolatilityThreshold,
    )
  ) {
    alerts.push({
      code: "HIGH_FX_VOLATILITY",
      severity: "WARNING",
      message: "人工P2P成本价观察值波动达到高风险阈值。",
    });
  }
  if (
    new Decimal(input.maximumHourlyPayoutConcentration).gte(
      SETTLEMENT_INTELLIGENCE_RULES.payoutConcentrationThreshold,
    )
  ) {
    alerts.push({
      code: "PAYOUT_CONCENTRATION",
      severity: "WARNING",
      message: "单小时Payout占比较高，需要关注集中流动性风险。",
    });
  }
  if (!input.hasXeRate || !input.hasP2pCostRate) {
    alerts.push({
      code: "MISSING_MANUAL_FX_INPUT",
      severity: "WARNING",
      message: "XE或P2P人工市场输入缺失，报价和补U建议置信度受限。",
    });
  }
  if (!alerts.length) {
    alerts.push({
      code: "NO_ACTIVE_RISK",
      severity: "INFO",
      message: "当前未触发结算智能风险阈值。",
    });
  }
  return alerts;
}

export const SHADOW_MODE_GUARD = Object.freeze({
  automaticPayment: false,
  automaticTopup: false,
  automaticQuoteChange: false,
  automaticTrading: false,
});
