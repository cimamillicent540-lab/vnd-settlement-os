import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  AI_RECOMMENDATION_INPUT_CONTRACT_VERSION,
  AiRecommendationInputSchema,
  type AiRecommendationInputV1,
} from "../lib/settlement-ai-recommendation-framework";
import {
  AI_PROVIDER_ADAPTER_CONTRACT_VERSION,
  AI_PROVIDER_DRAFT_CONTRACT_VERSION,
  AI_PROVIDER_MODEL_METADATA_CONTRACT_VERSION,
  AI_PROVIDER_PROMPT_METADATA_CONTRACT_VERSION,
  AI_PROVIDER_REQUEST_CONTRACT_VERSION,
  AI_PROVIDER_RESPONSE_CONTRACT_VERSION,
  AiProviderRequestSchema,
  AiProviderResponseSchema,
  PromptVersionMetadataSchema,
  ProviderDraftObjectSchema,
  ProviderModelMetadataSchema,
  buildAiProviderRequest,
  parseAiProviderResponse,
  parseProviderDraft,
  providerAdapterContractHasNoExecutionCapability,
  type AiProviderAdapterV1,
  type AiProviderResponseV1,
  type PromptVersionMetadataV1,
  type ProviderModelMetadataV1,
} from "../lib/settlement-ai-provider-adapter";
import { SETTLEMENT_DETERMINISTIC_CONTRACT_VERSION } from "../lib/settlement-deterministic-calculation";
import { SETTLEMENT_INPUT_CONTRACT_VERSION } from "../lib/settlement-input-snapshot";

const AS_OF = "2026-07-31T03:00:00.000Z";
const REQUESTED_AT = "2026-07-31T03:01:00.000Z";
const COMPLETED_AT = "2026-07-31T03:01:01.000Z";
const AI_REQUEST_ID = "00000000-0000-4000-8000-000000000301";
const ADAPTER_REQUEST_ID =
  "00000000-0000-4000-8000-000000000302";
const SNAPSHOT_ID = "00000000-0000-4000-8000-000000000303";
const EVIDENCE_ID = "00000000-0000-4000-8000-000000000304";
const FACT_ID = "00000000-0000-4000-8000-000000000305";
const CLAIM_ID = "00000000-0000-4000-8000-000000000306";
const RECOMMENDATION_ID =
  "00000000-0000-4000-8000-000000000307";

const INPUT_DIGEST = `sha256:${"1".repeat(64)}`;
const RULESET_DIGEST = `sha256:${"2".repeat(64)}`;
const RESULT_DIGEST = `sha256:${"3".repeat(64)}`;
const EVIDENCE_DIGEST = `sha256:${"4".repeat(64)}`;
const PROMPT_DIGEST = `sha256:${"5".repeat(64)}`;
const FINAL_SCHEMA_DIGEST = `sha256:${"6".repeat(64)}`;
const DRAFT_SCHEMA_DIGEST = `sha256:${"7".repeat(64)}`;
const BUNDLE_DIGEST = `sha256:${"8".repeat(64)}`;
const PROVIDER_RESPONSE_DIGEST = `sha256:${"9".repeat(64)}`;

