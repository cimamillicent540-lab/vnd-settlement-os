import type { Metadata } from "next";
import { ImportsClient } from "./imports-client";
import {getImportBatches} from "@/lib/server-data";
export const metadata:Metadata = { title:"数据导入中心" };
export default async function ImportsPage(){ const rows=await getImportBatches();return <ImportsClient initialBatches={rows.map(row=>({id:row.id,type:row.source_type,file:row.original_file_name,rows:row.total_rows,valid:row.valid_rows,invalid:row.invalid_rows,duplicate:row.duplicate_rows,status:row.status,at:new Date(row.imported_at).toISOString().replace("T"," ").slice(0,19)+" UTC"}))}/>; }
