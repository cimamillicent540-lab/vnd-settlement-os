import { z } from "zod";

import {
  AI_RECOMMENDATION_SHADOW_GUARD,
  AiRecommendationInputSchema,
  AiRecommendationShadowGuardSchema,
  ModelVersionMetadataSchema,
  TimestampSchema,
  type AiRecommendationInputV1,
} from "./settlement-ai-recommendation-framework";
import {
  AI_PROVIDER_ADAPTER_CONTRACT_VERSION,
  AI_PROVIDER_ADAPTER_SHADOW_GUARD,
  AiProviderResponseSchema,
  ExactSemanticVersionSchema,
  PromptVersionMetadataSchema,
  ProviderModelMetadataSchema,
  ProviderResolvedPromptContentSchema,
  buildAiProviderRequest,
  type AiProviderAdapterV1,
  type AiProviderRequestV1,
  type PromptVersionMetadataV1,
  type ProviderModelMetadataV1,
} from "./settlement-ai-provider-adapter";
import {
  AI_PROVIDER_VALIDATION_SHADOW_GUARD,
  AiProviderValidationResultSchema,
  validateAiProviderResult,
  type AiProviderValidationResultV1,
} from "./settlement-ai-provider-validation";
import { stableSnapshotDigest } from "./settlement-input-snapshot";

export const AI_PROVIDER_RUNTIME_CONTRACT_VERSION =
  "AI_PROVIDER_RUNTIME_V1" as const;
export const AI_PROVIDER_RUNTIME_RESULT_CONTRACT_VERSION =
  "AI_PROVIDER_RUNTIME_RESULT_V1" as const;
export const AI_PROVIDER_PROMPT_BUNDLE_CONTRACT_VERSION =
  "AI_PROVIDER_PROMPT_ARTIFACT_BUNDLE_V1" as const;

export const AI_PROVIDER_RUNTIME_SHADOW_GUARD = Object.freeze({
  automatic_topup: false,
  automatic_payment: false,
  automatic_quote_change: false,
  automatic_trading: false,
  automatic_channel_switch: false,
  third_party_submission: false,
  approval_workflow: false,
});

export const PromptArtifactContentSchema =
  ProviderResolvedPromptContentSchema;

export const PromptArtifactBundleSchema = z
  .object({
    contract_version: z.literal(
      AI_PROVIDER_PROMPT_BUNDLE_CONTRACT_VERSION,
    ),
    metadata: PromptVersionMetadataSchema,
    content: PromptArtifactContentSchema,
  })
  .strict()
  .superRefine((bundle, context) => {
    if (
      bundle.content.language !==
      bundle.metadata.prompt_contract_ref.language
    ) {
      context.addIssue({
        code: "custom",
        path: ["content", "language"],
        message: "Prompt bundle language must match prompt metadata",
      });
    }
    const allowedScopes = new Set(bundle.content.allowed_scopes);
    if (allowedScopes.size !== bundle.content.allowed_scopes.length) {
      context.addIssue({
        code: "custom",
        path: ["content", "allowed_scopes"],
        message: "Prompt bundle scopes must be unique",
      });
    }
  });

export const PromptArtifactDigestsSchema = z
  .object({
    system_prompt_digest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    developer_prompt_digest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    user_input_template_digest: z
      .string()
      .regex(/^sha256:[0-9a-f]{64}$/),
    provider_draft_schema_digest: z
      .string()
      .regex(/^sha256:[0-9a-f]{64}$/),
    bundle_digest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  })
  .strict();

export type PromptArtifactContentV1 = z.infer<
  typeof PromptArtifactContentSchema
>;
export type PromptArtifactBundleV1 = z.infer<
  typeof PromptArtifactBundleSchema
>;
export type PromptArtifactDigestsV1 = z.infer<
  typeof PromptArtifactDigestsSchema
>;

export interface PromptBundleIntegrityResult {
  valid: boolean;
  codes: string[];
}

