import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  AI_RECOMMENDATION_INPUT_CONTRACT_VERSION,
  AiRecommendationInputSchema,
  type AiRecommendationInputV1,
} from "../lib/settlement-ai-recommendation-framework";
import {
  AI_PROVIDER_DRAFT_CONTRACT_VERSION,
  AI_PROVIDER_MODEL_METADATA_CONTRACT_VERSION,
  AI_PROVIDER_PROMPT_METADATA_CONTRACT_VERSION,
  AI_PROVIDER_RESPONSE_CONTRACT_VERSION,
  PromptVersionMetadataSchema,
  ProviderModelMetadataSchema,
  buildAiProviderRequest,
  type AiProviderRequestV1,
  type PromptVersionMetadataV1,
  type ProviderDraftObjectV1,
  type ProviderModelMetadataV1,
} from "../lib/settlement-ai-provider-adapter";
import {
  AI_PROVIDER_VALIDATION_CONTRACT_VERSION,
  AiProviderValidationResultSchema,
  providerValidationHasNoExecutionCapability,
  validateAiDraftSchema,
  validateAiProviderResult,
  validateDecimalIntegrity,
  validateEvidenceReferences,
  validateRestrictionLanguage,
  validateShadowGuard,
} from "../lib/settlement-ai-provider-validation";
import { SETTLEMENT_DETERMINISTIC_CONTRACT_VERSION } from "../lib/settlement-deterministic-calculation";
import { SETTLEMENT_INPUT_CONTRACT_VERSION } from "../lib/settlement-input-snapshot";

const AS_OF = "2026-08-01T03:00:00.000Z";
const REQUESTED_AT = "2026-08-01T03:01:00.000Z";
const COMPLETED_AT = "2026-08-01T03:01:01.000Z";
const VALIDATED_AT = "2026-08-01T03:01:02.000Z";
const AI_REQUEST_ID = "00000000-0000-4000-8000-000000000401";
const ADAPTER_REQUEST_ID =
  "00000000-0000-4000-8000-000000000402";
const SNAPSHOT_ID = "00000000-0000-4000-8000-000000000403";
const EVIDENCE_ID = "00000000-0000-4000-8000-000000000404";
const UNKNOWN_EVIDENCE_ID =
  "00000000-0000-4000-8000-999999999404";
const FACT_ID = "00000000-0000-4000-8000-000000000405";
const CLAIM_ID = "00000000-0000-4000-8000-000000000406";
const RECOMMENDATION_ID =
  "00000000-0000-4000-8000-000000000407";

