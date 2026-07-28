import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  HUMAN_APPROVAL_RULES,
  HUMAN_APPROVAL_SHADOW_GUARD,
  approvalActionIsValid,
  approvalReasonIsValid,
  buildApprovalRequestRows,
  calculateApprovalAdjustment,
} from "../lib/human-approval";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260728080122_vnd_human_approval_center_v1.sql",
  ),
  "utf8",
);
const hardeningMigration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260728081745_harden_human_approval_rpc_v1.sql",
  ),
  "utf8",
);
const page = readFileSync(
  resolve(process.cwd(), "app/approval-center/page.tsx"),
  "utf8",
);
const route = readFileSync(
  resolve(process.cwd(), "app/api/approval-center/route.ts"),
  "utf8",
);

const rows = buildApprovalRequestRows({
  batchId: "11111111-1111-4111-8111-111111111111",
  requestedBy: "22222222-2222-4222-8222-222222222222",
  operatingDate: "2026-07-28",
  recommendation: {
    id: "33333333-3333-4333-8333-333333333333",
    recommendationTime: "2026-07-28T03:00:00Z",
    recommendedTopupUsdt: "30000",
    recommendedQuoteRate: "26500",
    targetMargin: "0.005",
    riskAlerts: [
      {
        code: "SETTLEABLE_SHORTFALL",
        severity: "HIGH",
        message: "Settleable不足",
      },
    ],
    p2pCostRate: "26255",
    predictedCashProfitUsdt: "3567.03982060",
    predictedEconomicProfitUsdt: "3000.00000000",
    dataCutoffSnapshot: { status: "PARTIAL" },
  },
  topup: {
    recommendedTime: "BEFORE_16_00",
    reasons: ["覆盖16:00-23:00资金压力"],
    fundsRiskStatus: "WARNING",
  },
  merchants: [
    {
      merchantName: "Merchant A",
      currentQuoteRate: "26400",
      systemRecommendedQuoteRate: "26500",
      currentProfitMargin: "0.003",
      targetProfitMargin: "0.005",
      transactionVolumeUsdt: "100000",
      volumeLevel: "HIGH",
      riskLevel: "WARNING",
      recommendationReason: "提高至目标利润线",
    },
  ],
});

describe("Task 2.16 approval request model", () => {
  it("creates separate topup, quote and risk approval requests", () => {
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.request_type)).toEqual([
      "TOPUP",
      "QUOTE",
      "RISK",
    ]);
  });

  it("freezes topup quantity, estimated cost, coverage and risk", () => {
    expect(rows[0]).toMatchObject({
      ai_topup_usdt: "30000.00000000",
      estimated_topup_cost_vnd: "787650000.00",
      estimated_coverage_time: "BEFORE_16_00",
      ai_risk_level: "HIGH",
      shadow_mode: true,
      automatic_payment: false,
      automatic_topup: false,
      automatic_quote_change: false,
      automatic_trading: false,
    });
  });

  it("calculates quote profit impact without changing a quote", () => {
    expect(rows[1]).toMatchObject({
      merchant_name: "Merchant A",
      current_quote_rate: "26400.000000000000",
      ai_quote_rate: "26500.000000000000",
      predicted_profit_impact_usdt: "200.000000000000",
      predicted_profit_impact_ratio: "0.002000000000",
      merchant_tier: "HIGH",
    });
  });

  it("keeps Cash and Economic Profit as separate evidence", () => {
    for (const row of rows) {
      expect(row.predicted_cash_profit_usdt).toBe(
        "3567.039820600000",
      );
      expect(row.predicted_economic_profit_usdt).toBe(
        "3000.000000000000",
      );
    }
  });
});

describe("Task 2.16 human action validation", () => {
  it("uses distinct financial and risk actions", () => {
    expect(approvalActionIsValid("TOPUP", "ACCEPTED")).toBe(true);
    expect(approvalActionIsValid("QUOTE", "MODIFIED")).toBe(true);
    expect(approvalActionIsValid("RISK", "CONFIRMED")).toBe(true);
    expect(approvalActionIsValid("RISK", "ADJUSTED")).toBe(true);
    expect(approvalActionIsValid("TOPUP", "CONFIRMED")).toBe(false);
    expect(approvalActionIsValid("RISK", "REJECTED")).toBe(false);
  });

  it("requires a catalog reason and human detail", () => {
    expect(approvalReasonIsValid("RISK_CONTROL", "资金压力偏高")).toBe(
      true,
    );
    expect(approvalReasonIsValid("", "资金压力偏高")).toBe(false);
    expect(approvalReasonIsValid("RISK_CONTROL", "   ")).toBe(false);
    expect(
      approvalReasonIsValid("RISK_CONTROL", "x".repeat(1001)),
    ).toBe(false);
  });

  it("records amount and ratio adjustments", () => {
    expect(calculateApprovalAdjustment("50000", "30000")).toEqual({
      adjustmentAmount: "-20000.000000000000",
      adjustmentRatio: "-0.400000000000",
    });
  });
});

describe("Task 2.16 database, permissions and UI", () => {
  it("creates the three required immutable, versioned, audited tables", () => {
    expect(migration).toContain(
      "create table public.approval_requests",
    );
    expect(migration).toContain(
      "create table public.approval_actions",
    );
    expect(migration).toContain(
      "create table public.approval_reason_catalog",
    );
    expect(migration).toContain("approval_requests_immutable");
    expect(migration).toContain("approval_actions_immutable");
    expect(migration).toContain("supersedes_action_id");
    expect(migration).toContain("audit_approval_requests");
    expect(migration).toContain("audit_approval_actions");
    expect(migration).toContain("security_invoker = true");
  });

  it("limits access to admin and settlement_operator", () => {
    expect(HUMAN_APPROVAL_RULES.allowedRoles).toEqual([
      "admin",
      "settlement_operator",
    ]);
    expect(route).toContain('"admin"');
    expect(route).toContain('"settlement_operator"');
    expect(migration).not.toContain("'approver'::public.app_role");
  });

  it("uses caller-rights RPC with RLS and strict insert validation", () => {
    expect(hardeningMigration).toContain("security invoker");
    expect(hardeningMigration).toContain(
      "create policy approval_actions_insert",
    );
    expect(hardeningMigration).toContain(
      "approval_actions_validate_insert",
    );
    expect(hardeningMigration).toContain(
      "AI_APPROVAL_EVIDENCE_MUST_MATCH_REQUEST",
    );
    expect(hardeningMigration).not.toContain("security definer");
  });

  it("retains 90-day learning and explicit pending profit results", () => {
    expect(migration).toContain(
      "create or replace view public.approval_learning_90d",
    );
    expect(migration).toContain("learning_window_days = 90");
    expect(migration).toContain("'PENDING_OUTCOME'");
    expect(migration).toContain(
      "final_cash_profit_result_usdt",
    );
    expect(migration).toContain(
      "final_economic_profit_result_usdt",
    );
  });

  it("renders all approval modules and explicit Shadow Mode boundary", () => {
    expect(page).toContain("补U建议审批");
    expect(page).toContain("商户报价建议审批");
    expect(page).toContain("风险处理建议");
    expect(page).toContain("Cash Profit");
    expect(page).toContain("Economic Profit");
    expect(page).toContain("Shadow Mode");
    expect(route).toContain("actualExecutionPerformed: false");
    expect(HUMAN_APPROVAL_SHADOW_GUARD).toEqual({
      shadowMode: true,
      automaticPayment: false,
      automaticTopup: false,
      automaticQuoteChange: false,
      automaticTrading: false,
      actualExecutionPerformed: false,
    });
  });
});
