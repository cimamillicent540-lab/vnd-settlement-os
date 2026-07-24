import { NextResponse } from "next/server";
import Decimal from "decimal.js";
import { z } from "zod";

import { authorizeInternalRequest } from "@/lib/api-auth";
import {
  assessPaymentReadiness,
  validateBatchSettleableCapacity,
  type PaymentBeneficiary,
} from "@/lib/payment-execution";
import { buildPaymentTemplateWorkbook } from "@/lib/payment-template-workbook";

export const runtime = "nodejs";

const payloadSchema = z.object({
  payoutOrderIds: z
    .array(z.string().uuid())
    .min(1)
    .max(500)
    .refine((values) => new Set(values).size === values.length, {
      message: "订单ID不能重复",
    }),
});

function asBeneficiary(row: Record<string, unknown>): PaymentBeneficiary {
  return {
    transactionType: String(row.transaction_type ?? ""),
    beneficiaryName: row.beneficiary_name
      ? String(row.beneficiary_name)
      : null,
    beneficiaryAccount: row.beneficiary_account
      ? String(row.beneficiary_account)
      : null,
    accountType: row.account_type ? String(row.account_type) : null,
    bankCode: row.bank_code ? String(row.bank_code) : null,
    countryCode: row.country_code ? String(row.country_code) : null,
    iban: row.iban ? String(row.iban) : null,
    region: row.region ? String(row.region) : null,
    provinceState: row.province_state
      ? String(row.province_state)
      : null,
    branchName: row.branch_name ? String(row.branch_name) : null,
    branchCode: row.branch_code ? String(row.branch_code) : null,
    idType: row.id_type ? String(row.id_type) : null,
    idNumber: row.id_number ? String(row.id_number) : null,
    phone: row.phone ? String(row.phone) : null,
    email: row.email ? String(row.email) : null,
    bankName: row.bank_name ? String(row.bank_name) : null,
    remark: row.remark ? String(row.remark) : null,
  };
}

