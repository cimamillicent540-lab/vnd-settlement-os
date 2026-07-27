import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildMarketContextNoteRecord,
  calculateDecisionRates,
  fundingPressureImproved,
  SHADOW_RUN_DASHBOARD_RULES,
} from "../lib/shadow-run-dashboard";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260727114957_vnd_shadow_run_dashboard_v1.sql",
  ),
  "utf8",
);
const page = readFileSync(
  resolve(process.cwd(), "app/shadow-run-dashboard/page.tsx"),
  "utf8",
);
const dailyOutcomeRoute = readFileSync(
  resolve(
    process.cwd(),
    "app/api/settlement-daily-report/route.ts",
  ),
  "utf8",
);

describe("Task 2.12 daily Shadow Run metrics", () => {
  it("calculates acceptance, modification and rejection rates", () => {
    expect(
      calculateDecisionRates({
        humanDecisionCount: 10,
        acceptedCount: 6,
        modifiedCount: 3,
        rejectedCount: 1,
      }),
    ).toEqual({
      acceptanceRate: "0.600000000000",
      modificationRate: "0.300000000000",
      rejectionRate: "0.100000000000",
    });
    expect(() =>
      calculateDecisionRates({
        humanDecisionCount: 10,
        acceptedCount: 6,
        modifiedCount: 3,
        rejectedCount: 2,
      }),
    ).toThrow("complete partition");
  });

  it("derives daily counts without duplicating the learning system", () => {
    expect(migration).toContain(
      "create or replace view public.shadow_run_daily_metrics",
    );
    expect(migration).toContain(
      "from public.settlement_learning_recommendations recommendation",
    );
    expect(migration).toContain(
      "from public.settlement_human_decisions decision",
    );
    expect(migration).not.toMatch(
      /create table public\.shadow_run_(?:learning|recommendations|human_decisions)/i,
    );
    expect(page).toContain("Acceptance Rate");
    expect(page).toContain("Modification Rate");
    expect(page).toContain("Rejection Rate");
  });
});

describe("Task 2.12 comparisons and accuracy", () => {
  it("compares topup, quote and risk suggestions with human results", () => {
    expect(migration).toContain("'TOPUP'::text");
    expect(migration).toContain("'QUOTE'::text");
    expect(migration).toContain("'RISK_ALERT'::text");
    expect(migration).toContain("system_suggested_value");
    expect(migration).toContain("human_final_value");
    expect(migration).toContain("adjustment_reason");
  });

  it("measures topup pressure improvement and all accuracy dimensions", () => {
    expect(fundingPressureImproved("1000000", "750000")).toBe(
      true,
    );
    expect(fundingPressureImproved("1000000", "1250000")).toBe(
      false,
    );
    expect(migration).toContain(
      "topup_pressure_improvement_rate",
    );
    expect(migration).toContain(
      "average_quote_absolute_deviation",
    );
    expect(migration).toContain(
      "average_economic_profit_absolute_error_usdt",
    );
    expect(migration).toContain("risk_alert_hit_rate");
    expect(dailyOutcomeRoute).toContain(
      "fundingPressureBeforeVnd",
    );
    expect(dailyOutcomeRoute).toContain(
      "fundingPressureAfterVnd",
    );
  });

  it("auto-derives the daily review and preserves learning reasons", () => {
    expect(migration).toContain(
      "create or replace view public.shadow_run_daily_reviews",
    );
    expect(migration).toContain("system_major_suggestions");
    expect(migration).toContain("human_major_adjustments");
    expect(migration).toContain("biggest_difference_reason");
    expect(migration).toContain("learning_records");
    expect(migration).toContain("true as auto_generated");
  });
});

describe("Task 2.12 market context and safety", () => {
  it("builds a human-only immutable market context note", () => {
    const record = buildMarketContextNoteRecord({
      clientRequestId: "11111111-1111-4111-8111-111111111111",
      contextDate: "2026-07-27",
      observedAt: "2026-07-27T10:00:00Z",
      category: "FX_ANOMALY",
      severity: "WARNING",
      title: " VND价差扩大 ",
      observationReason: " 人工观察到P2P与XE价差扩大 ",
      evidenceReference: " internal-note-27 ",
      recordedBy: "22222222-2222-4222-8222-222222222222",
    });
    expect(record).toMatchObject({
      currency: "VND",
      title: "VND价差扩大",
      observation_reason: "人工观察到P2P与XE价差扩大",
      evidence_reference: "internal-note-27",
      shadow_mode: true,
      quote_impact_applied: false,
      automatic_action: false,
    });
  });

  it("uses RLS, audit, immutable records and indexed access", () => {
    expect(migration).toContain(
      "alter table public.shadow_run_market_context_notes\n  enable row level security",
    );
    expect(migration).toContain(
      "shadow_run_market_context_notes_immutable",
    );
    expect(migration).toContain(
      "audit_shadow_run_market_context_notes",
    );
    expect(migration).toContain(
      "shadow_run_market_notes_recorded_by_idx",
    );
    expect(migration).toContain("security_invoker = true");
    expect(migration).toContain(
      "SHADOW_RUN_MARKET_NOTES_MUST_NOT_HAVE_MUTATION_POLICIES",
    );
  });

  it("cannot optimize or perform a financial action", () => {
    expect(SHADOW_RUN_DASHBOARD_RULES).toMatchObject({
      shadowMode: true,
      automaticOptimization: false,
      automaticPayment: false,
      automaticTopup: false,
      automaticQuoteChange: false,
      automaticTrading: false,
    });
    expect(migration).not.toMatch(
      /net\.http|http_post|pg_net|submitted_to_upstream/i,
    );
    expect(migration).toContain("false as automatic_optimization");
    expect(migration).toContain(
      "quote_impact_applied = false",
    );
  });
});
