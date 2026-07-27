import Decimal from "decimal.js";

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export const CONTROL_CENTER_RULES = Object.freeze({
  minimumMargin: "0.002",
  targetMargin: "0.005",
  settleableRatio: "0.50",
  safetyBuffer: "0.10",
  inventoryLimitRate: "26500",
  maximumInventoryUsdt: "50000",
  maximumInventoryVnd: "1325000000",
  peakStartHour: 16,
  peakEndHour: 23,
  rulesVersion: "SETTLEMENT_CONTROL_CENTER_V1",
});

export const CONTROL_CENTER_SHADOW_GUARD = Object.freeze({
  automaticPayment: false,
  automaticTopup: false,
  automaticQuoteChange: false,
  automaticMarketDataCollection: false,
  automaticTrading: false,
});

export interface ExecutionGuardSummaryRow {
  checkStatus: string;
  riskLevel: string;
  orderCount: number;
  payoutPrincipalVnd: string | number;
  requiredGrossDebitVnd: string | number;
}

export function summarizeExecutionGuard(
  rows: ExecutionGuardSummaryRow[],
) {
  const summary = rows.reduce(
    (result, row) => {
      const count = Number(row.orderCount);
      result.totalCount += count;
      result.totalPayoutPrincipalVnd = result.totalPayoutPrincipalVnd.plus(
        row.payoutPrincipalVnd,
      );
      result.totalRequiredGrossDebitVnd =
        result.totalRequiredGrossDebitVnd.plus(
          row.requiredGrossDebitVnd,
        );
      if (row.checkStatus === "READY") result.readyCount += count;
      if (row.checkStatus === "BLOCKED") result.blockedCount += count;
      if (
        row.checkStatus !== "READY" &&
        row.checkStatus !== "BLOCKED"
      ) {
        result.warningCount += count;
      }
      return result;
    },
    {
      totalCount: 0,
      readyCount: 0,
      blockedCount: 0,
      warningCount: 0,
      totalPayoutPrincipalVnd: new Decimal(0),
      totalRequiredGrossDebitVnd: new Decimal(0),
    },
  );
  const status =
    summary.blockedCount > 0
      ? ("CRITICAL" as const)
      : summary.warningCount > 0
        ? ("WARNING" as const)
        : ("NORMAL" as const);

  return {
    status,
    totalCount: summary.totalCount,
    readyCount: summary.readyCount,
    blockedCount: summary.blockedCount,
    warningCount: summary.warningCount,
    totalPayoutPrincipalVnd:
      summary.totalPayoutPrincipalVnd.toFixed(2),
    totalRequiredGrossDebitVnd:
      summary.totalRequiredGrossDebitVnd.toFixed(2),
    rows,
    shadowMode: true as const,
    automaticPayment: false as const,
  };
}

export interface ControlHourlyRow {
  localHour: number;
  forecastPayinVnd: string;
  forecastPayoutVnd: string;
  payoutConcentrationRatio?: string;
}

export interface LearningAdjustmentInput {
  averageSystemTopupUsdt?: string | number | null;
  averageHumanTopupUsdt?: string | number | null;
  p2pCostRate?: string | number | null;
}

