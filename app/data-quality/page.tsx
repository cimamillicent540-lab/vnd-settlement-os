import type {Metadata} from "next";
import {CheckCircle2,ShieldAlert} from "lucide-react";
import {Badge} from "@/components/ui/badge";
import {Card,CardContent,CardHeader} from "@/components/ui/card";
import {PageHeading} from "@/components/page-parts";
import {getQualitySnapshot} from "@/lib/server-data";
export const metadata:Metadata={title:"数据质量与审计"};
export default async function DataQualityPage(){const q=await getQualitySnapshot();const issues=[{name:"VND Payin 手续费差异",count:q.feeMismatch},{name:"账户行余额差异（1 VND 容差）",count:q.balanceMismatch},{name:"相邻余额不连续",count:q.continuityMismatch},{name:"未配对内部结算",count:q.unmatched}];return <>
 <PageHeading title="数据质量与审计" subtitle="真实导入、账户余额连续性与内部结算配对结果"/>
 <div className="quality-grid">{issues.map(item=><div className="quality-card" key={item.name}><span className="quality-score" style={{color:item.count?"#b82f3a":"#087f5b",background:item.count?"#fff0f1":"#ecf9f4"}}>{item.count}</span><div><div className="quality-title">{item.name}</div><div className="quality-note">{item.count?"需要人工复核":"校验通过"}</div></div></div>)}</div>
 <Card><CardHeader><div><h2 className="panel-title">审计状态</h2><div className="panel-subtitle">数据库 mutation trigger 记录</div></div><Badge variant="green">已启用</Badge></CardHeader><CardContent><div className="alert alert-info"><CheckCircle2 size={16}/><div><strong>{q.auditCount.toLocaleString()} 条审计日志</strong>导入批次、规则、补U、资金桶、期初余额和对账运行均受审计触发器覆盖。</div></div><div className="alert alert-warning" style={{marginTop:12}}><ShieldAlert size={16}/><div><strong>成本状态边界</strong>Payin 为 INTERNAL_NETTING / NOT_APPLICABLE，不再显示为缺少 USDT 成本；周期净结算保留在独立 NET_SETTLEMENT 层。</div></div></CardContent></Card>
 </>}
