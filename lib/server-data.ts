import "server-only";
import {createClient} from "@supabase/supabase-js";
import {normalizeSupabaseUrl} from "./supabase-url";

export function serverClient(){
  const configured=process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret=process.env.SUPABASE_SECRET_KEY??process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!configured||!secret)throw new Error("Supabase server configuration is missing");
  const url=normalizeSupabaseUrl(configured);
  if(!url)throw new Error("Supabase URL is invalid");
  return createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
}
export async function getImportBatches(){const {data,error}=await serverClient().from("import_batches").select("id,source_type,original_file_name,imported_at,total_rows,valid_rows,invalid_rows,duplicate_rows,status").order("imported_at",{ascending:false});if(error)throw error;return data;}
export async function getTopups(){const {data,error}=await serverClient().from("topup_batches").select("id,execution_date,sequence_within_date,channel,usdt_spent,gross_vnd_received,remaining_vnd,calculated_rate,time_precision,status,account_history_match_status,gross_ledger_treatment,settleable_increase_vnd").order("execution_date",{ascending:false}).order("sequence_within_date",{ascending:false});if(error)throw error;return data;}
export async function getPoolSnapshot(){const db=serverClient();const [{data:ledger,error:ledgerError},{data:opening,error:openingError},{data:recon,error:reconError},{data:accountCutoff,error:accountCutoffError},{data:topupCutoff,error:topupCutoffError},{data:payoutCutoff,error:payoutCutoffError}]=await Promise.all([
  db.from("pool_ledger_entries").select("event_time,event_date,event_type,source_type,gross_signed_amount_vnd,gross_balance_after_vnd,reserve_balance_after_vnd,settleable_signed_amount_vnd,settleable_balance_after_vnd,data_confidence,notes").eq("record_status","ACTIVE").order("event_date",{ascending:false}).order("event_time",{ascending:false,nullsFirst:false}).limit(50),
  db.from("opening_balances").select("gross_opening_balance_vnd,reserve_ratio,reserve_opening_balance_vnd,settleable_ratio,settleable_opening_balance_vnd,effective_at,approval_status,model_version").eq("currency","VND").eq("approval_status","APPROVED").limit(1).maybeSingle(),
  db.from("reconciliation_runs").select("*").eq("record_status","ACTIVE").order("started_at",{ascending:false}).limit(1).maybeSingle(),
  db.from("account_history_entries").select("source_local_time,source_timezone,transaction_time").order("transaction_time",{ascending:false}).order("source_row_number",{ascending:true}).limit(1).maybeSingle(),
  db.from("topup_batches").select("execution_date").order("execution_date",{ascending:false}).limit(1).maybeSingle(),
  db.from("payout_orders").select("completed_at").not("completed_at","is",null).order("completed_at",{ascending:false}).limit(1).maybeSingle()
]);if(ledgerError)throw ledgerError;if(openingError)throw openingError;if(reconError)throw reconError;if(accountCutoffError)throw accountCutoffError;if(topupCutoffError)throw topupCutoffError;if(payoutCutoffError)throw payoutCutoffError;return {ledger,opening,recon,dataCutoffs:{accountHistoryLocal:accountCutoff?.source_local_time??null,accountHistoryTimezone:accountCutoff?.source_timezone??null,accountHistoryUtc:accountCutoff?.transaction_time??null,topupDate:topupCutoff?.execution_date??null,payoutUtc:payoutCutoff?.completed_at??null}};}
export async function getQualitySnapshot(){const db=serverClient();const [{count:feeMismatch,error:a},{count:balanceMismatch,error:b},{count:continuityMismatch,error:c},{count:unmatched,error:d},{count:auditCount,error:e}]=await Promise.all([db.from("payin_orders").select("id",{count:"exact",head:true}).eq("currency","VND").eq("fee_validation_status","MISMATCH"),db.from("account_history_entries").select("id",{count:"exact",head:true}).eq("balance_validation_status","MISMATCH"),db.from("account_history_entries").select("id",{count:"exact",head:true}).eq("continuity_status","MISMATCH"),db.from("account_history_entries").select("id",{count:"exact",head:true}).eq("transfer_pair_status","UNMATCHED"),db.from("audit_logs").select("id",{count:"exact",head:true})]);if(a||b||c||d||e)throw a??b??c??d??e;return {feeMismatch:feeMismatch??0,balanceMismatch:balanceMismatch??0,continuityMismatch:continuityMismatch??0,unmatched:unmatched??0,auditCount:auditCount??0};}

