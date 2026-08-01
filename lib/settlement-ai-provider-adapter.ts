import Decimal from "decimal.js";
import { z } from "zod";

import {
  AI_RECOMMENDATION_INPUT_CONTRACT_VERSION,
  AI_RECOMMENDATION_SHADOW_GUARD,
  AiRecommendationInputSchema,
  AiRecommendationShadowGuardSchema,
  ApprovedFactProjectionSchema,
  DecimalStringSchema,
  DigestSchema,
  EvidenceCatalogItemSchema,
  ModelVersionMetadataSchema,
  OutputSchemaReferenceSchema,
  PromptContractReferenceSchema,
  RecommendationScopeSchema,
  TimestampSchema,
  type AiRecommendationInputV1,
} from "./settlement-ai-recommendation-framework";

export const AI_PROVIDER_ADAPTER_CONTRACT_VERSION =
  "AI_PROVIDER_ADAPTER_V1" as const;
export const AI_PROVIDER_REQUEST_CONTRACT_VERSION =
  "AI_PROVIDER_REQUEST_V1" as const;
export const AI_PROVIDER_RESPONSE_CONTRACT_VERSION =
  "AI_PROVIDER_RESPONSE_V1" as const;
export const AI_PROVIDER_PROMPT_METADATA_CONTRACT_VERSION =
  "AI_PROVIDER_PROMPT_VERSION_METADATA_V1" as const;
export const AI_PROVIDER_MODEL_METADATA_CONTRACT_VERSION =
  "AI_PROVIDER_MODEL_METADATA_V1" as const;
export const AI_PROVIDER_DRAFT_CONTRACT_VERSION =
  "AI_PROVIDER_GENERATED_PAYLOAD_V1" as const;

export const AI_PROVIDER_ADAPTER_SHADOW_GUARD = Object.freeze({
  automatic_topup: false,
  automatic_payment: false,
  automatic_quote_change: false,
  automatic_trading: false,
  automatic_channel_switch: false,
  third_party_submission: false,
  approval_workflow: false,
});

const SEMVER_PATTERN =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export const ExactSemanticVersionSchema = z
  .string()
  .regex(SEMVER_PATTERN)
  .refine((version) => version.toLowerCase() !== "latest", {
    message: "An exact semantic version is required",
  });

export const ProviderDraftSchemaReferenceSchema = z
  .object({
    schema_code: z.literal(AI_PROVIDER_DRAFT_CONTRACT_VERSION),
    schema_version: ExactSemanticVersionSchema,
    schema_digest: DigestSchema,
  })
  .strict();

export const PromptVersionMetadataSchema = z
  .object({
    contract_version: z.literal(
      AI_PROVIDER_PROMPT_METADATA_CONTRACT_VERSION,
    ),
    bundle_id: z.string().min(1).max(160),
    prompt_contract_ref: PromptContractReferenceSchema,
    final_output_schema_ref: OutputSchemaReferenceSchema,
    provider_draft_schema_ref: ProviderDraftSchemaReferenceSchema,
    bundle_digest: DigestSchema,
    release_status: z.literal("RELEASED"),
    released_at: TimestampSchema,
    immutable: z.literal(true),
    mode: z.literal("SHADOW"),
    tool_policy: z.literal("NO_TOOLS"),
  })
  .strict()
  .superRefine((metadata, context) => {
    if (
      !ExactSemanticVersionSchema.safeParse(
        metadata.prompt_contract_ref.prompt_contract_version,
      ).success
    ) {
      context.addIssue({
        code: "custom",
        path: ["prompt_contract_ref", "prompt_contract_version"],
        message: "Prompt contract must use an exact semantic version",
      });
    }
    if (
      !ExactSemanticVersionSchema.safeParse(
        metadata.prompt_contract_ref.output_schema_version,
      ).success ||
      !ExactSemanticVersionSchema.safeParse(
        metadata.final_output_schema_ref.schema_version,
      ).success
    ) {
      context.addIssue({
        code: "custom",
        path: ["final_output_schema_ref", "schema_version"],
        message: "Output schema must use an exact semantic version",
      });
    }
    if (
      metadata.prompt_contract_ref.output_schema_version !==
      metadata.final_output_schema_ref.schema_version
    ) {
      context.addIssue({
        code: "custom",
        path: ["final_output_schema_ref", "schema_version"],
        message:
          "Final output schema version must match the prompt contract",
      });
    }
    if (
      metadata.prompt_contract_ref.output_schema_digest !==
      metadata.final_output_schema_ref.schema_digest
    ) {
      context.addIssue({
        code: "custom",
        path: ["final_output_schema_ref", "schema_digest"],
        message:
          "Final output schema digest must match the prompt contract",
      });
    }
  });