export async function calculatePromptArtifactDigests(
  candidate: PromptArtifactContentV1,
): Promise<PromptArtifactDigestsV1> {
  const content = PromptArtifactContentSchema.parse(candidate);
  return PromptArtifactDigestsSchema.parse({
    system_prompt_digest: await stableSnapshotDigest(
      content.system_prompt,
    ),
    developer_prompt_digest: await stableSnapshotDigest(
      content.developer_prompt,
    ),
    user_input_template_digest: await stableSnapshotDigest(
      content.user_input_template,
    ),
    provider_draft_schema_digest: await stableSnapshotDigest(
      content.provider_draft_schema_json,
    ),
    bundle_digest: await stableSnapshotDigest(content),
  });
}

export async function verifyPromptArtifactBundle(
  candidate: unknown,
): Promise<PromptBundleIntegrityResult> {
  const parsed = PromptArtifactBundleSchema.safeParse(candidate);
  if (!parsed.success) {
    return { valid: false, codes: ["PROMPT_BUNDLE_SCHEMA_INVALID"] };
  }
  const bundle = parsed.data;
  const digests = await calculatePromptArtifactDigests(bundle.content);
  const codes: string[] = [];
  if (
    digests.system_prompt_digest !==
    bundle.metadata.prompt_contract_ref.system_prompt_digest
  ) {
    codes.push("SYSTEM_PROMPT_DIGEST_MISMATCH");
  }
  if (
    digests.developer_prompt_digest !==
    bundle.metadata.prompt_contract_ref.developer_prompt_digest
  ) {
    codes.push("DEVELOPER_PROMPT_DIGEST_MISMATCH");
  }
  if (
    digests.user_input_template_digest !==
    bundle.metadata.prompt_contract_ref.user_input_template_digest
  ) {
    codes.push("USER_INPUT_TEMPLATE_DIGEST_MISMATCH");
  }
  if (
    digests.provider_draft_schema_digest !==
    bundle.metadata.provider_draft_schema_ref.schema_digest
  ) {
    codes.push("PROVIDER_DRAFT_SCHEMA_DIGEST_MISMATCH");
  }
  if (digests.bundle_digest !== bundle.metadata.bundle_digest) {
    codes.push("PROMPT_BUNDLE_DIGEST_MISMATCH");
  }
  return { valid: codes.length === 0, codes };
}

export type PromptVersionLoadFailureCode =
  | "PROMPT_VERSION_INVALID"
  | "PROMPT_VERSION_NOT_FOUND"
  | "PROMPT_BUNDLE_INTEGRITY_FAILED";

export type PromptVersionLoadResult =
  | {
      status: "LOADED";
      bundle: PromptArtifactBundleV1;
      failure_code: null;
      integrity_codes: [];
    }
  | {
      status: "FAILED";
      bundle: null;
      failure_code: PromptVersionLoadFailureCode;
      integrity_codes: string[];
    };

export interface PromptVersionLoaderV1 {
  loadExact(
    promptContractCode: string,
    promptContractVersion: string,
  ): Promise<PromptVersionLoadResult>;
}

function promptBundleKey(code: string, version: string) {
  return `${code}@${version}`;
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

export class InMemoryPromptVersionLoader
  implements PromptVersionLoaderV1
{
  readonly #bundles: Map<string, PromptArtifactBundleV1>;

  constructor(candidates: readonly unknown[]) {
    this.#bundles = new Map();
    for (const candidate of candidates) {
      const bundle = deepFreeze(PromptArtifactBundleSchema.parse(candidate));
      const reference = bundle.metadata.prompt_contract_ref;
      const key = promptBundleKey(
        reference.prompt_contract_code,
        reference.prompt_contract_version,
      );
      if (this.#bundles.has(key)) {
        throw new Error(`Duplicate prompt bundle: ${key}`);
      }
      this.#bundles.set(key, bundle);
    }
  }

  async loadExact(
    promptContractCode: string,
    promptContractVersion: string,
  ): Promise<PromptVersionLoadResult> {
    if (
      !ExactSemanticVersionSchema.safeParse(promptContractVersion).success
    ) {
      return deepFreeze({
        status: "FAILED",
        bundle: null,
        failure_code: "PROMPT_VERSION_INVALID",
        integrity_codes: [],
      });
    }
    const bundle = this.#bundles.get(
      promptBundleKey(promptContractCode, promptContractVersion),
    );
    if (!bundle) {
      return deepFreeze({
        status: "FAILED",
        bundle: null,
        failure_code: "PROMPT_VERSION_NOT_FOUND",
        integrity_codes: [],
      });
    }
    const integrity = await verifyPromptArtifactBundle(bundle);
    if (!integrity.valid) {
      return deepFreeze({
        status: "FAILED",
        bundle: null,
        failure_code: "PROMPT_BUNDLE_INTEGRITY_FAILED",
        integrity_codes: integrity.codes,
      });
    }
    return deepFreeze({
      status: "LOADED",
      bundle,
      failure_code: null,
      integrity_codes: [] as [],
    });
  }
}

