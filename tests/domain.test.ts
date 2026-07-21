import { describe, expect, it } from "vitest";
import {
  InsufficientPoolBalanceError, RULES, allocatePayoutProportionally, aqDiagnostics,
  calculatePayinEconomics, fingerprintText, maskCardNumber, poolThresholdSnapshot,
  sanitizeImportRow, shouldChangePool, summarizeTopups, validateAp, validateImportedFee,
  calculatePayinPoolEntry, mapAccountHistoryEntry, rebuildAccountHistory,
  type PoolBucketInput,
} from "../lib/domain";

describe("VND Payin economics",()=>{
  it("calculates 1,000,000 VND payin revenue, cost and contribution",()=>expect(calculatePayinEconomics("1000000")).toEqual({expectedFeeRevenueVnd:"8000.00",upstreamFeeAppliedVnd:"2500.00",netFeeContributionVnd:"5500.00"}));
  it("breaks even at 312,500 VND",()=>expect(calculatePayinEconomics("312500").netFeeContributionVnd).toBe("0.00"));
  it("keeps the failed-order upstream fee configurable",()=>{expect(RULES.upstreamPayinFailureFeeVnd).toBe("0");expect(calculatePayinEconomics("1000000","FAILED").upstreamFeeAppliedVnd).toBe("0.00")});
  it("allows a one-VND imported fee rounding difference",()=>expect(validateImportedFee("312500","2499").status).toBe("MATCH"));
  it("uses actual 992000 change as pool inflow and keeps 2500 separate",()=>{const result=calculatePayinPoolEntry("1000000","992000");expect(result.poolInflowVnd).toBe("992000.00");expect(result.upstreamPayinFeeVnd).toBe("2500.00");expect(result.payinNetFeeContributionVnd).toBe("5500.00")});
  it("marks Payin internal netting cost as not applicable",()=>{const result=calculatePayinPoolEntry("1000000","992000");expect(result.fundingMethod).toBe("INTERNAL_NETTING");expect(result.externalUsdtSpent).toBe("0.00000000");expect(result.costBasisStatus).toBe("NOT_APPLICABLE")});
});

describe("Topup precision",()=>{
  it("summarizes the three verified topups exactly",()=>{const result=summarizeTopups([{usdtSpent:"150000",netVndReceived:"3938250000"},{usdtSpent:"150000",netVndReceived:"3938250000"},{usdtSpent:"250000",netVndReceived:"6657000000"}]);expect(result.totalUsdt).toBe("550000.00000000");expect(result.totalVnd).toBe("14533500000.00");expect(result.weightedAverageRate).toBe("26424.5454545454")});
});

describe("AR / AS / AP / AQ",()=>{
  it("calculates AP as AS divided by AR minus one",()=>{const result=validateAp("26000","26520","0.02");expect(result.apCalculated).toBe("0.020000000000");expect(result.status).toBe("MATCH")});
  it("marks AQ residuals diagnostic-only and never as another fee",()=>{const result=aqDiagnostics("0.02","0.005");expect(result.diagnosticOnly).toBe(true);expect(result.relationshipLabel).toBe("关系公式待确认");expect(result.additiveResidual).toBe("0.015000000000")});
});

describe("proportional pool allocation",()=>{
  const buckets:PoolBucketInput[]=[{id:"payin",sourceType:"PAYIN",availableAmountVnd:"70000000",costBasisStatus:"MISSING"},{id:"topup",sourceType:"TOPUP",availableAmountVnd:"30000000",fundingRateVndPerUsdt:"26000",costBasisStatus:"KNOWN"}];
  it("allocates a 100m payout 70/30",()=>expect(allocatePayoutProportionally(buckets,"100000000").map(row=>row.allocatedVnd)).toEqual(["70000000.00","30000000.00"]));
  it("assigns the cent residual to the final active bucket",()=>{const result=allocatePayoutProportionally([{...buckets[0],availableAmountVnd:"2"},{...buckets[1],availableAmountVnd:"1"}],"2");expect(result.map(row=>row.allocatedVnd)).toEqual(["1.33","0.67"])});
  it("rejects insufficient balance without producing a negative bucket",()=>expect(()=>allocatePayoutProportionally(buckets,"100000001")).toThrow(InsufficientPoolBalanceError));
  it("does not change the pool for failed, timeout or cancelled orders",()=>{expect(shouldChangePool("FAILED")).toBe(false);expect(shouldChangePool("TIMEOUT")).toBe(false);expect(shouldChangePool("CANCELLED")).toBe(false);expect(shouldChangePool("SUCCESS")).toBe(true)});
});

