import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowDownUp,
  ChartNoAxesCombined,
  CircleDollarSign,
  Landmark,
  ShieldCheck,
  WalletCards,
} from "lucide-react";

import { KpiCard, PageHeading, Pagination } from "@/components/page-parts";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  INTERNAL_NETTING_ADVANTAGE_LABEL,
  payoutFeeDistribution,
} from "@/lib/domain";
import { getPortfolioData } from "@/lib/server-data";
import { formatRate, formatUsdt, formatVnd } from "@/lib/utils";

export const metadata: Metadata = { title: "VND 组合回测" };

function sum(
  rows: Record<string, unknown>[],
  field: string,
) {
  return rows.reduce((total, row) => total + Number(row[field] ?? 0), 0);
}

export default async function PortfolioPage() {
  const data = await getPortfolioData();
  const summaries = data.summaries as Record<string, unknown>[];
  const economicProfit = sum(summaries, "payout_economic_profit_usdt");
  const merchantFeeRevenue = sum(
    summaries,
    "merchant_fee_revenue_usdt",
  );
  const dccRevenue = sum(summaries, "dcc_revenue_usdt");
  const totalCompanyRevenue = sum(
    summaries,
    "total_company_revenue_usdt",
  );
  const upstreamPayoutFee = sum(summaries, "upstream_payout_fee_vnd");
  const refundCount = sum(summaries, "refund_count");
  const refundReversal = sum(summaries, "refund_reversal_vnd");
  const internalAdvantage = sum(
    summaries,
    "internal_netting_advantage_usdt",
  );
  const verified = sum(summaries, "verified_count");
  const partial = sum(summaries, "partial_count");
  const estimated = sum(summaries, "estimated_count");
  const notCalculable = sum(summaries, "not_calculable_count");
  const belowMinimum = sum(
    summaries,
    "below_minimum_margin_count",
  );
  const atTarget = sum(
    summaries,
    "at_or_above_target_margin_count",
  );
  const betweenMinimumAndTarget = Math.max(
    0,
    verified + partial + estimated - belowMinimum - atTarget,
  );
  const feeStats = payoutFeeDistribution(
    data.fees.map((row) => ({
      principalVnd: String(row.original_payout_principal_vnd ?? 0),
      feeVnd: String(row.final_upstream_fee_vnd ?? 0),
    })),
  );
  const gross = data.sources.reduce(
    (total, row) =>
      total + Number(row.gross_available_amount_vnd ?? 0),
    0,
  );
  const settleable = data.sources.reduce(
    (total, row) =>
      total + Number(row.settleable_available_amount_vnd ?? 0),
    0,
  );

  return (
    <>
      <PageHeading
        title="VND 组合与真实数据回测"
        subtitle="Task 2.5 · 商户手续费、DCC、上游代付成本分层展示"
      />
      <div className="alert alert-warning" style={{ marginBottom: 16 }}>
        <ShieldCheck size={16} />
        <div>
          <strong>仍为 Shadow Mode。</strong>
          {Number(
            data.validation?.payout_unmatched_rows ?? 0,
          ).toLocaleString()}{" "}
          条 Account History 代付均未找到真实标识符精确匹配，
          金额或时间不会被提升为 VERIFIED；Net Settlement 的 USDT
          对手腿方向仍待确认。聚合账户流水状态为{" "}
          <strong>
            {data.validation?.aggregate_execution_validation_status ??
              "NOT_APPLICABLE"}
          </strong>
          ，不等同于单笔订单验证。
        </div>
      </div>
      <div className="alert alert-info" style={{ marginBottom: 16 }}>
        <CircleDollarSign size={16} />
        <div>
          <strong>公司收入公式：</strong>
          商户手续费收入 + 有符号 DCC 收入 = 公司总收入。DCC
          为正时表示公司收入，为负时表示商户优惠或公司承担成本。
        </div>
      </div>

      <div className="kpi-grid">
        <KpiCard
          label="商户手续费收入"
          value={formatUsdt(merchantFeeRevenue, 2)}
          note={<span>真实 fee_usdt；正式费率分母为商户本金</span>}
          icon={CircleDollarSign}
        />
        <KpiCard
          label="DCC 收入"
          value={formatUsdt(dccRevenue, 2)}
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
          label="公司总收入"
          value={formatUsdt(totalCompanyRevenue, 2)}
          note={<span>商户手续费收入 + 有符号 DCC 收入</span>}
          icon={CircleDollarSign}
          color="#155eef"
        />
        <KpiCard
          label="实际上游 Payout 成本"
          value={formatVnd(upstreamPayoutFee)}
          note={
            <span>
              {Number(
                data.validation?.successful_unrefunded_rows ?? 0,
              ).toLocaleString()}{" "}
              笔未退款成功流水
            </span>
          }
          icon={ArrowDownUp}
          color="#dc8b16"
        />
        <KpiCard
          label="Payout 经济利润"
          value={formatUsdt(economicProfit, 2)}
          note={<span>ESTIMATED · 非已实现净利润</span>}
          icon={ChartNoAxesCombined}
          color="#6f4bb7"
        />
      </div>

      <div className="kpi-grid">
        <KpiCard
          label="退款反转"
          value={formatVnd(refundReversal)}
          note={<span>{refundCount.toLocaleString()} 笔 · Account History 净零</span>}
          icon={ArrowDownUp}
        />
        <KpiCard
          label="Gross 余额快照"
          value={formatVnd(gross)}
          note={<span>资金桶账面层</span>}
          icon={Landmark}
        />
        <KpiCard
          label="Settleable 余额"
          value={formatVnd(settleable)}
          note={<span>50% 保证金后的 Payout 能力</span>}
          icon={WalletCards}
          color="#0f9f78"
        />
        <KpiCard
          label={INTERNAL_NETTING_ADVANTAGE_LABEL}
          value={formatUsdt(internalAdvantage, 2)}
          note={<span>不是已实现净利润</span>}
          icon={ChartNoAxesCombined}
          color="#6f4bb7"
        />
      </div>

      <div className="grid-2">
        <Card>
          <CardHeader>
            <div>
              <h2 className="panel-title">利润验证状态</h2>
              <div className="panel-subtitle">
                Run v{data.run?.run_version ?? "—"} ·{" "}
                {data.run?.rules_version ?? "—"}
              </div>
            </div>
            <Badge variant="amber">{data.run?.status ?? "—"}</Badge>
          </CardHeader>
          <CardContent>
            <div className="metric-list">
              <div className="metric-row">
                <span className="metric-label">VERIFIED</span>
                <span className="metric-value">{verified.toLocaleString()}</span>
              </div>
              <div className="metric-row">
                <span className="metric-label">PARTIAL</span>
                <span className="metric-value">{partial.toLocaleString()}</span>
              </div>
              <div className="metric-row">
                <span className="metric-label">ESTIMATED</span>
                <span className="metric-value">{estimated.toLocaleString()}</span>
              </div>
              <div className="metric-row">
                <span className="metric-label">NOT_CALCULABLE</span>
                <span className="metric-value">
                  {notCalculable.toLocaleString()}
                </span>
              </div>
              <div className="metric-row">
                <span className="metric-label">低于千2</span>
                <span className="metric-value">
                  {belowMinimum.toLocaleString()}
                </span>
              </div>
              <div className="metric-row">
                <span className="metric-label">达到千5</span>
                <span className="metric-value">{atTarget.toLocaleString()}</span>
              </div>
              <div className="metric-row">
                <span className="metric-label">千2至千5</span>
                <span className="metric-value">
                  {betweenMinimumAndTarget.toLocaleString()}
                </span>
              </div>
              <div className="metric-row">
                <span className="metric-label">聚合执行验证</span>
                <span className="metric-value">
                  {Number(
                    data.validation?.aggregate_execution_validated_count ?? 0,
                  ).toLocaleString()}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <h2 className="panel-title">实际上游手续费分布</h2>
              <div className="panel-subtitle">
                {Number(
                  data.validation?.successful_unrefunded_rows ?? 0,
                ).toLocaleString()}{" "}
                笔未退款成功代付；源文件未提供通道字段
              </div>
            </div>
            <Badge variant="green">ACCOUNT HISTORY</Badge>
          </CardHeader>
          <CardContent>
            <div className="metric-list">
              <div className="metric-row">
                <span className="metric-label">最小值</span>
                <span className="metric-value">
                  {feeStats.minimum
                    ? `${(Number(feeStats.minimum) * 100).toFixed(6)}%`
                    : "—"}
                </span>
              </div>
              <div className="metric-row">
                <span className="metric-label">中位数</span>
                <span className="metric-value">
                  {feeStats.median
                    ? `${(Number(feeStats.median) * 100).toFixed(6)}%`
                    : "—"}
                </span>
              </div>
              <div className="metric-row">
                <span className="metric-label">最大值</span>
                <span className="metric-value">
                  {feeStats.maximum
                    ? `${(Number(feeStats.maximum) * 100).toFixed(6)}%`
                    : "—"}
                </span>
              </div>
              <div className="metric-row">
                <span className="metric-label">通道分布</span>
                <span className="metric-value">源文件产品编码为空</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card style={{ marginTop: 16 }}>
        <CardHeader>
          <div>
            <h2 className="panel-title">商户手续费率分布</h2>
            <div className="panel-subtitle">
              正式费率 = 手续费 ÷ 商户本金；DCC 不包含在本表费率中
            </div>
          </div>
          <Badge variant="blue">{data.merchantFees.length} MERCHANTS</Badge>
        </CardHeader>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>商户</th>
                <th style={{ textAlign: "right" }}>订单数</th>
                <th style={{ textAlign: "right" }}>手续费收入</th>
                <th style={{ textAlign: "right" }}>商户本金</th>
                <th style={{ textAlign: "right" }}>最小费率</th>
                <th style={{ textAlign: "right" }}>中位费率</th>
                <th style={{ textAlign: "right" }}>最大费率</th>
                <th style={{ textAlign: "right" }}>总扣款口径诊断</th>
                <th style={{ textAlign: "right" }}>DCC 收入</th>
              </tr>
            </thead>
            <tbody>
              {data.merchantFees.map((row) => (
                <tr key={`${row.merchant_id}-${row.merchant_name}`}>
                  <td>{row.merchant_name ?? row.merchant_id ?? "—"}</td>
                  <td className="money">
                    {Number(row.payout_count).toLocaleString()}
                  </td>
                  <td className="money">
                    {formatUsdt(row.merchant_fee_usdt ?? 0, 2)}
                  </td>
                  <td className="money">
                    {formatUsdt(row.merchant_principal_usdt ?? 0, 2)}
                  </td>
                  <td className="money">
                    {(Number(row.minimum_merchant_fee_rate ?? 0) * 100).toFixed(
                      4,
                    )}
                    %
                  </td>
                  <td className="money">
                    {(Number(row.median_merchant_fee_rate ?? 0) * 100).toFixed(
                      4,
                    )}
                    %
                  </td>
                  <td className="money">
                    {(Number(row.maximum_merchant_fee_rate ?? 0) * 100).toFixed(
                      4,
                    )}
                    %
                  </td>
                  <td className="money">
                    {(Number(row.median_fee_rate_on_total ?? 0) * 100).toFixed(
                      4,
                    )}
                    %
                  </td>
                  <td className="money">
                    {formatUsdt(row.dcc_revenue_usdt ?? 0, 2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card style={{ marginTop: 16 }}>
        <CardHeader>
          <div>
            <h2 className="panel-title">真实 Net Settlement</h2>
            <div className="panel-subtitle">
              VND 腿已验证；USDT 对手腿方向确认前已实现利润影响为 0
            </div>
          </div>
          <Badge variant="amber">PENDING COUNTER-LEG</Badge>
        </CardHeader>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>时间（UTC）</th>
                <th>方向</th>
                <th style={{ textAlign: "right" }}>USDT</th>
                <th style={{ textAlign: "right" }}>VND</th>
                <th style={{ textAlign: "right" }}>实际汇率</th>
                <th>验证状态</th>
              </tr>
            </thead>
            <tbody>
              {data.settlements.map((row) => (
                <tr key={`${row.settled_at}-${row.vnd_amount}`}>
                  <td className="mono">{row.settled_at}</td>
                  <td>{row.settlement_direction}</td>
                  <td className="money">{formatUsdt(row.usdt_amount, 2)}</td>
                  <td className="money">{formatVnd(row.vnd_amount)}</td>
                  <td className="money">
                    {formatRate(row.actual_rate_vnd_per_usdt, 6)}
                  </td>
                  <td>
                    <Badge variant="amber">{row.counter_leg_status}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card style={{ marginTop: 16 }}>
        <CardHeader>
          <div>
            <h2 className="panel-title">低利润率订单样本</h2>
            <div className="panel-subtitle">
              点击查看商户手续费、DCC、成本和分摊证据
            </div>
          </div>
          <Badge variant="amber">ESTIMATED</Badge>
        </CardHeader>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>计算 ID</th>
                <th>利润状态</th>
                <th>执行成本</th>
                <th style={{ textAlign: "right" }}>商户手续费</th>
                <th style={{ textAlign: "right" }}>DCC</th>
                <th style={{ textAlign: "right" }}>经济利润</th>
                <th style={{ textAlign: "right" }}>利润率</th>
              </tr>
            </thead>
            <tbody>
              {data.calculations.map((row) => (
                <tr key={row.id}>
                  <td>
                    <Link
                      className="text-link mono"
                      href={`/payouts/${row.id}/pricing`}
                    >
                      {String(row.id).slice(0, 8)}…
                    </Link>
                  </td>
                  <td>
                    <Badge variant="amber">
                      {row.profit_verification_status}
                    </Badge>
                  </td>
                  <td>
                    <Badge variant="violet">
                      {row.payout_execution_cost_status}
                    </Badge>
                  </td>
                  <td className="money">
                    {formatUsdt(row.merchant_fee_usdt ?? 0, 4)}
                  </td>
                  <td className="money">
                    {formatUsdt(row.dcc_revenue_usdt ?? 0, 4)}
                  </td>
                  <td className="money">
                    {formatUsdt(row.economic_profit_usdt, 4)}
                  </td>
                  <td className="money">
                    {(Number(row.economic_profit_margin) * 100).toFixed(4)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination total={data.calculations.length} label="样本" />
      </Card>
    </>
  );
}
