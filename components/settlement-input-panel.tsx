"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, Save } from "lucide-react";

import { authorizedFetch } from "@/lib/authorized-fetch";

function currentLocalInputTime() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function SettlementInputPanel() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [rateType, setRateType] = useState<
    "P2P_COST_RATE" | "XE_BASE_RATE"
  >("P2P_COST_RATE");
  const [rateValue, setRateValue] = useState("");
  const [source, setSource] = useState("");
  const [recordTime, setRecordTime] = useState(currentLocalInputTime);
  const [adjustment, setAdjustment] = useState("0");
  const [reason, setReason] = useState<
    "market_competition" | "risk_adjustment" | "profit_target"
  >("profit_target");
  const [effectiveTime, setEffectiveTime] = useState(
    currentLocalInputTime,
  );

  async function save(payload: Record<string, unknown>) {
    setBusy(true);
    setMessage("");
    try {
      const response = await authorizedFetch(
        "/api/settlement-intelligence",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const body = (await response.json()) as {
        message?: string;
      };
      if (!response.ok) {
        throw new Error(body.message ?? "保存失败");
      }
      setMessage("已保存为Shadow Mode输入；没有触发任何自动操作。");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }

  async function submitFx(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await save({
      kind: "FX_MARKET_INPUT",
      rateType,
      rateValue,
      source,
      recordTime: new Date(recordTime).toISOString(),
    });
  }

  async function submitAdjustment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await save({
      kind: "QUOTE_ADJUSTMENT",
      baseSource: "XE",
      adjustment,
      reason,
      effectiveTime: new Date(effectiveTime).toISOString(),
    });
  }

  return (
    <div className="settlement-input-grid">
      <form className="settlement-input-card" onSubmit={submitFx}>
        <div>
          <strong>人工汇率输入</strong>
          <span>市场观察值，不覆盖历史库存成本</span>
        </div>
        <label>
          汇率类型
          <select
            value={rateType}
            onChange={(event) =>
              setRateType(
                event.target.value as
                  | "P2P_COST_RATE"
                  | "XE_BASE_RATE",
              )
            }
          >
            <option value="P2P_COST_RATE">P2P Cost Rate</option>
            <option value="XE_BASE_RATE">XE Base Rate</option>
          </select>
        </label>
        <label>
          VND / USDT
          <input
            inputMode="decimal"
            required
            value={rateValue}
            onChange={(event) => setRateValue(event.target.value)}
          />
        </label>
        <label>
          来源
          <input
            required
            value={source}
            onChange={(event) => setSource(event.target.value)}
            placeholder="例如 Binance P2P / XE"
          />
        </label>
        <label>
          记录时间
          <input
            type="datetime-local"
            required
            value={recordTime}
            onChange={(event) => setRecordTime(event.target.value)}
          />
        </label>
        <button className="button button-primary" disabled={busy}>
          {busy ? <RefreshCw className="spin" size={14} /> : <Save size={14} />}
          保存人工汇率
        </button>
      </form>

      <form className="settlement-input-card" onSubmit={submitAdjustment}>
        <div>
          <strong>XE报价调整规则</strong>
          <span>只生成建议，不修改真实商户报价</span>
        </div>
        <label>
          Company Adjustment
          <input
            inputMode="decimal"
            required
            value={adjustment}
            onChange={(event) => setAdjustment(event.target.value)}
          />
        </label>
        <label>
          原因
          <select
            value={reason}
            onChange={(event) =>
              setReason(
                event.target.value as
                  | "market_competition"
                  | "risk_adjustment"
                  | "profit_target",
              )
            }
          >
            <option value="profit_target">profit_target</option>
            <option value="risk_adjustment">risk_adjustment</option>
            <option value="market_competition">
              market_competition
            </option>
          </select>
        </label>
        <label>
          生效时间
          <input
            type="datetime-local"
            required
            value={effectiveTime}
            onChange={(event) => setEffectiveTime(event.target.value)}
          />
        </label>
        <button className="button button-primary" disabled={busy}>
          {busy ? <RefreshCw className="spin" size={14} /> : <Save size={14} />}
          保存Shadow规则
        </button>
      </form>
      {message ? <div className="alert alert-info">{message}</div> : null}
    </div>
  );
}