const INPUT_DIGEST = `sha256:${"1".repeat(64)}`;
const RULESET_DIGEST = `sha256:${"2".repeat(64)}`;
const RESULT_DIGEST = `sha256:${"3".repeat(64)}`;
const EVIDENCE_DIGEST = `sha256:${"4".repeat(64)}`;
const PROMPT_DIGEST = `sha256:${"5".repeat(64)}`;
const FINAL_SCHEMA_DIGEST = `sha256:${"6".repeat(64)}`;
const DRAFT_SCHEMA_DIGEST = `sha256:${"7".repeat(64)}`;
const BUNDLE_DIGEST = `sha256:${"8".repeat(64)}`;
const PROVIDER_RESPONSE_DIGEST = `sha256:${"9".repeat(64)}`;

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalize(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map(
      (key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`,
    )
    .join(",")}}`;
}

function stableDigest(value: unknown) {
  return `sha256:${createHash("sha256")
    .update(canonicalize(value))
    .digest("hex")}`;
}

function aiInput(): AiRecommendationInputV1 {
  const candidate = {
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
  };
  return AiRecommendationInputSchema.parse({
    ...candidate,
    ai_input_digest: stableDigest(candidate),
  });
}

function promptVersion(): PromptVersionMetadataV1 {
  const input = aiInput();
  return PromptVersionMetadataSchema.parse({
    contract_version: AI_PROVIDER_PROMPT_METADATA_CONTRACT_VERSION,
    bundle_id: "vnd-settlement-ai-prompt@1.0.0",
    prompt_contract_ref: input.prompt_contract_ref,
    final_output_schema_ref: input.output_schema_ref,
    provider_draft_schema_ref: {
      schema_code: AI_PROVIDER_DRAFT_CONTRACT_VERSION,
      schema_version: "1.0.0",
      schema_digest: DRAFT_SCHEMA_DIGEST,
    },
    bundle_digest: BUNDLE_DIGEST,
    release_status: "RELEASED",
    released_at: "2026-08-01T00:00:00.000Z",
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
    model_id: "test-model-2026-08-01",
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

function providerRequest(): AiProviderRequestV1 {
  return buildAiProviderRequest({
    adapter_request_id: ADAPTER_REQUEST_ID,
    requested_at: REQUESTED_AT,
    ai_input: aiInput(),
    prompt_version: promptVersion(),
    model: modelMetadata(),
  });
}

function providerDraft(): ProviderDraftObjectV1 {
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
  };
}

function modelRunMetadata() {
  return {
    provider: "TEST_PROVIDER",
    model_id: "test-model-2026-08-01",
    model_revision: "revision-1",
    deployment_id: null,
    provider_request_id: "provider-request-1",
    generation_started_at: REQUESTED_AT,
    generation_completed_at: COMPLETED_AT,
    temperature: "0",
    top_p: "1",
    max_output_tokens: 2_000,
    seed: 7,
    structured_output_mode: true as const,
    tool_policy: "NO_TOOLS" as const,
    input_tokens: 100,
    output_tokens: 50,
  };
}

function completedResponse(draft: unknown = providerDraft()) {
  return {
    contract_version: AI_PROVIDER_RESPONSE_CONTRACT_VERSION,
    adapter_request_id: ADAPTER_REQUEST_ID,
    ai_request_id: AI_REQUEST_ID,
    received_at: COMPLETED_AT,
    model_run_metadata: modelRunMetadata(),
    provider_response_digest: PROVIDER_RESPONSE_DIGEST,
    outcome: "COMPLETED",
    draft,
    failure: null,
  };
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
  };
}

function issueCodes(result: Awaited<ReturnType<typeof validateAiProviderResult>>) {
  return result.issues.map((item) => item.code);
}

describe("Task 3.4B-2 accepted validation", () => {
  it("accepts a valid draft and binds exact decimal strings without creating a snapshot", async () => {
    const input = aiInput();
    const request = providerRequest();
    const inputBefore = structuredClone(input);
    const requestBefore = structuredClone(request);
    const response = completedResponse();
    const responseBefore = structuredClone(response);

    const result = await validateAiProviderResult({
      ai_input: input,
      request,
      response,
      validated_at: VALIDATED_AT,
    });

    expect(result.contract_version).toBe(
      AI_PROVIDER_VALIDATION_CONTRACT_VERSION,
    );
    expect(result.status).toBe("ACCEPTED");
    expect(result.validated_draft).not.toBeNull();
    expect(result.draft_digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(result.decimal_bindings).toEqual([
      {
        source: "DETERMINISTIC_RESULT",
        source_path:
          "liquidity_result.settleable_capacity_gap_vnd",
        value: "50.0000",
        unit: "VND",
        status: "COMPLETE",
        evidence_ids: [EVIDENCE_ID],
      },
    ]);
    expect(result.recommendation_snapshot_generated).toBe(false);
    expect(result.database_write_performed).toBe(false);
    expect(result.execution_performed).toBe(false);
    expect(Object.isFrozen(result)).toBe(true);
    expect(input).toEqual(inputBefore);
    expect(request).toEqual(requestBefore);
    expect(response).toEqual(responseBefore);
  });

  it("exposes the component validators as deterministic checks", () => {
    const draft = providerDraft();
    const request = providerRequest();
    expect(validateAiDraftSchema(draft).valid).toBe(true);
    expect(validateEvidenceReferences(draft, request).valid).toBe(true);
    expect(
      validateDecimalIntegrity(aiInput(), request, draft).valid,
    ).toBe(true);
    expect(validateRestrictionLanguage(draft)).toEqual([]);
    expect(validateShadowGuard(aiInput(), request, draft)).toEqual([]);
  });
});

describe("Task 3.4B-2 fail-closed validation", () => {
  it("rejects an illegal provider draft schema and returns no draft", async () => {
    const malformedDraft = {
      ...providerDraft(),
      confidence: "1.000000",
      authoritative: true,
    };
    const result = await validateAiProviderResult({
      ai_input: aiInput(),
      request: providerRequest(),
      response: completedResponse(malformedDraft),
      validated_at: VALIDATED_AT,
    });

    expect(result.status).toBe("REJECTED");
    expect(result.validated_draft).toBeNull();
    expect(result.decimal_bindings).toEqual([]);
    expect(issueCodes(result)).toContain("AI_DRAFT_SCHEMA_INVALID");
  });

  it("rejects missing evidence references", async () => {
    const draft = providerDraft();
    draft.fact_summary[0].evidence_ids = [UNKNOWN_EVIDENCE_ID];
    draft.recommendations[0].evidence_ids = [UNKNOWN_EVIDENCE_ID];
    const result = await validateAiProviderResult({
      ai_input: aiInput(),
      request: providerRequest(),
      response: completedResponse(draft),
      validated_at: VALIDATED_AT,
    });

    expect(result.status).toBe("REJECTED");
    expect(result.validated_draft).toBeNull();
    expect(issueCodes(result)).toContain(
      "AI_EVIDENCE_REFERENCE_MISSING",
    );
  });

  it("rejects a tampered decimal in the provider request projection", async () => {
    const request = structuredClone(providerRequest());
    request.structured_input.approved_fact_projection.facts[0].value =
      "500.0000";
    const result = await validateAiProviderResult({
      ai_input: aiInput(),
      request,
      response: completedResponse(),
      validated_at: VALIDATED_AT,
    });

    expect(result.status).toBe("REJECTED");
    expect(result.validated_draft).toBeNull();
    expect(issueCodes(result)).toContain(
      "AI_DECIMAL_INTEGRITY_REJECTED",
    );
  });

  it("rejects a finalized AI input whose canonical digest was invalidated", async () => {
    const input = structuredClone(aiInput());
    input.approved_fact_projection.facts[0].value = "500.0000";
    const result = await validateAiProviderResult({
      ai_input: input,
      request: providerRequest(),
      response: completedResponse(),
      validated_at: VALIDATED_AT,
    });

    expect(result.status).toBe("REJECTED");
    expect(issueCodes(result)).toContain("AI_INPUT_DIGEST_MISMATCH");
  });

  it("rejects referenced value paths that are not exact decimal facts", async () => {
    const draft = providerDraft();
    draft.recommendations[0].referenced_value_paths = [
      "liquidity_result.invented_amount_vnd",
    ];
    const result = await validateAiProviderResult({
      ai_input: aiInput(),
      request: providerRequest(),
      response: completedResponse(draft),
      validated_at: VALIDATED_AT,
    });

    expect(result.status).toBe("REJECTED");
    expect(issueCodes(result)).toContain(
      "AI_DECIMAL_INTEGRITY_REJECTED",
    );
  });

  it("rejects execution and approval language", async () => {
    const draft = providerDraft();
    draft.recommendations[0].statement =
      "Execute a topup immediately.";
    const result = await validateAiProviderResult({
      ai_input: aiInput(),
      request: providerRequest(),
      response: completedResponse(draft),
      validated_at: VALIDATED_AT,
    });

    expect(result.status).toBe("REJECTED");
    expect(result.validated_draft).toBeNull();
    expect(issueCodes(result)).toContain(
      "AI_RESTRICTION_LANGUAGE_REJECTED",
    );
  });

  it("rejects a true Shadow Guard before draft acceptance", async () => {
    const request = structuredClone(providerRequest());
    request.shadow_guard.automatic_payment = true as false;
    const result = await validateAiProviderResult({
      ai_input: aiInput(),
      request,
      response: completedResponse(),
      validated_at: VALIDATED_AT,
    });

    expect(result.status).toBe("REJECTED");
    expect(result.validated_draft).toBeNull();
    expect(issueCodes(result)).toContain("AI_SHADOW_GUARD_REJECTED");
  });

  it("returns PROVIDER_FAILED without a draft when the provider fails", async () => {
    const result = await validateAiProviderResult({
      ai_input: aiInput(),
      request: providerRequest(),
      response: failedResponse(),
      validated_at: VALIDATED_AT,
    });

    expect(result.status).toBe("PROVIDER_FAILED");
    expect(result.provider_outcome).toBe("TIMEOUT");
    expect(result.validated_draft).toBeNull();
    expect(result.draft_digest).toBeNull();
    expect(result.provider_failure?.code).toBe("AI_PROVIDER_TIMEOUT");
    expect(issueCodes(result)).toContain("AI_PROVIDER_TIMEOUT");
  });

  it("rejects response identity drift", async () => {
    const response = completedResponse();
    response.ai_request_id =
      "00000000-0000-4000-8000-999999999401";
    const result = await validateAiProviderResult({
      ai_input: aiInput(),
      request: providerRequest(),
      response,
      validated_at: VALIDATED_AT,
    });

    expect(result.status).toBe("REJECTED");
    expect(issueCodes(result)).toContain(
      "AI_RESPONSE_IDENTITY_MISMATCH",
    );
  });
});

describe("Task 3.4B-2 safety boundary", () => {
  it("parses every fail-closed result against the result contract", async () => {
    const accepted = await validateAiProviderResult({
      ai_input: aiInput(),
      request: providerRequest(),
      response: completedResponse(),
      validated_at: VALIDATED_AT,
    });
    const failed = await validateAiProviderResult({
      ai_input: aiInput(),
      request: providerRequest(),
      response: failedResponse(),
      validated_at: VALIDATED_AT,
    });
    expect(AiProviderValidationResultSchema.parse(accepted)).toEqual(
      accepted,
    );
    expect(AiProviderValidationResultSchema.parse(failed)).toEqual(failed);
  });

  it("contains no provider invocation, database write, snapshot assembly, approval, or execution capability", () => {
    const sourceCode = readFileSync(
      resolve(
        process.cwd(),
        "lib/settlement-ai-provider-validation.ts",
      ),
      "utf8",
    );

    expect(sourceCode).not.toMatch(
      /\bfetch\s*\(|chat\.completions|responses\.create|@supabase|createClient/,
    );
    expect(sourceCode).not.toMatch(
      /\.(insert|update|upsert|delete|rpc)\s*\(|finalizeRecommendationSnapshot|RecommendationSnapshotSchema/,
    );
    expect(providerValidationHasNoExecutionCapability()).toBe(true);
  });
});
