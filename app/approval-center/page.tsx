import type { Metadata } from "next";
import {
  BadgeDollarSign,
  BrainCircuit,
  ClipboardCheck,
  ShieldAlert,
} from "lucide-react";

import {
  ApprovalActionForm,
  ApprovalQueueSync,
} from "@/components/approval-center-actions";
import { KpiCard, PageHeading } from "@/components/page-parts";
import { SsrDataFallback } from "@/components/ssr-data-fallback";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  classifyServerDataFailure,
  getHumanApprovalCenterData,
} from "@/lib/server-data";
import {
  loadSsrPageData,
  SSR_QUERY_PLAN,
} from "@/lib/ssr-performance";
import { formatRate, formatUsdt, formatVnd } from "@/lib/utils";

export const metadata: Metadata = {
  title: "VND Human Approval Center",
};

function riskVariant(level: string) {
  if (level === "HIGH") return "red" as const;
  if (level === "MEDIUM") return "amber" as const;
  return "green" as const;
}

function actionVariant(action: string | null) {
  if (action === "REJECTED" || action === "IGNORED") {
    return "red" as const;
  }
  if (action === "MODIFIED" || action === "ADJUSTED") {
    return "amber" as const;
  }
  if (action) return "green" as const;
  return "gray" as const;
}

