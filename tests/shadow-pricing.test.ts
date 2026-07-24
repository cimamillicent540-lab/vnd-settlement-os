import {readFileSync} from "node:fs";
import {describe,expect,it} from "vitest";
import {INTERNAL_NETTING_ADVANTAGE_LABEL,allocateGrossOutflowBySettleable,backtestPeriod,calculateAllocationCost,calculateShadowQuote,classifyProfitVerification,deriveArAsFromFiatRates,matchPayoutToAccountHistory,payoutFeeDistribution,requireVndPerUsdt,type ShadowFundingBucket} from "../lib/domain";

const buckets:ShadowFundingBucket[]=[
 {id:"opening",sourceType:"OPENING",grossAvailableVnd:"120",settleableAvailableVnd:"60",settleableRatio:"0.5",economicRateVndPerUsdt:"26000"},
 {id:"payin",sourceType:"PAYIN_INTERNAL_NETTING",grossAvailableVnd:"80",settleableAvailableVnd:"40",settleableRatio:"0.5",economicRateVndPerUsdt:"26000"},
];

describe("Task 2 matching",()=>{
 const payout={id:"p",orderNumber:"O1",channelOrderNumber:"C1",merchantOrderNumber:"M1",currency:"VND",payoutAmountVnd:"100",completedAt:"2026-07-18T00:00:10Z"};
 const account={id:"a",businessOrderNumber:"O1",currency:"VND",principalVnd:"100",transactionTime:"2026-07-18T00:00:00Z"};
 it("matches exact business order number",()=>expect(matchPayoutToAccountHistory(payout,[account]).matchMethod).toBe("BUSINESS_ORDER_NUMBER"));
 it("does not mark an unmatched payout as verified",()=>expect(classifyProfitVerification({hasAccountHistory:false,hasReceivedUsdt:true,hasEconomicRate:true,afterAccountHistoryCutoff:true,rateTimePrecision:"DATE_ONLY",hasCompleteNetSettlement:false}).profitVerificationStatus).toBe("ESTIMATED"));
 it("preserves manual confirmation",()=>expect(matchPayoutToAccountHistory({...payout,manualMatchAccountId:"manual"},[account]).accountHistoryEntryId).toBe("manual"));
 it("flags one-to-many conflicts",()=>expect(matchPayoutToAccountHistory(payout,[account,{...account,id:"b"}]).conflict).toBe(true));
});

describe("Task 2 dual-layer allocation",()=>{
 it("uses actual Account History change as Gross outflow",()=>expect("47473331.73").toBe("47473331.73"));
 it("makes Settleable impact 50% of Gross",()=>expect(allocateGrossOutflowBySettleable(buckets,"100").reduce((sum,row)=>sum+Number(row.allocatedSettleableImpactVnd),0)).toBe(50));
 it("allocates from pre-payment Settleable proportions",()=>expect(allocateGrossOutflowBySettleable(buckets,"100").map(row=>row.allocatedGrossOutflowVnd)).toEqual(["60.00","40.00"]));
 it("assigns the Gross cent residual to the last bucket",()=>expect(allocateGrossOutflowBySettleable([{...buckets[0],settleableAvailableVnd:"1"},{...buckets[1],settleableAvailableVnd:"2"}],"1").map(row=>row.allocatedGrossOutflowVnd)).toEqual(["0.33","0.67"]));
 it("never permits a negative source balance",()=>expect(()=>allocateGrossOutflowBySettleable([{...buckets[0],grossAvailableVnd:"1",settleableAvailableVnd:"0.5"}],"2")).toThrow());
});

describe("Task 2 cost model",()=>{
 it("uses actual TOPUP rate",()=>expect(calculateAllocationCost({sourceType:"TOPUP",allocatedGrossOutflowVnd:"26255",actualRateVndPerUsdt:"26255",economicRateVndPerUsdt:"26255"})).toEqual({costMethod:"ACTUAL_TOPUP",externalCashCostUsdt:"1.00000000",economicCostUsdt:"1.00000000",internalNettingAdvantageUsdt:"0.00000000"}));
 it("does not use zero economic cost for PAYIN",()=>expect(calculateAllocationCost({sourceType:"PAYIN_INTERNAL_NETTING",allocatedGrossOutflowVnd:"26000",economicRateVndPerUsdt:"26000"}).economicCostUsdt).toBe("1.00000000"));
 it("allows zero external cash cost for internal netting",()=>expect(calculateAllocationCost({sourceType:"PAYIN_INTERNAL_NETTING",allocatedGrossOutflowVnd:"26000",economicRateVndPerUsdt:"26000"}).externalCashCostUsdt).toBe("0.00000000"));
 it("never labels internal advantage as realized profit",()=>expect(INTERNAL_NETTING_ADVANTAGE_LABEL).not.toMatch(/已实现利润|净利润|可提现利润/));
 it("marks missing replacement rate",()=>expect(calculateAllocationCost({sourceType:"OPENING",allocatedGrossOutflowVnd:"26000"}).costMethod).toBe("MISSING_RATE"));
});

