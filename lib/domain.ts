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
  sourceTimezone: "UTC+8",
  balanceRoundingToleranceVnd: "1",
  reserveRatio: "0.50",
  settleableRatio: "0.50",
  grossOpeningBalanceVnd: "3398228791.14",
  reserveOpeningBalanceVnd: "1699114395.57",
  settleableOpeningBalanceVnd: "1699114395.57",
  openingEffectiveAt: "2026-07-17T00:00:00Z",
});

export type OrderStatus = "SUCCESS" | "FAILED" | "TIMEOUT" | "CANCELLED" | "PENDING";
export type CostBasisStatus = "KNOWN" | "MISSING" | "ESTIMATED" | "NOT_APPLICABLE";

export const OPENING_BALANCE_CORRECTION=Object.freeze({
  superseded:{settleableOpeningBalanceVnd:"6796457582.28",status:"SUPERSEDED" as const,modelVersion:"LEGACY_MULTIPLIER"},
  approved:{grossOpeningBalanceVnd:RULES.grossOpeningBalanceVnd,reserveOpeningBalanceVnd:RULES.reserveOpeningBalanceVnd,settleableOpeningBalanceVnd:RULES.settleableOpeningBalanceVnd,status:"APPROVED" as const,modelVersion:"SETTLEABLE_RATIO_V1"},
});

export function calculatePayinEconomics(amountVnd: string, status: OrderStatus = "SUCCESS") {
  const amount = new Decimal(amountVnd);
  if (amount.decimalPlaces() > 2 || amount.isNegative()) throw new Error("VND amount must be non-negative with at most two decimals");
  const expectedFeeRevenue = amount.mul(RULES.payinFeeRate).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const upstreamFee = new Decimal(status === "SUCCESS" ? RULES.upstreamPayinSuccessFeeVnd : status === "FAILED" ? RULES.upstreamPayinFailureFeeVnd : "0");
  return {
    expectedFeeRevenueVnd: expectedFeeRevenue.toFixed(2),
    upstreamFeeAppliedVnd: upstreamFee.toFixed(2),
    netFeeContributionVnd: expectedFeeRevenue.minus(upstreamFee).toFixed(2),
  };
}