export const ProviderModelMetadataSchema = z
  .object({
    contract_version: z.literal(
      AI_PROVIDER_MODEL_METADATA_CONTRACT_VERSION,
    ),
    configuration_id: z.string().min(1).max(160),
    provider: z.string().min(1).max(100),
    model_id: z.string().min(1).max(200),
    model_revision: z.string().min(1).max(200).nullable(),
    deployment_id: z.string().min(1).max(200).nullable(),
    temperature: DecimalStringSchema
      .refine((value) => {
        try {
          const decimal = new Decimal(value);
          return decimal.isFinite() && decimal.gte(0) && decimal.lte(2);
        } catch {
          return false;
        }
      }, "Temperature must be a decimal string between 0 and 2"),
    top_p: DecimalStringSchema
      .refine((value) => {
        try {
          const decimal = new Decimal(value);
          return decimal.isFinite() && decimal.gte(0) && decimal.lte(1);
        } catch {
          return false;
        }
      }, "Top P must be a decimal string between 0 and 1"),
    max_output_tokens: z.number().int().positive().max(100_000),
    seed: z.number().int().nullable(),
    structured_output_mode: z.literal(true),
    tool_policy: z.literal("NO_TOOLS"),
    timeout_ms: z.number().int().min(1_000).max(120_000),
    mode: z.literal("SHADOW"),
    allowlisted: z.literal(true),
  })
  .strict();

export const ProviderStructuredInputSchema = z
  .object({
    contract_version: z.literal(
      AI_RECOMMENDATION_INPUT_CONTRACT_VERSION,
    ),
    ai_request_id: z.string().uuid(),
    as_of: TimestampSchema,
    currency: z.literal("VND"),
    mode: z.literal("SHADOW"),
    approved_fact_projection: ApprovedFactProjectionSchema,
    evidence_catalog: z.array(EvidenceCatalogItemSchema),
    limitations: z.array(z.string()),
    blocking_reasons: z.array(z.string()),
    requested_scopes: z.array(RecommendationScopeSchema).min(1),
    presentation_context:
      AiRecommendationInputSchema.shape.presentation_context,
    shadow_guard: AiRecommendationShadowGuardSchema,
    ai_input_digest: DigestSchema,
  })
  .strict();

export const ProviderResolvedPromptContentSchema = z
  .object({
    system_prompt: z.string().min(1).max(50_000),
    developer_prompt: z.string().min(1).max(50_000),
    user_input_template: z.string().min(1).max(50_000),
    provider_draft_schema_json: z.record(z.string(), z.unknown()),
    safety_policy: z.string().min(1).max(50_000),
    allowed_scopes: z.array(RecommendationScopeSchema).min(1),
    language: z.string().min(1).max(40),
  })
  .strict();

export const AiProviderRequestSchema = z
  .object({
    contract_version: z.literal(AI_PROVIDER_REQUEST_CONTRACT_VERSION),
    adapter_request_id: z.string().uuid(),
    requested_at: TimestampSchema,
    ai_request_id: z.string().uuid(),
    as_of: TimestampSchema,
    currency: z.literal("VND"),
    mode: z.literal("SHADOW"),
    prompt_version: PromptVersionMetadataSchema,
    model: ProviderModelMetadataSchema,
    structured_input: ProviderStructuredInputSchema,
    provider_draft_schema_ref: ProviderDraftSchemaReferenceSchema,
    timeout_ms: z.number().int().min(1_000).max(120_000),
    tool_policy: z.literal("NO_TOOLS"),
    shadow_guard: AiRecommendationShadowGuardSchema,
  })
  .strict()
  .superRefine((request, context) => {
    if (request.ai_request_id !== request.structured_input.ai_request_id) {
      context.addIssue({
        code: "custom",
        path: ["ai_request_id"],
        message: "AI request identity must match structured input",
      });
    }
    if (request.as_of !== request.structured_input.as_of) {
      context.addIssue({
        code: "custom",
        path: ["as_of"],
        message: "Request as_of must match structured input",
      });
    }
    if (request.timeout_ms !== request.model.timeout_ms) {
      context.addIssue({
        code: "custom",
        path: ["timeout_ms"],
        message: "Request timeout must match allowlisted model metadata",
      });
    }
    if (
      request.provider_draft_schema_ref.schema_digest !==
        request.prompt_version.provider_draft_schema_ref.schema_digest ||
      request.provider_draft_schema_ref.schema_version !==
        request.prompt_version.provider_draft_schema_ref.schema_version
    ) {
      context.addIssue({
        code: "custom",
        path: ["provider_draft_schema_ref"],
        message:
          "Provider draft schema must match the resolved prompt version",
      });
    }
  });

