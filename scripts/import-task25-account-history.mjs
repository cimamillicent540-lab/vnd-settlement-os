import crypto from "node:crypto";
import fs from "node:fs";
import Decimal from "decimal.js";
import XLSX from "xlsx";
import { createClient } from "@supabase/supabase-js";
import { normalizeSupabaseUrl } from "../lib/supabase-url.ts";

const ACCOUNT_HISTORY_SHA256 =
  "3c6c1b5bd15e17794265931ea11cb29a0d84f23cc8fca91fabc9e3e2ad1689d7";
const ACCOUNT_HISTORY_FILE =
  process.argv[2] ?? "AccountHistory-AC202541470-20260723-0.xlsx";
const PAYOUT_FILE = process.argv[3] ?? "qr_pay_view (1)(1).xls";
const SOURCE_TIMEZONE = "UTC+8";
const BALANCE_TOLERANCE_VND = new Decimal("0.51");
const CHUNK_SIZE = 400;

const url = normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
const key =
  process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Supabase server configuration is missing");

const db = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function fileSha256(path) {
  return sha256(fs.readFileSync(path));
}

function decimal(value) {
  return new Decimal(value ?? 0);
}

function readRows(path) {
  const workbook = XLSX.read(fs.readFileSync(path), {
    type: "buffer",
    raw: true,
  });
  return XLSX.utils.sheet_to_json(
    workbook.Sheets[workbook.SheetNames[0]],
    { defval: null, raw: true },
  );
}

function localTimestamp(value) {
  if (typeof value !== "number") return String(value ?? "").trim();
  const date = XLSX.SSF.parse_date_code(value);
  return `${String(date.y).padStart(4, "0")}-${String(date.m).padStart(2, "0")}-${String(date.d).padStart(2, "0")} ${String(date.H).padStart(2, "0")}:${String(date.M).padStart(2, "0")}:${String(Math.round(date.S)).padStart(2, "0")}`;
}

function utcTimestamp(local) {
  return new Date(`${local.replace(" ", "T")}+08:00`).toISOString();
}

function normalizedIdentifier(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function rawSnapshot(row) {
  return Object.fromEntries(
    Object.entries(row).map(([field, value]) => [
      field,
      value == null ? null : String(value),
    ]),
  );
}

function canonicalRow(row, localTime) {
  return [
    row["商户编号"],
    row["商户名称"],
    row["业务订单号"],
    row["币种"],
    row["余额类型"],
    row["交易类型"],
    row["变动金额"],
    row["订单金额"],
    row["手续费"],
    row["交易方向"],
    row["交易前余额"],
    row["交易后余额"],
    localTime,
    row["产品编码"],
    row["原因"],
  ]
    .map((value) => value ?? "")
    .join("\u001f");
}

function classifyEvent(row) {
  if (row["交易类型"] === "收单") return "PAYIN_INFLOW";
  if (
    row["交易类型"] === "代付" &&
    row["交易方向"] === "减少"
  ) {
    return "PAYOUT_OUTFLOW";
  }
  if (
    row["交易类型"] === "代付" &&
    row["交易方向"] === "增加" &&
    (String(row["业务订单号"] ?? "").endsWith("R") ||
      String(row["原因"] ?? "").toLowerCase().includes("refund"))
  ) {
    return "REFUND_CREDIT";
  }
  if (row["交易类型"] === "结算扣款") {
    return "INTERNAL_TRANSFER_DEBIT";
  }
  if (row["交易类型"] === "结算入账") {
    return "INTERNAL_TRANSFER_CREDIT";
  }
  if (row["交易类型"] === "调账") return "MANUAL_ADJUSTMENT";
  throw new Error(`Unsupported Account History event: ${row["交易类型"]}`);
}

function parseNetSettlementReason(reason) {
  const compact = String(reason ?? "").replace(/,/g, "");
  const match = compact.match(
    /([0-9]+(?:\.[0-9]+)?)\s*\*\s*([0-9]+(?:\.[0-9]+)?)\s*usdt\s*=\s*([0-9]+(?:\.[0-9]+)?)\s*vnd/i,
  );
  if (!match) return null;
  const [, statedRate, usdtAmount, vndAmount] = match;
  const calculatedRate = decimal(vndAmount).div(usdtAmount);
  if (calculatedRate.minus(statedRate).abs().gt("0.000001")) {
    throw new Error("Net Settlement stated rate does not match VND / USDT");
  }
  return {
    usdtAmount: decimal(usdtAmount),
    vndAmount: decimal(vndAmount),
    actualRate: calculatedRate,
  };
}

async function fetchAll(table, columns, configure = (query) => query) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await configure(
      db.from(table).select(columns).range(from, from + 999),
    );
    if (error) throw error;
    rows.push(...data);
    if (data.length < 1000) break;
  }
  return rows;
}

