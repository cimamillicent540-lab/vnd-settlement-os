"use client";

import { useMemo, useState } from "react";
import { Download, LoaderCircle } from "lucide-react";

import { authorizedFetch } from "@/lib/authorized-fetch";
import { formatVnd } from "@/lib/utils";

export interface ReadyCheck {
  id: string;
  payout_order_id: string;
  payout_principal_vnd: string | number;
  required_gross_debit_vnd: string | number;
  beneficiary_snapshot_masked: Record<string, unknown> | null;
  payout: {
    order_number?: string | null;
    merchant_name?: string | null;
    status?: string | null;
    currency?: string | null;
  } | null;
}

export function PaymentExportTable({
  rows,
}: {
  rows: ReadyCheck[];
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const allSelected = rows.length > 0 && selected.size === rows.length;
  const selectedRows = useMemo(
    () => rows.filter((row) => selected.has(row.payout_order_id)),
    [rows, selected],
  );

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function exportSelected() {
    if (!selectedRows.length) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await authorizedFetch("/api/payment-export", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          payoutOrderIds: selectedRows.map((row) => row.payout_order_id),
        }),
      });
      if (!response.ok) {
        const error = (await response.json()) as { message?: string };
        throw new Error(error.message ?? "付款准备文件生成失败");
      }
      const blob = await response.blob();
      const disposition = response.headers.get("content-disposition") ?? "";
      const fileName =
        disposition.match(/filename="([^"]+)"/)?.[1] ??
        "vnd-payment-preparation.xlsx";
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setSelected(new Set());
      setMessage(
        "付款准备文件已生成并登记审计。文件尚未提交上游，也没有执行付款。",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "导出失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="toolbar">
        <button
          className="button button-primary"
          disabled={busy || selected.size === 0}
          onClick={exportSelected}
          type="button"
        >
          {busy ? (
            <LoaderCircle size={14} className="spin" />
          ) : (
            <Download size={14} />
          )}
          生成付款准备文件（{selected.size}）
        </button>
        <span className="muted">
          仅下载模板文件；不会提交上游或执行资金操作
        </span>
      </div>
      {message ? (
        <div className="alert alert-info" style={{ margin: 14 }}>
          <div>{message}</div>
        </div>
      ) : null}
      {rows.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>
                  <input
                    aria-label="选择全部READY订单"
                    checked={allSelected}
                    onChange={() =>
                      setSelected(
                        allSelected
                          ? new Set()
                          : new Set(rows.map((row) => row.payout_order_id)),
                      )
                    }
                    type="checkbox"
                  />
                </th>
                <th>订单号</th>
                <th>商户</th>
                <th>收款账户</th>
                <th className="money">到账本金</th>
                <th className="money">预计实际扣款</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.payout_order_id}>
                  <td>
                    <input
                      aria-label={`选择订单 ${row.payout?.order_number ?? row.payout_order_id}`}
                      checked={selected.has(row.payout_order_id)}
                      onChange={() => toggle(row.payout_order_id)}
                      type="checkbox"
                    />
                  </td>
                  <td className="mono">
                    {row.payout?.order_number ?? row.payout_order_id}
                  </td>
                  <td>{row.payout?.merchant_name ?? "—"}</td>
                  <td className="mono">
                    {String(
                      row.beneficiary_snapshot_masked
                        ?.beneficiary_account ?? "—",
                    )}
                  </td>
                  <td className="money">
                    {formatVnd(row.payout_principal_vnd)}
                  </td>
                  <td className="money">
                    {formatVnd(row.required_gross_debit_vnd)}
                  </td>
                  <td>
                    <span className="tag tag-green">READY</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty-state">
          <Download size={26} />
          <strong>当前没有可导出的READY订单</strong>
          <span>
            历史订单已完成付款，会被安全阻断；新订单需先补齐收款资料并通过检查。
          </span>
        </div>
      )}
    </>
  );
}
