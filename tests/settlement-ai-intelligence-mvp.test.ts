import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  AI_PROVIDER_ADAPTER_CONTRACT_VERSION,
  AI_PROVIDER_DRAFT_CONTRACT_VERSION,
  AI_PROVIDER_RESPONSE_CONTRACT_VERSION,
  type AiProviderAdapterV1,
  type AiProviderRequestV1,
  type AiProviderResponseV1,
  type PromptVersionMetadataV1,
  type ProviderResolvedPromptContentV1,
} from "../lib/settlement-ai-provider-adapter";
import {
  generateControlledSettlementAiIntelligence,
  providerNotConfiguredResult,
} from "../lib/settlement-ai-intelligence-mvp";
import {
  SETTLEMENT_AI_MVP_PINNED_PROMPT_DIGESTS,
  loadSettlementAiMvpPromptBundle,
} from "../lib/settlement-ai-mvp-prompt";
import {
  OPENAI_SETTLEMENT_MODEL_CONFIGURATION,
  OPENAI_SETTLEMENT_MODEL_ID,
  OpenAiSettlementProviderAdapter,
  createConfiguredOpenAiSettlementAdapter,
} from "../lib/openai-settlement-provider";
import { SettlementAiTriggerGuard } from "../lib/settlement-ai-trigger-guard";
import {
  SETTLEMENT_DETERMINISTIC_CONTRACT_VERSION,
  SETTLEMENT_DETERMINISTIC_SHADOW_GUARD,
  type SettlementDeterministicCalculationResultV1,
} from "../lib/settlement-deterministic-calculation";
import {
  SETTLEMENT_INPUT_CONTRACT_VERSION,
  SETTLEMENT_INPUT_SHADOW_GUARD,
  stableSnapshotDigest,
  type SettlementInputSnapshotV1,
} from "../lib/settlement-input-snapshot";

const AS_OF = "2026-08-01T03:00:00.000Z";
const GENERATED_AT = "2026-08-01T03:00:01.000Z";
const SNAPSHOT_ID = "00000000-0000-4000-8000-000000000801";
const REQUEST_ID = "00000000-0000-4000-8000-000000000802";
const EVIDENCE_ID = "00000000-0000-4000-8000-000000000803";
const CLAIM_ID = "00000000-0000-4000-8000-000000000804";
const REVIEW_ID = "00000000-0000-4000-8000-000000000805";
const INPUT_DIGEST = `sha256:${"1".repeat(64)}`;
const RESULT_DIGEST = `sha256:${"2".repeat(64)}`;
const RULESET_DIGEST = `sha256:${"3".repeat(64)}`;
const EVIDENCE_DIGEST = `sha256:${"4".repeat(64)}`;

