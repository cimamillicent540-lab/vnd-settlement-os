import type { Metadata } from "next";
import {
  AlertTriangle,
  Banknote,
  BrainCircuit,
  Gauge,
  Landmark,
  LineChart,
  ShieldCheck,
  TrendingUp,
} from "lucide-react";

import { KpiCard, PageHeading } from "@/components/page-parts";
import { SsrDataFallback } from "@/components/ssr-data-fallback";
import {
  SettlementDailyReportActions,
  type DecisionValidationRow,
} from "@/components/settlement-daily-report-actions";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  classifyServerDataFailure,
  getSettlementDailyReportData,
} from "@/lib/server-data";
import {
  loadSsrPageData,
  SSR_QUERY_PLAN,
} from "@/lib/ssr-performance";
import {
  formatRate,
  formatUsdt,
  formatVnd,
} from "@/lib/utils";

export const metadata: Metadata = {
  title: "VND每日结算日报",
};

function percent(value: string | number | null | undefined) {
  if (value === null || value === undefined) return "待积累样本";
  return `${(Number(value) * 100).toFixed(2)}%`;
}

function localTime(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour12: false,
  });
}

function riskVariant(severity: string | undefined) {
  if (severity === "HIGH") return "red" as const;
  if (severity === "WARNING") return "amber" as const;
  return "blue" as const;
}

