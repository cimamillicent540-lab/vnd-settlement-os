import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { z } from "zod";

import { authorizeInternalRequest } from "@/lib/api-auth";
import {
  buildDayDecisionSnapshotRecord,
  buildEndReviewRecord,
  buildRiskCheckRecord,
  DAILY_OPERATION_REASON_CATEGORIES,
} from "@/lib/daily-operation";
import { buildSettlementLearningRecommendation } from "@/lib/settlement-learning";
import { getDailyOperationData } from "@/lib/server-data";
import { shanghaiDate } from "@/lib/shadow-run-dashboard";

const unsignedDecimal = z
  .string()
  .regex(/^\d+(\.\d{1,12})?$/)
  .nullable();
const positiveRate = z
  .string()
  .regex(/^\d+(\.\d{1,12})?$/)
  .refine((value) => Number(value) > 0, "汇率必须大于0");

const riskFeedbackSchema = z
  .array(
    z.object({
      risk_code: z.string().trim().min(1).max(120),
      human_judgment: z.enum(["CONFIRMED", "IGNORED"]),
      human_note: z.string().trim().max(1000),
    }),
  )
  .max(100);

const payloadSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("SAVE_DAY_DECISION"),
    clientRequestId: z.string().uuid(),
    binanceP2pRate: positiveRate,
    upstreamQuoteRate: positiveRate,
    xeRate: positiveRate,
  }),
  z.object({
    kind: z.literal("SAVE_RISK_CHECK"),
    clientRequestId: z.string().uuid(),
    dayDecisionSnapshotId: z.string().uuid(),
  }),
  z.object({
    kind: z.literal("SAVE_END_REVIEW"),
    clientRequestId: z.string().uuid(),
    decisionClientRequestId: z.string().uuid(),
    outcomeClientRequestId: z.string().uuid(),
    dayDecisionSnapshotId: z.string().uuid(),
    riskCheckId: z.string().uuid(),
    acceptanceStatus: z.enum([
      "ACCEPTED",
      "MODIFIED",
      "REJECTED",
    ]),
    finalTopupUsdt: unsignedDecimal,
    finalQuoteRate: unsignedDecimal,
    finalExecutionDecision: z.enum([
      "ACCEPT_FOR_MANUAL_EXECUTION",
      "DO_NOT_EXECUTE",
      "DEFER",
      "NOT_APPLICABLE",
    ]),
    adjustmentReasonCategory: z.enum(
      DAILY_OPERATION_REASON_CATEGORIES,
    ),
    adjustmentReason: z.string().trim().min(1).max(1000),
    riskFeedback: riskFeedbackSchema,
  }),
]);

type Db = SupabaseClient;

const recommendationSelection =
  "id,currency,recommendation_time,system_topup_recommended,system_recommended_topup_usdt,system_required_gross_topup_vnd,system_recommended_quote_rate,system_target_margin,system_risk_alerts,system_cash_profit_usdt,system_economic_profit_usdt,system_fx_judgment,system_payload,data_cutoff_snapshot,model_version,shadow_mode";

async function insertRecommendation(
  db: Db,
  record: Record<string, unknown>,
  clientRequestId: string,
) {
  const inserted = await db
    .from("settlement_learning_recommendations")
    .insert(record)
    .select(recommendationSelection)
    .single();
  if (inserted.error?.code !== "23505") return inserted;
  return db
    .from("settlement_learning_recommendations")
    .select(recommendationSelection)
    .eq("client_request_id", clientRequestId)
    .single();
}