export async function getShadowPricingData(){const db=serverClient();const [{data:buckets,error:a},{data:orders,error:b},{data:rate,error:c}]=await Promise.all([
 db.from("pool_buckets").select("id,source_type,gross_available_amount_vnd,settleable_available_amount_vnd,settleable_ratio,funding_rate_vnd_per_usdt,cost_basis_status").eq("status","OPEN").gt("settleable_available_amount_vnd",0).order("source_type"),
 db.from("payout_orders").select("merchant,channel").limit(30000),
 db.from("rate_snapshots").select("rate_vnd_per_usdt,rate_date,time_precision,source,confidence").eq("approval_status","APPROVED").order("rate_date",{ascending:false}).limit(1).maybeSingle()
]);if(a||b||c)throw a??b??c;const total=(buckets??[]).reduce((sum,row)=>sum+Number(row.settleable_available_amount_vnd??0),0);return {sources:(buckets??[]).map(row=>({...row,allocationRatio:total?Number(row.settleable_available_amount_vnd)/total:0})),merchants:[...new Set((orders??[]).map(row=>row.merchant).filter(Boolean))].sort(),channels:[...new Set((orders??[]).map(row=>row.channel).filter(Boolean))].sort(),replacementRate:rate,dataCompletenessStatus:"PARTIAL_AFTER_ACCOUNT_HISTORY_CUTOFF" as const};}

export async function getPortfolioData(){const db=serverClient();const {data:run,error:runError}=await db.from("shadow_pricing_runs").select("id,run_version,created_at,data_cutoff_snapshot,status").eq("run_type","HISTORICAL_BACKTEST").order("created_at",{ascending:false}).limit(1).maybeSingle();if(runError)throw runError;if(!run)return {run:null,summaries:[],calculations:[],sources:[],fees:[]};const [{data:summaries,error:a},{data:calculations,error:b},{data:sources,error:c},{data:fees,error:d}]=await Promise.all([
 db.from("daily_portfolio_summaries").select("*").eq("pricing_run_id",run.id).order("summary_date"),
 db.from("payout_profit_calculations").select("id,payout_order_id,economic_profit_usdt,economic_profit_margin,profit_verification_status,data_completeness_status,current_manual_as_rate,minimum_margin_quote,target_margin_quote,created_at").eq("pricing_run_id",run.id).order("economic_profit_margin").limit(30),
 db.from("pool_buckets").select("id,source_type,gross_available_amount_vnd,settleable_available_amount_vnd,funding_rate_vnd_per_usdt,cost_basis_status").eq("status","OPEN").order("source_type"),
 db.from("account_history_entries").select("payout_principal_vnd,payout_fee_vnd").eq("event_type","PAYOUT_OUTFLOW")
]);if(a||b||c||d)throw a??b??c??d;return {run,summaries:summaries??[],calculations:calculations??[],sources:sources??[],fees:fees??[]};}

export async function getPayoutPricing(calculationId:string){const db=serverClient();const {data:calculation,error:a}=await db.from("payout_profit_calculations").select("*").eq("id",calculationId).maybeSingle();if(a)throw a;if(!calculation)return null;const [{data:order,error:b},{data:match,error:c},{data:allocations,error:d}]=await Promise.all([
 db.from("payout_orders").select("id,order_number,merchant,channel,received_usdt,payout_amount_vnd,total_fee_usdt,status,completed_at").eq("id",calculation.payout_order_id).single(),
 db.from("payout_account_history_matches").select("match_method,match_confidence,review_status,evidence").eq("payout_order_id",calculation.payout_order_id).maybeSingle(),
 db.from("payout_pool_allocations").select("id,pool_bucket_id,source_type,allocation_ratio,allocated_gross_outflow_vnd,allocated_settleable_impact_vnd,economic_rate_vnd_per_usdt,cost_method,external_cash_cost_usdt,economic_cost_usdt,internal_netting_advantage_usdt,cost_confidence,allocation_status").eq("pricing_run_id",calculation.pricing_run_id).eq("payout_order_id",calculation.payout_order_id).order("source_type")
]);if(b||c||d)throw b??c??d;return {calculation,order,match,allocations:allocations??[]};}
