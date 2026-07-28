"use client";

import { Check, Edit3, RefreshCw, ShieldCheck, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { authorizedFetch } from "@/lib/authorized-fetch";

type RequestType = "TOPUP" | "QUOTE" | "RISK";

type Reason = {
  id: string;
  reason_code: string;
  display_name: string;
  description: string;
  applies_to: string[];
};

type ApprovalRequest = {
  id: string;
  request_type: RequestType;
  ai_topup_usdt: string | number | null;
  ai_quote_rate: string | number | null;
  ai_risk_level: "LOW" | "MEDIUM" | "HIGH";
  latest_action_id: string | null;
  latest_action_version: number | null;
  latest_action_type: string | null;
  final_topup_usdt: string | number | null;
  final_quote_rate: string | number | null;
  final_risk_level: "LOW" | "MEDIUM" | "HIGH" | null;
};

export function ApprovalQueueSync({
  recommendationId,
  queueExists,
}: {
  recommendationId: string | null;
  queueExists: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function syncQueue() {
    if (!recommendationId) {
      setMessage("请先在人工反馈学习页面生成一条VND系统建议。");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const response = await authorizedFetch("/api/approval-center", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "SYNC_QUEUE",
          clientRequestId: crypto.randomUUID(),
          recommendationId,
        }),
      });
      const body = (await response.json()) as { message?: string };
      if (!response.ok) {
        throw new Error(body.message ?? "审批队列生成失败");
      }
      setMessage(
        "AI建议已冻结为人工审批请求；未触发付款、补U、报价修改或交易。",
      );
      router.refresh();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "审批队列生成失败",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="approval-sync">
      <div>
        <strong>
          {queueExists ? "今日审批队列已生成" : "生成今日审批队列"}
        </strong>
        <span>
          将最新不可变AI建议拆分为补U、商户报价和风险审批项。
        </span>
      </div>
      <button
        className="button button-primary"
        disabled={busy || queueExists}
        onClick={syncQueue}
        type="button"
      >
        {busy ? (
          <RefreshCw className="spin" size={14} />
        ) : (
          <ShieldCheck size={14} />
        )}
        {queueExists ? "已生成" : "生成审批请求"}
      </button>
      {message ? <div className="alert alert-info">{message}</div> : null}
    </div>
  );
}

