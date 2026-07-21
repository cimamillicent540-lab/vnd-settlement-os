import type {Metadata} from "next";
import {DatabaseZap,Info,Scale,WalletCards} from "lucide-react";
import {Badge} from "@/components/ui/badge";
import {Card,CardHeader} from "@/components/ui/card";
import {KpiCard,PageHeading,Pagination} from "@/components/page-parts";
import {getPoolSnapshot} from "@/lib/server-data";
import {formatVnd} from "@/lib/utils";
export const metadata:Metadata={title:"VND 资金池"};
export default async function PoolPage(){const {ledger,opening,recon}=await getPoolSnapshot();const latest=ledger[0];return <>
 <PageHeading title="VND 资金池" subtitle="Account History 正序重建 · Shadow Mode 真实数据快照"/>
 <div className="kpi-grid"><KpiCard label="账本最新余额" value={formatVnd(latest?.balance_after_vnd??0)} note={<span>含已确认补U流水</span>} icon={WalletCards}/><KpiCard label="正式期初余额" value={formatVnd(opening?.opening_balance_vnd??0)} note={<span>{opening?.effective_at??"—"}</span>} icon={Scale}/><KpiCard label="账户历史对账差异" value={formatVnd(recon?.difference_vnd??0)} note={<Badge variant={recon?.status==="BALANCED"?"green":"red"}>{recon?.status??"未运行"}</Badge>} icon={DatabaseZap}/><KpiCard label="来源倍率" value={`${opening?.multiplier??"—"}×`} note={<span>业务确认总余额倍率</span>} icon={Info}/></div>
 <div className="alert alert-info" style={{marginBottom:16}}><Info size={15}/><div><strong>Payin 内部净额规则</strong>资金池流入来自 Account History 的变动金额；0.8% 收入与 2,500 VND 上游费单独记录，逐笔 external_usdt_spent 为 0，成本状态为 NOT_APPLICABLE。</div></div>
 <Card><CardHeader><div><h2 className="panel-title">最近资金池流水</h2><div className="panel-subtitle">交易时间正序重建后，以最新事件倒序展示 · VND 保留两位小数</div></div><Badge variant="blue">真实数据</Badge></CardHeader><div className="table-wrap"><table><thead><tr><th>事件时间</th><th>事件类型</th><th>来源</th><th style={{textAlign:"right"}}>变动金额</th><th style={{textAlign:"right"}}>变动后余额</th><th>可信度</th></tr></thead><tbody>{ledger.map((row,index)=><tr key={`${row.event_time}-${index}`}><td>{row.event_time??`${row.event_date} · DATE_ONLY`}</td><td><Badge variant={String(row.signed_amount_vnd).startsWith("-")?"amber":"green"}>{row.event_type}</Badge></td><td>{row.source_type??"—"}</td><td className="money">{formatVnd(row.signed_amount_vnd)}</td><td className="money">{formatVnd(row.balance_after_vnd)}</td><td><Badge variant="green">{row.data_confidence}</Badge></td></tr>)}</tbody></table></div><Pagination total={ledger.length}/></Card>
 </>}
