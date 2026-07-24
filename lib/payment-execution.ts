import Decimal from "decimal.js";

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export const PAYMENT_TEMPLATE = Object.freeze({
  sourceFileName: "Batch Payment Templates_Local (1).xlsx",
  sourceFileSha256:
    "49cafd91f2f9954ff1245ff38bd97b1d2b805290369eaeed606049a538bc70bf",
  version: "LOCAL_BATCH_PAYMENT_V1",
  mainSheetName: "批量模板",
  bankSheetName: "银行编码",
  countrySheetName: "国家编码",
  instruction:
    "填写说明：\n第三行为演示数据，提交前请注意删除。\n1.【交易类型】【必填】说明该代付账户是企业（对公）还是个人（对私），示例B2C：个人（对私）, B2B：企业（对公），批量代付目前仅支持B2C\n2.【代付币种】【必填】填写代付币种，同一批次仅支持同币种代付，详见附录《国家编码》\n3.【到账金额】【必填】收款方到账本金，并非系统实际扣款金额（实际扣款会加上代付手续费）\n4.【收款账户名称】【必填】收款方银行账户名称\n5.【收款账号】【必填】银行卡号或电子钱包收款账号\n6.【收款账户类型】【必填】参考接口文档\n7.【银行编码/电子钱包编码】【必填】详见附录《银行编码》\n8.【国家编码】【必填】详见附录《国家编码》\n9.【IBAN】SAR必填\n10.【地区】收款账户所在地区\n11.【省/州】秘鲁必填\n12.【支行名称】收款银行支行名称\n13.【支行编号】收款银行支行编码\n14.【证件类型】巴西及部分拉美国家必填\n15.【证件号】巴西及部分拉美国家必填\n16.【手机号】可选\n17.【邮箱】可选\n18.【银行名称】收款银行卡银行名称\n19.【附言】部分国家支持，不超过30字符",
  headers: [
    "*交易类型",
    "*代付币种",
    "*到账金额",
    "*收款账户名称",
    "*收款账号",
    "*收款账户类型",
    "*银行编码/电子钱包编码",
    "*国家编码",
    "IBAN",
    "地区",
    "省/州",
    "支行名称",
    "支行编号",
    "证件类型",
    "证件号",
    "手机号",
    "邮箱",
    "银行名称",
    "附言",
  ] as const,
});

export type PaymentCheckStatus = "READY" | "WARNING" | "BLOCKED";
export type PaymentRiskLevel = "LOW" | "MEDIUM" | "HIGH";
export type PaymentCheckSeverity = "PASS" | "WARNING" | "BLOCKED";

export type PaymentCheckCode =
  | "READY"
  | "INVALID_AMOUNT"
  | "INVALID_CURRENCY"
  | "INVALID_COUNTRY"
  | "UNSUPPORTED_TRANSACTION_TYPE"
  | "MISSING_BENEFICIARY_NAME"
  | "MISSING_BENEFICIARY_ACCOUNT"
  | "MISSING_ACCOUNT_TYPE"
  | "INVALID_ACCOUNT_TYPE"
  | "MISSING_BANK_CODE"
  | "INVALID_BANK_CODE"
  | "MISSING_IBAN"
  | "MISSING_PROVINCE"
  | "MISSING_IDENTITY"
  | "REMARK_TOO_LONG"
  | "INSUFFICIENT_BALANCE"
  | "NON_PAYABLE_STATUS"
  | "ALREADY_COMPLETED"
  | "ALREADY_EXPORTED"
  | "MISSING_OPTIONAL_CONTACT";

export interface PaymentCheck {
  code: PaymentCheckCode;
  severity: PaymentCheckSeverity;
  message: string;
}

export interface PaymentBeneficiary {
  transactionType: string | null;
  beneficiaryName: string | null;
  beneficiaryAccount: string | null;
  accountType: string | null;
  bankCode: string | null;
  countryCode: string | null;
  iban?: string | null;
  region?: string | null;
  provinceState?: string | null;
  branchName?: string | null;
  branchCode?: string | null;
  idType?: string | null;
  idNumber?: string | null;
  phone?: string | null;
  email?: string | null;
  bankName?: string | null;
  remark?: string | null;
}

export interface PaymentReadinessInput {
  payoutStatus: string;
  currency: string;
  payoutAmountVnd: string;
  upstreamFeeRate?: string;
  availableSettleableBalanceVnd: string;
  beneficiary?: PaymentBeneficiary | null;
  validBankCodes: ReadonlySet<string>;
  alreadyExported?: boolean;
}

export interface PaymentReadinessResult {
  status: PaymentCheckStatus;
  riskLevel: PaymentRiskLevel;
  requiredGrossDebitVnd: string;
  checks: PaymentCheck[];
  blockingCodes: PaymentCheckCode[];
  warningCodes: PaymentCheckCode[];
}