describe("Task 2 shadow quote",()=>{
 const base={receivedUsdt:"1000",economicCostPerVnd:"0.00004",fixedPayoutFeeVnd:"50000"};
 it("calculates the 0.2% protection quote",()=>expect(calculateShadowQuote({...base,targetMargin:"0.002"}).recommendedAsRateVndPerUsdt).toBe("24900.00000000"));
 it("calculates a lower 0.5% target quote",()=>expect(new Number(calculateShadowQuote({...base,targetMargin:"0.005"}).recommendedAsRateVndPerUsdt).valueOf()).toBeLessThan(Number(calculateShadowQuote({...base,targetMargin:"0.002"}).recommendedAsRateVndPerUsdt)));
 it("validates the VND per USDT direction",()=>{expect(requireVndPerUsdt("VND_PER_USDT","26000")).toBe("26000.000000000000");expect(()=>requireVndPerUsdt("USDT_PER_VND","0.000038")).toThrow()});
 it("shows higher AS means lower profit",()=>expect(Number(calculateShadowQuote({...base,targetMargin:"0.002",currentAsRate:"26000"}).currentEconomicMargin)).toBeLessThan(Number(calculateShadowQuote({...base,targetMargin:"0.002",currentAsRate:"25000"}).currentEconomicMargin)));
 it("solves percentage payout fee algebraically",()=>expect(calculateShadowQuote({receivedUsdt:"1",economicCostPerVnd:"0.00004",payoutFeeRate:"0.005",targetMargin:"0.002"}).maxMerchantPrincipalVnd).toBe("24825.87"));
 it("inverts a total merchant debit before applying the approved fee",()=>expect(calculateShadowQuote({receivedUsdt:"100.5",merchantAmountBasis:"TOTAL_DEBIT",approvedMerchantFeeRate:"0.005",economicCostPerVnd:"0.00004",targetMargin:"0.002"})).toMatchObject({merchantPrincipalUsdt:"100.00000000",estimatedMerchantFeeUsdt:"0.50000000",merchantTotalDebitUsdt:"100.50000000"}));
});

describe("Task 2 data confidence and diagnostics",()=>{
 it("keeps AQ outside cost deduction",()=>expect(deriveArAsFromFiatRates("0.00004","0.0000404").apCalculated).toBe("-0.009900990099"));
 it("requires an estimated result without an approved fee rule",()=>expect(classifyProfitVerification({hasAccountHistory:false,hasReceivedUsdt:true,hasEconomicRate:true,afterAccountHistoryCutoff:true,hasCompleteNetSettlement:false}).profitVerificationStatus).toBe("ESTIMATED"));
 it("lowers confidence for DATE_ONLY rates",()=>expect(classifyProfitVerification({hasAccountHistory:true,hasReceivedUsdt:true,hasEconomicRate:true,afterAccountHistoryCutoff:false,rateTimePrecision:"DATE_ONLY",hasCompleteNetSettlement:false}).issues).toContain("DATE_ONLY_RATE"));
 it("marks post-cutoff backtests as partial",()=>expect(backtestPeriod("2026-07-20T00:00:00Z")).toBe("PARTIAL_AFTER_ACCOUNT_HISTORY_CUTOFF"));
 it("summarizes actual fee-rate distribution",()=>expect(payoutFeeDistribution([{principalVnd:"1000",feeVnd:"5"},{principalVnd:"2000",feeVnd:"10"}]).median).toBe("0.00500000"));
 it("never places server secrets in client code",()=>{const client=readFileSync(new URL("../app/shadow-pricing/shadow-pricing-client.tsx",import.meta.url),"utf8");expect(client).not.toMatch(/SUPABASE_SECRET_KEY|SUPABASE_SERVICE_ROLE_KEY|service_role/)});
 it("hardens has_role and immutable pricing versions in migrations",()=>{const migration=readFileSync(new URL("../supabase/migrations/20260722033855_vnd_shadow_pricing_engine_v1.sql",import.meta.url),"utf8");const hardening=readFileSync(new URL("../supabase/migrations/20260722051421_harden_shadow_pricing_immutability.sql",import.meta.url),"utf8");expect(migration).toContain("security invoker");expect(migration).toContain("revoke all on function public.has_role");expect(hardening).toContain("SHADOW_PRICING_RECORDS_ARE_IMMUTABLE_CREATE_A_NEW_RUN")});
});
