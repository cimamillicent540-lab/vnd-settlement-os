import type { Metadata } from "next";
import {
  Ban,
  Building2,
  CircleAlert,
  CircleCheck,
  FileSpreadsheet,
  ShieldCheck,
} from "lucide-react";

import {
  PaymentExportTable,
  type ReadyCheck,
} from "@/components/payment-export-table";
import { KpiCard, PageHeading } from "@/components/page-parts";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { getPaymentExecutionData } from "@/lib/server-data";
import { formatVnd } from "@/lib/utils";

export const metadata: Metadata = { title: "付款准备与风险检查" };

function summaryCount(
  rows: Array<Record<string, unknown>>,
  status: string,
) {
  return rows
    .filter((row) => row.check_status === status)
    .reduce((sum, row) => sum + Number(row.order_count ?? 0), 0);
}

export default async function PaymentExportPage() {
  const data = await getPaymentExecutionData();
  const summary = data.summary as Array<Record<string, unknown>>;
  const ready = summaryCount(summary, "READY");
  const warning = summaryCount(summary, "WARNING");
  const blocked = summaryCount(summary, "BLOCKED");
  const readyPrincipal = summary
    .filter((row) => row.check_status === "READY")
    .reduce(
      (sum, row) => sum + Number(row.payout_principal_vnd ?? 0),
      0,
    );

  return (
    <>
      <PageHeading
        title="付款准备与风险检查"
        subtitle="Task 2.6 · 上游批量付款模板接入 · Shadow Mode"
      />
      <div className="alert alert-warning" style={{ marginBottom: 16 }}>
        <ShieldCheck size={16} />
        <div>
          <strong>本模块不执行付款。</strong>
          只检查订单、生成上游格式的付款准备文件并登记审计；
          没有支付接口、自动扣款或自动提交能力。
        </div>
      </div>

      <div className="kpi-grid">
        <KpiCard
          label="READY"
          value={ready.toLocaleString()}
          note={<span>可进入付款准备文件</span>}
          icon={CircleCheck}
          color="#0f9f78"
        />
        <KpiCard
          label="WARNING"
          value={warning.toLocaleString()}
          note={<span>需要人工复核，不允许直接导出</span>}
          icon={CircleAlert}
          color="#dc8b16"
        />
        <KpiCard
          label="BLOCKED"
          value={blocked.toLocaleString()}
          note={<span>付款条件不成立</span>}
          icon={Ban}
          color="#d33d45"
        />
        <KpiCard
          label="READY 到账本金"
          value={formatVnd(readyPrincipal)}
          note={<span>批次导出时再次校验 Settleable</span>}
          icon={FileSpreadsheet}
          color="#155eef"
        />
      </div>

      <div className="grid-2">
        <Card>
          <CardHeader>
            <div>
              <h2 className="panel-title">READY 订单</h2>
              <div className="panel-subtitle">
                仅已通过全部必填、编码、状态和余额检查的订单
              </div>
            </div>
            <Badge variant="green">{ready.toLocaleString()} READY</Badge>
          </CardHeader>
          <PaymentExportTable rows={data.readyChecks as ReadyCheck[]} />
        </Card>

        <div style={{ display: "grid", gap: 16, alignContent: "start" }}>
          <Card>
            <CardHeader>
              <div>
                <h2 className="panel-title">上游模板接入</h2>
                <div className="panel-subtitle">
                  {data.template?.source_file_name ?? "—"}
                </div>
              </div>
              <Badge variant="blue">
                {data.template?.version ?? "—"}
              </Badge>
            </CardHeader>
            <CardContent>
              <div className="metric-list">
                <div className="metric-row">
                  <span className="metric-label">付款字段</span>
                  <span className="metric-value">19</span>
                </div>
                <div className="metric-row">
                  <span className="metric-label">银行/钱包编码</span>
                  <span className="metric-value">
                    {data.bankCount.toLocaleString()}
                  </span>
                </div>
                <div className="metric-row">
                  <span className="metric-label">国家/币种配置</span>
                  <span className="metric-value">
                    {data.countryCount.toLocaleString()}
                  </span>
                </div>
                <div className="metric-row">
                  <span className="metric-label">演示付款数据</span>
                  <span className="metric-value">
                    排除 {data.template?.source_example_rows_excluded ?? 0} 行
                  </span>
                </div>
                <div className="metric-row">
                  <span className="metric-label">主文件内部追踪列</span>
                  <span className="metric-value">0</span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div>
                <h2 className="panel-title">阻断原因 Top 5</h2>
                <div className="panel-subtitle">按最新检查结果统计</div>
              </div>
              <Building2 size={16} />
            </CardHeader>
            <CardContent>
              <div className="metric-list">
                {data.topBlockReasons.length ? (
                  data.topBlockReasons.map((reason) => (
                    <div className="metric-row" key={reason.code}>
                      <span className="metric-label">{reason.code}</span>
                      <span className="metric-value">
                        {reason.count.toLocaleString()}
                      </span>
                    </div>
                  ))
                ) : (
                  <span className="muted">暂无阻断项</span>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div>
            <h2 className="panel-title">最近生成的付款准备文件</h2>
            <div className="panel-subtitle">
              submitted_to_upstream 固定为 false
            </div>
          </div>
          <Badge variant="gray">SHADOW ONLY</Badge>
        </CardHeader>
        {data.exportBatches.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>文件</th>
                  <th>订单数</th>
                  <th className="money">到账本金</th>
                  <th className="money">预计实际扣款</th>
                  <th>状态</th>
                  <th>上游提交</th>
                </tr>
              </thead>
              <tbody>
                {data.exportBatches.map((batch) => (
                  <tr key={batch.id}>
                    <td className="mono">{batch.file_name}</td>
                    <td>{batch.order_count}</td>
                    <td className="money">
                      {formatVnd(batch.total_payout_principal_vnd)}
                    </td>
                    <td className="money">
                      {formatVnd(batch.estimated_gross_debit_vnd)}
                    </td>
                    <td>
                      <Badge variant="blue">{batch.status}</Badge>
                    </td>
                    <td>
                      <Badge variant="gray">
                        {batch.submitted_to_upstream ? "是" : "否"}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">
            <FileSpreadsheet size={26} />
            <strong>尚未生成付款准备文件</strong>
            <span>符合预期：当前真实历史订单均已完成付款。</span>
          </div>
        )}
      </Card>
    </>
  );
}
