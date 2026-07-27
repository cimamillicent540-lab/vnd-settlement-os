"use client";

import { RefreshCw, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { authorizedFetch } from "@/lib/authorized-fetch";
import {
  MARKET_CONTEXT_CATEGORIES,
  type MarketContextCategory,
} from "@/lib/shadow-run-dashboard";

const categoryLabels: Record<MarketContextCategory, string> = {
  VND_POLICY: "越南政策变化",
  INTERNATIONAL_GEOPOLITICS: "国际局势",
  FED_EVENT: "美联储事件",
  BTC_VOLATILITY: "BTC波动",
  FX_ANOMALY: "汇率异常",
  PAYMENT_COMPANY_RISK: "支付公司风险",
};

function shanghaiToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function ShadowRunMarketNoteForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [contextDate, setContextDate] = useState(shanghaiToday);
  const [category, setCategory] =
    useState<MarketContextCategory>("VND_POLICY");
  const [severity, setSeverity] = useState<
    "INFO" | "WARNING" | "HIGH"
  >("INFO");
  const [title, setTitle] = useState("");
  const [reason, setReason] = useState("");
  const [evidence, setEvidence] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const response = await authorizedFetch(
        "/api/shadow-run-dashboard",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            kind: "RECORD_MARKET_CONTEXT_NOTE",
            clientRequestId: crypto.randomUUID(),
            contextDate,
            observedAt: new Date().toISOString(),
            category,
            severity,
            title,
            observationReason: reason,
            evidenceReference: evidence || null,
          }),
        },
      );
      const body = (await response.json()) as { message?: string };
      if (!response.ok) {
        throw new Error(body.message ?? "市场背景观察保存失败");
      }
      setTitle("");
      setReason("");
      setEvidence("");
      setMessage(
        "观察记录已不可变保存；不会自动影响报价、补U或任何资金操作。",
      );
      router.refresh();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "市场背景观察保存失败",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="shadow-market-note-form" onSubmit={submit}>
      <div className="learning-form-heading">
        <div>
          <strong>新增人工市场观察</strong>
          <span>
            只记录背景与证据；不会自动改变报价模型或系统建议。
          </span>
        </div>
        <span className="tag tag-violet">HUMAN INPUT ONLY</span>
      </div>
      <div className="shadow-market-note-grid">
        <label>
          观察日期（UTC+8）
          <input
            required
            type="date"
            value={contextDate}
            onChange={(event) => setContextDate(event.target.value)}
          />
        </label>
        <label>
          分类
          <select
            value={category}
            onChange={(event) =>
              setCategory(
                event.target.value as MarketContextCategory,
              )
            }
          >
            {MARKET_CONTEXT_CATEGORIES.map((value) => (
              <option key={value} value={value}>
                {categoryLabels[value]}
              </option>
            ))}
          </select>
        </label>
        <label>
          严重度
          <select
            value={severity}
            onChange={(event) =>
              setSeverity(
                event.target.value as
                  | "INFO"
                  | "WARNING"
                  | "HIGH",
              )
            }
          >
            <option value="INFO">INFO</option>
            <option value="WARNING">WARNING</option>
            <option value="HIGH">HIGH</option>
          </select>
        </label>
        <label className="shadow-note-wide">
          标题
          <input
            maxLength={200}
            placeholder="简要描述观察事件"
            required
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label className="shadow-note-wide">
          观察原因与判断
          <textarea
            maxLength={2000}
            placeholder="必填：说明事件、判断依据和需要人工关注的原因"
            required
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </label>
        <label className="shadow-note-wide">
          证据引用（可选）
          <input
            maxLength={1000}
            placeholder="内部记录编号、公开来源或数据说明"
            value={evidence}
            onChange={(event) => setEvidence(event.target.value)}
          />
        </label>
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
        保存观察
      </button>
      {message ? <div className="alert alert-info">{message}</div> : null}
    </form>
  );
}
