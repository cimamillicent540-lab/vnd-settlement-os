import { z } from "zod";
import Decimal from "decimal.js";
import { fingerprintText, sanitizeImportRow, validateAp, validateImportedFee } from "./domain";

export type ImportSourceType = "PAYIN" | "PAYOUT";
export type FieldMap = Record<string, string>;

export const payinAliases: Record<string, string[]> = {
  order_number: ["订单号", "平台订单号", "order number", "order_number"],
  merchant_order_number: ["商户订单号", "merchant order number", "merchant_order_number"],
  channel_order_number: ["通道订单号", "channel order number"],
  merchant_code: ["商户编码", "merchant code"],
  merchant_name: ["商户名称", "商户", "merchant name"],
  channel_code: ["通道编码", "channel code"],
  channel_name: ["通道名称", "通道", "channel name"],
  payin_amount_vnd: ["订单金额", "支付金额", "payin amount", "amount"],
  target_amount_vnd: ["目标金额", "实际到账金额", "target amount", "net amount"],
  imported_transaction_fee_vnd: ["交易手续费", "手续费", "transaction fee", "fee"],
  status: ["订单状态", "状态", "status"],
  created_at: ["创建时间", "订单时间", "created at"],
  completed_at: ["完成时间", "成功时间", "completed at"],
};

export const payoutAliases: Record<string, string[]> = {
  order_number: ["订单号", "平台订单号", "order number"],
  merchant: ["商户", "merchant"], channel: ["通道", "channel"],
  received_usdt: ["收到USDT", "received usdt", "usdt"],
  payout_amount_vnd: ["付款金额", "payout amount", "vnd amount"],
  ar_rate: ["AR", "AR汇率", "ar_rate"], as_rate: ["AS", "AS汇率", "as_rate"],
  ap_imported: ["AP", "AP导入值", "ap"], aq_imported: ["AQ", "AQ导入值", "aq"],
  at_gross_income: ["AT毛收入", "at gross income", "at"],
  status: ["订单状态", "状态", "status"], completed_at: ["完成时间", "付款时间", "completed at"],
};

const normalize = (value:string) => value.trim().toLowerCase().replace(/[\s_-]+/g, "");
export function autoMapHeaders(headers:string[], sourceType:ImportSourceType):FieldMap {
  const aliases = sourceType === "PAYIN" ? payinAliases : payoutAliases;
  const map:FieldMap = {};
  for (const header of headers) {
    const found = Object.entries(aliases).find(([, names]) => names.some((name)=>normalize(name)===normalize(header)));
    if (found) map[header] = found[0];
  }
  return map;
}

const vndInteger = z.union([z.string(), z.number()]).transform(String).refine((v)=>new Decimal(v.replace(/,/g,"" )).isInteger(), "VND金额必须为整数");
const baseStatus = z.union([z.string(),z.number()]).transform((v)=>{
  const value=String(v).trim().toUpperCase();
  if(["成功","已完成","SUCCESS","COMPLETED"].includes(value))return "SUCCESS";
  if(["失败","FAILED","FAILURE"].includes(value))return "FAILED";
  if(["超时","TIMEOUT","TIMED_OUT"].includes(value))return "TIMEOUT";
  if(["取消","已取消","CANCELLED","CANCELED"].includes(value))return "CANCELLED";
  return value||"PENDING";
});
const timestamp = z.union([z.string(),z.date()]).transform((v)=>v instanceof Date?v.toISOString():v).pipe(z.string().min(1));
const payinSchema = z.object({ order_number:z.union([z.string(),z.number()]).transform(String).pipe(z.string().min(1)), payin_amount_vnd:vndInteger, status:baseStatus, created_at:timestamp, completed_at:timestamp.optional(), imported_transaction_fee_vnd:vndInteger.optional(), target_amount_vnd:vndInteger.optional() }).passthrough();
const payoutSchema = z.object({ order_number:z.union([z.string(),z.number()]).transform(String).pipe(z.string().min(1)), payout_amount_vnd:vndInteger, ar_rate:z.union([z.string(),z.number()]).transform(String), as_rate:z.union([z.string(),z.number()]).transform(String), ap_imported:z.union([z.string(),z.number()]).transform(String), aq_imported:z.union([z.string(),z.number()]).transform(String), status:baseStatus, created_at:timestamp, completed_at:timestamp.optional() }).passthrough();

export interface ValidatedRow { rowNumber:number; status:"VALID"|"INVALID"|"DUPLICATE"; data:Record<string,unknown>; errors:string[]; rawRowHash:string; diagnostics?:Record<string,unknown>; }
export function validateRows(rows:Record<string,unknown>[], mapping:FieldMap, sourceType:ImportSourceType):ValidatedRow[] {
  const seen = new Set<string>();
  return rows.map((raw,index)=>{
    const sanitized = sanitizeImportRow(raw);
    const mapped = Object.fromEntries(Object.entries(mapping).map(([header,field])=>[field,sanitized[header]]));
    const parsed = (sourceType === "PAYIN" ? payinSchema : payoutSchema).safeParse(mapped);
    const rawRowHash = fingerprintText(JSON.stringify(sanitized));
    if (seen.has(rawRowHash)) return { rowNumber:index+2,status:"DUPLICATE",data:mapped,errors:["文件内重复记录"],rawRowHash };
    seen.add(rawRowHash);
    if (!parsed.success) return { rowNumber:index+2,status:"INVALID",data:mapped,errors:parsed.error.issues.map((issue)=>`${issue.path.join(".")}: ${issue.message}`),rawRowHash };
    const data = parsed.data as Record<string,unknown>;
    const diagnostics:Record<string,unknown> = {};
    if (sourceType === "PAYIN" && data.imported_transaction_fee_vnd) diagnostics.feeValidation = validateImportedFee(String(data.payin_amount_vnd).replace(/,/g,""),String(data.imported_transaction_fee_vnd).replace(/,/g,""));
    if (sourceType === "PAYOUT") diagnostics.apValidation = validateAp(String(data.ar_rate),String(data.as_rate),String(data.ap_imported));
    return { rowNumber:index+2,status:"VALID",data,errors:[],rawRowHash,diagnostics };
  });
}