const payEligibleStatuses = new Set([
  "PENDING",
  "APPROVED",
  "APPROVED_FOR_PAYOUT",
  "READY",
  "READY_FOR_EXPORT",
]);
const completedStatuses = new Set(["SUCCESS", "COMPLETED", "PAID"]);
const invalidStatuses = new Set([
  "FAILED",
  "TIMEOUT",
  "CANCELLED",
  "REFUNDED",
  "REJECTED",
]);
const latinIdentityCountries = new Set([
  "BRA",
  "COL",
  "ARG",
  "CHL",
  "MEX",
  "PER",
]);

function normalized(value: string | null | undefined) {
  return value?.trim().toUpperCase() ?? "";
}

function pushCheck(
  checks: PaymentCheck[],
  code: PaymentCheckCode,
  severity: PaymentCheckSeverity,
  message: string,
) {
  checks.push({ code, severity, message });
}

export function assessPaymentReadiness(
  input: PaymentReadinessInput,
): PaymentReadinessResult {
  const checks: PaymentCheck[] = [];
  const amount = new Decimal(input.payoutAmountVnd || 0);
  const upstreamFeeRate = new Decimal(input.upstreamFeeRate ?? "0.005");
  const requiredGrossDebit = amount.mul(new Decimal(1).plus(upstreamFeeRate));
  const available = new Decimal(input.availableSettleableBalanceVnd || 0);
  const status = normalized(input.payoutStatus);
  const currency = normalized(input.currency);
  const beneficiary = input.beneficiary;
  const country = normalized(beneficiary?.countryCode);
  const transactionType = normalized(beneficiary?.transactionType);
  const accountType = normalized(beneficiary?.accountType);
  const bankCode = normalized(beneficiary?.bankCode);

  if (!amount.isFinite() || amount.lte(0)) {
    pushCheck(checks, "INVALID_AMOUNT", "BLOCKED", "到账金额必须大于0。");
  }
  if (currency !== "VND") {
    pushCheck(
      checks,
      "INVALID_CURRENCY",
      "BLOCKED",
      "当前批量付款V1仅支持VND。",
    );
  }
  if (completedStatuses.has(status)) {
    pushCheck(
      checks,
      "ALREADY_COMPLETED",
      "BLOCKED",
      "订单已经完成付款，禁止再次导出。",
    );
  } else if (invalidStatuses.has(status) || !payEligibleStatuses.has(status)) {
    pushCheck(
      checks,
      "NON_PAYABLE_STATUS",
      "BLOCKED",
      `订单状态 ${status || "UNKNOWN"} 不允许进入付款文件。`,
    );
  }
  if (input.alreadyExported) {
    pushCheck(
      checks,
      "ALREADY_EXPORTED",
      "BLOCKED",
      "订单已经生成过付款准备文件，禁止重复导出。",
    );
  }

  if (!beneficiary?.beneficiaryName?.trim()) {
    pushCheck(
      checks,
      "MISSING_BENEFICIARY_NAME",
      "BLOCKED",
      "缺少收款账户名称。",
    );
  }
  if (!beneficiary?.beneficiaryAccount?.trim()) {
    pushCheck(
      checks,
      "MISSING_BENEFICIARY_ACCOUNT",
      "BLOCKED",
      "缺少收款账号。",
    );
  }
  if (!transactionType) {
    pushCheck(
      checks,
      "UNSUPPORTED_TRANSACTION_TYPE",
      "BLOCKED",
      "缺少交易类型；当前模板仅支持B2C。",
    );
  } else if (transactionType !== "B2C") {
    pushCheck(
      checks,
      "UNSUPPORTED_TRANSACTION_TYPE",
      "BLOCKED",
      "批量付款模板当前仅支持B2C。",
    );
  }
  if (!accountType) {
    pushCheck(
      checks,
      "MISSING_ACCOUNT_TYPE",
      "BLOCKED",
      "缺少收款账户类型。",
    );
  } else if (currency === "VND" && accountType !== "BANK") {
    pushCheck(
      checks,
      "INVALID_ACCOUNT_TYPE",
      "BLOCKED",
      "VND付款当前要求BANK账户类型。",
    );
  }
  if (!country) {
    pushCheck(
      checks,
      "INVALID_COUNTRY",
      "BLOCKED",
      "缺少国家编码。",
    );
  } else if (currency === "VND" && country !== "VNM") {
    pushCheck(
      checks,
      "INVALID_COUNTRY",
      "BLOCKED",
      "VND付款必须使用VNM国家编码。",
    );
  }
  if (!bankCode) {
    pushCheck(
      checks,
      "MISSING_BANK_CODE",
      "BLOCKED",
      "缺少银行/电子钱包编码。",
    );
  } else if (!input.validBankCodes.has(`${country}\u001f${bankCode}`)) {
    pushCheck(
      checks,
      "INVALID_BANK_CODE",
      "BLOCKED",
      "银行编码与国家不匹配或未在模板附录中启用。",
    );
  }
  if (country === "SAU" && !beneficiary?.iban?.trim()) {
    pushCheck(checks, "MISSING_IBAN", "BLOCKED", "SAR付款必须填写IBAN。");
  }
  if (country === "PER" && !beneficiary?.provinceState?.trim()) {
    pushCheck(
      checks,
      "MISSING_PROVINCE",
      "BLOCKED",
      "秘鲁付款必须填写省/州。",
    );
  }
  if (
    latinIdentityCountries.has(country) &&
    (!beneficiary?.idType?.trim() || !beneficiary?.idNumber?.trim())
  ) {
    pushCheck(
      checks,
      "MISSING_IDENTITY",
      "BLOCKED",
      "该国家付款需要证件类型和证件号。",
    );
  }
  if ((beneficiary?.remark?.length ?? 0) > 30) {
    pushCheck(
      checks,
      "REMARK_TOO_LONG",
      "BLOCKED",
      "附言不能超过30个字符。",
    );
  }
  if (requiredGrossDebit.gt(available)) {
    pushCheck(
      checks,
      "INSUFFICIENT_BALANCE",
      "BLOCKED",
      "可结算余额不足以覆盖到账本金和上游手续费。",
    );
  }
  if (!beneficiary?.phone?.trim() && !beneficiary?.email?.trim()) {
    pushCheck(
      checks,
      "MISSING_OPTIONAL_CONTACT",
      "WARNING",
      "手机号和邮箱均未提供；模板允许为空。",
    );
  }

  const blockingCodes = checks
    .filter((check) => check.severity === "BLOCKED")
    .map((check) => check.code);
  const warningCodes = checks
    .filter((check) => check.severity === "WARNING")
    .map((check) => check.code);
  const resultStatus: PaymentCheckStatus = blockingCodes.length
    ? "BLOCKED"
    : warningCodes.length
      ? "WARNING"
      : "READY";
  if (!checks.length) {
    pushCheck(checks, "READY", "PASS", "全部付款前检查通过。");
  }

  return {
    status: resultStatus,
    riskLevel:
      resultStatus === "BLOCKED"
        ? "HIGH"
        : resultStatus === "WARNING"
          ? "MEDIUM"
          : "LOW",
    requiredGrossDebitVnd: requiredGrossDebit.toFixed(2),
    checks,
    blockingCodes,
    warningCodes,
  };
}

