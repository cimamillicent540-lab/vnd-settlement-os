"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Calculator, ShieldCheck } from "lucide-react";

import { authorizedFetch } from "@/lib/authorized-fetch";

type EligibleRecord = {
  id: string;
  validation_date: string;
  day_number: number;
  ai_accuracy_score: string | number;
};

export function AiDecisionScoreActions({
  eligibleRecords,
}: {
  eligibleRecords: EligibleRecord[];
}) {
  const router = useRouter();
  const [savingId, setSavingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function generateScore(record: EligibleRecord) {
    setSavingId(record.id);
    setMessage(null);
    try {
      const response = await authorizedFetch(
        "/api/ai-decision-score",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            kind: "GENERATE_SCORE",
            clientRequestId: crypto.randomUUID(),
            validationRecordId: record.id,
          }),
        },
      );
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.message ?? "评分快照生成失败");
      }
      setMessage(
        body.idempotentReplay
          ? "该日当前模型评分已存在，未重复写入。"
          : `${record.validation_date} 评分已不可变保存。`,
      );
      router.refresh();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "评分快照生成失败",
      );
    } finally {
      setSavingId(null);
    }
  }

  if (eligibleRecords.length === 0) {
    return (
      <div className="alert alert-info">
        <ShieldCheck size={17} />
        <div>
          <strong>当前没有待评分的验证日</strong>
          评分只读取已经完成的Task 2.14日记录，不创建或修改业务结果。
        </div>
      </div>
    );
  }

  return (
    <div className="ai-score-actions">
      {eligibleRecords.map((record) => (
        <section key={record.id}>
          <div>
            <strong>
              Day {record.day_number} · {record.validation_date}
            </strong>
            <span>
              源AI Accuracy：
              {Number(record.ai_accuracy_score).toFixed(2)} / 100
            </span>
          </div>
          <button
            type="button"
            className="primary-button"
            disabled={savingId !== null}
            onClick={() => generateScore(record)}
          >
            <Calculator size={15} />
            {savingId === record.id
              ? "计算中…"
              : "生成评分快照"}
          </button>
        </section>
      ))}
      {message ? <p className="form-message">{message}</p> : null}
    </div>
  );
}