export const TokenUsageMetadataSchema = z
  .object({
    status: z.enum(["COMPLETE", "PARTIAL", "UNAVAILABLE"]),
    input_tokens: z.number().int().nonnegative().nullable(),
    output_tokens: z.number().int().nonnegative().nullable(),
    total_tokens: z.number().int().nonnegative().nullable(),
    source: z.literal("PROVIDER_METADATA"),
  })
  .strict()
  .superRefine((usage, context) => {
    const counts = [usage.input_tokens, usage.output_tokens];
    const present = counts.filter((value) => value !== null).length;
    const expectedStatus =
      present === 2 ? "COMPLETE" : present === 1 ? "PARTIAL" : "UNAVAILABLE";
    if (usage.status !== expectedStatus) {
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: "Token usage status does not match available counts",
      });
    }
    const expectedTotal =
      present === 2
        ? (usage.input_tokens as number) +
          (usage.output_tokens as number)
        : null;
    if (usage.total_tokens !== expectedTotal) {
      context.addIssue({
        code: "custom",
        path: ["total_tokens"],
        message: "Token total must equal input plus output tokens",
      });
    }
  });

export const ProviderRuntimeFailureSchema = z
  .object({
    code: z.enum([
      "AI_INPUT_CONTRACT_BLOCKED",
      "PROMPT_VERSION_INVALID",
      "PROMPT_VERSION_NOT_FOUND",
      "PROMPT_BUNDLE_INTEGRITY_FAILED",
      "PROMPT_METADATA_MISMATCH",
      "ADAPTER_CONTRACT_MISMATCH",
      "ADAPTER_PROVIDER_MISMATCH",
      "PROVIDER_REQUEST_BUILD_FAILED",
      "ADAPTER_INVOCATION_FAILED",
      "ADAPTER_INVOCATION_CANCELLED",
    ]),
    safe_message: z.string().min(1).max(500),
    retryable: z.boolean(),
    detail_codes: z.array(z.string().min(1).max(160)),
  })
  .strict();

