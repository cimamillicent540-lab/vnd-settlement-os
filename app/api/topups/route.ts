import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

const payload=z.object({executionDate:z.iso.date(),usdt:z.string().regex(/^\d+(\.\d{1,8})?$/),vnd:z.string().regex(/^\d+$/),channel:z.string().max(120).optional(),precision:z.enum(["DATE_ONLY","EXACT"]),executedAt:z.iso.datetime().nullable().optional()}).refine(value=>(value.precision==="DATE_ONLY"&&!value.executedAt)||(value.precision==="EXACT"&&Boolean(value.executedAt)),"时间精度与执行时间不一致");
export async function POST(request:Request){
 const parsed=payload.safeParse(await request.json());if(!parsed.success)return NextResponse.json({message:"补U字段校验失败",details:parsed.error.flatten()},{status:400});
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL;const key=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;const authorization=request.headers.get("authorization");if(!url||!key)return NextResponse.json({message:"Supabase 环境变量未配置。"},{status:503});if(!authorization)return NextResponse.json({message:"需要已认证的内部账号。"},{status:401});
 const supabase=createClient(url,key,{auth:{persistSession:false},global:{headers:{Authorization:authorization}}});const {data:{user}}=await supabase.auth.getUser();if(!user)return NextResponse.json({message:"登录已失效，请重新认证。"},{status:401});
 const input=parsed.data;const {count}=await supabase.from("topup_batches").select("id",{count:"exact",head:true}).eq("execution_date",input.executionDate);const sequence=(count??0)+1;
 const {data,error}=await supabase.from("topup_batches").insert({execution_date:input.executionDate,executed_at:input.executedAt??null,time_precision:input.precision,sequence_within_date:sequence,channel:input.channel||null,usdt_spent:input.usdt,gross_vnd_received:input.vnd,remaining_vnd:input.vnd,source:"MANUAL",status:"PENDING",created_by:user.id}).select("id,sequence_within_date,calculated_rate").single();
 if(error)return NextResponse.json({message:error.message},{status:500});return NextResponse.json({ok:true,data});
}
