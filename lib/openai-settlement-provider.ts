import { z } from "zod";

import {
  AI_PROVIDER_ADAPTER_CONTRACT_VERSION,
  AI_PROVIDER_MODEL_METADATA_CONTRACT_VERSION,
  AI_PROVIDER_RESPONSE_CONTRACT_VERSION,
  type AiProviderAdapterV1,
  type AiProviderRequestV1,
  type AiProviderResponseV1,
  type ProviderModelMetadataV1,
  type ProviderResolvedPromptContentV1,
  type PromptVersionMetadataV1,
} from "./settlement-ai-provider-adapter";
import { stableSnapshotDigest } from "./settlement-input-snapshot";

export const OPENAI_SETTLEMENT_PROVIDER_ID = "OPENAI" as const;
export const OPENAI_SETTLEMENT_SECRET_NAME = "OPENAI_API_KEY" as const;
export const OPENAI_SETTLEMENT_MODEL_ID =
  "gpt-4.1-2025-04-14" as const;
export const OPENAI_SETTLEMENT_MODEL_REVISION = "2025-04-14" as const;
export const OPENAI_SETTLEMENT_ENDPOINT =
  "https://api.openai.com/v1/responses" as const;

export const OPENAI_SETTLEMENT_MODEL_CONFIGURATION = Object.freeze({
  contract_version: AI_PROVIDER_MODEL_METADATA_CONTRACT_VERSION,
  configuration_id: "openai-gpt-4.1-2025-04-14-shadow@1.0.0",
  provider: OPENAI_SETTLEMENT_PROVIDER_ID,
  model_id: OPENAI_SETTLEMENT_MODEL_ID,
  model_revision: OPENAI_SETTLEMENT_MODEL_REVISION,
  deployment_id: null,
  temperature: "0",
  top_p: "1",
  max_output_tokens: 1_800,
  seed: null,
  structured_output_mode: true,
  tool_policy: "NO_TOOLS",
  timeout_ms: 25_000,
  mode: "SHADOW",
  allowlisted: true,
}) satisfies ProviderModelMetadataV1;

const OpenAiUsageSchema = z
  .object({
    input_tokens: z.number().int().nonnegative().nullable().optional(),
    output_tokens: z.number().int().nonnegative().nullable().optional(),
    total_tokens: z.number().int().nonnegative().nullable().optional(),
  })
  .passthrough();

const OpenAiResponseSchema = z
  .object({
    id: z.string().min(1),
    model: z.string().min(1),
    status: z.enum([
      "completed",
      "failed",
      "in_progress",
      "cancelled",
      "queued",
      "incomplete",
    ]),
    output: z.array(z.unknown()),
    usage: OpenAiUsageSchema.nullable().optional(),
  })
  .passthrough();

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface OpenAiSettlementProviderOptions {
  apiKey: string;
  fetcher?: FetchLike;
  clock?: () => string;
}

function modelRunMetadata(
  request: AiProviderRequestV1,
  startedAt: string,
  completedAt: string,
  values: {
    providerRequestId: string | null;
    modelRevision: string | null;
    inputTokens: number | null;
    outputTokens: number | null;
  },
) {
  return {
    provider: OPENAI_SETTLEMENT_PROVIDER_ID,
    model_id: request.model.model_id,
    model_revision: values.modelRevision,
    deployment_id: request.model.deployment_id,
    provider_request_id: values.providerRequestId,
    generation_started_at: startedAt,
    generation_completed_at: completedAt,
    temperature: request.model.temperature,
    top_p: request.model.top_p,
    max_output_tokens: request.model.max_output_tokens,
    seed: request.model.seed,
    structured_output_mode: true as const,
    tool_policy: "NO_TOOLS" as const,
    input_tokens: values.inputTokens,
    output_tokens: values.outputTokens,
  };
}

function failedResponse(
  request: AiProviderRequestV1,
  receivedAt: string,
  startedAt: string,
  values: {
    outcome:
      | "REFUSED"
      | "TIMEOUT"
      | "RATE_LIMITED"
      | "PROVIDER_UNAVAILABLE"
      | "PROVIDER_ERROR"
      | "CANCELLED";
    code:
      | "AI_PROVIDER_REFUSED"
      | "AI_PROVIDER_TIMEOUT"
      | "AI_PROVIDER_RATE_LIMITED"
      | "AI_PROVIDER_UNAVAILABLE"
      | "AI_PROVIDER_ERROR"
      | "AI_PROVIDER_CANCELLED";
    retryable: boolean;
    safeMessage: string;
    httpStatus: number | null;
    providerRequestId?: string | null;
    modelRevision?: string | null;
    inputTokens?: number | null;
    outputTokens?: number | null;
  },
) {
  return {
    contract_version: AI_PROVIDER_RESPONSE_CONTRACT_VERSION,
    adapter_request_id: request.adapter_request_id,
    ai_request_id: request.ai_request_id,
    received_at: receivedAt,
    model_run_metadata: modelRunMetadata(
      request,
      startedAt,
      receivedAt,
      {
        providerRequestId: values.providerRequestId ?? null,
        modelRevision: values.modelRevision ?? request.model.model_revision,
        inputTokens: values.inputTokens ?? null,
        outputTokens: values.outputTokens ?? null,
      },
    ),
    provider_response_digest: null,
    outcome: values.outcome,
    draft: null,
    failure: {
      code: values.code,
      retryable: values.retryable,
      safe_message: values.safeMessage,
      http_status: values.httpStatus,
    },
  };
}