describe("account history reconstruction",()=>{
  const base={businessOrderNumber:"O-1",grossOrderAmountVnd:"1000000",feeVnd:"8000",balanceBeforeVnd:"3398228791",balanceAfterVnd:"3399220791",sourceLocalTime:"2026-07-17 08:00:00"};
  it("maps Payin change amount without deducting upstream fee",()=>{const row=mapAccountHistoryEntry({...base,sourceRowNumber:10,transactionType:"收单",changeAmountVnd:"992000",direction:"增加"});expect(row.poolInflowVnd).toBe("992000.00");expect(row.balanceValidationStatus).toBe("MATCH")});
  it("maps payout outflow to principal plus fee change",()=>{const row=mapAccountHistoryEntry({...base,sourceRowNumber:11,transactionType:"代付",changeAmountVnd:"47473331.73",grossOrderAmountVnd:"47237146",feeVnd:"236185.73",direction:"减少",balanceBeforeVnd:"3239911755",balanceAfterVnd:"3192438423"});expect(row.poolOutflowVnd).toBe("47473331.73");expect(row.payoutPrincipalVnd).toBe("47237146.00")});
  it("pairs internal debit and credit to net zero",()=>{const debit=mapAccountHistoryEntry({...base,sourceRowNumber:4,transactionType:"结算扣款",changeAmountVnd:"992000",direction:"减少",balanceBeforeVnd:"3399220791",balanceAfterVnd:"3398220791"});const credit=mapAccountHistoryEntry({...base,sourceRowNumber:5,transactionType:"结算入账",changeAmountVnd:"992000",direction:"增加"});const rows=rebuildAccountHistory([debit,credit]);expect(rows.every(row=>row.transferPairStatus==="PAIRED")).toBe(true);expect(rows.reduce((sum,row)=>sum+Number(row.signedAmountVnd),0)).toBe(0)});
  it("uses the approved opening balance",()=>expect(RULES.openingBalanceVnd).toBe("6796457582.28"));
  it("orders equal timestamps by descending source row and preserves continuity",()=>{const first=mapAccountHistoryEntry({...base,sourceRowNumber:5,transactionType:"结算入账",changeAmountVnd:"992000",direction:"增加"});const second=mapAccountHistoryEntry({...base,sourceRowNumber:4,transactionType:"结算扣款",changeAmountVnd:"992000",direction:"减少",balanceBeforeVnd:"3399220791",balanceAfterVnd:"3398220791"});const rows=rebuildAccountHistory([second,first]);expect(rows.map(row=>row.sourceRowNumber)).toEqual([5,4]);expect(rows[1].continuityStatus).toBe("MATCH")});
});

describe("quality and privacy controls",()=>{
  it("detects identical file contents",()=>expect(fingerprintText("same-file")).toBe(fingerprintText("same-file")));
  it("never retains full card numbers or unnecessary names",()=>{const result=sanitizeImportRow({名字:"Wei",姓:"Li",卡号:"4111 1111 1111 1234",订单号:"A1"});expect(result).toEqual({卡号:"**** **** **** 1234",订单号:"A1"});expect(JSON.stringify(result)).not.toContain("4111111111111234")});
  it("masks short card-like values too",()=>expect(maskCardNumber("1234")).toBe("****1234"));
  it("records whether a reference-rate snapshot is below 50k USDT",()=>{expect(poolThresholdSnapshot("1000000000","25000")).toEqual({equivalentUsdt:"40000.00000000",isLow:true});expect(poolThresholdSnapshot("1500000000","25000").isLow).toBe(false)});
});
