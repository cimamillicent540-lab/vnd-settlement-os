import { NextResponse } from "next/server";
import { z } from "zod";

import { authorizeInternalRequest } from "@/lib/api-auth";
import { buildControlCenterSnapshotRecord } from "@/lib/settlement-control-center";
import { getSettlementControlCenterData } from "@/lib/server-data";

const payloadSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("SAVE_SNAPSHOT"),
    clientRequestId: z.string().uuid(),
  }),
  z.object({
    kind: z.literal("REVIEW_RISK"),
    controlSnapshotId: z.string().uuid(),
    riskCode: z.string().trim().min(1).max(120),
    humanJudgment: z.enum(["CONFIRMED", "IGNORED"]),
    humanNote: z.string().trim().max(1000).nullable(),
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
        message: "控制中心记录校验失败",
        details: parsed.error.flatten(),
      },
      { status: 400 },
    );
  }

  if (parsed.data.kind === "SAVE_SNAPSHOT") {
    if (
      !auth.roles.some(
        (role) =>
          role === "admin" || role === "settlement_operator",
      )
    ) {
      return NextResponse.json(
        { message: "只有结算操作员或管理员可以保存每日快照" },
        { status: 403 },
      );
    }

    const control = await getSettlementControlCenterData();
    const record = buildControlCenterSnapshotRecord({
      clientRequestId: parsed.data.clientRequestId,
      createdBy: auth.userId,
      sourceLearningRecommendationId:
        control.current.sourceLearningRecommendationId,
      balances: control.current.balances,
      funds: control.current.funds,
      pressure: control.current.pressure,
      topup: control.current.topup,
      fx: control.current.fx,
      merchants: control.current.merchants,
      executionGuard: control.current.executionGuard,
      risks: control.current.risks,
      learning90dSnapshot:
        (control.current.learning90d as Record<string, unknown>) ??
        {},
      dataCutoffSnapshot: control.current.dataCutoffs,
    });
    const { data, error } = await auth.db
      .from("settlement_control_center_snapshots")
      .insert(record)
      .select(
        "id,snapshot_date,as_of,funds_risk_status,topup_recommended,recommended_topup_usdt,inventory_limit_status,fx_opportunity_status,shadow_mode",
      )
      .single();

    if (error?.code === "23505") {
      const { data: existing, error: existingError } = await auth.db
        .from("settlement_control_center_snapshots")
        .select(
          "id,snapshot_date,as_of,funds_risk_status,topup_recommended,recommended_topup_usdt,inventory_limit_status,fx_opportunity_status,shadow_mode",
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
    "record_settlement_control_risk_review_v1",
    {
      p_control_snapshot_id: parsed.data.controlSnapshotId,
      p_risk_code: parsed.data.riskCode,
      p_human_judgment: parsed.data.humanJudgment,
      p_human_note: parsed.data.humanNote,
    },
  );
  if (error) {
    return NextResponse.json(
      { message: error.message },
      { status: 409 },
    );
  }
  const review = Array.isArray(data) ? data[0] : data;
  return NextResponse.json({
    ok: true,
    review,
    shadowMode: true,
    automaticAction: false,
  });
}