function upstream() {
  const snapshot = {
    contract_version: SETTLEMENT_INPUT_CONTRACT_VERSION,
    snapshot_id: SNAPSHOT_ID,
    request_id: REQUEST_ID,
    requested_at: AS_OF,
    created_at: AS_OF,
    as_of: AS_OF,
    currency: "VND",
    operating_timezone: "Asia/Shanghai",
    run_trigger: "MANUAL",
    mode: "SHADOW",
    ruleset_ref: {
      ruleset_code: "VND_SETTLEMENT_INTELLIGENCE_RULESET",
      ruleset_version: "1.0.0",
      ruleset_digest: RULESET_DIGEST,
    },
    input_digest: INPUT_DIGEST,
    data_sources: [
      {
        source_key: "BALANCE_POSITION",
        freshness_status: "FRESH",
        completeness_status: "COMPLETE",
        cutoff_at: AS_OF,
      },
    ],
    data_quality: { status: "COMPLETE", limitations: [], blocking_reasons: [] },
    input_evidence: [
      {
        evidence_id: EVIDENCE_ID,
        source_key: "BALANCE_POSITION",
        source_type: "SUPABASE_SELECT",
        observed_at: AS_OF,
        cutoff_at: AS_OF,
        content_digest: EVIDENCE_DIGEST,
        extraction_version: "SETTLEMENT_READ_AGGREGATION_V1",
        classification: "INTERNAL_OPERATIONAL_DATA",
        redaction_status: "NO_SECRETS_INCLUDED",
      },
    ],
    shadow_guard: SETTLEMENT_INPUT_SHADOW_GUARD,
  } as unknown as SettlementInputSnapshotV1;
  const calculation = {
    contract_version: SETTLEMENT_DETERMINISTIC_CONTRACT_VERSION,
    engine_version: "1.0.0",
    snapshot_id: SNAPSHOT_ID,
    request_id: REQUEST_ID,
    input_digest: INPUT_DIGEST,
    ruleset_version: "1.0.0",
    ruleset_ref: {
      ruleset_code: "VND_DETERMINISTIC_CALCULATION_RULESET",
      ruleset_version: "1.0.0",
      ruleset_digest: RULESET_DIGEST,
      input_ruleset_code: "VND_SETTLEMENT_INTELLIGENCE_RULESET",
      input_ruleset_version: "1.0.0",
      input_ruleset_digest: RULESET_DIGEST,
    },
    as_of: AS_OF,
    currency: "VND",
    mode: "SHADOW",
    status: "COMPLETE",
    liquidity_result: { settleable_capacity_gap_vnd: "50.0000" },
    fifo_cost_result: null,
    profit_result: null,
    fx_result: null,
    business_rule_result: null,
    formula_results: [
      {
        formula_id: "LIQUIDITY_CAPACITY_GAP",
        formula_version: "1.0.0",
        status: "COMPLETE",
        input_paths: [],
        output_path: "liquidity_result.settleable_capacity_gap_vnd",
        value: "50.0000",
        evidence_refs: [EVIDENCE_ID],
      },
    ],
    evidence_refs: [EVIDENCE_ID],
    limitations: [],
    blocking_reasons: [],
    result_digest: RESULT_DIGEST,
    shadow_guard: SETTLEMENT_DETERMINISTIC_SHADOW_GUARD,
  } as unknown as SettlementDeterministicCalculationResultV1;
  return { snapshot, calculation };
}

function validDraft() {
  return {
    contract_version: AI_PROVIDER_DRAFT_CONTRACT_VERSION,
    fact_summary: [
      {
        claim_id: CLAIM_ID,
        claim_text: "可结算资金缺口为 50.0000 VND。",
        claim_type: "DETERMINISTIC_FACT" as const,
        deterministic_result_paths: [
          "liquidity_result.settleable_capacity_gap_vnd",
        ],
        snapshot_paths: [],
        evidence_ids: [EVIDENCE_ID],
        limitations: [],
      },
    ],
    risk_summary: [],
    recommendations: [
      {
        recommendation_id: REVIEW_ID,
        recommendation_type: "LIQUIDITY_REVIEW" as const,
        title: "人工查看资金缺口",
        statement: "请人工查看已验证的资金缺口事实。",
        reason_codes: ["LIQUIDITY_GAP_VISIBLE"],
        priority: "INFO" as const,
        human_review_request: "人工结合运营上下文查看，不触发任何动作。",
        referenced_value_paths: [
          "liquidity_result.settleable_capacity_gap_vnd",
        ],
        claim_ids: [CLAIM_ID],
        deterministic_result_paths: [
          "liquidity_result.settleable_capacity_gap_vnd",
        ],
        evidence_ids: [EVIDENCE_ID],
        limitations: [],
      },
    ],
    limitations: [],
  };
}

function providerResponse(
  request: AiProviderRequestV1,
  draft: unknown,
): AiProviderResponseV1 {
  return {
    contract_version: AI_PROVIDER_RESPONSE_CONTRACT_VERSION,
    adapter_request_id: request.adapter_request_id,
    ai_request_id: request.ai_request_id,
    received_at: GENERATED_AT,
    model_run_metadata: {
      provider: "OFFLINE_MOCK",
      model_id: "offline-settlement-mock-1",
      model_revision: "fixture-1",
      deployment_id: null,
      provider_request_id: "offline-request-1",
      generation_started_at: GENERATED_AT,
      generation_completed_at: GENERATED_AT,
      temperature: request.model.temperature,
      top_p: request.model.top_p,
      max_output_tokens: request.model.max_output_tokens,
      seed: null,
      structured_output_mode: true,
      tool_policy: "NO_TOOLS",
      input_tokens: 100,
      output_tokens: 50,
    },
    provider_response_digest: `sha256:${"9".repeat(64)}`,
    outcome: "COMPLETED",
    draft: draft as NonNullable<AiProviderResponseV1["draft"]>,
    failure: null,
  };
}

