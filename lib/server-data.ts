import {createClient} from "@supabase/supabase-js";
import {normalizeSupabaseUrl} from "./supabase-url";

function serverClient(){
  const configured=process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret=process.env.SUPABASE_SECRET_KEY??process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!configured||!secret)throw new Error("Supabase server configuration is missing");
  const url=normalizeSupabaseUrl(configured);
  if(!url)throw new Error("Supabase URL is invalid");
  return createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
}
export async function getImportBatches(){const {data,error}=await serverClient().from("import_batches").select("id,source_type,original_file_name,imported_at,total_rows,valid_rows,invalid_rows,duplicate_rows,status").order("imported_at",{ascending:false});if(error)throw error;return data;}
export async function getTopups(){const {data,error}=await serverClient().from("topup_batches").select("id,execution_date,sequence_within_date,channel,usdt_spent,gross_vnd_received,remaining_vnd,calculated_rate,time_precision,status,account_history_match_status,gross_ledger_treatment,settleable_increase_vnd").order("execution_date",{ascending:false}).order("sequence_within_date",{ascending:false});if(error)throw error;return data;}
export async function getPoolSnapshot(){const db=serverClient();const [{data:ledger,error:ledgerError},{data:opening,error:openingError},{data:recon,error:reconError}]=await Promise.all([
  db.from("pool_ledger_entries").select("event_time,event_date,event_type,source_type,gross_signed_amount_vnd,gross_balance_after_vnd,reserve_balance_after_vnd,settleable_signed_amount_vnd,settleable_balance_after_vnd,data_confidence,notes").eq("record_status","ACTIVE").order("event_date",{ascending:false}).order("event_time",{ascending:false,nullsFirst:false}).limit(50),
  db.from("opening_balances").select("gross_opening_balance_vnd,reserve_ratio,reserve_opening_balance_vnd,settleable_ratio,settleable_opening_balance_vnd,effective_at,approval_status,model_version").eq("currency","VND").eq("approval_status","APPROVED").limit(1).maybeSingle(),
  db.from("reconciliation_runs").select("*").eq("record_status","ACTIVE").order("started_at",{ascending:false}).limit(1).maybeSingle()
]);if(ledgerError)throw ledgerError;if(openingError)throw openingError;if(reconError)throw reconError;return {ledger,opening,recon};}
export async function getQualitySnapshot(){const db=serverClient();const [{count:feeMismatch,error:a},{count:balanceMismatch,error:b},{count:continuityMismatch,error:c},{count:unmatched,error:d},{count:auditCount,error:e}]=await Promise.all([db.from("payin_orders").select("id",{count:"exact",head:true}).eq("currency","VND").eq("fee_validation_status","MISMATCH"),db.from("account_history_entries").select("id",{count:"exact",head:true}).eq("balance_validation_status","MISMATCH"),db.from("account_history_entries").select("id",{count:"exact",head:true}).eq("continuity_status","MISMATCH"),db.from("account_history_entries").select("id",{count:"exact",head:true}).eq("transfer_pair_status","UNMATCHED"),db.from("audit_logs").select("id",{count:"exact",head:true})]);if(a||b||c||d||e)throw a??b??c??d??e;return {feeMismatch:feeMismatch??0,balanceMismatch:balanceMismatch??0,continuityMismatch:continuityMismatch??0,unmatched:unmatched??0,auditCount:auditCount??0};}
