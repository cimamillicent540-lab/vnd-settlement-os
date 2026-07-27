import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  BUSINESS_RULES_FREEZE,
  BUSINESS_RULES_SHADOW_GUARD,
  humanDecisionReasonIsValid,
  isRecommendationForOperatingDate,
  vndOperatingDate,
} from "../lib/business-rules";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260727141613_vnd_business_rules_freeze_v1.sql",
  ),
  "utf8",
);
const learningRoute = readFileSync(
  resolve(process.cwd(), "app/api/settlement-learning/route.ts"),
  "utf8",
);

describe("VND business-rule freeze", () => {
  it("freezes the confirmed topup, quote and margin thresholds", () => {
    expect(BUSINESS_RULES_FREEZE.safetyBuffer).toBe("0.10");
    expect(BUSINESS_RULES_FREEZE.maximumInventoryUsdt).toBe(
      "50000",
    );
    expect(BUSINESS_RULES_FREEZE.referenceInventoryRate).toBe(
      "26500",
    );
    expect(BUSINESS_RULES_FREEZE.minimumMargin).toBe("0.002");
    expect(BUSINESS_RULES_FREEZE.targetMargin).toBe("0.005");
    expect(migration).toContain(
      "'TOPUP_PEAK_16_23_FORECAST'",
    );
    expect(migration).toContain(
      "'TOPUP_SAFETY_BUFFER_10_PERCENT'",
    );
    expect(migration).toContain(
      "'TOPUP_ABOVE_LIMIT_MANUAL_CONFIRMATION'",
    );
    expect(migration).toContain(
      "'QUOTE_P2P_MANUAL_COST_INPUT'",
    );
    expect(migration).toContain(
      "'QUOTE_MERCHANT_TIER'",
    );
  });

  it("structures all confirmed risk rules", () => {
    expect(migration).toContain(
      "'RISK_SETTLEABLE_INSUFFICIENT'",
    );
    expect(migration).toContain("'RISK_HIGH_VOLATILITY'");
    expect(migration).toContain("'RISK_P2P_INPUT_MISSING'");
    expect(migration).toContain(
      "'RISK_INTERNATIONAL_MARKET_HUMAN_FLAG'",
    );
  });

  it("keeps Stage 1 current and future stages unimplemented", () => {
    expect(BUSINESS_RULES_FREEZE.currentStage).toBe(
      "STAGE_1_HUMAN_REVIEW",
    );
    expect(migration).toContain(
      "'STAGE_2_HUMAN_REVIEW_CONDITIONAL_EXECUTION'",
    );
    expect(migration).toContain(
      '{"action":"FUTURE_CONDITIONAL_EXECUTION","implemented":false}',
    );
    expect(migration).toContain(
      '{"action":"FUTURE_FULL_AUTOMATION","implemented":false}',
    );
  });

  it("makes frozen rule versions immutable, audited and read-only", () => {
    expect(migration).toContain(
      "BUSINESS_RULES_ARE_FROZEN_CREATE_A_NEW_VERSION",
    );
    expect(migration).toContain(
      "before update or delete\non public.settlement_business_rules",
    );
    expect(migration).toContain(
      "audit_settlement_business_rules",
    );
    expect(migration).toContain("enable row level security");
    expect(migration).toContain(
      "FROZEN_RULE_TABLES_MUST_BE_READ_ONLY",
    );
  });
});

describe("Operator confirmation learning path", () => {
  it("uses UTC+8 operating dates", () => {
    expect(
      vndOperatingDate(new Date("2026-07-27T16:30:00Z")),
    ).toBe("2026-07-28");
    expect(
      isRecommendationForOperatingDate(
        "2026-07-27T16:30:00Z",
        "2026-07-28",
      ),
    ).toBe(true);
  });

  it("requires a reason for accept, modify and reject", () => {
    expect(humanDecisionReasonIsValid("")).toBe(false);
    expect(humanDecisionReasonIsValid("   ")).toBe(false);
    expect(humanDecisionReasonIsValid("人工确认资金充足")).toBe(true);
    expect(
      humanDecisionReasonIsValid("x".repeat(1001)),
    ).toBe(false);
  });

  it("writes confirmations into existing 90-day learning data", () => {
    expect(migration).toContain(
      "from public.settlement_learning_recommendations recommendation",
    );
    expect(migration).toContain(
      "left join public.settlement_learning_latest_decisions decision",
    );
    expect(migration).not.toMatch(
      /create table public\.(?:new_)?settlement_learning/i,
    );
    expect(learningRoute).toContain(
      '"BUSINESS_RULES_CONFIRMATION"',
    );
    expect(learningRoute).toContain(
      "buildSettlementLearningRecommendation",
    );
    expect(learningRoute).toContain(
      '"record_settlement_human_decision_v1"',
    );
  });

  it("cannot perform an automatic financial operation", () => {
    expect(BUSINESS_RULES_SHADOW_GUARD).toEqual({
      automaticPayment: false,
      automaticTopup: false,
      automaticQuoteChange: false,
      automaticTrading: false,
      actualExecutionPerformed: false,
    });
    expect(migration).not.toMatch(
      /net\.http|http_post|pg_net|submitted_to_upstream/i,
    );
    expect(migration).toContain(
      "automatic_topup boolean not null default false",
    );
    expect(migration).toContain(
      "automatic_quote_change boolean not null default false",
    );
  });
});
