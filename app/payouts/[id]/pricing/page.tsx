import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Calculator, CircleDollarSign, ShieldAlert } from "lucide-react";

import { KpiCard, PageHeading } from "@/components/page-parts";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { getPayoutPricing } from "@/lib/server-data";
import { formatRate, formatUsdt, formatVnd } from "@/lib/utils";

export const metadata: Metadata = { title: "单笔 Payout 影子定价" };

export default async function PayoutPricingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await getPayoutPricing(id);
  if (!data) notFound();
  const { calculation, order, execution, identifiers, allocations } = data;
  const matchMethod =
    execution?.match_method ?? "NO_EXACT_IDENTIFIER_MATCH";
  const matchConfidence = execution?.match_confidence ?? "NONE";
  const dccRevenue = Number(calculation.dcc_revenue_usdt ?? 0);

  return (
    <>
      <PageHeading
        title="单笔 Payout 影子定价"
        subtitle={`订单 ${order?.order_number ?? "—"} · ${
          order?.merchant ?? "—"
        } · ${order?.channel ?? "—"}`}
      />
      <div className="alert alert-warning" style={{ marginBottom: 16 }}>
        <ShieldAlert size={16} />
        <div>
          <strong>{calculation.data_completeness_status}</strong>
          未找到 Account History 业务订单号与本 Payout
          的真实标识符精确对应，因此执行成本保持 ESTIMATED；金额与时间候选不会标记
          VERIFIED。聚合账户流水可标记{" "}
          {calculation.aggregate_execution_validation_status ??
            "NOT_APPLICABLE"}
          ，但不等同于本单 VERIFIED，也不会执行真实报价或资金操作。
        </div>
      </div>

      <div className="kpi-grid">
        <KpiCard
          label="Payout 本金"
          value={formatVnd(calculation.merchant_principal_vnd)}
          note={<span>原始订单金额</span>}
          icon={CircleDollarSign}
        />
        <KpiCard
          label="商户手续费收入"
          value={formatUsdt(calculation.merchant_fee_usdt ?? 0, 4)}
          note={
            <span>
              正式费率（手续费 ÷ USDT 本金）{" "}
              {(Number(calculation.merchant_fee_rate ?? 0) * 100).toFixed(4)}%
            </span>
          }
          icon={CircleDollarSign}
          color="#155eef"
        />
        <KpiCard
          label="DCC 收入"
          value={formatUsdt(calculation.dcc_revenue_usdt ?? 0, 4)}
          note={
            <span>
              {dccRevenue >= 0
                ? "正数：增加公司收入"
                : "负数：优惠或公司承担成本"}
            </span>
          }
          icon={CircleDollarSign}
          color="#0f9f78"
        />
        <KpiCard
          label="经济利润率"
          value={`${(Number(calculation.economic_profit_margin) * 100).toFixed(
            4,
          )}%`}
          note={<span>{calculation.profit_verification_status}</span>}
          icon={Calculator}
          color="#6f4bb7"
        />
      </div>

      <div className="grid-2">
        <Card>
          <CardHeader>
            <div>
              <h2 className="panel-title">匹配与成本</h2>
              <div className="panel-subtitle">
                完整订单号与通道订单号精确匹配优先
              </div>
            </div>
            <Badge variant="amber">
              {calculation.payout_execution_cost_status}
            </Badge>
          </CardHeader>
          <CardContent>
            <div className="metric-list">
              <div className="metric-row">
                <span className="metric-label">匹配方法</span>
                <span className="metric-value">{matchMethod}</span>
              </div>
              <div className="metric-row">
                <span className="metric-label">匹配可信度</span>
                <span className="metric-value">{matchConfidence}</span>
              </div>
              <div className="metric-row">
                <span className="metric-label">最终 Payout 状态</span>
                <span className="metric-value">
                  {calculation.final_payout_status}
                </span>
              </div>
              <div className="metric-row">
                <span className="metric-label">上游手续费 VND</span>
                <span className="metric-value">
                  {formatVnd(calculation.upstream_payout_fee_vnd ?? 0)}
                </span>
              </div>
              <div className="metric-row">
                <span className="metric-label">上游手续费折算</span>
                <span className="metric-value">
                  {formatUsdt(calculation.upstream_payout_fee_usdt ?? 0, 4)}
                </span>
              </div>
              <div className="metric-row">
                <span className="metric-label">资金经济替代成本</span>
                <span className="metric-value">
                  {formatUsdt(
                    calculation.funding_principal_cost_usdt ?? 0,
                    4,
                  )}
                </span>
              </div>
              <div className="metric-row">
                <span className="metric-label">已实现利润资格</span>
                <span className="metric-value">
                  {calculation.realized_profit_eligible ? "YES" : "NO"}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <h2 className="panel-title">收入与 DCC 诊断</h2>
              <div className="panel-subtitle">
                商户手续费收入 + 有符号 DCC 收入 = 公司总收入
              </div>
            </div>
            <Badge variant="violet">SEPARATED</Badge>
          </CardHeader>
          <CardContent>
            <div className="metric-list">
              <div className="metric-row">
                <span className="metric-label">商户总扣款 USDT</span>
                <span className="metric-value">
                  {formatUsdt(
                    calculation.merchant_total_debit_usdt ?? 0,
                    4,
                  )}
                </span>
              </div>
              <div className="metric-row">
                <span className="metric-label">商户本金 USDT</span>
                <span className="metric-value">
                  {formatUsdt(calculation.merchant_principal_usdt ?? 0, 4)}
                </span>
              </div>
              <div className="metric-row">
                <span className="metric-label">商户手续费收入</span>
                <span className="metric-value">
                  {formatUsdt(calculation.merchant_fee_usdt ?? 0, 4)}
                </span>
              </div>
              <div className="metric-row">
                <span className="metric-label">
                  DCC {dccRevenue >= 0 ? "收入" : "优惠/成本"}
                </span>
                <span className="metric-value">
                  {formatUsdt(calculation.dcc_revenue_usdt ?? 0, 4)}
                </span>
              </div>
              <div className="metric-row">
                <span className="metric-label">总扣款口径费率（诊断）</span>
                <span className="metric-value">
                  {(Number(calculation.fee_rate_on_total ?? 0) * 100).toFixed(
                    4,
                  )}
                  %
                </span>
              </div>
              <div className="metric-row">
                <span className="metric-label">公司总收入</span>
                <span className="metric-value">
                  {formatUsdt(
                    calculation.total_company_revenue_usdt ?? 0,
                    4,
                  )}
                </span>
              </div>
              <div className="metric-row">
                <span className="metric-label">AR / AS</span>
                <span className="metric-value">
                  {formatRate(calculation.ar_rate)} /{" "}
                  {formatRate(calculation.as_rate)}
                </span>
              </div>
              <div className="metric-row">
                <span className="metric-label">AP 导入 / 计算</span>
                <span className="metric-value">
                  {Number(calculation.ap_imported).toFixed(8)} /{" "}
                  {Number(calculation.ap_calculated).toFixed(8)}
                </span>
              </div>
              <div className="metric-row">
                <span className="metric-label">AQ 导入值</span>
                <span className="metric-value">
                  {Number(calculation.aq_imported).toFixed(8)} · 不重复扣除
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card style={{ marginTop: 16 }}>
        <CardHeader>
          <div>
            <h2 className="panel-title">真实标识符审计</h2>
            <div className="panel-subtitle">
              来自原 Payout 文件，未用猜测列名替代
            </div>
          </div>
          <Badge variant="blue">SOURCE EVIDENCE</Badge>
        </CardHeader>
        <CardContent>
          <div className="metric-list">
            <div className="metric-row">
              <span className="metric-label">订单号</span>
              <span className="metric-value">{identifiers?.order_number ?? "—"}</span>
            </div>
            <div className="metric-row">
              <span className="metric-label">通道订单号</span>
              <span className="metric-value">
                {identifiers?.channel_order_number ?? "—"}
              </span>
            </div>
            <div className="metric-row">
              <span className="metric-label">支付订单号</span>
              <span className="metric-value">
                {identifiers?.payment_order_number ?? "—"}
              </span>
            </div>
            <div className="metric-row">
              <span className="metric-label">Provider order</span>
              <span className="metric-value">
                {identifiers?.provider_order_number ?? "—"}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card style={{ marginTop: 16 }}>
        <CardHeader>
          <div>
            <h2 className="panel-title">资金来源分摊</h2>
            <div className="panel-subtitle">
              版本化 Task 2 分摊保留；无精确 Payout 链接时不做退款猜测反转
            </div>
          </div>
          <Badge variant="blue">{allocations.length} BUCKETS</Badge>
        </CardHeader>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>来源</th>
                <th style={{ textAlign: "right" }}>占比</th>
                <th style={{ textAlign: "right" }}>Gross 流出</th>
                <th style={{ textAlign: "right" }}>Settleable 影响</th>
                <th>成本方法</th>
                <th style={{ textAlign: "right" }}>经济成本</th>
                <th>可信度</th>
              </tr>
            </thead>
            <tbody>
              {allocations.map((row) => (
                <tr key={row.id}>
                  <td>
                    <Badge
                      variant={row.source_type === "TOPUP" ? "blue" : "violet"}
                    >
                      {row.source_type}
                    </Badge>
                  </td>
                  <td className="money">
                    {(Number(row.allocation_ratio) * 100).toFixed(4)}%
                  </td>
                  <td className="money">
                    {formatVnd(row.allocated_gross_outflow_vnd)}
                  </td>
                  <td className="money">
                    {formatVnd(row.allocated_settleable_impact_vnd)}
                  </td>
                  <td>{row.cost_method}</td>
                  <td className="money">
                    {formatUsdt(row.economic_cost_usdt, 4)}
                  </td>
                  <td>
                    <Badge
                      variant={
                        row.cost_confidence === "MEDIUM" ? "amber" : "red"
                      }
                    >
                      {row.cost_confidence}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
