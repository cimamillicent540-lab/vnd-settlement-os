import type {Metadata} from "next";
import {CheckCircle2,Scale} from "lucide-react";
import {Badge} from "@/components/ui/badge";
import {Card,CardContent,CardHeader} from "@/components/ui/card";
import {KpiCard,PageHeading} from "@/components/page-parts";
import {getPoolSnapshot} from "@/lib/server-data";
import {formatVnd} from "@/lib/utils";
export const metadata:Metadata={title:"真实数据对账"};
export default async function ReconciliationPage(){const {recon,opening}=await getPoolSnapshot();return <>
 <PageHeading title="真实数据对账" subtitle="正式期初余额 + Account History 正序事件 × 业务倍率"/>
 <div className="kpi-grid"><KpiCard label="正式期初" value={formatVnd(opening?.opening_balance_vnd??0)} note={<span>2026-07-17 00:00:00Z</span>} icon={Scale}/><KpiCard label="重建余额" value={formatVnd(recon?.reconstructed_balance_vnd??0)} note={<span>截至账户流水最后时点</span>} icon={Scale}/><KpiCard label="源账户余额 ×2" value={formatVnd(recon?.source_closing_balance_vnd??0)} note={<span>账户流水显示余额按 2 倍还原</span>} icon={Scale}/><KpiCard label="差异" value={formatVnd(recon?.difference_vnd??0)} note={<Badge variant={recon?.status==="BALANCED"?"green":"red"}>{recon?.status??"未运行"}</Badge>} icon={CheckCircle2}/></div>
 <Card><CardHeader><div><h2 className="panel-title">对账结论</h2><div className="panel-subtitle">允许 1.00 VND 的源余额显示舍入误差</div></div><Badge variant={recon?.status==="BALANCED"?"green":"red"}>{recon?.status??"INCOMPLETE"}</Badge></CardHeader><CardContent><div className="metric-list"><div className="metric-row"><span className="metric-label">Account History 流入</span><span className="metric-value">{formatVnd(recon?.total_inflow_vnd??0)}</span></div><div className="metric-row"><span className="metric-label">Account History 流出</span><span className="metric-value">{formatVnd(recon?.total_outflow_vnd??0)}</span></div><div className="metric-row"><span className="metric-label">期初审批状态</span><Badge variant="green">{opening?.approval_status??"—"}</Badge></div><div className="metric-row"><span className="metric-label">08:00 Payin 防重复</span><Badge variant="green">已按期初前余额处理</Badge></div></div></CardContent></Card>
 </>}