async function insertChunks(table, rows, options = {}) {
  const inserted = [];
  for (let offset = 0; offset < rows.length; offset += CHUNK_SIZE) {
    const chunk = rows.slice(offset, offset + CHUNK_SIZE);
    const query = options.onConflict
      ? db
          .from(table)
          .upsert(chunk, {
            onConflict: options.onConflict,
            ignoreDuplicates: true,
          })
      : db.from(table).insert(chunk);
    const { data, error } = options.select ? await query.select(options.select) : await query;
    if (error) throw error;
    if (data) inserted.push(...data);
  }
  return inserted;
}

const accountFileHash = fileSha256(ACCOUNT_HISTORY_FILE);
if (accountFileHash !== ACCOUNT_HISTORY_SHA256) {
  throw new Error("Account History SHA-256 does not match the approved source");
}
const payoutFileHash = fileSha256(PAYOUT_FILE);
const allRows = readRows(ACCOUNT_HISTORY_FILE);
const payoutSourceRows = readRows(PAYOUT_FILE);

const normalized = allRows.map((row, index) => {
  const sourceRowNumber = index + 2;
  const localTime = localTimestamp(row["交易时间"]);
  const transactionTime = utcTimestamp(localTime);
  const businessOrderNumber = normalizedIdentifier(row["业务订单号"]);
  const rowHash = sha256(canonicalRow(row, localTime));
  const changeAmount = decimal(row["变动金额"]);
  const direction = String(row["交易方向"] ?? "");
  const transactionType = String(row["交易类型"] ?? "");
  const dedupeKey = sha256(
    [
      row["币种"],
      businessOrderNumber,
      transactionTime,
      transactionType,
      direction,
      changeAmount.toFixed(2),
    ].join("\u001f"),
  );
  return {
    raw: row,
    sourceRowNumber,
    localTime,
    transactionTime,
    businessOrderNumber,
    rowHash,
    dedupeKey,
    changeAmount,
    direction,
    transactionType,
    eventType: row["币种"] === "VND" ? classifyEvent(row) : null,
  };
});

const vndRows = normalized
  .filter((row) => row.raw["币种"] === "VND")
  .sort(
    (a, b) =>
      a.transactionTime.localeCompare(b.transactionTime) ||
      b.sourceRowNumber - a.sourceRowNumber,
  );

const [{ data: existingBatch, error: existingBatchError }, existingRows] =
  await Promise.all([
    db
      .from("import_batches")
      .select("id,status")
      .eq("file_hash", accountFileHash)
      .maybeSingle(),
    fetchAll(
      "account_history_entries",
      "import_batch_id,raw_row_hash,dedupe_key,business_order_number,transaction_time,transaction_type,direction,change_amount_vnd",
    ),
  ]);
if (existingBatchError) throw existingBatchError;
if (existingBatch?.status === "COMPLETED") {
  console.log(
    JSON.stringify({
      status: "ALREADY_IMPORTED",
      batchId: existingBatch.id,
      fileHash: accountFileHash,
    }),
  );
  process.exit(0);
}