export async function POST(request: Request) {
  const auth = await authorizeInternalRequest(request, [
    "admin",
    "settlement_operator",
  ]);
  if (!auth) {
    return NextResponse.json(
      { message: "需要结算操作员或管理员权限" },
      { status: 403 },
    );
  }
  const parsed = payloadSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { message: "导出订单校验失败", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const payoutIds = parsed.data.payoutOrderIds;

  const [
    { data: payouts, error: payoutError },
    { data: beneficiaries, error: beneficiaryError },
    { data: checks, error: checkError },
    { data: exported, error: exportedError },
    { data: bankRows, error: bankError },
    { data: countryRows, error: countryError },
    { data: poolRows, error: poolError },
    { data: template, error: templateError },
  ] = await Promise.all([
    auth.db
      .from("payout_orders")
      .select("id,status,currency,payout_amount_vnd")
      .in("id", payoutIds),
    auth.db
      .from("payout_beneficiaries")
      .select(
        "payout_order_id,transaction_type,beneficiary_name,beneficiary_account,account_type,bank_code,country_code,iban,region,province_state,branch_name,branch_code,id_type,id_number,phone,email,bank_name,remark",
      )
      .in("payout_order_id", payoutIds),
    auth.db
      .from("payment_readiness_latest")
      .select(
        "id,payout_order_id,check_status,payout_principal_vnd,required_gross_debit_vnd",
      )
      .in("payout_order_id", payoutIds),
    auth.db
      .from("payment_export_items")
      .select("payout_order_id")
      .in("payout_order_id", payoutIds),
    auth.db
      .from("bank_reference")
      .select(
        "country_name,country_code,bank_code,bank_name_en,bank_name_local,status",
      )
      .in("status", ["ACTIVE", "REVIEW_REQUIRED"])
      .order("source_row_number"),
    auth.db
      .from("country_currency_reference")
      .select("country_code,country_name,currency")
      .eq("status", "ACTIVE")
      .order("source_row_number"),
    auth.db
      .from("pool_buckets")
      .select("settleable_available_amount_vnd")
      .eq("currency", "VND")
      .eq("status", "OPEN"),
    auth.db
      .from("payment_template_versions")
      .select("id")
      .eq("template_code", "LOCAL_BATCH_PAYMENT")
      .eq("version", "LOCAL_BATCH_PAYMENT_V1")
      .single(),
  ]);
  const loadError =
    payoutError ??
    beneficiaryError ??
    checkError ??
    exportedError ??
    bankError ??
    countryError ??
    poolError ??
    templateError;
  if (loadError || !template) {
    return NextResponse.json(
      { message: loadError?.message ?? "模板版本不存在" },
      { status: 500 },
    );
  }
  if ((payouts ?? []).length !== payoutIds.length) {
    return NextResponse.json(
      { message: "部分Payout订单不存在或不可读取" },
      { status: 400 },
    );
  }
  if ((beneficiaries ?? []).length !== payoutIds.length) {
    return NextResponse.json(
      { message: "部分订单缺少受限收款资料，不能导出" },
      { status: 400 },
    );
  }
  if ((checks ?? []).length !== payoutIds.length) {
    return NextResponse.json(
      { message: "部分订单缺少最新付款前检查" },
      { status: 400 },
    );
  }
  if ((exported ?? []).length) {
    return NextResponse.json(
      { message: "部分订单已生成过付款文件，禁止重复导出" },
      { status: 409 },
    );
  }

  const beneficiaryByPayout = new Map(
    (beneficiaries ?? []).map((row) => [
      String(row.payout_order_id),
      asBeneficiary(row as Record<string, unknown>),
    ]),
  );
  const checkByPayout = new Map(
    (checks ?? []).map((row) => [String(row.payout_order_id), row]),
  );
  const validBankCodes = new Set(
    (bankRows ?? [])
      .filter(
        (row) =>
          row.status === "ACTIVE" && row.country_code && row.bank_code,
      )
      .map(
        (row) =>
          `${String(row.country_code).toUpperCase()}\u001f${String(row.bank_code).toUpperCase()}`,
      ),
  );
  const availableSettleableBalanceVnd = (poolRows ?? [])
    .reduce(
      (sum, row) =>
        sum.plus(String(row.settleable_available_amount_vnd ?? 0)),
      new Decimal(0),
    )
    .toFixed(2);

  const workbookRows = [];
  const exportItems = [];
  for (const [index, payout] of (payouts ?? []).entries()) {
    const payoutId = String(payout.id);
    const beneficiary = beneficiaryByPayout.get(payoutId);
    const check = checkByPayout.get(payoutId);
    if (!beneficiary || !check || check.check_status !== "READY") {
      return NextResponse.json(
        { message: `订单 ${payoutId} 未达到READY状态` },
        { status: 409 },
      );
    }
    const currentReadiness = assessPaymentReadiness({
      payoutStatus: String(payout.status),
      currency: String(payout.currency),
      payoutAmountVnd: String(payout.payout_amount_vnd),
      upstreamFeeRate: "0.005",
      availableSettleableBalanceVnd,
      beneficiary,
      validBankCodes,
      alreadyExported: false,
    });
    if (currentReadiness.status !== "READY") {
      return NextResponse.json(
        {
          message: `订单 ${payoutId} 的实时付款前检查未通过`,
          readiness: currentReadiness,
        },
        { status: 409 },
      );
    }
    workbookRows.push({
      payoutId,
      currency: String(payout.currency),
      payoutAmount: String(payout.payout_amount_vnd),
      beneficiary,
    });
    exportItems.push({
      payout_order_id: payoutId,
      readiness_check_id: String(check.id),
      export_row_number: index + 3,
      payout_principal_vnd: String(payout.payout_amount_vnd),
      beneficiary_account_last4:
        beneficiary.beneficiaryAccount?.slice(-4) ?? null,
    });
  }

  const batchCapacity = validateBatchSettleableCapacity({
    rows: workbookRows.map((row) => ({
      payoutAmountVnd: String(row.payoutAmount),
      upstreamFeeRate: "0.005",
    })),
    availableSettleableBalanceVnd,
  });
  if (!batchCapacity.isSufficient) {
    return NextResponse.json(
      { message: "批次可结算余额不足", batchCapacity },
      { status: 409 },
    );
  }

  const workbook = buildPaymentTemplateWorkbook({
    rows: workbookRows,
    banks: (bankRows ?? []).map((row) => ({
      countryName: String(row.country_name),
      countryCode: String(row.country_code),
      bankCode: String(row.bank_code),
      bankNameEn: String(row.bank_name_en),
      bankNameLocal: row.bank_name_local
        ? String(row.bank_name_local)
        : null,
    })),
    countries: (countryRows ?? []).map((row) => ({
      countryCode: String(row.country_code),
      countryName: String(row.country_name),
      currency: String(row.currency),
    })),
  });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const fileName = `vnd-payment-preparation-${timestamp}.xlsx`;
  const { data: batchId, error: registerError } = await auth.db.rpc(
    "register_payment_export",
    {
      requested_template_version_id: template.id,
      requested_file_name: fileName,
      requested_file_hash: workbook.sha256,
      requested_settleable_balance_vnd:
        availableSettleableBalanceVnd,
      requested_items: exportItems,
    },
  );
  if (registerError) {
    return NextResponse.json(
      { message: registerError.message },
      { status: 409 },
    );
  }

  return new Response(new Uint8Array(workbook.bytes), {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "no-store",
      "X-Export-Batch-Id": String(batchId),
      "X-Shadow-Mode": "true",
      "X-Automatic-Payment": "false",
    },
  });
}