const RuntimeResultBaseSchema = z
  .object({
    contract_version: z.literal(
      AI_PROVIDER_RUNTIME_RESULT_CONTRACT_VERSION,
    ),
    status: z.enum([
      "VALIDATED_DRAFT",
      "VALIDATION_REJECTED",
      "PROVIDER_FAILED",
      "RUNTIME_FAILED",
    ]),
    runtime_started_at: TimestampSchema,
    runtime_completed_at: TimestampSchema,
    adapter_request_id: z.string().uuid(),
    ai_request_id: z.string().uuid(),
    mode: z.literal("SHADOW"),
    prompt_version_metadata: PromptVersionMetadataSchema.nullable(),
    configured_model_metadata: ProviderModelMetadataSchema,
    model_run_metadata: ModelVersionMetadataSchema.nullable(),
    token_usage: TokenUsageMetadataSchema,
    provider_outcome: z
      .enum([
        "COMPLETED",
        "REFUSED",
        "TIMEOUT",
        "RATE_LIMITED",
        "PROVIDER_UNAVAILABLE",
        "PROVIDER_ERROR",
        "CANCELLED",
      ])
      .nullable(),
    validation_result: AiProviderValidationResultSchema.nullable(),
    runtime_failure: ProviderRuntimeFailureSchema.nullable(),
    recommendation_snapshot_generated: z.literal(false),
    database_write_performed: z.literal(false),
    execution_performed: z.literal(false),
    shadow_guard: AiRecommendationShadowGuardSchema,
  })
  .strict()
  .superRefine((result, context) => {
    if (
      Date.parse(result.runtime_completed_at) <
      Date.parse(result.runtime_started_at)
    ) {
      context.addIssue({
        code: "custom",
        path: ["runtime_completed_at"],
        message: "Runtime cannot complete before it starts",
      });
    }
    const expectedValidationStatus = {
      VALIDATED_DRAFT: "ACCEPTED",
      VALIDATION_REJECTED: "REJECTED",
      PROVIDER_FAILED: "PROVIDER_FAILED",
      RUNTIME_FAILED: null,
    }[result.status];
    if (
      expectedValidationStatus === null
        ? result.validation_result !== null || result.runtime_failure === null
        : result.validation_result?.status !== expectedValidationStatus ||
          result.runtime_failure !== null
    ) {
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: "Runtime status does not match validation or failure data",
      });
    }
  });

export const AiProviderRuntimeResultSchema = RuntimeResultBaseSchema;

export type TokenUsageMetadataV1 = z.infer<
  typeof TokenUsageMetadataSchema
>;
export type AiProviderRuntimeResultV1 = z.infer<
  typeof AiProviderRuntimeResultSchema
>;

export interface RunAiProviderRuntimeInput {
  ai_input: AiRecommendationInputV1;
  adapter_request_id: string;
  requested_at: string;
  signal?: AbortSignal;
}

export interface AiProviderRuntimeV1 {
  readonly contract_version: typeof AI_PROVIDER_RUNTIME_CONTRACT_VERSION;
  run(
    input: Readonly<RunAiProviderRuntimeInput>,
  ): Promise<AiProviderRuntimeResultV1>;
}

export interface CreateAiProviderRuntimeInput {
  adapter: AiProviderAdapterV1;
  prompt_loader: PromptVersionLoaderV1;
  model: ProviderModelMetadataV1;
  clock?: () => string;
}

function unavailableTokenUsage(): TokenUsageMetadataV1 {
  return TokenUsageMetadataSchema.parse({
    status: "UNAVAILABLE",
    input_tokens: null,
    output_tokens: null,
    total_tokens: null,
    source: "PROVIDER_METADATA",
  });
}

export function captureTokenUsage(
  metadata: z.infer<typeof ModelVersionMetadataSchema> | null,
): TokenUsageMetadataV1 {
  if (!metadata) return unavailableTokenUsage();
  const inputTokens = metadata.input_tokens;
  const outputTokens = metadata.output_tokens;
  const present = [inputTokens, outputTokens].filter(
    (value) => value !== null,
  ).length;
  return TokenUsageMetadataSchema.parse({
    status:
      present === 2 ? "COMPLETE" : present === 1 ? "PARTIAL" : "UNAVAILABLE",
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens:
      present === 2
        ? (inputTokens as number) + (outputTokens as number)
        : null,
    source: "PROVIDER_METADATA",
  });
}