class OfflineProvider implements AiProviderAdapterV1 {
  readonly contract_version = AI_PROVIDER_ADAPTER_CONTRACT_VERSION;
  readonly adapter_id = "offline-controlled-mock@1.0.0";
  readonly provider = "OFFLINE_MOCK";
  calls = 0;
  constructor(private readonly draft: unknown = validDraft()) {}
  async generateDraft(
    request: Readonly<AiProviderRequestV1>,
    options: Readonly<{
      signal?: AbortSignal;
      prompt_version: PromptVersionMetadataV1;
      prompt_content: ProviderResolvedPromptContentV1;
    }>,
  ) {
    void options;
    this.calls += 1;
    return providerResponse(structuredClone(request), this.draft);
  }
}

const mockModel = {
  ...OPENAI_SETTLEMENT_MODEL_CONFIGURATION,
  configuration_id: "offline-controlled-mock@1.0.0",
  provider: "OFFLINE_MOCK",
  model_id: "offline-settlement-mock-1",
  model_revision: "fixture-1",
};

describe("Task 3.4D controlled AI settlement intelligence", () => {
  it("runs the full offline provider chain and finalizes an immutable Shadow snapshot", async () => {
    const provider = new OfflineProvider();
    const result = await generateControlledSettlementAiIntelligence({
      ...upstream(),
      adapter: provider,
      model: mockModel,
      clock: () => GENERATED_AT,
    });

    expect(result.status).toBe("READY");
    expect(provider.calls).toBe(1);
    expect(result.recommendation_snapshot?.mode).toBe("SHADOW");
    expect(result.recommendation_snapshot?.recommendations[0].automatic_execution).toBe(false);
    expect(result.recommendation_snapshot?.recommendations[0].referenced_values[0].value).toBe("50.0000");
    expect(Object.values(result.shadow_guard).every((value) => value === false)).toBe(true);
    expect(Object.isFrozen(result.recommendation_snapshot)).toBe(true);
  });

  it("fails closed when evidence is missing, a decimal is changed, or execution language is returned", async () => {
    const cases = [
      { ...validDraft(), fact_summary: [{ ...validDraft().fact_summary[0], evidence_ids: [] }] },
      { ...validDraft(), fact_summary: [{ ...validDraft().fact_summary[0], claim_text: "可结算资金缺口为 51.0000 VND。" }] },
      { ...validDraft(), recommendations: [{ ...validDraft().recommendations[0], statement: "Execute payment now." }] },
      { ...validDraft(), recommendations: [{ ...validDraft().recommendations[0], statement: "建议补U 50.0000 VND。" }] },
    ];
    for (const draft of cases) {
      const result = await generateControlledSettlementAiIntelligence({
        ...upstream(),
        adapter: new OfflineProvider(draft),
        model: mockModel,
        clock: () => GENERATED_AT,
      });
      expect(result.status).toBe("VALIDATION_FAILED");
      expect(result.recommendation_snapshot).toBeNull();
      expect(result.validation_issues.length).toBeGreaterThan(0);
    }
  });

  it("degrades safely when the real provider secret is absent", async () => {
    expect(createConfiguredOpenAiSettlementAdapter({}).configured).toBe(false);
    const result = await providerNotConfiguredResult(
      OPENAI_SETTLEMENT_MODEL_CONFIGURATION,
    );
    expect(result.status).toBe("PROVIDER_NOT_CONFIGURED");
    expect(result.attempts).toBe(0);
    expect(result.recommendation_snapshot).toBeNull();
  });

  it("retries a transient provider failure at most once and exposes no secret", async () => {
    const secret = "test-secret-never-return";
    let calls = 0;
    const adapter = new OpenAiSettlementProviderAdapter({
      apiKey: secret,
      fetcher: async () => {
        calls += 1;
        throw new Error("offline timeout fixture");
      },
      clock: () => GENERATED_AT,
    });
    const result = await generateControlledSettlementAiIntelligence({
      ...upstream(),
      adapter,
      model: OPENAI_SETTLEMENT_MODEL_CONFIGURATION,
      clock: () => GENERATED_AT,
    });
    expect(result.status).toBe("PROVIDER_FAILED");
    expect(result.attempts).toBe(2);
    expect(calls).toBe(2);
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it("sends store false and excludes identities, account data, raw orders, audit logs, and secrets", async () => {
    const { snapshot, calculation } = upstream();
    const sensitiveValues = [
      "MERCHANT-REAL-NAME-991",
      "WALLET-0xSECRET991",
      "ACCOUNT-6222991001",
      "ORDER-RAW-991",
      "AUDIT-RAW-991",
      "BODY-SECRET-991",
    ];
    Object.assign(snapshot as unknown as Record<string, unknown>, {
      merchant_contexts: [{ merchant_name: sensitiveValues[0] }],
      balance_position: {
        wallet_address: sensitiveValues[1],
        account_number: sensitiveValues[2],
      },
      raw_order_details: [{ order_id: sensitiveValues[3] }],
    });
    Object.assign(calculation as unknown as Record<string, unknown>, {
      audit_log: sensitiveValues[4],
    });
    const requestBodies: Array<Record<string, unknown>> = [];
    const adapter = new OpenAiSettlementProviderAdapter({
      apiKey: sensitiveValues[5],
      fetcher: async (_input, init) => {
        requestBodies.push(
          JSON.parse(String(init?.body)) as Record<string, unknown>,
        );
        return new Response("{}", { status: 503 });
      },
      clock: () => GENERATED_AT,
    });
    const result = await generateControlledSettlementAiIntelligence({
      snapshot,
      calculation,
      adapter,
      model: OPENAI_SETTLEMENT_MODEL_CONFIGURATION,
      clock: () => GENERATED_AT,
    });

    expect(result.status).toBe("PROVIDER_FAILED");
    expect(result.recommendation_snapshot).toBeNull();
    expect(requestBodies).toHaveLength(2);
    for (const body of requestBodies) {
      expect(Object.keys(body).sort()).toEqual([
        "background",
        "input",
        "instructions",
        "max_output_tokens",
        "model",
        "store",
        "temperature",
        "text",
        "top_p",
      ]);
      expect(body.store).toBe(false);
      expect(body.model).toBe(OPENAI_SETTLEMENT_MODEL_ID);
      const promptInput = String(body.input);
      const structuredInput = JSON.parse(
        promptInput.slice(promptInput.indexOf("{")),
      ) as Record<string, unknown>;
      expect(Object.keys(structuredInput).sort()).toEqual([
        "ai_input_digest",
        "ai_request_id",
        "approved_fact_projection",
        "as_of",
        "blocking_reasons",
        "contract_version",
        "currency",
        "evidence_catalog",
        "limitations",
        "mode",
        "presentation_context",
        "requested_scopes",
        "shadow_guard",
      ]);
      const serialized = JSON.stringify(body);
      for (const sensitive of sensitiveValues) {
        expect(serialized).not.toContain(sensitive);
      }
      expect(serialized).not.toMatch(
        /merchant_name|wallet_address|account_number|raw_order_details|audit_log|api_key/i,
      );
    }
  });

  it("fails closed before provider invocation when a limitation contains free-form sensitive data", async () => {
    const { snapshot, calculation } = upstream();
    snapshot.data_quality.limitations = ["Merchant Jane Doe account 991"];
    calculation.limitations = ["Merchant Jane Doe account 991"];
    const provider = new OfflineProvider();
    const result = await generateControlledSettlementAiIntelligence({
      snapshot,
      calculation,
      adapter: provider,
      model: mockModel,
      clock: () => GENERATED_AT,
    });
    expect(result.status).toBe("PROVIDER_FAILED");
    expect(result.recommendation_snapshot).toBeNull();
    expect(provider.calls).toBe(0);
  });

  it("fails closed when the pinned model is unavailable and never switches models", async () => {
    const requestedModels: string[] = [];
    const adapter = new OpenAiSettlementProviderAdapter({
      apiKey: "test-secret",
      fetcher: async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as { model: string };
        requestedModels.push(body.model);
        return new Response("{}", { status: 404 });
      },
      clock: () => GENERATED_AT,
    });
    const result = await generateControlledSettlementAiIntelligence({
      ...upstream(),
      adapter,
      model: OPENAI_SETTLEMENT_MODEL_CONFIGURATION,
      clock: () => GENERATED_AT,
    });
    expect(result.status).toBe("PROVIDER_FAILED");
    expect(result.recommendation_snapshot).toBeNull();
    expect(result.attempts).toBe(1);
    expect(requestedModels).toEqual([OPENAI_SETTLEMENT_MODEL_ID]);
  });

  it("rejects a malformed real-provider draft without creating a snapshot", async () => {
    const adapter = new OpenAiSettlementProviderAdapter({
      apiKey: "test-secret",
      fetcher: async () =>
        new Response(
          JSON.stringify({
            id: "response-fixture",
            model: OPENAI_SETTLEMENT_MODEL_ID,
            status: "completed",
            output: [
              {
                type: "message",
                content: [{ type: "output_text", text: "not-json" }],
              },
            ],
            usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      clock: () => GENERATED_AT,
    });
    const result = await generateControlledSettlementAiIntelligence({
      ...upstream(),
      adapter,
      model: OPENAI_SETTLEMENT_MODEL_CONFIGURATION,
      clock: () => GENERATED_AT,
    });
    expect(result.status).toBe("VALIDATION_FAILED");
    expect(result.recommendation_snapshot).toBeNull();
    expect(result.validation_issues.map((issue) => issue.code)).toContain(
      "AI_DRAFT_SCHEMA_INVALID",
    );
  });

  it("pins an exact allowlisted model and immutable prompt digests", async () => {
    const bundle = await loadSettlementAiMvpPromptBundle();
    expect(OPENAI_SETTLEMENT_MODEL_ID).toBe("gpt-4.1-2025-04-14");
    expect(OPENAI_SETTLEMENT_MODEL_ID).not.toContain("latest");
    expect(bundle.metadata.bundle_digest).toBe(
      SETTLEMENT_AI_MVP_PINNED_PROMPT_DIGESTS.bundle_digest,
    );
    expect(bundle.metadata.immutable).toBe(true);
  });

  it("blocks concurrent and duplicate manual submissions without storing payloads", () => {
    let now = 1_000;
    const guard = new SettlementAiTriggerGuard(100, () => now);
    const first = guard.acquire("user-1", "request-1");
    expect(first.status).toBe("ACQUIRED");
    expect(guard.acquire("user-1", "request-1").status).toBe("IN_PROGRESS");
    expect(guard.acquire("user-1", "request-2").status).toBe("IN_PROGRESS");
    first.release?.();
    expect(guard.acquire("user-1", "request-1").status).toBe("DUPLICATE");
    now += 101;
    expect(guard.acquire("user-1", "request-1").status).toBe("ACQUIRED");
  });

  it("keeps the API manual, role protected, read-only, and free of scheduling hooks", async () => {
    const route = readFileSync(
      resolve(process.cwd(), "app/api/settlement-intelligence/ai/route.ts"),
      "utf8",
    );
    expect(route).toContain("authorizeInternalRequest");
    expect(route).toContain('"admin"');
    expect(route).toContain('"settlement_operator"');
    expect(route).not.toMatch(/\.(insert|update|upsert|delete|rpc)\s*\(/);
    expect(route).not.toMatch(/cron|schedule|lark/i);
    expect(await stableSnapshotDigest(route)).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});
