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

export function assessDataCompleteness(accountHistoryCutoffLocal:string|null,topupCutoffDate:string|null,payoutCutoffUtc:string|null){
  if(!accountHistoryCutoffLocal)return {status:"INCOMPLETE" as const,isPartial:true};
  const accountCutoffUtc=Date.parse(`${accountHistoryCutoffLocal.replace(" ","T")}+08:00`);
  const topupCutoffUtc=topupCutoffDate?Date.parse(`${topupCutoffDate}T23:59:59+08:00`):Number.NEGATIVE_INFINITY;
  const payoutCutoff= payoutCutoffUtc?Date.parse(payoutCutoffUtc):Number.NEGATIVE_INFINITY;
  const isPartial=topupCutoffUtc>accountCutoffUtc||payoutCutoff>accountCutoffUtc;
  return {status:isPartial?"PARTIAL_AFTER_ACCOUNT_HISTORY_CUTOFF" as const:"COMPLETE_TO_ACCOUNT_HISTORY_CUTOFF" as const,isPartial};
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

export type ShadowFundingSource="OPENING"|"PAYIN_INTERNAL_NETTING"|"TOPUP"|"ADJUSTMENT";
export type CostMethod="ACTUAL_TOPUP"|"INTERNAL_NETTING_SHADOW"|"OPENING_SHADOW"|"MANUAL_APPROVED_RATE"|"MISSING_RATE";
export type DataCompletenessStatus="COMPLETE"|"NO_ACCOUNT_HISTORY"|"MISSING_RECEIVED_USDT"|"MISSING_RATE"|"PARTIAL_AFTER_ACCOUNT_HISTORY_CUTOFF"|"DATE_ONLY_RATE"|"MULTIPLE_ISSUES";
export type ProfitVerificationStatus="VERIFIED"|"PARTIAL"|"ESTIMATED"|"NOT_CALCULABLE";

export interface ShadowFundingBucket {
  id:string;sourceType:ShadowFundingSource;grossAvailableVnd:string;settleableAvailableVnd:string;
  settleableRatio:string;actualRateVndPerUsdt?:string|null;economicRateVndPerUsdt?:string|null;
  rateTimePrecision?:"EXACT"|"DATE_ONLY"|null;
}
export interface ShadowFundingAllocation extends ShadowFundingBucket {
  allocationRatio:string;allocatedGrossOutflowVnd:string;allocatedSettleableImpactVnd:string;
  grossBalanceAfterVnd:string;settleableBalanceAfterVnd:string;
}

export function allocateGrossOutflowBySettleable(buckets:ShadowFundingBucket[],grossOutflowVnd:string):ShadowFundingAllocation[]{
  const grossOutflow=new Decimal(grossOutflowVnd);
  if(grossOutflow.lte(0)||grossOutflow.decimalPlaces()>2)throw new Error("Gross outflow must be positive with at most two decimals");
  const active=buckets.filter(bucket=>new Decimal(bucket.settleableAvailableVnd).gt(0));
  const totalSettleable=active.reduce((sum,bucket)=>sum.plus(bucket.settleableAvailableVnd),new Decimal(0));
  if(totalSettleable.lte(0))throw new InsufficientPoolBalanceError("0.00",grossOutflow.toFixed(2));
  let allocatedGross=new Decimal(0);
  return active.map((bucket,index)=>{
    const ratio=new Decimal(bucket.settleableAvailableVnd).div(totalSettleable);
    const gross=index===active.length-1?grossOutflow.minus(allocatedGross):grossOutflow.mul(ratio).toDecimalPlaces(2,Decimal.ROUND_DOWN);
    const settleableImpact=gross.mul(bucket.settleableRatio).toDecimalPlaces(4,Decimal.ROUND_HALF_UP);
    const grossBefore=new Decimal(bucket.grossAvailableVnd);
    const settleableBefore=new Decimal(bucket.settleableAvailableVnd);
    if(gross.gt(grossBefore)||settleableImpact.gt(settleableBefore))throw new InsufficientPoolBalanceError(totalSettleable.toFixed(4),settleableImpact.toFixed(4));
    allocatedGross=allocatedGross.plus(gross);
    return {...bucket,allocationRatio:ratio.toFixed(12),allocatedGrossOutflowVnd:gross.toFixed(2),allocatedSettleableImpactVnd:settleableImpact.toFixed(4),grossBalanceAfterVnd:grossBefore.minus(gross).toFixed(2),settleableBalanceAfterVnd:settleableBefore.minus(settleableImpact).toFixed(4)};
  });
}

export function calculateAllocationCost(allocation:Pick<ShadowFundingAllocation,"sourceType"|"allocatedGrossOutflowVnd"|"actualRateVndPerUsdt"|"economicRateVndPerUsdt">){
  const gross=new Decimal(allocation.allocatedGrossOutflowVnd);
  const actual=allocation.actualRateVndPerUsdt?new Decimal(allocation.actualRateVndPerUsdt):null;
  const economic=allocation.economicRateVndPerUsdt?new Decimal(allocation.economicRateVndPerUsdt):null;
  const external=allocation.sourceType==="TOPUP"&&actual?.gt(0)?gross.div(actual):new Decimal(0);
  const economicCost=economic?.gt(0)?gross.div(economic):null;
  const method:CostMethod=allocation.sourceType==="TOPUP"&&actual?.gt(0)?"ACTUAL_TOPUP":!economic?"MISSING_RATE":allocation.sourceType==="PAYIN_INTERNAL_NETTING"?"INTERNAL_NETTING_SHADOW":allocation.sourceType==="OPENING"?"OPENING_SHADOW":"MANUAL_APPROVED_RATE";
  return {costMethod:method,externalCashCostUsdt:external.toFixed(8),economicCostUsdt:economicCost?.toFixed(8)??null,internalNettingAdvantageUsdt:economicCost?economicCost.minus(external).toFixed(8):null};
}

export function requireVndPerUsdt(direction:string,rate:string){
  if(direction!=="VND_PER_USDT")throw new Error("Rate direction must be VND_PER_USDT");
  const value=new Decimal(rate);if(value.lte(0))throw new Error("Rate must be positive");return value.toFixed(12);
}

export function deriveArAsFromFiatRates(beforeUsdtPerVnd:string,afterUsdtPerVnd:string){
  const before=new Decimal(beforeUsdtPerVnd);const after=new Decimal(afterUsdtPerVnd);
  if(before.lte(0)||after.lte(0))throw new Error("Fiat DCC rates must be positive");
  const ar=new Decimal(1).div(before);const as=new Decimal(1).div(after);
  return {arRateVndPerUsdt:ar.toFixed(12),asRateVndPerUsdt:as.toFixed(12),apCalculated:as.div(ar).minus(1).toFixed(12)};
}

export interface ShadowQuoteInput {receivedUsdt:string;economicCostPerVnd:string;companyBorneFeeUsdt?:string;fixedPayoutFeeVnd?:string;payoutFeeRate?:string;targetMargin:string;currentAsRate?:string;}
export function calculateShadowQuote(input:ShadowQuoteInput){
  const received=new Decimal(input.receivedUsdt);const costPerVnd=new Decimal(input.economicCostPerVnd);const margin=new Decimal(input.targetMargin);const companyFee=new Decimal(input.companyBorneFeeUsdt??0);
  if(received.lte(0)||costPerVnd.lte(0)||margin.lt(0)||margin.gte(1))throw new Error("Invalid shadow quote input");
  const maxGross=received.mul(new Decimal(1).minus(margin)).minus(companyFee).div(costPerVnd);
  const fixedFee=new Decimal(input.fixedPayoutFeeVnd??0);const feeRate=input.payoutFeeRate?new Decimal(input.payoutFeeRate):null;
  const principal=feeRate?maxGross.div(new Decimal(1).plus(feeRate)):maxGross.minus(fixedFee);
  const recommended=principal.div(received);
  const currentPrincipal=input.currentAsRate?received.mul(input.currentAsRate):null;
  const currentGross=currentPrincipal?(feeRate?currentPrincipal.mul(new Decimal(1).plus(feeRate)):currentPrincipal.plus(fixedFee)):null;
  const currentProfit=currentGross?received.minus(companyFee).minus(currentGross.mul(costPerVnd)):null;
  return {maxGrossOutflowVnd:maxGross.toFixed(2),maxMerchantPrincipalVnd:principal.toFixed(2),recommendedAsRateVndPerUsdt:recommended.toFixed(8),currentEconomicProfitUsdt:currentProfit?.toFixed(8)??null,currentEconomicMargin:currentProfit?.div(received).toFixed(8)??null};
}

export interface MatchablePayout {id:string;orderNumber:string;channelOrderNumber?:string|null;merchantOrderNumber?:string|null;currency:string;payoutAmountVnd:string;completedAt:string;manualMatchAccountId?:string|null;}
export interface MatchableAccountEntry {id:string;businessOrderNumber:string;currency:string;principalVnd:string;transactionTime:string;}
export function matchPayoutToAccountHistory(payout:MatchablePayout,entries:MatchableAccountEntry[],maxTimeDifferenceSeconds=300){
  if(payout.manualMatchAccountId)return {accountHistoryEntryId:payout.manualMatchAccountId,matchMethod:"MANUAL_CONFIRMED" as const,matchConfidence:"HIGH" as const,conflict:false};
  const checks:[string,(entry:MatchableAccountEntry)=>boolean][]=[
    ["BUSINESS_ORDER_NUMBER",entry=>entry.businessOrderNumber===payout.orderNumber],
    ["CHANNEL_ORDER_NUMBER",entry=>Boolean(payout.channelOrderNumber)&&entry.businessOrderNumber===payout.channelOrderNumber],
    ["MERCHANT_ORDER_NUMBER",entry=>Boolean(payout.merchantOrderNumber)&&entry.businessOrderNumber===payout.merchantOrderNumber],
    ["TIME_CURRENCY_AMOUNT",entry=>entry.currency===payout.currency&&new Decimal(entry.principalVnd).eq(payout.payoutAmountVnd)&&Math.abs(Date.parse(entry.transactionTime)-Date.parse(payout.completedAt))/1000<=maxTimeDifferenceSeconds],
  ];
  for(const [method,predicate] of checks){const matches=entries.filter(predicate);if(matches.length===1)return {accountHistoryEntryId:matches[0].id,matchMethod:method,matchConfidence:method==="TIME_CURRENCY_AMOUNT"?"MEDIUM" as const:"HIGH" as const,conflict:false};if(matches.length>1)return {accountHistoryEntryId:null,matchMethod:method,matchConfidence:"LOW" as const,conflict:true};}
  return {accountHistoryEntryId:null,matchMethod:"NO_MATCH" as const,matchConfidence:"NONE" as const,conflict:false};
}

export function classifyProfitVerification(input:{hasAccountHistory:boolean;hasReceivedUsdt:boolean;hasEconomicRate:boolean;afterAccountHistoryCutoff:boolean;rateTimePrecision?:"EXACT"|"DATE_ONLY";hasCompleteNetSettlement:boolean}){
  const issues:DataCompletenessStatus[]=[];
  if(!input.hasAccountHistory)issues.push("NO_ACCOUNT_HISTORY");if(!input.hasReceivedUsdt)issues.push("MISSING_RECEIVED_USDT");if(!input.hasEconomicRate)issues.push("MISSING_RATE");if(input.afterAccountHistoryCutoff)issues.push("PARTIAL_AFTER_ACCOUNT_HISTORY_CUTOFF");if(input.rateTimePrecision==="DATE_ONLY")issues.push("DATE_ONLY_RATE");
  const completeness:DataCompletenessStatus=issues.length>1?"MULTIPLE_ISSUES":issues[0]??"COMPLETE";
  const profitVerificationStatus:ProfitVerificationStatus=!input.hasReceivedUsdt||!input.hasEconomicRate?"NOT_CALCULABLE":!input.hasAccountHistory?"ESTIMATED":!input.hasCompleteNetSettlement||input.afterAccountHistoryCutoff||input.rateTimePrecision==="DATE_ONLY"?"PARTIAL":"VERIFIED";
  return {profitVerificationStatus,dataCompletenessStatus:completeness,issues,realizedProfitStatus:input.hasCompleteNetSettlement&&profitVerificationStatus==="VERIFIED"?"VERIFIED" as const:"NOT_FULLY_VERIFIED" as const};
}

export function payoutFeeDistribution(fees:{principalVnd:string;feeVnd:string}[]){
  const rates=fees.filter(row=>new Decimal(row.principalVnd).gt(0)).map(row=>new Decimal(row.feeVnd).div(row.principalVnd)).sort((a,b)=>a.comparedTo(b));
  if(!rates.length)return {median:null,p90:null,outlierCount:0};
  const quantile=(p:number)=>rates[Math.ceil((rates.length-1)*p)];const median=quantile(.5);const p90=quantile(.9);
  return {median:median.toFixed(8),p90:p90.toFixed(8),outlierCount:rates.filter(rate=>rate.gt(p90)).length};
}

export const INTERNAL_NETTING_ADVANTAGE_LABEL="内部对冲优势（Replacement Cost Avoided）" as const;
export function backtestPeriod(completedAt:string,accountHistoryCutoff="2026-07-18T15:59:28Z"){return Date.parse(completedAt)<=Date.parse(accountHistoryCutoff)?"VERIFIED_WINDOW" as const:"PARTIAL_AFTER_ACCOUNT_HISTORY_CUTOFF" as const;}
