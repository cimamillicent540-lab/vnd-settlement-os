import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildDailyOperationSnapshotRecord,
  nextIsoDate,
  operatingDateFromAccountCutoff,
  SHADOW_OPERATION_VALIDATION_RULES,
  summarizeDailyAccountActivity,
} from "../lib/settlement-daily-report";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260727164000_vnd_shadow_operation_validation_v1.sql",
  ),
  "utf8",
);
const aggregationFix = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260727194500_fix_daily_account_activity_aggregation_v1.sql",
  ),
  "utf8",
);

describe("Task 2.11 daily settlement snapshot", () => {
  it("uses actual Account History changes for daily flows", () => {
    const result = summarizeDailyAccountActivity([
      {
        event_type: "PAYIN_INFLOW",
        gross_change_vnd: "992000",
        gross_signed_change_vnd: "992000",
      },
      {
        event_type: "PAYOUT_OUTFLOW",
        gross_change_vnd: "47473331.73",
        gross_signed_change_vnd: "-47473331.73",
      },
      {
        event_type: "INTERNAL_TRANSFER_CREDIT",
        gross_change_vnd: "100000",
        gross_signed_change_vnd: "100000",
      },
      {
        event_type: "INTERNAL_TRANSFER_DEBIT",
        gross_change_vnd: "100000",
        gross_signed_change_vnd: "-100000",
      },
    ]);
    expect(result).toEqual({
      todayPayinVnd: "992000.00",
      todayPayoutVnd: "47473331.73",
      netFundsChangeVnd: "-46481331.73",
    });
  });

  it("aggregates all Account History rows before Data API pagination", () => {
    expect(aggregationFix).toContain(
      "create or replace view public.settlement_daily_account_activity",
    );
    expect(aggregationFix).toContain(
      "sum(entry.gross_change_vnd) filter",
    );
    expect(aggregationFix).toContain(
      "sum(entry.gross_signed_change_vnd)",
    );
    expect(aggregationFix).toContain(
      "with (security_invoker = true)",
    );
  });

  it("derives the operating day from the Account History cutoff", () => {
    expect(
      operatingDateFromAccountCutoff("2026-07-18 23:59:28"),
    ).toBe("2026-07-18");
    expect(nextIsoDate("2026-07-18")).toBe("2026-07-19");
    expect(operatingDateFromAccountCutoff(null)).toBeNull();
  });

  it("saves Cash and Economic Profit together", () => {
    const record = buildDailyOperationSnapshotRecord({
      clientRequestId: "c41de550-532e-4e11-bf1c-6f8996c6a9b1",
      operatingDate: "2026-07-18",
      createdBy: "33e93690-6477-4db2-9eea-d6ed7ad3644d",
      sourceControlSnapshotId: null,
      sourceLearningRecommendationId: null,
      balances: {
        grossBalanceVnd: "3192438423",
        reserveBalanceVnd: "1596219211.50",
        settleableBalanceVnd: "1596219211.50",
      },
      activity: {
        todayPayinVnd: "1000000",
        todayPayoutVnd: "750000",
        netFundsChangeVnd: "250000",
      },
      pressure: {
        forecastPayoutVnd: "1000000",
        forecastPayinVnd: "200000",
        forecastNetDemandVnd: "800000",
        peakPressureVnd: "900000",
      },
      topup: {
        topupRecommended: false,
        settleableShortfallVnd: "0",
        recommendedTopupUsdt: null,
        recommendedTime: "NO_TOPUP",
        reasons: ["余额覆盖"],
        objectives: ["BALANCED"],
        requiredSettleableVnd: "990000",
        requiredGrossTopupVnd: "0",
      },
      profit: {
        cashProfitUsdt: "123.45",
        cashProfitMargin: "0.003",
        economicProfitUsdt: "150.25",
        economicProfitMargin: "0.004",
        snapshot: { dataStatus: "PARTIAL" },
      },
      merchantProfitContributions: [],
      fx: {
        xeRate: null,
        p2pCostRate: null,
        companyQuoteRate: null,
        spreadVndPerUsdt: null,
        spreadRatio: null,
        opportunityStatus: "WAITING_INPUT",
      },
      risks: [],
      learning90dSnapshot: {},
      decisionAccuracySnapshot: {},
      dataCutoffSnapshot: {},
      dataCompletenessStatus:
        "PARTIAL_AFTER_ACCOUNT_HISTORY_CUTOFF",
    });
    expect(record.cash_profit_usdt).toBe("123.450000000000");
    expect(record.economic_profit_usdt).toBe(
      "150.250000000000",
    );
    expect(record.profit_metrics_snapshot).toMatchObject({
      bothMetricsRequired: true,
    });
  });

  it("rejects an inconsistent gross/reserve/settleable snapshot", () => {
    expect(() =>
      buildDailyOperationSnapshotRecord({
        clientRequestId:
          "c41de550-532e-4e11-bf1c-6f8996c6a9b1",
        operatingDate: "2026-07-18",
        createdBy: "33e93690-6477-4db2-9eea-d6ed7ad3644d",
        sourceControlSnapshotId: null,
        sourceLearningRecommendationId: null,
        balances: {
          grossBalanceVnd: "100",
          reserveBalanceVnd: "50",
          settleableBalanceVnd: "49",
        },
        activity: {
          todayPayinVnd: "0",
          todayPayoutVnd: "0",
          netFundsChangeVnd: "0",
        },
        pressure: {
          forecastPayoutVnd: "0",
          forecastPayinVnd: "0",
          forecastNetDemandVnd: "0",
          peakPressureVnd: "0",
        },
        topup: {
          topupRecommended: false,
          settleableShortfallVnd: "0",
          recommendedTopupUsdt: null,
          recommendedTime: "NO_TOPUP",
          reasons: [],
          objectives: [],
          requiredSettleableVnd: "0",
          requiredGrossTopupVnd: "0",
        },
        profit: {
          cashProfitUsdt: "0",
          cashProfitMargin: null,
          economicProfitUsdt: "0",
          economicProfitMargin: null,
          snapshot: {},
        },
        merchantProfitContributions: [],
        fx: {
          xeRate: null,
          p2pCostRate: null,
          companyQuoteRate: null,
          spreadVndPerUsdt: null,
          spreadRatio: null,
          opportunityStatus: "WAITING_INPUT",
        },
        risks: [],
        learning90dSnapshot: {},
        decisionAccuracySnapshot: {},
        dataCutoffSnapshot: {},
        dataCompletenessStatus: "NO_ACCOUNT_HISTORY",
      }),
    ).toThrow(
      "Gross balance must equal reserve plus settleable balance",
    );
  });
});

