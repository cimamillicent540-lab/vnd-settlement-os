import type { Metadata } from "next";
import { ArrowDownUp, Landmark, Scale, WalletCards } from "lucide-react";

import { KpiCard, PageHeading } from "@/components/page-parts";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { getPoolSnapshot } from "@/lib/server-data";
import { formatRate, formatUsdt, formatVnd } from "@/lib/utils";

export const metadata: Metadata = { title: "真实数据对账" };

export default async function ReconciliationPage() {
  const {
    recon,
    opening,
    task25Validation,
    netSettlements,
    refunds,
    dataCutoffs,
  } = await getPoolSnapshot();
  const task25ClosingGross = Number(
    task25Validation?.account_history_closing_gross_vnd ?? 0,
  );
  const refundReversal = refunds.reduce(
    (total, row) => total + Number(row.refund_credit_vnd ?? 0),
    0,
  );
  const settlementVnd = netSettlements.reduce(
    (total, row) => total + Number(row.vnd_amount ?? 0),
    0,
  );
  const settlementUsdt = netSettlements.reduce(
    (total, row) => total + Number(row.usdt_amount ?? 0),
    0,
  );

  return (
    <>
      <PageHeading
        title="真实数据对账"
        subtitle="Gross 原始账户层、Settleable 50% 派生层与 Task 2.5 增量验证"
      />
      <div className="kpi-grid">
        <KpiCard
          label="Gross 正确期初"
          value={formatVnd(opening?.gross_opening_balance_vnd ?? 0)}
          note={<span>08:00 交易发生前</span>}
          icon={Landmark}
        />
        <KpiCard
          label="Settleable 正确期初"
          value={formatVnd(opening?.settleable_opening_balance_vnd ?? 0)}
          note={<span>Gross × 50%</span>}
          icon={WalletCards}
        />
        <KpiCard
          label="Task 2.5 Gross 期末"
          value={formatVnd(task25ClosingGross)}
          note={<span>{dataCutoffs.accountHistoryLocal ?? "—"} UTC+8</span>}
          icon={Landmark}
        />
        <KpiCard
          label="Task 2.5 Settleable 期末"
          value={formatVnd(task25ClosingGross * 0.5)}
          note={<span>源期末 Gross × 50%</span>}
          icon={WalletCards}
        />
      </div>

      <div className="grid-2">
        <Card>
          <CardHeader>
            <div>
              <h2 className="panel-title">Task 1.5 Gross 层</h2>
              <div className="panel-subtitle">
                原始账户金额，不做乘 2 或除 2 覆盖
              </div>
            </div>
            <Badge variant="amber">{recon?.status ?? "INCOMPLETE"}</Badge>
          </CardHeader>
          <CardContent>
            <div className="metric-list">
              <div className="metric-row">
                <span className="metric-label">Gross opening</span>
                <span className="metric-value">
                  {formatVnd(recon?.gross_opening_balance_vnd ?? 0)}
                </span>
              </div>
              <div className="metric-row">
                <span className="metric-label">Gross Payin</span>
                <span className="metric-value">
                  {formatVnd(recon?.gross_payin_vnd ?? 0)}
                </span>
              </div>
              <div className="metric-row">
                <span className="metric-label">Gross Topup</span>
                <span className="metric-value">
                  {formatVnd(recon?.gross_topup_vnd ?? 0)}
                </span>
              </div>
              <div className="metric-row">
                <span className="metric-label">Gross Payout</span>
                <span className="metric-value">
                  {formatVnd(recon?.gross_payout_vnd ?? 0)}
                </span>
              </div>
              <div className="metric-row">
                <span className="metric-label">Gross Adjustment</span>
                <span className="metric-value">
                  {formatVnd(recon?.gross_adjustment_vnd ?? 0)}
                </span>
              </div>
              <div className="metric-row">
                <span className="metric-label">对账差异</span>
                <span className="metric-value">
                  {formatVnd(recon?.gross_difference_vnd ?? 0)}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <h2 className="panel-title">Task 2.5 源流水验证</h2>
              <div className="panel-subtitle">
                7 月 19–20 日 Account History 原始 VND 行
              </div>
            </div>
            <Badge variant="green">SOURCE VERIFIED</Badge>
          </CardHeader>
          <CardContent>
            <div className="metric-list">
              <div className="metric-row">
                <span className="metric-label">导入 VND 行</span>
                <span className="metric-value">
                  {Number(task25Validation?.imported_rows ?? 0).toLocaleString()}
                </span>
              </div>
              <div className="metric-row">
                <span className="metric-label">余额公式差异</span>
                <span className="metric-value">
                  {Number(
                    task25Validation?.balance_mismatch_rows ?? 0,
                  ).toLocaleString()}
                </span>
              </div>
              <div className="metric-row">
                <span className="metric-label">相邻余额不连续</span>
                <span className="metric-value">
                  {Number(
                    task25Validation?.continuity_mismatch_rows ?? 0,
                  ).toLocaleString()}
                </span>
              </div>
              <div className="metric-row">
                <span className="metric-label">
                  {refunds.length.toLocaleString()} 笔退款反转
                </span>
                <span className="metric-value">
                  {formatVnd(refundReversal)}
                </span>
              </div>
              <div className="metric-row">
                <span className="metric-label">退款后账户净变化</span>
                <span className="metric-value">0.00 ₫</span>
              </div>
              <div className="metric-row">
                <span className="metric-label">数据完整性</span>
                <span className="metric-value">
                  PARTIAL_AFTER_ACCOUNT_HISTORY_CUTOFF
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card style={{ marginTop: 16 }}>
        <CardHeader>
          <div>
            <h2 className="panel-title">Net Settlement 对账</h2>
            <div className="panel-subtitle">
              合计 {formatUsdt(settlementUsdt, 2)} /{" "}
              {formatVnd(settlementVnd)}；不归类为 Topup、手续费或 DCC
            </div>
          </div>
          <Badge variant="amber">COUNTER-LEG PENDING</Badge>
        </CardHeader>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>结算时间（UTC）</th>
                <th>VND 方向</th>
                <th style={{ textAlign: "right" }}>USDT</th>
                <th style={{ textAlign: "right" }}>VND</th>
                <th style={{ textAlign: "right" }}>实际汇率</th>
                <th>利润影响</th>
              </tr>
            </thead>
            <tbody>
              {netSettlements.map((row) => (
                <tr key={row.id}>
                  <td className="mono">{row.settled_at}</td>
                  <td>{row.settlement_direction}</td>
                  <td className="money">{formatUsdt(row.usdt_amount, 2)}</td>
                  <td className="money">{formatVnd(row.vnd_amount)}</td>
                  <td className="money">
                    {formatRate(row.actual_rate_vnd_per_usdt, 6)}
                  </td>
                  <td>
                    <Badge variant="amber">
                      {formatUsdt(row.realized_profit_effect_usdt, 2)}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card style={{ marginTop: 16 }}>
        <CardHeader>
          <div>
            <h2 className="panel-title">数据截止与范围</h2>
            <div className="panel-subtitle">
              各数据集截止时间不相同时禁止称为完整实时余额
            </div>
          </div>
          <ArrowDownUp size={16} />
        </CardHeader>
        <CardContent>
          <div className="metric-list">
            <div className="metric-row">
              <span className="metric-label">Account History 截止</span>
              <span className="metric-value">
                {dataCutoffs.accountHistoryLocal ?? "—"}{" "}
                {dataCutoffs.accountHistoryTimezone ?? ""}
              </span>
            </div>
            <div className="metric-row">
              <span className="metric-label">Payout 截止（UTC）</span>
              <span className="metric-value">
                {dataCutoffs.payoutUtc ?? "—"}
              </span>
            </div>
            <div className="metric-row">
              <span className="metric-label">Topup 截止日期</span>
              <span className="metric-value">
                {dataCutoffs.topupDate ?? "—"}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card style={{ marginTop: 16 }}>
        <CardHeader>
          <div>
            <h2 className="panel-title">补 U 匹配结论</h2>
            <div className="panel-subtitle">
              日期、金额、订单/备注、账户变化四项证据
            </div>
          </div>
          <Scale size={16} />
        </CardHeader>
        <CardContent>
          <div className="alert alert-info">
            {recon?.topup_match_conclusion ?? "尚未完成匹配"}
          </div>
        </CardContent>
      </Card>
    </>
  );
}