export function calculateDailyPressure(
  rows: ControlHourlyRow[],
  learning: LearningAdjustmentInput = {},
) {
  const payout = rows.reduce(
    (sum, row) => sum.plus(row.forecastPayoutVnd),
    new Decimal(0),
  );
  const payin = rows.reduce(
    (sum, row) => sum.plus(row.forecastPayinVnd),
    new Decimal(0),
  );
  const peakRows = rows.filter(
    (row) =>
      row.localHour >= CONTROL_CENTER_RULES.peakStartHour &&
      row.localHour <= CONTROL_CENTER_RULES.peakEndHour,
  );
  const peakPayout = peakRows.reduce(
    (sum, row) => sum.plus(row.forecastPayoutVnd),
    new Decimal(0),
  );
  const peakPayin = peakRows.reduce(
    (sum, row) => sum.plus(row.forecastPayinVnd),
    new Decimal(0),
  );
  const systemTopup = new Decimal(
    learning.averageSystemTopupUsdt ?? 0,
  );
  const humanTopup = new Decimal(
    learning.averageHumanTopupUsdt ?? 0,
  );
  const p2pRate = new Decimal(learning.p2pCostRate ?? 0);
  const learningAdjustment =
    p2pRate.gt(0) && humanTopup.gt(systemTopup)
      ? humanTopup
          .minus(systemTopup)
          .mul(p2pRate)
          .mul(CONTROL_CENTER_RULES.settleableRatio)
      : new Decimal(0);
  const historicalNetDemand = Decimal.max(payout.minus(payin), 0);
  const peakHistoricalPressure = Decimal.max(
    peakPayout.minus(peakPayin),
    0,
  );

  return {
    forecastPayoutVnd: payout.toFixed(2),
    forecastPayinVnd: payin.toFixed(2),
    historicalNetDemandVnd: historicalNetDemand.toFixed(2),
    learningAdjustmentVnd: learningAdjustment.toFixed(2),
    forecastNetDemandVnd: historicalNetDemand
      .plus(learningAdjustment)
      .toFixed(2),
    peakPayoutVnd: peakPayout.toFixed(2),
    peakPayinVnd: peakPayin.toFixed(2),
    peakPressureVnd: peakHistoricalPressure
      .plus(learningAdjustment)
      .toFixed(2),
    maximumHourlyPayoutConcentration: rows
      .reduce(
        (maximum, row) =>
          Decimal.max(
            maximum,
            row.payoutConcentrationRatio ?? 0,
          ),
        new Decimal(0),
      )
      .toFixed(12),
    learningApplied: learningAdjustment.gt(0),
  };
}

export function classifyFundsStatus(input: {
  grossBalanceVnd: string | number;
  settleableBalanceVnd: string | number;
  forecastNetDemandVnd: string | number;
  peakPressureVnd: string | number;
}) {
  const gross = new Decimal(input.grossBalanceVnd);
  const settleable = new Decimal(input.settleableBalanceVnd);
  const required = Decimal.max(
    input.forecastNetDemandVnd,
    input.peakPressureVnd,
  ).mul(new Decimal(1).plus(CONTROL_CENTER_RULES.safetyBuffer));
  const availableRatio = gross.gt(0)
    ? settleable.div(gross)
    : new Decimal(0);
  const coverageRatio = required.gt(0)
    ? settleable.div(required)
    : new Decimal(999);
  const status =
    settleable.lt(required) || availableRatio.lt("0.20")
      ? ("CRITICAL" as const)
      : coverageRatio.lt("1.25") || availableRatio.lt("0.35")
        ? ("WARNING" as const)
        : ("NORMAL" as const);

  return {
    status,
    availableFundsRatio: availableRatio.toFixed(12),
    requiredSettleableVnd: required.toFixed(2),
    coverageRatio: coverageRatio.toFixed(12),
  };
}

