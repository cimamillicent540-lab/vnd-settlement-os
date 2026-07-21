import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { calculatePayinEconomics } from "@/lib/domain";
import {normalizeSupabaseUrl} from "@/lib/supabase-url";

const rowSchema=z.object({rowNumber:z.number(),status:z.enum(["VALID","INVALID","DUPLICATE"]),data:z.record(z.string(),z.unknown()),errors:z.array(z.string()).optional(),rawRowHash:z.string(),diagnostics:z.record(z.string(),z.unknown()).optional()});
const payloadSchema=z.object({sourceType:z.enum(["PAYIN","PAYOUT"]),originalFileName:z.string().min(1),fileHash:z.string().length(64),mapping:z.record(z.string(),z.string()),totalRows:z.number().int().nonnegative(),invalidRows:z.number().int().nonnegative(),duplicateRows:z.number().int().nonnegative(),rows:z.array(rowSchema.extend({status:z.literal("VALID")})).max(10000),rowErrors:z.array(rowSchema).max(10000)});
const numeric=(value:unknown)=>value==null||value===""?null:String(value).replace(/,/g,"");
export async function POST(request:Request){
  const parsed=payloadSchema.safeParse(await request.json());
  if(!parsed.success)return NextResponse.json({message:"导入载荷校验失败",details:parsed.error.flatten()},{status:400});
  const url=normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL); const key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY??process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY; const authorization=request.headers.get("authorization");
  if(!url||!key)return NextResponse.json({message:"Supabase 环境变量未配置。"},{status:503});
  if(!authorization)return NextResponse.json({message:"需要已认证的内部账号。"},{status:401});
  const supabase=createClient(url,key,{auth:{persistSession:false},global:{headers:{Authorization:authorization}}}); const input=parsed.data;
  const {data:{user}}=await supabase.auth.getUser(); if(!user)return NextResponse.json({message:"登录已失效，请重新认证。"},{status:401});
  const {data:existing}=await supabase.from("import_batches").select("id").eq("file_hash",input.fileHash).maybeSingle();
  if(existing)return NextResponse.json({message:"该文件已导入，系统已阻止重复批次。"},{status:409});
  const {data:batch,error:batchError}=await supabase.from("import_batches").insert({source_type:input.sourceType,original_file_name:input.originalFileName,file_hash:input.fileHash,total_rows:input.totalRows,valid_rows:input.rows.length,invalid_rows:input.invalidRows,duplicate_rows:input.duplicateRows,status:"PROCESSING",field_mapping:input.mapping,imported_by:user.id}).select("id").single();
  if(batchError)return NextResponse.json({message:batchError.message},{status:500});
  const table=input.sourceType==="PAYIN"?"payin_orders":"payout_orders";
  const records=input.rows.map(row=>{
    const base={...row.data,import_batch_id:batch.id,raw_row_hash:row.rawRowHash};
    if(input.sourceType==="PAYIN"){
      const amount=String(numeric(row.data.payin_amount_vnd)); const economics=calculatePayinEconomics(amount,String(row.data.status)==="SUCCESS"?"SUCCESS":String(row.data.status)==="FAILED"?"FAILED":"PENDING");
      const validation=row.diagnostics?.feeValidation as {expectedFeeRevenueVnd?:string;differenceVnd?:string;status?:string}|undefined;
      return {...base,payin_amount_vnd:amount,target_amount_vnd:numeric(row.data.target_amount_vnd),imported_transaction_fee_vnd:numeric(row.data.imported_transaction_fee_vnd),expected_fee_rate:"0.008",expected_fee_revenue_vnd:economics.expectedFeeRevenueVnd,fee_validation_difference_vnd:validation?.differenceVnd??null,fee_validation_status:validation?.status??"MISSING",upstream_success_fee_vnd:"2500",upstream_failure_fee_vnd:"0",upstream_fee_applied_vnd:economics.upstreamFeeAppliedVnd,net_fee_contribution_vnd:economics.netFeeContributionVnd,pool_inflow_vnd:null,pool_inflow_status:row.data.status==="SUCCESS"?"PENDING_CONFIRMATION":"NOT_APPLICABLE",event_time_confidence:row.data.completed_at?"HIGH":"MEDIUM",funding_method:"INTERNAL_NETTING",external_usdt_spent:"0",cost_basis_method:"INTERNAL_NETTING",cost_basis_status:"NOT_APPLICABLE",company_payin_fee_revenue_vnd:economics.expectedFeeRevenueVnd,upstream_payin_fee_vnd:economics.upstreamFeeAppliedVnd,payin_net_fee_contribution_vnd:economics.netFeeContributionVnd};
    }
    const apValidation=row.diagnostics?.apValidation as {status?:string}|undefined;
    return {...base,payout_amount_vnd:numeric(row.data.payout_amount_vnd),received_usdt:numeric(row.data.received_usdt),ar_rate:numeric(row.data.ar_rate),as_rate:numeric(row.data.as_rate),ap_imported:numeric(row.data.ap_imported),aq_imported:numeric(row.data.aq_imported),at_gross_income:numeric(row.data.at_gross_income),ap_validation_status:apValidation?.status??"MISSING",aq_is_included:true,aq_composition_mode:"UNKNOWN",diagnostic_only:true};
  });
  const {error:rowError}=await supabase.from(table).upsert(records,{onConflict:"raw_row_hash",ignoreDuplicates:true});
  if(input.rowErrors.length)await supabase.from("import_row_errors").insert(input.rowErrors.map(row=>({import_batch_id:batch.id,row_number:row.rowNumber,error_codes:[row.status],error_messages:row.errors??[row.status],sanitized_row:row.data})));
  await supabase.from("import_batches").update({status:rowError?"PARTIAL":"COMPLETED",error_summary:rowError?{message:rowError.message}:null}).eq("id",batch.id);
  if(rowError)return NextResponse.json({message:`批次已创建，部分行失败：${rowError.message}`},{status:207});
  return NextResponse.json({ok:true,message:`已写入批次 ${batch.id}，共 ${records.length} 条有效记录。`});
}
