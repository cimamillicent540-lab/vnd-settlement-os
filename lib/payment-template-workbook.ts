import { createHash } from "node:crypto";

import * as XLSX from "xlsx";

import {
  PAYMENT_TEMPLATE,
  type PaymentBeneficiary,
  toTemplateRow,
} from "./payment-execution";

export interface PaymentWorkbookRow {
  payoutId: string;
  currency: string;
  payoutAmount: string | number;
  beneficiary: PaymentBeneficiary;
}

export interface PaymentBankReference {
  countryName: string;
  countryCode: string;
  bankCode: string;
  bankNameEn: string;
  bankNameLocal?: string | null;
}

export interface PaymentCountryReference {
  countryCode: string;
  countryName: string;
  currency: string;
}

function setColumnWidths(
  sheet: XLSX.WorkSheet,
  widths: number[],
) {
  sheet["!cols"] = widths.map((wch) => ({ wch }));
}

function buildMainSheet(rows: PaymentWorkbookRow[]) {
  const data = [
    [PAYMENT_TEMPLATE.instruction, ...Array(18).fill("")],
    [...PAYMENT_TEMPLATE.headers],
    ...rows.map((row) =>
      toTemplateRow({
        currency: row.currency,
        payoutAmount: row.payoutAmount,
        beneficiary: row.beneficiary,
      }),
    ),
  ];
  const sheet = XLSX.utils.aoa_to_sheet(data);
  sheet["!merges"] = [XLSX.utils.decode_range("A1:S1")];
  sheet["!rows"] = [{ hpt: 280 }, { hpt: 24 }];
  setColumnWidths(
    sheet,
    [12, 12, 16, 24, 24, 18, 24, 14, 22, 16, 16, 22, 16, 16, 22, 18, 26, 28, 32],
  );
  for (let rowIndex = 2; rowIndex < data.length; rowIndex += 1) {
    const amountCell = sheet[XLSX.utils.encode_cell({ r: rowIndex, c: 2 })];
    if (amountCell) amountCell.z = "0.00";
  }
  return sheet;
}

function buildBankSheet(rows: PaymentBankReference[]) {
  const data = [
    [
      "国家名称",
      "国家编码",
      "银行编码/电子钱包编码",
      "银行名称/电子钱包名称(英文)",
      "银行名称/电子钱包名称（当地语言）",
      "",
    ],
    ...rows.map((row) => [
      row.countryName,
      row.countryCode,
      row.bankCode,
      row.bankNameEn,
      row.bankNameLocal ?? "",
      "",
    ]),
  ];
  const sheet = XLSX.utils.aoa_to_sheet(data);
  setColumnWidths(sheet, [18, 14, 28, 70, 70, 4]);
  return sheet;
}

function buildCountrySheet(rows: PaymentCountryReference[]) {
  const data = [
    ["国家编码", "国家名称", "支持币种", "", "", "", ""],
    ...rows.map((row) => [
      row.countryCode,
      row.countryName,
      row.currency,
      "",
      "",
      "",
      "",
    ]),
  ];
  const sheet = XLSX.utils.aoa_to_sheet(data);
  setColumnWidths(sheet, [14, 20, 18, 4, 4, 4, 4]);
  return sheet;
}

export function buildPaymentTemplateWorkbook(input: {
  rows: PaymentWorkbookRow[];
  banks: PaymentBankReference[];
  countries: PaymentCountryReference[];
}) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    buildMainSheet(input.rows),
    PAYMENT_TEMPLATE.mainSheetName,
  );
  XLSX.utils.book_append_sheet(
    workbook,
    buildBankSheet(input.banks),
    PAYMENT_TEMPLATE.bankSheetName,
  );
  XLSX.utils.book_append_sheet(
    workbook,
    buildCountrySheet(input.countries),
    PAYMENT_TEMPLATE.countrySheetName,
  );
  workbook.Props = {
    Title: "VND batch payment preparation",
    Subject: "Shadow Mode payment preparation only",
    Author: "VND Shadow OS",
    Comments: "This workbook does not submit or execute payments.",
  };
  const bytes = XLSX.write(workbook, {
    type: "buffer",
    bookType: "xlsx",
    compression: true,
  }) as Buffer;
  return {
    bytes,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}