const DraftTextSchema = z.string().trim().min(1).max(2_000);
const DraftCodeSchema = z.string().trim().min(1).max(160);
const DraftPathSchema = z.string().trim().min(1).max(500);

export const ProviderDraftClaimSchema = z
  .object({
    claim_id: z.string().uuid(),
    claim_text: DraftTextSchema,
    claim_type: z.enum([
      "DETERMINISTIC_FACT",
      "SOURCE_FACT",
      "LIMITATION",
      "QUALITATIVE_REVIEW_SUGGESTION",
    ]),
    deterministic_result_paths: z.array(DraftPathSchema).max(50),
    snapshot_paths: z.array(DraftPathSchema).max(50),
    evidence_ids: z.array(z.string().uuid()).max(100),
    limitations: z.array(DraftCodeSchema).max(50),
  })
  .strict();

export const ProviderDraftRecommendationSchema = z
  .object({
    recommendation_id: z.string().uuid(),
    recommendation_type: z.enum([
      "LIQUIDITY_REVIEW",
      "PROFIT_REVIEW",
      "FX_OBSERVATION",
      "QUOTE_REVIEW",
      "RISK_MONITORING",
      "DATA_QUALITY_REVIEW",
    ]),
    title: z.string().trim().min(1).max(240),
    statement: DraftTextSchema,
    reason_codes: z.array(DraftCodeSchema).max(50),
    priority: z.enum(["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"]),
    human_review_request: DraftTextSchema,
    referenced_value_paths: z.array(DraftPathSchema).max(50),
    claim_ids: z.array(z.string().uuid()).max(100),
    deterministic_result_paths: z.array(DraftPathSchema).max(50),
    evidence_ids: z.array(z.string().uuid()).max(100),
    limitations: z.array(DraftCodeSchema).max(50),
  })
  .strict();

export const ProviderDraftObjectSchema = z
  .object({
    contract_version: z.literal(AI_PROVIDER_DRAFT_CONTRACT_VERSION),
    fact_summary: z.array(ProviderDraftClaimSchema).max(100),
    risk_summary: z.array(ProviderDraftClaimSchema).max(100),
    recommendations: z
      .array(ProviderDraftRecommendationSchema)
      .max(100),
    limitations: z.array(DraftCodeSchema).max(100),
  })
  .strict();

export const ProviderOutcomeSchema = z.enum([
  "COMPLETED",
  "REFUSED",
  "TIMEOUT",
  "RATE_LIMITED",
  "PROVIDER_UNAVAILABLE",
  "PROVIDER_ERROR",
  "CANCELLED",
]);

export const ProviderFailureCodeSchema = z.enum([
  "AI_PROVIDER_REFUSED",
  "AI_PROVIDER_TIMEOUT",
  "AI_PROVIDER_RATE_LIMITED",
  "AI_PROVIDER_UNAVAILABLE",
  "AI_PROVIDER_ERROR",
  "AI_PROVIDER_CANCELLED",
]);

export const ProviderFailureSchema = z
  .object({
    code: ProviderFailureCodeSchema,
    retryable: z.boolean(),
    safe_message: z.string().min(1).max(500),
    http_status: z.number().int().min(100).max(599).nullable(),
  })
  .strict();

const ProviderResponseBaseSchema = z
  .object({
    contract_version: z.literal(AI_PROVIDER_RESPONSE_CONTRACT_VERSION),
    adapter_request_id: z.string().uuid(),
    ai_request_id: z.string().uuid(),
    received_at: TimestampSchema,
    model_run_metadata: ModelVersionMetadataSchema,
    provider_response_digest: DigestSchema.nullable(),
  })
  .strict();

export const CompletedProviderResponseSchema =
  ProviderResponseBaseSchema.extend({
    outcome: z.literal("COMPLETED"),
    draft: ProviderDraftObjectSchema,
    failure: z.null(),
    provider_response_digest: DigestSchema,
  }).strict();

