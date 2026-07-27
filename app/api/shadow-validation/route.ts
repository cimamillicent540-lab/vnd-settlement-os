import { NextResponse } from "next/server";
import { z } from "zod";

import { authorizeInternalRequest } from "@/lib/api-auth";
import {
  buildDailyValidationRecord,
  buildValidationPeriodRecord,
  calculateShadowValidationMetrics,
  predictedFxGainUsdt,
} from "@/lib/shadow-validation";

const unsignedDecimal = z
  .string()
  .regex(/^\d+(\.\d{1,12})?$/);
const signedDecimal = z
  .string()
  .regex(/^-?\d+(\.\d{1,12})?$/);
const vndAmount = z.string().regex(/^\d+(\.\d{1,2})?$/);

const payloadSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("START_PERIOD"),
    clientRequestId: z.string().uuid(),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }),
  z.object({
    kind: z.literal("CAPTURE_DAILY_RESULT"),
    clientRequestId: z.string().uuid(),
    outcomeClientRequestId: z.string().uuid(),
    periodId: z.string().uuid(),
    sourceEndReviewId: z.string().uuid(),
    validationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    actualTopupUsdt: unsignedDecimal,
    actualQuoteRate: unsignedDecimal.refine(
      (value) => Number(value) > 0,
      "实际报价必须大于0",
    ),
    actualCashProfitUsdt: signedDecimal,
    actualEconomicProfitUsdt: signedDecimal,
    actualFxGainUsdt: signedDecimal,
    fundingPressureBeforeVnd: vndAmount,
    fundingPressureAfterVnd: vndAmount,
    actualRiskOutcomes: z
      .array(
        z.object({
          risk_code: z.string().trim().min(1).max(120),
          realized: z.boolean(),
          note: z.string().trim().max(1000),
        }),
      )
      .max(100),
    unexpectedRiskCount: z.number().int().min(0).max(100),
    unexpectedRiskNotes: z.string().trim().max(2000),
    outcomeReason: z.string().trim().min(1).max(1000),
  }),
]);

const periodSelection =
  "id,client_request_id,currency,start_date,end_date,validation_days,rules_version,shadow_mode,created_at";
const dailySelection =
  "id,period_id,validation_date,day_number,system_recommended_topup_usdt,system_recommended_quote_rate,system_predicted_cash_profit_usdt,system_predicted_economic_profit_usdt,system_predicted_fx_gain_usdt,system_risk_level,acceptance_status,adjustment_reason_category,actual_topup_usdt,actual_quote_rate,actual_cash_profit_usdt,actual_economic_profit_usdt,actual_fx_gain_usdt,topup_accuracy_score,quote_adoption_score,profit_prediction_score,risk_prediction_accuracy_score,ai_accuracy_score,funding_pressure_improved,shadow_mode,created_at";

