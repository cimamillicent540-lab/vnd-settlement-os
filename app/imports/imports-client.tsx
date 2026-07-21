"use client";
import { useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { ArrowRight, CheckCircle2, FileSpreadsheet, Filter, RefreshCw, Search, ShieldCheck, UploadCloud, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { PageHeading, Pagination } from "@/components/page-parts";
import { importBatches } from "@/lib/demo-data";
import { autoMapHeaders, type FieldMap, type ImportSourceType, validateRows, type ValidatedRow } from "@/lib/import-pipeline";
import { cn } from "@/lib/utils";
import { authorizedFetch } from "@/lib/authorized-fetch";

const targetLabels:Record<string,string> = { order_number:"订单号",merchant_order_number:"商户订单号",merchant_code:"商户编码",merchant_name:"商户名称",channel_code:"通道编码",channel_name:"通道名称",payin_amount_vnd:"Payin金额(VND)",target_amount_vnd:"目标/实际到账(VND)",imported_transaction_fee_vnd:"导入手续费(VND)",status:"状态",created_at:"创建时间",completed_at:"完成时间",merchant:"商户",channel:"通道",received_usdt:"收到USDT",payout_amount_vnd:"Payout金额(VND)",ar_rate:"AR汇率",as_rate:"AS汇率",ap_imported:"AP导入值",aq_imported:"AQ导入值",at_gross_income:"AT毛收入" };

export function ImportsClient(){
  const [sourceType,setSourceType]=useState<ImportSourceType>("PAYIN");
  const [dragging,setDragging]=useState(false);
  const [file,setFile]=useState<File|null>(null);
  const [rows,setRows]=useState<Record<string,unknown>[]>([]);
  const [mapping,setMapping]=useState<FieldMap>({});
  const [validated,setValidated]=useState<ValidatedRow[]>([]);
  const [phase,setPhase]=useState<"UPLOAD"|"MAPPING"|"VALIDATION"|"SAVED">("UPLOAD");
  const [saving,setSaving]=useState(false);
  const [message,setMessage]=useState("");
  const inputRef=useRef<HTMLInputElement>(null);
  const stats=useMemo(()=>({valid:validated.filter(r=>r.status==="VALID").length,invalid:validated.filter(r=>r.status==="INVALID").length,duplicate:validated.filter(r=>r.status==="DUPLICATE").length}),[validated]);
  async function ingest(selected:File){
    setFile(selected);setMessage("");
    try { const buffer=await selected.arrayBuffer(); const workbook=XLSX.read(buffer,{type:"array",cellDates:true}); const sheet=workbook.Sheets[workbook.SheetNames[0]]; const parsed=XLSX.utils.sheet_to_json<Record<string,unknown>>(sheet,{defval:""}); const headers=parsed.length?Object.keys(parsed[0]):[]; setRows(parsed);setMapping(autoMapHeaders(headers,sourceType));setValidated([]);setPhase("MAPPING"); }
    catch { setMessage("文件无法解析，请确认格式和工作表内容后重试。"); }
  }
  function runValidation(){ const result=validateRows(rows,mapping,sourceType);setValidated(result);setPhase("VALIDATION"); }
  async function confirmImport(){
    if(!file)return;setSaving(true);setMessage("");
    try { const hashBuffer=await crypto.subtle.digest("SHA-256",await file.arrayBuffer()); const fileHash=[...new Uint8Array(hashBuffer)].map(b=>b.toString(16).padStart(2,"0")).join(""); const response=await authorizedFetch("/api/imports",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({sourceType,originalFileName:file.name,fileHash,mapping,totalRows:rows.length,invalidRows:stats.invalid,duplicateRows:stats.duplicate,rows:validated.filter(r=>r.status==="VALID"),rowErrors:validated.filter(r=>r.status!=="VALID")})}); const body=await response.json() as {ok?:boolean;message?:string}; if(!response.ok)throw new Error(body.message||"保存失败");setPhase("SAVED");setMessage(body.message||"批次已写入数据库"); }
    catch(error){setMessage(error instanceof Error?error.message:"保存失败");}finally{setSaving(false);}
  }
  const visibleHeaders=rows.length?Object.keys(rows[0]):[];
  return <>
    <PageHeading title="数据导入中心" subtitle="浏览器端解析 · 字段映射确认 · 逐行校验 · 敏感数据自动脱敏" actions={<><Button><RefreshCw size={13}/>刷新批次</Button><Button variant="default" onClick={()=>inputRef.current?.click()}><UploadCloud size={14}/>上传新文件</Button></>}/>
    <div className="alert alert-info" style={{marginBottom:16}}><ShieldCheck size={16}/><div><strong>隐私保护已启用</strong>姓名、姓氏等非必要字段不会进入导入载荷；银行卡号仅保留末四位，原始行快照和日志均不会保存完整卡号。</div></div>
    <div className="grid-2">
      <Card>
        <CardHeader><div><h2 className="panel-title">新建导入</h2><div className="panel-subtitle">支持 .xlsx、.xls、.csv · 单行错误不会阻断整个文件</div></div><div className="segmented"><button className={cn("segment",sourceType==="PAYIN"&&"active")} onClick={()=>{setSourceType("PAYIN");setPhase("UPLOAD")}}>Payin</button><button className={cn("segment",sourceType==="PAYOUT"&&"active")} onClick={()=>{setSourceType("PAYOUT");setPhase("UPLOAD")}}>Payout</button></div></CardHeader>
        <CardContent>
          <div className="progress-steps">{["上传文件","确认映射","数据校验","写入批次"].map((label,index)=>{const order={UPLOAD:0,MAPPING:1,VALIDATION:2,SAVED:3}[phase];return <div key={label} className={cn("progress-step",index<order&&"done",index===order&&"active")}>{label}</div>})}</div>
          {phase==="UPLOAD"&&<div className={cn("upload-zone",dragging&&"dragging")} onDragOver={e=>{e.preventDefault();setDragging(true)}} onDragLeave={()=>setDragging(false)} onDrop={e=>{e.preventDefault();setDragging(false);const f=e.dataTransfer.files[0];if(f)void ingest(f)}} onClick={()=>inputRef.current?.click()}><span className="upload-icon"><UploadCloud size={19}/></span><h3>拖放结算文件到这里，或点击选择</h3><p>最大 20 MB · 文件内容仅用于预览，确认后才写入</p></div>}
          <input ref={inputRef} className="file-input" type="file" accept=".xlsx,.xls,.csv" onChange={e=>{const f=e.target.files?.[0];if(f)void ingest(f)}}/>
          {phase==="MAPPING"&&<><div className="alert alert-info"><FileSpreadsheet size={15}/><div><strong>{file?.name}</strong>{rows.length} 行 · 已自动识别 {Object.keys(mapping).length}/{visibleHeaders.length} 个字段，请确认后校验。</div></div><div className="mapping-grid">{visibleHeaders.slice(0,8).map(header=><div key={header} style={{display:"contents"}}><div className="mapping-cell">{header}</div><div className="mapping-arrow"><ArrowRight size={13}/></div><select className="mapping-cell" value={mapping[header]||""} onChange={e=>setMapping(current=>({...current,[header]:e.target.value}))}><option value="">忽略此字段</option>{Object.entries(targetLabels).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></div>)}</div><div className="actions" style={{justifyContent:"flex-end",marginTop:15}}><Button onClick={()=>setPhase("UPLOAD")}>重新选择</Button><Button variant="default" onClick={runValidation}>确认映射并校验</Button></div></>}
          {(phase==="VALIDATION"||phase==="SAVED")&&<><div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10}}><div className="quality-card"><span className="quality-score" style={{color:"#087f5b",background:"#edf9f4"}}>{stats.valid}</span><div><div className="quality-title">有效记录</div><div className="quality-note">可安全写入批次</div></div></div><div className="quality-card"><span className="quality-score" style={{color:"#b82f3a",background:"#fff1f2"}}>{stats.invalid}</span><div><div className="quality-title">无效记录</div><div className="quality-note">将进入错误报告</div></div></div><div className="quality-card"><span className="quality-score" style={{color:"#a96506",background:"#fff7e9"}}>{stats.duplicate}</span><div><div className="quality-title">重复记录</div><div className="quality-note">不会再次写入</div></div></div></div><div className="table-wrap" style={{border:"1px solid #e5e9ef",borderRadius:7,marginTop:13,maxHeight:220}}><table><thead><tr><th>行号</th><th>校验</th><th>订单号</th><th>说明</th></tr></thead><tbody>{validated.slice(0,20).map(row=><tr key={row.rowNumber}><td>{row.rowNumber}</td><td><Badge variant={row.status==="VALID"?"green":row.status==="DUPLICATE"?"amber":"red"}>{row.status}</Badge></td><td className="mono">{String(row.data.order_number||"—")}</td><td className="muted">{row.errors.join("；")||"字段及关系校验通过"}</td></tr>)}</tbody></table></div><div className="actions" style={{justifyContent:"flex-end",marginTop:15}}><Button onClick={()=>setPhase("MAPPING")}>返回映射</Button>{phase!=="SAVED"&&<Button variant="default" disabled={saving||stats.valid===0} onClick={()=>void confirmImport()}>{saving?"正在写入…":"确认并写入有效记录"}</Button>}</div></>}
          {message&&<div className={cn("alert",phase==="SAVED"?"alert-info":"alert-danger")} style={{marginTop:12}}>{phase==="SAVED"?<CheckCircle2 size={15}/>:<XCircle size={15}/>}<div>{message}</div></div>}
        </CardContent>
      </Card>
      <Card><CardHeader><div><h2 className="panel-title">导入规则</h2><div className="panel-subtitle">当前生效 · UTC</div></div><Badge variant="green">7 项已启用</Badge></CardHeader><CardContent><div className="metric-list"><div className="metric-row"><span className="metric-label">Payin 手续费率</span><span className="metric-value">0.8000%</span></div><div className="metric-row"><span className="metric-label">成功上游费</span><span className="metric-value">2,500 ₫</span></div><div className="metric-row"><span className="metric-label">失败上游费</span><span className="metric-value">0 ₫ · 可配置</span></div><div className="metric-row"><span className="metric-label">AP 关系</span><span className="metric-value">AS / AR − 1</span></div><div className="metric-row"><span className="metric-label">AQ 组合模式</span><span className="metric-value" style={{color:"#a96506"}}>UNKNOWN</span></div><div className="metric-row"><span className="metric-label">允许文件格式</span><span className="metric-value">XLSX · XLS · CSV</span></div></div><div className="alert alert-warning" style={{marginTop:17}}><Filter size={15}/><div><strong>关系公式待确认</strong>AQ 仅保存为已包含项，诊断残差不进入正式利润或报价计算。</div></div></CardContent></Card>
    </div>
    <Card><CardHeader><div><h2 className="panel-title">导入批次</h2><div className="panel-subtitle">文件哈希与订单行哈希双重防重复</div></div><Badge variant="blue">最近 30 天</Badge></CardHeader><div className="toolbar"><div className="search"><Search size={14}/><input placeholder="搜索批次、文件名…"/></div><select className="select"><option>全部来源</option><option>PAYIN</option><option>PAYOUT</option></select><select className="select"><option>全部状态</option><option>待复核</option><option>已完成</option></select><span className="toolbar-spacer"/><Button><Filter size={13}/>更多筛选</Button></div><div className="table-wrap"><table><thead><tr><th>批次 ID</th><th>类型</th><th>原始文件</th><th>导入时间</th><th>总行数</th><th>有效</th><th>无效</th><th>重复</th><th>状态</th></tr></thead><tbody>{importBatches.map(batch=><tr key={batch.id}><td className="mono">{batch.id}</td><td><Badge variant={batch.type==="PAYIN"?"blue":"violet"}>{batch.type}</Badge></td><td>{batch.file}</td><td className="muted">{batch.at}</td><td>{batch.rows.toLocaleString()}</td><td style={{color:"#087f5b"}}>{batch.valid.toLocaleString()}</td><td style={{color:batch.invalid?"#b82f3a":undefined}}>{batch.invalid}</td><td style={{color:batch.duplicate?"#a96506":undefined}}>{batch.duplicate}</td><td><Badge variant={batch.status==="COMPLETED"?"green":"amber"}>{batch.status==="COMPLETED"?"已完成":"待复核"}</Badge></td></tr>)}</tbody></table></div><Pagination total={32}/></Card>
  </>;
}
