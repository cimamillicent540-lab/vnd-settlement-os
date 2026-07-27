import { NextResponse } from "next/server";
import { z } from "zod";

import { authorizeInternalRequest } from "@/lib/api-auth";
import {
  buildSettlementLearningRecommendation,
  type LearningRiskAlert,
} from "@/lib/settlement-learning";
import { getSettlementIntelligenceData } from "@/lib/server-data";

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
    kind: z.literal("GENERATE_RECOMMENDATION"),
    clientRequestId: z.string().uuid(),
    currency: z.literal("VND"),
  }),
  z.object({
    kind: z.literal("SUBMIT_DECISION"),
    recommendationId: z.string().uuid(),
    decisionScope: z.enum([
      "FULL_REVIEW",
      "TOPUP",
      "QUOTE",
      "RISK",
    ]),
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
    adjustmentReason: z.string().trim().min(1).max(1000),
    merchantName: z.string().trim().max(200).nullable(),
    transactionVolumeUsdt: unsignedDecimal,
    profitContributionUsdt: signedDecimal,
    riskFeedback: z
      .array(
        z.object({
          risk_code: z.string().trim().min(1).max(120),
          human_judgment: z.enum(["CONFIRMED", "IGNORED"]),
          human_note: z.string().trim().max(1000),
        }),
      )
      .max(100),
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
        message: "学习闭环记录校验失败",
        details: parsed.error.flatten(),
      },
      { status: 400 },
    );
  }

  if (parsed.data.kind === "GENERATE_RECOMMENDATION") {
    if (
      !auth.roles.some(
        (role) =>
          role === "admin" || role === "settlement_operator",
      )
    ) {
      return NextResponse.json(
        { message: "只有结算操作员或管理员可以生成系统建议" },
        { status: 403 },
      );
    }

    const intelligence = await getSettlementIntelligenceData();
    const risks = intelligence.riskAlerts as LearningRiskAlert[];
    const recommendation = buildSettlementLearningRecommendation({
      clientRequestId: parsed.data.clientRequestId,
      currency: parsed.data.currency,
      generatedBy: auth.userId,
      topupRecommended:
        intelligence.topupRecommendation.topupRequired,
      recommendedTopupUsdt:
        intelligence.topupRecommendation.recommendedTopupUsdt,
      requiredGrossTopupVnd:
        intelligence.topupRecommendation.requiredGrossTopupVnd,
      recommendedQuoteRate:
        intelligence.quoteRecommendation?.recommendedQuoteRate ??
        null,
      targetMargin: intelligence.marginRecommendation.targetMargin,
      riskAlerts: risks,
      expectedProfitUsdt:
        intelligence.profitForecast?.expectedProfitUsdt ?? null,
      expectedProfitMargin:
        intelligence.profitForecast?.expectedProfitMargin ?? null,
      fxJudgment:
        intelligence.fxIntelligence?.opportunity ===
          "BUY_VND_OPPORTUNITY" ||
        intelligence.fxIntelligence?.opportunity === "NORMAL" ||
        intelligence.fxIntelligence?.opportunity === "RISK"
          ? intelligence.fxIntelligence.opportunity
          : "WAITING_INPUT",
      xeRate: intelligence.fxIntelligence?.xeRate ?? null,
      p2pCostRate:
        intelligence.fxIntelligence?.p2pCostRate ?? null,
      fxSpreadRatio:
        intelligence.fxIntelligence?.spreadRatio ?? null,
      systemPayload: {
        balances: intelligence.balances,
        peakWindow: intelligence.peakWindow,
        topupRecommendation: intelligence.topupRecommendation,
        quoteRecommendation: intelligence.quoteRecommendation,
        marginRecommendation: intelligence.marginRecommendation,
        riskAlerts: risks,
        profitForecast: intelligence.profitForecast,
        fxIntelligence: intelligence.fxIntelligence,
        fifoForecast: intelligence.fifoForecast,
      },
      dataCutoffSnapshot: intelligence.dataCutoffs,
    });

    const { data, error } = await auth.db
      .from("settlement_learning_recommendations")
      .insert(recommendation)
      .select(
        "id,currency,recommendation_time,learning_phase,learning_window_days,system_topup_recommended,system_recommended_topup_usdt,system_recommended_quote_rate,system_risk_alerts,system_expected_profit_usdt,system_expected_profit_margin,system_fx_judgment,shadow_mode",
      )
      .single();

    if (error?.code === "23505") {
      const { data: existing, error: existingError } = await auth.db
        .from("settlement_learning_recommendations")
        .select(
          "id,currency,recommendation_time,learning_phase,learning_window_days,system_topup_recommended,system_recommended_topup_usdt,system_recommended_quote_rate,system_risk_alerts,system_expected_profit_usdt,system_expected_profit_margin,system_fx_judgment,shadow_mode",
        )
        .eq("client_request_id", parsed.data.clientRequestId)
        .single();
      if (!existingError && existing) {
        return NextResponse.json({
          ok: true,
          recommendation: existing,
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
      recommendation: data,
      idempotentReplay: false,
      shadowMode: true,
      automaticAction: false,
    });
  }

  const { data, error } = await auth.db.rpc(
    "record_settlement_human_decision_v1",
    {
      p_recommendation_id: parsed.data.recommendationId,
      p_decision_scope: parsed.data.decisionScope,
      p_acceptance_status: parsed.data.acceptanceStatus,
      p_final_topup_usdt: parsed.data.finalTopupUsdt,
      p_final_quote_rate: parsed.data.finalQuoteRate,
      p_final_execution_decision:
        parsed.data.finalExecutionDecision,
      p_adjustment_reason: parsed.data.adjustmentReason,
      p_merchant_name: parsed.data.merchantName,
      p_transaction_volume_usdt:
        parsed.data.transactionVolumeUsdt,
      p_profit_contribution_usdt:
        parsed.data.profitContributionUsdt,
      p_risk_feedback: parsed.data.riskFeedback,
    },
  );

  if (error) {
    return NextResponse.json(
      { message: error.message },
      { status: 409 },
    );
  }

  const decision = Array.isArray(data) ? data[0] : data;
  return NextResponse.json({
    ok: true,
    decision,
    shadowMode: true,
    actualExecutionPerformed: false,
    automaticAction: false,
  });
}
