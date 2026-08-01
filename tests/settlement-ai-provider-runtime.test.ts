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
  AI_PROVIDER_RESPONSE_CONTRACT_VERSION,
  ProviderModelMetadataSchema,
  type AiProviderAdapterV1,
  type AiProviderRequestV1,
  type AiProviderResponseV1,
  type PromptVersionMetadataV1,
  type ProviderDraftObjectV1,
  type ProviderModelMetadataV1,
  type ProviderResolvedPromptContentV1,
} from "../lib/settlement-ai-provider-adapter";
import {
  AI_PROVIDER_PROMPT_BUNDLE_CONTRACT_VERSION,
  AI_PROVIDER_RUNTIME_CONTRACT_VERSION,
  AI_PROVIDER_RUNTIME_RESULT_CONTRACT_VERSION,
  AiProviderRuntimeResultSchema,
  InMemoryPromptVersionLoader,
  TokenUsageMetadataSchema,
  calculatePromptArtifactDigests,
  captureTokenUsage,
  createAiProviderRuntime,
  providerRuntimeHasNoExecutionCapability,
  type PromptArtifactBundleV1,
  type PromptArtifactContentV1,
} from "../lib/settlement-ai-provider-runtime";
import { SETTLEMENT_DETERMINISTIC_CONTRACT_VERSION } from "../lib/settlement-deterministic-calculation";
import {
  SETTLEMENT_INPUT_CONTRACT_VERSION,
  stableSnapshotDigest,
} from "../lib/settlement-input-snapshot";

const AS_OF = "2026-08-01T03:00:00.000Z";
const REQUESTED_AT = "2026-08-01T03:01:00.000Z";
const GENERATED_AT = "2026-08-01T03:01:01.000Z";
const RUNTIME_AT = "2026-08-01T03:01:02.000Z";
const AI_REQUEST_ID = "00000000-0000-4000-8000-000000000501";
const ADAPTER_REQUEST_ID =
  "00000000-0000-4000-8000-000000000502";
const SNAPSHOT_ID = "00000000-0000-4000-8000-000000000503";
const EVIDENCE_ID = "00000000-0000-4000-8000-000000000504";
const FACT_ID = "00000000-0000-4000-8000-000000000505";
const CLAIM_ID = "00000000-0000-4000-8000-000000000506";
const RECOMMENDATION_ID =
  "00000000-0000-4000-8000-000000000507";

const SNAPSHOT_INPUT_DIGEST = `sha256:${"1".repeat(64)}`;
const RULESET_DIGEST = `sha256:${"2".repeat(64)}`;
const RESULT_DIGEST = `sha256:${"3".repeat(64)}`;
const EVIDENCE_DIGEST = `sha256:${"4".repeat(64)}`;
const FINAL_SCHEMA_DIGEST = `sha256:${"6".repeat(64)}`;
const PROVIDER_RESPONSE_DIGEST = `sha256:${"9".repeat(64)}`;

function promptContent(): PromptArtifactContentV1 {
  return {
    system_prompt:
      "Explain only approved deterministic facts in Shadow Mode.",
    developer_prompt:
      "Return strict JSON. Never execute, approve, pay, trade, top up, or change quotes.",
    user_input_template: "{{structured_input}}",
    provider_draft_schema_json: {
      type: "object",
      additionalProperties: false,
      contract_version: AI_PROVIDER_DRAFT_CONTRACT_VERSION,
    },
    safety_policy:
      "Human review only. No action has been executed. No tools.",
    allowed_scopes: ["FACT_EXPLANATION", "LIQUIDITY_REVIEW"],
    language: "zh-CN",
  };
}

