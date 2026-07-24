import { NextResponse } from "next/server";
import { z } from "zod";

import { authorizeInternalRequest } from "@/lib/api-auth";

const positiveRate = z
  .string()
  .regex(/^\d+(\.\d{1,12})?$/)
  .refine((value) => Number(value) > 0, "汇率必须大于0");
const signedAdjustment = z
  .string()
  .regex(/^-?\d+(\.\d{1,12})?$/);

const payloadSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("FX_MARKET_INPUT"),
    rateType: z.enum(["P2P_COST_RATE", "XE_BASE_RATE"]),
    rateValue: positiveRate,
    source: z.string().trim().min(1).max(160),
    recordTime: z.string().datetime({ offset: true }),
    notes: z.string().trim().max(500).nullable().optional(),
  }),
  z.object({
    kind: z.literal("QUOTE_ADJUSTMENT"),
    baseSource: z.literal("XE"),
    adjustment: signedAdjustment,
    reason: z.enum([
      "market_competition",
      "risk_adjustment",
      "profit_target",
    ]),
    effectiveTime: z.string().datetime({ offset: true }),
    notes: z.string().trim().max(500).nullable().optional(),
  }),
]);

export async function POST(request: Request) {
  const auth = await authorizeInternalRequest(request, [
    "admin",
    "settlement_operator",
  ]);
  if (!auth) {
    return NextResponse.json(
      { message: "需要结算操作员或管理员权限" },
      { status: 403 },
    );
  }
  const parsed = payloadSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      {
        message: "结算智能输入校验失败",
        details: parsed.error.flatten(),
      },
      { status: 400 },
    );
  }

  if (parsed.data.kind === "FX_MARKET_INPUT") {
    const { data, error } = await auth.db
      .from("fx_market_inputs")
      .insert({
        currency: "VND",
        rate_type: parsed.data.rateType,
        rate_value: parsed.data.rateValue,
        source: parsed.data.source,
        record_time: parsed.data.recordTime,
        operator: auth.userId,
        notes: parsed.data.notes ?? null,
        shadow_mode: true,
        automatic_application: false,
      })
      .select("id,rate_type,record_time")
      .single();
    if (error) {
      return NextResponse.json(
        { message: error.message },
        { status: 409 },
      );
    }
    return NextResponse.json({
      ok: true,
      input: data,
      shadowMode: true,
      automaticAction: false,
    });
  }

  const { data, error } = await auth.db
    .from("quote_adjustment_rules")
    .insert({
      currency: "VND",
      base_source: parsed.data.baseSource,
      adjustment: parsed.data.adjustment,
      reason: parsed.data.reason,
      effective_time: parsed.data.effectiveTime,
      operator: auth.userId,
      notes: parsed.data.notes ?? null,
      status: "ACTIVE",
      shadow_mode: true,
      automatic_application: false,
    })
    .select("id,base_source,reason,effective_time")
    .single();
  if (error) {
    return NextResponse.json(
      { message: error.message },
      { status: 409 },
    );
  }
  return NextResponse.json({
    ok: true,
    rule: data,
    shadowMode: true,
    automaticQuoteChange: false,
  });
}