export default async function ApprovalCenterPage() {
  let data: Awaited<ReturnType<typeof getHumanApprovalCenterData>>;
  try {
    data = await loadSsrPageData({
      page: "/approval-center",
      plannedQueries: SSR_QUERY_PLAN.approvalCenter.plannedQueries,
      loader: getHumanApprovalCenterData,
    });
  } catch (error) {
    return (
      <SsrDataFallback
        title="VND Human Approval Center"
        subtitle="审批数据查询降级 · Phase 1 Shadow Mode"
        failureCode={classifyServerDataFailure(error)}
      />
    );
  }
  const queue = data.queue;
  const topups = queue.filter((row) => row.request_type === "TOPUP");
  const quotes = queue.filter((row) => row.request_type === "QUOTE");
  const risks = queue.filter((row) => row.request_type === "RISK");
  const pendingCount = queue.filter(
    (row) => !row.latest_action_id,
  ).length;

  return (
    <>
      <PageHeading
        title="VND Human Approval Center"
        subtitle="Task 2.16 · AI建议 + 人工审核工作流（Phase 1）"
        actions={<Badge variant="violet">90天学习闭环</Badge>}
      />

      <div className="alert alert-warning settlement-shadow-alert">
        <ClipboardCheck size={17} />
        <div>
          <strong>Shadow Mode · 人工审批不等于执行授权</strong>
          仅admin和settlement_operator可追加审批。接受建议也不会自动付款、补U、修改客户报价或交易。
        </div>
      </div>

      <div className="kpi-grid">
        <KpiCard
          color="#155eef"
          icon={ClipboardCheck}
          label="今日审批请求"
          note={<span>待人工处理 {pendingCount} 项</span>}
          value={String(queue.length)}
        />
        <KpiCard
          color="#7c5ce4"
          icon={BrainCircuit}
          label="90天人工决定"
          note={
            <span>
              接受 {data.learningSummary.acceptedCount} · 修改{" "}
              {data.learningSummary.modifiedCount}
            </span>
          }
          value={String(data.learningSummary.decisionCount)}
        />
        <KpiCard
          color="#ef8b2c"
          icon={BadgeDollarSign}
          label="待结果利润记录"
          note={<span>Cash + Economic Profit 均保留</span>}
          value={String(
            data.learningSummary.pendingProfitResultCount,
          )}
        />
        <KpiCard
          color="#0e9f6e"
          icon={ShieldAlert}
          label="执行隔离"
          note={<span>所有自动资金动作固定关闭</span>}
          value="SHADOW"
        />
      </div>

      <Card className="approval-section-gap">
        <CardHeader>
          <div>
            <h2>每日AI建议审批队列</h2>
            <p>
              来源建议：
              {data.latestRecommendation
                ? new Date(
                    data.latestRecommendation.recommendation_time,
                  ).toLocaleString("zh-CN", {
                    timeZone: "Asia/Shanghai",
                    hour12: false,
                  })
                : "暂无"}
            </p>
          </div>
          <Badge variant={queue.length ? "green" : "gray"}>
            {queue.length ? "QUEUE_READY" : "WAITING_SYNC"}
          </Badge>
        </CardHeader>
        <CardContent>
          <ApprovalQueueSync
            queueExists={queue.length > 0}
            recommendationId={data.recommendationId}
          />
        </CardContent>
      </Card>

      <Card className="approval-section-gap">
        <CardHeader>
          <div>
            <h2>补U建议审批</h2>
            <p>预计成本与覆盖时间仅供人工判断，不生成补U指令</p>
          </div>
          <Badge variant="blue">{topups.length} 项</Badge>
        </CardHeader>
        <CardContent>
          {topups.length === 0 ? (
            <div className="empty-state compact">
              生成审批队列后显示补U建议。
            </div>
          ) : (
            <div className="approval-request-list">
              {topups.map((row) => (
                <article key={row.id} className="approval-request-card">
                  <header>
                    <div>
                      <strong>VND日内补U建议</strong>
                      <span>{row.ai_reason}</span>
                    </div>
                    <Badge variant={riskVariant(row.ai_risk_level)}>
                      {row.ai_risk_level}
                    </Badge>
                  </header>
                  <div className="approval-request-metrics">
                    <section>
                      <span>AI建议数量</span>
                      <strong>
                        {formatUsdt(row.ai_topup_usdt ?? 0, 2)}
                      </strong>
                    </section>
                    <section>
                      <span>预计成本</span>
                      <strong>
                        {row.estimated_topup_cost_vnd === null
                          ? "缺少P2P人工价"
                          : formatVnd(
                              row.estimated_topup_cost_vnd,
                            )}
                      </strong>
                    </section>
                    <section>
                      <span>预计覆盖时间</span>
                      <strong>{row.estimated_coverage_time}</strong>
                    </section>
                    <section>
                      <span>最新结果</span>
                      <Badge
                        variant={actionVariant(
                          row.latest_action_type,
                        )}
                      >
                        {row.latest_action_type ?? "PENDING"}
                      </Badge>
                    </section>
                  </div>
                  <ApprovalActionForm
                    approvalRequest={row}
                    reasons={data.reasonCatalog}
                  />
                </article>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="approval-section-gap">
        <CardHeader>
          <div>
            <h2>商户报价建议审批</h2>
            <p>当前报价、AI报价、预计利润影响与商户等级同时保留</p>
          </div>
          <Badge variant="blue">{quotes.length} 个商户</Badge>
        </CardHeader>
        <CardContent>
          {quotes.length === 0 ? (
            <div className="empty-state compact">
              当前建议没有可计算的商户报价审批项。
            </div>
          ) : (
            <div className="approval-quote-grid">
              {quotes.map((row) => (
                <article key={row.id} className="approval-request-card">
                  <header>
                    <div>
                      <strong>{row.merchant_name}</strong>
                      <span>{row.ai_reason}</span>
                    </div>
                    <Badge variant={riskVariant(row.ai_risk_level)}>
                      {row.merchant_tier} · {row.ai_risk_level}
                    </Badge>
                  </header>
                  <div className="approval-request-metrics approval-quote-metrics">
                    <section>
                      <span>当前报价</span>
                      <strong>
                        {formatRate(row.current_quote_rate ?? 0, 4)}
                      </strong>
                    </section>
                    <section>
                      <span>AI建议报价</span>
                      <strong>
                        {formatRate(row.ai_quote_rate ?? 0, 4)}
                      </strong>
                    </section>
                    <section>
                      <span>预计利润影响</span>
                      <strong>
                        {formatUsdt(
                          row.predicted_profit_impact_usdt ?? 0,
                          4,
                        )}
                      </strong>
                    </section>
                  </div>
                  <ApprovalActionForm
                    approvalRequest={row}
                    reasons={data.reasonCatalog}
                  />
                </article>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="approval-section-gap">
        <CardHeader>
          <div>
            <h2>风险处理建议</h2>
            <p>人工可确认、调整或忽略；每次判断均必须记录原因</p>
          </div>
          <Badge variant={risks.length ? "amber" : "green"}>
            {risks.length} 项
          </Badge>
        </CardHeader>
        <CardContent>
          {risks.length === 0 ? (
            <div className="empty-state compact">
              当前建议无风险提醒，或审批队列尚未生成。
            </div>
          ) : (
            <div className="approval-risk-grid">
              {risks.map((row) => (
                <article key={row.id} className="approval-request-card">
                  <header>
                    <div>
                      <strong>{row.risk_code}</strong>
                      <span>{row.risk_message}</span>
                    </div>
                    <Badge variant={riskVariant(row.ai_risk_level)}>
                      AI {row.ai_risk_level}
                    </Badge>
                  </header>
                  <ApprovalActionForm
                    approvalRequest={row}
                    reasons={data.reasonCatalog}
                  />
                </article>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="approval-section-gap">
        <CardHeader>
          <div>
            <h2>学习与审计边界</h2>
            <p>人工原因为90天模型分析提供证据，但本阶段不自动优化</p>
          </div>
        </CardHeader>
        <CardContent>
          <div className="approval-boundary-grid">
            <section>
              <strong>不可变历史</strong>
              <span>旧建议和旧审批不可更新、不可删除；修正追加新版本。</span>
            </section>
            <section>
              <strong>双利润结果</strong>
              <span>
                Cash Profit与Economic Profit分别保存；无实际结果时明确标记PENDING_OUTCOME。
              </span>
            </section>
            <section>
              <strong>最小权限</strong>
              <span>仅admin与settlement_operator可查看和追加审批。</span>
            </section>
            <section>
              <strong>执行隔离</strong>
              <span>
                actual_execution_performed固定为false，所有自动动作固定关闭。
              </span>
            </section>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
