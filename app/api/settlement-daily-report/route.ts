import { NextResponse } from "next/server";
import { z } from "zod";

import { authorizeInternalRequest } from "@/lib/api-auth";
import { buildDailyOperationSnapshotRecord } from "@/lib/settlement-daily-report";
import { getSettlementDailyReportData } from "@/lib/server-data";

const unsignedDecimal = z
  .string()
  .regex(/^\d+(\.\d{1,12})?$/)
  .nullable();
const signedDecimal = z
  .string()
  .regex(/^-?\d+(\.\d{1,12})?$/)
  .nullable();

const payloadSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("SAVE_DAILY_SNAPSHOT"),
    clientRequestId: z.string().uuid(),
  }),
  z.object({
    kind: z.literal("RECORD_DECISION_OUTCOME"),
    clientRequestId: z.string().uuid(),
    humanDecisionId: z.string().uuid(),
    measuredAt: z.string().datetime({ offset: true }),
    actualTopupUsdt: unsignedDecimal,
    actualQuoteRate: unsignedDecimal,
    actualCashProfitUsdt: signedDecimal,
    actualEconomicProfitUsdt: signedDecimal,
    actualRiskOutcomes: z
      .array(
        z.object({
          risk_code: z.string().trim().min(1).max(120),
          realized: z.boolean(),
          note: z.string().trim().max(1000),
        }),
      )
      .max(100),
    outcomeReason: z.string().trim().min(1).max(1000),
  }),
]);

export async function POST(request: Request) {
  const auth = await authorizeInternalRequest(request, [
    "admin",
    "settlement_operator",
    "approver",
  ]);
  if (!auth) {
    return NextResponse.json(
      { message: "需要结算操作员、审批人或管理员权限" },
      { status: 403 },
    );
  }

  const parsed = payloadSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      {
        message: "每日结算验证记录校验失败",
        details: parsed.error.flatten(),
      },
      { status: 400 },
    );
  }

  if (parsed.data.kind === "SAVE_DAILY_SNAPSHOT") {
    if (
      !auth.roles.some(
        (role) =>
          role === "admin" || role === "settlement_operator",
      )
    ) {
      return NextResponse.json(
        { message: "只有结算操作员或管理员可以保存日报快照" },
        { status: 403 },
      );
    }

    const report = await getSettlementDailyReportData();
    if (!report.operatingDate) {
      return NextResponse.json(
        { message: "缺少Account History截止日期，无法保存日报" },
        { status: 409 },
      );
    }
    const record = buildDailyOperationSnapshotRecord({
      clientRequestId: parsed.data.clientRequestId,
      operatingDate: report.operatingDate,
      createdBy: auth.userId,
      sourceControlSnapshotId: report.sourceControlSnapshotId,
      sourceLearningRecommendationId:
        report.current.sourceLearningRecommendationId,
      balances: report.current.balances,
      activity: report.activity,
      pressure: report.current.pressure,
      topup: report.current.topup,
      profit: report.profit,
      merchantProfitContributions:
        report.merchantProfitContributions,
      fx: report.current.fx,
      risks: report.current.risks,
      learning90dSnapshot:
        (report.current.learning90d as Record<string, unknown>) ??
        {},
      decisionAccuracySnapshot:
        (report.accuracy90d as Record<string, unknown>) ?? {},
      dataCutoffSnapshot: report.current.dataCutoffs,
      dataCompletenessStatus: report.dataCompletenessStatus,
    });
    const { data, error } = await auth.db
      .from("settlement_daily_operation_snapshots")
      .insert(record)
      .select(
        "id,operating_date,snapshot_time,cash_profit_usdt,economic_profit_usdt,topup_recommended,shadow_mode",
      )
      .single();

    if (error?.code === "23505") {
      const { data: existing, error: existingError } = await auth.db
        .from("settlement_daily_operation_snapshots")
        .select(
          "id,operating_date,snapshot_time,cash_profit_usdt,economic_profit_usdt,topup_recommended,shadow_mode",
        )
        .eq("client_request_id", parsed.data.clientRequestId)
        .single();
      if (!existingError && existing) {
        return NextResponse.json({
          ok: true,
          snapshot: existing,
          idempotentReplay: true,
          shadowMode: true,
          automaticAction: false,
        });
      }
    }
    if (error) {
      return NextResponse.json(
        { message: error.message },
        { status: 409 },
      );
    }
    return NextResponse.json({
      ok: true,
      snapshot: data,
      idempotentReplay: false,
      shadowMode: true,
      automaticAction: false,
    });
  }

  const { data, error } = await auth.db.rpc(
    "record_settlement_decision_outcome_v1",
    {
      p_client_request_id: parsed.data.clientRequestId,
      p_human_decision_id: parsed.data.humanDecisionId,
      p_measured_at: parsed.data.measuredAt,
      p_actual_topup_usdt: parsed.data.actualTopupUsdt,
      p_actual_quote_rate: parsed.data.actualQuoteRate,
      p_actual_cash_profit_usdt:
        parsed.data.actualCashProfitUsdt,
      p_actual_economic_profit_usdt:
        parsed.data.actualEconomicProfitUsdt,
      p_actual_risk_outcomes: parsed.data.actualRiskOutcomes,
      p_outcome_reason: parsed.data.outcomeReason,
      p_outcome_snapshot: {
        source: "HUMAN_OBSERVED_OUTCOME",
        descriptiveStatisticsOnly: true,
        automaticOptimization: false,
      },
      p_data_cutoff_snapshot: {
        recordedAt: new Date().toISOString(),
      },
    },
  );
  if (error?.code === "23505") {
    const { data: existing, error: existingError } = await auth.db
      .from("settlement_decision_outcomes")
      .select(
        "id,human_decision_id,outcome_version,measured_at,shadow_mode",
      )
      .eq("client_request_id", parsed.data.clientRequestId)
      .single();
    if (!existingError && existing) {
      return NextResponse.json({
        ok: true,
        outcome: existing,
        idempotentReplay: true,
        shadowMode: true,
        automaticAction: false,
      });
    }
  }
  if (error) {
    return NextResponse.json(
      { message: error.message },
      { status: 409 },
    );
  }

  return NextResponse.json({
    ok: true,
    outcome: Array.isArray(data) ? data[0] : data,
    idempotentReplay: false,
    shadowMode: true,
    automaticAction: false,
  });
}