function aiInput(): AiRecommendationInputV1 {
  return AiRecommendationInputSchema.parse({
    contract_version: AI_RECOMMENDATION_INPUT_CONTRACT_VERSION,
    ai_request_id: AI_REQUEST_ID,
    requested_at: REQUESTED_AT,
    as_of: AS_OF,
    currency: "VND",
    operating_timezone: "Asia/Shanghai",
    mode: "SHADOW",
    input_snapshot_ref: {
      contract_version: SETTLEMENT_INPUT_CONTRACT_VERSION,
      snapshot_id: SNAPSHOT_ID,
      input_digest: INPUT_DIGEST,
      data_quality_status: "COMPLETE",
      evidence_ids: [EVIDENCE_ID],
    },
    calculation_result_ref: {
      contract_version: SETTLEMENT_DETERMINISTIC_CONTRACT_VERSION,
      engine_version: "1.0.0",
      snapshot_id: SNAPSHOT_ID,
      input_digest: INPUT_DIGEST,
      ruleset_version: "1.0.0",
      ruleset_digest: RULESET_DIGEST,
      result_digest: RESULT_DIGEST,
      status: "COMPLETE",
      evidence_refs: [EVIDENCE_ID],
    },
    approved_fact_projection: {
      projection_version: "SETTLEMENT_AI_FACT_PROJECTION_V1",
      facts: [
        {
          fact_id: FACT_ID,
          source: "DETERMINISTIC_RESULT",
          source_path:
            "liquidity_result.settleable_capacity_gap_vnd",
          value_type: "DECIMAL",
          value: "50.0000",
          unit: "VND",
          status: "COMPLETE",
          evidence_ids: [EVIDENCE_ID],
          limitations: [],
        },
      ],
    },
    evidence_catalog: [
      {
        evidence_id: EVIDENCE_ID,
        source_key: "BALANCE_POSITION",
        content_digest: EVIDENCE_DIGEST,
        observed_at: AS_OF,
        cutoff_at: AS_OF,
        freshness_status: "FRESH",
        completeness_status: "COMPLETE",
        redaction_status: "NO_SECRETS_INCLUDED",
      },
    ],
    limitations: [],
    blocking_reasons: [],
    requested_scopes: ["FACT_EXPLANATION", "LIQUIDITY_REVIEW"],
    presentation_context: {
      language: "zh-CN",
      audience: "SETTLEMENT_OPERATOR",
      output_style: "STRUCTURED_FACTUAL",
    },
    prompt_contract_ref: {
      prompt_contract_code: "VND_SETTLEMENT_AI_PROMPT",
      prompt_contract_version: "1.0.0",
      system_prompt_digest: PROMPT_DIGEST,
      developer_prompt_digest: PROMPT_DIGEST,
      user_input_template_digest: PROMPT_DIGEST,
      output_schema_version: "1.0.0",
      output_schema_digest: FINAL_SCHEMA_DIGEST,
      safety_policy_version: "1.0.0",
      allowed_scope_version: "1.0.0",
      language: "zh-CN",
    },
    output_schema_ref: {
      schema_code: "SETTLEMENT_AI_RECOMMENDATION_OUTPUT_V1",
      schema_version: "1.0.0",
      schema_digest: FINAL_SCHEMA_DIGEST,
    },
    shadow_guard: {
      automatic_topup: false,
      automatic_payment: false,
      automatic_quote_change: false,
      automatic_trading: false,
      automatic_channel_switch: false,
      third_party_submission: false,
      approval_workflow: false,
    },
    ai_input_digest: INPUT_DIGEST,
  });
}

function promptVersion(): PromptVersionMetadataV1 {
  return PromptVersionMetadataSchema.parse({
    contract_version: AI_PROVIDER_PROMPT_METADATA_CONTRACT_VERSION,
    bundle_id: "vnd-settlement-ai-prompt@1.0.0",
    prompt_contract_ref: aiInput().prompt_contract_ref,
    final_output_schema_ref: aiInput().output_schema_ref,
    provider_draft_schema_ref: {
      schema_code: AI_PROVIDER_DRAFT_CONTRACT_VERSION,
      schema_version: "1.0.0",
      schema_digest: DRAFT_SCHEMA_DIGEST,
    },
    bundle_digest: BUNDLE_DIGEST,
    release_status: "RELEASED",
    released_at: "2026-07-31T00:00:00.000Z",
    immutable: true,
    mode: "SHADOW",
    tool_policy: "NO_TOOLS",
  });
}

function modelMetadata(): ProviderModelMetadataV1 {
  return ProviderModelMetadataSchema.parse({
    contract_version: AI_PROVIDER_MODEL_METADATA_CONTRACT_VERSION,
    configuration_id: "test-provider-model@1.0.0",
    provider: "TEST_PROVIDER",
    model_id: "test-model-2026-07-31",
    model_revision: "revision-1",
    deployment_id: null,
    temperature: "0",
    top_p: "1",
    max_output_tokens: 2_000,
    seed: 7,
    structured_output_mode: true,
    tool_policy: "NO_TOOLS",
    timeout_ms: 30_000,
    mode: "SHADOW",
    allowlisted: true,
  });
}

function providerRequest() {
  return buildAiProviderRequest({
    adapter_request_id: ADAPTER_REQUEST_ID,
    requested_at: REQUESTED_AT,
    ai_input: aiInput(),
    prompt_version: promptVersion(),
    model: modelMetadata(),
  });
}