export function ApprovalActionForm({
  approvalRequest,
  reasons,
}: {
  approvalRequest: ApprovalRequest;
  reasons: Reason[];
}) {
  const router = useRouter();
  const applicableReasons = useMemo(
    () =>
      reasons.filter((reason) =>
        reason.applies_to.includes(approvalRequest.request_type),
      ),
    [approvalRequest.request_type, reasons],
  );
  const [reasonCode, setReasonCode] = useState(
    applicableReasons[0]?.reason_code ?? "",
  );
  const [reasonDetail, setReasonDetail] = useState("");
  const [finalTopup, setFinalTopup] = useState(
    String(
      approvalRequest.final_topup_usdt ??
        approvalRequest.ai_topup_usdt ??
        "",
    ),
  );
  const [finalQuote, setFinalQuote] = useState(
    String(
      approvalRequest.final_quote_rate ??
        approvalRequest.ai_quote_rate ??
        "",
    ),
  );
  const [finalRisk, setFinalRisk] = useState<
    "LOW" | "MEDIUM" | "HIGH"
  >(approvalRequest.final_risk_level ?? approvalRequest.ai_risk_level);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function recordAction(actionType: string) {
    if (!reasonCode || !reasonDetail.trim()) {
      setMessage("请选择原因并填写具体说明。");
      return;
    }
    if (
      actionType === "MODIFIED" &&
      approvalRequest.request_type === "TOPUP" &&
      !finalTopup
    ) {
      setMessage("修改补U建议时必须填写人工最终金额。");
      return;
    }
    if (
      actionType === "MODIFIED" &&
      approvalRequest.request_type === "QUOTE" &&
      !finalQuote
    ) {
      setMessage("修改报价建议时必须填写人工最终报价。");
      return;
    }

    setBusy(true);
    setMessage("");
    try {
      const response = await authorizedFetch("/api/approval-center", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "RECORD_ACTION",
          clientRequestId: crypto.randomUUID(),
          approvalRequestId: approvalRequest.id,
          requestType: approvalRequest.request_type,
          actionType,
          finalTopupUsdt:
            approvalRequest.request_type === "TOPUP" &&
            actionType === "MODIFIED"
              ? finalTopup
              : null,
          finalQuoteRate:
            approvalRequest.request_type === "QUOTE" &&
            actionType === "MODIFIED"
              ? finalQuote
              : null,
          finalRiskLevel:
            approvalRequest.request_type === "RISK" &&
            actionType === "ADJUSTED"
              ? finalRisk
              : null,
          reasonCode,
          reasonDetail,
        }),
      });
      const body = (await response.json()) as { message?: string };
      if (!response.ok) {
        throw new Error(body.message ?? "人工审批保存失败");
      }
      setReasonDetail("");
      setMessage(
        "人工结果已追加为不可变版本，并进入90天学习数据；未执行任何外部动作。",
      );
      router.refresh();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "人工审批保存失败",
      );
    } finally {
      setBusy(false);
    }
  }

  const isRisk = approvalRequest.request_type === "RISK";

  return (
    <div className="approval-action-form">
      {approvalRequest.request_type === "TOPUP" ? (
        <label>
          人工修改后补U金额（USDT）
          <input
            inputMode="decimal"
            min="0"
            onChange={(event) => setFinalTopup(event.target.value)}
            type="number"
            value={finalTopup}
          />
        </label>
      ) : null}
      {approvalRequest.request_type === "QUOTE" ? (
        <label>
          人工修改后报价
          <input
            inputMode="decimal"
            min="0"
            onChange={(event) => setFinalQuote(event.target.value)}
            type="number"
            value={finalQuote}
          />
        </label>
      ) : null}
      {isRisk ? (
        <label>
          人工调整后风险等级
          <select
            onChange={(event) =>
              setFinalRisk(
                event.target.value as "LOW" | "MEDIUM" | "HIGH",
              )
            }
            value={finalRisk}
          >
            <option value="LOW">LOW</option>
            <option value="MEDIUM">MEDIUM</option>
            <option value="HIGH">HIGH</option>
          </select>
        </label>
      ) : null}
      <label>
        调整原因分类
        <select
          onChange={(event) => setReasonCode(event.target.value)}
          value={reasonCode}
        >
          {applicableReasons.map((reason) => (
            <option key={reason.id} value={reason.reason_code}>
              {reason.display_name}
            </option>
          ))}
        </select>
      </label>
      <label className="approval-reason-detail">
        具体原因（必填）
        <textarea
          maxLength={1000}
          onChange={(event) => setReasonDetail(event.target.value)}
          placeholder="记录人工判断依据，供90天学习与审计使用"
          value={reasonDetail}
        />
      </label>
      <div className="approval-action-buttons">
        <button
          className="button button-primary"
          disabled={busy}
          onClick={() =>
            recordAction(isRisk ? "CONFIRMED" : "ACCEPTED")
          }
          type="button"
        >
          <Check size={14} />
          {isRisk ? "确认风险" : "接受"}
        </button>
        <button
          className="button"
          disabled={busy}
          onClick={() =>
            recordAction(isRisk ? "ADJUSTED" : "MODIFIED")
          }
          type="button"
        >
          <Edit3 size={14} />
          {isRisk ? "调整风险" : "修改"}
        </button>
        <button
          className="button button-danger"
          disabled={busy}
          onClick={() =>
            recordAction(isRisk ? "IGNORED" : "REJECTED")
          }
          type="button"
        >
          <X size={14} />
          {isRisk ? "忽略风险" : "拒绝"}
        </button>
      </div>
      {approvalRequest.latest_action_id ? (
        <small className="approval-latest-action">
          最新人工结果：{approvalRequest.latest_action_type} · v
          {approvalRequest.latest_action_version}
        </small>
      ) : null}
      {message ? <div className="alert alert-info">{message}</div> : null}
    </div>
  );
}
