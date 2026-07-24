import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";

import {
  PAYMENT_TEMPLATE,
  assessPaymentReadiness,
  maskSensitive,
  safeSpreadsheetText,
  toTemplateRow,
  validateBatchSettleableCapacity,
  type PaymentReadinessInput,
} from "../lib/payment-execution";
import { buildPaymentTemplateWorkbook } from "../lib/payment-template-workbook";

const validBanks = new Set(["VNM\u001fVCB"]);
const baseInput: PaymentReadinessInput = {
  payoutStatus: "APPROVED",
  currency: "VND",
  payoutAmountVnd: "1000000",
  upstreamFeeRate: "0.005",
  availableSettleableBalanceVnd: "2000000",
  validBankCodes: validBanks,
  beneficiary: {
    transactionType: "B2C",
    beneficiaryName: "Test Beneficiary",
    beneficiaryAccount: "001234567890",
    accountType: "BANK",
    bankCode: "VCB",
    countryCode: "VNM",
    phone: "84900000000",
    remark: "invoice-1",
  },
};

describe("payment execution guard", () => {
  it("marks a valid VND payout READY", () => {
    const result = assessPaymentReadiness(baseInput);
    expect(result.status).toBe("READY");
    expect(result.requiredGrossDebitVnd).toBe("1005000.00");
  });

  it("blocks a missing required bank code", () => {
    const result = assessPaymentReadiness({
      ...baseInput,
      beneficiary: { ...baseInput.beneficiary!, bankCode: null },
    });
    expect(result.status).toBe("BLOCKED");
    expect(result.blockingCodes).toContain("MISSING_BANK_CODE");
  });

  it("blocks insufficient settleable balance", () => {
    const result = assessPaymentReadiness({
      ...baseInput,
      availableSettleableBalanceVnd: "1004999.99",
    });
    expect(result.blockingCodes).toContain("INSUFFICIENT_BALANCE");
  });

  it.each(["FAILED", "TIMEOUT", "REFUNDED"])(
    "blocks non-payable status %s",
    (payoutStatus) => {
      const result = assessPaymentReadiness({
        ...baseInput,
        payoutStatus,
      });
      expect(result.blockingCodes).toContain("NON_PAYABLE_STATUS");
    },
  );

  it("blocks historical completed orders from repeat payment", () => {
    const result = assessPaymentReadiness({
      ...baseInput,
      payoutStatus: "SUCCESS",
    });
    expect(result.blockingCodes).toContain("ALREADY_COMPLETED");
  });

  it("blocks the wrong currency/country combination", () => {
    const result = assessPaymentReadiness({
      ...baseInput,
      currency: "PHP",
      beneficiary: {
        ...baseInput.beneficiary!,
        countryCode: "PHL",
      },
    });
    expect(result.blockingCodes).toContain("INVALID_CURRENCY");
  });

  it("marks missing optional contact details as WARNING", () => {
    const result = assessPaymentReadiness({
      ...baseInput,
      beneficiary: {
        ...baseInput.beneficiary!,
        phone: null,
        email: null,
      },
    });
    expect(result.status).toBe("WARNING");
    expect(result.warningCodes).toContain("MISSING_OPTIONAL_CONTACT");
  });

  it("checks batch capacity including the upstream fee", () => {
    expect(
      validateBatchSettleableCapacity({
        rows: [
          { payoutAmountVnd: "1000000", upstreamFeeRate: "0.005" },
          { payoutAmountVnd: "2000000", upstreamFeeRate: "0.005" },
        ],
        availableSettleableBalanceVnd: "3015000",
      }),
    ).toEqual({
      requiredGrossDebitVnd: "3015000.00",
      availableSettleableBalanceVnd: "3015000.00",
      isSufficient: true,
    });
  });
});

describe("privacy and spreadsheet safety", () => {
  it("masks sensitive account data", () => {
    expect(maskSensitive("1234567890")).toBe("******7890");
    expect(maskSensitive("1234")).toBe("****");
  });

  it("neutralizes spreadsheet formula injection", () => {
    expect(safeSpreadsheetText("=HYPERLINK(\"bad\")")).toBe(
      "'=HYPERLINK(\"bad\")",
    );
    expect(safeSpreadsheetText("+123")).toBe("'+123");
  });

  it("maps exactly the upstream template's 19 fields", () => {
    const row = toTemplateRow({
      currency: "VND",
      payoutAmount: "1000000",
      beneficiary: baseInput.beneficiary!,
    });
    expect(row).toHaveLength(19);
    expect(PAYMENT_TEMPLATE.headers).toHaveLength(19);
    expect(row[2]).toBe(1000000);
  });
});

describe("upstream workbook generation", () => {
  it("keeps exact sheet names/headers and excludes demo/tracking rows", () => {
    const output = buildPaymentTemplateWorkbook({
      rows: [
        {
          payoutId: "internal-only",
          currency: "VND",
          payoutAmount: "1000000",
          beneficiary: baseInput.beneficiary!,
        },
      ],
      banks: [
        {
          countryName: "越南",
          countryCode: "VNM",
          bankCode: "VCB",
          bankNameEn: "Vietcombank",
          bankNameLocal: "VIETCOMBANK",
        },
      ],
      countries: [
        { countryCode: "VNM", countryName: "越南", currency: "VND" },
      ],
    });
    const workbook = XLSX.read(output.bytes, { type: "buffer", raw: false });
    expect(workbook.SheetNames).toEqual(["批量模板", "银行编码", "国家编码"]);
    expect(workbook.SheetNames).not.toContain("internal_tracking");
    const mainRows = XLSX.utils.sheet_to_json(
      workbook.Sheets["批量模板"],
      { header: 1, defval: "", raw: false },
    ) as unknown[][];
    expect(mainRows[1]).toEqual([...PAYMENT_TEMPLATE.headers]);
    expect(mainRows[2]).toHaveLength(19);
    expect(mainRows.flat().join("|")).not.toContain("internal-only");
    expect(mainRows).toHaveLength(3);
    expect(output.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("contains no upstream payment submission capability", () => {
    const migration = readFileSync(
      resolve(
        process.cwd(),
        "supabase/migrations/20260724110000_vnd_payout_execution_guard_v1.sql",
      ),
      "utf8",
    );
    const exportRoute = readFileSync(
      resolve(process.cwd(), "app/api/payment-export/route.ts"),
      "utf8",
    );
    expect(migration).toContain("submitted_to_upstream boolean not null default false");
    expect(migration).toContain("automatic_execution boolean not null default false");
    expect(migration).not.toMatch(/net\.http|http_post|pg_net/i);
    expect(exportRoute).toContain('"X-Automatic-Payment": "false"');
  });
});
