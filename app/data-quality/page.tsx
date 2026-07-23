import type { Metadata } from "next";
import { CheckCircle2, ShieldAlert } from "lucide-react";

import { PageHeading } from "@/components/page-parts";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { getQualitySnapshot } from "@/lib/server-data";

export const metadata: Metadata = { title: "数据质量与审计" };

export default async function DataQualityPage() {
  const quality = await getQualitySnapshot();
  const checks = [
    { name: "VND Payin 手续费差异", count: quality.feeMismatch },
    { name: "账户行余额差异", count: quality.balanceMismatch },
    { name: "相邻余额不连续", count: quality.continuityMismatch },
    { name: "未配对内部结算", count: quality.unmatchedTransfers },
    {
      name: "Payout 无精确标识符匹配",
      count: quality.payoutUnmatched,
      expected: true,
    },
    {
      name: "退款缺少可反转 Payout 分摊链接",
      count: quality.refundAllocationPending,
      expected: true,
    },
    {
      name: "Net Settlement 对手腿方向待确认",
      count: quality.settlementCounterLegPending,
      expected: true,
    },
  ];

  return (
    <>
      <PageHeading
        title="数据质量与审计"
        subtitle="Task 2.5 真实导入、精确标识符匹配与 Shadow 利润状态"
      />
      <div className="quality-grid">
        {checks.map((item) => {
          const warning = item.count > 0;
          return (
            <div className="quality-card" key={item.name}>
              <span
                className="quality-score"
                style={{
                  color: warning ? "#b82f3a" : "#087f5b",
                  background: warning ? "#fff0f1" : "#ecf9f4",
                }}
              >
                {item.count}
              </span>
              <div>
                <div className="quality-title">{item.name}</div>
                <div className="quality-note">
                  {warning
                    ? item.expected
                      ? "已保守降级，等待真实证据"
                      : "需要人工复核"
                    : "校验通过"}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid-2">
        <Card>
          <CardHeader>
            <div>
              <h2 className="panel-title">新 Account History 批次</h2>
              <div className="panel-subtitle">
                {quality.validation?.source_file_name ?? "—"}
              </div>
            </div>
            <Badge variant="green">SHA-256 DEDUPED</Badge>
          </CardHeader>
          <CardContent>
            <div className="metric-list">
              <div className="metric-row">
                <span className="metric-label">源文件行数</span>
                <span className="metric-value">
                  {Number(
                    quality.validation?.total_source_rows ?? 0,
                  ).toLocaleString()}
                </span>
              </div>
              <div className="metric-row">
                <span className="metric-label">导入 VND 行</span>
                <span className="metric-value">
                  {Number(
                    quality.validation?.imported_rows ?? 0,
                  ).toLocaleString()}
                </span>
              </div>
              <div className="metric-row">
                <span className="metric-label">非 VND 排除行</span>
                <span className="metric-value">
                  {Number(
                    quality.validation?.excluded_non_vnd_rows ?? 0,
                  ).toLocaleString()}
                </span>
              </div>
              <div className="metric-row">
                <span className="metric-label">重复行</span>
                <span className="metric-value">
                  {Number(
                    quality.validation?.duplicate_rows ?? 0,
                  ).toLocaleString()}
                </span>
              </div>
              <div className="metric-row">
                <span className="metric-label">退款匹配 / 未匹配</span>
                <span className="metric-value">
                  {Number(
                    quality.validation?.refund_matched_rows ?? 0,
                  ).toLocaleString()}{" "}
                  /{" "}
                  {Number(
                    quality.validation?.refund_unmatched_rows ?? 0,
                  ).toLocaleString()}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <h2 className="panel-title">利润验证状态</h2>
              <div className="panel-subtitle">
                金额/时间候选不升级为 VERIFIED
              </div>
            </div>
            <Badge variant="amber">SHADOW MODE</Badge>
          </CardHeader>
          <CardContent>
            <div className="metric-list">
              <div className="metric-row">
                <span className="metric-label">VERIFIED</span>
                <span className="metric-value">
                  {quality.verified.toLocaleString()}
                </span>
              </div>
              <div className="metric-row">
                <span className="metric-label">PARTIAL</span>
                <span className="metric-value">
                  {quality.partial.toLocaleString()}
                </span>
              </div>
              <div className="metric-row">
                <span className="metric-label">ESTIMATED</span>
                <span className="metric-value">
                  {quality.estimated.toLocaleString()}
                </span>
              </div>
              <div className="metric-row">
                <span className="metric-label">精确匹配 Payout</span>
                <span className="metric-value">
                  {Number(
                    quality.validation?.payout_exact_match_rows ?? 0,
                  ).toLocaleString()}
                </span>
              </div>
              <div className="metric-row">
                <span className="metric-label">未匹配执行流水</span>
                <span className="metric-value">
                  {Number(
                    quality.validation?.payout_unmatched_rows ?? 0,
                  ).toLocaleString()}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card style={{ marginTop: 16 }}>
        <CardHeader>
          <div>
            <h2 className="panel-title">审计状态</h2>
            <div className="panel-subtitle">
              原始流水、标识符证据和验证记录不可变
            </div>
          </div>
          <Badge variant="green">已启用</Badge>
        </CardHeader>
        <CardContent>
          <div className="alert alert-info">
            <CheckCircle2 size={16} />
            <div>
              <strong>{quality.auditCount.toLocaleString()} 条审计日志</strong>
              Task 2.5 导入批次、三笔 Net Settlement 和新 Shadow Run
              均记录审计证据。
            </div>
          </div>
          <div className="alert alert-warning" style={{ marginTop: 12 }}>
            <ShieldAlert size={16} />
            <div>
              <strong>保守状态边界</strong>
              {Number(
                quality.validation?.refund_matched_rows ?? 0,
              ).toLocaleString()}{" "}
              笔退款已在 Account History 层净零，但因没有精确 Payout
              标识符链接，不猜测反转版本化资金分摊；USDT 对手腿确认前 Net
              Settlement 已实现利润影响保持 0。
            </div>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
