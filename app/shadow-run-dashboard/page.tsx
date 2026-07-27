import type { Metadata } from "next";
import {
  Activity,
  BookOpenCheck,
  BrainCircuit,
  CheckCircle2,
  Gauge,
  Globe2,
  LineChart,
  PencilLine,
  ShieldCheck,
  Target,
  XCircle,
} from "lucide-react";

import { KpiCard, PageHeading } from "@/components/page-parts";
import { ShadowRunMarketNoteForm } from "@/components/shadow-run-market-note-form";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
} from "@/components/ui/card";
import { getShadowRunDashboardData } from "@/lib/server-data";
import { formatRate, formatUsdt } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Shadow Run Dashboard",
};

type JsonRecord = Record<string, unknown>;

const categoryLabels: Record<string, string> = {
  VND_POLICY: "越南政策变化",
  INTERNATIONAL_GEOPOLITICS: "国际局势",
  FED_EVENT: "美联储事件",
  BTC_VOLATILITY: "BTC波动",
  FX_ANOMALY: "汇率异常",
  PAYMENT_COMPANY_RISK: "支付公司风险",
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

function statusVariant(status: string | null | undefined) {
  if (status === "ACCEPTED") return "green" as const;
  if (status === "MODIFIED") return "amber" as const;
  if (status === "REJECTED") return "red" as const;
  return "gray" as const;
}

function severityVariant(severity: string | null | undefined) {
  if (severity === "HIGH") return "red" as const;
  if (severity === "WARNING") return "amber" as const;
  return "blue" as const;
}

function suggestedValue(
  type: string,
  value: unknown,
): string {
  const record =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as JsonRecord)
      : null;
  if (type === "TOPUP") {
    const amount = record?.recommendedTopupUsdt;
    return amount === null || amount === undefined
      ? "未建议金额"
      : formatUsdt(String(amount), 2);
  }
  if (type === "QUOTE") {
    const rate = record?.recommendedQuoteRate;
    return rate === null || rate === undefined
      ? "未建议报价"
      : formatRate(String(rate), 4);
  }
  const risks = Array.isArray(value) ? value : [];
  return `${risks.length} 条风险提醒`;
}

function finalValue(type: string, value: unknown): string {
  const record =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as JsonRecord)
      : null;
  if (type === "TOPUP") {
    const amount = record?.finalTopupUsdt;
    return amount === null || amount === undefined
      ? "未填写"
      : formatUsdt(String(amount), 2);
  }
  if (type === "QUOTE") {
    const rate = record?.finalQuoteRate;
    return rate === null || rate === undefined
      ? "未填写"
      : formatRate(String(rate), 4);
  }
  const judgments = Array.isArray(value) ? value : [];
  return `${judgments.length} 条人工判断`;
}

function asArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

