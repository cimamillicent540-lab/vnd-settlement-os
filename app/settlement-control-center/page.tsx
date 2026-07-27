import type { Metadata } from "next";
import {
  AlertTriangle,
  Banknote,
  BrainCircuit,
  Clock3,
  Gauge,
  Landmark,
  ShieldCheck,
} from "lucide-react";

import { KpiCard, PageHeading } from "@/components/page-parts";
import { SettlementControlActions } from "@/components/settlement-control-actions";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { getSettlementControlCenterData } from "@/lib/server-data";
import {
  formatRate,
  formatUsdt,
  formatVnd,
} from "@/lib/utils";

export const metadata: Metadata = {
  title: "VND结算运营控制中心",
};

function percent(value: string | number | null | undefined) {
  if (value === null || value === undefined) return "—";
  return `${(Number(value) * 100).toFixed(2)}%`;
}

function statusVariant(status: string | undefined) {
  if (
    status === "CRITICAL" ||
    status === "RISK" ||
    status === "HIGH"
  ) {
    return "red" as const;
  }
  if (
    status === "WARNING" ||
    status === "WAITING_INPUT" ||
    status === "MANUAL_CONFIRMATION_REQUIRED"
  ) {
    return "amber" as const;
  }
  if (
    status === "NORMAL" ||
    status === "BUY_VND_OPPORTUNITY"
  ) {
    return "green" as const;
  }
  return "blue" as const;
}

function localTime(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour12: false,
  });
}

type SavedRisk = {
  code: string;
  severity: "INFO" | "WARNING" | "HIGH";
  message: string;
  source: string;
};