export const FailedProviderResponseSchema = ProviderResponseBaseSchema.extend(
  {
    outcome: z.enum([
      "REFUSED",
      "TIMEOUT",
      "RATE_LIMITED",
      "PROVIDER_UNAVAILABLE",
      "PROVIDER_ERROR",
      "CANCELLED",
    ]),
    draft: z.null(),
    failure: ProviderFailureSchema,
  },
)
  .strict()
  .superRefine((response, context) => {
    const expectedCode = {
      REFUSED: "AI_PROVIDER_REFUSED",
      TIMEOUT: "AI_PROVIDER_TIMEOUT",
      RATE_LIMITED: "AI_PROVIDER_RATE_LIMITED",
      PROVIDER_UNAVAILABLE: "AI_PROVIDER_UNAVAILABLE",
      PROVIDER_ERROR: "AI_PROVIDER_ERROR",
      CANCELLED: "AI_PROVIDER_CANCELLED",
    }[response.outcome];
    if (response.failure.code !== expectedCode) {
      context.addIssue({
        code: "custom",
        path: ["failure", "code"],
        message: "Failure code must match provider outcome",
      });
    }
  });

export const AiProviderResponseSchema = z.discriminatedUnion("outcome", [
  CompletedProviderResponseSchema,
  FailedProviderResponseSchema,
]);

export type PromptVersionMetadataV1 = z.infer<
  typeof PromptVersionMetadataSchema
>;
export type ProviderModelMetadataV1 = z.infer<
  typeof ProviderModelMetadataSchema
>;
export type ProviderStructuredInputV1 = z.infer<
  typeof ProviderStructuredInputSchema
>;
export type ProviderResolvedPromptContentV1 = z.infer<
  typeof ProviderResolvedPromptContentSchema
>;
export type AiProviderRequestV1 = z.infer<
  typeof AiProviderRequestSchema
>;
export type ProviderDraftClaimV1 = z.infer<
  typeof ProviderDraftClaimSchema
>;
export type ProviderDraftRecommendationV1 = z.infer<
  typeof ProviderDraftRecommendationSchema
>;
export type ProviderDraftObjectV1 = z.infer<
  typeof ProviderDraftObjectSchema
>;
export type AiProviderResponseV1 = z.infer<
  typeof AiProviderResponseSchema
>;

export interface BuildAiProviderRequestInput {
  adapter_request_id: string;
  requested_at: string;
  ai_input: AiRecommendationInputV1;
  prompt_version: PromptVersionMetadataV1;
  model: ProviderModelMetadataV1;
}

export const AI_PROVIDER_ALLOWED_DETERMINISTIC_PATHS = Object.freeze([
  "liquidity_result.calculated_reserve_balance_vnd",
  "liquidity_result.calculated_settleable_balance_vnd",
  "liquidity_result.settleable_net_demand_vnd",
  "liquidity_result.settleable_capacity_gap_vnd",
  "fifo_cost_result.cost_basis_usdt",
  "fifo_cost_result.weighted_cost_rate_vnd_per_usdt",
  "profit_result.aggregate.cash_profit_usdt",
  "profit_result.aggregate.economic_profit_usdt",
  "fx_result.p2p_minus_xe.absolute_vnd_per_usdt",
  "fx_result.p2p_minus_fifo.absolute_vnd_per_usdt",
  "business_rule_result.cash_profit_margin_band",
  "business_rule_result.economic_profit_margin_band",
] as const);

const AI_PROVIDER_ALLOWED_EVIDENCE_SOURCES = new Set([
  "BALANCE_POSITION",
  "LIQUIDITY_HISTORY",
  "VND_INVENTORY",
  "FX_MARKET_INPUTS",
  "MERCHANT_CONTEXT",
  "PROFIT_CONTEXT",
  "MARKET_CONTEXT",
]);
const SAFE_PROVIDER_CODE_PATTERN = /^[A-Z][A-Z0-9_:.\/-]{0,159}$/;