async function aiInput(): Promise<AiRecommendationInputV1> {
  const promptDigests = await calculatePromptArtifactDigests(
    promptContent(),
  );
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
      input_digest: SNAPSHOT_INPUT_DIGEST,
      data_quality_status: "COMPLETE",
      evidence_ids: [EVIDENCE_ID],
    },
    calculation_result_ref: {
      contract_version: SETTLEMENT_DETERMINISTIC_CONTRACT_VERSION,
      engine_version: "1.0.0",
      snapshot_id: SNAPSHOT_ID,
      input_digest: SNAPSHOT_INPUT_DIGEST,
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
      system_prompt_digest: promptDigests.system_prompt_digest,
      developer_prompt_digest: promptDigests.developer_prompt_digest,
      user_input_template_digest:
        promptDigests.user_input_template_digest,
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
    ai_input_digest: await stableSnapshotDigest(candidate),
  });
}

async function promptBundle(): Promise<PromptArtifactBundleV1> {
  const content = promptContent();
  const digests = await calculatePromptArtifactDigests(content);
  const input = await aiInput();
  return {
    contract_version: AI_PROVIDER_PROMPT_BUNDLE_CONTRACT_VERSION,
    metadata: {
      contract_version: AI_PROVIDER_PROMPT_METADATA_CONTRACT_VERSION,
      bundle_id: "vnd-settlement-ai-prompt@1.0.0",
      prompt_contract_ref: input.prompt_contract_ref,
      final_output_schema_ref: input.output_schema_ref,
      provider_draft_schema_ref: {
        schema_code: AI_PROVIDER_DRAFT_CONTRACT_VERSION,
        schema_version: "1.0.0",
        schema_digest: digests.provider_draft_schema_digest,
      },
      bundle_digest: digests.bundle_digest,
      release_status: "RELEASED",
      released_at: "2026-08-01T00:00:00.000Z",
      immutable: true,
      mode: "SHADOW",
      tool_policy: "NO_TOOLS",
    },
    content,
  };
}