export function buildTopupControl(input: {
  settleableBalanceVnd: string | number;
  forecastNetDemandVnd: string | number;
  peakPressureVnd: string | number;
  currentInventoryVnd: string | number;
  p2pCostRate?: string | number | null;
  fxOpportunityStatus:
    | "BUY_VND_OPPORTUNITY"
    | "NORMAL"
    | "RISK"
    | "WAITING_INPUT";
  weightedInventoryRate?: string | number | null;
  fundsRiskStatus: "NORMAL" | "WARNING" | "CRITICAL";
}) {
  const settleable = new Decimal(input.settleableBalanceVnd);
  const requiredSettleable = Decimal.max(
    input.forecastNetDemandVnd,
    input.peakPressureVnd,
  ).mul(new Decimal(1).plus(CONTROL_CENTER_RULES.safetyBuffer));
  const settleableShortfall = Decimal.max(
    requiredSettleable.minus(settleable),
    0,
  );
  const grossTopupVnd = settleableShortfall.div(
    CONTROL_CENTER_RULES.settleableRatio,
  );
  const p2p = new Decimal(input.p2pCostRate ?? 0);
  const recommendedTopupUsdt = p2p.gt(0)
    ? grossTopupVnd.div(p2p)
    : null;
  const currentInventory = new Decimal(input.currentInventoryVnd);
  const projectedInventory = currentInventory.plus(grossTopupVnd);
  const maximumInventory = new Decimal(
    CONTROL_CENTER_RULES.maximumInventoryVnd,
  );
  const manualConfirmationRequired =
    projectedInventory.gt(maximumInventory);
  const weightedInventoryRate = new Decimal(
    input.weightedInventoryRate ?? 0,
  );
  const costReductionOpportunity =
    p2p.gt(0) &&
    weightedInventoryRate.gt(0) &&
    p2p.gt(weightedInventoryRate);
  const objectives = ["BALANCED"];
  const reasons: string[] = [];

  if (settleableShortfall.gt(0)) {
    objectives.push("GUARANTEE_LIQUIDITY");
    reasons.push(
      "当前Settleable余额不足以覆盖日内净需求、晚间压力和10%安全缓冲",
    );
  } else {
    reasons.push(
      "当前Settleable余额可覆盖日内净需求、晚间压力和安全缓冲",
    );
  }
  if (input.fxOpportunityStatus === "BUY_VND_OPPORTUNITY") {
    objectives.push("FX_OPPORTUNITY");
    reasons.push("人工P2P输入显示买入VND机会，需人工确认市场报价");
  }
  if (costReductionOpportunity) {
    objectives.push("COST_REDUCTION");
    reasons.push("当前人工P2P成本优于现有FIFO库存加权成本");
  }
  if (manualConfirmationRequired) {
    reasons.push(
      "补U后库存将高于1,325,000,000 VND基础限制，必须人工确认",
    );
  }
  if (!p2p.gt(0) && settleableShortfall.gt(0)) {
    reasons.push("缺少人工P2P价格，暂不能换算建议USDT金额");
  }

  const recommendedTime = settleableShortfall.eq(0)
    ? ("NO_TOPUP" as const)
    : input.fundsRiskStatus === "CRITICAL"
      ? ("IMMEDIATE_MANUAL_REVIEW" as const)
      : input.fxOpportunityStatus === "BUY_VND_OPPORTUNITY"
        ? ("WHEN_OPERATOR_CONFIRMS_P2P_QUOTE" as const)
        : ("BEFORE_16_00" as const);

  return {
    topupRecommended: settleableShortfall.gt(0),
    requiredSettleableVnd: requiredSettleable.toFixed(2),
    settleableShortfallVnd: settleableShortfall.toFixed(2),
    requiredGrossTopupVnd: grossTopupVnd.toFixed(2),
    recommendedTopupUsdt:
      recommendedTopupUsdt?.toFixed(8) ?? null,
    recommendedTime,
    reasons,
    objectives: [...new Set(objectives)],
    currentInventoryVnd: currentInventory.toFixed(2),
    projectedInventoryVnd: projectedInventory.toFixed(2),
    maximumInventoryVnd:
      CONTROL_CENTER_RULES.maximumInventoryVnd,
    inventoryLimitStatus: manualConfirmationRequired
      ? ("MANUAL_CONFIRMATION_REQUIRED" as const)
      : ("WITHIN_LIMIT" as const),
    manualConfirmationRequired,
    automaticTopup: false as const,
  };
}

export interface MerchantBaseline {
  merchantName: string;
  transactionVolumeUsdt: string;
  contributionUsdt: string;
  currentQuoteRate: string | null;
  currentProfitMargin: string | null;
  payoutCount: number;
  channelCount: number;
}