export function validateImportedFee(amountVnd: string, importedFeeVnd: string, toleranceVnd = "1") {
  const expected = new Decimal(calculatePayinEconomics(amountVnd).expectedFeeRevenueVnd);
  const difference = new Decimal(importedFeeVnd).minus(expected);
  return {
    expectedFeeRevenueVnd: expected.toFixed(2),
    differenceVnd: difference.toFixed(2),
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
  sourceType: "OPENING" | "PAYIN" | "PAYIN_INTERNAL_NETTING" | "TOPUP" | "ADJUSTMENT";
  settleableAvailableAmountVnd: string;
  grossAvailableAmountVnd?: string;
  fundingRateVndPerUsdt?: string | null;
  costBasisStatus: CostBasisStatus;
}

export interface PoolAllocation extends PoolBucketInput {
  settleableBalanceBeforeVnd: string;
  allocationRatio: string;
  allocatedVnd: string;
  settleableBalanceAfterVnd: string;
  allocatedCostUsdt: string | null;
}

export class InsufficientPoolBalanceError extends Error {
  constructor(public readonly availableVnd: string, public readonly requestedVnd: string) {
    super(`Insufficient VND pool balance: ${availableVnd} available, ${requestedVnd} requested`);
  }
}

export function allocatePayoutProportionally(buckets: PoolBucketInput[], payoutAmountVnd: string): PoolAllocation[] {
  const payout = new Decimal(payoutAmountVnd);
  if (payout.decimalPlaces() > 2 || payout.lte(0)) throw new Error("Payout VND must be positive with at most two decimals");
  const active = buckets.filter((bucket) => new Decimal(bucket.settleableAvailableAmountVnd).gt(0));
  const total = active.reduce((sum, bucket) => sum.plus(bucket.settleableAvailableAmountVnd), new Decimal(0));
  if (total.lt(payout)) throw new InsufficientPoolBalanceError(total.toFixed(2), payout.toFixed(2));

  let allocated = new Decimal(0);
  return active.map((bucket, index) => {
    const before = new Decimal(bucket.settleableAvailableAmountVnd);
    const ratio = before.div(total);
    const amount = index === active.length - 1
      ? payout.minus(allocated)
      : payout.mul(ratio).toDecimalPlaces(2, Decimal.ROUND_DOWN);
    if (amount.gt(before)) throw new InsufficientPoolBalanceError(total.toFixed(2), payout.toFixed(2));
    allocated = allocated.plus(amount);
    const rate = bucket.fundingRateVndPerUsdt ? new Decimal(bucket.fundingRateVndPerUsdt) : null;
    return {
      ...bucket,
      settleableBalanceBeforeVnd: before.toFixed(2),
      allocationRatio: ratio.toFixed(12),
      allocatedVnd: amount.toFixed(2),
      settleableBalanceAfterVnd: before.minus(amount).toFixed(2),
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
    totalVnd: totalVnd.toFixed(2),
    weightedAverageRate: totalVnd.div(totalUsdt).toDecimalPlaces(10, Decimal.ROUND_DOWN).toFixed(10),
  };
}

export function deriveBalanceLayers(grossBalanceVnd:string){
  const gross=new Decimal(grossBalanceVnd);
  if(gross.isNegative()||gross.decimalPlaces()>2)throw new Error("Gross VND balance must be non-negative with at most two decimals");
  return {
    grossBalanceVnd:gross.toFixed(2),
    reserveRatio:RULES.reserveRatio,
    reserveAmountVnd:gross.mul(RULES.reserveRatio).toFixed(2),
    settleableRatio:RULES.settleableRatio,
    settleableBalanceVnd:gross.mul(RULES.settleableRatio).toFixed(2),
  };
}

export function deriveSettleableChange(grossChangeVnd:string){
  return new Decimal(grossChangeVnd).mul(RULES.settleableRatio).toFixed(4);
}

export function canExecutePayout(settleableBalanceVnd:string,payoutRequiredVnd:string){
  return new Decimal(settleableBalanceVnd).gte(payoutRequiredVnd);
}

export function poolThresholdSnapshot(settleableBalanceVnd: string, rateVndPerUsdt: string) {
  const equivalent = new Decimal(settleableBalanceVnd).div(rateVndPerUsdt);
  return { balanceBasis:"SETTLEABLE" as const,equivalentUsdt: equivalent.toFixed(8), isLow: equivalent.lt(RULES.lowPoolThresholdUsdt) };
}

export function resolveTopupLedgerTreatment(accountHistoryMatched:boolean){
  return accountHistoryMatched
    ? {addGrossInflow:false,addSettleableInflow:false,treatment:"LINK_COST_ONLY" as const}
    : {addGrossInflow:true,addSettleableInflow:true,treatment:"ADD_GROSS_AND_SETTLEABLE_INFLOW" as const};
}

export const PAYIN_INTERNAL_NETTING = Object.freeze({
  sourceType: "PAYIN_INTERNAL_NETTING" as const,
  fundingMethod: "INTERNAL_NETTING" as const,
  externalUsdtSpent: "0.00000000",
  costBasisMethod: "INTERNAL_NETTING" as const,
  costBasisStatus: "NOT_APPLICABLE" as const,
});

export function calculatePayinPoolEntry(grossOrderAmountVnd:string, changeAmountVnd:string, status:OrderStatus="SUCCESS") {
  const economics=calculatePayinEconomics(grossOrderAmountVnd,status);
  const change=new Decimal(changeAmountVnd);
  if(change.isNegative()||change.decimalPlaces()>2)throw new Error("Payin change amount must be non-negative with at most two decimals");
  return {
    ...economics,
    companyPayinFeeRevenueVnd:economics.expectedFeeRevenueVnd,
    upstreamPayinFeeVnd:economics.upstreamFeeAppliedVnd,
    payinNetFeeContributionVnd:economics.netFeeContributionVnd,
    poolInflowVnd:status==="SUCCESS"?change.toFixed(2):null,
    settleablePoolInflowVnd:status==="SUCCESS"?deriveSettleableChange(change.toFixed(2)):null,
    ...PAYIN_INTERNAL_NETTING,
  };
}

export type AccountEventType="PAYIN_INFLOW"|"PAYOUT_OUTFLOW"|"INTERNAL_TRANSFER_DEBIT"|"INTERNAL_TRANSFER_CREDIT"|"MANUAL_ADJUSTMENT";
export interface AccountHistoryInput {
  sourceRowNumber:number; businessOrderNumber:string; transactionType:string; changeAmountVnd:string;
  grossOrderAmountVnd:string; feeVnd:string; direction:"增加"|"减少";
  balanceBeforeVnd:string; balanceAfterVnd:string; sourceLocalTime:string;
}
export interface AccountHistoryMapped extends AccountHistoryInput {
  eventType:AccountEventType; signedAmountVnd:string; payoutPrincipalVnd:string|null;
  payoutFeeVnd:string|null; poolInflowVnd:string|null; poolOutflowVnd:string|null;
  balanceValidationDifferenceVnd:string; balanceValidationStatus:"MATCH"|"MISMATCH";
  continuityStatus?:"FIRST"|"MATCH"|"MISMATCH"; transferPairStatus:"PAIRED"|"UNMATCHED"|"NOT_APPLICABLE";
  transferPairKey:string|null;
  grossChangeVnd:string; grossSignedChangeVnd:string; grossBalanceBeforeVnd:string; grossBalanceAfterVnd:string;
  reserveRatio:string; reserveAmountVnd:string; settleableRatio:string;
  settleableChangeVnd:string; settleableSignedChangeVnd:string;
  settleableBalanceBeforeVnd:string; settleableBalanceAfterVnd:string;
}
function mapAccountEventType(value:string):AccountEventType {
  if(value==="收单")return "PAYIN_INFLOW";
  if(value==="代付")return "PAYOUT_OUTFLOW";
  if(value==="结算扣款")return "INTERNAL_TRANSFER_DEBIT";
  if(value==="结算入账")return "INTERNAL_TRANSFER_CREDIT";
  return "MANUAL_ADJUSTMENT";
}
export function mapAccountHistoryEntry(input:AccountHistoryInput,toleranceVnd=RULES.balanceRoundingToleranceVnd):AccountHistoryMapped {
  const change=new Decimal(input.changeAmountVnd).abs();
  const signed=input.direction==="增加"?change:change.neg();
  const difference=new Decimal(input.balanceBeforeVnd).plus(signed).minus(input.balanceAfterVnd);
  const eventType=mapAccountEventType(input.transactionType);
  const isTransfer=eventType==="INTERNAL_TRANSFER_DEBIT"||eventType==="INTERNAL_TRANSFER_CREDIT";
  const beforeLayers=deriveBalanceLayers(input.balanceBeforeVnd);
  const afterLayers=deriveBalanceLayers(input.balanceAfterVnd);
  return {...input,eventType,signedAmountVnd:signed.toFixed(2),
    payoutPrincipalVnd:eventType==="PAYOUT_OUTFLOW"?new Decimal(input.grossOrderAmountVnd).toFixed(2):null,
    payoutFeeVnd:eventType==="PAYOUT_OUTFLOW"?new Decimal(input.feeVnd).toFixed(2):null,
    poolInflowVnd:eventType==="PAYIN_INFLOW"?change.toFixed(2):null,
    poolOutflowVnd:eventType==="PAYOUT_OUTFLOW"?change.toFixed(2):null,
    balanceValidationDifferenceVnd:difference.toFixed(2),
    balanceValidationStatus:difference.abs().lte(toleranceVnd)?"MATCH":"MISMATCH",
    transferPairStatus:isTransfer?"UNMATCHED":"NOT_APPLICABLE",
    transferPairKey:isTransfer?`${input.businessOrderNumber}\u001f${change.toFixed(2)}`:null,
    grossChangeVnd:change.toFixed(2),grossSignedChangeVnd:signed.toFixed(2),
    grossBalanceBeforeVnd:beforeLayers.grossBalanceVnd,grossBalanceAfterVnd:afterLayers.grossBalanceVnd,
    reserveRatio:RULES.reserveRatio,reserveAmountVnd:afterLayers.reserveAmountVnd,
    settleableRatio:RULES.settleableRatio,settleableChangeVnd:deriveSettleableChange(change.toFixed(2)),
    settleableSignedChangeVnd:deriveSettleableChange(signed.toFixed(2)),
    settleableBalanceBeforeVnd:beforeLayers.settleableBalanceVnd,
    settleableBalanceAfterVnd:afterLayers.settleableBalanceVnd};
}
export function rebuildAccountHistory(entries:AccountHistoryMapped[],toleranceVnd=RULES.balanceRoundingToleranceVnd) {
  const ordered=[...entries].sort((a,b)=>a.sourceLocalTime.localeCompare(b.sourceLocalTime)||b.sourceRowNumber-a.sourceRowNumber);
  const transferGroups=new Map<string,AccountHistoryMapped[]>();
  for(const entry of ordered)if(entry.transferPairKey)transferGroups.set(entry.transferPairKey,[...(transferGroups.get(entry.transferPairKey)??[]),entry]);
  for(const group of transferGroups.values()){
    const debits=group.filter(x=>x.eventType==="INTERNAL_TRANSFER_DEBIT");const credits=group.filter(x=>x.eventType==="INTERNAL_TRANSFER_CREDIT");
    const paired=Math.min(debits.length,credits.length);debits.forEach((x,i)=>x.transferPairStatus=i<paired?"PAIRED":"UNMATCHED");credits.forEach((x,i)=>x.transferPairStatus=i<paired?"PAIRED":"UNMATCHED");
  }
  ordered.forEach((entry,index)=>{entry.continuityStatus=index===0?"FIRST":new Decimal(ordered[index-1].balanceAfterVnd).minus(entry.balanceBeforeVnd).abs().lte(toleranceVnd)?"MATCH":"MISMATCH";});
  return ordered;
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
