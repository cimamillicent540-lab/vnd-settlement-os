import { NextResponse } from "next/server";
import { z } from "zod";

import { authorizeInternalRequest } from "@/lib/api-auth";
import { calculateSettlementDeterministicResult } from "@/lib/settlement-deterministic-calculation";
import {
  generateControlledSettlementAiIntelligence,
  providerNotConfiguredResult,
} from "@/lib/settlement-ai-intelligence-mvp";
import {
  createConfiguredOpenAiSettlementAdapter,
  OPENAI_SETTLEMENT_MODEL_CONFIGURATION,
} from "@/lib/openai-settlement-provider";
import { buildSettlementInputSnapshot } from "@/lib/settlement-input-snapshot-server";
import { settlementAiTriggerGuard } from "@/lib/settlement-ai-trigger-guard";

export const runtime = "nodejs";

const payloadSchema = z
  .object({ idempotencyKey: z.string().uuid() })
  .strict();

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

  const parsed = payloadSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { message: "AI Intelligence 请求无效" },
      { status: 400 },
    );
  }
  const guard = settlementAiTriggerGuard.acquire(
    auth.userId,
    parsed.data.idempotencyKey,
  );
  if (guard.status !== "ACQUIRED") {
    return NextResponse.json(
      {
        message:
          guard.status === "IN_PROGRESS"
            ? "同一请求正在处理中"
            : "同一请求已处理，请勿重复提交",
        code: guard.status,
      },
      { status: 409 },
    );
  }

  try {
    const configured = createConfiguredOpenAiSettlementAdapter();
    if (!configured.configured) {
      return NextResponse.json(
        await providerNotConfiguredResult(OPENAI_SETTLEMENT_MODEL_CONFIGURATION),
      );
    }
    const asOf = new Date().toISOString();
    const snapshot = await buildSettlementInputSnapshot({
      asOf,
      requestedAt: asOf,
      runTrigger: "MANUAL",
    });
    const calculation = await calculateSettlementDeterministicResult(snapshot);
    return NextResponse.json(
      await generateControlledSettlementAiIntelligence({
        snapshot,
        calculation,
        adapter: configured.adapter,
        model: OPENAI_SETTLEMENT_MODEL_CONFIGURATION,
      }),
    );
  } catch {
    return NextResponse.json(
      {
        status: "INTERNAL_ERROR",
        safe_message: "AI Intelligence 生成失败；未执行任何资金操作。",
        mode: "SHADOW",
      },
      { status: 500 },
    );
  } finally {
    guard.release();
  }
}
