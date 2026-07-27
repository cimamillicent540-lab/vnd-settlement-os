"use client";

import { Play, RefreshCw, Save, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { authorizedFetch } from "@/lib/authorized-fetch";

type RiskAlert = {
  code: string;
  severity?: string;
  message?: string;
};

type EligibleDay = {
  id: string;
  operating_date: string;
  acceptance_status: string;
  adjustment_reason_category: string;
  adjustment_reason: string;
  final_topup_usdt: string | null;
  final_quote_rate: string | null;
  recommendation: {
    system_recommended_topup_usdt: string | null;
    system_recommended_quote_rate: string | null;
    system_cash_profit_usdt: string | null;
    system_economic_profit_usdt: string | null;
    system_risk_alerts: RiskAlert[] | null;
  } | null;
  riskCheck: {
    risk_level: string;
  } | null;
};

export function ShadowValidationActions({
  today,
  activePeriodId,
  eligibleDays,
}: {
  today: string;
  activePeriodId: string | null;
  eligibleDays: EligibleDay[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [startDate, setStartDate] = useState(today);
  const [selectedReviewId, setSelectedReviewId] = useState(
    eligibleDays[0]?.id ?? "",
  );
  const selected = useMemo(
    () =>
      eligibleDays.find((day) => day.id === selectedReviewId) ??
      eligibleDays[0] ??
      null,
    [eligibleDays, selectedReviewId],
  );
  const risks = Array.isArray(
    selected?.recommendation?.system_risk_alerts,
  )
    ? selected.recommendation.system_risk_alerts
    : [];
  const [actualTopup, setActualTopup] = useState("");
  const [actualQuote, setActualQuote] = useState("");
  const [actualCashProfit, setActualCashProfit] = useState("");
  const [actualEconomicProfit, setActualEconomicProfit] =
    useState("");
  const [actualFxGain, setActualFxGain] = useState("");
  const [pressureBefore, setPressureBefore] = useState("");
  const [pressureAfter, setPressureAfter] = useState("");
  const [unexpectedRiskCount, setUnexpectedRiskCount] =
    useState("0");
  const [unexpectedRiskNotes, setUnexpectedRiskNotes] =
    useState("");
  const [outcomeReason, setOutcomeReason] = useState("");
  const [riskRealized, setRiskRealized] = useState<
    Record<string, boolean>
  >({});
  const [riskNotes, setRiskNotes] = useState<Record<string, string>>(
    {},
  );

  async function submit(
    payload: Record<string, unknown>,
    success: string,
  ) {
    setBusy(true);
    setMessage("");
    try {
      const response = await authorizedFetch(
        "/api/shadow-validation",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const body = (await response.json()) as { message?: string };
      if (!response.ok) {
        throw new Error(body.message ?? "Shadow Validation保存失败");
      }
      setMessage(success);
      router.refresh();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Shadow Validation保存失败",
      );
    } finally {
      setBusy(false);
    }
  }

  function startPeriod(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submit(
      {
        kind: "START_PERIOD",
        clientRequestId: crypto.randomUUID(),
        startDate,
      },
      "7天Shadow Validation周期已不可变创建；不会触发任何自动操作。",
    );
  }

  function captureDay(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activePeriodId || !selected) return;
    void submit(
      {
        kind: "CAPTURE_DAILY_RESULT",
        clientRequestId: crypto.randomUUID(),
        outcomeClientRequestId: crypto.randomUUID(),
        periodId: activePeriodId,
        sourceEndReviewId: selected.id,
        validationDate: selected.operating_date,
        actualTopupUsdt: actualTopup,
        actualQuoteRate: actualQuote,
        actualCashProfitUsdt: actualCashProfit,
        actualEconomicProfitUsdt: actualEconomicProfit,
        actualFxGainUsdt: actualFxGain,
        fundingPressureBeforeVnd: pressureBefore,
        fundingPressureAfterVnd: pressureAfter,
        actualRiskOutcomes: risks.map((risk) => ({
          risk_code: risk.code,
          realized: riskRealized[risk.code] ?? false,
          note: riskNotes[risk.code] ?? "",
        })),
        unexpectedRiskCount: Number(unexpectedRiskCount),
        unexpectedRiskNotes,
        outcomeReason,
      },
      "每日AI、人工与实际结果已追加保存并生成描述性准确率；未自动优化或执行。",
    );
  }

  return (
    <div className="shadow-validation-actions">
      {!activePeriodId ? (
        <form
          className="shadow-validation-start"
          onSubmit={startPeriod}
        >
          <div>
            <strong>启动7天验证周期</strong>
            <span>
              周期从所选运营日开始，结束日固定为第7天；重叠周期会被数据库拒绝。
            </span>
          </div>
          <label>
            开始日期
            <input
              disabled={busy}
              required
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
            />
          </label>
          <button
            className="button button-primary"
            disabled={busy}
            type="submit"
          >
            {busy ? (
              <RefreshCw className="spin" size={14} />
            ) : (
              <Play size={14} />
            )}
            启动周期
          </button>
        </form>
      ) : (
        <form
          className="shadow-validation-capture"
          onSubmit={captureDay}
        >
          <div className="daily-operation-form-heading">
            <div>
              <strong>记录每日实际结果</strong>
              <span>
                仅显示周期内已完成23:00复盘且尚未验证的日期。
              </span>
            </div>
            <span className="tag tag-violet">STATISTICS ONLY</span>
          </div>

          {eligibleDays.length === 0 ? (
            <div className="empty-state">
              <ShieldCheck size={24} />
              <strong>暂无可验证的23:00复盘</strong>
              完成周期内当日运营复盘后，再追加实际结果。
            </div>
          ) : (
            <>
              <div className="shadow-validation-form-grid">
                <label>
                  待验证运营日
                  <select
                    disabled={busy}
                    value={selected?.id ?? ""}
                    onChange={(event) =>
                      setSelectedReviewId(event.target.value)
                    }
                  >
                    {eligibleDays.map((day) => (
                      <option key={day.id} value={day.id}>
                        {day.operating_date} · {day.acceptance_status}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  实际补U（USDT）
                  <input
                    disabled={busy}
                    inputMode="decimal"
                    required
                    value={actualTopup}
                    onChange={(event) =>
                      setActualTopup(event.target.value)
                    }
                  />
                </label>
                <label>
                  实际报价
                  <input
                    disabled={busy}
                    inputMode="decimal"
                    required
                    value={actualQuote}
                    onChange={(event) =>
                      setActualQuote(event.target.value)
                    }
                  />
                </label>
                <label>
                  实际 Cash Profit（USDT）
                  <input
                    disabled={busy}
                    inputMode="decimal"
                    required
                    value={actualCashProfit}
                    onChange={(event) =>
                      setActualCashProfit(event.target.value)
                    }
                  />
                </label>
                <label>
                  实际 Economic Profit（USDT）
                  <input
                    disabled={busy}
                    inputMode="decimal"
                    required
                    value={actualEconomicProfit}
                    onChange={(event) =>
                      setActualEconomicProfit(event.target.value)
                    }
                  />
                </label>
                <label>
                  实际汇率收益（USDT）
                  <input
                    disabled={busy}
                    inputMode="decimal"
                    required
                    value={actualFxGain}
                    onChange={(event) =>
                      setActualFxGain(event.target.value)
                    }
                  />
                </label>
                <label>
                  决策前资金压力（VND）
                  <input
                    disabled={busy}
                    inputMode="decimal"
                    required
                    value={pressureBefore}
                    onChange={(event) =>
                      setPressureBefore(event.target.value)
                    }
                  />
                </label>
                <label>
                  结果后资金压力（VND）
                  <input
                    disabled={busy}
                    inputMode="decimal"
                    required
                    value={pressureAfter}
                    onChange={(event) =>
                      setPressureAfter(event.target.value)
                    }
                  />
                </label>
                <label>
                  未预测风险数量
                  <input
                    disabled={busy}
                    inputMode="numeric"
                    min="0"
                    max="100"
                    required
                    type="number"
                    value={unexpectedRiskCount}
                    onChange={(event) =>
                      setUnexpectedRiskCount(event.target.value)
                    }
                  />
                </label>
                <label className="shadow-validation-wide">
                  未预测风险说明
                  <textarea
                    disabled={busy}
                    maxLength={2000}
                    placeholder="数量大于0时必填"
                    required={Number(unexpectedRiskCount) > 0}
                    value={unexpectedRiskNotes}
                    onChange={(event) =>
                      setUnexpectedRiskNotes(event.target.value)
                    }
                  />
                </label>
                <label className="shadow-validation-wide">
                  实际结果依据
                  <textarea
                    disabled={busy}
                    maxLength={1000}
                    placeholder="必填：说明利润、补U、报价、资金压力和风险结果的数据来源"
                    required
                    value={outcomeReason}
                    onChange={(event) =>
                      setOutcomeReason(event.target.value)
                    }
                  />
                </label>
              </div>

              <div className="shadow-validation-source">
                <span>AI补U建议</span>
                <strong>
                  {selected?.recommendation
                    ?.system_recommended_topup_usdt ?? "0"}{" "}
                  USDT
                </strong>
                <span>AI报价建议</span>
                <strong>
                  {selected?.recommendation
                    ?.system_recommended_quote_rate ?? "不可计算"}
                </strong>
                <span>AI风险等级</span>
                <strong>
                  {selected?.riskCheck?.risk_level ?? "—"}
                </strong>
                <span>人工决策</span>
                <strong>{selected?.acceptance_status ?? "—"}</strong>
              </div>

              {risks.length > 0 ? (
                <div className="daily-operation-risk-feedback">
                  <strong>AI风险预测的实际结果</strong>
                  {risks.map((risk) => (
                    <div key={risk.code}>
                      <span>
                        <b>{risk.code}</b>
                        {risk.message ? ` · ${risk.message}` : ""}
                      </span>
                      <select
                        disabled={busy}
                        value={
                          riskRealized[risk.code] ? "true" : "false"
                        }
                        onChange={(event) =>
                          setRiskRealized((current) => ({
                            ...current,
                            [risk.code]:
                              event.target.value === "true",
                          }))
                        }
                      >
                        <option value="false">未发生</option>
                        <option value="true">已发生</option>
                      </select>
                      <input
                        disabled={busy}
                        maxLength={1000}
                        placeholder="结果备注"
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
                disabled={busy}
                type="submit"
              >
                {busy ? (
                  <RefreshCw className="spin" size={14} />
                ) : (
                  <Save size={14} />
                )}
                保存每日验证
              </button>
            </>
          )}
        </form>
      )}

      {message ? <div className="alert alert-info">{message}</div> : null}
    </div>
  );
}
