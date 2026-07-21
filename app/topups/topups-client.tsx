"use client";
import { useMemo, useState } from "react";
import Decimal from "decimal.js";
import { CalendarClock, CircleDollarSign, Download, Info, Landmark, Plus, Search, TrendingUp, WalletCards } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { KpiCard, PageHeading, Pagination } from "@/components/page-parts";
import { topups as seedTopups } from "@/lib/demo-data";
import { summarizeTopups } from "@/lib/domain";
import { authorizedFetch } from "@/lib/authorized-fetch";
import { formatRate, formatUsdt, formatVnd } from "@/lib/utils";

type TopupRow={id:string;executionDate:string;sequence:number;usdt:string;grossVnd:string;remainingVnd:string;rate:string;precision:string;channel:string;status:string};

export function TopupsClient(){
  const [rows,setRows]=useState<TopupRow[]>([...seedTopups]);
  const [showForm,setShowForm]=useState(false);
  const [error,setError]=useState("");
  const [saving,setSaving]=useState(false);
  const totals=useMemo(()=>{
    const summary=summarizeTopups(rows.map(row=>({usdtSpent:row.usdt,netVndReceived:row.grossVnd})));
    return {...summary,remaining:rows.reduce((sum,row)=>sum.plus(row.remainingVnd),new Decimal(0)).toFixed(0)};
  },[rows]);

  async function submit(formData:FormData){
    const usdt=String(formData.get("usdt")||""); const vnd=String(formData.get("vnd")||""); const date=String(formData.get("date")||""); const precision=String(formData.get("precision")||"DATE_ONLY"); const exactTime=String(formData.get("executed_at")||"");
    if(!/^\d+$/.test(vnd)||!/^\d+(\.\d{1,8})?$/.test(usdt)||!date){setError("请填写有效日期、USDT 数量和整数 VND 到账金额。");return;}
    setSaving(true);setError("");
    try{
      const response=await authorizedFetch("/api/topups",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({executionDate:date,usdt,vnd,channel:String(formData.get("channel")||""),precision,executedAt:precision==="EXACT"&&exactTime?new Date(exactTime).toISOString():null})});
      const body=await response.json() as {message?:string;data?:{id:string;sequence_within_date:number;calculated_rate:string}};
      if(!response.ok||!body.data)throw new Error(body.message||"保存失败");
      setRows(current=>[{id:body.data!.id,executionDate:date,sequence:body.data!.sequence_within_date,usdt,grossVnd:vnd,remainingVnd:vnd,rate:body.data!.calculated_rate,precision,channel:String(formData.get("channel")||"Manual"),status:"PENDING"},...current]);
      setShowForm(false);
    }catch(cause){setError(cause instanceof Error?cause.message:"保存失败");}finally{setSaving(false);}
  }

  return <>
    <PageHeading title="补U批次" subtitle="USDT 资金成本、VND 到账与剩余本金的可追溯批次管理" actions={<><Button><Download size={13}/>导出明细</Button><Button variant="default" onClick={()=>setShowForm(!showForm)}><Plus size={14}/>新增补U</Button></>}/>
    <div className="kpi-grid"><KpiCard label="累计 USDT 成本" value={formatUsdt(totals.totalUsdt)} note={<><span className="trend-up">3 个批次</span><span>· 已审批</span></>} icon={CircleDollarSign}/><KpiCard label="累计 VND 到账" value={formatVnd(totals.totalVnd)} note={<span>净到账金额 · 无额外费用</span>} icon={Landmark} color="#0f9f78"/><KpiCard label="加权平均执行汇率" value={formatRate(totals.weightedAverageRate,10)} note={<span>VND / USDT · 高精度核算</span>} icon={TrendingUp} color="#6f4bb7"/><KpiCard label="补U桶剩余 VND" value={formatVnd(totals.remaining)} note={<><span className="trend-down">46.0%</span><span>批次本金剩余</span></>} icon={WalletCards} color="#dc8b16"/></div>
    <div className="alert alert-warning" style={{marginBottom:16}}><CalendarClock size={16}/><div><strong>执行时间仅精确到日期</strong>现有 3 笔真实记录没有小时和分钟，系统保留 DATE_ONLY 与日内序号，可用于每日资金池分析，不用于分钟级回测。</div></div>
    {showForm&&<Card style={{marginBottom:16}}><CardHeader><div><h2 className="panel-title">新增补U记录</h2><div className="panel-subtitle">人工录入后进入待审批状态，不触发任何资金操作</div></div><Badge variant="amber">待人工提交</Badge></CardHeader><CardContent><form action={submit} style={{display:"grid",gridTemplateColumns:"repeat(3,minmax(180px,1fr))",gap:10,alignItems:"end"}}><label className="metric-label">执行日期<input className="mapping-cell" style={{width:"100%",marginTop:6}} name="date" type="date" required/></label><label className="metric-label">USDT 数量<input className="mapping-cell" style={{width:"100%",marginTop:6}} name="usdt" inputMode="decimal" placeholder="150000" required/></label><label className="metric-label">VND 净到账<input className="mapping-cell" style={{width:"100%",marginTop:6}} name="vnd" inputMode="numeric" placeholder="3938250000" required/></label><label className="metric-label">通道<input className="mapping-cell" style={{width:"100%",marginTop:6}} name="channel" placeholder="OTC Desk"/></label><label className="metric-label">时间精度<select className="mapping-cell" style={{width:"100%",marginTop:6}} name="precision"><option>DATE_ONLY</option><option>EXACT</option></select></label><label className="metric-label">精确执行时间（EXACT 时必填）<input className="mapping-cell" style={{width:"100%",marginTop:6}} name="executed_at" type="datetime-local"/></label><div className="actions" style={{gridColumn:"1 / -1",justifyContent:"flex-end"}}><Button type="button" onClick={()=>setShowForm(false)}>取消</Button><Button variant="default" type="submit" disabled={saving}>{saving?"保存中…":"提交记录"}</Button></div></form>{error&&<div className="alert alert-danger" style={{marginTop:12}}>{error}</div>}</CardContent></Card>}
    <Card><CardHeader><div><h2 className="panel-title">补U批次台账</h2><div className="panel-subtitle">effective rate = net VND received ÷ total USDT cost</div></div><Badge variant="blue">UTC</Badge></CardHeader><div className="toolbar"><div className="search"><Search size={14}/><input placeholder="搜索批次、通道…"/></div><select className="select"><option>全部审批状态</option><option>已审批</option><option>待审批</option></select><select className="select"><option>全部时间精度</option><option>DATE_ONLY</option><option>EXACT</option></select></div><div className="table-wrap"><table><thead><tr><th>批次 ID</th><th>执行日期</th><th>日内序号</th><th>通道</th><th style={{textAlign:"right"}}>USDT 成本</th><th style={{textAlign:"right"}}>VND 净到账</th><th style={{textAlign:"right"}}>有效汇率</th><th style={{textAlign:"right"}}>剩余 VND</th><th>时间精度</th><th>状态</th></tr></thead><tbody>{rows.map(row=><tr key={row.id}><td className="mono">{row.id}</td><td>{row.executionDate}</td><td>#{row.sequence}</td><td>{row.channel}</td><td className="money">{formatUsdt(row.usdt)}</td><td className="money">{formatVnd(row.grossVnd)}</td><td className="money">{formatRate(row.rate,new Decimal(row.rate).isInteger()?0:8)}</td><td className="money">{formatVnd(row.remainingVnd)}</td><td><Badge variant="amber">{row.precision}</Badge></td><td><Badge variant={row.status==="APPROVED"?"green":"amber"}>{row.status==="APPROVED"?"已审批":"待审批"}</Badge></td></tr>)}</tbody></table></div><Pagination total={rows.length} label="个批次"/></Card>
    <div className="alert alert-info" style={{marginTop:16}}><Info size={15}/><div><strong>Shadow Mode 边界</strong>新增与修改仅记录人工事实和审批状态；系统不会购买 USDT、发起补U或调用外部交易接口。</div></div>
  </>;
}