const existingHashes = new Set(existingRows.map((row) => row.raw_row_hash));
const existingDedupeKeys = new Set(
  existingRows.map((row) => row.dedupe_key).filter(Boolean),
);
const currentBatchHashes = new Set(
  existingRows
    .filter((row) => row.import_batch_id === existingBatch?.id)
    .map((row) => row.raw_row_hash),
);
const currentBatchDedupeKeys = new Set(
  existingRows
    .filter((row) => row.import_batch_id === existingBatch?.id)
    .map((row) => row.dedupe_key)
    .filter(Boolean),
);
const duplicateRows = vndRows.filter(
  (row) =>
    (existingHashes.has(row.rowHash) &&
      !currentBatchHashes.has(row.rowHash)) ||
    (existingDedupeKeys.has(row.dedupeKey) &&
      !currentBatchDedupeKeys.has(row.dedupeKey)),
);
const rowsToImport = vndRows.filter(
  (row) =>
    !existingHashes.has(row.rowHash) && !existingDedupeKeys.has(row.dedupeKey),
);

const payoutDebits = new Map(
  vndRows
    .filter((row) => row.eventType === "PAYOUT_OUTFLOW")
    .map((row) => [row.businessOrderNumber, row]),
);
const refunds = vndRows.filter((row) => row.eventType === "REFUND_CREDIT");
for (const refund of refunds) {
  const originalNumber = refund.businessOrderNumber?.endsWith("R")
    ? refund.businessOrderNumber.slice(0, -1)
    : refund.businessOrderNumber;
  const original = payoutDebits.get(originalNumber);
  refund.refundOriginalBusinessOrderNumber = originalNumber;
  refund.refundMatchStatus = !original
    ? "ORIGINAL_NOT_FOUND"
    : refund.changeAmount.eq(
          decimal(original.raw["订单金额"]).plus(original.raw["手续费"]),
        )
      ? "MATCHED"
      : "AMOUNT_MISMATCH";
}

const transferGroups = new Map();
for (const row of vndRows.filter((item) =>
  ["INTERNAL_TRANSFER_DEBIT", "INTERNAL_TRANSFER_CREDIT"].includes(
    item.eventType,
  ),
)) {
  const key = `${row.businessOrderNumber}\u001f${row.changeAmount.toFixed(2)}`;
  const group = transferGroups.get(key) ?? [];
  group.push(row);
  transferGroups.set(key, group);
}
for (const [key, group] of transferGroups) {
  const valid =
    group.length === 2 &&
    group.some((row) => row.eventType === "INTERNAL_TRANSFER_DEBIT") &&
    group.some((row) => row.eventType === "INTERNAL_TRANSFER_CREDIT") &&
    Math.abs(
      Date.parse(group[0].transactionTime) -
        Date.parse(group[1].transactionTime),
    ) <= 1000;
  for (const row of group) {
    row.transferPairKey = sha256(key);
    row.transferPairStatus = valid ? "PAIRED" : "UNMATCHED";
  }
}

const firstTransactionTime = vndRows[0].transactionTime;
const { data: priorRow, error: priorError } = await db
  .from("account_history_entries")
  .select("balance_after_vnd")
  .lt("transaction_time", firstTransactionTime)
  .order("transaction_time", { ascending: false })
  .order("source_row_number", { ascending: true })
  .limit(1)
  .maybeSingle();
if (priorError) throw priorError;

let priorBalance = priorRow ? decimal(priorRow.balance_after_vnd) : null;
let balanceMismatchRows = 0;
let continuityMismatchRows = 0;
for (const [index, row] of vndRows.entries()) {
  const before = decimal(row.raw["交易前余额"]);
  const after = decimal(row.raw["交易后余额"]);
  const expected =
    row.direction === "增加"
      ? before.plus(row.changeAmount)
      : before.minus(row.changeAmount);
  row.balanceDifference = expected.minus(after);
  row.balanceValidationStatus = row.balanceDifference.abs().lte("0.01")
    ? "MATCH"
    : "MISMATCH";
  if (row.balanceValidationStatus === "MISMATCH") balanceMismatchRows += 1;
  const continuityDifference =
    index === 0 && priorBalance
      ? priorBalance.minus(before)
      : index > 0
        ? decimal(vndRows[index - 1].raw["交易后余额"]).minus(before)
        : new Decimal(0);
  row.continuityStatus =
    index === 0 && !priorBalance
      ? "FIRST"
      : continuityDifference.abs().lte(BALANCE_TOLERANCE_VND)
        ? "MATCH"
        : "MISMATCH";
  if (row.continuityStatus === "MISMATCH") continuityMismatchRows += 1;
  priorBalance = after;
}

