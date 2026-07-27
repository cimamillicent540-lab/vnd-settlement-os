export const BUSINESS_RULES_FREEZE = Object.freeze({
  ruleSetCode: "VND_BUSINESS_RULES_FREEZE_V2",
  version: 2,
  currentStage: "STAGE_1_HUMAN_REVIEW",
  safetyBuffer: "0.10",
  maximumInventoryUsdt: "50000",
  referenceInventoryRate: "26500",
  minimumMargin: "0.002",
  targetMargin: "0.005",
  operatingTimezone: "Asia/Shanghai",
});

export const BUSINESS_RULES_SHADOW_GUARD = Object.freeze({
  automaticPayment: false,
  automaticTopup: false,
  automaticQuoteChange: false,
  automaticTrading: false,
  actualExecutionPerformed: false,
});

export function vndOperatingDate(at: Date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_RULES_FREEZE.operatingTimezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

export function isRecommendationForOperatingDate(
  recommendationTime: string,
  operatingDate: string,
) {
  return vndOperatingDate(new Date(recommendationTime)) === operatingDate;
}

export function humanDecisionReasonIsValid(reason: string) {
  return reason.trim().length > 0 && reason.trim().length <= 1000;
}
