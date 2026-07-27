import Decimal from "decimal.js";

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export const SHADOW_RUN_DASHBOARD_RULES = Object.freeze({
  learningWindowDays: 90,
  timeZone: "Asia/Shanghai",
  modelMode: "DESCRIPTIVE_STATISTICS_ONLY",
  shadowMode: true,
  automaticOptimization: false,
  automaticPayment: false,
  automaticTopup: false,
  automaticQuoteChange: false,
  automaticTrading: false,
});

export const MARKET_CONTEXT_CATEGORIES = [
  "VND_POLICY",
  "INTERNATIONAL_GEOPOLITICS",
  "FED_EVENT",
  "BTC_VOLATILITY",
  "FX_ANOMALY",
  "PAYMENT_COMPANY_RISK",
] as const;

export type MarketContextCategory =
  (typeof MARKET_CONTEXT_CATEGORIES)[number];

export type MarketContextSeverity = "INFO" | "WARNING" | "HIGH";

export interface MarketContextNoteInput {
  clientRequestId: string;
  contextDate: string;
  observedAt: string;
  category: MarketContextCategory;
  severity: MarketContextSeverity;
  title: string;
  observationReason: string;
  evidenceReference: string | null;
  recordedBy: string;
}

export function calculateDecisionRates(input: {
  humanDecisionCount: number;
  acceptedCount: number;
  modifiedCount: number;
  rejectedCount: number;
}) {
  const total =
    input.acceptedCount + input.modifiedCount + input.rejectedCount;
  if (
    input.humanDecisionCount < 0 ||
    input.acceptedCount < 0 ||
    input.modifiedCount < 0 ||
    input.rejectedCount < 0 ||
    total !== input.humanDecisionCount
  ) {
    throw new Error("Decision counts must form a complete partition");
  }
  if (input.humanDecisionCount === 0) {
    return {
      acceptanceRate: null,
      modificationRate: null,
      rejectionRate: null,
    };
  }
  const denominator = new Decimal(input.humanDecisionCount);
  return {
    acceptanceRate: new Decimal(input.acceptedCount)
      .div(denominator)
      .toFixed(12),
    modificationRate: new Decimal(input.modifiedCount)
      .div(denominator)
      .toFixed(12),
    rejectionRate: new Decimal(input.rejectedCount)
      .div(denominator)
      .toFixed(12),
  };
}

export function fundingPressureImproved(
  beforeVnd: string | number | null,
  afterVnd: string | number | null,
) {
  if (beforeVnd === null || afterVnd === null) return null;
  const before = new Decimal(beforeVnd);
  const after = new Decimal(afterVnd);
  if (
    !before.isFinite() ||
    !after.isFinite() ||
    before.isNegative() ||
    after.isNegative()
  ) {
    throw new Error("Funding pressure must be a non-negative amount");
  }
  return after.lt(before);
}

export function buildMarketContextNoteRecord(
  input: MarketContextNoteInput,
) {
  const title = input.title.trim();
  const observationReason = input.observationReason.trim();
  const evidenceReference =
    input.evidenceReference?.trim() || null;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.contextDate)) {
    throw new Error("Context date must be YYYY-MM-DD");
  }
  if (Number.isNaN(Date.parse(input.observedAt))) {
    throw new Error("Observed time must be a valid timestamp");
  }
  if (
    !MARKET_CONTEXT_CATEGORIES.includes(input.category) ||
    !["INFO", "WARNING", "HIGH"].includes(input.severity)
  ) {
    throw new Error("Market context classification is invalid");
  }
  if (!title || title.length > 200) {
    throw new Error("Market context title is required");
  }
  if (!observationReason || observationReason.length > 2000) {
    throw new Error("Market context reason is required");
  }
  if (evidenceReference && evidenceReference.length > 1000) {
    throw new Error("Evidence reference is too long");
  }
  if (!input.clientRequestId || !input.recordedBy) {
    throw new Error("Market context identity is required");
  }

  return {
    client_request_id: input.clientRequestId,
    currency: "VND",
    context_date: input.contextDate,
    observed_at: input.observedAt,
    context_category: input.category,
    severity: input.severity,
    title,
    observation_reason: observationReason,
    evidence_reference: evidenceReference,
    recorded_by: input.recordedBy,
    shadow_mode: true,
    quote_impact_applied: false,
    automatic_action: false,
    automatic_payment: false,
    automatic_topup: false,
    automatic_quote_change: false,
    automatic_trading: false,
  } as const;
}

export function shanghaiDate(
  value: Date = new Date(),
  dayOffset = 0,
) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: SHADOW_RUN_DASHBOARD_RULES.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(
    new Date(value.getTime() + dayOffset * 24 * 60 * 60 * 1000),
  );
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}