const accountRecords = rowsToImport.map((row) => {
  const grossOrderAmount = decimal(row.raw["订单金额"]);
  const fee = decimal(row.raw["手续费"]);
  const signedAmount =
    row.direction === "增加" ? row.changeAmount : row.changeAmount.neg();
  const refundOriginal = row.refundOriginalBusinessOrderNumber ?? null;
  return {
    import_batch_id: existingBatch?.id,
    source_row_number: row.sourceRowNumber,
    merchant_code: normalizedIdentifier(row.raw["商户编号"]),
    merchant_name: normalizedIdentifier(row.raw["商户名称"]),
    business_order_number: row.businessOrderNumber,
    currency: "VND",
    balance_type: normalizedIdentifier(row.raw["余额类型"]),
    transaction_type: row.transactionType,
    event_type: row.eventType,
    change_amount_vnd: row.changeAmount.toFixed(2),
    gross_order_amount_vnd: grossOrderAmount.toFixed(2),
    fee_vnd: fee.toFixed(2),
    direction: row.direction,
    signed_amount_vnd: signedAmount.toFixed(2),
    payout_principal_vnd:
      row.eventType === "PAYOUT_OUTFLOW"
        ? grossOrderAmount.toFixed(2)
        : null,
    payout_fee_vnd:
      row.eventType === "PAYOUT_OUTFLOW" ? fee.toFixed(2) : null,
    pool_inflow_vnd:
      row.eventType === "PAYIN_INFLOW" ? row.changeAmount.toFixed(2) : null,
    pool_outflow_vnd:
      row.eventType === "PAYOUT_OUTFLOW" ? row.changeAmount.toFixed(2) : null,
    balance_before_vnd: decimal(row.raw["交易前余额"]).toFixed(2),
    balance_after_vnd: decimal(row.raw["交易后余额"]).toFixed(2),
    transaction_time: row.transactionTime,
    source_local_time: row.localTime,
    source_timezone: SOURCE_TIMEZONE,
    product_code: normalizedIdentifier(row.raw["产品编码"]),
    reason: normalizedIdentifier(row.raw["原因"]),
    balance_validation_difference_vnd: row.balanceDifference.toFixed(2),
    balance_validation_status: row.balanceValidationStatus,
    continuity_status: row.continuityStatus,
    transfer_pair_key: row.transferPairKey ?? null,
    transfer_pair_status:
      row.transferPairStatus ??
      (["INTERNAL_TRANSFER_DEBIT", "INTERNAL_TRANSFER_CREDIT"].includes(
        row.eventType,
      )
        ? "UNMATCHED"
        : "NOT_APPLICABLE"),
    raw_row_hash: row.rowHash,
    raw_row_snapshot: {
      ...rawSnapshot(row.raw),
      source_excel_serial: row.raw["交易时间"],
    },
    source_file_hash: accountFileHash,
    dedupe_key: row.dedupeKey,
    refund_original_business_order_number: refundOriginal,
    refund_credit_vnd:
      row.eventType === "REFUND_CREDIT" ? row.changeAmount.toFixed(2) : null,
    refund_match_status:
      row.eventType === "REFUND_CREDIT"
        ? row.refundMatchStatus
        : "NOT_APPLICABLE",
  };
});

