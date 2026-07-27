"use client";

import { RefreshCw, Save, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { authorizedFetch } from "@/lib/authorized-fetch";

type RiskAlert = {
  code: string;
  severity: "INFO" | "WARNING" | "HIGH";
  message: string;
  source: string;
};

type RiskReview = {
  risk_code: string;
  review_version: number;
  human_judgment: "CONFIRMED" | "IGNORED";
  human_note: string | null;
};

export function SettlementControlActions({
  latestSnapshotId,
  latestSnapshotRisks,
  latestReviews,
}: {
  latestSnapshotId: string | null;
  latestSnapshotRisks: RiskAlert[];
  latestReviews: RiskReview[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [riskCode, setRiskCode] = useState(
    latestSnapshotRisks[0]?.code ?? "",
  );
  const [judgment, setJudgment] = useState<
    "CONFIRMED" | "IGNORED"
  >("CONFIRMED");
  const [note, setNote] = useState("");
  const reviewsByCode = useMemo(
    () =>
      new Map(
        latestReviews.map((review) => [review.risk_code, review]),
      ),
    [latestReviews],
  );

  async function saveSnapshot() {
    setBusy(true);
    setMessage("");
    try {
      const response = await authorizedFetch(
        "/api/settlement-control-center",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            kind: "SAVE_SNAPSHOT",
            clientRequestId: crypto.randomUUID(),
          }),
        },
      );
      const body = (await response.json()) as { message?: string };
      if (!response.ok) {
        throw new Error(body.message ?? "每日快照保存失败");
      }
      setMessage(
        "今日控制中心建议已作为不可变快照保存；没有触发任何资金或报价操作。",
      );
      router.refresh();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "每日快照保存失败",
      );
    } finally {
      setBusy(false);
    }
  }

  async function reviewRisk(
    event: React.FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();
    if (!latestSnapshotId || !riskCode) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await authorizedFetch(
        "/api/settlement-control-center",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            kind: "REVIEW_RISK",
            controlSnapshotId: latestSnapshotId,
            riskCode,
            humanJudgment: judgment,
            humanNote: note || null,
          }),
        },
      );
      const body = (await response.json()) as { message?: string };
      if (!response.ok) {
        throw new Error(body.message ?? "风险判断保存失败");
      }
      setMessage(
        "人工风险判断已追加并保留审计；该判断不会执行任何操作。",
      );
      setNote("");
      router.refresh();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "风险判断保存失败",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="control-actions">
      <section className="control-snapshot-action">
        <div>
          <strong>保存今日运营建议</strong>
          <span>
            将当前资金、预测、补U、报价、汇率和风险建议保存为不可变快照。
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
          保存今日快照
        </button>
      </section>

      <form className="control-risk-form" onSubmit={reviewRisk}>
        <div>
          <strong>人工风险判断</strong>
          <span>
            针对最近一次已保存快照确认、忽略或增加备注。
          </span>
        </div>
        {!latestSnapshotId || latestSnapshotRisks.length === 0 ? (
          <div className="empty-state">
            <ShieldCheck size={22} />
            <strong>暂无可审核的已保存风险</strong>
            请先保存今日快照。
          </div>
        ) : (
          <div className="control-risk-form-grid">
            <label>
              风险
              <select
                value={riskCode}
                onChange={(event) => setRiskCode(event.target.value)}
              >
                {latestSnapshotRisks.map((risk) => (
                  <option key={risk.code} value={risk.code}>
                    {risk.code}
                  </option>
                ))}
              </select>
            </label>
            <label>
              人工判断
              <select
                value={judgment}
                onChange={(event) =>
                  setJudgment(
                    event.target.value as
                      | "CONFIRMED"
                      | "IGNORED",
                  )
                }
              >
                <option value="CONFIRMED">确认风险</option>
                <option value="IGNORED">忽略风险</option>
              </select>
            </label>
            <label className="control-risk-note">
              人工备注
              <input
                maxLength={1000}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="国际局势、市场变化或业务判断"
              />
            </label>
            <button
              className="button button-primary"
              disabled={busy}
              type="submit"
            >
              保存风险判断
            </button>
            {riskCode && reviewsByCode.has(riskCode) ? (
              <div className="alert alert-info control-review-current">
                最近判断：
                {reviewsByCode.get(riskCode)?.human_judgment} · 版本
                {reviewsByCode.get(riskCode)?.review_version}
                {reviewsByCode.get(riskCode)?.human_note
                  ? ` · ${reviewsByCode.get(riskCode)?.human_note}`
                  : ""}
              </div>
            ) : null}
          </div>
        )}
      </form>

      {message ? <div className="alert alert-info">{message}</div> : null}
    </div>
  );
}
