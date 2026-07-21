import type { Metadata } from "next";
import { TopupsClient } from "./topups-client";
import {getTopups} from "@/lib/server-data";
export const metadata:Metadata={title:"补U批次"};
export default async function TopupsPage(){const rows=await getTopups();return <TopupsClient initialRows={rows.map(row=>({id:row.id,executionDate:row.execution_date,sequence:row.sequence_within_date,usdt:String(row.usdt_spent),grossVnd:String(row.gross_vnd_received),remainingVnd:String(row.remaining_vnd),rate:String(row.calculated_rate),precision:row.time_precision,channel:row.channel??"—",status:row.status,matchStatus:row.account_history_match_status??"PENDING_REVIEW",ledgerTreatment:row.gross_ledger_treatment??"PENDING_REVIEW",settleableIncreaseVnd:String(row.settleable_increase_vnd??0)}))}/>;}