export default async function SettlementDailyReportPage() {
  let report: Awaited<ReturnType<typeof getSettlementDailyReportData>>;
  try {
    report = await loadSsrPageData({
      page: "/settlement-daily-report",
      plannedQueries:
        SSR_QUERY_PLAN.settlementDailyReport.plannedQueries,
      loader: getSettlementDailyReportData,
    });
  } catch (error) {
    return (
      <SsrDataFallback
        title="CEO Settlement Daily Report"
        subtitle="日报查询降级 · Shadow Mode"
        failureCode={classifyServerDataFailure(error)}
      />
    );
  }
  const current = report.current;
  const accuracy = report.accuracy90d;
  const merchants = report.merchantProfitContributions;

  return (
    <>
      <PageHeading
        title="CEO Settlement Daily Report"
        subtitle={`Task 2.11 · 运营日 ${report.operatingDate ?? "无Account History"} · 每日影子运营验证`}
      />

      <div className="alert alert-warning settlement-shadow-alert">
        <ShieldCheck size={17} />
        <div>
          <strong>Shadow Mode · 只读建议与人工记录</strong>
          日报不会付款、补U、修改客户报价、自动采集汇率或交易。Account
          History截止：
          {localTime(current.dataCutoffs.accountHistoryUtc)}，完整性：
          {report.dataCompletenessStatus}。
        </div>
      </div>

      <div className="kpi-grid">
        <KpiCard
          label="Gross Balance"
          value={formatVnd(current.balances.grossBalanceVnd)}
          note={<span>上游账面余额</span>}
          icon={Banknote}
          color="#155eef"
        />
        <KpiCard
          label="Settleable Balance"
          value={formatVnd(
            current.balances.settleableBalanceVnd,
          )}
          note={<span>用于Payout能力判断</span>}
          icon={Gauge}
          color="#0f9f78"
        />
        <KpiCard
          label="Reserve Balance"
          value={formatVnd(current.balances.reserveBalanceVnd)}
          note={<span>50%保证金锁定</span>}
          icon={Landmark}
          color="#7c5ce4"
        />
        <KpiCard
          label="当日净资金变化"
          value={formatVnd(report.activity.netFundsChangeVnd)}
          note={
            <span>
              Payin {formatVnd(report.activity.todayPayinVnd)} ·
              Payout {formatVnd(report.activity.todayPayoutVnd)}
            </span>
          }
          icon={TrendingUp}
          color={
            Number(report.activity.netFundsChangeVnd) < 0
              ? "#d33d45"
              : "#0f9f78"
          }
        />
      </div>

      <div className="daily-report-grid">
        <Card>
          <CardHeader>
            <div>
              <h2 className="panel-title">今日资金与未来压力</h2>
              <div className="panel-subtitle">
                当前Settleable + 90天窗口 + 16:00–23:00高峰
              </div>
            </div>
            <Badge
              variant={
                current.topup.topupRecommended ? "amber" : "green"
              }
            >
              {current.topup.topupRecommended
                ? "SHORTFALL"
                : "COVERED"}
            </Badge>
          </CardHeader>
          <CardContent>
            <div className="control-metric-grid">
              <div>
                <span>预计Payout</span>
                <strong>
                  {formatVnd(
                    current.pressure.forecastPayoutVnd,
                  )}
                </strong>
              </div>
              <div>
                <span>预计Payin</span>
                <strong>
                  {formatVnd(current.pressure.forecastPayinVnd)}
                </strong>
              </div>
              <div>
                <span>净资金需求</span>
                <strong>
                  {formatVnd(
                    current.pressure.forecastNetDemandVnd,
                  )}
                </strong>
              </div>
              <div>
                <span>高峰压力</span>
                <strong>
                  {formatVnd(current.pressure.peakPressureVnd)}
                </strong>
              </div>
            </div>
            <div className="alert alert-info">
              <div>
                <strong>补U建议</strong>
                {current.topup.topupRecommended
                  ? `${current.topup.recommendedTopupUsdt ? formatUsdt(current.topup.recommendedTopupUsdt, 2) : "待人工P2P输入"} · ${current.topup.recommendedTime}`
                  : "无需补U；当前可结算余额覆盖预测压力。"}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <h2 className="panel-title">今日双利润</h2>
              <div className="panel-subtitle">
                Cash用于财务，Economic用于经营与AI学习
              </div>
            </div>
            <Badge variant="violet">BOTH REQUIRED</Badge>
          </CardHeader>
          <CardContent>
            <div className="daily-profit-pair">
              <section>
                <span>Cash Profit</span>
                <strong>
                  {formatUsdt(report.profit.cashProfitUsdt, 2)}
                </strong>
                <small>
                  {percent(report.profit.cashProfitMargin)}
                </small>
              </section>
              <section>
                <span>Economic Profit</span>
                <strong>
                  {formatUsdt(
                    report.profit.economicProfitUsdt,
                    2,
                  )}
                </strong>
                <small>
                  {percent(report.profit.economicProfitMargin)}
                </small>
              </section>
            </div>
            <div className="control-data-cutoff">
              利润数据状态：{report.profit.dataStatus}。两个指标同时进入日报快照和后验评价。
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="daily-report-grid">
        <Card>
          <CardHeader>
            <div>
              <h2 className="panel-title">汇率机会</h2>
              <div className="panel-subtitle">
                XE与P2P继续由人工输入，不自动采集
              </div>
            </div>
            <Badge
              variant={
                current.fx.opportunityStatus === "RISK"
                  ? "red"
                  : current.fx.opportunityStatus ===
                      "BUY_VND_OPPORTUNITY"
                    ? "green"
                    : "blue"
              }
            >
              {current.fx.opportunityStatus}
            </Badge>
          </CardHeader>
          <CardContent>
            <div className="control-metric-grid">
              <div>
                <span>XE Rate</span>
                <strong>
                  {current.fx.xeRate
                    ? formatRate(current.fx.xeRate, 4)
                    : "等待人工输入"}
                </strong>
              </div>
              <div>
                <span>P2P Cost Rate</span>
                <strong>
                  {current.fx.p2pCostRate
                    ? formatRate(current.fx.p2pCostRate, 4)
                    : "等待人工输入"}
                </strong>
              </div>
              <div>
                <span>客户建议报价</span>
                <strong>
                  {current.fx.companyQuoteRate
                    ? formatRate(current.fx.companyQuoteRate, 4)
                    : "不可计算"}
                </strong>
              </div>
              <div>
                <span>价差</span>
                <strong>
                  {current.fx.spreadVndPerUsdt ?? "—"}
                </strong>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <h2 className="panel-title">风险提醒</h2>
              <div className="panel-subtitle">
                只提示，由人工确认、忽略或补充原因
              </div>
            </div>
            <Badge
              variant={current.risks.length > 0 ? "amber" : "green"}
            >
              {current.risks.length} ALERTS
            </Badge>
          </CardHeader>
          <CardContent>
            {current.risks.length === 0 ? (
              <div className="empty-state">
                <ShieldCheck size={24} />
                <strong>当前无风险提醒</strong>
              </div>
            ) : (
              <div className="daily-risk-list">
                {current.risks.map((risk) => (
                  <div className="daily-risk-row" key={risk.code}>
                    <Badge variant={riskVariant(risk.severity)}>
                      {risk.severity}
                    </Badge>
                    <div>
                      <strong>{risk.code}</strong>
                      <span>{risk.message}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div>
            <h2 className="panel-title">商户利润贡献</h2>
            <div className="panel-subtitle">
              运营日内商户Cash与Economic贡献同时展示
            </div>
          </div>
          <Badge variant="blue">
            {merchants.length} MERCHANTS
          </Badge>
        </CardHeader>
        <CardContent>
          {merchants.length === 0 ? (
            <div className="empty-state">
              <LineChart size={24} />
              <strong>该运营日没有可用商户利润记录</strong>
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>商户</th>
                    <th>Payout笔数</th>
                    <th>交易本金</th>
                    <th>Cash贡献</th>
                    <th>Economic贡献</th>
                  </tr>
                </thead>
                <tbody>
                  {merchants.map((merchant) => (
                    <tr key={merchant.merchant_name}>
                      <td>{merchant.merchant_name}</td>
                      <td>{merchant.payout_count}</td>
                      <td>
                        {formatUsdt(
                          merchant.merchant_principal_usdt,
                          2,
                        )}
                      </td>
                      <td>
                        {formatUsdt(
                          merchant.cash_profit_contribution_usdt,
                          2,
                        )}
                      </td>
                      <td>
                        {formatUsdt(
                          merchant.economic_profit_contribution_usdt,
                          2,
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <h2 className="panel-title">
              Decision Accuracy Tracking · 90天
            </h2>
            <div className="panel-subtitle">
              第一阶段只统计，不自动优化模型
            </div>
          </div>
          <Badge variant="violet">DESCRIPTIVE ONLY</Badge>
        </CardHeader>
        <CardContent>
          <div className="decision-accuracy-grid">
            <section>
              <BrainCircuit size={18} />
              <span>补U建议准确率</span>
              <strong>
                {percent(accuracy?.topup_accuracy_rate)}
              </strong>
              <small>
                样本 {accuracy?.topup_evaluable_count ?? 0}
              </small>
            </section>
            <section>
              <LineChart size={18} />
              <span>报价平均偏差</span>
              <strong>
                {accuracy?.average_quote_absolute_deviation ??
                  "待积累样本"}
              </strong>
              <small>
                样本 {accuracy?.quote_evaluable_count ?? 0}
              </small>
            </section>
            <section>
              <Banknote size={18} />
              <span>利润预测偏差</span>
              <strong>
                {accuracy?.average_economic_profit_absolute_error_usdt
                  ? formatUsdt(
                      accuracy.average_economic_profit_absolute_error_usdt,
                      2,
                    )
                  : "待积累样本"}
              </strong>
              <small>Economic Profit</small>
            </section>
            <section>
              <AlertTriangle size={18} />
              <span>风险提醒命中率</span>
              <strong>
                {percent(accuracy?.risk_alert_hit_rate)}
              </strong>
              <small>
                样本 {accuracy?.risk_evaluable_count ?? 0}
              </small>
            </section>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <h2 className="panel-title">日报与后验记录</h2>
            <div className="panel-subtitle">
              已保存日报 {report.savedReports.length} 份；所有记录不可变并保留原因
            </div>
          </div>
          <Badge variant="green">AUDITED</Badge>
        </CardHeader>
        <CardContent>
          <SettlementDailyReportActions
            validationQueue={
              report.validationQueue as DecisionValidationRow[]
            }
          />
        </CardContent>
      </Card>
    </>
  );
}
