import type { Metadata } from "next";
import {
  BrainCircuit,
  CheckCircle2,
  Clock3,
  MessageSquareText,
  ShieldCheck,
} from "lucide-react";

import { KpiCard, PageHeading } from "@/components/page-parts";
import { SettlementLearningPanel } from "@/components/settlement-learning-panel";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { getSettlementLearningData } from "@/lib/server-data";
import { formatRate, formatUsdt } from "@/lib/utils";

export const metadata: Metadata = {
  title: "结算学习与人工反馈",
};

function decisionVariant(status: string | undefined) {
  if (status === "ACCEPTED") return "green" as const;
  if (status === "REJECTED") return "red" as const;
  if (status === "MODIFIED") return "amber" as const;
  return "blue" as const;
}

function localTime(value: string) {
  return new Date(value).toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour12: false,
  });
}

export default async function SettlementLearningPage() {
  const data = await getSettlementLearningData();
  const summary = data.summary;

  return (
    <>
      <PageHeading
        title="结算学习与人工反馈"
        subtitle="Task 2.8 · Phase 1人工审核闭环 · VND独立90天学习窗口"
      />

      <div className="alert alert-warning settlement-shadow-alert">
        <ShieldCheck size={17} />
        <div>
          <strong>系统建议与人工执行完全隔离</strong>
          系统只保存建议，人工只保存最终判断。本页面不具备付款、补U、报价修改或交易能力。
        </div>
      </div>

      <div className="kpi-grid">
        <KpiCard
          label="90天系统建议"
          value={String(summary?.recommendation_count ?? 0)}
          note={<span>VND独立学习样本</span>}
          icon={BrainCircuit}
          color="#155eef"
        />
        <KpiCard
          label="已人工审核"
          value={String(summary?.reviewed_count ?? 0)}
          note={
            <span>
              接受 {summary?.accepted_count ?? 0} · 调整{" "}
              {summary?.modified_count ?? 0}
            </span>
          }
          icon={CheckCircle2}
          color="#0f9f78"
        />
        <KpiCard
          label="待审核"
          value={String(summary?.pending_count ?? 0)}
          note={<span>只等待人工决定</span>}
          icon={Clock3}
          color="#dc8b16"
        />
        <KpiCard
          label="风险反馈"
          value={String(
            Number(summary?.confirmed_risk_count ?? 0) +
              Number(summary?.ignored_risk_count ?? 0),
          )}
          note={
            <span>
              确认 {summary?.confirmed_risk_count ?? 0} · 忽略{" "}
              {summary?.ignored_risk_count ?? 0}
            </span>
          }
          icon={MessageSquareText}
          color="#7c5ce4"
        />
      </div>

      <Card>
        <CardHeader>
          <div>
            <h2 className="panel-title">Phase 1 审核工作流</h2>
            <div className="panel-subtitle">
              生成不可变建议快照，再追加人工决策和调整原因
            </div>
          </div>
          <Badge variant="violet">SHADOW MODE</Badge>
        </CardHeader>
        <CardContent>
          <SettlementLearningPanel
            key={data.recommendations
              .map(
                (row) =>
                  `${row.id}:${row.latestDecision?.id ?? "pending"}`,
              )
              .join("|")}
            recommendations={data.recommendations}
          />
        </CardContent>
      </Card>

      <Card className="learning-history-card">
        <CardHeader>
          <div>
            <h2 className="panel-title">90天建议与决策历史</h2>
            <div className="panel-subtitle">
              历史记录不可修改；修正通过追加新决策版本完成
            </div>
          </div>
          <Badge variant="blue">VND · 90 DAYS</Badge>
        </CardHeader>
        <CardContent>
          {data.recommendations.length === 0 ? (
            <div className="empty-state">
              <BrainCircuit size={25} />
              <strong>暂无学习样本</strong>
              生成第一条系统建议后，可开始人工审核。
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>建议时间</th>
                    <th>补U建议</th>
                    <th>报价建议</th>
                    <th>风险数</th>
                    <th>汇率判断</th>
                    <th>人工结果</th>
                    <th>最终决定</th>
                    <th>调整原因</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recommendations.map((recommendation) => {
                    const decision = recommendation.latestDecision;
                    const risks = Array.isArray(
                      recommendation.system_risk_alerts,
                    )
                      ? recommendation.system_risk_alerts
                      : [];
                    return (
                      <tr key={recommendation.id}>
                        <td>{localTime(recommendation.recommendation_time)}</td>
                        <td>
                          {recommendation.system_recommended_topup_usdt ===
                          null
                            ? "待市场数据"
                            : formatUsdt(
                                recommendation.system_recommended_topup_usdt,
                                2,
                              )}
                        </td>
                        <td>
                          {recommendation.system_recommended_quote_rate ===
                          null
                            ? "待市场数据"
                            : formatRate(
                                recommendation.system_recommended_quote_rate,
                                4,
                              )}
                        </td>
                        <td>{risks.length}</td>
                        <td>
                          <span className="mono">
                            {recommendation.system_fx_judgment}
                          </span>
                        </td>
                        <td>
                          <Badge
                            variant={decisionVariant(
                              decision?.acceptance_status,
                            )}
                          >
                            {decision?.acceptance_status ?? "PENDING"}
                          </Badge>
                        </td>
                        <td>
                          {decision?.final_execution_decision ??
                            "等待人工"}
                        </td>
                        <td>
                          <span
                            className="learning-reason-preview"
                            title={decision?.adjustment_reason ?? ""}
                          >
                            {decision?.adjustment_reason ?? "—"}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
