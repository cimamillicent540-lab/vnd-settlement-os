"use client";

import { RefreshCw, Save, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { authorizedFetch } from "@/lib/authorized-fetch";

type RiskAlert = {
  code: string;
  severity?: string;
  message?: string;
};

export type DecisionValidationRow = {
  human_decision_id: string;
  recommendation_time: string;
  decision_scope: string;
  acceptance_status: string;
  system_risk_alerts: RiskAlert[] | null;
  pending_outcome: boolean;
};

export function SettlementDailyReportActions({
  validationQueue,
}: {
  validationQueue: DecisionValidationRow[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const ordered = useMemo(
    () =>
      [...validationQueue].sort(
        (left, right) =>
          Number(right.pending_outcome) -
          Number(left.pending_outcome),
      ),
    [validationQueue],
  );
  const [decisionId, setDecisionId] = useState(
    ordered[0]?.human_decision_id ?? "",
  );
  const selected =
    ordered.find((row) => row.human_decision_id === decisionId) ??
    ordered[0];
  const risks = Array.isArray(selected?.system_risk_alerts)
    ? selected.system_risk_alerts
    : [];
  const [actualTopup, setActualTopup] = useState("");
  const [actualQuote, setActualQuote] = useState("");
  const [actualCashProfit, setActualCashProfit] = useState("");
  const [actualEconomicProfit, setActualEconomicProfit] =
    useState("");
  const [reason, setReason] = useState("");
  const [riskRealized, setRiskRealized] = useState<
    Record<string, boolean>
  >({});

  async function saveSnapshot() {
    setBusy(true);
    setMessage("");
    try {
      const response = await authorizedFetch(
        "/api/settlement-daily-report",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            kind: "SAVE_DAILY_SNAPSHOT",
            clientRequestId: crypto.randomUUID(),
          }),
        },
      );
      const body = (await response.json()) as { message?: string };
      if (!response.ok) {
        throw new Error(body.message ?? "日报快照保存失败");
      }
      setMessage(
        "每日运营快照已不可变保存；未触发付款、补U、报价或交易。",
      );
      router.refresh();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "日报快照保存失败",
      );
    } finally {
      setBusy(false);
    }
  }

  async function saveOutcome(
    event: React.FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();
    if (!selected) return;
    if (
      !actualTopup &&
      !actualQuote &&
      !actualCashProfit &&
      !actualEconomicProfit &&
      risks.length === 0
    ) {
      setMessage("至少填写一个后验结果指标。");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const response = await authorizedFetch(
        "/api/settlement-daily-report",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            kind: "RECORD_DECISION_OUTCOME",
            clientRequestId: crypto.randomUUID(),
            humanDecisionId: selected.human_decision_id,
            measuredAt: new Date().toISOString(),
            actualTopupUsdt: actualTopup || null,
            actualQuoteRate: actualQuote || null,
            actualCashProfitUsdt: actualCashProfit || null,
            actualEconomicProfitUsdt:
              actualEconomicProfit || null,
            actualRiskOutcomes: risks.map((risk) => ({
              risk_code: risk.code,
              realized: riskRealized[risk.code] ?? false,
              note: "",
            })),
            outcomeReason: reason,
          }),
        },
      );
      const body = (await response.json()) as { message?: string };
      if (!response.ok) {
        throw new Error(body.message ?? "后验结果保存失败");
      }
      setMessage(
        "后验结果已追加保存，仅用于90天描述性准确率统计，不会自动优化或执行。",
      );
      setReason("");
      router.refresh();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "后验结果保存失败",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="daily-report-actions">
      <section className="daily-snapshot-save">
        <div>
          <strong>保存今日运营快照</strong>
          <span>
            固化资金、预测、双利润、汇率、商户贡献和风险证据。
          </span>
        </div>
        <button
          className="button button-primary"
          disabled={busy}
          onClick={saveSnapshot}
          type="button"
        >
          {busy ? (
            <RefreshCw className="spin" size={14} />
          ) : (
            <Save size={14} />
          )}
          保存快照
        </button>
      </section>

      <form className="daily-outcome-form" onSubmit={saveOutcome}>
        <div className="learning-form-heading">
          <div>
            <strong>人工记录后续实际结果</strong>
            <span>
              对比原系统建议和人工决定；所有修正以新版本追加。
            </span>
          </div>
          <span className="tag tag-violet">STATISTICS ONLY</span>
        </div>
        {ordered.length === 0 ? (
          <div className="empty-state">
            <ShieldCheck size={24} />
            <strong>暂无已审核决策</strong>
            先在人工反馈学习页完成审核，再记录后验结果。
          </div>
        ) : (
          <>
            <div className="learning-form-grid">
              <label>
                已审核决策
                <select
                  value={selected?.human_decision_id ?? ""}
                  onChange={(event) =>
                    setDecisionId(event.target.value)
                  }
                >
                  {ordered.map((row) => (
                    <option
                      key={row.human_decision_id}
                      value={row.human_decision_id}
                    >
                      {new Date(
                        row.recommendation_time,
                      ).toLocaleString("zh-CN", {
                        timeZone: "Asia/Shanghai",
                      })}
                      {" · "}
                      {row.decision_scope}
                      {" · "}
                      {row.pending_outcome ? "待评价" : "已有结果"}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                实际补U（USDT）
                <input
                  inputMode="decimal"
                  value={actualTopup}
                  onChange={(event) =>
                    setActualTopup(event.target.value)
                  }
                />
              </label>
              <label>
                实际报价
                <input
                  inputMode="decimal"
                  value={actualQuote}
                  onChange={(event) =>
                    setActualQuote(event.target.value)
                  }
                />
              </label>
              <label>
                实际 Cash Profit（USDT）
                <input
                  inputMode="decimal"
                  value={actualCashProfit}
                  onChange={(event) =>
                    setActualCashProfit(event.target.value)
                  }
                />
              </label>
              <label>
                实际 Economic Profit（USDT）
                <input
                  inputMode="decimal"
                  value={actualEconomicProfit}
                  onChange={(event) =>
                    setActualEconomicProfit(event.target.value)
                  }
                />
              </label>
              <label className="learning-reason-field">
                后验记录原因/证据
                <textarea
                  maxLength={1000}
                  placeholder="必填：说明数据来源、调整或评价原因"
                  required
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                />
              </label>
            </div>
            {risks.length > 0 ? (
              <div className="daily-risk-outcomes">
                <strong>风险是否实际发生</strong>
                {risks.map((risk) => (
                  <label key={risk.code}>
                    <input
                      checked={riskRealized[risk.code] ?? false}
                      onChange={(event) =>
                        setRiskRealized((current) => ({
                          ...current,
                          [risk.code]: event.target.checked,
                        }))
                      }
                      type="checkbox"
                    />
                    <span>
                      {risk.code}
                      {risk.message ? ` · ${risk.message}` : ""}
                    </span>
                  </label>
                ))}
              </div>
            ) : null}
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
              保存后验结果
            </button>
          </>
        )}
      </form>
      {message ? <div className="alert alert-info">{message}</div> : null}
    </div>
  );
}
