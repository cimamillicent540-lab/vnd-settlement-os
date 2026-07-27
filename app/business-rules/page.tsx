import type { Metadata } from "next";
import {
  BookLock,
  CircleDollarSign,
  Gauge,
  Layers3,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";

import { BusinessRulesConfirmationPanel } from "@/components/business-rules-confirmation-panel";
import { KpiCard, PageHeading } from "@/components/page-parts";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { getBusinessRulesFreezeData } from "@/lib/server-data";
import { formatRate, formatUsdt } from "@/lib/utils";

export const metadata: Metadata = {
  title: "VND结算业务规则冻结",
};

function statusVariant(status: string) {
  if (status === "CURRENT" || status === "CONFIRMED") {
    return "green" as const;
  }
  if (status === "CRITICAL" || status === "HIGH") {
    return "red" as const;
  }
  if (status === "WARNING" || status === "PLANNED") {
    return "amber" as const;
  }
  return "blue" as const;
}

function jsonSummary(value: unknown) {
  if (!value || typeof value !== "object") return "—";
  return JSON.stringify(value);
}

export default async function BusinessRulesPage() {
  const data = await getBusinessRulesFreezeData();
  const current = data.current;
  const stages = Array.isArray(
    data.ruleSet.automationStageDefinitions,
  )
    ? (data.ruleSet.automationStageDefinitions as Array<{
        stage: string;
        sequence: number;
        status: string;
        description: string;
      }>)
    : [];
  const groupedRules = Object.groupBy(
    data.rules,
    (rule) => String(rule.rule_category),
  );

  return (
    <>
      <PageHeading
        title="VND结算业务规则冻结"
        subtitle={`Task 2.10 · ${data.ruleSet.code} · 运营日 ${data.operatingDate}`}
      />

      <div className="alert alert-warning settlement-shadow-alert">
        <ShieldCheck size={17} />
        <div>
          <strong>Stage 1 · Shadow Mode</strong>
          规则只生成系统建议，人工按钮只写入90天学习数据；不会自动补U、付款、调整报价或交易。
        </div>
      </div>

      <div className="kpi-grid">
        <KpiCard
          label="冻结规则"
          value={String(data.rules.length)}
          note={<span>不可修改，只能新增版本</span>}
          icon={BookLock}
          color="#155eef"
        />
        <KpiCard
          label="当前自动化阶段"
          value="STAGE 1"
          note={<span>{data.ruleSet.currentAutomationStage}</span>}
          icon={Layers3}
          color="#7c5ce4"
        />
        <KpiCard
          label="安全缓冲"
          value="10%"
          note={<span>日内及16:00-23:00压力</span>}
          icon={Gauge}
          color="#0f9f78"
        />
        <KpiCard
          label="利润边界"
          value="0.2% / 0.5%"
          note={<span>保护线 / 目标线</span>}
          icon={CircleDollarSign}
          color="#dc8b16"
        />
      </div>

      <Card>
        <CardHeader>
          <div>
            <h2 className="panel-title">自动化阶段冻结</h2>
            <div className="panel-subtitle">
              Stage 2与Stage 3只记录未来定义，当前没有执行能力
            </div>
          </div>
          <Badge variant="violet">
            {data.ruleSet.freezeStatus}
          </Badge>
        </CardHeader>
        <CardContent>
          <div className="business-stage-grid">
            {stages.map((stage) => (
              <div
                className={
                  stage.status === "CURRENT"
                    ? "business-stage current"
                    : "business-stage"
                }
                key={stage.stage}
              >
                <span>STAGE {stage.sequence}</span>
                <strong>{stage.stage}</strong>
                <p>{stage.description}</p>
                <Badge variant={statusVariant(stage.status)}>
                  {stage.status}
                </Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="business-section-gap">
        <CardHeader>
          <div>
            <h2 className="panel-title">今日系统建议</h2>
            <div className="panel-subtitle">
              Settlement Control Center + Intelligence + 冻结规则
            </div>
          </div>
          <Badge variant="blue">SUGGESTION ONLY</Badge>
        </CardHeader>
        <CardContent>
          <div className="business-suggestion-grid">
            <section>
              <span>补U建议</span>
              <strong>
                {current.topup.topupRecommended
                  ? current.topup.recommendedTopupUsdt
                    ? formatUsdt(
                        current.topup.recommendedTopupUsdt,
                        2,
                      )
                    : "等待人工P2P输入"
                  : "不建议补U"}
              </strong>
              <small>{current.topup.recommendedTime}</small>
            </section>
            <section>
              <span>影子报价建议</span>
              <strong>
                {current.fx.companyQuoteRate
                  ? formatRate(current.fx.companyQuoteRate, 4)
                  : "等待人工汇率输入"}
              </strong>
              <small>
                {current.merchants.length}个商户阶梯建议 ·
                千2保护/千5目标
              </small>
            </section>
            <section>
              <span>风险提醒</span>
              <strong>{current.risks.length}项</strong>
              <small>
                资金、波动、P2P输入及国际市场人工判断
              </small>
            </section>
          </div>

          <div className="business-reason-risk-grid">
            <div>
              <strong>建议原因</strong>
              <ul className="settlement-reason-list">
                {current.topup.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            </div>
            <div>
              <strong>风险因素</strong>
              <div className="settlement-risk-list">
                {current.risks.map((risk) => (
                  <div
                    className="settlement-risk-item"
                    key={risk.code}
                  >
                    <Badge variant={statusVariant(risk.severity)}>
                      {risk.severity}
                    </Badge>
                    <div>
                      <strong>{risk.code}</strong>
                      <span>{risk.message}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="business-section-gap">
        <CardHeader>
          <div>
            <h2 className="panel-title">操作员确认中心</h2>
            <div className="panel-subtitle">
              接受、修改、拒绝均必须填写原因，并追加进入90天学习数据
            </div>
          </div>
          <Badge variant="amber">
            {data.todayRecommendations.length} TODAY
          </Badge>
        </CardHeader>
        <CardContent>
          <BusinessRulesConfirmationPanel
            key={
              data.latestTodayRecommendation?.latestDecision?.id ??
              data.latestTodayRecommendation?.id ??
              "no-recommendation"
            }
            recommendation={data.latestTodayRecommendation}
          />
        </CardContent>
      </Card>

      {(["TOPUP", "PROFIT", "QUOTE", "RISK"] as const).map(
        (category) => (
          <Card className="business-section-gap" key={category}>
            <CardHeader>
              <div>
                <h2 className="panel-title">
                  {category} 冻结规则
                </h2>
                <div className="panel-subtitle">
                  条件、系统建议动作、人工审批要求和优先级
                </div>
              </div>
              <Badge variant="blue">
                {groupedRules[category]?.length ?? 0} RULES
              </Badge>
            </CardHeader>
            <CardContent>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>优先级</th>
                      <th>规则名称</th>
                      <th>条件</th>
                      <th>系统建议动作</th>
                      <th>人工审批</th>
                      <th>状态</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(groupedRules[category] ?? []).map((rule) => (
                      <tr key={rule.id}>
                        <td>{rule.priority}</td>
                        <td>
                          <strong>{rule.rule_name}</strong>
                          <span className="business-rule-key">
                            {rule.rule_key}
                          </span>
                        </td>
                        <td>
                          <span className="business-json">
                            {jsonSummary(rule.condition_definition)}
                          </span>
                        </td>
                        <td>
                          <span className="business-json">
                            {jsonSummary(
                              rule.system_suggested_action,
                            )}
                          </span>
                        </td>
                        <td>
                          {rule.requires_human_approval
                            ? "必须"
                            : "未来Stage定义"}
                        </td>
                        <td>
                          <Badge
                            variant={statusVariant(rule.rule_status)}
                          >
                            {rule.rule_status}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        ),
      )}

      <Card className="business-section-gap">
        <CardHeader>
          <div>
            <h2 className="panel-title">自动化阶段规则</h2>
            <div className="panel-subtitle">
              当前只启用Stage 1人工审核
            </div>
          </div>
          <ShieldAlert size={18} color="#dc8b16" />
        </CardHeader>
        <CardContent>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>优先级</th>
                  <th>阶段</th>
                  <th>定义</th>
                  <th>状态</th>
                </tr>
              </thead>
              <tbody>
                {(groupedRules.AUTOMATION_STAGE ?? []).map((rule) => (
                  <tr key={rule.id}>
                    <td>{rule.priority}</td>
                    <td>{rule.applicable_stage}</td>
                    <td>{rule.rule_name}</td>
                    <td>
                      <Badge
                        variant={statusVariant(rule.rule_status)}
                      >
                        {rule.rule_status}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
