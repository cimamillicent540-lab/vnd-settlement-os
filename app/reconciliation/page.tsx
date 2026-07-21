import type {Metadata} from "next";
import {Landmark,Scale,WalletCards} from "lucide-react";
import {Badge} from "@/components/ui/badge";
import {Card,CardContent,CardHeader} from "@/components/ui/card";
import {KpiCard,PageHeading} from "@/components/page-parts";
import {getPoolSnapshot} from "@/lib/server-data";
import {formatVnd} from "@/lib/utils";
export const metadata:Metadata={title:"真实数据对账"};
export default async function ReconciliationPage(){const {recon,opening}=await getPoolSnapshot();return <>
 <PageHeading title="真实数据对账" subtitle="Gross 原始账户层与 Settleable 50% 派生层分别核对"/>
 <div className="kpi-grid">
  <KpiCard label="Gross 正确期初" value={formatVnd(opening?.gross_opening_balance_vnd??0)} note={<span>08:00 交易发生前</span>} icon={Landmark}/>
  <KpiCard label="Settleable 正确期初" value={formatVnd(opening?.settleable_opening_balance_vnd??0)} note={<span>Gross × 50%</span>} icon={WalletCards}/>
  <KpiCard label="Gross 源期末" value={formatVnd(recon?.gross_source_ending_vnd??0)} note={<span>Account History 最后一笔余额</span>} icon={Landmark}/>
  <KpiCard label="Settleable 源期末" value={formatVnd(recon?.settleable_source_ending_vnd??0)} note={<span>Gross ending × 50%</span>} icon={WalletCards}/>
 </div>
 <div className="grid-2">
  <Card><CardHeader><div><h2 className="panel-title">Gross 层</h2><div className="panel-subtitle">原始账户金额，不做乘2或除2覆盖</div></div><Badge variant="amber">{recon?.status??"INCOMPLETE"}</Badge></CardHeader><CardContent><div className="metric-list"><div className="metric-row"><span className="metric-label">Gross opening</span><span className="metric-value">{formatVnd(recon?.gross_opening_balance_vnd??0)}</span></div><div className="metric-row"><span className="metric-label">Gross Payin</span><span className="metric-value">{formatVnd(recon?.gross_payin_vnd??0)}</span></div><div className="metric-row"><span className="metric-label">Gross Topup（期间内）</span><span className="metric-value">{formatVnd(recon?.gross_topup_vnd??0)}</span></div><div className="metric-row"><span className="metric-label">Gross Payout</span><span className="metric-value">{formatVnd(recon?.gross_payout_vnd??0)}</span></div><div className="metric-row"><span className="metric-label">Gross Adjustment</span><span className="metric-value">{formatVnd(recon?.gross_adjustment_vnd??0)}</span></div><div className="metric-row"><span className="metric-label">重建期末</span><span className="metric-value">{formatVnd(recon?.gross_reconstructed_ending_vnd??0)}</span></div><div className="metric-row"><span className="metric-label">对账差异</span><span className="metric-value">{formatVnd(recon?.gross_difference_vnd??0)}</span></div></div></CardContent></Card>
  <Card><CardHeader><div><h2 className="panel-title">Settleable 层</h2><div className="panel-subtitle">每项变化和余额均按 50% 派生</div></div><Badge variant="green">50%</Badge></CardHeader><CardContent><div className="metric-list"><div className="metric-row"><span className="metric-label">Settleable opening</span><span className="metric-value">{formatVnd(recon?.settleable_opening_balance_vnd??0)}</span></div><div className="metric-row"><span className="metric-label">Settleable Payin</span><span className="metric-value">{formatVnd(recon?.settleable_payin_vnd??0)}</span></div><div className="metric-row"><span className="metric-label">Settleable Topup（期间内）</span><span className="metric-value">{formatVnd(recon?.settleable_topup_vnd??0)}</span></div><div className="metric-row"><span className="metric-label">Settleable Payout</span><span className="metric-value">{formatVnd(recon?.settleable_payout_vnd??0)}</span></div><div className="metric-row"><span className="metric-label">重建期末</span><span className="metric-value">{formatVnd(recon?.settleable_reconstructed_ending_vnd??0)}</span></div><div className="metric-row"><span className="metric-label">源期末</span><span className="metric-value">{formatVnd(recon?.settleable_source_ending_vnd??0)}</span></div><div className="metric-row"><span className="metric-label">对账差异</span><span className="metric-value">{formatVnd(recon?.settleable_difference_vnd??0)}</span></div></div></CardContent></Card>
 </div>
 <Card style={{marginTop:16}}><CardHeader><div><h2 className="panel-title">补U匹配结论</h2><div className="panel-subtitle">日期、金额、订单/备注、账户变化四项证据</div></div><Scale size={16}/></CardHeader><CardContent><div className="alert alert-info">{recon?.topup_match_conclusion??"尚未完成匹配"}</div></CardContent></Card>
 </>}