function providerDraft() {
  return {
    contract_version: AI_PROVIDER_DRAFT_CONTRACT_VERSION,
    fact_summary: [
      {
        claim_id: CLAIM_ID,
        claim_text:
          "The deterministic result reports a settleable capacity gap.",
        claim_type: "DETERMINISTIC_FACT",
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
        recommendation_id: RECOMMENDATION_ID,
        recommendation_type: "LIQUIDITY_REVIEW",
        title: "Liquidity review",
        statement:
          "The reported capacity gap requires human operational review.",
        reason_codes: ["SETTLEABLE_CAPACITY_GAP_PRESENT"],
        priority: "MEDIUM",
        human_review_request:
          "Review the existing funding arrangements.",
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
  } as const;
}

function modelRunMetadata() {
  return {
    provider: "TEST_PROVIDER",
    model_id: "test-model-2026-07-31",
    model_revision: "revision-1",
    deployment_id: null,
    provider_request_id: "provider-request-1",
    generation_started_at: REQUESTED_AT,
    generation_completed_at: COMPLETED_AT,
    temperature: "0",
    top_p: "1",
    max_output_tokens: 2_000,
    seed: 7,
    structured_output_mode: true,
    tool_policy: "NO_TOOLS",
    input_tokens: 100,
    output_tokens: 50,
  } as const;
}

function completedResponse() {
  return {
    contract_version: AI_PROVIDER_RESPONSE_CONTRACT_VERSION,
    adapter_request_id: ADAPTER_REQUEST_ID,
    ai_request_id: AI_REQUEST_ID,
    received_at: COMPLETED_AT,
    model_run_metadata: modelRunMetadata(),
    provider_response_digest: PROVIDER_RESPONSE_DIGEST,
    outcome: "COMPLETED",
    draft: providerDraft(),
    failure: null,
  } as const;
}

function failedResponse() {
  return {
    contract_version: AI_PROVIDER_RESPONSE_CONTRACT_VERSION,
    adapter_request_id: ADAPTER_REQUEST_ID,
    ai_request_id: AI_REQUEST_ID,
    received_at: COMPLETED_AT,
    model_run_metadata: {
      ...modelRunMetadata(),
      provider_request_id: null,
      input_tokens: null,
      output_tokens: null,
    },
    provider_response_digest: null,
    outcome: "TIMEOUT",
    draft: null,
    failure: {
      code: "AI_PROVIDER_TIMEOUT",
      retryable: true,
      safe_message: "Provider request timed out.",
      http_status: null,
    },
  } as const;
}

describe("Task 3.4B-1 provider-neutral request contract", () => {
  it("builds a frozen Shadow-only request from the finalized AI input", () => {
    const input = aiInput();
    const inputBefore = structuredClone(input);
    const request = providerRequest();

    expect(request.contract_version).toBe(
      AI_PROVIDER_REQUEST_CONTRACT_VERSION,
    );
    expect(request.structured_input.ai_input_digest).toBe(INPUT_DIGEST);
    expect(request.structured_input).not.toHaveProperty(
      "input_snapshot_ref",
    );
    expect(request.structured_input).not.toHaveProperty(
      "calculation_result_ref",
    );
    expect(request.tool_policy).toBe("NO_TOOLS");
    expect(Object.values(request.shadow_guard).every((flag) => !flag)).toBe(
      true,
    );
    expect(Object.isFrozen(request)).toBe(true);
    expect(Object.isFrozen(request.structured_input)).toBe(true);
    expect(input).toEqual(inputBefore);
  });

  it("rejects mismatched prompt and finalized output metadata", () => {
    const prompt = promptVersion();
    expect(() =>
      buildAiProviderRequest({
        adapter_request_id: ADAPTER_REQUEST_ID,
        requested_at: REQUESTED_AT,
        ai_input: aiInput(),
        prompt_version: {
          ...prompt,
          prompt_contract_ref: {
            ...prompt.prompt_contract_ref,
            prompt_contract_version: "2.0.0",
          },
        },
        model: modelMetadata(),
      }),
    ).toThrow(/Prompt version metadata/);
  });

  it("rejects request identity, timeout, or schema drift", () => {
    const request = providerRequest();
    expect(
      AiProviderRequestSchema.safeParse({
        ...request,
        ai_request_id: "00000000-0000-4000-8000-999999999999",
      }).success,
    ).toBe(false);
    expect(
      AiProviderRequestSchema.safeParse({
        ...request,
        timeout_ms: request.timeout_ms + 1,
      }).success,
    ).toBe(false);
  });
});

describe("Task 3.4B-1 prompt and model metadata", () => {
  it("requires immutable exact prompt versions and matching digests", () => {
    const prompt = promptVersion();
    expect(prompt.immutable).toBe(true);
    expect(prompt.tool_policy).toBe("NO_TOOLS");
    expect(
      PromptVersionMetadataSchema.safeParse({
        ...prompt,
        prompt_contract_ref: {
          ...prompt.prompt_contract_ref,
          prompt_contract_version: "latest",
        },
      }).success,
    ).toBe(false);
    expect(
      PromptVersionMetadataSchema.safeParse({
        ...prompt,
        final_output_schema_ref: {
          ...prompt.final_output_schema_ref,
          schema_digest: INPUT_DIGEST,
        },
      }).success,
    ).toBe(false);
  });

  it("requires an allowlisted structured-output model with no tools", () => {
    const model = modelMetadata();
    expect(model.tool_policy).toBe("NO_TOOLS");
    expect(model.allowlisted).toBe(true);
    expect(
      ProviderModelMetadataSchema.safeParse({
        ...model,
        tool_policy: "AUTO",
      }).success,
    ).toBe(false);
    expect(
      ProviderModelMetadataSchema.safeParse({
        ...model,
        allowlisted: false,
      }).success,
    ).toBe(false);
  });
});

describe("Task 3.4B-1 provider draft and response contracts", () => {
  it("parses and freezes only the restricted provider draft", () => {
    const draft = parseProviderDraft(providerDraft());
    expect(draft.contract_version).toBe(
      AI_PROVIDER_DRAFT_CONTRACT_VERSION,
    );
    expect(Object.isFrozen(draft)).toBe(true);
    expect(draft).not.toHaveProperty("status");
    expect(draft).not.toHaveProperty("confidence");
    expect(draft).not.toHaveProperty("shadow_guard");
  });

  it("rejects provider attempts to set authority or execution fields", () => {
    expect(
      ProviderDraftObjectSchema.safeParse({
        ...providerDraft(),
        status: "ACTIVE",
        authoritative: true,
        confidence: "1.000000",
        automatic_execution: true,
        approval_status: "APPROVED",
      }).success,
    ).toBe(false);
    expect(
      ProviderDraftObjectSchema.safeParse({
        ...providerDraft(),
        recommendations: [
          {
            ...providerDraft().recommendations[0],
            automatic_execution: false,
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("normalizes completed and failed responses without snapshots", () => {
    const completed = parseAiProviderResponse(completedResponse());
    const failed = parseAiProviderResponse(failedResponse());

    expect(completed.outcome).toBe("COMPLETED");
    expect(completed.draft).not.toBeNull();
    expect(failed.outcome).toBe("TIMEOUT");
    expect(failed.draft).toBeNull();
    expect(failed.failure?.retryable).toBe(true);
    expect(Object.isFrozen(completed)).toBe(true);
    expect(Object.isFrozen(failed)).toBe(true);
  });

  it("requires the normalized failure code to match the outcome", () => {
    expect(
      AiProviderResponseSchema.safeParse({
        ...failedResponse(),
        failure: {
          ...failedResponse().failure,
          code: "AI_PROVIDER_REFUSED",
        },
      }).success,
    ).toBe(false);
  });
});

describe("Task 3.4B-1 adapter and safety boundary", () => {
  it("supports an offline provider-neutral adapter interface", async () => {
    const response = parseAiProviderResponse(failedResponse());
    const adapter: AiProviderAdapterV1 = {
      contract_version: AI_PROVIDER_ADAPTER_CONTRACT_VERSION,
      adapter_id: "offline-test-adapter",
      provider: "TEST_PROVIDER",
      async generateDraft(): Promise<AiProviderResponseV1> {
        return response;
      },
    };

    expect(
      (
        await adapter.generateDraft(providerRequest(), {
          prompt_version: promptVersion(),
          prompt_content: {
            system_prompt: "Explain approved facts only.",
            developer_prompt: "Return strict JSON in Shadow Mode.",
            user_input_template: "{{structured_input}}",
            provider_draft_schema_json: { type: "object" },
            safety_policy: "No tools and no execution.",
            allowed_scopes: ["FACT_EXPLANATION"],
            language: "zh-CN",
          },
        })
      ).outcome,
    ).toBe("TIMEOUT");
  });

  it("contains no provider call, database write, snapshot assembly, approval, or execution capability", () => {
    const sourceCode = readFileSync(
      resolve(
        process.cwd(),
        "lib/settlement-ai-provider-adapter.ts",
      ),
      "utf8",
    );

    expect(sourceCode).not.toMatch(
      /\bfetch\s*\(|chat\.completions|responses\.create|@supabase|createClient/,
    );
    expect(sourceCode).not.toMatch(
      /\.(insert|update|upsert|delete|rpc)\s*\(|finalizeRecommendationSnapshot|RecommendationSnapshotSchema/,
    );
    expect(providerAdapterContractHasNoExecutionCapability()).toBe(true);
  });
});