export function recommendMerchantQuotes(input: {
  merchants: MerchantBaseline[];
  globalRecommendedQuoteRate?: string | number | null;
  p2pCostRate?: string | number | null;
  targetMargin: string | number;
}) {
  const totalVolume = input.merchants.reduce(
    (sum, merchant) => sum.plus(merchant.transactionVolumeUsdt),
    new Decimal(0),
  );
  const totalContribution = input.merchants.reduce(
    (sum, merchant) => sum.plus(merchant.contributionUsdt),
    new Decimal(0),
  );
  const globalQuote = new Decimal(
    input.globalRecommendedQuoteRate ?? 0,
  );
  const p2p = new Decimal(input.p2pCostRate ?? 0);
  const baseTarget = Decimal.max(
    input.targetMargin,
    CONTROL_CENTER_RULES.targetMargin,
  );

  return input.merchants.map((merchant) => {
    const volume = new Decimal(merchant.transactionVolumeUsdt);
    const contribution = new Decimal(merchant.contributionUsdt);
    const volumeShare = totalVolume.gt(0)
      ? volume.div(totalVolume)
      : new Decimal(0);
    const contributionShare = totalContribution.gt(0)
      ? contribution.div(totalContribution)
      : new Decimal(0);
    const profitMargin =
      merchant.currentProfitMargin === null
        ? null
        : new Decimal(merchant.currentProfitMargin);
    const volumeLevel = volumeShare.gte("0.20")
      ? ("HIGH" as const)
      : volumeShare.gte("0.05")
        ? ("MEDIUM" as const)
        : ("LOW" as const);
    const riskLevel =
      profitMargin === null ||
      profitMargin.lt(CONTROL_CENTER_RULES.minimumMargin)
        ? ("CRITICAL" as const)
        : profitMargin.lt(CONTROL_CENTER_RULES.targetMargin)
          ? ("WARNING" as const)
          : ("NORMAL" as const);
    const merchantTarget =
      riskLevel === "CRITICAL"
        ? baseTarget.plus("0.001")
        : baseTarget;
    const protectedQuote = p2p.gt(0)
      ? p2p.div(new Decimal(1).plus(merchantTarget))
      : null;
    const recommendedQuote =
      protectedQuote && globalQuote.gt(0)
        ? Decimal.min(protectedQuote, globalQuote)
        : protectedQuote ?? (globalQuote.gt(0) ? globalQuote : null);

    return {
      merchantName: merchant.merchantName,
      currentQuoteRate: merchant.currentQuoteRate,
      systemRecommendedQuoteRate:
        recommendedQuote?.toFixed(12) ?? null,
      currentProfitMargin:
        profitMargin?.toFixed(12) ?? null,
      targetProfitMargin: merchantTarget.toFixed(12),
      transactionVolumeUsdt: volume.toFixed(8),
      contributionUsdt: contribution.toFixed(12),
      volumeShare: volumeShare.toFixed(12),
      contributionShare: contributionShare.toFixed(12),
      volumeLevel,
      riskLevel,
      payoutCount: merchant.payoutCount,
      channelCount: merchant.channelCount,
      recommendationReason:
        riskLevel === "CRITICAL"
          ? "利润低于千2或利润数据缺失，建议提高保护目标并人工复核"
          : contributionShare.gte("0.20")
            ? "高贡献商户，维持千5目标并优先人工复核竞争性"
            : "按XE调整、人工P2P成本和千5目标线生成影子报价",
      automaticQuoteChange: false as const,
    };
  });
}

export interface ControlRiskAlert {
  code: string;
  severity: "INFO" | "WARNING" | "HIGH";
  message: string;
  source: string;
}