export default async function SettlementControlCenterPage() {
  const data = await getSettlementControlCenterData();
  const current = data.current;
  const latestSnapshotRisks = Array.isArray(
    data.latestSnapshot?.risk_alerts,
  )
    ? (data.latestSnapshot.risk_alerts as SavedRisk[])
    : [];
  const latestReviews = data.latestRiskReviews as Array<{
    risk_code: string;
    review_version: number;
    human_judgment: "CONFIRMED" | "IGNORED";
    human_note: string | null;
  }>;
  const reviewByRisk = new Map(
    latestReviews.map((review) => [review.risk_code, review]),
  );

  return (
    <>
      <PageHeading
        title="VND结算运营控制中心"
        subtitle="Task 2.9 · Shadow Pricing、Settlement Intelligence、Execution Guard与Learning每日聚合"
      />

      <div className="alert alert-warning settlement-shadow-alert">
        <ShieldCheck size={17} />
        <div>
          <strong>Shadow Mode · 人工查看与记录</strong>
          本页只聚合数据、展示建议并记录人工风险判断；不会付款、补U、修改客户报价、自动采集汇率或交易。
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
          note={
            <span>
              可用比例 {percent(current.funds.availableFundsRatio)}
            </span>
          }
          icon={Gauge}
          color="#0f9f78"
        />
        <KpiCard
          label="Reserve Balance"
          value={formatVnd(current.balances.reserveBalanceVnd)}
          note={<span>上游保证金锁定</span>}
          icon={Landmark}
          color="#7c5ce4"
        />
        <KpiCard
          label="资金风险状态"
          value={current.funds.status}
          note={
            <span>
              覆盖率 {percent(current.funds.coverageRatio)}
            </span>
          }
          icon={AlertTriangle}
          color={
            current.funds.status === "CRITICAL"
              ? "#d33d45"
              : current.funds.status === "WARNING"
                ? "#dc8b16"
                : "#0f9f78"
          }
        />
      </div>

      <div className="control-grid-2">
        <Card>
          <CardHeader>
            <div>
              <h2 className="panel-title">今日资金压力预测</h2>
              <div className="panel-subtitle">
                历史小时模型 + Task 2.8近90天人工调整
              </div>
            </div>
            <Badge
              variant={
                current.pressure.learningApplied ? "violet" : "blue"
              }
            >
              {current.pressure.learningApplied
                ? "LEARNING APPLIED"
                : "HISTORICAL BASELINE"}
            </Badge>
          </CardHeader>
          <CardContent>
            <div className="control-metric-grid">
              <div>
                <span>今日预计Payout</span>
                <strong>
                  {formatVnd(current.pressure.forecastPayoutVnd)}
                </strong>
              </div>
              <div>
                <span>今日预计Payin</span>
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
                <span>16:00-23:00高峰压力</span>
                <strong>
                  {formatVnd(current.pressure.peakPressureVnd)}
                </strong>
              </div>
            </div>
            <div className="alert alert-info control-model-note">
              90天人工补U调整对应的可结算修正：
              {formatVnd(current.pressure.learningAdjustmentVnd)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <h2 className="panel-title">补U建议</h2>
              <div className="panel-subtitle">
                保证资金、汇率机会、降低成本与综合平衡
              </div>
            </div>
            <Badge
              variant={
                current.topup.topupRecommended ? "amber" : "green"
              }
            >
              {current.topup.topupRecommended
                ? "TOPUP RECOMMENDED"
                : "NO TOPUP"}
            </Badge>
          </CardHeader>
          <CardContent>
            <div className="control-topup-hero">
              {current.topup.recommendedTopupUsdt
                ? formatUsdt(
                    current.topup.recommendedTopupUsdt,
                    2,
                  )
                : current.topup.topupRecommended
                  ? "待人工P2P输入"
                  : "0.00 USDT"}
            </div>
            <div className="metric-list">
              <div className="metric-row">
                <span className="metric-label">建议时间</span>
                <span className="metric-value">
                  {current.topup.recommendedTime}
                </span>
              </div>
              <div className="metric-row">
                <span className="metric-label">预计库存</span>
                <span className="metric-value">
                  {formatVnd(current.topup.projectedInventoryVnd)}
                </span>
              </div>
              <div className="metric-row">
                <span className="metric-label">
                  5万USDT基础限制
                </span>
                <span className="metric-value">
                  {formatVnd(current.topup.maximumInventoryVnd)}
                </span>
              </div>
              <div className="metric-row">
                <span className="metric-label">库存确认</span>
                <Badge
                  variant={statusVariant(
                    current.topup.inventoryLimitStatus,
                  )}
                >
                  {current.topup.inventoryLimitStatus}
                </Badge>
              </div>
            </div>
            <div className="control-objectives">
              {current.topup.objectives.map((objective) => (
                <Badge key={objective} variant="blue">
                  {objective}
                </Badge>
              ))}
            </div>
            <ul className="settlement-reason-list">
              {current.topup.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      <Card className="control-section-gap">
        <CardHeader>
          <div>
            <h2 className="panel-title">Payout Execution Guard</h2>
            <div className="panel-subtitle">
              只聚合付款准备校验状态；文件准备仍需人工审核，不会提交第三方或付款
            </div>
          </div>
          <Badge
            variant={statusVariant(current.executionGuard.status)}
          >
            {current.executionGuard.status}
          </Badge>
        </CardHeader>
        <CardContent>
          <div className="control-metric-grid">
            <div>
              <span>校验订单</span>
              <strong>{current.executionGuard.totalCount}</strong>
            </div>
            <div>
              <span>READY</span>
              <strong>{current.executionGuard.readyCount}</strong>
            </div>
            <div>
              <span>BLOCKED</span>
              <strong>{current.executionGuard.blockedCount}</strong>
            </div>
            <div>
              <span>待人工复核</span>
              <strong>{current.executionGuard.warningCount}</strong>
            </div>
          </div>
          <div className="alert alert-warning control-model-note">
            预计付款总扣款：
            {formatVnd(
              current.executionGuard.totalRequiredGrossDebitVnd,
            )}
            。该状态仅作为风险输入，不触发任何自动付款。
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <h2 className="panel-title">商户报价建议</h2>
            <div className="panel-subtitle">
              XE基础、公司调整、人工P2P成本、商户贡献及千2/千5边界
            </div>
          </div>
          <Badge variant="violet">SHADOW QUOTE ONLY</Badge>
        </CardHeader>
        <CardContent>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>商户</th>
                  <th>当前报价</th>
                  <th>系统建议</th>
                  <th>当前利润率</th>
                  <th>目标利润率</th>
                  <th>交易量等级</th>
                  <th>风险等级</th>
                  <th>交易量</th>
                  <th>利润贡献</th>
                </tr>
              </thead>
              <tbody>
                {current.merchants.map((merchant) => (
                  <tr key={merchant.merchantName}>
                    <td>{merchant.merchantName}</td>
                    <td>
                      {merchant.currentQuoteRate
                        ? formatRate(merchant.currentQuoteRate, 4)
                        : "—"}
                    </td>
                    <td>
                      {merchant.systemRecommendedQuoteRate
                        ? formatRate(
                            merchant.systemRecommendedQuoteRate,
                            4,
                          )
                        : "待人工汇率"}
                    </td>
                    <td>{percent(merchant.currentProfitMargin)}</td>
                    <td>{percent(merchant.targetProfitMargin)}</td>
                    <td>
                      <Badge variant="blue">
                        {merchant.volumeLevel}
                      </Badge>
                    </td>
                    <td>
                      <Badge
                        variant={statusVariant(merchant.riskLevel)}
                      >
                        {merchant.riskLevel}
                      </Badge>
                    </td>
                    <td>
                      {formatUsdt(
                        merchant.transactionVolumeUsdt,
                        2,
                      )}
                    </td>
                    <td>
                      {formatUsdt(merchant.contributionUsdt, 2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <div className="control-grid-2 control-section-gap">
        <Card>
          <CardHeader>
            <div>
              <h2 className="panel-title">汇率机会分析</h2>
              <div className="panel-subtitle">
                所有汇率继续由人工录入，不接入自动采集API
              </div>
            </div>
            <Badge
              variant={statusVariant(
                current.fx.opportunityStatus,
              )}
            >
              {current.fx.opportunityStatus}
            </Badge>
          </CardHeader>
          <CardContent>
            <div className="metric-list">
              <div className="metric-row">
                <span className="metric-label">P2P输入价格</span>
                <span className="metric-value">
                  {current.fx.p2pCostRate
                    ? formatRate(current.fx.p2pCostRate, 4)
                    : "待人工录入"}
                </span>
              </div>
              <div className="metric-row">
                <span className="metric-label">XE价格</span>
                <span className="metric-value">
                  {current.fx.xeRate
                    ? formatRate(current.fx.xeRate, 4)
                    : "待人工录入"}
                </span>
              </div>
              <div className="metric-row">
                <span className="metric-label">
                  公司当前影子报价
                </span>
                <span className="metric-value">
                  {current.fx.companyQuoteRate
                    ? formatRate(current.fx.companyQuoteRate, 4)
                    : "待人工汇率"}
                </span>
              </div>
              <div className="metric-row">
                <span className="metric-label">P2P - XE差价</span>
                <span className="metric-value">
                  {current.fx.spreadVndPerUsdt
                    ? formatRate(
                        current.fx.spreadVndPerUsdt,
                        4,
                      )
                    : "—"}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <h2 className="panel-title">风险中心</h2>
              <div className="panel-subtitle">
                系统提示 + 人工确认、忽略与备注
              </div>
            </div>
            <Badge variant="amber">
              {current.risks.length} ALERTS
            </Badge>
          </CardHeader>
          <CardContent>
            <div className="settlement-risk-list">
              {current.risks.map((risk) => {
                const review = reviewByRisk.get(risk.code);
                return (
                  <div className="settlement-risk-item" key={risk.code}>
                    <Badge variant={statusVariant(risk.severity)}>
                      {risk.severity}
                    </Badge>
                    <div>
                      <strong>{risk.code}</strong>
                      <span>{risk.message}</span>
                      <span>
                        来源：{risk.source}
                        {review
                          ? ` · 人工：${review.human_judgment}`
                          : ""}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="control-section-gap">
        <CardHeader>
          <div>
            <h2 className="panel-title">每日快照与人工风险记录</h2>
            <div className="panel-subtitle">
              所有建议和人工判断均追加保存，不覆盖历史
            </div>
          </div>
          <Badge variant="blue">
            {data.savedSnapshots.length} SAVED
          </Badge>
        </CardHeader>
        <CardContent>
          <SettlementControlActions
            key={data.latestSnapshot?.id ?? "no-snapshot"}
            latestSnapshotId={data.latestSnapshot?.id ?? null}
            latestSnapshotRisks={latestSnapshotRisks}
            latestReviews={latestReviews}
          />
        </CardContent>
      </Card>

      <Card className="control-section-gap">
        <CardHeader>
          <div>
            <h2 className="panel-title">AI建议历史</h2>
            <div className="panel-subtitle">
              Task 2.8过去90天系统建议、人工决定和调整原因
            </div>
          </div>
          <Badge variant="violet">
            {data.learningHistory.length} RECORDS
          </Badge>
        </CardHeader>
        <CardContent>
          {data.learningHistory.length === 0 ? (
            <div className="empty-state">
              <BrainCircuit size={25} />
              <strong>暂无90天学习记录</strong>
              请在“人工反馈学习”页面生成并审核建议。
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>建议时间</th>
                    <th>系统补U建议</th>
                    <th>系统报价</th>
                    <th>汇率判断</th>
                    <th>人工决定</th>
                    <th>人工补U</th>
                    <th>人工报价</th>
                    <th>调整原因</th>
                  </tr>
                </thead>
                <tbody>
                  {data.learningHistory.map((row) => (
                    <tr key={row.id}>
                      <td>{localTime(row.recommendation_time)}</td>
                      <td>
                        {row.system_recommended_topup_usdt === null
                          ? "—"
                          : formatUsdt(
                              row.system_recommended_topup_usdt,
                              2,
                            )}
                      </td>
                      <td>
                        {row.system_recommended_quote_rate === null
                          ? "—"
                          : formatRate(
                              row.system_recommended_quote_rate,
                              4,
                            )}
                      </td>
                      <td>{row.system_fx_judgment}</td>
                      <td>
                        {row.latestDecision?.acceptance_status ??
                          "PENDING"}
                      </td>
                      <td>
                        {row.latestDecision?.final_topup_usdt ===
                          null ||
                        row.latestDecision?.final_topup_usdt ===
                          undefined
                          ? "—"
                          : formatUsdt(
                              row.latestDecision.final_topup_usdt,
                              2,
                            )}
                      </td>
                      <td>
                        {row.latestDecision?.final_quote_rate ===
                          null ||
                        row.latestDecision?.final_quote_rate ===
                          undefined
                          ? "—"
                          : formatRate(
                              row.latestDecision.final_quote_rate,
                              4,
                            )}
                      </td>
                      <td>
                        {row.latestDecision?.adjustment_reason ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="control-data-cutoff">
        <Clock3 size={14} />
        Account History：{current.dataCutoffs.accountHistoryLocal ?? "—"}{" "}
        {current.dataCutoffs.accountHistoryTimezone ?? ""} · Payout：
        {localTime(current.dataCutoffs.payoutUtc)} · Shadow Pricing：
        {localTime(current.dataCutoffs.shadowPricingRun)}
      </div>
    </>
  );
}