async function existingByClientRequest(
  db: Db,
  table: string,
  clientRequestId: string,
  selection: string,
) {
  const response = await db
    .from(table)
    .select(selection)
    .eq("client_request_id", clientRequestId)
    .single();
  return {
    data: response.data as Record<string, unknown> | null,
    error: response.error,
  };
}

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
        message: "每日结算工作流记录校验失败",
        details: parsed.error.flatten(),
      },
      { status: 400 },
    );
  }

  const data = parsed.data;
  if (
    data.kind !== "SAVE_END_REVIEW" &&
    !auth.roles.some(
      (role) =>
        role === "admin" || role === "settlement_operator",
    )
  ) {
    return NextResponse.json(
      { message: "11:00和16:00节点仅限结算操作员或管理员" },
      { status: 403 },
    );
  }

  if (data.kind === "SAVE_DAY_DECISION") {
    const capturedAt = new Date();
    const operatingDate = shanghaiDate(capturedAt);
    const workflow = await getDailyOperationData();
    const current = workflow.current;
    const draft = buildDayDecisionSnapshotRecord({
      clientRequestId: data.clientRequestId,
      operatingDate,
      capturedAt,
      createdBy: auth.userId,
      sourceLearningRecommendationId:
        "00000000-0000-0000-0000-000000000000",
      sourceControlSnapshotId:
        workflow.report.sourceControlSnapshotId,
      balances: current.balances,
      forecast: {
        payinVnd: current.pressure.forecastPayinVnd,
        payoutVnd: current.pressure.forecastPayoutVnd,
        netDemandVnd: current.pressure.forecastNetDemandVnd,
        peakPressureVnd: current.pressure.peakPressureVnd,
      },
      recommendedCoverageTime: current.topup.recommendedTime,
      sourceTopupReasons: current.topup.reasons,
      manualFx: {
        binanceP2pRate: data.binanceP2pRate,
        upstreamQuoteRate: data.upstreamQuoteRate,
        xeRate: data.xeRate,
      },
      dataCutoffSnapshot: current.dataCutoffs,
    });
    const recommendation =
      buildSettlementLearningRecommendation({
        clientRequestId: data.clientRequestId,
        currency: "VND",
        generatedBy: auth.userId,
        topupRecommended: draft.topup_recommended,
        recommendedTopupUsdt: draft.recommended_topup_usdt,
        requiredGrossTopupVnd:
          draft.required_gross_topup_vnd,
        recommendedQuoteRate: current.fx.companyQuoteRate,
        targetMargin: current.targetMargin,
        riskAlerts: current.risks,
        expectedProfitUsdt:
          current.profitForecast?.expectedProfitUsdt ?? null,
        expectedProfitMargin:
          current.profitForecast?.expectedProfitMargin ?? null,
        cashProfitUsdt:
          current.profitForecast?.cashProfitUsdt ?? null,
        cashProfitMargin:
          current.profitForecast?.cashProfitMargin ?? null,
        economicProfitUsdt:
          current.profitForecast?.economicProfitUsdt ?? null,
        economicProfitMargin:
          current.profitForecast?.economicProfitMargin ?? null,
        profitMetricsSnapshot:
          current.profitForecast?.profitMetricsSnapshot ?? {
            dataStatus: "NOT_CALCULABLE",
            bothMetricsRequired: true,
          },
        fxJudgment:
          draft.fx_opportunity_status === "ARBITRAGE_SPACE"
            ? "BUY_VND_OPPORTUNITY"
            : draft.fx_opportunity_status,
        xeRate: draft.xe_rate,
        p2pCostRate: draft.binance_p2p_rate,
        fxSpreadRatio: draft.fx_opportunity_spread_ratio,
        systemPayload: {
          source: "DAILY_OPERATION_11_00",
          checkpoint: "DAY_DECISION_11_00",
          workflowDayDecisionDraft: draft,
          quoteRecommendation: {
            recommendedQuoteRate: current.fx.companyQuoteRate,
            targetMargin: current.targetMargin,
          },
          riskAlerts: current.risks,
          profitForecast: current.profitForecast,
        },
        dataCutoffSnapshot: current.dataCutoffs,
      });
    const recommendationResult = await insertRecommendation(
      auth.db,
      recommendation,
      data.clientRequestId,
    );
    if (recommendationResult.error || !recommendationResult.data) {
      return NextResponse.json(
        {
          message:
            recommendationResult.error?.message ??
            "11:00系统建议保存失败",
        },
        { status: 409 },
      );
    }

    const record = {
      ...draft,
      source_learning_recommendation_id:
        recommendationResult.data.id,
    };
    const selection =
      "id,operating_date,checkpoint_type,captured_at,capture_status,source_learning_recommendation_id,gross_balance_vnd,settleable_balance_vnd,reserve_balance_vnd,available_funds_ratio,forecast_payin_vnd,forecast_payout_vnd,forecast_net_demand_vnd,peak_16_23_pressure_vnd,projected_shortfall_vnd,required_gross_topup_vnd,topup_recommended,recommended_topup_usdt,recommended_coverage_time,binance_p2p_rate,upstream_quote_rate,xe_rate,fx_opportunity_status,arbitrage_space_exists,shadow_mode";
    const inserted = await auth.db
      .from("daily_operation_decision_snapshots")
      .insert(record)
      .select(selection)
      .single();
    let resultData: Record<string, unknown> | null =
      inserted.data;
    let resultError = inserted.error;
    let idempotentReplay = false;
    if (resultError?.code === "23505") {
      const existing = await existingByClientRequest(
        auth.db,
        "daily_operation_decision_snapshots",
        data.clientRequestId,
        selection,
      );
      resultData = existing.data;
      resultError = existing.error;
      idempotentReplay = true;
    }
    if (resultError) {
      return NextResponse.json(
        { message: resultError.message },
        { status: 409 },
      );
    }
    return NextResponse.json({
      ok: true,
      snapshot: resultData,
      idempotentReplay,
      shadowMode: true,
      automaticAction: false,
    });
  }

  if (data.kind === "SAVE_RISK_CHECK") {
    const capturedAt = new Date();
    const operatingDate = shanghaiDate(capturedAt);
    const workflow = await getDailyOperationData();
    const dayDecision = workflow.dayDecisions.find(
      (snapshot) =>
        snapshot.id === data.dayDecisionSnapshotId,
    );
    if (
      !dayDecision ||
      dayDecision.operating_date !== operatingDate
    ) {
      return NextResponse.json(
        { message: "必须先保存同一运营日的11:00决策快照" },
        { status: 409 },
      );
    }
    const current = workflow.current;
    const record = buildRiskCheckRecord({
      clientRequestId: data.clientRequestId,
      operatingDate,
      capturedAt,
      createdBy: auth.userId,
      dayDecisionSnapshotId: dayDecision.id,
      settleableBalanceVnd:
        current.balances.settleableBalanceVnd,
      projectedShortfallVnd:
        dayDecision.projected_shortfall_vnd,
      maximumHourlyPayoutConcentration:
        current.pressure.maximumHourlyPayoutConcentration,
      economicProfitMargin:
        workflow.report.profit.economicProfitMargin ??
        current.profitForecast?.economicProfitMargin ??
        null,
      fxSpreadRatio: dayDecision.fx_opportunity_spread_ratio,
      systemRiskAlerts: current.risks,
      internationalMarketNotes: workflow.marketNotes.map(
        (note) => ({
          id: note.id,
          category: note.context_category,
          severity: note.severity,
          title: note.title,
          reason: note.observation_reason,
        }),
      ),
      dataCutoffSnapshot: current.dataCutoffs,
    });
    const selection =
      "id,operating_date,checkpoint_type,captured_at,capture_status,day_decision_snapshot_id,settleable_balance_vnd,projected_shortfall_vnd,payout_concentration_risk,settleable_insufficient_risk,profit_below_0_2_percent_risk,fx_anomaly_risk,international_market_risk,risk_score,risk_level,risk_alerts,international_market_notes,shadow_mode";
    const inserted = await auth.db
      .from("daily_operation_risk_checks")
      .insert(record)
      .select(selection)
      .single();
    let resultData: Record<string, unknown> | null =
      inserted.data;
    let resultError = inserted.error;
    let idempotentReplay = false;
    if (resultError?.code === "23505") {
      const existing = await existingByClientRequest(
        auth.db,
        "daily_operation_risk_checks",
        data.clientRequestId,
        selection,
      );
      resultData = existing.data;
      resultError = existing.error;
      idempotentReplay = true;
    }
    if (resultError) {
      return NextResponse.json(
        { message: resultError.message },
        { status: 409 },
      );
    }
    return NextResponse.json({
      ok: true,
      riskCheck: resultData,
      idempotentReplay,
      shadowMode: true,
      automaticAction: false,
    });
  }

  const capturedAt = new Date();
  const operatingDate = shanghaiDate(capturedAt);
  const workflow = await getDailyOperationData();
  const dayDecision = workflow.dayDecisions.find(
    (snapshot) =>
      snapshot.id === data.dayDecisionSnapshotId,
  );
  const riskCheck = workflow.riskChecks.find(
    (check) => check.id === data.riskCheckId,
  );
  if (
    !dayDecision ||
    !riskCheck ||
    dayDecision.operating_date !== operatingDate ||
    riskCheck.operating_date !== operatingDate ||
    riskCheck.day_decision_snapshot_id !== dayDecision.id
  ) {
    return NextResponse.json(
      { message: "23:00复盘需要同一运营日完整的11:00和16:00节点" },
      { status: 409 },
    );
  }

  const { data: recommendation, error: recommendationError } =
    await auth.db
      .from("settlement_learning_recommendations")
      .select(recommendationSelection)
      .eq("id", dayDecision.source_learning_recommendation_id)
      .single();
  if (recommendationError || !recommendation) {
    return NextResponse.json(
      {
        message:
          recommendationError?.message ?? "系统原建议不存在",
      },
      { status: 409 },
    );
  }
  const systemRisks = Array.isArray(
    recommendation.system_risk_alerts,
  )
    ? recommendation.system_risk_alerts
    : [];
  const requiredRiskCodes = new Set(
    systemRisks.map((risk) => String(risk.code)),
  );
  const receivedRiskCodes = new Set(
    data.riskFeedback.map((risk) => risk.risk_code),
  );
  if (
    requiredRiskCodes.size !== receivedRiskCodes.size ||
    [...requiredRiskCodes].some(
      (code) => !receivedRiskCodes.has(code),
    )
  ) {
    return NextResponse.json(
      { message: "必须逐条确认或忽略系统风险建议" },
      { status: 400 },
    );
  }

  const decisionResult = await auth.db.rpc(
    "record_settlement_human_decision_v2",
    {
      p_client_request_id: data.decisionClientRequestId,
      p_recommendation_id: recommendation.id,
      p_decision_scope: "FULL_REVIEW",
      p_acceptance_status: data.acceptanceStatus,
      p_final_topup_usdt: data.finalTopupUsdt,
      p_final_quote_rate: data.finalQuoteRate,
      p_final_execution_decision:
        data.finalExecutionDecision,
      p_adjustment_reason_category:
        data.adjustmentReasonCategory,
      p_adjustment_reason: data.adjustmentReason,
      p_merchant_name: null,
      p_transaction_volume_usdt: null,
      p_profit_contribution_usdt:
        workflow.report.profit.economicProfitUsdt,
      p_risk_feedback: data.riskFeedback,
    },
  );
  if (decisionResult.error) {
    return NextResponse.json(
      { message: decisionResult.error.message },
      { status: 409 },
    );
  }
  const decision = Array.isArray(decisionResult.data)
    ? decisionResult.data[0]
    : decisionResult.data;
  if (!decision) {
    return NextResponse.json(
      { message: "人工决策未返回记录" },
      { status: 409 },
    );
  }

  const actualRiskOutcomes = data.riskFeedback.map(
    (risk) => ({
      risk_code: risk.risk_code,
      realized: risk.human_judgment === "CONFIRMED",
      note: risk.human_note,
    }),
  );
  const outcomeResult = await auth.db.rpc(
    "record_settlement_decision_outcome_v1",
    {
      p_client_request_id: data.outcomeClientRequestId,
      p_human_decision_id: decision.decision_id,
      p_measured_at: capturedAt.toISOString(),
      p_actual_topup_usdt: null,
      p_actual_quote_rate: null,
      p_actual_cash_profit_usdt:
        workflow.report.profit.cashProfitUsdt,
      p_actual_economic_profit_usdt:
        workflow.report.profit.economicProfitUsdt,
      p_actual_risk_outcomes: actualRiskOutcomes,
      p_outcome_reason: data.adjustmentReason,
      p_outcome_snapshot: {
        source: "DAILY_OPERATION_23_00",
        finalProfitDataStatus:
          workflow.report.profit.dataStatus,
        descriptiveStatisticsOnly: true,
        automaticOptimization: false,
      },
      p_data_cutoff_snapshot: workflow.current.dataCutoffs,
    },
  );
  let outcome = Array.isArray(outcomeResult.data)
    ? outcomeResult.data[0]
    : outcomeResult.data;
  let outcomeError = outcomeResult.error;
  if (outcomeResult.error?.code === "23505") {
    const existingOutcome = await existingByClientRequest(
      auth.db,
      "settlement_decision_outcomes",
      data.outcomeClientRequestId,
      "id,outcome_version",
    );
    if (existingOutcome.error || !existingOutcome.data) {
      return NextResponse.json(
        {
          message:
            existingOutcome.error?.message ??
            "日终后验结果幂等读取失败",
        },
        { status: 409 },
      );
    }
    outcomeError = null;
    outcome = {
      outcome_id: existingOutcome.data.id,
      outcome_version: existingOutcome.data.outcome_version,
      idempotent_replay: true,
    };
  }
  if (outcomeError || !outcome) {
    return NextResponse.json(
      {
        message:
          outcomeError?.message ?? "日终后验结果保存失败",
      },
      { status: 409 },
    );
  }

  const finalDecisionSnapshot = {
    acceptanceStatus: data.acceptanceStatus,
    finalTopupUsdt: data.finalTopupUsdt,
    finalQuoteRate: data.finalQuoteRate,
    finalExecutionDecision: data.finalExecutionDecision,
    adjustmentReasonCategory:
      data.adjustmentReasonCategory,
    adjustmentReason: data.adjustmentReason,
    riskFeedback: data.riskFeedback,
    actualExecutionPerformed: false,
  };
  const endReview = buildEndReviewRecord({
    clientRequestId: data.clientRequestId,
    operatingDate,
    capturedAt,
    createdBy: auth.userId,
    dayDecisionSnapshotId: dayDecision.id,
    riskCheckId: riskCheck.id,
    sourceDailyReportSnapshotId:
      workflow.report.latestSavedReport?.id ?? null,
    sourceLearningRecommendationId: recommendation.id,
    humanDecisionId: decision.decision_id,
    reasonClassificationId: decision.reason_classification_id,
    decisionOutcomeId: outcome.outcome_id,
    cashProfitUsdt: workflow.report.profit.cashProfitUsdt,
    economicProfitUsdt:
      workflow.report.profit.economicProfitUsdt,
    systemRecommendationsSnapshot: {
      topupRecommended:
        recommendation.system_topup_recommended,
      recommendedTopupUsdt:
        recommendation.system_recommended_topup_usdt,
      recommendedQuoteRate:
        recommendation.system_recommended_quote_rate,
      riskAlerts: recommendation.system_risk_alerts,
      cashProfitForecastUsdt:
        recommendation.system_cash_profit_usdt,
      economicProfitForecastUsdt:
        recommendation.system_economic_profit_usdt,
    },
    humanFinalDecisionSnapshot: finalDecisionSnapshot,
    acceptanceStatus: data.acceptanceStatus,
    reasonCategory: data.adjustmentReasonCategory,
    adjustmentReason: data.adjustmentReason,
    finalTopupUsdt: data.finalTopupUsdt,
    finalQuoteRate: data.finalQuoteRate,
    finalExecutionDecision:
      data.finalExecutionDecision,
    riskFeedbackSnapshot: data.riskFeedback,
    dataCutoffSnapshot: workflow.current.dataCutoffs,
  });
  const endSelection =
    "id,operating_date,checkpoint_type,captured_at,capture_status,day_decision_snapshot_id,risk_check_id,source_learning_recommendation_id,human_decision_id,reason_classification_id,decision_outcome_id,cash_profit_usdt,economic_profit_usdt,acceptance_status,adjustment_reason_category,adjustment_reason,final_topup_usdt,final_quote_rate,final_execution_decision,learning_window_days,shadow_mode,actual_execution_performed";
  const insertedEnd = await auth.db
    .from("daily_operation_end_reviews")
    .insert(endReview)
    .select(endSelection)
    .single();
  let endData: Record<string, unknown> | null =
    insertedEnd.data;
  let endError = insertedEnd.error;
  let idempotentReplay = false;
  if (endError?.code === "23505") {
    const existingEnd = await existingByClientRequest(
      auth.db,
      "daily_operation_end_reviews",
      data.clientRequestId,
      endSelection,
    );
    endData = existingEnd.data;
    endError = existingEnd.error;
    idempotentReplay = true;
  }
  if (endError) {
    return NextResponse.json(
      { message: endError.message },
      { status: 409 },
    );
  }
  return NextResponse.json({
    ok: true,
    endReview: endData,
    idempotentReplay,
    shadowMode: true,
    actualExecutionPerformed: false,
    automaticAction: false,
  });
}
