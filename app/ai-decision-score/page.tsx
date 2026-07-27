import type { Metadata } from "next";
import {
  Activity,
  BadgeDollarSign,
  BrainCircuit,
  CircleGauge,
  ShieldCheck,
  TrendingUp,
} from "lucide-react";

import { AiDecisionScoreActions } from "@/components/ai-decision-score-actions";
import { KpiCard, PageHeading } from "@/components/page-parts";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { getAiDecisionScoreData } from "@/lib/server-data";
import { formatUsdt, formatVnd } from "@/lib/utils";

export const metadata: Metadata = {
  title: "VND AI Decision Score",
};

function score(value: string | number | null | undefined) {
  if (value === null || value === undefined) return "待评分";
  return `${Number(value).toFixed(2)} / 100`;
}

function percent(value: string | number | null | undefined) {
  if (value === null || value === undefined) return "待评分";
  return `${(Number(value) * 100).toFixed(2)}%`;
}

function riskVariant(level: string) {
  if (level === "HIGH") return "red" as const;
  if (level === "MEDIUM") return "amber" as const;
  return "green" as const;
}

export default async function AiDecisionScorePage() {
  const data = await getAiDecisionScoreData();
  const summary = data.summary;
  const trend = data.recentScores;

  return (
    <>
      <PageHeading
        title="VND AI Decision Score"
        subtitle="Task 2.15 · 最近7天AI建议相对人工决策的利润与风险评分"
        actions={
          <Badge variant="blue">{data.modelVersion}</Badge>
        }
      />

      <div className="alert alert-warning settlement-shadow-alert">
        <ShieldCheck size={17} />
        <div>
          <strong>Shadow Mode · 评分不等于执行授权</strong>
          本页只读取不可变的AI建议、人工决定与实际结果；不会自动补U、付款、修改报价、交易或优化模型。
        </div>
      </div>

      <div className="kpi-grid">
        <KpiCard
          label="AI Decision Score"
          value={score(summary?.average_ai_decision_score)}
          note={
            <span>
              最近7天 · 完整评分 {summary?.complete_score_days ?? 0} 日
            </span>
          }
          icon={BrainCircuit}
          color="#155eef"
        />
        <KpiCard
          label="补U决策评分"
          value={score(summary?.average_topup_decision_score)}
          note={<span>数量、参考成本、汇率机会</span>}
          icon={BadgeDollarSign}
          color="#7c5ce4"
        />
        <KpiCard
          label="报价决策评分"
          value={score(summary?.average_quote_decision_score)}
          note={<span>利润、竞争影响、成交风险</span>}
          icon={TrendingUp}
          color="#0e9f6e"
        />
        <KpiCard
          label="风险预测评分"
          value={score(summary?.average_risk_score)}
          note={
            <span>
              命中 {percent(summary?.risk_hit_rate)} · 漏报{" "}
              {percent(summary?.risk_miss_rate)}
            </span>
          }
          icon={CircleGauge}
          color="#ef8b2c"
        />
      </div>

      <Card className="ai-score-section-gap">
        <CardHeader>
          <div>
            <h2>最近7天评分趋势</h2>
            <p>综合分固定使用补U 30% + 报价 30% + 利润预测 25% + 风险 15%</p>
          </div>
          <Badge variant="gray">
            {trend.length} 个已评分日
          </Badge>
        </CardHeader>
        <CardContent>
          {trend.length === 0 ? (
            <div className="empty-state compact">
              完成Task 2.14每日验证后，可由操作员生成不可变评分快照。
            </div>
          ) : (
            <div className="ai-score-trend">
              {trend.map((item) => {
                const value = Number(item.ai_decision_score ?? 0);
                return (
                  <section key={item.id}>
                    <span>{item.score_date}</span>
                    <div>
                      <i
                        style={{
                          height: `${Math.max(value, 3)}%`,
                          width: `${Math.max(value, 3)}%`,
                        }}
                      />
                    </div>
                    <strong>
                      {item.ai_decision_score === null
                        ? "证据不足"
                        : value.toFixed(1)}
                    </strong>
                  </section>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid-2 ai-score-section-gap">
        <Card>
          <CardHeader>
            <div>
              <h2>分项准确度</h2>
              <p>最近7天模型表现，不自动调整任何规则</p>
            </div>
          </CardHeader>
          <CardContent>
            <div className="ai-score-metric-list">
              <section>
                <span>补U准确率</span>
                <strong>
                  {score(summary?.average_topup_decision_score)}
                </strong>
                <small>包含数量偏差、参考成本差异与汇率机会损失</small>
              </section>
              <section>
                <span>报价准确率</span>
                <strong>
                  {score(summary?.average_quote_decision_score)}
                </strong>
                <small>包含利润差异、商户竞争影响和成交风险</small>
              </section>
              <section>
                <span>利润预测准确度</span>
                <strong>
                  {score(summary?.average_profit_prediction_score)}
                </strong>
                <small>
                  Cash误差{" "}
                  {summary?.average_cash_profit_absolute_error_usdt == null
                    ? "待评分"
                    : formatUsdt(
                        summary.average_cash_profit_absolute_error_usdt,
                        2,
                      )}
                </small>
              </section>
              <section>
                <span>风险预测准确率</span>
                <strong>{score(summary?.average_risk_score)}</strong>
                <small>
                  误报 {percent(summary?.risk_false_positive_rate)} ·
                  漏报 {percent(summary?.risk_miss_rate)}
                </small>
              </section>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <h2>待生成评分快照</h2>
              <p>仅对已完成的Shadow Validation日记录计算</p>
            </div>
          </CardHeader>
          <CardContent>
            <AiDecisionScoreActions
              eligibleRecords={data.eligibleRecords}
            />
          </CardContent>
        </Card>
      </div>

      <Card className="ai-score-section-gap">
        <CardHeader>
          <div>
            <h2>每日评分证据</h2>
            <p>模型版本、来源日和全部分项保持不可变</p>
          </div>
          <Activity size={17} color="#667085" />
        </CardHeader>
        <CardContent>
          {trend.length === 0 ? (
            <div className="empty-state compact">暂无每日评分。</div>
          ) : (
            <div className="ai-score-daily-list">
              {[...trend].reverse().map((item) => (
                <article key={item.id}>
                  <header>
                    <div>
                      <strong>{item.score_date}</strong>
                      <span>
                        v{item.score_version} · {item.evaluation_status}
                      </span>
                    </div>
                    <Badge
                      variant={
                        item.evaluation_status === "COMPLETE"
                          ? "green"
                          : "amber"
                      }
                    >
                      {score(item.ai_decision_score)}
                    </Badge>
                  </header>
                  <div>
                    <section>
                      <span>Topup Decision Score</span>
                      <strong>{score(item.topup_decision_score)}</strong>
                      <small>
                        数量偏差{" "}
                        {formatUsdt(
                          item.topup_absolute_deviation_usdt,
                          2,
                        )}
                      </small>
                      <small>
                        参考成本差异{" "}
                        {item.topup_reference_cost_difference_vnd === null
                          ? "证据缺失"
                          : formatVnd(
                              item.topup_reference_cost_difference_vnd,
                            )}
                      </small>
                      <small>
                        汇率机会损失{" "}
                        {item.fx_opportunity_loss_usdt === null
                          ? "证据缺失"
                          : formatUsdt(
                              item.fx_opportunity_loss_usdt,
                              2,
                            )}
                      </small>
                    </section>
                    <section>
                      <span>Quote Decision Score</span>
                      <strong>{score(item.quote_decision_score)}</strong>
                      <small>
                        竞争影响{" "}
                        {percent(
                          item.merchant_competition_impact_ratio,
                        )}
                      </small>
                      <small>
                        成交风险 {percent(item.transaction_risk_rate)}
                      </small>
                    </section>
                    <section>
                      <span>Profit Prediction</span>
                      <strong>
                        {score(item.profit_prediction_score)}
                      </strong>
                      <small>
                        Cash误差{" "}
                        {item.cash_profit_absolute_error_usdt === null
                          ? "证据缺失"
                          : formatUsdt(
                              item.cash_profit_absolute_error_usdt,
                              2,
                            )}
                      </small>
                      <small>
                        Economic误差{" "}
                        {item.economic_profit_absolute_error_usdt === null
                          ? "证据缺失"
                          : formatUsdt(
                              item.economic_profit_absolute_error_usdt,
                              2,
                            )}
                      </small>
                    </section>
                    <section>
                      <span>Risk Score</span>
                      <strong>{score(item.risk_score)}</strong>
                      <div className="ai-score-risk-levels">
                        <Badge variant={riskVariant(item.system_risk_level)}>
                          AI {item.system_risk_level}
                        </Badge>
                        <Badge variant={riskVariant(item.actual_risk_level)}>
                          实际 {item.actual_risk_level}
                        </Badge>
                      </div>
                      <small>
                        命中 {item.risk_true_positive_count} · 误报{" "}
                        {item.risk_false_positive_count} · 漏报{" "}
                        {item.risk_false_negative_count}
                      </small>
                    </section>
                  </div>
                </article>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