export function buildControlCenterRisks(input: {
  fundsRiskStatus: "NORMAL" | "WARNING" | "CRITICAL";
  maximumHourlyPayoutConcentration: string;
  merchantRecommendations: Array<{
    riskLevel: "NORMAL" | "WARNING" | "CRITICAL";
  }>;
  fxOpportunityStatus:
    | "BUY_VND_OPPORTUNITY"
    | "NORMAL"
    | "RISK"
    | "WAITING_INPUT";
  inventoryManualConfirmationRequired: boolean;
  executionGuardStatus?: "NORMAL" | "WARNING" | "CRITICAL";
  executionBlockedCount?: number;
  intelligenceRisks?: Array<{
    code: string;
    severity: "INFO" | "WARNING" | "HIGH";
    message: string;
  }>;
}) {
  const alerts = new Map<string, ControlRiskAlert>();
  for (const alert of input.intelligenceRisks ?? []) {
    alerts.set(alert.code, { ...alert, source: "SETTLEMENT_INTELLIGENCE" });
  }
  if (input.fundsRiskStatus !== "NORMAL") {
    alerts.set("SETTLEABLE_CAPACITY_RISK", {
      code: "SETTLEABLE_CAPACITY_RISK",
      severity:
        input.fundsRiskStatus === "CRITICAL" ? "HIGH" : "WARNING",
      message: "可结算余额覆盖能力需要人工关注",
      source: "CONTROL_CENTER",
    });
  }
  if (
    new Decimal(input.maximumHourlyPayoutConcentration).gte("0.20")
  ) {
    alerts.set("PAYOUT_CONCENTRATION", {
      code: "PAYOUT_CONCENTRATION",
      severity: "WARNING",
      message: "单小时Payout占比达到或超过20%",
      source: "CONTROL_CENTER",
    });
  }
  if (
    input.merchantRecommendations.some(
      (merchant) => merchant.riskLevel === "CRITICAL",
    )
  ) {
    alerts.set("MERCHANT_PROFIT_BELOW_0_2_PERCENT", {
      code: "MERCHANT_PROFIT_BELOW_0_2_PERCENT",
      severity: "HIGH",
      message: "至少一个商户利润低于千2保护线或缺少利润数据",
      source: "SHADOW_PRICING",
    });
  }
  if (
    input.fxOpportunityStatus === "RISK" ||
    input.fxOpportunityStatus === "WAITING_INPUT"
  ) {
    alerts.set("FX_INPUT_RISK", {
      code: "FX_INPUT_RISK",
      severity:
        input.fxOpportunityStatus === "RISK" ? "HIGH" : "WARNING",
      message:
        input.fxOpportunityStatus === "RISK"
          ? "XE与人工P2P输入显示汇率风险"
          : "缺少XE或人工P2P输入，汇率机会判断不完整",
      source: "FX_INTELLIGENCE",
    });
  }
  if (input.inventoryManualConfirmationRequired) {
    alerts.set("INVENTORY_LIMIT_MANUAL_CONFIRMATION", {
      code: "INVENTORY_LIMIT_MANUAL_CONFIRMATION",
      severity: "WARNING",
      message: "预计库存高于5万USDT对应VND基础限制，必须人工确认",
      source: "TOPUP_CONTROL",
    });
  }
  if (
    input.executionGuardStatus === "CRITICAL" ||
    input.executionGuardStatus === "WARNING"
  ) {
    alerts.set("PAYOUT_EXECUTION_GUARD", {
      code: "PAYOUT_EXECUTION_GUARD",
      severity:
        input.executionGuardStatus === "CRITICAL"
          ? "HIGH"
          : "WARNING",
      message:
        input.executionGuardStatus === "CRITICAL"
          ? `${input.executionBlockedCount ?? 0}笔Payout被Execution Guard阻断，只能人工复核`
          : "Payout Execution Guard存在待人工复核项目",
      source: "PAYOUT_EXECUTION_GUARD",
    });
  }
  alerts.set("INTERNATIONAL_MARKET_RISK", {
    code: "INTERNATIONAL_MARKET_RISK",
    severity: "INFO",
    message: "国际市场风险需由人工确认、忽略或补充备注",
    source: "HUMAN_REVIEW",
  });
  return [...alerts.values()];
}

