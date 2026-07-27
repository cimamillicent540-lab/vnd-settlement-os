import type { Metadata } from "next";
import {
  Banknote,
  Clock3,
  Gauge,
  Landmark,
  ShieldCheck,
  TrendingUp,
} from "lucide-react";

import { DailyOperationActions } from "@/components/daily-operation-actions";
import { KpiCard, PageHeading } from "@/components/page-parts";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { getDailyOperationData } from "@/lib/server-data";
import { formatRate, formatUsdt, formatVnd } from "@/lib/utils";

export const metadata: Metadata = {
  title: "VND每日结算运营工作流",
};

type RiskAlert = {
  code: string;
  severity?: string;
  message?: string;
};

function percent(value: string | number | null | undefined) {
  if (value === null || value === undefined) return "—";
  return `${(Number(value) * 100).toFixed(2)}%`;
}

function localTime(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour12: false,
  });
}

function riskVariant(level: string | null | undefined) {
  if (level === "HIGH") return "red" as const;
  if (level === "MEDIUM") return "amber" as const;
  return "green" as const;
}

export default async function DailyOperationPage() {
  const data = await getDailyOperationData();
  const current = data.current;
  const day = data.todayDayDecision;
  const risk = data.todayRiskCheck;
  const end = data.todayEndReview;
  const systemRisks = Array.isArray(
    data.todayRecommendation?.system_risk_alerts,
  )
    ? (data.todayRecommendation.system_risk_alerts as RiskAlert[])
    : [];

  return (
    <>
      <PageHeading
        title="VND Daily Settlement Operating Workflow"
        subtitle={`Task 2.13 · 运营日 ${data.operatingDate} · 固定11:00 / 16:00 / 23:00人工节点`}
      />

      <div className="alert alert-warning settlement-shadow-alert">
        <ShieldCheck size={17} />
        <div>
          <strong>Shadow Mode · 建议、人工决策与学习证据</strong>
          本页不自动补U、付款、修改报价、采集汇率或交易。即使人工选择“接受”，真实执行仍必须离开系统另行办理。
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
          value={formatVnd(current.balances.settleableBalanceVnd)}
          note={<span>50%可结算层</span>}
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
          label="当前可用资金比例"
          value={percent(current.funds.availableFundsRatio)}
          note={
            <span>
              Account History截止 {localTime(current.dataCutoffs.accountHistoryUtc)}
            </span>
          }
          icon={TrendingUp}
          color="#dc8b16"
        />
      </div>

      <div className="daily-operation-timeline">
        <Card>
          <CardHeader>
            <div>
              <h2 className="panel-title">11:00 日间决策</h2>
              <div className="panel-subtitle">
                资金预测、10%安全缓冲、50%可结算比例与人工汇率观察
              </div>
            </div>
            <Badge variant={day ? "green" : "blue"}>
              {day ? day.capture_status : "PENDING"}
            </Badge>
          </CardHeader>
          <CardContent>
            <div className="control-metric-grid">
              <div>
                <span>今日预计 Payin</span>
                <strong>
                  {formatVnd(day?.forecast_payin_vnd ?? current.pressure.forecastPayinVnd)}
                </strong>
              </div>
              <div>
                <span>今日预计 Payout</span>
                <strong>
                  {formatVnd(day?.forecast_payout_vnd ?? current.pressure.forecastPayoutVnd)}
                </strong>
              </div>
              <div>
                <span>净资金需求</span>
                <strong>
                  {formatVnd(day?.forecast_net_demand_vnd ?? current.pressure.forecastNetDemandVnd)}
                </strong>
              </div>
              <div>
                <span>16:00–23:00 压力</span>
                <strong>
                  {formatVnd(day?.peak_16_23_pressure_vnd ?? current.pressure.peakPressureVnd)}
                </strong>
              </div>
            </div>
            <div className="daily-operation-summary">
              <section>
                <span>补U建议</span>
                <strong>
                  {day
                    ? day.topup_recommended
                      ? formatUsdt(day.recommended_topup_usdt ?? 0, 2)
                      : "无需补U"
                    : "保存人工汇率后生成"}
                </strong>
                <small>
                  {day?.recommended_coverage_time ?? current.topup.recommendedTime}
                </small>
              </section>
              <section>
                <span>人工汇率机会</span>
                <strong>{day?.fx_opportunity_status ?? "待录入"}</strong>
                <small>
                  {day
                    ? `P2P ${formatRate(day.binance_p2p_rate, 4)} · 上游 ${formatRate(day.upstream_quote_rate, 4)} · XE ${formatRate(day.xe_rate, 4)}`
                    : "无API自动采集"}
                </small>
              </section>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <h2 className="panel-title">16:00 资金压力检查</h2>
              <div className="panel-subtitle">
                五类风险只提醒，不执行
              </div>
            </div>
            <Badge variant={riskVariant(risk?.risk_level)}>
              {risk?.risk_level ?? "PENDING"}
            </Badge>
          </CardHeader>
          <CardContent>
            <div className="daily-operation-risk-grid">
              {[
                ["Payout集中", risk?.payout_concentration_risk],
                ["Settleable不足", risk?.settleable_insufficient_risk],
                ["利润跌破千2", risk?.profit_below_0_2_percent_risk],
                ["汇率异常", risk?.fx_anomaly_risk],
                ["国际市场风险", risk?.international_market_risk],
              ].map(([label, active]) => (
                <section key={String(label)}>
                  <span>{label}</span>
                  <strong className={active ? "trend-down" : "trend-up"}>
                    {risk ? (active ? "RISK" : "CLEAR") : "待检查"}
                  </strong>
                </section>
              ))}
            </div>
            <div className="control-data-cutoff">
              风险分数 {risk?.risk_score ?? "—"} / 5 ·
              国际市场备注 {data.marketNotes.length} 条 ·
              捕获时间 {localTime(risk?.captured_at)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <h2 className="panel-title">23:00 日终复盘</h2>
              <div className="panel-subtitle">
                双利润、系统原建议、人工最终结果与90天学习记录
              </div>
            </div>
            <Badge variant={end ? "green" : "violet"}>
              {end ? end.acceptance_status : "PENDING"}
            </Badge>
          </CardHeader>
          <CardContent>
            <div className="daily-profit-pair">
              <section>
                <span>Cash Profit</span>
                <strong>
                  {formatUsdt(end?.cash_profit_usdt ?? data.report.profit.cashProfitUsdt, 2)}
                </strong>
                <small>财务现金视角</small>
              </section>
              <section>
                <span>Economic Profit</span>
                <strong>
                  {formatUsdt(end?.economic_profit_usdt ?? data.report.profit.economicProfitUsdt, 2)}
                </strong>
                <small>经营决策与学习视角</small>
              </section>
            </div>
            <div className="daily-operation-summary">
              <section>
                <span>人工最终结果</span>
                <strong>{end?.acceptance_status ?? "待复盘"}</strong>
                <small>
                  {end
                    ? `${end.adjustment_reason_category} · ${end.adjustment_reason}`
                    : "接受、修改或拒绝均须填写原因"}
                </small>
              </section>
              <section>
                <span>学习链路</span>
                <strong>{end ? "已写入" : "待写入"}</strong>
                <small>原建议 + 人工结果 + 原因 + 最终双利润</small>
              </section>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="daily-operation-section-gap">
        <CardHeader>
          <div>
            <h2 className="panel-title">今日人工工作区</h2>
            <div className="panel-subtitle">
              节点按顺序追加保存，历史建议与人工决策不可覆盖
            </div>
          </div>
          <Badge variant="amber">NO EXECUTION</Badge>
        </CardHeader>
        <CardContent>
          <DailyOperationActions
            dayDecisionId={day?.id ?? null}
            riskCheckId={risk?.id ?? null}
            recommendedTopupUsdt={
              day?.recommended_topup_usdt ?? null
            }
            recommendedQuoteRate={
              data.todayRecommendation?.system_recommended_quote_rate ??
              null
            }
            systemRisks={systemRisks}
            endReviewCompleted={Boolean(end)}
          />
        </CardContent>
      </Card>

      <Card className="daily-operation-section-gap">
        <CardHeader>
          <div>
            <h2 className="panel-title">不可变工作流历史</h2>
            <div className="panel-subtitle">
              每个运营日分别记录11:00、16:00和23:00状态
            </div>
          </div>
          <Badge variant="blue">
            {data.workflowHistory.length} DAYS
          </Badge>
        </CardHeader>
        <CardContent>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>运营日</th>
                  <th>11:00</th>
                  <th>16:00</th>
                  <th>23:00</th>
                  <th>风险等级</th>
                  <th>人工结果</th>
                </tr>
              </thead>
              <tbody>
                {data.workflowHistory.length === 0 ? (
                  <tr>
                    <td colSpan={6}>暂无历史；系统不会生成虚假快照。</td>
                  </tr>
                ) : (
                  data.workflowHistory.map((row) => (
                    <tr key={row.operating_date}>
                      <td>{row.operating_date}</td>
                      <td>{row.day_decision_status}</td>
                      <td>{row.risk_check_status}</td>
                      <td>{row.end_review_status}</td>
                      <td>{row.risk_level ?? "—"}</td>
                      <td>{row.acceptance_status ?? "—"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <div className="control-data-cutoff daily-operation-section-gap">
        <Clock3 size={14} />
        Account History截止 {localTime(current.dataCutoffs.accountHistoryUtc)} ·
        Payout截止 {localTime(current.dataCutoffs.payoutUtc)} ·
        Topup截止 {current.dataCutoffs.topupDate ?? "—"} ·
        数据状态 {current.dataCutoffs.completeness}
      </div>
    </>
  );
}