export default async function ShadowRunDashboardPage() {
  const dashboard = await getShadowRunDashboardData();
  const metrics = dashboard.latestMetrics;
  const accuracy = dashboard.accuracy90d;
  const review = dashboard.yesterdayReview;
  const systemSuggestions = asArray(
    review?.system_major_suggestions,
  );
  const humanAdjustments = asArray(
    review?.human_major_adjustments,
  );
  const learningRecords = asArray(review?.learning_records);

  return (
    <>
      <PageHeading
        title="Shadow Run Dashboard"
        subtitle={`Task 2.12 · 90天观察窗口 · 最新观测日 ${metrics?.shadow_date ?? "暂无记录"}`}
      />

      <div className="alert alert-warning settlement-shadow-alert">
        <ShieldCheck size={17} />
        <div>
          <strong>Shadow Mode · 只记录“系统建议是否有效”</strong>
          本页只做聚合、人工观察和描述性准确率统计；不会自动优化模型、付款、补U、修改报价或交易。
        </div>
      </div>

      <div className="shadow-run-kpi-grid">
        <KpiCard
          label="系统建议数量"
          value={String(metrics?.system_recommendation_count ?? 0)}
          note={<span>{metrics?.shadow_date ?? "暂无观测日"}</span>}
          icon={BrainCircuit}
          color="#155eef"
        />
        <KpiCard
          label="人工决策数量"
          value={String(metrics?.human_decision_count ?? 0)}
          note={<span>不可变人工审核记录</span>}
          icon={Activity}
          color="#7c5ce4"
        />
        <KpiCard
          label="接受数量"
          value={String(metrics?.accepted_count ?? 0)}
          note={<span>{percent(metrics?.acceptance_rate)}</span>}
          icon={CheckCircle2}
          color="#0f9f78"
        />
        <KpiCard
          label="修改数量"
          value={String(metrics?.modified_count ?? 0)}
          note={<span>{percent(metrics?.modification_rate)}</span>}
          icon={PencilLine}
          color="#c57a08"
        />
        <KpiCard
          label="拒绝数量"
          value={String(metrics?.rejected_count ?? 0)}
          note={<span>{percent(metrics?.rejection_rate)}</span>}
          icon={XCircle}
          color="#d33d45"
        />
      </div>

      <div className="shadow-rate-grid">
        <section>
          <span>Acceptance Rate</span>
          <strong>{percent(metrics?.acceptance_rate)}</strong>
        </section>
        <section>
          <span>Modification Rate</span>
          <strong>{percent(metrics?.modification_rate)}</strong>
        </section>
        <section>
          <span>Rejection Rate</span>
          <strong>{percent(metrics?.rejection_rate)}</strong>
        </section>
      </div>

      <Card>
        <CardHeader>
          <div>
            <h2 className="panel-title">每日 Shadow Run 活动</h2>
            <div className="panel-subtitle">
              系统建议与人工决策分别按 UTC+8 发生日期统计
            </div>
          </div>
          <Badge variant="blue">
            {dashboard.dailyMetrics.length} DAYS
          </Badge>
        </CardHeader>
        <CardContent>
          {dashboard.dailyMetrics.length === 0 ? (
            <div className="empty-state">
              <LineChart size={24} />
              <strong>90天窗口内暂无建议或人工决策</strong>
              系统不会为填充看板而生成虚假记录。
            </div>
          ) : (
            <div className="table-wrap shadow-run-daily-table">
              <table>
                <thead>
                  <tr>
                    <th>日期</th>
                    <th>系统建议</th>
                    <th>人工决策</th>
                    <th>接受</th>
                    <th>修改</th>
                    <th>拒绝</th>
                    <th>接受率</th>
                    <th>修改率</th>
                    <th>拒绝率</th>
                  </tr>
                </thead>
                <tbody>
                  {dashboard.dailyMetrics.map((row) => (
                    <tr key={row.shadow_date}>
                      <td>{row.shadow_date}</td>
                      <td>{row.system_recommendation_count}</td>
                      <td>{row.human_decision_count}</td>
                      <td>{row.accepted_count}</td>
                      <td>{row.modified_count}</td>
                      <td>{row.rejected_count}</td>
                      <td>{percent(row.acceptance_rate)}</td>
                      <td>{percent(row.modification_rate)}</td>
                      <td>{percent(row.rejection_rate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="shadow-run-section-gap">
        <CardHeader>
          <div>
            <h2 className="panel-title">
              AI建议 vs 人工结果
            </h2>
            <div className="panel-subtitle">
              复用既有建议、最新人工决策和后验结果；所有调整原因原样保留
            </div>
          </div>
          <Badge variant="violet">
            {dashboard.comparisons.length} COMPARISONS
          </Badge>
        </CardHeader>
        <CardContent>
          {dashboard.comparisons.length === 0 ? (
            <div className="empty-state">
              <BrainCircuit size={24} />
              <strong>暂无可对比的人工决策</strong>
              建议与人工结果出现后，此处自动形成对比证据。
            </div>
          ) : (
            <div className="shadow-comparison-list">
              {dashboard.comparisons.map((row) => (
                <article
                  className="shadow-comparison-row"
                  key={`${row.human_decision_id}-${row.suggestion_type}`}
                >
                  <div className="shadow-comparison-meta">
                    <Badge variant="blue">
                      {row.suggestion_type}
                    </Badge>
                    <span>{localTime(row.reviewed_at)}</span>
                  </div>
                  <div className="shadow-comparison-columns">
                    <section>
                      <small>系统建议</small>
                      <strong>
                        {suggestedValue(
                          row.suggestion_type,
                          row.system_suggested_value,
                        )}
                      </strong>
                      <p>{row.system_suggestion_reason}</p>
                    </section>
                    <section>
                      <small>人工结果</small>
                      <div className="shadow-final-heading">
                        <strong>
                          {finalValue(
                            row.suggestion_type,
                            row.human_final_value,
                          )}
                        </strong>
                        <Badge
                          variant={statusVariant(
                            row.acceptance_status,
                          )}
                        >
                          {row.acceptance_status}
                        </Badge>
                      </div>
                      <p>{row.adjustment_reason}</p>
                    </section>
                  </div>
                  <div className="shadow-observed-result">
                    后验：
                    {row.latest_outcome_id
                      ? `${row.outcome_reason ?? "已记录"}${row.funding_pressure_improved === null ? "" : row.funding_pressure_improved ? " · 资金压力已改善" : " · 资金压力未改善"}`
                      : "等待人工记录实际结果"}
                  </div>
                </article>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="shadow-run-section-gap">
        <CardHeader>
          <div>
            <h2 className="panel-title">
              Decision Accuracy Metrics · 90天
            </h2>
            <div className="panel-subtitle">
              第一阶段仅统计，样本不足时明确显示等待积累
            </div>
          </div>
          <Badge variant="violet">DESCRIPTIVE ONLY</Badge>
        </CardHeader>
        <CardContent>
          <div className="decision-accuracy-grid">
            <section>
              <Gauge size={18} />
              <span>补U后资金压力改善率</span>
              <strong>
                {percent(
                  accuracy?.topup_pressure_improvement_rate,
                )}
              </strong>
              <small>
                样本{" "}
                {accuracy?.topup_pressure_evaluable_count ?? 0}
              </small>
            </section>
            <section>
              <Target size={18} />
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
              <LineChart size={18} />
              <span>Economic利润预测偏差</span>
              <strong>
                {accuracy?.average_economic_profit_absolute_error_usdt
                  ? formatUsdt(
                      accuracy.average_economic_profit_absolute_error_usdt,
                      2,
                    )
                  : "待积累样本"}
              </strong>
              <small>
                样本{" "}
                {accuracy?.economic_profit_evaluable_count ?? 0}
              </small>
            </section>
            <section>
              <ShieldCheck size={18} />
              <span>风险提醒命中率</span>
              <strong>{percent(accuracy?.risk_alert_hit_rate)}</strong>
              <small>
                样本 {accuracy?.risk_evaluable_count ?? 0}
              </small>
            </section>
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-run-section-gap">
        <CardHeader>
          <div>
            <h2 className="panel-title">
              Shadow Run Daily Review · 昨日
            </h2>
            <div className="panel-subtitle">
              {dashboard.yesterday} · 从不可变建议和人工决策自动派生
            </div>
          </div>
          <Badge variant={review ? "green" : "gray"}>
            {review ? "AUTO GENERATED" : "NO ACTIVITY"}
          </Badge>
        </CardHeader>
        <CardContent>
          <div className="shadow-review-grid">
            <section>
              <span>系统主要建议</span>
              <strong>{systemSuggestions.length} 项</strong>
              <p>
                {systemSuggestions.length
                  ? systemSuggestions
                      .slice(0, 3)
                      .map((item) =>
                        String(
                          (item as JsonRecord).suggestionType,
                        ),
                      )
                      .join(" · ")
                  : "昨日没有系统建议，不生成虚假摘要。"}
              </p>
            </section>
            <section>
              <span>人工主要调整</span>
              <strong>{humanAdjustments.length} 项</strong>
              <p>
                {humanAdjustments.length
                  ? humanAdjustments
                      .slice(0, 3)
                      .map((item) =>
                        String(
                          (item as JsonRecord).acceptanceStatus,
                        ),
                      )
                      .join(" · ")
                  : "昨日没有修改或拒绝记录。"}
              </p>
            </section>
            <section>
              <span>最大差异</span>
              <strong>
                {review?.biggest_difference_type ?? "无"}
              </strong>
              <p>
                {review?.biggest_difference_reason ??
                  "没有可计算的人工差异。"}
              </p>
            </section>
            <section>
              <span>学习记录</span>
              <strong>{learningRecords.length} 条</strong>
              <p>
                {learningRecords.length
                  ? String(
                      (learningRecords[0] as JsonRecord)
                        .learningReason,
                    )
                  : "等待人工调整原因形成学习证据。"}
              </p>
            </section>
          </div>
        </CardContent>
      </Card>

      <div className="shadow-market-grid shadow-run-section-gap">
        <Card>
          <CardHeader>
            <div>
              <h2 className="panel-title">
                Market Context Notes
              </h2>
              <div className="panel-subtitle">
                国际与市场因素只记录，不自动影响报价
              </div>
            </div>
            <Badge variant="blue">
              {dashboard.marketNotes.length} NOTES
            </Badge>
          </CardHeader>
          <CardContent>
            {dashboard.marketNotes.length === 0 ? (
              <div className="empty-state">
                <Globe2 size={24} />
                <strong>暂无人工市场观察</strong>
                新记录会作为不可变审计证据保存。
              </div>
            ) : (
              <div className="shadow-market-note-list">
                {dashboard.marketNotes.map((note) => (
                  <article key={note.id}>
                    <div>
                      <Badge
                        variant={severityVariant(note.severity)}
                      >
                        {note.severity}
                      </Badge>
                      <span>
                        {categoryLabels[note.context_category] ??
                          note.context_category}
                      </span>
                      <time>{note.context_date}</time>
                    </div>
                    <strong>{note.title}</strong>
                    <p>{note.observation_reason}</p>
                    {note.evidence_reference ? (
                      <small>{note.evidence_reference}</small>
                    ) : null}
                  </article>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <div>
              <h2 className="panel-title">人工观察录入</h2>
              <div className="panel-subtitle">
                原因必填 · 追加保存 · 禁止修改历史
              </div>
            </div>
            <BookOpenCheck size={18} color="#6f80a0" />
          </CardHeader>
          <CardContent>
            <ShadowRunMarketNoteForm />
          </CardContent>
        </Card>
      </div>

      <div className="control-data-cutoff shadow-run-sources">
        <span>
          Daily Report：
          {dashboard.sources.dailyReport
            ? `${dashboard.sources.dailyReport.operating_date} · ${dashboard.sources.dailyReport.data_completeness_status}`
            : "暂无保存快照"}
        </span>
        <span>
          Control Center：
          {dashboard.sources.controlCenter
            ? `${dashboard.sources.controlCenter.snapshot_date} · ${localTime(dashboard.sources.controlCenter.as_of)}`
            : "暂无保存快照"}
        </span>
        <span>
          Business Rules：
          {dashboard.sources.businessRules
            ? `${dashboard.sources.businessRules.rule_set_code} · ${dashboard.sources.businessRules.freeze_status}`
            : "暂无冻结规则"}
        </span>
      </div>
    </>
  );
}
