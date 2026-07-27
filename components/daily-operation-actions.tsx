"use client";

import { CheckCircle2, RefreshCw, Save, ShieldAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { authorizedFetch } from "@/lib/authorized-fetch";
import { DAILY_OPERATION_REASON_CATEGORIES } from "@/lib/daily-operation";

type RiskAlert = {
  code: string;
  severity?: string;
  message?: string;
};

const reasonLabels: Record<string, string> = {
  MARKET_COMPETITION: "市场竞争",
  MERCHANT_RELATIONSHIP: "商户关系",
  FX_OPPORTUNITY: "汇率机会",
  RISK_CONTROL: "风险控制",
  FUNDING_ARRANGEMENT: "资金安排",
  OTHER: "其他",
};

export function DailyOperationActions({
  dayDecisionId,
  riskCheckId,
  recommendedTopupUsdt,
  recommendedQuoteRate,
  systemRisks,
  endReviewCompleted,
}: {
  dayDecisionId: string | null;
  riskCheckId: string | null;
  recommendedTopupUsdt: string | null;
  recommendedQuoteRate: string | null;
  systemRisks: RiskAlert[];
  endReviewCompleted: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [binanceP2pRate, setBinanceP2pRate] = useState("");
  const [upstreamQuoteRate, setUpstreamQuoteRate] = useState("");
  const [xeRate, setXeRate] = useState("");
  const [acceptanceStatus, setAcceptanceStatus] = useState<
    "ACCEPTED" | "MODIFIED" | "REJECTED"
  >("ACCEPTED");
  const [finalTopupUsdt, setFinalTopupUsdt] = useState(
    recommendedTopupUsdt ?? "",
  );
  const [finalQuoteRate, setFinalQuoteRate] = useState(
    recommendedQuoteRate ?? "",
  );
  const [finalExecutionDecision, setFinalExecutionDecision] =
    useState("DEFER");
  const [reasonCategory, setReasonCategory] = useState(
    "FUNDING_ARRANGEMENT",
  );
  const [reason, setReason] = useState("");
  const [riskJudgments, setRiskJudgments] = useState<
    Record<string, "CONFIRMED" | "IGNORED">
  >({});
  const [riskNotes, setRiskNotes] = useState<Record<string, string>>(
    {},
  );

  async function submit(payload: Record<string, unknown>, success: string) {
    setBusy(true);
    setMessage("");
    try {
      const response = await authorizedFetch("/api/daily-operation", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await response.json()) as { message?: string };
      if (!response.ok) {
        throw new Error(body.message ?? "工作流记录保存失败");
      }
      setMessage(success);
      router.refresh();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "工作流记录保存失败",
      );
    } finally {
      setBusy(false);
    }
  }

  function saveDayDecision(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submit(
      {
        kind: "SAVE_DAY_DECISION",
        clientRequestId: crypto.randomUUID(),
        binanceP2pRate,
        upstreamQuoteRate,
        xeRate,
      },
      "11:00决策与人工汇率观察已不可变保存；未执行补U或交易。",
    );
  }

  function saveRiskCheck() {
    if (!dayDecisionId) return;
    void submit(
      {
        kind: "SAVE_RISK_CHECK",
        clientRequestId: crypto.randomUUID(),
        dayDecisionSnapshotId: dayDecisionId,
      },
      "16:00风险检查已不可变保存；仅提醒，不执行任何动作。",
    );
  }

  function saveEndReview(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dayDecisionId || !riskCheckId) return;
    const riskFeedback = systemRisks.map((risk) => ({
      risk_code: risk.code,
      human_judgment: riskJudgments[risk.code] ?? "CONFIRMED",
      human_note: riskNotes[risk.code] ?? "",
    }));
    void submit(
      {
        kind: "SAVE_END_REVIEW",
        clientRequestId: crypto.randomUUID(),
        decisionClientRequestId: crypto.randomUUID(),
        outcomeClientRequestId: crypto.randomUUID(),
        dayDecisionSnapshotId: dayDecisionId,
        riskCheckId,
        acceptanceStatus,
        finalTopupUsdt: finalTopupUsdt || null,
        finalQuoteRate: finalQuoteRate || null,
        finalExecutionDecision,
        adjustmentReasonCategory: reasonCategory,
        adjustmentReason: reason,
        riskFeedback,
      },
      "23:00复盘、人工决策和学习证据已追加保存；未执行资金或报价操作。",
    );
  }

  return (
    <div className="daily-operation-actions">
      <form className="daily-operation-form" onSubmit={saveDayDecision}>
        <div className="daily-operation-form-heading">
          <div>
            <strong>11:00 日间决策</strong>
            <span>三项汇率均由操作员手工录入，不连接行情 API。</span>
          </div>
          {dayDecisionId ? (
            <span className="tag tag-green">已保存</span>
          ) : (
            <span className="tag tag-blue">待记录</span>
          )}
        </div>
        <div className="daily-operation-field-grid">
          <label>
            Binance P2P 价格
            <input
              disabled={Boolean(dayDecisionId) || busy}
              inputMode="decimal"
              required
              value={binanceP2pRate}
              onChange={(event) => setBinanceP2pRate(event.target.value)}
            />
          </label>
          <label>
            上游报价
            <input
              disabled={Boolean(dayDecisionId) || busy}
              inputMode="decimal"
              required
              value={upstreamQuoteRate}
              onChange={(event) => setUpstreamQuoteRate(event.target.value)}
            />
          </label>
          <label>
            XE 价格
            <input
              disabled={Boolean(dayDecisionId) || busy}
              inputMode="decimal"
              required
              value={xeRate}
              onChange={(event) => setXeRate(event.target.value)}
            />
          </label>
          <button
            className="button button-primary"
            disabled={Boolean(dayDecisionId) || busy}
            type="submit"
          >
            {busy ? <RefreshCw className="spin" size={14} /> : <Save size={14} />}
            保存11:00快照
          </button>
        </div>
      </form>

      <section className="daily-operation-check">
        <div>
          <strong>16:00 资金压力检查</strong>
          <span>
            检查 Payout 集中、Settleable、千2利润线、汇率异常和国际市场备注。
          </span>
        </div>
        <button
          className="button"
          disabled={!dayDecisionId || Boolean(riskCheckId) || busy}
          onClick={saveRiskCheck}
          type="button"
        >
          <ShieldAlert size={14} />
          {riskCheckId ? "风险检查已保存" : "生成16:00风险检查"}
        </button>
      </section>

      <form className="daily-operation-form" onSubmit={saveEndReview}>
        <div className="daily-operation-form-heading">
          <div>
            <strong>23:00 日终复盘</strong>
            <span>
              接受、修改或拒绝均写入现有90天学习数据，调整原因必填。
            </span>
          </div>
          {endReviewCompleted ? (
            <span className="tag tag-green">已复盘</span>
          ) : (
            <span className="tag tag-violet">人工确认</span>
          )}
        </div>
        <div className="daily-operation-field-grid">
          <label>
            人工结果
            <select
              disabled={!riskCheckId || endReviewCompleted || busy}
              value={acceptanceStatus}
              onChange={(event) =>
                setAcceptanceStatus(
                  event.target.value as typeof acceptanceStatus,
                )
              }
            >
              <option value="ACCEPTED">接受</option>
              <option value="MODIFIED">修改</option>
              <option value="REJECTED">拒绝</option>
            </select>
          </label>
          <label>
            最终补U建议（USDT）
            <input
              disabled={!riskCheckId || endReviewCompleted || busy}
              inputMode="decimal"
              value={finalTopupUsdt}
              onChange={(event) => setFinalTopupUsdt(event.target.value)}
            />
          </label>
          <label>
            最终报价建议
            <input
              disabled={!riskCheckId || endReviewCompleted || busy}
              inputMode="decimal"
              value={finalQuoteRate}
              onChange={(event) => setFinalQuoteRate(event.target.value)}
            />
          </label>
          <label>
            最终执行决定
            <select
              disabled={!riskCheckId || endReviewCompleted || busy}
              value={finalExecutionDecision}
              onChange={(event) =>
                setFinalExecutionDecision(event.target.value)
              }
            >
              <option value="DEFER">延后人工处理</option>
              <option value="DO_NOT_EXECUTE">不执行</option>
              <option value="ACCEPT_FOR_MANUAL_EXECUTION">
                接受，另行人工执行
              </option>
              <option value="NOT_APPLICABLE">不适用</option>
            </select>
          </label>
          <label>
            调整原因分类
            <select
              disabled={!riskCheckId || endReviewCompleted || busy}
              value={reasonCategory}
              onChange={(event) => setReasonCategory(event.target.value)}
            >
              {DAILY_OPERATION_REASON_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {reasonLabels[category]}
                </option>
              ))}
            </select>
          </label>
          <label className="daily-operation-reason">
            调整原因
            <textarea
              disabled={!riskCheckId || endReviewCompleted || busy}
              maxLength={1000}
              placeholder="必填：说明市场、商户、汇率、风险或资金安排依据"
              required
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
        </div>
        {systemRisks.length > 0 ? (
          <div className="daily-operation-risk-feedback">
            <strong>逐条风险判断</strong>
            {systemRisks.map((risk) => (
              <div key={risk.code}>
                <span>
                  <b>{risk.code}</b>
                  {risk.message ? ` · ${risk.message}` : ""}
                </span>
                <select
                  disabled={!riskCheckId || endReviewCompleted || busy}
                  value={riskJudgments[risk.code] ?? "CONFIRMED"}
                  onChange={(event) =>
                    setRiskJudgments((current) => ({
                      ...current,
                      [risk.code]: event.target.value as
                        | "CONFIRMED"
                        | "IGNORED",
                    }))
                  }
                >
                  <option value="CONFIRMED">确认风险</option>
                  <option value="IGNORED">忽略风险</option>
                </select>
                <input
                  disabled={!riskCheckId || endReviewCompleted || busy}
                  maxLength={1000}
                  placeholder="人工备注"
                  value={riskNotes[risk.code] ?? ""}
                  onChange={(event) =>
                    setRiskNotes((current) => ({
                      ...current,
                      [risk.code]: event.target.value,
                    }))
                  }
                />
              </div>
            ))}
          </div>
        ) : null}
        <button
          className="button button-primary"
          disabled={!riskCheckId || endReviewCompleted || busy}
          type="submit"
        >
          {busy ? (
            <RefreshCw className="spin" size={14} />
          ) : (
            <CheckCircle2 size={14} />
          )}
          保存23:00复盘
        </button>
      </form>

      {message ? <div className="alert alert-info">{message}</div> : null}
    </div>
  );
}