function sameStructuredValue(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function runtimeBase(
  startedAt: string,
  completedAt: string,
  input: RunAiProviderRuntimeInput,
  model: ProviderModelMetadataV1,
) {
  return {
    contract_version: AI_PROVIDER_RUNTIME_RESULT_CONTRACT_VERSION,
    runtime_started_at: TimestampSchema.parse(startedAt),
    runtime_completed_at: TimestampSchema.parse(completedAt),
    adapter_request_id: input.adapter_request_id,
    ai_request_id: input.ai_input.ai_request_id,
    mode: "SHADOW" as const,
    configured_model_metadata: model,
    recommendation_snapshot_generated: false as const,
    database_write_performed: false as const,
    execution_performed: false as const,
    shadow_guard: AI_PROVIDER_RUNTIME_SHADOW_GUARD,
  };
}

function runtimeFailedResult(
  startedAt: string,
  completedAt: string,
  input: RunAiProviderRuntimeInput,
  model: ProviderModelMetadataV1,
  promptMetadata: PromptVersionMetadataV1 | null,
  failure: z.infer<typeof ProviderRuntimeFailureSchema>,
) {
  return deepFreeze(
    AiProviderRuntimeResultSchema.parse({
      ...runtimeBase(startedAt, completedAt, input, model),
      status: "RUNTIME_FAILED",
      prompt_version_metadata: promptMetadata,
      model_run_metadata: null,
      token_usage: unavailableTokenUsage(),
      provider_outcome: null,
      validation_result: null,
      runtime_failure: failure,
    }),
  );
}

async function verifyFinalizedAiInputDigest(
  input: AiRecommendationInputV1,
) {
  const { ai_input_digest: digest, ...payload } = input;
  return digest === (await stableSnapshotDigest(payload));
}

function parsedModelRunMetadata(response: unknown) {
  const parsed = AiProviderResponseSchema.safeParse(response);
  return parsed.success ? parsed.data.model_run_metadata : null;
}

function runtimeStatus(
  validation: AiProviderValidationResultV1,
): "VALIDATED_DRAFT" | "VALIDATION_REJECTED" | "PROVIDER_FAILED" {
  return validation.status === "ACCEPTED"
    ? "VALIDATED_DRAFT"
    : validation.status === "REJECTED"
      ? "VALIDATION_REJECTED"
      : "PROVIDER_FAILED";
}

class DefaultAiProviderRuntime implements AiProviderRuntimeV1 {
  readonly contract_version = AI_PROVIDER_RUNTIME_CONTRACT_VERSION;
  readonly #adapter: AiProviderAdapterV1;
  readonly #promptLoader: PromptVersionLoaderV1;
  readonly #model: ProviderModelMetadataV1;
  readonly #clock: () => string;

  constructor(input: CreateAiProviderRuntimeInput) {
    this.#adapter = input.adapter;
    this.#promptLoader = input.prompt_loader;
    this.#model = deepFreeze(ProviderModelMetadataSchema.parse(input.model));
    this.#clock = input.clock ?? (() => new Date().toISOString());
  }

  async run(
    input: Readonly<RunAiProviderRuntimeInput>,
  ): Promise<AiProviderRuntimeResultV1> {
    const startedAt = this.#clock();
    const parsedInput = AiRecommendationInputSchema.safeParse(input.ai_input);
    if (
      !parsedInput.success ||
      !(await verifyFinalizedAiInputDigest(
        parsedInput.success ? parsedInput.data : input.ai_input,
      ))
    ) {
      return runtimeFailedResult(
        startedAt,
        this.#clock(),
        input as RunAiProviderRuntimeInput,
        this.#model,
        null,
        {
          code: "AI_INPUT_CONTRACT_BLOCKED",
          safe_message: "Finalized AI input failed contract validation.",
          retryable: false,
          detail_codes: [],
        },
      );
    }
    const aiInput = parsedInput.data;

    if (
      this.#adapter.contract_version !==
      AI_PROVIDER_ADAPTER_CONTRACT_VERSION
    ) {
      return runtimeFailedResult(
        startedAt,
        this.#clock(),
        input as RunAiProviderRuntimeInput,
        this.#model,
        null,
        {
          code: "ADAPTER_CONTRACT_MISMATCH",
          safe_message: "Provider adapter contract is not supported.",
          retryable: false,
          detail_codes: [],
        },
      );
    }
    if (this.#adapter.provider !== this.#model.provider) {
      return runtimeFailedResult(
        startedAt,
        this.#clock(),
        input as RunAiProviderRuntimeInput,
        this.#model,
        null,
        {
          code: "ADAPTER_PROVIDER_MISMATCH",
          safe_message: "Provider adapter does not match model metadata.",
          retryable: false,
          detail_codes: [],
        },
      );
    }

    const promptReference = aiInput.prompt_contract_ref;
    const promptLoad = await this.#promptLoader.loadExact(
      promptReference.prompt_contract_code,
      promptReference.prompt_contract_version,
    );
    if (promptLoad.status === "FAILED") {
      return runtimeFailedResult(
        startedAt,
        this.#clock(),
        input as RunAiProviderRuntimeInput,
        this.#model,
        null,
        {
          code: promptLoad.failure_code,
          safe_message: "Exact prompt version could not be loaded.",
          retryable: false,
          detail_codes: promptLoad.integrity_codes,
        },
      );
    }
    const promptMetadata = promptLoad.bundle.metadata;
    if (
      !sameStructuredValue(
        promptMetadata.prompt_contract_ref,
        aiInput.prompt_contract_ref,
      ) ||
      !sameStructuredValue(
        promptMetadata.final_output_schema_ref,
        aiInput.output_schema_ref,
      )
    ) {
      return runtimeFailedResult(
        startedAt,
        this.#clock(),
        input as RunAiProviderRuntimeInput,
        this.#model,
        promptMetadata,
        {
          code: "PROMPT_METADATA_MISMATCH",
          safe_message: "Loaded prompt metadata does not match AI input.",
          retryable: false,
          detail_codes: [],
        },
      );
    }

    let request: AiProviderRequestV1;
    try {
      request = buildAiProviderRequest({
        adapter_request_id: input.adapter_request_id,
        requested_at: input.requested_at,
        ai_input: aiInput,
        prompt_version: promptMetadata,
        model: this.#model,
      });
    } catch {
      return runtimeFailedResult(
        startedAt,
        this.#clock(),
        input as RunAiProviderRuntimeInput,
        this.#model,
        promptMetadata,
        {
          code: "PROVIDER_REQUEST_BUILD_FAILED",
          safe_message: "Provider request contract could not be built.",
          retryable: false,
          detail_codes: [],
        },
      );
    }

    let response: unknown;
    try {
      response = await this.#adapter.generateDraft(request, {
        signal: input.signal,
        prompt_version: promptMetadata,
        prompt_content: promptLoad.bundle.content,
      });
    } catch {
      return runtimeFailedResult(
        startedAt,
        this.#clock(),
        input as RunAiProviderRuntimeInput,
        this.#model,
        promptMetadata,
        {
          code: input.signal?.aborted
            ? "ADAPTER_INVOCATION_CANCELLED"
            : "ADAPTER_INVOCATION_FAILED",
          safe_message: input.signal?.aborted
            ? "Provider adapter invocation was cancelled."
            : "Provider adapter invocation failed.",
          retryable: false,
          detail_codes: [],
        },
      );
    }

    const validation = await validateAiProviderResult({
      ai_input: aiInput,
      request,
      response,
      validated_at: this.#clock(),
    });
    const modelRunMetadata = parsedModelRunMetadata(response);
    return deepFreeze(
      AiProviderRuntimeResultSchema.parse({
        ...runtimeBase(
          startedAt,
          this.#clock(),
          input as RunAiProviderRuntimeInput,
          this.#model,
        ),
        status: runtimeStatus(validation),
        prompt_version_metadata: promptMetadata,
        model_run_metadata: modelRunMetadata,
        token_usage: captureTokenUsage(modelRunMetadata),
        provider_outcome: validation.provider_outcome,
        validation_result: validation,
        runtime_failure: null,
      }),
    );
  }
}

export function createAiProviderRuntime(
  input: CreateAiProviderRuntimeInput,
): AiProviderRuntimeV1 {
  return new DefaultAiProviderRuntime(input);
}

export function providerRuntimeHasNoExecutionCapability() {
  return [
    AI_RECOMMENDATION_SHADOW_GUARD,
    AI_PROVIDER_ADAPTER_SHADOW_GUARD,
    AI_PROVIDER_VALIDATION_SHADOW_GUARD,
    AI_PROVIDER_RUNTIME_SHADOW_GUARD,
  ].every((guard) =>
    Object.values(guard).every((flag) => flag === false),
  );
}
