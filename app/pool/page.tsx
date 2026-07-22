import type {Metadata} from "next";
import {Info,Landmark,LockKeyhole,Percent,WalletCards} from "lucide-react";
import {Badge} from "@/components/ui/badge";
import {Card,CardHeader} from "@/components/ui/card";
import {KpiCard,PageHeading,Pagination} from "@/components/page-parts";
import {assessDataCompleteness} from "@/lib/domain";
import {getPoolSnapshot} from "@/lib/server-data";
import {formatVnd} from "@/lib/utils";
export const metadata:Metadata={title:"VND 资金池"};
export default async function PoolPage(){const {ledger,opening,dataCutoffs}=await getPoolSnapshot();const latest=ledger[0];const completeness=assessDataCompleteness(dataCutoffs.accountHistoryLocal,dataCutoffs.topupDate,dataCutoffs.payoutUtc);return <>
 <PageHeading title="VND 资金池" subtitle="Gross 上游账面层与 50% Settleable 可结算层 · Shadow Mode"/>
 <div className="kpi-grid">
  <KpiCard label="上游账面余额" value={formatVnd(latest?.gross_balance_after_vnd??0)} note={<span>Gross account balance</span>} icon={Landmark}/>
  <KpiCard label="保证金锁定金额" value={formatVnd(latest?.reserve_balance_after_vnd??0)} note={<span>上游保留 50%</span>} icon={LockKeyhole} color="#dc8b16"/>
  <KpiCard label="实际可结算余额" value={formatVnd(latest?.settleable_balance_after_vnd??0)} note={<span>Payout 与低池预警唯一余额口径</span>} icon={WalletCards} color="#0f9f78"/>
  <KpiCard label="保证金比例" value={`${Number(opening?.reserve_ratio??0)*100}%`} note={<span>Settleable ratio 同为 50%</span>} icon={Percent} color="#6f4bb7"/>
 </div>
 <div className="alert alert-warning" style={{marginBottom:16}}><Info size={15}/><div><strong>支付能力边界</strong>上游账面余额不能全部用于 Payout。所有可执行性检查和低余额 USDT 折算必须读取 settleable_balance_vnd。</div></div>
 <div className="alert alert-warning" style={{marginBottom:16}}><Info size={15}/><div><strong>{completeness.status}</strong>Account History 截止：{dataCutoffs.accountHistoryLocal??"—"} {dataCutoffs.accountHistoryTimezone??""}；Topup 截止：{dataCutoffs.topupDate??"—"}（DATE_ONLY）；Payout 截止：{dataCutoffs.payoutUtc??"—"}。{completeness.isPartial?"缺少 2026-07-19 至 2026-07-20 的 Account History 流水，补U后余额是部分数据快照，不是完整实时当前余额。":"各数据源未超过 Account History 截止时间。"}</div></div>
 <Card><CardHeader><div><h2 className="panel-title">Gross / Settleable 双层流水</h2><div className="panel-subtitle">原始变动金额完整保存；可结算变化按 50% 派生</div></div><Badge variant="green">SETTLEABLE_RATIO_V1</Badge></CardHeader><div className="table-wrap"><table><thead><tr><th>事件时间</th><th>事件类型</th><th style={{textAlign:"right"}}>Gross 变动</th><th style={{textAlign:"right"}}>Settleable 变动</th><th style={{textAlign:"right"}}>Gross 余额</th><th style={{textAlign:"right"}}>Settleable 余额</th></tr></thead><tbody>{ledger.map((row,index)=><tr key={`${row.event_time}-${row.event_type}-${index}`}><td>{row.event_time??`${row.event_date} · DATE_ONLY`}</td><td><Badge variant={String(row.gross_signed_amount_vnd).startsWith("-")?"amber":"green"}>{row.event_type}</Badge></td><td className="money">{formatVnd(row.gross_signed_amount_vnd??0)}</td><td className="money">{formatVnd(row.settleable_signed_amount_vnd??0)}</td><td className="money">{formatVnd(row.gross_balance_after_vnd??0)}</td><td className="money">{formatVnd(row.settleable_balance_after_vnd??0)}</td></tr>)}</tbody></table></div><Pagination total={ledger.length}/></Card>
 </>}