describe("Task 2.11 persistence, accuracy and safety", () => {
  it("creates append-only snapshots and versioned outcomes", () => {
    expect(migration).toContain(
      "create table public.settlement_daily_operation_snapshots",
    );
    expect(migration).toContain(
      "create table public.settlement_decision_outcomes",
    );
    expect(migration).toContain(
      "supersedes_outcome_id uuid",
    );
    expect(migration).toContain("topup_adjustment_usdt");
    expect(migration).toContain("quote_adjustment");
    expect(migration).toContain(
      "settlement_decision_outcomes_immutable",
    );
    expect(migration).toContain("OUTCOME_REASON_REQUIRED");
  });

  it("tracks all four requested decision accuracy dimensions", () => {
    expect(migration).toContain("topup_accuracy_rate");
    expect(migration).toContain(
      "average_quote_absolute_deviation",
    );
    expect(migration).toContain(
      "average_cash_profit_absolute_error_usdt",
    );
    expect(migration).toContain(
      "average_economic_profit_absolute_error_usdt",
    );
    expect(migration).toContain("risk_alert_hit_rate");
    expect(migration).toContain(
      "90-day descriptive accuracy statistics only",
    );
  });

  it("uses RLS, explicit grants, audits and indexed foreign keys", () => {
    expect(migration).toContain(
      "alter table public.settlement_daily_operation_snapshots\n  enable row level security",
    );
    expect(migration).toContain(
      "alter table public.settlement_decision_outcomes\n  enable row level security",
    );
    expect(migration).toContain(
      "settlement_daily_operation_control_idx",
    );
    expect(migration).toContain(
      "settlement_decision_outcomes_decision_idx",
    );
    expect(migration).toContain(
      "audit_settlement_daily_operation_snapshots",
    );
    expect(migration).toContain(
      "to authenticated, service_role",
    );
    expect(migration).toContain("security_invoker = true");
  });

  it("cannot perform automated funds or pricing actions", () => {
    expect(SHADOW_OPERATION_VALIDATION_RULES).toMatchObject({
      shadowMode: true,
      automaticPayment: false,
      automaticTopup: false,
      automaticQuoteChange: false,
      automaticMarketDataCollection: false,
      automaticTrading: false,
    });
    expect(migration).not.toMatch(
      /net\.http|http_post|pg_net|submitted_to_upstream/i,
    );
    expect(migration).toContain(
      "check (system_execution_performed = false)",
    );
  });
});