let batch = existingBatch;
if (!batch) {
  const allTimes = normalized.map((row) => row.transactionTime).sort();
  const { data, error } = await db
    .from("import_batches")
    .insert({
      source_type: "ACCOUNT_HISTORY",
      original_file_name: ACCOUNT_HISTORY_FILE.split("/").at(-1),
      file_hash: accountFileHash,
      total_rows: allRows.length,
      valid_rows: rowsToImport.length,
      invalid_rows: 0,
      duplicate_rows: duplicateRows.length,
      excluded_rows: allRows.length - vndRows.length,
      status: "PROCESSING",
      field_mapping: {
        source_columns: Object.keys(allRows[0] ?? {}),
        imported_currency: "VND",
        excluded_currencies: ["IDR", "PHP"],
        row_hash_version: "ACCOUNT_HISTORY_CANONICAL_V1",
      },
      source_timezone: SOURCE_TIMEZONE,
      source_period_start: allTimes[0],
      source_period_end: allTimes.at(-1),
    })
    .select("id,status")
    .single();
  if (error) throw error;
  batch = data;
}

for (const record of accountRecords) record.import_batch_id = batch.id;

try {
  await insertChunks("account_history_entries", accountRecords, {
    onConflict: "raw_row_hash",
  });

  const insertedAccountRows = await fetchAll(
    "account_history_entries",
    "id,source_row_number,business_order_number,event_type,change_amount_vnd,payout_principal_vnd,payout_fee_vnd,transaction_time,reason",
    (query) => query.eq("import_batch_id", batch.id),
  );
  const accountBySourceRow = new Map(
    insertedAccountRows.map((row) => [row.source_row_number, row]),
  );

  const payoutDatabaseRows = await fetchAll(
    "payout_orders",
    "id,order_number,payout_amount_vnd",
  );
  const payoutByOrder = new Map(
    payoutDatabaseRows.map((row) => [String(row.order_number), row]),
  );
  const identifiers = payoutSourceRows
    .map((row) => {
      const payout = payoutByOrder.get(String(row["订单号"] ?? "").trim());
      if (!payout) return null;
      return {
        payout_order_id: payout.id,
        source_file_hash: payoutFileHash,
        order_number: String(row["订单号"]).trim(),
        channel_order_number: normalizedIdentifier(row["渠道订单号"]),
        cp_order_number: normalizedIdentifier(row["CP单号"]),
        cp_payment_order_number: normalizedIdentifier(row["CP支付单号"]),
        merchant_order_number: normalizedIdentifier(row["商户订单编号"]),
        payment_order_number: normalizedIdentifier(row["支付订单号"]),
        provider_order_number:
          normalizedIdentifier(row["CP支付单号"]) ??
          normalizedIdentifier(row["支付订单号"]),
        raw_identifier_snapshot: {
          order_number: normalizedIdentifier(row["订单号"]),
          channel_order_number: normalizedIdentifier(row["渠道订单号"]),
          cp_order_number: normalizedIdentifier(row["CP单号"]),
          cp_payment_order_number: normalizedIdentifier(row["CP支付单号"]),
          merchant_order_number: normalizedIdentifier(row["商户订单编号"]),
          payment_order_number: normalizedIdentifier(row["支付订单号"]),
        },
      };
    })
    .filter(Boolean);
  await insertChunks("payout_order_identifiers", identifiers, {
    onConflict: "payout_order_id",
  });

  const identifierFields = [
    ["order_number", "FULL_ORDER_NUMBER"],
    ["provider_order_number", "FULL_ORDER_NUMBER"],
    ["cp_payment_order_number", "FULL_ORDER_NUMBER"],
    ["payment_order_number", "FULL_ORDER_NUMBER"],
    ["channel_order_number", "CHANNEL_ORDER_NUMBER"],
    ["cp_order_number", "FULL_ORDER_NUMBER"],
    ["merchant_order_number", "FULL_ORDER_NUMBER"],
  ];
  const identifierIndexes = new Map(
    identifierFields.map(([field]) => [field, new Map()]),
  );
  for (const row of identifiers) {
    for (const [field] of identifierFields) {
      const value = row[field];
      if (!value) continue;
      const index = identifierIndexes.get(field);
      const matches = index.get(value) ?? [];
      matches.push(row);
      index.set(value, matches);
    }
  }

  let exactMatches = 0;
  let matchConflicts = 0;
  const executionRecords = [];
  for (const sourceDebit of vndRows.filter(
    (row) => row.eventType === "PAYOUT_OUTFLOW",
  )) {
    let payoutIdentifier = null;
    let matchMethod = "NO_EXACT_IDENTIFIER_MATCH";
    let conflict = false;
    for (const [field, method] of identifierFields) {
      const matches =
        identifierIndexes
          .get(field)
          .get(sourceDebit.businessOrderNumber) ?? [];
      if (matches.length === 1) {
        payoutIdentifier = matches[0];
        matchMethod = method;
        break;
      }
      if (matches.length > 1) {
        conflict = true;
        matchMethod = "CONFLICT";
        break;
      }
    }
    if (payoutIdentifier) exactMatches += 1;
    if (conflict) matchConflicts += 1;
    const originalEntry = accountBySourceRow.get(sourceDebit.sourceRowNumber);
    const refundSource = refunds.find(
      (row) =>
        row.refundOriginalBusinessOrderNumber ===
        sourceDebit.businessOrderNumber,
    );
    const refundEntry = refundSource
      ? accountBySourceRow.get(refundSource.sourceRowNumber)
      : null;
    const principal = decimal(sourceDebit.raw["订单金额"]);
    const upstreamFee = decimal(sourceDebit.raw["手续费"]);
    const originalGross = principal.plus(upstreamFee);
    const isRefunded = Boolean(refundEntry);
    executionRecords.push({
      source_file_hash: accountFileHash,
      original_account_history_entry_id: originalEntry.id,
      refund_account_history_entry_id: refundEntry?.id ?? null,
      payout_order_id: payoutIdentifier?.payout_order_id ?? null,
      upstream_business_order_number: sourceDebit.businessOrderNumber,
      match_method: matchMethod,
      match_confidence: payoutIdentifier
        ? "HIGH"
        : conflict
          ? "NONE"
          : "NONE",
      match_evidence: {
        checked_database_fields: [
          "payout_orders.order_number",
          "payout_orders.merchant_order_number",
          "payout_orders.channel_order_number",
        ],
        checked_source_identifier_fields: identifierFields.map(
          ([field]) => field,
        ),
        amount_matches:
          payoutIdentifier != null &&
          decimal(
            payoutByOrder.get(payoutIdentifier.order_number)
              ?.payout_amount_vnd ?? 0,
          ).eq(principal),
        fuzzy_amount_time_used_for_verified: false,
      },
      original_payout_principal_vnd: principal.toFixed(2),
      original_upstream_fee_vnd: upstreamFee.toFixed(2),
      original_gross_outflow_vnd: originalGross.toFixed(2),
      refund_credit_vnd: refundEntry
        ? decimal(refundEntry.change_amount_vnd).toFixed(2)
        : "0.00",
      final_payout_status: isRefunded ? "REFUNDED" : "SUCCESS",
      final_upstream_fee_vnd: isRefunded
        ? "0.00"
        : upstreamFee.toFixed(2),
      final_gross_outflow_vnd: isRefunded
        ? "0.00"
        : originalGross.toFixed(2),
      refund_reversal_status: isRefunded
        ? "NO_PAYOUT_ALLOCATION_LINK"
        : "NOT_APPLICABLE",
      payout_execution_cost_status: isRefunded
        ? "REFUNDED_ZERO"
        : conflict
          ? "CONFLICT"
          : "VERIFIED",
      profit_verification_status: payoutIdentifier
        ? "PARTIAL"
        : "ESTIMATED",
    });
  }
  await insertChunks(
    "account_history_payout_executions",
    executionRecords,
    { onConflict: "original_account_history_entry_id" },
  );

  const netSettlementRecords = vndRows
    .filter((row) => row.eventType === "MANUAL_ADJUSTMENT")
    .map((row) => {
      const parsed = parseNetSettlementReason(row.raw["原因"]);
      if (!parsed) throw new Error("Unparseable Net Settlement reason");
      const accountEntry = accountBySourceRow.get(row.sourceRowNumber);
      return {
        settlement_period_start: null,
        settlement_period_end: null,
        external_usdt_spent: null,
        settled_vnd: parsed.vndAmount.toFixed(2),
        status: "APPROVED",
        notes:
          "Verified VND Account History leg; USDT counter-leg direction pending confirmation.",
        settled_at: row.transactionTime,
        settlement_direction:
          row.direction === "减少" ? "VND_DEBIT" : "VND_CREDIT",
        usdt_amount: parsed.usdtAmount.toFixed(8),
        vnd_amount: parsed.vndAmount.toFixed(2),
        actual_rate_vnd_per_usdt: parsed.actualRate.toFixed(12),
        account_history_entry_id: accountEntry.id,
        reason_raw: String(row.raw["原因"]),
        verification_status: "VERIFIED",
        counter_leg_status: "PENDING_DIRECTION_CONFIRMATION",
        realized_profit_effect_usdt: "0.00000000",
        source_file_hash: accountFileHash,
      };
    });
  await insertChunks("net_settlements", netSettlementRecords, {
    onConflict: "account_history_entry_id",
  });

  const successfulExecutions = executionRecords.filter(
    (row) => row.final_payout_status === "SUCCESS",
  );
  const matchedRefunds = refunds.filter(
    (row) => row.refundMatchStatus === "MATCHED",
  );
  const netUsdt = Decimal.sum(
    ...netSettlementRecords.map((row) => decimal(row.usdt_amount)),
  );
  const netVnd = Decimal.sum(
    ...netSettlementRecords.map((row) => decimal(row.vnd_amount)),
  );
  const validationRecord = {
    source_file_name: ACCOUNT_HISTORY_FILE.split("/").at(-1),
    source_file_hash: accountFileHash,
    source_period_start: utcTimestamp(normalized.at(-1).localTime),
    source_period_end: utcTimestamp(normalized[0].localTime),
    total_source_rows: allRows.length,
    vnd_source_rows: vndRows.length,
    imported_rows: insertedAccountRows.length,
    duplicate_rows: duplicateRows.length,
    excluded_non_vnd_rows: allRows.length - vndRows.length,
    payout_debit_rows: payoutDebits.size,
    refund_rows: refunds.length,
    refund_matched_rows: matchedRefunds.length,
    refund_unmatched_rows: refunds.length - matchedRefunds.length,
    successful_unrefunded_rows: successfulExecutions.length,
    successful_principal_vnd: Decimal.sum(
      ...successfulExecutions.map((row) =>
        decimal(row.original_payout_principal_vnd),
      ),
    ).toFixed(2),
    successful_upstream_fee_vnd: Decimal.sum(
      ...successfulExecutions.map((row) =>
        decimal(row.final_upstream_fee_vnd),
      ),
    ).toFixed(2),
    successful_gross_outflow_vnd: Decimal.sum(
      ...successfulExecutions.map((row) =>
        decimal(row.final_gross_outflow_vnd),
      ),
    ).toFixed(2),
    payout_exact_match_rows: exactMatches,
    payout_conflict_rows: matchConflicts,
    payout_unmatched_rows: payoutDebits.size - exactMatches - matchConflicts,
    net_settlement_rows: netSettlementRecords.length,
    net_settlement_usdt: netUsdt.toFixed(8),
    net_settlement_vnd: netVnd.toFixed(2),
    net_settlement_weighted_rate: netVnd.div(netUsdt).toFixed(12),
    account_history_cutoff: vndRows.at(-1).transactionTime,
    account_history_closing_gross_vnd: decimal(
      vndRows.at(-1).raw["交易后余额"],
    ).toFixed(2),
    balance_mismatch_rows: balanceMismatchRows,
    continuity_mismatch_rows: continuityMismatchRows,
    evidence: {
      source_file_sha256: accountFileHash,
      payout_identifier_source_sha256: payoutFileHash,
      full_file_period_local: {
        start: normalized.at(-1).localTime,
        end: normalized[0].localTime,
      },
      vnd_period_local: {
        start: vndRows[0].localTime,
        end: vndRows.at(-1).localTime,
      },
      internal_transfer_pairing: {
        debit_rows: vndRows.filter(
          (row) => row.eventType === "INTERNAL_TRANSFER_DEBIT",
        ).length,
        credit_rows: vndRows.filter(
          (row) => row.eventType === "INTERNAL_TRANSFER_CREDIT",
        ).length,
        unmatched_rows: vndRows.filter(
          (row) =>
            ["INTERNAL_TRANSFER_DEBIT", "INTERNAL_TRANSFER_CREDIT"].includes(
              row.eventType,
            ) && row.transferPairStatus !== "PAIRED",
        ).length,
      },
      exact_match_policy:
        "No amount/time-only candidate is promoted to VERIFIED.",
      automatic_funds_actions: false,
    },
    shadow_mode: true,
  };
  await insertChunks("task25_validation_runs", [validationRecord], {
    onConflict: "source_file_hash",
  });

  const qualityIssues = [];
  if (validationRecord.payout_unmatched_rows > 0) {
    qualityIssues.push({
      issue_type: "PAYOUT_EXACT_IDENTIFIER_NOT_FOUND",
      severity: "WARNING",
      source_reference: accountFileHash,
      details: {
        unmatched_rows: validationRecord.payout_unmatched_rows,
        exact_matches: exactMatches,
        fuzzy_matches_promoted: 0,
      },
      status: "OPEN",
    });
  }
  if (
    executionRecords.some(
      (row) => row.refund_reversal_status === "NO_PAYOUT_ALLOCATION_LINK",
    )
  ) {
    qualityIssues.push({
      issue_type: "REFUND_PAYOUT_ALLOCATION_LINK_MISSING",
      severity: "WARNING",
      source_reference: accountFileHash,
      details: {
        account_history_refunds_net_zero: matchedRefunds.length,
        payout_allocation_reversals_pending: executionRecords.filter(
          (row) =>
            row.refund_reversal_status === "NO_PAYOUT_ALLOCATION_LINK",
        ).length,
      },
      status: "OPEN",
    });
  }
  qualityIssues.push({
    issue_type: "NET_SETTLEMENT_COUNTER_LEG_PENDING",
    severity: "WARNING",
    source_reference: accountFileHash,
    details: {
      settlement_rows: netSettlementRecords.length,
      realized_profit_effect_usdt: 0,
    },
    status: "OPEN",
  });
  await insertChunks("data_quality_issues", qualityIssues);

  const { error: auditError } = await db.from("audit_logs").insert({
    action: "IMPORT_TASK25_ACCOUNT_HISTORY",
    entity_type: "import_batch",
    entity_id: batch.id,
    after_state: validationRecord,
    metadata: {
      source_file_sha256: accountFileHash,
      shadow_mode: true,
      automatic_funds_actions: false,
    },
  });
  if (auditError) throw auditError;

  const { error: completeError } = await db
    .from("import_batches")
    .update({
      status: "COMPLETED",
      valid_rows: insertedAccountRows.length,
      duplicate_rows: duplicateRows.length,
      excluded_rows: allRows.length - vndRows.length,
      error_summary: null,
    })
    .eq("id", batch.id);
  if (completeError) throw completeError;

  console.log(
    JSON.stringify(
      {
        status: "COMPLETED",
        batchId: batch.id,
        validation: validationRecord,
        payoutIdentifierRows: identifiers.length,
      },
      null,
      2,
    ),
  );
} catch (error) {
  await db
    .from("import_batches")
    .update({
      status: "FAILED",
      error_summary: {
        code: error?.code ?? "IMPORT_FAILED",
        message: error?.message ?? String(error),
      },
    })
    .eq("id", batch.id);
  throw error;
}