export interface ControlSnapshotInput {
  clientRequestId: string;
  createdBy: string;
  sourceLearningRecommendationId: string | null;
  balances: {
    grossBalanceVnd: string | number;
    settleableBalanceVnd: string | number;
    reserveBalanceVnd: string | number;
  };
  funds: ReturnType<typeof classifyFundsStatus>;
  pressure: ReturnType<typeof calculateDailyPressure>;
  topup: ReturnType<typeof buildTopupControl>;
  fx: {
    xeRate: string | null;
    p2pCostRate: string | null;
    companyQuoteRate: string | null;
    spreadVndPerUsdt: string | null;
    opportunityStatus:
      | "BUY_VND_OPPORTUNITY"
      | "NORMAL"
      | "RISK"
      | "WAITING_INPUT";
  };
  merchants: ReturnType<typeof recommendMerchantQuotes>;
  executionGuard: ReturnType<typeof summarizeExecutionGuard>;
  risks: ControlRiskAlert[];
  learning90dSnapshot: Record<string, unknown>;
  dataCutoffSnapshot: Record<string, unknown>;
}

export function controlCenterSnapshotDate(
  at: Date = new Date(),
) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

export function buildControlCenterSnapshotRecord(
  input: ControlSnapshotInput,
) {
  return {
    client_request_id: input.clientRequestId,
    snapshot_date: controlCenterSnapshotDate(),
    currency: "VND",
    source_learning_recommendation_id:
      input.sourceLearningRecommendationId,
    gross_balance_vnd: String(input.balances.grossBalanceVnd),
    settleable_balance_vnd: String(
      input.balances.settleableBalanceVnd,
    ),
    reserve_balance_vnd: String(input.balances.reserveBalanceVnd),
    available_funds_ratio: input.funds.availableFundsRatio,
    funds_risk_status: input.funds.status,
    forecast_payout_vnd: input.pressure.forecastPayoutVnd,
    forecast_payin_vnd: input.pressure.forecastPayinVnd,
    forecast_net_demand_vnd:
      input.pressure.forecastNetDemandVnd,
    peak_pressure_vnd: input.pressure.peakPressureVnd,
    learning_adjustment_vnd:
      input.pressure.learningAdjustmentVnd,
    topup_recommended: input.topup.topupRecommended,
    recommended_topup_usdt: input.topup.recommendedTopupUsdt,
    recommended_topup_time: input.topup.recommendedTime,
    topup_reasons: input.topup.reasons,
    topup_objectives: input.topup.objectives,
    inventory_vnd: input.topup.currentInventoryVnd,
    inventory_limit_rate: CONTROL_CENTER_RULES.inventoryLimitRate,
    maximum_inventory_usdt:
      CONTROL_CENTER_RULES.maximumInventoryUsdt,
    maximum_inventory_vnd:
      CONTROL_CENTER_RULES.maximumInventoryVnd,
    projected_inventory_vnd: input.topup.projectedInventoryVnd,
    inventory_limit_status: input.topup.inventoryLimitStatus,
    manual_inventory_confirmation_required:
      input.topup.manualConfirmationRequired,
    xe_rate: input.fx.xeRate,
    p2p_cost_rate: input.fx.p2pCostRate,
    company_quote_rate: input.fx.companyQuoteRate,
    fx_spread_vnd_per_usdt: input.fx.spreadVndPerUsdt,
    fx_opportunity_status: input.fx.opportunityStatus,
    merchant_quote_recommendations: input.merchants,
    execution_ready_count: input.executionGuard.readyCount,
    execution_blocked_count: input.executionGuard.blockedCount,
    execution_warning_count: input.executionGuard.warningCount,
    execution_guard_snapshot: input.executionGuard,
    risk_alerts: input.risks,
    learning_90d_snapshot: input.learning90dSnapshot,
    data_cutoff_snapshot: input.dataCutoffSnapshot,
    rules_version: CONTROL_CENTER_RULES.rulesVersion,
    shadow_mode: true,
    automatic_payment: false,
    automatic_topup: false,
    automatic_quote_change: false,
    automatic_market_data_collection: false,
    automatic_trading: false,
    created_by: input.createdBy,
  } as const;
}
