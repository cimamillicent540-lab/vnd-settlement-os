"use client";

import { RefreshCw, Save, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { authorizedFetch } from "@/lib/authorized-fetch";
import { humanDecisionReasonIsValid } from "@/lib/business-rules";

type RiskAlert = {
  code: string;
  severity: "INFO" | "WARNING" | "HIGH";
  message: string;
};

type ConfirmationRecommendation = {
  id: string;
  recommendation_time: string;
  system_recommended_topup_usdt: string | number | null;
  system_recommended_quote_rate: string | number | null;
  system_risk_alerts: RiskAlert[] | null;
  latestDecision: {
    acceptance_status?: string;
    adjustment_reason?: string | null;
    reviewed_at?: string;
  } | null;
};

export function BusinessRulesConfirmationPanel({
  recommendation,
}: {
  recommendation: ConfirmationRecommendation | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [reason, setReason] = useState("");
  const [finalTopupUsdt, setFinalTopupUsdt] = useState(
    recommendation?.system_recommended_topup_usdt === null ||
      recommendation?.system_recommended_topup_usdt === undefined
      ? ""
      : String(recommendation.system_recommended_topup_usdt),
  );
  const [finalQuoteRate, setFinalQuoteRate] = useState(
    recommendation?.system_recommended_quote_rate === null ||
      recommendation?.system_recommended_quote_rate === undefined
      ? ""
      : String(recommendation.system_recommended_quote_rate),
  );
  const risks = useMemo(
    () => recommendation?.system_risk_alerts ?? [],
    [recommendation],
  );
  const [riskJudgments, setRiskJudgments] = useState<
    Record<string, "CONFIRMED" | "IGNORED">
  >(() =>
    Object.fromEntries(
      risks.map((risk) => [risk.code, "CONFIRMED" as const]),
    ),
  );
  const [riskNotes, setRiskNotes] = useState<Record<string, string>>(
    {},
  );

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
            source: "BUSINESS_RULES_CONFIRMATION",
          }),
        },
      );
      const body = (await response.json()) as { message?: string };
      if (!response.ok) {
        throw new Error(body.message ?? "今日建议保存失败");
      }
      setMessage(
        "今日系统建议已写入90天学习数据，只等待人工决定；未执行任何操作。",
      );
      router.refresh();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "今日建议保存失败",
      );
    } finally {
      setBusy(false);
    }
  }

  async function submitDecision(
    acceptanceStatus: "ACCEPTED" | "MODIFIED" | "REJECTED",
  ) {
    if (!recommendation) return;
    if (!humanDecisionReasonIsValid(reason)) {
      setMessage("接受、修改或拒绝均必须填写原因。");
      return;
    }
    if (
      acceptanceStatus === "MODIFIED" &&
      !finalTopupUsdt &&
      !finalQuoteRate
    ) {
      setMessage("修改建议时至少填写一个人工调整后的金额或报价。");
      return;
    }

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
            recommendationId: recommendation.id,
            decisionScope: "FULL_REVIEW",
            acceptanceStatus,
            finalTopupUsdt:
              acceptanceStatus === "REJECTED"
                ? null
                : finalTopupUsdt || null,
            finalQuoteRate:
              acceptanceStatus === "REJECTED"
                ? null
                : finalQuoteRate || null,
            finalExecutionDecision:
              acceptanceStatus === "REJECTED"
                ? "DO_NOT_EXECUTE"
                : "DEFER",
            adjustmentReason: reason,
            merchantName: null,
            transactionVolumeUsdt: null,
            profitContributionUsdt: null,
            riskFeedback: risks.map((risk) => ({
              risk_code: risk.code,
              human_judgment:
                riskJudgments[risk.code] ?? "CONFIRMED",
              human_note: riskNotes[risk.code] ?? "",
            })),
          }),
        },
      );
      const body = (await response.json()) as { message?: string };
      if (!response.ok) {
        throw new Error(body.message ?? "人工决定保存失败");
      }
      setReason("");
      setMessage(
        "人工决定已追加到90天学习数据。该决定不执行付款、补U、报价修改或交易。",
      );
      router.refresh();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "人工决定保存失败",
      );
    } finally {
      setBusy(false);
    }
  }

  if (!recommendation) {
    return (
      <div className="business-confirm-empty">
        <div>
          <strong>今日尚无不可变系统建议</strong>
          <span>
            先根据 Control Center 与 Settlement Intelligence
            生成今日建议，再进行人工确认。
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
          生成今日建议
        </button>
        {message ? (
          <div className="alert alert-info">{message}</div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="business-confirmation">
      <div className="business-confirmation-meta">
        <span>
          学习建议：
          {new Date(
            recommendation.recommendation_time,
          ).toLocaleString("zh-CN", {
            timeZone: "Asia/Shanghai",
            hour12: false,
          })}
        </span>
        <span>
          最新人工结果：
          {recommendation.latestDecision?.acceptance_status ??
            "PENDING"}
        </span>
      </div>

      <div className="business-confirm-grid">
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
        <label className="business-confirm-reason">
          人工决定原因（必填）
          <textarea
            maxLength={1000}
            required
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="说明接受、修改或拒绝的业务原因；该内容进入90天学习数据"
          />
        </label>
      </div>

      {risks.length > 0 ? (
        <div className="business-risk-feedback">
          <strong>风险因素人工判断</strong>
          {risks.map((risk) => (
            <div key={risk.code}>
              <span>
                {risk.severity} · {risk.code} · {risk.message}
              </span>
              <select
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

      <div className="business-confirm-buttons">
        <button
          className="button button-secondary"
          disabled={busy}
          onClick={() => void submitDecision("REJECTED")}
          type="button"
        >
          拒绝
        </button>
        <button
          className="button button-secondary"
          disabled={busy}
          onClick={() => void submitDecision("MODIFIED")}
          type="button"
        >
          <Save size={14} />
          修改并记录
        </button>
        <button
          className="button button-primary"
          disabled={busy}
          onClick={() => void submitDecision("ACCEPTED")}
          type="button"
        >
          接受
        </button>
      </div>

      {message ? (
        <div className="alert alert-info">{message}</div>
      ) : null}
    </div>
  );
}
