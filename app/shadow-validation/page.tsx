import type { Metadata } from "next";
import {
  BrainCircuit,
  CalendarDays,
  Gauge,
  ShieldCheck,
  Target,
} from "lucide-react";

import { KpiCard, PageHeading } from "@/components/page-parts";
import { ShadowValidationActions } from "@/components/shadow-validation-actions";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { getShadowValidationData } from "@/lib/server-data";
import {
  formatRate,
  formatUsdt,
} from "@/lib/utils";

export const metadata: Metadata = {
  title: "VND 7天Shadow Validation",
};

function percent(value: string | number | null | undefined) {
  if (value === null || value === undefined) return "待积累";
  return `${(Number(value) * 100).toFixed(2)}%`;
}

function score(value: string | number | null | undefined) {
  if (value === null || value === undefined) return "待积累";
  return `${Number(value).toFixed(2)} / 100`;
}

function dateOffset(startDate: string, offset: number) {
  const date = new Date(`${startDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function statusVariant(status: string | null | undefined) {
  if (status === "COMPLETED") return "green" as const;
  if (status === "EXPIRED_INCOMPLETE") return "red" as const;
  if (status === "IN_PROGRESS") return "amber" as const;
  return "blue" as const;
}

export default async function ShadowValidationPage() {
  const data = await getShadowValidationData();
  const period = data.selectedPeriod;
  const recordsByDay = new Map(
    data.dailyRecords.map((record) => [
      Number(record.day_number),
      record,
    ]),
  );

  return (
    <>
      <PageHeading
        title="VND Shadow Validation Period"
        subtitle="Task 2.14 · 7天AI建议、人工决策与实际结果验证"
      />

      <div className="alert alert-warning settlement-shadow-alert">
        <ShieldCheck size={17} />
        <div>
          <strong>Shadow Mode · 只统计，不优化、不执行</strong>
          验证期只追加AI建议、人工决定、原因和实际结果证据；不会自动补U、付款、修改报价或交易。
        </div>
      </div>

      <div className="kpi-grid">
        <KpiCard
          label="验证进度"
          value={
            period
              ? `Day ${period.captured_days} / 7`
              : "未启动"
          }
          note={
            <span>
              {period
                ? `${period.start_date} – ${period.end_date}`
                : "由操作员人工启动"}
            </span>
          }
          icon={CalendarDays}
          color="#155eef"
        />
        <KpiCard
          label="AI Accuracy Score"
          value={score(period?.average_ai_accuracy_score)}
          note={<span>四个可评价维度的每日平均</span>}
          icon={BrainCircuit}
          color="#7c5ce4"
        />
        <KpiCard
          label="补U建议准确率"
          value={percent(
            period?.topup_recommendation_accuracy_rate,
          )}
          note={
            <span>
              千分比误差与10%容差同时保留
            </span>
          }
          icon={Target}
          color="#0f9f78"
        />
        <KpiCard
          label="风险预测准确率"
          value={percent(
            period?.risk_prediction_accuracy_rate,
          )}
          note={<span>预测命中与未预测风险共同计分</span>}
          icon={Gauge}
          color="#dc8b16"
        />
      </div>

      <Card>
        <CardHeader>
          <div>
            <h2 className="panel-title">7天状态</h2>
            <div className="panel-subtitle">
              每日记录必须引用同日已完成的23:00复盘
            </div>
          </div>
          <Badge variant={statusVariant(period?.period_status)}>
            {period?.period_status ?? "NOT STARTED"}
          </Badge>
        </CardHeader>
        <CardContent>
          {period ? (
            <div className="shadow-validation-day-grid">
              {Array.from({ length: 7 }, (_, index) => {
                const dayNumber = index + 1;
                const record = recordsByDay.get(dayNumber);
                const date = dateOffset(period.start_date, index);
                return (
                  <section
                    className={record ? "captured" : ""}
                    key={dayNumber}
                  >
                    <span>DAY {dayNumber} / 7</span>
                    <strong>{date}</strong>
                    <small>
                      {record
                        ? `AI Score ${Number(record.ai_accuracy_score).toFixed(2)}`
                        : date > data.today
                          ? "等待运营日"
                          : "待验证"}
                    </small>
                  </section>
                );
              })}
            </div>
          ) : (
            <div className="empty-state">
              <CalendarDays size={24} />
              <strong>尚未创建7天验证周期</strong>
              系统不会自动创建日期或生成虚假每日记录。
            </div>
          )}
        </CardContent>
      </Card>

      <div className="shadow-validation-metric-grid">
        <section>
          <span>报价建议采纳率</span>
          <strong>
            {percent(period?.quote_recommendation_adoption_rate)}
          </strong>
          <small>AI报价与实际报价一致</small>
        </section>
        <section>
          <span>利润预测准确率</span>
          <strong>
            {percent(period?.profit_prediction_accuracy_rate)}
          </strong>
          <small>Cash + Economic Profit</small>
        </section>
        <section>
          <span>Cash Profit 平均误差</span>
          <strong>
            {period?.average_cash_profit_absolute_error_usdt ===
            null ||
            period?.average_cash_profit_absolute_error_usdt ===
              undefined
              ? "待积累"
              : formatUsdt(
                  period.average_cash_profit_absolute_error_usdt,
                  2,
                )}
          </strong>
          <small>绝对误差</small>
        </section>
        <section>
          <span>Economic Profit 平均误差</span>
          <strong>
            {period?.average_economic_profit_absolute_error_usdt ===
            null ||
            period?.average_economic_profit_absolute_error_usdt ===
              undefined
              ? "待积累"
              : formatUsdt(
                  period.average_economic_profit_absolute_error_usdt,
                  2,
                )}
          </strong>
          <small>绝对误差</small>
        </section>
      </div>

      <Card className="shadow-validation-section-gap">
        <CardHeader>
          <div>
            <h2 className="panel-title">AI建议 vs 人工与实际结果</h2>
            <div className="panel-subtitle">
              调整原因采用已确认的六类口径，所有证据不可修改或删除
            </div>
          </div>
          <Badge variant="violet">
            {data.dailyRecords.length} RECORDS
          </Badge>
        </CardHeader>
        <CardContent>
          {data.dailyRecords.length === 0 ? (
            <div className="empty-state">
              <BrainCircuit size={24} />
              <strong>暂无每日验证结果</strong>
              完成23:00复盘后，由人工录入实际结果。
            </div>
          ) : (
            <div className="shadow-validation-comparison-list">
              {data.dailyRecords.map((record) => (
                <article key={record.id}>
                  <header>
                    <div>
                      <strong>
                        Day {record.day_number} / 7 ·{" "}
                        {record.validation_date}
                      </strong>
                      <span>
                        {record.acceptance_status} ·{" "}
                        {record.adjustment_reason_category}
                      </span>
                    </div>
                    <Badge
                      variant={
                        Number(record.ai_accuracy_score) >= 80
                          ? "green"
                          : Number(record.ai_accuracy_score) >= 60
                            ? "amber"
                            : "red"
                      }
                    >
                      AI {Number(record.ai_accuracy_score).toFixed(2)}
                    </Badge>
                  </header>
                  <div>
                    <section>
                      <span>AI建议</span>
                      <strong>
                        补U{" "}
                        {formatUsdt(
                          record.system_recommended_topup_usdt ?? 0,
                          2,
                        )}
                      </strong>
                      <small>
                        报价{" "}
                        {record.system_recommended_quote_rate
                          ? formatRate(
                              record.system_recommended_quote_rate,
                              4,
                            )
                          : "不可计算"}
                        {" · "}
                        风险 {record.system_risk_level}
                      </small>
                    </section>
                    <section>
                      <span>人工与实际结果</span>
                      <strong>
                        补U{" "}
                        {formatUsdt(record.actual_topup_usdt, 2)}
                      </strong>
                      <small>
                        报价{" "}
                        {formatRate(record.actual_quote_rate, 4)}
                        {" · "}
                        {record.adjustment_reason}
                      </small>
                    </section>
                    <section>
                      <span>利润回测</span>
                      <strong>
                        Cash{" "}
                        {formatUsdt(
                          record.actual_cash_profit_usdt,
                          2,
                        )}
                      </strong>
                      <small>
                        Economic{" "}
                        {formatUsdt(
                          record.actual_economic_profit_usdt,
                          2,
                        )}
                        {" · "}
                        FX{" "}
                        {formatUsdt(record.actual_fx_gain_usdt, 2)}
                      </small>
                    </section>
                  </div>
                </article>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="shadow-validation-section-gap">
        <CardHeader>
          <div>
            <h2 className="panel-title">验证操作区</h2>
            <div className="panel-subtitle">
              人工启动周期并追加实际结果；任何选择都不会执行资金动作
            </div>
          </div>
          <Badge variant="amber">NO EXECUTION</Badge>
        </CardHeader>
        <CardContent>
          <ShadowValidationActions
            today={data.today}
            activePeriodId={data.activePeriod?.period_id ?? null}
            eligibleDays={data.eligibleEndReviews}
          />
        </CardContent>
      </Card>
    </>
  );
}
