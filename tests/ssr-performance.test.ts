import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  loadSsrPageData,
  SSR_PAGE_BUDGET_MS,
  SSR_QUERY_PLAN,
  SUPABASE_REQUEST_BUDGET_MS,
  SsrPageBudgetExceededError,
} from "../lib/ssr-performance";

const root = process.cwd();
const serverData = readFileSync(
  resolve(root, "lib/server-data.ts"),
  "utf8",
);
const targetPages = [
  "app/settlement-intelligence/page.tsx",
  "app/settlement-learning/page.tsx",
  "app/approval-center/page.tsx",
  "app/settlement-daily-report/page.tsx",
].map((file) => readFileSync(resolve(root, file), "utf8"));

describe("Task 2.18 SSR query plan", () => {
  it("keeps the page and individual Supabase budgets bounded", () => {
    expect(SUPABASE_REQUEST_BUDGET_MS).toBeLessThan(
      SSR_PAGE_BUDGET_MS,
    );
    expect(SSR_PAGE_BUDGET_MS).toBeLessThanOrEqual(12_000);
  });

  it("reduces Approval Center from the full control-center fanout", () => {
    const approvalLoader = serverData.slice(
      serverData.indexOf(
        "export async function getHumanApprovalCenterData",
      ),
    );
    expect(SSR_QUERY_PLAN.approvalCenter).toEqual({
      plannedQueries: 4,
      dependencyWaves: 2,
    });
    expect(approvalLoader).not.toContain(
      "getSettlementControlCenterData()",
    );
    expect(approvalLoader).toContain(
      'from("settlement_learning_recommendations")',
    );
  });

  it("starts date-independent daily queries before awaiting control data", () => {
    const dailyStart = serverData.indexOf(
      "export async function getSettlementDailyReportData",
    );
    const dailyEnd = serverData.indexOf(
      "export async function getBusinessRulesFreezeData",
    );
    const dailyLoader = serverData.slice(dailyStart, dailyEnd);
    expect(dailyLoader.indexOf("const accuracyQuery")).toBeLessThan(
      dailyLoader.indexOf("await controlPromise"),
    );
    expect(dailyLoader.indexOf("const validationQueueQuery")).toBeLessThan(
      dailyLoader.indexOf("await controlPromise"),
    );
    expect(dailyLoader.indexOf("const savedReportsQuery")).toBeLessThan(
      dailyLoader.indexOf("await controlPromise"),
    );
  });

  it("gives every target page a read-only HTTP-200 fallback path", () => {
    for (const page of targetPages) {
      expect(page).toContain("loadSsrPageData");
      expect(page).toContain("SsrDataFallback");
      expect(page).toContain("classifyServerDataFailure");
    }
  });
});

describe("Task 2.18 SSR deadline", () => {
  it("returns data completed inside the budget", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    await expect(
      loadSsrPageData({
        page: "/fast",
        plannedQueries: 1,
        loader: async () => "ready",
        budgetMs: 50,
      }),
    ).resolves.toBe("ready");
    expect(info).toHaveBeenCalledWith(
      "ssr_data_load",
      expect.objectContaining({ outcome: "READY" }),
    );
    info.mockRestore();
  });

  it("degrades instead of waiting indefinitely", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    await expect(
      loadSsrPageData({
        page: "/slow",
        plannedQueries: 1,
        loader: () => new Promise(() => {}),
        budgetMs: 5,
      }),
    ).rejects.toBeInstanceOf(SsrPageBudgetExceededError);
    expect(info).toHaveBeenCalledWith(
      "ssr_data_load",
      expect.objectContaining({ outcome: "DEGRADED_TIMEOUT" }),
    );
    info.mockRestore();
  });
});
