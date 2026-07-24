import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";

const EXPECTED_HASH =
  "49cafd91f2f9954ff1245ff38bd97b1d2b805290369eaeed606049a538bc70bf";
const TEMPLATE_CODE = "LOCAL_BATCH_PAYMENT";
const TEMPLATE_VERSION = "LOCAL_BATCH_PAYMENT_V1";
const DEFAULT_PATH =
  "/Users/zeipiaoliang/Downloads/Batch Payment Templates_Local (1).xlsx";

function requiredEnvironment(name, fallbackName) {
  const value = process.env[name] ?? (fallbackName ? process.env[fallbackName] : "");
  if (!value) throw new Error(`${name} is missing`);
  return value;
}

function normalizeSupabaseUrl(configured) {
  const projectRef = configured.match(/[a-z0-9]{20}/i)?.[0];
  if (!projectRef) throw new Error("NEXT_PUBLIC_SUPABASE_URL is invalid");
  return `https://${projectRef}.supabase.co`;
}

function normalize(value) {
  return String(value ?? "").trim();
}

function rowsFor(workbook, sheetName) {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) throw new Error(`Missing sheet: ${sheetName}`);
  return XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: "",
    raw: false,
  });
}

async function upsertInChunks(table, rows, conflict, chunkSize = 300) {
  for (let offset = 0; offset < rows.length; offset += chunkSize) {
    const chunk = rows.slice(offset, offset + chunkSize);
    const { error } = await db.from(table).upsert(chunk, {
      onConflict: conflict,
    });
    if (error) throw error;
  }
}

const cliArgs = process.argv.slice(2);
const dryRun = cliArgs.includes("--dry-run");
const sourcePath = resolve(
  cliArgs.find((argument) => argument !== "--dry-run") ?? DEFAULT_PATH,
);
const sourceBytes = await readFile(sourcePath);
const sourceHash = createHash("sha256").update(sourceBytes).digest("hex");
if (sourceHash !== EXPECTED_HASH) {
  throw new Error("Template SHA-256 does not match the approved source");
}

const workbook = XLSX.read(sourceBytes, { type: "buffer", raw: false });
const bankSheetRows = rowsFor(workbook, "银行编码");
const countrySheetRows = rowsFor(workbook, "国家编码");

const countries = countrySheetRows
  .slice(1)
  .map((row, index) => ({
    source_row_number: index + 2,
    country_code: normalize(row[0]).toUpperCase(),
    country_name: normalize(row[1]),
    currency: normalize(row[2]).toUpperCase(),
  }))
  .filter(
    (row) =>
      row.country_code &&
      row.country_name &&
      row.currency &&
      /^[A-Z]{2,3}$/.test(row.country_code),
  );
if (countries.length !== 35) {
  throw new Error(`Expected 35 valid country rows, found ${countries.length}`);
}

const currencyByCountry = new Map(
  countries.map((row) => [row.country_code, row.currency]),
);
const bankSourceRows = bankSheetRows
  .slice(1)
  .map((row, index) => ({
    source_row_number: index + 2,
    country_name: normalize(row[0]),
    country_code: normalize(row[1]).toUpperCase(),
    bank_code: normalize(row[2]).toUpperCase(),
    bank_name_en: normalize(row[3]),
    bank_name_local: normalize(row[4]) || null,
  }))
  .filter(
    (row) =>
      row.country_name &&
      row.country_code &&
      row.bank_code &&
      row.bank_name_en,
  );
if (bankSourceRows.length !== 1556) {
  throw new Error(`Expected 1,556 valid bank rows, found ${bankSourceRows.length}`);
}

const duplicateCounts = new Map();
for (const row of bankSourceRows) {
  const key = `${row.country_code}|${row.bank_code}`;
  duplicateCounts.set(key, (duplicateCounts.get(key) ?? 0) + 1);
}

const duplicateGroups = [...duplicateCounts.values()].filter(
  (count) => count > 1,
).length;
const reviewRequiredBanks = bankSourceRows.filter((row) => {
  const key = `${row.country_code}|${row.bank_code}`;
  return (duplicateCounts.get(key) ?? 0) > 1;
}).length;
if (dryRun) {
  process.stdout.write(
    JSON.stringify(
      {
        ok: true,
        dryRun: true,
        templateVersion: TEMPLATE_VERSION,
        sourceHashVerified: true,
        countriesParsed: countries.length,
        banksParsed: bankSourceRows.length,
        activeBanks: bankSourceRows.length - reviewRequiredBanks,
        reviewRequiredBanks,
        duplicateGroups,
        examplePaymentRowsImported: 0,
        dirtyCountryRowsImported: 0,
      },
      null,
      2,
    ) + "\n",
  );
  process.exit(0);
}

const supabaseUrl = normalizeSupabaseUrl(
  requiredEnvironment("NEXT_PUBLIC_SUPABASE_URL"),
);
const supabaseSecret = requiredEnvironment(
  "SUPABASE_SECRET_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
);
const db = createClient(supabaseUrl, supabaseSecret, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: template, error: templateError } = await db
  .from("payment_template_versions")
  .select("id,source_file_hash")
  .eq("template_code", TEMPLATE_CODE)
  .eq("version", TEMPLATE_VERSION)
  .single();
if (templateError) throw templateError;
if (template.source_file_hash !== sourceHash) {
  throw new Error("Database template version has an unexpected source hash");
}

await upsertInChunks(
  "country_currency_reference",
  countries.map((row) => ({
    ...row,
    template_version_id: template.id,
    status: "ACTIVE",
  })),
  "template_version_id,source_row_number",
);

const banks = bankSourceRows.map((row) => {
  const duplicateGroupKey = `${row.country_code}|${row.bank_code}`;
  const duplicate = (duplicateCounts.get(duplicateGroupKey) ?? 0) > 1;
  return {
    ...row,
    template_version_id: template.id,
    currency: currencyByCountry.get(row.country_code) ?? null,
    duplicate_group_key: duplicate ? duplicateGroupKey : null,
    status: duplicate ? "REVIEW_REQUIRED" : "ACTIVE",
  };
});
await upsertInChunks(
  "bank_reference",
  banks,
  "template_version_id,source_row_number",
);

const activeBanks = banks.filter((row) => row.status === "ACTIVE").length;
const reviewBanks = banks.length - activeBanks;

process.stdout.write(
  JSON.stringify(
    {
      ok: true,
      templateVersion: TEMPLATE_VERSION,
      sourceHashVerified: true,
      countriesImported: countries.length,
      banksImported: banks.length,
      activeBanks,
      reviewRequiredBanks: reviewBanks,
      duplicateGroups,
      examplePaymentRowsImported: 0,
      dirtyCountryRowsImported: 0,
    },
    null,
    2,
  ) + "\n",
);