function httpFailure(
  request: AiProviderRequestV1,
  startedAt: string,
  completedAt: string,
  status: number,
) {
  if (status === 408 || status === 504) {
    return failedResponse(request, completedAt, startedAt, {
      outcome: "TIMEOUT",
      code: "AI_PROVIDER_TIMEOUT",
      retryable: true,
      safeMessage: "AI provider request timed out.",
      httpStatus: status,
    });
  }
  if (status === 429) {
    return failedResponse(request, completedAt, startedAt, {
      outcome: "RATE_LIMITED",
      code: "AI_PROVIDER_RATE_LIMITED",
      retryable: true,
      safeMessage: "AI provider rate limit was reached.",
      httpStatus: status,
    });
  }
  if (status >= 500) {
    return failedResponse(request, completedAt, startedAt, {
      outcome: "PROVIDER_UNAVAILABLE",
      code: "AI_PROVIDER_UNAVAILABLE",
      retryable: true,
      safeMessage: "AI provider is temporarily unavailable.",
      httpStatus: status,
    });
  }
  return failedResponse(request, completedAt, startedAt, {
    outcome: "PROVIDER_ERROR",
    code: "AI_PROVIDER_ERROR",
    retryable: false,
    safeMessage: "AI provider rejected the controlled request.",
    httpStatus: status,
  });
}

function outputTextFromResponse(output: unknown[]) {
  let refusal = false;
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    if (!Array.isArray(record.content)) continue;
    for (const part of record.content) {
      if (!part || typeof part !== "object") continue;
      const content = part as Record<string, unknown>;
      if (content.type === "refusal") refusal = true;
      if (content.type === "output_text" && typeof content.text === "string") {
        return { text: content.text, refusal };
      }
    }
  }
  return { text: null, refusal };
}

function openAiRequestBody(
  request: AiProviderRequestV1,
  prompt: ProviderResolvedPromptContentV1,
) {
  return {
    model: request.model.model_id,
    store: false,
    background: false,
    instructions: [
      prompt.system_prompt,
      prompt.developer_prompt,
      prompt.safety_policy,
    ].join("\n\n"),
    input: prompt.user_input_template.replace(
      "{{structured_input}}",
      JSON.stringify(request.structured_input),
    ),
    temperature: Number(request.model.temperature),
    top_p: Number(request.model.top_p),
    max_output_tokens: request.model.max_output_tokens,
    text: {
      format: {
        type: "json_schema",
        name: "vnd_settlement_ai_draft_v1",
        strict: true,
        schema: prompt.provider_draft_schema_json,
      },
    },
  };
}