function assertProviderSafeProjection(input: AiRecommendationInputV1) {
  const allowedPaths = new Set<string>(
    AI_PROVIDER_ALLOWED_DETERMINISTIC_PATHS,
  );
  const factsAreSafe = input.approved_fact_projection.facts.every(
    (fact) =>
      fact.source === "DETERMINISTIC_RESULT" &&
      allowedPaths.has(fact.source_path) &&
      ["DECIMAL", "ENUM", "BOOLEAN", "NULL"].includes(fact.value_type),
  );
  const evidenceIsSafe = input.evidence_catalog.every(
    (evidence) =>
      AI_PROVIDER_ALLOWED_EVIDENCE_SOURCES.has(evidence.source_key) &&
      SAFE_PROVIDER_CODE_PATTERN.test(evidence.completeness_status),
  );
  const codesAreSafe = [...input.limitations, ...input.blocking_reasons].every(
    (code) => SAFE_PROVIDER_CODE_PATTERN.test(code),
  );
  if (!factsAreSafe || !evidenceIsSafe || !codesAreSafe) {
    throw new Error("AI_PROVIDER_DATA_MINIMIZATION_REJECTED");
  }
}

export interface AiProviderAdapterV1 {
  readonly contract_version: typeof AI_PROVIDER_ADAPTER_CONTRACT_VERSION;
  readonly adapter_id: string;
  readonly provider: string;
  generateDraft(
    request: Readonly<AiProviderRequestV1>,
    options: Readonly<{
      signal?: AbortSignal;
      prompt_version: PromptVersionMetadataV1;
      prompt_content: ProviderResolvedPromptContentV1;
    }>,
  ): Promise<AiProviderResponseV1>;
}

function sameStructuredValue(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) {
      deepFreeze(nested);
    }
    Object.freeze(value);
  }
  return value;
}

export function buildAiProviderRequest(
  input: BuildAiProviderRequestInput,
): AiProviderRequestV1 {
  const aiInput = AiRecommendationInputSchema.parse(input.ai_input);
  assertProviderSafeProjection(aiInput);
  const promptVersion = PromptVersionMetadataSchema.parse(
    input.prompt_version,
  );
  const model = ProviderModelMetadataSchema.parse(input.model);

  if (
    !sameStructuredValue(
      promptVersion.prompt_contract_ref,
      aiInput.prompt_contract_ref,
    )
  ) {
    throw new Error(
      "Prompt version metadata does not match finalized AI input",
    );
  }
  if (
    !sameStructuredValue(
      promptVersion.final_output_schema_ref,
      aiInput.output_schema_ref,
    )
  ) {
    throw new Error(
      "Final output schema metadata does not match finalized AI input",
    );
  }

  const structuredInput: ProviderStructuredInputV1 = {
    contract_version: aiInput.contract_version,
    ai_request_id: aiInput.ai_request_id,
    as_of: aiInput.as_of,
    currency: aiInput.currency,
    mode: aiInput.mode,
    approved_fact_projection: aiInput.approved_fact_projection,
    evidence_catalog: aiInput.evidence_catalog,
    limitations: aiInput.limitations,
    blocking_reasons: aiInput.blocking_reasons,
    requested_scopes: aiInput.requested_scopes,
    presentation_context: aiInput.presentation_context,
    shadow_guard: aiInput.shadow_guard,
    ai_input_digest: aiInput.ai_input_digest,
  };

  return deepFreeze(
    AiProviderRequestSchema.parse({
      contract_version: AI_PROVIDER_REQUEST_CONTRACT_VERSION,
      adapter_request_id: input.adapter_request_id,
      requested_at: input.requested_at,
      ai_request_id: aiInput.ai_request_id,
      as_of: aiInput.as_of,
      currency: aiInput.currency,
      mode: aiInput.mode,
      prompt_version: promptVersion,
      model,
      structured_input: structuredInput,
      provider_draft_schema_ref:
        promptVersion.provider_draft_schema_ref,
      timeout_ms: model.timeout_ms,
      tool_policy: "NO_TOOLS",
      shadow_guard: AI_PROVIDER_ADAPTER_SHADOW_GUARD,
    }),
  );
}

export function parseProviderDraft(
  candidate: unknown,
): ProviderDraftObjectV1 {
  return deepFreeze(ProviderDraftObjectSchema.parse(candidate));
}

export function parseAiProviderResponse(
  candidate: unknown,
): AiProviderResponseV1 {
  return deepFreeze(AiProviderResponseSchema.parse(candidate));
}

export function providerAdapterContractHasNoExecutionCapability() {
  return (
    Object.values(AI_PROVIDER_ADAPTER_SHADOW_GUARD).every(
      (flag) => flag === false,
    ) &&
    Object.values(AI_RECOMMENDATION_SHADOW_GUARD).every(
      (flag) => flag === false,
    )
  );
}
