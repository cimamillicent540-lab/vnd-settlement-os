import { NextResponse } from "next/server";
import { z } from "zod";

import {
  AI_DECISION_SCORE_RULES,
  buildAiDecisionScoreSnapshot,
} from "@/lib/ai-decision-score";
import { authorizeInternalRequest } from "@/lib/api-auth";

const payloadSchema = z.object({
  kind: z.literal("GENERATE_SCORE"),
  clientRequestId: z.string().uuid(),
  validationRecordId: z.string().uuid(),
});

const scoreSelection =
  "id,client_request_id,validation_record_id,period_id,score_date,score_version,supersedes_snapshot_id,model_version,topup_absolute_deviation_usdt,topup_reference_cost_difference_vnd,topup_cost_evidence_status,fx_opportunity_loss_usdt,topup_decision_score,quote_absolute_deviation,quote_profit_difference_usdt,merchant_competition_concern,merchant_competition_impact_ratio,transaction_risk_rate,quote_decision_score,cash_profit_absolute_error_usdt,economic_profit_absolute_error_usdt,profit_prediction_score,system_risk_level,actual_risk_level,risk_true_positive_count,risk_false_positive_count,risk_false_negative_count,risk_hit_rate,risk_false_positive_rate,risk_miss_rate,risk_score,evaluation_status,ai_decision_score,shadow_mode,created_at";

function riskAlerts(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (risk): risk is Record<string, unknown> =>
        risk !== null && typeof risk === "object",
    )
    .map((risk) => ({
      code: risk.code,
      severity: risk.severity,
    }));
}

function riskOutcomes(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (risk): risk is Record<string, unknown> =>
        risk !== null && typeof risk === "object",
    )
    .map((risk) => ({
      risk_code: String(risk.risk_code ?? ""),
      realized: risk.realized === true,
      note: String(risk.note ?? ""),
    }));
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
        message: "AI Decision Score请求校验失败",
        details: parsed.error.flatten(),
      },
      { status: 400 },
    );
  }
  const data = parsed.data;

  const existingByRequest = await auth.db
    .from("ai_decision_score_snapshots")
    .select(scoreSelection)
    .eq("client_request_id", data.clientRequestId)
    .maybeSingle();
  if (existingByRequest.error) {
    return NextResponse.json(
      { message: existingByRequest.error.message },
      { status: 409 },
    );
  }
  if (existingByRequest.data) {
    return NextResponse.json({
      ok: true,
      score: existingByRequest.data,
      idempotentReplay: true,
      shadowMode: true,
      automaticAction: false,
    });
  }

  const { data: source, error: sourceError } = await auth.db
    .from("shadow_validation_daily_records")
    .select(
      "id,period_id,validation_date,recommendation_id,system_recommended_topup_usdt,actual_topup_usdt,system_predicted_fx_gain_usdt,actual_fx_gain_usdt,system_recommended_quote_rate,actual_quote_rate,adjustment_reason_category,system_predicted_cash_profit_usdt,actual_cash_profit_usdt,system_predicted_economic_profit_usdt,actual_economic_profit_usdt,system_risk_level,system_predicted_risk_alerts,actual_risk_outcomes,unexpected_risk_count,data_cutoff_snapshot,shadow_mode,actual_execution_performed",
    )
    .eq("id", data.validationRecordId)
    .single();
  if (sourceError || !source) {
    return NextResponse.json(
      {
        message:
          sourceError?.message ?? "Shadow Validation日记录不存在",
      },
      { status: 404 },
    );
  }
  if (!source.shadow_mode || source.actual_execution_performed) {
    return NextResponse.json(
      { message: "评分来源违反Shadow Mode边界" },
      { status: 409 },
    );
  }

  const [
    { data: recommendation, error: recommendationError },
    { data: existingModelScore, error: existingScoreError },
  ] = await Promise.all([
    auth.db
      .from("settlement_learning_recommendations")
      .select("id,system_p2p_cost_rate,shadow_mode")
      .eq("id", source.recommendation_id)
      .single(),
    auth.db
      .from("ai_decision_score_latest")
      .select(scoreSelection)
      .eq("validation_record_id", source.id)
      .eq(
        "model_version",
        AI_DECISION_SCORE_RULES.modelVersion,
      )
      .maybeSingle(),
  ]);
  if (
    recommendationError ||
    !recommendation ||
    existingScoreError
  ) {
    return NextResponse.json(
      {
        message:
          recommendationError?.message ??
          existingScoreError?.message ??
          "评分来源建议不存在",
      },
      { status: 409 },
    );
  }
  if (existingModelScore) {
    return NextResponse.json({
      ok: true,
      score: existingModelScore,
      idempotentReplay: true,
      shadowMode: true,
      automaticAction: false,
    });
  }
  if (!recommendation.shadow_mode) {
    return NextResponse.json(
      { message: "AI建议来源违反Shadow Mode边界" },
      { status: 409 },
    );
  }

  const scoreRecord = buildAiDecisionScoreSnapshot({
    clientRequestId: data.clientRequestId,
    validationRecord: {
      ...source,
      system_predicted_risk_alerts: riskAlerts(
        source.system_predicted_risk_alerts,
      ),
      actual_risk_outcomes: riskOutcomes(
        source.actual_risk_outcomes,
      ),
      system_risk_level: source.system_risk_level as
        | "LOW"
        | "MEDIUM"
        | "HIGH",
      data_cutoff_snapshot:
        source.data_cutoff_snapshot &&
        typeof source.data_cutoff_snapshot === "object" &&
        !Array.isArray(source.data_cutoff_snapshot)
          ? (source.data_cutoff_snapshot as Record<
              string,
              unknown
            >)
          : {},
    },
    referenceCostRateVndPerUsdt:
      recommendation.system_p2p_cost_rate,
    scoreVersion: 1,
    supersedesSnapshotId: null,
    createdBy: auth.userId,
  });

  const inserted = await auth.db
    .from("ai_decision_score_snapshots")
    .insert(scoreRecord)
    .select(scoreSelection)
    .single();
  if (!inserted.error) {
    return NextResponse.json({
      ok: true,
      score: inserted.data,
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
  const replay = await auth.db
    .from("ai_decision_score_latest")
    .select(scoreSelection)
    .eq("validation_record_id", source.id)
    .eq("model_version", AI_DECISION_SCORE_RULES.modelVersion)
    .single();
  if (replay.error) {
    return NextResponse.json(
      { message: replay.error.message },
      { status: 409 },
    );
  }
  return NextResponse.json({
    ok: true,
    score: replay.data,
    idempotentReplay: true,
    shadowMode: true,
    automaticAction: false,
  });
}
