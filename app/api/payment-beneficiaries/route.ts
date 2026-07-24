import { NextResponse } from "next/server";
import { z } from "zod";

import { authorizeInternalRequest } from "@/lib/api-auth";
import {
  assessPaymentReadiness,
  maskSensitive,
  type PaymentBeneficiary,
} from "@/lib/payment-execution";

const optionalText = z.string().trim().max(250).nullable().optional();
const payloadSchema = z.object({
  payoutOrderId: z.string().uuid(),
  transactionType: z.enum(["B2C", "B2B"]).default("B2C"),
  beneficiaryName: optionalText,
  beneficiaryAccount: optionalText,
  accountType: optionalText,
  bankCode: optionalText,
  countryCode: optionalText,
  iban: optionalText,
  region: optionalText,
  provinceState: optionalText,
  branchName: optionalText,
  branchCode: optionalText,
  idType: optionalText,
  idNumber: optionalText,
  phone: optionalText,
  email: z.string().trim().email().max(250).nullable().optional(),
  bankName: optionalText,
  remark: z.string().trim().max(30).nullable().optional(),
});

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
      { message: "收款资料校验失败", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const input = parsed.data;
  const { data: payout, error: payoutError } = await auth.db
    .from("payout_orders")
    .select("id,status,currency,payout_amount_vnd")
    .eq("id", input.payoutOrderId)
    .single();
  if (payoutError || !payout) {
    return NextResponse.json({ message: "Payout订单不存在" }, { status: 404 });
  }

  const beneficiary: PaymentBeneficiary = {
    transactionType: input.transactionType,
    beneficiaryName: input.beneficiaryName ?? null,
    beneficiaryAccount: input.beneficiaryAccount ?? null,
    accountType: input.accountType ?? null,
    bankCode: input.bankCode ?? null,
    countryCode: input.countryCode ?? null,
    iban: input.iban ?? null,
    region: input.region ?? null,
    provinceState: input.provinceState ?? null,
    branchName: input.branchName ?? null,
    branchCode: input.branchCode ?? null,
    idType: input.idType ?? null,
    idNumber: input.idNumber ?? null,
    phone: input.phone ?? null,
    email: input.email ?? null,
    bankName: input.bankName ?? null,
    remark: input.remark ?? null,
  };
  const { error: beneficiaryError } = await auth.db
    .from("payout_beneficiaries")
    .upsert(
      {
        payout_order_id: input.payoutOrderId,
        transaction_type: beneficiary.transactionType,
        beneficiary_name: beneficiary.beneficiaryName,
        beneficiary_account: beneficiary.beneficiaryAccount,
        account_type: beneficiary.accountType,
        bank_code: beneficiary.bankCode,
        country_code: beneficiary.countryCode,
        iban: beneficiary.iban,
        region: beneficiary.region,
        province_state: beneficiary.provinceState,
        branch_name: beneficiary.branchName,
        branch_code: beneficiary.branchCode,
        id_type: beneficiary.idType,
        id_number: beneficiary.idNumber,
        phone: beneficiary.phone,
        email: beneficiary.email,
        bank_name: beneficiary.bankName,
        remark: beneficiary.remark,
        source: "MANUAL",
        updated_by: auth.userId,
        created_by: auth.userId,
      },
      { onConflict: "payout_order_id" },
    );
  if (beneficiaryError) {
    return NextResponse.json(
      { message: beneficiaryError.message },
      { status: 500 },
    );
  }

  const [
    { data: banks, error: bankError },
    { data: poolRows, error: poolError },
    { data: exportItem, error: exportError },
    { data: template, error: templateError },
  ] = await Promise.all([
    auth.db
      .from("bank_reference")
      .select("country_code,bank_code")
      .eq("status", "ACTIVE"),
    auth.db
      .from("pool_buckets")
      .select("settleable_available_amount_vnd")
      .eq("currency", "VND")
      .eq("status", "OPEN"),
    auth.db
      .from("payment_export_items")
      .select("id")
      .eq("payout_order_id", input.payoutOrderId)
      .maybeSingle(),
    auth.db
      .from("payment_template_versions")
      .select("id")
      .eq("template_code", "LOCAL_BATCH_PAYMENT")
      .eq("version", "LOCAL_BATCH_PAYMENT_V1")
      .single(),
  ]);
  const readError = bankError ?? poolError ?? exportError ?? templateError;
  if (readError || !template) {
    return NextResponse.json(
      { message: readError?.message ?? "模板版本不存在" },
      { status: 500 },
    );
  }

  const validBankCodes = new Set(
    (banks ?? []).map(
      (row) =>
        `${String(row.country_code).toUpperCase()}\u001f${String(row.bank_code).toUpperCase()}`,
    ),
  );
  const availableSettleableBalanceVnd = (poolRows ?? [])
    .reduce(
      (sum, row) =>
        sum + Number(row.settleable_available_amount_vnd ?? 0),
      0,
    )
    .toFixed(2);
  const result = assessPaymentReadiness({
    payoutStatus: payout.status,
    currency: payout.currency,
    payoutAmountVnd: String(payout.payout_amount_vnd),
    upstreamFeeRate: "0.005",
    availableSettleableBalanceVnd,
    beneficiary,
    validBankCodes,
    alreadyExported: Boolean(exportItem),
  });

  const { error: checkError } = await auth.db
    .from("payment_execution_checks")
    .insert({
      payout_order_id: input.payoutOrderId,
      template_version_id: template.id,
      check_status: result.status,
      risk_level: result.riskLevel,
      check_results: result.checks,
      blocking_codes: result.blockingCodes,
      warning_codes: result.warningCodes,
      payout_principal_vnd: payout.payout_amount_vnd,
      estimated_upstream_fee_vnd:
        Number(result.requiredGrossDebitVnd) -
        Number(payout.payout_amount_vnd),
      required_gross_debit_vnd: result.requiredGrossDebitVnd,
      available_settleable_balance_vnd: availableSettleableBalanceVnd,
      beneficiary_snapshot_masked: {
        beneficiary_name: beneficiary.beneficiaryName,
        beneficiary_account: maskSensitive(
          beneficiary.beneficiaryAccount,
        ),
        bank_code: beneficiary.bankCode,
        country_code: beneficiary.countryCode,
        id_number: maskSensitive(beneficiary.idNumber),
        phone: maskSensitive(beneficiary.phone),
        email: beneficiary.email ? "***" : null,
      },
      shadow_mode: true,
      automatic_execution: false,
      created_by: auth.userId,
    });
  if (checkError) {
    return NextResponse.json({ message: checkError.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    payoutOrderId: input.payoutOrderId,
    readiness: result,
    automaticExecution: false,
    shadowMode: true,
  });
}