function modelMetadata(
  provider = "OFFLINE_MOCK",
): ProviderModelMetadataV1 {
  return ProviderModelMetadataSchema.parse({
    contract_version: AI_PROVIDER_MODEL_METADATA_CONTRACT_VERSION,
    configuration_id: "offline-mock-model@1.0.0",
    provider,
    model_id: "offline-mock-model-1",
    model_revision: "fixture-1",
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

function validDraft(): ProviderDraftObjectV1 {
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

function completedResponse(
  request: AiProviderRequestV1,
  draft: ProviderDraftObjectV1 = validDraft(),
): AiProviderResponseV1 {
  return {
    contract_version: AI_PROVIDER_RESPONSE_CONTRACT_VERSION,
    adapter_request_id: request.adapter_request_id,
    ai_request_id: request.ai_request_id,
    received_at: GENERATED_AT,
    model_run_metadata: {
      provider: request.model.provider,
      model_id: request.model.model_id,
      model_revision: request.model.model_revision,
      deployment_id: request.model.deployment_id,
      provider_request_id: "offline-request-1",
      generation_started_at: request.requested_at,
      generation_completed_at: GENERATED_AT,
      temperature: request.model.temperature,
      top_p: request.model.top_p,
      max_output_tokens: request.model.max_output_tokens,
      seed: request.model.seed,
      structured_output_mode: true,
      tool_policy: "NO_TOOLS",
      input_tokens: 120,
      output_tokens: 30,
    },
    provider_response_digest: PROVIDER_RESPONSE_DIGEST,
    outcome: "COMPLETED",
    draft,
    failure: null,
  };
}

function failedResponse(
  request: AiProviderRequestV1,
): AiProviderResponseV1 {
  return {
    contract_version: AI_PROVIDER_RESPONSE_CONTRACT_VERSION,
    adapter_request_id: request.adapter_request_id,
    ai_request_id: request.ai_request_id,
    received_at: GENERATED_AT,
    model_run_metadata: {
      provider: request.model.provider,
      model_id: request.model.model_id,
      model_revision: request.model.model_revision,
      deployment_id: request.model.deployment_id,
      provider_request_id: null,
      generation_started_at: request.requested_at,
      generation_completed_at: GENERATED_AT,
      temperature: request.model.temperature,
      top_p: request.model.top_p,
      max_output_tokens: request.model.max_output_tokens,
      seed: request.model.seed,
      structured_output_mode: true,
      tool_policy: "NO_TOOLS",
      input_tokens: null,
      output_tokens: null,
    },
    provider_response_digest: null,
    outcome: "TIMEOUT",
    draft: null,
    failure: {
      code: "AI_PROVIDER_TIMEOUT",
      retryable: true,
      safe_message: "Offline provider timed out.",
      http_status: null,
    },
  };
}

class OfflineMockProvider implements AiProviderAdapterV1 {
  readonly contract_version = AI_PROVIDER_ADAPTER_CONTRACT_VERSION;
  readonly adapter_id = "offline-mock-adapter";
  readonly provider: string;
  readonly requests: AiProviderRequestV1[] = [];
  readonly invocationOptions: Array<{
    prompt_version: PromptVersionMetadataV1;
    prompt_content: ProviderResolvedPromptContentV1;
  }> = [];
  readonly #handler: (
    request: AiProviderRequestV1,
  ) => Promise<AiProviderResponseV1>;

  constructor(
    handler: (
      request: AiProviderRequestV1,
    ) => Promise<AiProviderResponseV1>,
    provider = "OFFLINE_MOCK",
  ) {
    this.#handler = handler;
    this.provider = provider;
  }

  async generateDraft(
    request: Readonly<AiProviderRequestV1>,
    options: Readonly<{
      signal?: AbortSignal;
      prompt_version: PromptVersionMetadataV1;
      prompt_content: ProviderResolvedPromptContentV1;
    }>,
  ) {
    const captured = structuredClone(request);
    this.requests.push(captured);
    this.invocationOptions.push({
      prompt_version: structuredClone(options.prompt_version),
      prompt_content: structuredClone(options.prompt_content),
    });
    return this.#handler(captured);
  }
}

async function runtimeFixture(
  adapter: AiProviderAdapterV1,
  bundles?: PromptArtifactBundleV1[],
  model = modelMetadata(),
) {
  const loader = new InMemoryPromptVersionLoader(
    bundles ?? [await promptBundle()],
  );
  return createAiProviderRuntime({
    adapter,
    prompt_loader: loader,
    model,
    clock: () => RUNTIME_AT,
  });
}

async function runInput() {
  return {
    ai_input: await aiInput(),
    adapter_request_id: ADAPTER_REQUEST_ID,
    requested_at: REQUESTED_AT,
  };
}

describe("Task 3.4B-3 prompt version loader", () => {
  it("loads only an exact immutable prompt version with verified digests", async () => {
    const bundle = await promptBundle();
    const loader = new InMemoryPromptVersionLoader([bundle]);
    const loaded = await loader.loadExact(
      "VND_SETTLEMENT_AI_PROMPT",
      "1.0.0",
    );

    expect(loaded.status).toBe("LOADED");
    expect(loaded.bundle?.metadata.bundle_digest).toBe(
      bundle.metadata.bundle_digest,
    );
    expect(Object.isFrozen(loaded.bundle)).toBe(true);
    expect(
      await loader.loadExact("VND_SETTLEMENT_AI_PROMPT", "latest"),
    ).toMatchObject({
      status: "FAILED",
      failure_code: "PROMPT_VERSION_INVALID",
    });
    expect(
      await loader.loadExact("VND_SETTLEMENT_AI_PROMPT", "2.0.0"),
    ).toMatchObject({
      status: "FAILED",
      failure_code: "PROMPT_VERSION_NOT_FOUND",
    });
  });

  it("fails closed when prompt content no longer matches metadata", async () => {
    const bundle = structuredClone(await promptBundle());
    bundle.content.system_prompt = "Tampered prompt content.";
    const loader = new InMemoryPromptVersionLoader([bundle]);

    expect(
      await loader.loadExact("VND_SETTLEMENT_AI_PROMPT", "1.0.0"),
    ).toMatchObject({
      status: "FAILED",
      failure_code: "PROMPT_BUNDLE_INTEGRITY_FAILED",
      integrity_codes: expect.arrayContaining([
        "SYSTEM_PROMPT_DIGEST_MISMATCH",
        "PROMPT_BUNDLE_DIGEST_MISMATCH",
      ]),
    });
  });
});

describe("Task 3.4B-3 offline provider runtime", () => {
  it("captures model and complete token metadata for a validated offline draft", async () => {
    const adapter = new OfflineMockProvider(async (request) =>
      completedResponse(request),
    );
    const runtime = await runtimeFixture(adapter);
    const input = await runInput();
    const inputBefore = structuredClone(input);
    const result = await runtime.run(input);

    expect(runtime.contract_version).toBe(
      AI_PROVIDER_RUNTIME_CONTRACT_VERSION,
    );
    expect(result.contract_version).toBe(
      AI_PROVIDER_RUNTIME_RESULT_CONTRACT_VERSION,
    );
    expect(result.status).toBe("VALIDATED_DRAFT");
    expect(result.validation_result?.status).toBe("ACCEPTED");
    expect(result.model_run_metadata?.model_id).toBe(
      "offline-mock-model-1",
    );
    expect(result.token_usage).toEqual({
      status: "COMPLETE",
      input_tokens: 120,
      output_tokens: 30,
      total_tokens: 150,
      source: "PROVIDER_METADATA",
    });
    expect(adapter.requests).toHaveLength(1);
    expect(adapter.requests[0].tool_policy).toBe("NO_TOOLS");
    expect(adapter.invocationOptions).toHaveLength(1);
    expect(
      adapter.invocationOptions[0].prompt_version.prompt_contract_ref
        .prompt_contract_version,
    ).toBe("1.0.0");
    expect(adapter.invocationOptions[0].prompt_content).toEqual(
      promptContent(),
    );
    expect(result.recommendation_snapshot_generated).toBe(false);
    expect(result.database_write_performed).toBe(false);
    expect(result.execution_performed).toBe(false);
    expect(Object.isFrozen(result)).toBe(true);
    expect(input).toEqual(inputBefore);
  });

  it("returns PROVIDER_FAILED with unavailable token usage", async () => {
    const adapter = new OfflineMockProvider(async (request) =>
      failedResponse(request),
    );
    const runtime = await runtimeFixture(adapter);
    const result = await runtime.run(await runInput());

    expect(result.status).toBe("PROVIDER_FAILED");
    expect(result.provider_outcome).toBe("TIMEOUT");
    expect(result.validation_result?.status).toBe("PROVIDER_FAILED");
    expect(result.token_usage.status).toBe("UNAVAILABLE");
    expect(result.validation_result?.validated_draft).toBeNull();
  });

  it("returns VALIDATION_REJECTED for an unsafe offline draft", async () => {
    const adapter = new OfflineMockProvider(async (request) => {
      const draft = validDraft();
      draft.recommendations[0].statement = "Execute a topup now.";
      return completedResponse(request, draft);
    });
    const runtime = await runtimeFixture(adapter);
    const result = await runtime.run(await runInput());

    expect(result.status).toBe("VALIDATION_REJECTED");
    expect(result.validation_result?.status).toBe("REJECTED");
    expect(result.validation_result?.validated_draft).toBeNull();
  });

  it("normalizes thrown adapter errors without exposing raw error text", async () => {
    const adapter = new OfflineMockProvider(async () => {
      throw new Error("secret-provider-error-body");
    });
    const runtime = await runtimeFixture(adapter);
    const result = await runtime.run(await runInput());

    expect(result.status).toBe("RUNTIME_FAILED");
    expect(result.runtime_failure?.code).toBe(
      "ADAPTER_INVOCATION_FAILED",
    );
    expect(result.runtime_failure?.safe_message).not.toContain("secret");
    expect(result.validation_result).toBeNull();
  });

  it("does not invoke the adapter when the prompt version is missing", async () => {
    const adapter = new OfflineMockProvider(async (request) =>
      completedResponse(request),
    );
    const runtime = await runtimeFixture(adapter, []);
    const result = await runtime.run(await runInput());

    expect(result.status).toBe("RUNTIME_FAILED");
    expect(result.runtime_failure?.code).toBe(
      "PROMPT_VERSION_NOT_FOUND",
    );
    expect(adapter.requests).toHaveLength(0);
  });

  it("does not invoke an adapter whose provider differs from model metadata", async () => {
    const adapter = new OfflineMockProvider(
      async (request) => completedResponse(request),
      "OTHER_PROVIDER",
    );
    const runtime = await runtimeFixture(adapter);
    const result = await runtime.run(await runInput());

    expect(result.status).toBe("RUNTIME_FAILED");
    expect(result.runtime_failure?.code).toBe(
      "ADAPTER_PROVIDER_MISMATCH",
    );
    expect(adapter.requests).toHaveLength(0);
  });

  it("does not invoke the adapter when finalized AI input was altered", async () => {
    const adapter = new OfflineMockProvider(async (request) =>
      completedResponse(request),
    );
    const runtime = await runtimeFixture(adapter);
    const input = await runInput();
    input.ai_input.approved_fact_projection.facts[0].value = "500.0000";
    const result = await runtime.run(input);

    expect(result.status).toBe("RUNTIME_FAILED");
    expect(result.runtime_failure?.code).toBe(
      "AI_INPUT_CONTRACT_BLOCKED",
    );
    expect(adapter.requests).toHaveLength(0);
  });
});

describe("Task 3.4B-3 metadata and safety", () => {
  it("captures partial and unavailable token usage without estimating", () => {
    const metadata = {
      provider: "OFFLINE_MOCK",
      model_id: "offline-mock-model-1",
      model_revision: "fixture-1",
      deployment_id: null,
      provider_request_id: "offline-request-1",
      generation_started_at: REQUESTED_AT,
      generation_completed_at: GENERATED_AT,
      temperature: "0",
      top_p: "1",
      max_output_tokens: 2_000,
      seed: 7,
      structured_output_mode: true as const,
      tool_policy: "NO_TOOLS" as const,
      input_tokens: 120,
      output_tokens: null,
    };
    expect(captureTokenUsage(metadata)).toEqual({
      status: "PARTIAL",
      input_tokens: 120,
      output_tokens: null,
      total_tokens: null,
      source: "PROVIDER_METADATA",
    });
    expect(captureTokenUsage(null).status).toBe("UNAVAILABLE");
    expect(
      TokenUsageMetadataSchema.safeParse({
        ...captureTokenUsage(metadata),
        total_tokens: 120,
      }).success,
    ).toBe(false);
  });

  it("keeps every runtime result inside its strict contract", async () => {
    const adapter = new OfflineMockProvider(async (request) =>
      completedResponse(request),
    );
    const result = await (
      await runtimeFixture(adapter)
    ).run(await runInput());
    expect(AiProviderRuntimeResultSchema.parse(result)).toEqual(result);
  });

  it("contains no production provider, database write, snapshot, approval, or execution implementation", () => {
    const sourceCode = readFileSync(
      resolve(process.cwd(), "lib/settlement-ai-provider-runtime.ts"),
      "utf8",
    );

    expect(sourceCode).not.toMatch(
      /\bfetch\s*\(|chat\.completions|responses\.create|@supabase|createClient/,
    );
    expect(sourceCode).not.toMatch(
      /\.(insert|update|upsert|delete|rpc)\s*\(|finalizeRecommendationSnapshot|RecommendationSnapshotSchema/,
    );
    expect(providerRuntimeHasNoExecutionCapability()).toBe(true);
  });
});
