import { NextResponse } from "next/server";
import { z } from "zod";

import { authorizeInternalRequest } from "@/lib/api-auth";
import {
  approvalActionIsValid,
  approvalReasonIsValid,
  buildApprovalRequestRows,
} from "@/lib/human-approval";
import { getSettlementControlCenterData } from "@/lib/server-data";

const nullableUnsignedDecimal = z
  .string()
  .regex(/^\d+(\.\d{1,12})?$/)
  .nullable();

const payloadSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("SYNC_QUEUE"),
    clientRequestId: z.string().uuid(),
    recommendationId: z.string().uuid(),
  }),
  z.object({
    kind: z.literal("RECORD_ACTION"),
    clientRequestId: z.string().uuid(),
    approvalRequestId: z.string().uuid(),
    requestType: z.enum(["TOPUP", "QUOTE", "RISK"]),
    actionType: z.enum([
      "ACCEPTED",
      "MODIFIED",
      "REJECTED",
      "CONFIRMED",
      "ADJUSTED",
      "IGNORED",
    ]),
    finalTopupUsdt: nullableUnsignedDecimal,
    finalQuoteRate: nullableUnsignedDecimal,
    finalRiskLevel: z.enum(["LOW", "MEDIUM", "HIGH"]).nullable(),
    reasonCode: z
      .string()
      .trim()
      .regex(/^[A-Z][A-Z0-9_]{2,79}$/),
    reasonDetail: z.string().trim().min(1).max(1000),
  }),
]);

function shanghaiOperatingDate(value: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

export async function POST(request: Request) {
  const auth = await authorizeInternalRequest(request, [
    "admin",
    "settlement_operator",
  ]);
  if (!auth) {
    return NextResponse.json(
      { message: "只有结算操作员或管理员可以使用人工审批中心" },
      { status: 403 },
    );
  }

  const parsed = payloadSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      {
        message: "审批记录校验失败",
        details: parsed.error.flatten(),
      },
      { status: 400 },
    );
  }

  if (parsed.data.kind === "SYNC_QUEUE") {
    const { data: recommendation, error: recommendationError } =
      await auth.db
        .from("settlement_learning_recommendations")
        .select(
          "id,recommendation_time,system_recommended_topup_usdt,system_recommended_quote_rate,system_target_margin,system_risk_alerts,system_p2p_cost_rate,system_cash_profit_usdt,system_economic_profit_usdt,data_cutoff_snapshot",
        )
        .eq("id", parsed.data.recommendationId)
        .eq("currency", "VND")
        .single();
    if (recommendationError || !recommendation) {
      return NextResponse.json(
        { message: "未找到可审批的VND系统建议" },
        { status: 404 },
      );
    }

    const control = await getSettlementControlCenterData();
    const rows = buildApprovalRequestRows({
      batchId: parsed.data.clientRequestId,
      requestedBy: auth.userId,
      operatingDate: shanghaiOperatingDate(
        recommendation.recommendation_time,
      ),
      recommendation: {
        id: recommendation.id,
        recommendationTime: recommendation.recommendation_time,
        recommendedTopupUsdt:
          recommendation.system_recommended_topup_usdt,
        recommendedQuoteRate:
          recommendation.system_recommended_quote_rate,
        targetMargin: recommendation.system_target_margin,
        riskAlerts:
          (recommendation.system_risk_alerts as Array<{
            code: string;
            severity: "INFO" | "WARNING" | "HIGH";
            message: string;
          }>) ?? [],
        p2pCostRate: recommendation.system_p2p_cost_rate,
        predictedCashProfitUsdt:
          recommendation.system_cash_profit_usdt,
        predictedEconomicProfitUsdt:
          recommendation.system_economic_profit_usdt,
        dataCutoffSnapshot:
          (recommendation.data_cutoff_snapshot as Record<
            string,
            unknown
          >) ?? {},
      },
      topup: {
        recommendedTime: control.current.topup.recommendedTime,
        reasons: control.current.topup.reasons,
        fundsRiskStatus: control.current.funds.status,
      },
      merchants: control.current.merchants,
    });

    const { data, error } = await auth.db
      .from("approval_requests")
      .insert(rows)
      .select("id,request_type,request_key,request_version");

    if (error?.code === "23505") {
      const { data: existing, error: existingError } = await auth.db
        .from("approval_center_queue")
        .select(
          "id,request_type,request_key,request_version,latest_action_id",
        )
        .eq("recommendation_id", recommendation.id);
      if (!existingError && existing) {
        return NextResponse.json({
          ok: true,
          approvalRequests: existing,
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
      approvalRequests: data,
      idempotentReplay: false,
      shadowMode: true,
      automaticAction: false,
    });
  }

  if (
    !approvalActionIsValid(
      parsed.data.requestType,
      parsed.data.actionType,
    )
  ) {
    return NextResponse.json(
      { message: "审批动作与建议类型不匹配" },
      { status: 400 },
    );
  }
  if (
    !approvalReasonIsValid(
      parsed.data.reasonCode,
      parsed.data.reasonDetail,
    )
  ) {
    return NextResponse.json(
      { message: "必须选择原因并填写具体说明" },
      { status: 400 },
    );
  }

  const { data, error } = await auth.db.rpc(
    "record_approval_action_v1",
    {
      p_client_request_id: parsed.data.clientRequestId,
      p_approval_request_id: parsed.data.approvalRequestId,
      p_action_type: parsed.data.actionType,
      p_final_topup_usdt: parsed.data.finalTopupUsdt,
      p_final_quote_rate: parsed.data.finalQuoteRate,
      p_final_risk_level: parsed.data.finalRiskLevel,
      p_reason_code: parsed.data.reasonCode,
      p_reason_detail: parsed.data.reasonDetail,
    },
  );
  if (error) {
    return NextResponse.json(
      { message: error.message },
      { status: 409 },
    );
  }

  return NextResponse.json({
    ok: true,
    approvalAction: data,
    shadowMode: true,
    automaticAction: false,
    actualExecutionPerformed: false,
  });
}
