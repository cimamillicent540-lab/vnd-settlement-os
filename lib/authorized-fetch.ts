"use client";
import { createClient } from "@supabase/supabase-js";
import {normalizeSupabaseUrl} from "./supabase-url";

export async function authorizedFetch(input:RequestInfo|URL,init:RequestInit={}){
  const url=normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const publishable=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY??process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if(!url||!publishable)throw new Error("预览模式：请配置 Supabase 环境变量后执行写入。当前数据未保存。");
  const supabase=createClient(url,publishable);
  const {data}=await supabase.auth.getSession();
  if(!data.session)throw new Error("需要已认证的内部账号才能执行该操作。");
  const headers=new Headers(init.headers);headers.set("authorization",`Bearer ${data.session.access_token}`);
  return fetch(input,{...init,headers});
}