export function validateBatchSettleableCapacity(input: {
  rows: Array<{ payoutAmountVnd: string; upstreamFeeRate?: string }>;
  availableSettleableBalanceVnd: string;
}) {
  const required = input.rows.reduce(
    (sum, row) =>
      sum.plus(
        new Decimal(row.payoutAmountVnd).mul(
          new Decimal(1).plus(row.upstreamFeeRate ?? "0.005"),
        ),
      ),
    new Decimal(0),
  );
  const available = new Decimal(input.availableSettleableBalanceVnd);
  return {
    requiredGrossDebitVnd: required.toFixed(2),
    availableSettleableBalanceVnd: available.toFixed(2),
    isSufficient: available.gte(required),
  };
}

export function maskSensitive(
  value: string | null | undefined,
  visibleTail = 4,
) {
  const text = value?.trim() ?? "";
  if (!text) return "—";
  if (text.length <= visibleTail) return "*".repeat(text.length);
  return `${"*".repeat(Math.min(8, text.length - visibleTail))}${text.slice(-visibleTail)}`;
}

export function safeSpreadsheetText(value: string | null | undefined) {
  const text = value?.trim() ?? "";
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

export function toTemplateRow(input: {
  currency: string;
  payoutAmount: string | number;
  beneficiary: PaymentBeneficiary;
}) {
  const beneficiary = input.beneficiary;
  return [
    safeSpreadsheetText(beneficiary.transactionType),
    safeSpreadsheetText(input.currency),
    Number(input.payoutAmount),
    safeSpreadsheetText(beneficiary.beneficiaryName),
    safeSpreadsheetText(beneficiary.beneficiaryAccount),
    safeSpreadsheetText(beneficiary.accountType),
    safeSpreadsheetText(beneficiary.bankCode),
    safeSpreadsheetText(beneficiary.countryCode),
    safeSpreadsheetText(beneficiary.iban),
    safeSpreadsheetText(beneficiary.region),
    safeSpreadsheetText(beneficiary.provinceState),
    safeSpreadsheetText(beneficiary.branchName),
    safeSpreadsheetText(beneficiary.branchCode),
    safeSpreadsheetText(beneficiary.idType),
    safeSpreadsheetText(beneficiary.idNumber),
    safeSpreadsheetText(beneficiary.phone),
    safeSpreadsheetText(beneficiary.email),
    safeSpreadsheetText(beneficiary.bankName),
    safeSpreadsheetText(beneficiary.remark),
  ];
}