export class OpenAiSettlementProviderAdapter
  implements AiProviderAdapterV1
{
  readonly contract_version = AI_PROVIDER_ADAPTER_CONTRACT_VERSION;
  readonly adapter_id = "openai-responses-shadow-adapter@1.0.0";
  readonly provider = OPENAI_SETTLEMENT_PROVIDER_ID;
  readonly #apiKey: string;
  readonly #fetcher: FetchLike;
  readonly #clock: () => string;

  constructor(options: OpenAiSettlementProviderOptions) {
    const key = options.apiKey.trim();
    if (!key) throw new Error("OPENAI_API_KEY_MISSING");
    this.#apiKey = key;
    this.#fetcher = options.fetcher ?? fetch;
    this.#clock = options.clock ?? (() => new Date().toISOString());
  }

  async generateDraft(
    request: Readonly<AiProviderRequestV1>,
    options: Readonly<{
      signal?: AbortSignal;
      prompt_version: PromptVersionMetadataV1;
      prompt_content: ProviderResolvedPromptContentV1;
    }>,
  ): Promise<AiProviderResponseV1> {
    const startedAt = this.#clock();
    const timeout = AbortSignal.timeout(request.timeout_ms);
    const signal = options.signal
      ? AbortSignal.any([options.signal, timeout])
      : timeout;
    try {
      const response = await this.#fetcher(OPENAI_SETTLEMENT_ENDPOINT, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.#apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(
          openAiRequestBody(request, options.prompt_content),
        ),
        signal,
      });
      const completedAt = this.#clock();
      if (!response.ok) {
        return httpFailure(request, startedAt, completedAt, response.status);
      }

      const contentLength = Number(response.headers.get("content-length"));
      if (Number.isFinite(contentLength) && contentLength > 2_000_000) {
        return failedResponse(request, completedAt, startedAt, {
          outcome: "PROVIDER_ERROR",
          code: "AI_PROVIDER_ERROR",
          retryable: false,
          safeMessage: "AI provider response exceeded the safe size limit.",
          httpStatus: response.status,
        });
      }
      const parsed = OpenAiResponseSchema.safeParse(await response.json());
      if (!parsed.success) {
        return failedResponse(request, completedAt, startedAt, {
          outcome: "PROVIDER_ERROR",
          code: "AI_PROVIDER_ERROR",
          retryable: false,
          safeMessage: "AI provider response envelope was invalid.",
          httpStatus: response.status,
        });
      }
      const providerResponse = parsed.data;
      if (providerResponse.model !== request.model.model_id) {
        return failedResponse(request, completedAt, startedAt, {
          outcome: "PROVIDER_ERROR",
          code: "AI_PROVIDER_ERROR",
          retryable: false,
          safeMessage: "AI provider returned a model outside the exact allowlist.",
          httpStatus: response.status,
          providerRequestId: providerResponse.id,
        });
      }
      const usage = providerResponse.usage;
      const metadata = {
        providerRequestId: providerResponse.id,
        modelRevision: request.model.model_revision,
        inputTokens: usage?.input_tokens ?? null,
        outputTokens: usage?.output_tokens ?? null,
      };
      const output = outputTextFromResponse(providerResponse.output);
      if (output.refusal) {
        return failedResponse(request, completedAt, startedAt, {
          outcome: "REFUSED",
          code: "AI_PROVIDER_REFUSED",
          retryable: false,
          safeMessage: "AI provider refused the request.",
          httpStatus: response.status,
          ...metadata,
        });
      }
      if (providerResponse.status !== "completed" || !output.text) {
        return failedResponse(request, completedAt, startedAt, {
          outcome: "PROVIDER_ERROR",
          code: "AI_PROVIDER_ERROR",
          retryable: false,
          safeMessage: "AI provider did not return a completed draft.",
          httpStatus: response.status,
          ...metadata,
        });
      }

      let draft: unknown;
      try {
        draft = JSON.parse(output.text);
      } catch {
        draft = output.text;
      }
      return {
        contract_version: AI_PROVIDER_RESPONSE_CONTRACT_VERSION,
        adapter_request_id: request.adapter_request_id,
        ai_request_id: request.ai_request_id,
        received_at: completedAt,
        model_run_metadata: modelRunMetadata(
          request,
          startedAt,
          completedAt,
          metadata,
        ),
        provider_response_digest: await stableSnapshotDigest({
          provider_request_id: providerResponse.id,
          model: providerResponse.model,
          draft,
        }),
        outcome: "COMPLETED",
        draft: draft as NonNullable<AiProviderResponseV1["draft"]>,
        failure: null,
      };
    } catch {
      const completedAt = this.#clock();
      const externallyCancelled = options.signal?.aborted === true;
      const timedOut = signal.aborted && !externallyCancelled;
      return failedResponse(request, completedAt, startedAt, {
        outcome: externallyCancelled
          ? "CANCELLED"
          : timedOut
            ? "TIMEOUT"
            : "PROVIDER_UNAVAILABLE",
        code: externallyCancelled
          ? "AI_PROVIDER_CANCELLED"
          : timedOut
            ? "AI_PROVIDER_TIMEOUT"
            : "AI_PROVIDER_UNAVAILABLE",
        retryable: !externallyCancelled,
        safeMessage: externallyCancelled
          ? "AI provider request was cancelled."
          : timedOut
            ? "AI provider request timed out."
            : "AI provider is temporarily unavailable.",
        httpStatus: null,
      });
    }
  }
}

export function createConfiguredOpenAiSettlementAdapter(
  env: Partial<Record<typeof OPENAI_SETTLEMENT_SECRET_NAME, string>> =
    { OPENAI_API_KEY: process.env.OPENAI_API_KEY },
) {
  const apiKey = env[OPENAI_SETTLEMENT_SECRET_NAME]?.trim();
  if (!apiKey) {
    return {
      configured: false as const,
      secret_name: OPENAI_SETTLEMENT_SECRET_NAME,
      adapter: null,
    };
  }
  return {
    configured: true as const,
    secret_name: OPENAI_SETTLEMENT_SECRET_NAME,
    adapter: new OpenAiSettlementProviderAdapter({ apiKey }),
  };
}
