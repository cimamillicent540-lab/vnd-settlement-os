"use client";

import { RefreshCw, Save, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { authorizedFetch } from "@/lib/authorized-fetch";

type RiskAlert = {
  code: string;
  severity: "INFO" | "WARNING" | "HIGH";
  message: string;
};

type LearningRecommendation = {
  id: string;
  recommendation_time: string;
  system_recommended_topup_usdt: string | number | null;
  system_recommended_quote_rate: string | number | null;
  system_risk_alerts: RiskAlert[] | null;
  latestDecision: { id: string } | null;
};

export function SettlementLearningPanel({
  recommendations,
}: {
  recommendations: LearningRecommendation[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const pending = useMemo(
    () => recommendations.filter((row) => !row.latestDecision),
    [recommendations],
  );
  const [recommendationId, setRecommendationId] = useState(
    pending[0]?.id ?? "",
  );
  const selected =
    pending.find((row) => row.id === recommendationId) ?? pending[0];
  const risks = selected?.system_risk_alerts ?? [];

  const [decisionScope, setDecisionScope] = useState<
    "FULL_REVIEW" | "TOPUP" | "QUOTE" | "RISK"
  >("FULL_REVIEW");
  const [acceptanceStatus, setAcceptanceStatus] = useState<
    "ACCEPTED" | "MODIFIED" | "REJECTED"
  >("MODIFIED");
  const [finalTopupUsdt, setFinalTopupUsdt] = useState(
    pending[0]?.system_recommended_topup_usdt === null ||
      pending[0]?.system_recommended_topup_usdt === undefined
      ? ""
      : String(pending[0].system_recommended_topup_usdt),
  );
  const [finalQuoteRate, setFinalQuoteRate] = useState(
    pending[0]?.system_recommended_quote_rate === null ||
      pending[0]?.system_recommended_quote_rate === undefined
      ? ""
      : String(pending[0].system_recommended_quote_rate),
  );
  const [finalExecutionDecision, setFinalExecutionDecision] =
    useState<
      | "ACCEPT_FOR_MANUAL_EXECUTION"
      | "DO_NOT_EXECUTE"
      | "DEFER"
      | "NOT_APPLICABLE"
    >("DEFER");
  const [reason, setReason] = useState("");
  const [merchantName, setMerchantName] = useState("");
  const [transactionVolumeUsdt, setTransactionVolumeUsdt] =
    useState("");
  const [profitContributionUsdt, setProfitContributionUsdt] =
    useState("");
  const [riskJudgments, setRiskJudgments] = useState<
    Record<string, "CONFIRMED" | "IGNORED">
  >(() =>
    Object.fromEntries(
      (pending[0]?.system_risk_alerts ?? []).map((risk) => [
        risk.code,
        "CONFIRMED" as const,
      ]),
    ),
  );
  const [riskNotes, setRiskNotes] = useState<Record<string, string>>(
    {},
  );

  function selectRecommendation(id: string) {
    const next = pending.find((row) => row.id === id);
    setRecommendationId(id);
    setFinalTopupUsdt(
      next?.system_recommended_topup_usdt === null ||
        next?.system_recommended_topup_usdt === undefined
        ? ""
        : String(next.system_recommended_topup_usdt),
    );
    setFinalQuoteRate(
      next?.system_recommended_quote_rate === null ||
        next?.system_recommended_quote_rate === undefined
        ? ""
        : String(next.system_recommended_quote_rate),
    );
    setRiskJudgments(
      Object.fromEntries(
        (next?.system_risk_alerts ?? []).map((risk) => [
          risk.code,
          "CONFIRMED" as const,
        ]),
      ),
    );
    setRiskNotes({});
  }

  async function generateRecommendation() {
    setBusy(true);
    setMessage("");
    try {
      const response = await authorizedFetch(
        "/api/settlement-learning",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            kind: "GENERATE_RECOMMENDATION",
            clientRequestId: crypto.randomUUID(),
            currency: "VND",
          }),
        },
      );
      const body = (await response.json()) as {
        message?: string;
      };
      if (!response.ok) {
        throw new Error(body.message ?? "系统建议保存失败");
      }
      setMessage(
        "系统建议已作为不可变快照保存，等待人工审核；没有触发任何执行。",
      );
      router.refresh();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "系统建议保存失败",
      );
    } finally {
      setBusy(false);
    }
  }

  async function submitDecision(
    event: React.FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();
    if (!selected) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await authorizedFetch(
        "/api/settlement-learning",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            kind: "SUBMIT_DECISION",
            recommendationId: selected.id,
            decisionScope,
            acceptanceStatus,
            finalTopupUsdt: finalTopupUsdt || null,
            finalQuoteRate: finalQuoteRate || null,
            finalExecutionDecision,
            adjustmentReason: reason,
            merchantName: merchantName || null,
            transactionVolumeUsdt: transactionVolumeUsdt || null,
            profitContributionUsdt:
              profitContributionUsdt || null,
            riskFeedback: risks.map((risk) => ({
              risk_code: risk.code,
              human_judgment:
                riskJudgments[risk.code] ?? "CONFIRMED",
              human_note: riskNotes[risk.code] ?? "",
            })),
          }),
        },
      );
      const body = (await response.json()) as {
        message?: string;
      };
      if (!response.ok) {
        throw new Error(body.message ?? "人工决策保存失败");
      }
      setMessage(
        "人工决策已追加保存。该记录只表达人工意图，没有执行付款、补U或报价修改。",
      );
      setReason("");
      router.refresh();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "人工决策保存失败",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="learning-workflow">
      <section className="learning-generate">
        <div>
          <strong>生成并保存新建议</strong>
          <span>
            重新计算结算智能结果，并保存完整系统建议快照。
          </span>
        </div>
        <button
          className="button button-primary"
          disabled={busy}
          onClick={generateRecommendation}
          type="button"
        >
          {busy ? (
            <RefreshCw className="spin" size={14} />
          ) : (
            <Sparkles size={14} />
          )}
          生成建议
        </button>
      </section>

      <form className="learning-review-form" onSubmit={submitDecision}>
        <div className="learning-form-heading">
          <div>
            <strong>人工最终决策</strong>
            <span>所有字段只进入学习记录，不会调用执行系统。</span>
          </div>
          <span className="tag tag-violet">PHASE 1</span>
        </div>

        {pending.length === 0 ? (
          <div className="empty-state">
            <strong>暂无待审核建议</strong>
            请先生成新的系统建议。
          </div>
        ) : (
          <>
            <div className="learning-form-grid">
              <label>
                待审核建议
                <select
                  value={selected?.id ?? ""}
                  onChange={(event) =>
                    selectRecommendation(event.target.value)
                  }
                >
                  {pending.map((row) => (
                    <option key={row.id} value={row.id}>
                      {new Date(
                        row.recommendation_time,
                      ).toLocaleString("zh-CN", {
                        timeZone: "Asia/Shanghai",
                      })}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                审核范围
                <select
                  value={decisionScope}
                  onChange={(event) =>
                    setDecisionScope(
                      event.target.value as typeof decisionScope,
                    )
                  }
                >
                  <option value="FULL_REVIEW">完整建议</option>
                  <option value="TOPUP">补U建议</option>
                  <option value="QUOTE">商户报价</option>
                  <option value="RISK">风险判断</option>
                </select>
              </label>
              <label>
                是否接受
                <select
                  value={acceptanceStatus}
                  onChange={(event) =>
                    setAcceptanceStatus(
                      event.target.value as typeof acceptanceStatus,
                    )
                  }
                >
                  <option value="ACCEPTED">接受</option>
                  <option value="MODIFIED">人工调整</option>
                  <option value="REJECTED">拒绝</option>
                </select>
              </label>
              <label>
                最终执行决定
                <select
                  value={finalExecutionDecision}
                  onChange={(event) =>
                    setFinalExecutionDecision(
                      event.target
                        .value as typeof finalExecutionDecision,
                    )
                  }
                >
                  <option value="DEFER">暂缓</option>
                  <option value="DO_NOT_EXECUTE">不执行</option>
                  <option value="ACCEPT_FOR_MANUAL_EXECUTION">
                    同意后续人工处理
                  </option>
                  <option value="NOT_APPLICABLE">不适用</option>
                </select>
              </label>
              <label>
                人工最终补U金额（USDT）
                <input
                  inputMode="decimal"
                  value={finalTopupUsdt}
                  onChange={(event) =>
                    setFinalTopupUsdt(event.target.value)
                  }
                />
              </label>
              <label>
                人工最终报价
                <input
                  inputMode="decimal"
                  value={finalQuoteRate}
                  onChange={(event) =>
                    setFinalQuoteRate(event.target.value)
                  }
                />
              </label>
              <label>
                商户
                <input
                  required={decisionScope === "QUOTE"}
                  value={merchantName}
                  onChange={(event) =>
                    setMerchantName(event.target.value)
                  }
                />
              </label>
              <label>
                交易量（USDT）
                <input
                  inputMode="decimal"
                  required={decisionScope === "QUOTE"}
                  value={transactionVolumeUsdt}
                  onChange={(event) =>
                    setTransactionVolumeUsdt(event.target.value)
                  }
                />
              </label>
              <label>
                利润贡献（USDT）
                <input
                  inputMode="decimal"
                  required={decisionScope === "QUOTE"}
                  value={profitContributionUsdt}
                  onChange={(event) =>
                    setProfitContributionUsdt(event.target.value)
                  }
                />
              </label>
              <label className="learning-reason-field">
                人工调整原因
                <textarea
                  required
                  maxLength={1000}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="记录接受、修改或拒绝建议的业务原因"
                />
              </label>
            </div>

            <div className="learning-risk-review">
              <strong>风险逐项判断</strong>
              {risks.length === 0 ? (
                <span className="muted">本次系统建议没有风险提醒。</span>
              ) : (
                risks.map((risk) => (
                  <div className="learning-risk-row" key={risk.code}>
                    <div>
                      <span className="mono">{risk.code}</span>
                      <small>{risk.message}</small>
                    </div>
                    <select
                      value={
                        riskJudgments[risk.code] ?? "CONFIRMED"
                      }
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
                      placeholder="备注（可选）"
                      value={riskNotes[risk.code] ?? ""}
                      onChange={(event) =>
                        setRiskNotes((current) => ({
                          ...current,
                          [risk.code]: event.target.value,
                        }))
                      }
                    />
                  </div>
                ))
              )}
            </div>

            <button
              className="button button-primary"
              disabled={busy}
              type="submit"
            >
              {busy ? (
                <RefreshCw className="spin" size={14} />
              ) : (
                <Save size={14} />
              )}
              保存人工决策
            </button>
          </>
        )}
      </form>

      {message ? <div className="alert alert-info">{message}</div> : null}
    </div>
  );
}