function riskCodes(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((risk) =>
      risk && typeof risk === "object" && "code" in risk
        ? String(risk.code)
        : "",
    )
    .filter(Boolean);
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
        message: "Shadow Validation记录校验失败",
        details: parsed.error.flatten(),
      },
      { status: 400 },
    );
  }
  const data = parsed.data;

  if (data.kind === "START_PERIOD") {
    if (
      !auth.roles.some(
        (role) =>
          role === "admin" || role === "settlement_operator",
      )
    ) {
      return NextResponse.json(
        { message: "仅结算操作员或管理员可启动验证周期" },
        { status: 403 },
      );
    }
    const record = buildValidationPeriodRecord({
      clientRequestId: data.clientRequestId,
      startDate: data.startDate,
      createdBy: auth.userId,
    });
    const inserted = await auth.db
      .from("shadow_validation_periods")
      .insert(record)
      .select(periodSelection)
      .single();
    if (!inserted.error) {
      return NextResponse.json({
        ok: true,
        period: inserted.data,
        idempotentReplay: false,
        shadowMode: true,
        automaticAction: false,
      });
    }
    if (inserted.error.code !== "23505") {
      return NextResponse.json(
        { message: inserted.error.message },
        { status: 409 },
      );
    }
    const existing = await auth.db
      .from("shadow_validation_periods")
      .select(periodSelection)
      .eq("client_request_id", data.clientRequestId)
      .single();
    if (existing.error) {
      return NextResponse.json(
        { message: existing.error.message },
        { status: 409 },
      );
    }
    return NextResponse.json({
      ok: true,
      period: existing.data,
      idempotentReplay: true,
      shadowMode: true,
      automaticAction: false,
    });
  }

  const [
    { data: period, error: periodError },
    { data: endReview, error: endReviewError },
  ] = await Promise.all([
    auth.db
      .from("shadow_validation_periods")
      .select(periodSelection)
      .eq("id", data.periodId)
      .single(),
    auth.db
      .from("daily_operation_end_reviews")
      .select(
        "id,operating_date,source_learning_recommendation_id,human_decision_id,reason_classification_id,risk_check_id,acceptance_status,adjustment_reason_category,adjustment_reason,data_cutoff_snapshot,shadow_mode,actual_execution_performed",
      )
      .eq("id", data.sourceEndReviewId)
      .single(),
  ]);
  if (periodError || !period || endReviewError || !endReview) {
    return NextResponse.json(
      {
        message:
          periodError?.message ??
          endReviewError?.message ??
          "验证周期或23:00复盘不存在",
      },
      { status: 409 },
    );
  }
  if (
    endReview.operating_date !== data.validationDate ||
    data.validationDate < period.start_date ||
    data.validationDate > period.end_date
  ) {
    return NextResponse.json(
      { message: "23:00复盘日期不在所选7天验证周期内" },
      { status: 409 },
    );
  }

  const [
    { data: recommendation, error: recommendationError },
    { data: riskCheck, error: riskCheckError },
  ] = await Promise.all([
    auth.db
      .from("settlement_learning_recommendations")
      .select(
        "id,system_topup_recommended,system_recommended_topup_usdt,system_recommended_quote_rate,system_cash_profit_usdt,system_economic_profit_usdt,system_fx_spread_ratio,system_risk_alerts,shadow_mode",
      )
      .eq("id", endReview.source_learning_recommendation_id)
      .single(),
    auth.db
      .from("daily_operation_risk_checks")
      .select("id,risk_level,shadow_mode")
      .eq("id", endReview.risk_check_id)
      .single(),
  ]);
  if (
    recommendationError ||
    !recommendation ||
    riskCheckError ||
    !riskCheck
  ) {
    return NextResponse.json(
      {
        message:
          recommendationError?.message ??
          riskCheckError?.message ??
          "AI建议或风险等级不存在",
      },
      { status: 409 },
    );
  }

  const predictedCodes = riskCodes(
    recommendation.system_risk_alerts,
  );
  const actualCodes = data.actualRiskOutcomes.map(
    (risk) => risk.risk_code,
  );
  if (
    predictedCodes.length !== actualCodes.length ||
    new Set(actualCodes).size !== actualCodes.length ||
    predictedCodes.some((code) => !actualCodes.includes(code))
  ) {
    return NextResponse.json(
      { message: "必须逐条记录每个AI风险预测的实际结果" },
      { status: 400 },
    );
  }
  if (
    data.unexpectedRiskCount > 0 &&
    !data.unexpectedRiskNotes
  ) {
    return NextResponse.json(
      { message: "存在未预测风险时必须填写说明" },
      { status: 400 },
    );
  }

  const predictedFx = predictedFxGainUsdt({
    recommendedTopupUsdt:
      recommendation.system_recommended_topup_usdt,
    fxSpreadRatio: recommendation.system_fx_spread_ratio,
  });
  const outcomeResult = await auth.db.rpc(
    "record_settlement_decision_outcome_v1",
    {
      p_client_request_id: data.outcomeClientRequestId,
      p_human_decision_id: endReview.human_decision_id,
      p_measured_at: new Date().toISOString(),
      p_actual_topup_usdt: data.actualTopupUsdt,
      p_actual_quote_rate: data.actualQuoteRate,
      p_actual_cash_profit_usdt:
        data.actualCashProfitUsdt,
      p_actual_economic_profit_usdt:
        data.actualEconomicProfitUsdt,
      p_actual_risk_outcomes: data.actualRiskOutcomes,
      p_outcome_reason: data.outcomeReason,
      p_outcome_snapshot: {
        source: "SHADOW_VALIDATION_7_DAY_V1",
        validationDate: data.validationDate,
        actualFxGainUsdt: data.actualFxGainUsdt,
        fundingPressureBeforeVnd:
          data.fundingPressureBeforeVnd,
        fundingPressureAfterVnd:
          data.fundingPressureAfterVnd,
        unexpectedRiskCount: data.unexpectedRiskCount,
        unexpectedRiskNotes: data.unexpectedRiskNotes,
        descriptiveStatisticsOnly: true,
        automaticOptimization: false,
      },
      p_data_cutoff_snapshot: endReview.data_cutoff_snapshot,
    },
  );
  let outcome = Array.isArray(outcomeResult.data)
    ? outcomeResult.data[0]
    : outcomeResult.data;
  let outcomeError = outcomeResult.error;
  if (outcomeError?.code === "23505") {
    const existingOutcome = await auth.db
      .from("settlement_decision_outcomes")
      .select("id,outcome_version")
      .eq("client_request_id", data.outcomeClientRequestId)
      .single();
    if (existingOutcome.error || !existingOutcome.data) {
      return NextResponse.json(
        {
          message:
            existingOutcome.error?.message ??
            "实际结果幂等读取失败",
        },
        { status: 409 },
      );
    }
    outcome = {
      outcome_id: existingOutcome.data.id,
      outcome_version: existingOutcome.data.outcome_version,
    };
    outcomeError = null;
  }
  if (outcomeError || !outcome) {
    return NextResponse.json(
      {
        message:
          outcomeError?.message ?? "实际结果追加保存失败",
      },
      { status: 409 },
    );
  }

  const predictedRiskAlerts = Array.isArray(
    recommendation.system_risk_alerts,
  )
    ? (recommendation.system_risk_alerts as Array<
        Record<string, unknown>
      >)
    : [];
  const metrics = calculateShadowValidationMetrics({
    predictedTopupUsdt:
      recommendation.system_recommended_topup_usdt,
    predictedQuoteRate:
      recommendation.system_recommended_quote_rate,
    predictedCashProfitUsdt:
      recommendation.system_cash_profit_usdt,
    predictedEconomicProfitUsdt:
      recommendation.system_economic_profit_usdt,
    predictedFxGainUsdt: predictedFx,
    predictedRiskCodes: predictedCodes,
    actualTopupUsdt: data.actualTopupUsdt,
    actualQuoteRate: data.actualQuoteRate,
    actualCashProfitUsdt: data.actualCashProfitUsdt,
    actualEconomicProfitUsdt:
      data.actualEconomicProfitUsdt,
    actualFxGainUsdt: data.actualFxGainUsdt,
    fundingPressureBeforeVnd:
      data.fundingPressureBeforeVnd,
    fundingPressureAfterVnd:
      data.fundingPressureAfterVnd,
    actualRiskOutcomes: data.actualRiskOutcomes,
    unexpectedRiskCount: data.unexpectedRiskCount,
  });
  const dailyRecord = buildDailyValidationRecord({
    clientRequestId: data.clientRequestId,
    periodId: period.id,
    periodStartDate: period.start_date,
    validationDate: data.validationDate,
    sourceEndReviewId: endReview.id,
    recommendationId: recommendation.id,
    humanDecisionId: endReview.human_decision_id,
    decisionOutcomeId: outcome.outcome_id,
    reasonClassificationId:
      endReview.reason_classification_id,
    acceptanceStatus: endReview.acceptance_status,
    adjustmentReasonCategory:
      endReview.adjustment_reason_category,
    adjustmentReason: endReview.adjustment_reason,
    predicted: {
      topupRecommended:
        recommendation.system_topup_recommended,
      topupUsdt:
        recommendation.system_recommended_topup_usdt,
      quoteRate:
        recommendation.system_recommended_quote_rate,
      cashProfitUsdt:
        recommendation.system_cash_profit_usdt,
      economicProfitUsdt:
        recommendation.system_economic_profit_usdt,
      fxGainUsdt: predictedFx,
      riskAlerts: predictedRiskAlerts,
      riskLevel: riskCheck.risk_level,
    },
    actual: {
      topupUsdt: data.actualTopupUsdt,
      quoteRate: data.actualQuoteRate,
      cashProfitUsdt: data.actualCashProfitUsdt,
      economicProfitUsdt:
        data.actualEconomicProfitUsdt,
      fxGainUsdt: data.actualFxGainUsdt,
      fundingPressureBeforeVnd:
        data.fundingPressureBeforeVnd,
      fundingPressureAfterVnd:
        data.fundingPressureAfterVnd,
      riskOutcomes: data.actualRiskOutcomes,
      unexpectedRiskCount: data.unexpectedRiskCount,
      unexpectedRiskNotes: data.unexpectedRiskNotes,
    },
    metrics,
    dataCutoffSnapshot: endReview.data_cutoff_snapshot,
    recordedBy: auth.userId,
  });

  const insertedDaily = await auth.db
    .from("shadow_validation_daily_records")
    .insert(dailyRecord)
    .select(dailySelection)
    .single();
  if (!insertedDaily.error) {
    return NextResponse.json({
      ok: true,
      dailyRecord: insertedDaily.data,
      idempotentReplay: false,
      shadowMode: true,
      automaticAction: false,
    });
  }
  if (insertedDaily.error.code !== "23505") {
    return NextResponse.json(
      { message: insertedDaily.error.message },
      { status: 409 },
    );
  }
  const existingDaily = await auth.db
    .from("shadow_validation_daily_records")
    .select(dailySelection)
    .eq("client_request_id", data.clientRequestId)
    .single();
  if (existingDaily.error) {
    return NextResponse.json(
      { message: existingDaily.error.message },
      { status: 409 },
    );
  }
  return NextResponse.json({
    ok: true,
    dailyRecord: existingDaily.data,
    idempotentReplay: true,
    shadowMode: true,
    automaticAction: false,
  });
}
