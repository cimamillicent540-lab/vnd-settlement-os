"use client";

import { useMemo, useState } from "react";
import Decimal from "decimal.js";
import {
  Calculator,
  CircleDollarSign,
  Save,
  ShieldAlert,
  SlidersHorizontal,
} from "lucide-react";

import { KpiCard, PageHeading } from "@/components/page-parts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { authorizedFetch } from "@/lib/authorized-fetch";
import { calculateShadowQuote } from "@/lib/domain";
import { formatRate, formatUsdt, formatVnd } from "@/lib/utils";

type Initial = {
  sources: Array<{
    id: string;
    source_type: string;
    settleable_available_amount_vnd: number | string;
    funding_rate_vnd_per_usdt: number | string | null;
    allocationRatio: number;
  }>;
  merchants: string[];
  channels: string[];
  replacementRate: {
    rate_vnd_per_usdt: number | string;
    rate_date: string;
    time_precision: string;
    confidence: string;
  } | null;
  dataCompletenessStatus: string;
};

export function ShadowPricingClient({ initial }: { initial: Initial }) {
  const [totalDebit, setTotalDebit] = useState("1005");
  const [approvedMerchantFeeRate, setApprovedMerchantFeeRate] =
    useState("0.005");
  const [currentAs, setCurrentAs] = useState("25825.50");
  const [fee, setFee] = useState("100000");
  const [replacement, setReplacement] = useState(
    String(initial.replacementRate?.rate_vnd_per_usdt ?? "26628"),
  );
  const [merchant, setMerchant] = useState(initial.merchants[0] ?? "");
  const [channel, setChannel] = useState(initial.channels[0] ?? "");
  const [message, setMessage] = useState("");
  const economicCostPerVnd = useMemo(
    () =>
      initial.sources
        .reduce((sum, source) => {
          const rate =
            source.source_type === "TOPUP" &&
            source.funding_rate_vnd_per_usdt
              ? new Decimal(source.funding_rate_vnd_per_usdt)
              : new Decimal(replacement || 1);
          return sum.plus(new Decimal(source.allocationRatio).div(rate));
        }, new Decimal(0))
        .toFixed(18),
    [initial.sources, replacement],
  );
  const quoteInput = useMemo(
    () => ({
      receivedUsdt: totalDebit || "1",
      merchantAmountBasis: "TOTAL_DEBIT" as const,
      approvedMerchantFeeRate: approvedMerchantFeeRate || "0",
      economicCostPerVnd,
      fixedPayoutFeeVnd: fee || "0",
      currentAsRate: currentAs || undefined,
    }),
    [
      totalDebit,
      approvedMerchantFeeRate,
      economicCostPerVnd,
      fee,
      currentAs,
    ],
  );
  const min = useMemo(
    () => calculateShadowQuote({ ...quoteInput, targetMargin: "0.002" }),
    [quoteInput],
  );
  const target = useMemo(
    () => calculateShadowQuote({ ...quoteInput, targetMargin: "0.005" }),
    [quoteInput],
  );

  async function save() {
    setMessage("保存中…");
    try {
      const response = await authorizedFetch("/api/shadow-pricing", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          receivedUsdt: totalDebit,
          merchantAmountBasis: "TOTAL_DEBIT",
          approvedMerchantFeeRate,
          merchant,
          channel,
          currentAsRate: currentAs,
          estimatedPayoutFeeVnd: fee,
          economicCostPerVnd,
          replacementRate: replacement,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message);
      setMessage(
        `Shadow Run v${body.run.run_version} 已保存，不触发任何资金操作。`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存失败");
    }
  }

  return (
    <>
      <PageHeading
        title="VND 影子报价"
        subtitle="先从商户总扣款反解本金，再按本金应用已审批商户费率"
        actions={
          <Button onClick={save}>
            <Save size={14} />
            保存为 Shadow Run
          </Button>
        }
      />
      <div className="alert alert-warning" style={{ marginBottom: 16 }}>
        <ShieldAlert size={16} />
        <div>
          <strong>{initial.dataCompletenessStatus}</strong>
          Account History 截止早于 Payout 与补U数据；结果为影子估算，不修改真实商户报价，不执行付款或补U。
        </div>
      </div>
      <div className="alert alert-info" style={{ marginBottom: 16 }}>
        <CircleDollarSign size={16} />
        <div>
          <strong>收入公式：</strong>
          商户手续费收入 + 有符号 DCC 收入 = 公司总收入。正 DCC
          增加收入，负 DCC 表示优惠或公司承担成本。
        </div>
      </div>
      <div className="grid-2">
        <Card>
          <CardHeader>
            <div>
              <h2 className="panel-title">报价输入</h2>
              <div className="panel-subtitle">
                商户费率分母为本金；汇率方向为 VND_PER_USDT
              </div>
            </div>
            <SlidersHorizontal size={16} />
          </CardHeader>
          <CardContent>
            <div className="pricing-form-grid">
              <label>
                商户总扣款 USDT
                <input
                  value={totalDebit}
                  onChange={(event) => setTotalDebit(event.target.value)}
                  inputMode="decimal"
                />
              </label>
              <label>
                已审批商户费率
                <input
                  value={approvedMerchantFeeRate}
                  onChange={(event) =>
                    setApprovedMerchantFeeRate(event.target.value)
                  }
                  inputMode="decimal"
                />
              </label>
              <label>
                当前人工 AS
                <input
                  value={currentAs}
                  onChange={(event) => setCurrentAs(event.target.value)}
                  inputMode="decimal"
                />
              </label>
              <label>
                预计 Payout 手续费 VND
                <input
                  value={fee}
                  onChange={(event) => setFee(event.target.value)}
                  inputMode="decimal"
                />
              </label>
              <label>
                替代汇率 VND/USDT
                <input
                  value={replacement}
                  onChange={(event) => setReplacement(event.target.value)}
                  inputMode="decimal"
                />
              </label>
              <label>
                商户
                <select
                  value={merchant}
                  onChange={(event) => setMerchant(event.target.value)}
                >
                  {initial.merchants.map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
              </label>
              <label>
                通道
                <select
                  value={channel}
                  onChange={(event) => setChannel(event.target.value)}
                >
                  {initial.channels.map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
              </label>
            </div>
            {message && (
              <div className="alert alert-info" style={{ marginTop: 14 }}>
                {message}
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <div>
              <h2 className="panel-title">付款前资金来源</h2>
              <div className="panel-subtitle">
                按 available_settleable_balance_vnd 占比
              </div>
            </div>
            <Badge variant="violet">{initial.sources.length} 个桶</Badge>
          </CardHeader>
          <CardContent>
            <div className="metric-list">
              {initial.sources.map((source) => (
                <div className="metric-row" key={source.id}>
                  <span className="metric-label">{source.source_type}</span>
                  <span className="metric-value">
                    {(source.allocationRatio * 100).toFixed(2)}% ·{" "}
                    {formatVnd(source.settleable_available_amount_vnd)}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
      <div className="kpi-grid">
        <KpiCard
          label="反解商户本金"
          value={formatUsdt(min.merchantPrincipalUsdt, 4)}
          note={
            <span>
              预计手续费 {formatUsdt(min.estimatedMerchantFeeUsdt, 4)}
            </span>
          }
          icon={Calculator}
        />
        <KpiCard
          label="千2保护报价"
          value={formatRate(min.recommendedAsRateVndPerUsdt)}
          note={<span>最低经济利润率 0.2%</span>}
          icon={Calculator}
          color="#dc8b16"
        />
        <KpiCard
          label="千5目标报价"
          value={formatRate(target.recommendedAsRateVndPerUsdt)}
          note={<span>目标经济利润率 0.5%</span>}
          icon={Calculator}
          color="#0f9f78"
        />
        <KpiCard
          label="当前预计经济利润率"
          value={`${(Number(min.currentEconomicMargin ?? 0) * 100).toFixed(
            3,
          )}%`}
          note={<span>ESTIMATED · 非已实现净利润</span>}
          icon={Calculator}
          color="#6f4bb7"
        />
      </div>
      <Card>
        <CardHeader>
          <div>
            <h2 className="panel-title">报价差异</h2>
            <div className="panel-subtitle">
              手续费按本金估算；TOPUP 汇率精度为 DATE_ONLY
            </div>
          </div>
          <Badge variant="amber">LOW CONFIDENCE</Badge>
        </CardHeader>
        <CardContent>
          <div className="metric-list">
            <div className="metric-row">
              <span className="metric-label">千2最大商户本金</span>
              <span className="metric-value">
                {formatVnd(min.maxMerchantPrincipalVnd)}
              </span>
            </div>
            <div className="metric-row">
              <span className="metric-label">千5最大商户本金</span>
              <span className="metric-value">
                {formatVnd(target.maxMerchantPrincipalVnd)}
              </span>
            </div>
            <div className="metric-row">
              <span className="metric-label">当前报价是否低于千2</span>
              <Badge
                variant={
                  Number(min.currentEconomicMargin) >= 0.002 ? "green" : "red"
                }
              >
                {Number(min.currentEconomicMargin) >= 0.002 ? "否" : "是"}
              </Badge>
            </div>
            <div className="metric-row">
              <span className="metric-label">当前报价是否达到千5</span>
              <Badge
                variant={
                  Number(min.currentEconomicMargin) >= 0.005
                    ? "green"
                    : "amber"
                }
              >
                {Number(min.currentEconomicMargin) >= 0.005 ? "是" : "否"}
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
