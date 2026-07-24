import type { Metadata } from "next";
import {
  Activity,
  AlertTriangle,
  Banknote,
  Boxes,
  Calculator,
  CircleDollarSign,
  Gauge,
  ShieldCheck,
  TrendingUp,
} from "lucide-react";

import { SettlementInputPanel } from "@/components/settlement-input-panel";
import { KpiCard, PageHeading } from "@/components/page-parts";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { getSettlementIntelligenceData } from "@/lib/server-data";
import { formatRate, formatUsdt, formatVnd } from "@/lib/utils";

export const metadata: Metadata = { title: "VND结算智能决策" };

function percent(value: string | number | null | undefined) {
  if (value === null || value === undefined) return "—";
  return `${(Number(value) * 100).toFixed(3)}%`;
}

function fxStatusVariant(status: string | undefined) {
  if (status === "BUY_VND_OPPORTUNITY") return "green" as const;
  if (status === "RISK") return "red" as const;
  return "blue" as const;
}

function riskVariant(severity: string) {
  if (severity === "HIGH") return "red" as const;
  if (severity === "WARNING") return "amber" as const;
  return "blue" as const;
}

export default async function SettlementIntelligencePage() {
  const data = await getSettlementIntelligenceData();
  const topup = data.topupRecommendation;
  const quote = data.quoteRecommendation;
  const profit = data.profitForecast;
  const fx = data.fxIntelligence;
  const topupStatusVariant = topup.topupRequired
    ? ("amber" as const)
    : ("green" as const);

  return (
    <>
      <PageHeading
        title="VND结算智能决策"
        subtitle="Task 2.7 · 库存成本、流动性预测与影子建议 · Asia/Shanghai"
      />
      <div className="alert alert-warning settlement-shadow-alert">
        <ShieldCheck size={17} />
        <div>
          <strong>Shadow Mode 决策支持</strong>
          本页只生成补U、报价和风险建议；不会付款、补U、修改客户报价或交易。
        </div>
      </div>

      <div className="kpi-grid">
        <KpiCard
          label="Gross Balance"
          value={formatVnd(data.balances.grossBalanceVnd)}
          note={<span>上游账面余额</span>}
          icon={Banknote}
          color="#155eef"
        />
        <KpiCard
          label="Settleable Balance"
          value={formatVnd(data.balances.settleableBalanceVnd)}
          note={<span>支付能力只使用可结算余额</span>}
          icon={Gauge}
          color="#0f9f78"
        />
        <KpiCard
          label="16:00-23:00 净需求"
          value={formatVnd(data.peakWindow.forecastNetDemandVnd)}
          note={
            <span>
              Payout {formatVnd(data.peakWindow.forecastPayoutVnd)}
            </span>
          }
          icon={Activity}
          color="#7c5ce4"
        />
        <KpiCard
          label="预计资金缺口"
          value={formatVnd(topup.projectedShortfallVnd)}
          note={
            <span>
              含{" "}
              {formatVnd(topup.safetyBufferVnd)} 安全缓冲
            </span>
          }
          icon={AlertTriangle}
          color={topup.topupRequired ? "#d33d45" : "#0f9f78"}
        />
      </div>

      <div className="settlement-decision-grid">
        <Card>
          <CardHeader>
            <div>
              <h2 className="panel-title">Topup Recommendation</h2>
              <div className="panel-subtitle">
                Settleable + 日内预测 + 10%安全缓冲
              </div>
            </div>
            <Badge variant={topupStatusVariant}>
              {topup.recommendationStatus}
            </Badge>
          </CardHeader>
          <CardContent>
            <div className="settlement-hero-value">
              {topup.recommendedTopupUsdt
                ? formatUsdt(topup.recommendedTopupUsdt, 2)
                : topup.topupRequired
                  ? "待人工P2P价"
                  : "0.00 USDT"}
            </div>
            <div className="metric-list">
              <div className="metric-row">
                <span className="metric-label">VND Gross补U需求</span>
                <span className="metric-value">
                  {formatVnd(topup.requiredGrossTopupVnd)}
                </span>
              </div>
              <div className="metric-row">
                <span className="metric-label">自动补U</span>
                <span className="metric-value">禁止</span>
              </div>
            </div>
            <ul className="settlement-reason-list">
              {topup.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <h2 className="panel-title">FX Intelligence</h2>
              <div className="panel-subtitle">
                人工市场输入，不修改历史批次成本
              </div>
            </div>
            <Badge variant={fxStatusVariant(fx?.opportunity)}>
              {fx?.opportunity ?? "WAITING_INPUT"}
            </Badge>
          </CardHeader>
          <CardContent>
            <div className="metric-list">
              <div className="metric-row">
                <span className="metric-label">XE Rate</span>
                <span className="metric-value">
                  {fx ? formatRate(fx.xeRate, 4) : "待录入"}
                </span>
              </div>
              <div className="metric-row">
                <span className="metric-label">P2P Cost Rate</span>
                <span className="metric-value">
                  {fx ? formatRate(fx.p2pCostRate, 4) : "待录入"}
                </span>
              </div>
              <div className="metric-row">
                <span className="metric-label">
                  Spread（P2P - XE）
                </span>
                <span className="metric-value">
                  {fx
                    ? `${formatRate(fx.spreadVndPerUsdt, 4)} · ${percent(
                        fx.spreadRatio,
                      )}`
                    : "—"}
                </span>
              </div>
              <div className="metric-row">
                <span className="metric-label">观察值波动</span>
                <span className="metric-value">
                  {percent(fx?.volatility)}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <h2 className="panel-title">Quote Recommendation</h2>
              <div className="panel-subtitle">
                XE + Company Adjustment + 利润保护
              </div>
            </div>
            <Badge variant="violet">SHADOW QUOTE</Badge>
          </CardHeader>
          <CardContent>
            <div className="settlement-hero-value">
              {quote
                ? formatRate(quote.recommendedQuoteRate, 4)
                : "待XE输入"}
            </div>
            <div className="metric-list">
              <div className="metric-row">
                <span className="metric-label">XE调整值</span>
                <span className="metric-value">
                  {quote
                    ? formatRate(quote.companyAdjustment, 4)
                    : "—"}
                </span>
              </div>
              <div className="metric-row">
                <span className="metric-label">最低保护</span>
                <span className="metric-value">0.200%</span>
              </div>
              <div className="metric-row">
                <span className="metric-label">动态目标</span>
                <span className="metric-value">
                  {percent(data.marginRecommendation.targetMargin)}
                </span>
              </div>
              <div className="metric-row">
                <span className="metric-label">自动修改真实报价</span>
                <span className="metric-value">禁止</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <h2 className="panel-title">Profit Forecast</h2>
              <div className="panel-subtitle">
                商户本金 - FIFO库存成本 + 手续费 + 有符号DCC
              </div>
            </div>
            <Badge
              variant={
                profit &&
                Number(profit.expectedProfitMargin) >= 0.002
                  ? "green"
                  : "amber"
              }
            >
              {profit ? percent(profit.expectedProfitMargin) : "PENDING"}
            </Badge>
          </CardHeader>
          <CardContent>
            <div className="settlement-hero-value">
              {profit
                ? formatUsdt(profit.expectedProfitUsdt, 2)
                : "市场输入不足"}
            </div>
            <div className="metric-list">
              <div className="metric-row">
                <span className="metric-label">商户本金</span>
                <span className="metric-value">
                  {profit
                    ? formatUsdt(profit.merchantPrincipalUsdt, 2)
                    : "—"}
                </span>
              </div>
              <div className="metric-row">
                <span className="metric-label">FIFO库存成本</span>
                <span className="metric-value">
                  {formatUsdt(data.fifoForecast.costBasisUsdt, 2)}
                </span>
              </div>
              <div className="metric-row">
                <span className="metric-label">报价收入</span>
                <span className="metric-value">
                  {profit
                    ? formatUsdt(profit.quoteRevenueUsdt, 2)
                    : "—"}
                </span>
              </div>
              <div className="metric-row">
                <span className="metric-label">商户手续费收入</span>
                <span className="metric-value">
                  {profit
                    ? formatUsdt(profit.merchantFeeRevenueUsdt, 2)
                    : "—"}
                </span>
              </div>
              <div className="metric-row">
                <span className="metric-label">DCC收入</span>
                <span className="metric-value">
                  {profit
                    ? formatUsdt(profit.dccRevenueUsdt, 2)
                    : "—"}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid-2">
        <Card>
          <CardHeader>
            <div>
              <h2 className="panel-title">Hourly Liquidity Forecast</h2>
              <div className="panel-subtitle">
                历史本地时间日均 · 重点窗口16:00-23:00
              </div>
            </div>
            <Badge variant="blue">{data.hourly.length} HOURS</Badge>
          </CardHeader>
          <div className="table-wrap settlement-hourly-table">
            <table>
              <thead>
                <tr>
                  <th>本地小时</th>
                  <th className="money">预计Payin</th>
                  <th className="money">预计Payout</th>
                  <th className="money">净需求</th>
                  <th>集中度</th>
                  <th>窗口</th>
                </tr>
              </thead>
              <tbody>
                {data.hourly.map((row) => (
                  <tr
                    className={row.isPeakWindow ? "peak-hour-row" : ""}
                    key={row.localHour}
                  >
                    <td className="mono">
                      {String(row.localHour).padStart(2, "0")}:00
                    </td>
                    <td className="money">
                      {formatVnd(row.forecastPayinVnd)}
                    </td>
                    <td className="money">
                      {formatVnd(row.forecastPayoutVnd)}
                    </td>
                    <td className="money">
                      {formatVnd(row.forecastNetDemandVnd)}
                    </td>
                    <td>{percent(row.payoutConcentrationRatio)}</td>
                    <td>
                      {row.isPeakWindow ? (
                        <Badge variant="violet">PEAK</Badge>
                      ) : (
                        <span className="muted">常规</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <h2 className="panel-title">Risk Alerts</h2>
              <div className="panel-subtitle">
                余额、汇率、利润与Payout集中风险
              </div>
            </div>
            <Badge variant="amber">{data.riskAlerts.length}</Badge>
          </CardHeader>
          <CardContent>
            <div className="settlement-risk-list">
              {data.riskAlerts.map((alert) => (
                <div className="settlement-risk-item" key={alert.code}>
                  <Badge variant={riskVariant(alert.severity)}>
                    {alert.severity}
                  </Badge>
                  <div>
                    <strong>{alert.code}</strong>
                    <span>{alert.message}</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="settlement-cutoff">
              <strong>数据完整性</strong>
              <Badge variant="amber">
                {data.dataCutoffs.completeness}
              </Badge>
              <span>
                Account History：
                {data.dataCutoffs.accountHistoryLocal ?? "—"}{" "}
                {data.dataCutoffs.accountHistoryTimezone ?? ""}
              </span>
              <span>
                Topup：{data.dataCutoffs.topupDate ?? "—"}{" "}
                {data.dataCutoffs.topupTimePrecision ?? ""}
              </span>
              <span>Payout：{data.dataCutoffs.payoutUtc ?? "—"}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div>
            <h2 className="panel-title">VND Inventory Batches · FIFO</h2>
            <div className="panel-subtitle">
              每次补U锁定实际成本；当前P2P价不会覆盖历史成本
            </div>
          </div>
          <Badge variant="green">
            {data.inventoryRows.length} OPEN BATCHES
          </Badge>
        </CardHeader>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>批次日期</th>
                <th>时间精度</th>
                <th className="money">USDT</th>
                <th className="money">VND</th>
                <th className="money">成本汇率</th>
                <th className="money">剩余VND</th>
                <th>FIFO状态</th>
              </tr>
            </thead>
            <tbody>
              {data.inventoryRows.map((batch) => (
                <tr key={String(batch.id)}>
                  <td>{String(batch.batch_date)}</td>
                  <td>
                    <Badge variant="gray">
                      {String(batch.time_precision)}
                    </Badge>
                  </td>
                  <td className="money">
                    {formatUsdt(String(batch.usdt_amount), 2)}
                  </td>
                  <td className="money">
                    {formatVnd(String(batch.vnd_amount))}
                  </td>
                  <td className="money">
                    {formatRate(String(batch.cost_rate), 4)}
                  </td>
                  <td className="money">
                    {formatVnd(String(batch.remaining_amount))}
                  </td>
                  <td>
                    <Badge variant="green">
                      {String(batch.status)}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <CardContent>
          <div className="alert alert-info">
            <Boxes size={16} />
            <div>
              <strong>本次预测FIFO验证</strong>
              {formatVnd(data.fifoForecast.fulfilledVnd)} 使用{" "}
              {data.fifoForecast.allocations.length} 个成本批次，成本{" "}
              {formatUsdt(data.fifoForecast.costBasisUsdt, 4)}；短缺{" "}
              {formatVnd(data.fifoForecast.shortageVnd)}。
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="settlement-input-panel">
        <CardHeader>
          <div>
            <h2 className="panel-title">Manual Intelligence Inputs</h2>
            <div className="panel-subtitle">
              仅保存市场观察和影子规则，禁止自动应用
            </div>
          </div>
          <div className="settlement-mode-icons">
            <TrendingUp size={15} />
            <Calculator size={15} />
            <CircleDollarSign size={15} />
          </div>
        </CardHeader>
        <CardContent>
          <SettlementInputPanel />
        </CardContent>
      </Card>
    </>
  );
}
