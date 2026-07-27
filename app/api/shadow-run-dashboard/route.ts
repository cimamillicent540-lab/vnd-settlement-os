import { NextResponse } from "next/server";
import { z } from "zod";

import { authorizeInternalRequest } from "@/lib/api-auth";
import {
  buildMarketContextNoteRecord,
  MARKET_CONTEXT_CATEGORIES,
} from "@/lib/shadow-run-dashboard";

const payloadSchema = z.object({
  kind: z.literal("RECORD_MARKET_CONTEXT_NOTE"),
  clientRequestId: z.string().uuid(),
  contextDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  observedAt: z.string().datetime({ offset: true }),
  category: z.enum(MARKET_CONTEXT_CATEGORIES),
  severity: z.enum(["INFO", "WARNING", "HIGH"]),
  title: z.string().trim().min(1).max(200),
  observationReason: z.string().trim().min(1).max(2000),
  evidenceReference: z.string().trim().max(1000).nullable(),
});

const selection =
  "id,client_request_id,currency,context_date,observed_at,context_category,severity,title,observation_reason,evidence_reference,recorded_by,shadow_mode,quote_impact_applied,automatic_action,created_at";

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
        message: "市场背景观察记录校验失败",
        details: parsed.error.flatten(),
      },
      { status: 400 },
    );
  }

  const record = buildMarketContextNoteRecord({
    clientRequestId: parsed.data.clientRequestId,
    contextDate: parsed.data.contextDate,
    observedAt: parsed.data.observedAt,
    category: parsed.data.category,
    severity: parsed.data.severity,
    title: parsed.data.title,
    observationReason: parsed.data.observationReason,
    evidenceReference: parsed.data.evidenceReference,
    recordedBy: auth.userId,
  });
  const { data, error } = await auth.db
    .from("shadow_run_market_context_notes")
    .insert(record)
    .select(selection)
    .single();

  if (error?.code === "23505") {
    const { data: existing, error: existingError } = await auth.db
      .from("shadow_run_market_context_notes")
      .select(selection)
      .eq("client_request_id", parsed.data.clientRequestId)
      .single();
    if (!existingError && existing) {
      return NextResponse.json({
        ok: true,
        note: existing,
        idempotentReplay: true,
        shadowMode: true,
        quoteImpactApplied: false,
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
    note: data,
    idempotentReplay: false,
    shadowMode: true,
    quoteImpactApplied: false,
    automaticAction: false,
  });
}
