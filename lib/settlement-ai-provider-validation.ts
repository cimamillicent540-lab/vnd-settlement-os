import { z } from "zod";

import {
  AI_RECOMMENDATION_SHADOW_GUARD,
  AiRecommendationInputSchema,
  AiRecommendationShadowGuardSchema,
  DecimalStringSchema,
  DigestSchema,
  TimestampSchema,
  type AiRecommendationInputV1,
} from "./settlement-ai-recommendation-framework";
import {
  AI_PROVIDER_ADAPTER_SHADOW_GUARD,
  AiProviderRequestSchema,
  AiProviderResponseSchema,
  ProviderDraftObjectSchema,
  ProviderFailureSchema,
  ProviderOutcomeSchema,
  type AiProviderRequestV1,
  type AiProviderResponseV1,
  type ProviderDraftObjectV1,
} from "./settlement-ai-provider-adapter";
import { stableSnapshotDigest } from "./settlement-input-snapshot";

export const AI_PROVIDER_VALIDATION_CONTRACT_VERSION =
  "AI_PROVIDER_VALIDATION_RESULT_V1" as const;

export const AI_PROVIDER_VALIDATION_SHADOW_GUARD = Object.freeze({
  automatic_topup: false,
  automatic_payment: false,
  automatic_quote_change: false,
  automatic_trading: false,
  automatic_channel_switch: false,
  third_party_submission: false,
  approval_workflow: false,
});

export const AiProviderValidationIssueSchema = z
  .object({
    code: z.string().min(1).max(160),
    path: z.string().min(1).max(1_000),
    message: z.string().min(1).max(1_000),
    severity: z.literal("BLOCKING"),
  })
  .strict();

export const ValidatedDecimalBindingSchema = z
  .object({
    source: z.enum(["SNAPSHOT", "DETERMINISTIC_RESULT"]),
    source_path: z.string().min(1).max(500),
    value: DecimalStringSchema,
    unit: z.enum([
      "VND",
      "USDT",
      "RATIO",
      "VND_PER_USDT",
      "STATUS",
      "TIMESTAMP",
      "TEXT",
      "NONE",
    ]),
    status: z.enum(["COMPLETE", "LIMITED", "BLOCKED"]),
    evidence_ids: z.array(z.string().uuid()),
  })
  .strict();

const ValidationResultBaseSchema = z
  .object({
    contract_version: z.literal(
      AI_PROVIDER_VALIDATION_CONTRACT_VERSION,
    ),
    status: z.enum(["ACCEPTED", "REJECTED", "PROVIDER_FAILED"]),
    validated_at: TimestampSchema,
    adapter_request_id: z.string().uuid().nullable(),
    ai_request_id: z.string().uuid().nullable(),
    provider_outcome: ProviderOutcomeSchema.nullable(),
    issues: z.array(AiProviderValidationIssueSchema),
    validated_draft: ProviderDraftObjectSchema.nullable(),
    draft_digest: DigestSchema.nullable(),
    evidence_ids: z.array(z.string().uuid()),
    decimal_bindings: z.array(ValidatedDecimalBindingSchema),
    provider_failure: ProviderFailureSchema.nullable(),
    recommendation_snapshot_generated: z.literal(false),
    database_write_performed: z.literal(false),
    execution_performed: z.literal(false),
    shadow_guard: AiRecommendationShadowGuardSchema,
  })
  .strict();

export const AcceptedAiProviderValidationResultSchema =
  ValidationResultBaseSchema.extend({
    status: z.literal("ACCEPTED"),
    provider_outcome: z.literal("COMPLETED"),
    issues: z.array(AiProviderValidationIssueSchema).length(0),
    validated_draft: ProviderDraftObjectSchema,
    draft_digest: DigestSchema,
    provider_failure: z.null(),
  }).strict();

export const RejectedAiProviderValidationResultSchema =
  ValidationResultBaseSchema.extend({
    status: z.literal("REJECTED"),
    issues: z.array(AiProviderValidationIssueSchema).min(1),
    validated_draft: z.null(),
    draft_digest: z.null(),
    evidence_ids: z.array(z.string().uuid()).length(0),
    decimal_bindings: z
      .array(ValidatedDecimalBindingSchema)
      .length(0),
    provider_failure: z.null(),
  }).strict();

export const FailedAiProviderValidationResultSchema =
  ValidationResultBaseSchema.extend({
    status: z.literal("PROVIDER_FAILED"),
    provider_outcome: z.enum([
      "REFUSED",
      "TIMEOUT",
      "RATE_LIMITED",
      "PROVIDER_UNAVAILABLE",
      "PROVIDER_ERROR",
      "CANCELLED",
    ]),
    issues: z.array(AiProviderValidationIssueSchema).min(1),
    validated_draft: z.null(),
    draft_digest: z.null(),
    evidence_ids: z.array(z.string().uuid()).length(0),
    decimal_bindings: z
      .array(ValidatedDecimalBindingSchema)
      .length(0),
    provider_failure: ProviderFailureSchema,
  }).strict();

export const AiProviderValidationResultSchema = z.discriminatedUnion(
  "status",
  [
    AcceptedAiProviderValidationResultSchema,
    RejectedAiProviderValidationResultSchema,
    FailedAiProviderValidationResultSchema,
  ],
);

export type AiProviderValidationIssue = z.infer<
  typeof AiProviderValidationIssueSchema
>;
export type ValidatedDecimalBindingV1 = z.infer<
  typeof ValidatedDecimalBindingSchema
>;
export type AiProviderValidationResultV1 = z.infer<
  typeof AiProviderValidationResultSchema
>;

export interface AiDraftSchemaValidationResult {
  valid: boolean;
  draft: ProviderDraftObjectV1 | null;
  issues: AiProviderValidationIssue[];
}

export interface DecimalIntegrityValidationResult {
  valid: boolean;
  bindings: ValidatedDecimalBindingV1[];
  issues: AiProviderValidationIssue[];
}

export interface ValidateAiProviderResultInput {
  ai_input: unknown;
  request: unknown;
  response: unknown;
  validated_at: string;
}

function issue(
  code: string,
  path: string,
  message: string,
): AiProviderValidationIssue {
  return { code, path, message, severity: "BLOCKING" };
}

function zodIssues(
  error: z.ZodError,
  code: string,
  prefix: string,
) {
  return error.issues.map((item) =>
    issue(
      code,
      [prefix, item.path.join(".")].filter(Boolean).join("."),
      item.message,
    ),
  );
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

function sameStructuredValue(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function unique(values: readonly string[]) {
  return [...new Set(values)].sort((left, right) =>
    left.localeCompare(right),
  );
}

function containsAll(
  container: readonly string[],
  required: readonly string[],
) {
  const values = new Set(container);
  return required.every((value) => values.has(value));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function readString(value: unknown, key: string) {
  const record = asRecord(value);
  return record && typeof record[key] === "string"
    ? (record[key] as string)
    : null;
}

function readUuid(value: unknown, key: string) {
  const candidate = readString(value, key);
  return candidate && z.string().uuid().safeParse(candidate).success
    ? candidate
    : null;
}

function readProviderOutcome(value: unknown) {
  const candidate = readString(value, "outcome");
  const parsed = ProviderOutcomeSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

function readNested(value: unknown, ...keys: string[]) {
  let current = value;
  for (const key of keys) {
    const record = asRecord(current);
    if (!record) return undefined;
    current = record[key];
  }
  return current;
}

function baseResult(
  status: "ACCEPTED" | "REJECTED" | "PROVIDER_FAILED",
  validatedAt: string,
  request: unknown,
  response: unknown,
) {
  return {
    contract_version: AI_PROVIDER_VALIDATION_CONTRACT_VERSION,
    status,
    validated_at: TimestampSchema.parse(validatedAt),
    adapter_request_id: readUuid(request, "adapter_request_id"),
    ai_request_id:
      readUuid(request, "ai_request_id") ??
      readUuid(response, "ai_request_id"),
    provider_outcome: readProviderOutcome(response),
    recommendation_snapshot_generated: false as const,
    database_write_performed: false as const,
    execution_performed: false as const,
    shadow_guard: AI_PROVIDER_VALIDATION_SHADOW_GUARD,
  };
}

function rejectedResult(
  validatedAt: string,
  request: unknown,
  response: unknown,
  issues: AiProviderValidationIssue[],
): AiProviderValidationResultV1 {
  return deepFreeze(
    AiProviderValidationResultSchema.parse({
      ...baseResult("REJECTED", validatedAt, request, response),
      issues,
      validated_draft: null,
      draft_digest: null,
      evidence_ids: [],
      decimal_bindings: [],
      provider_failure: null,
    }),
  );
}

const SHADOW_GUARD_KEYS = [
  "automatic_topup",
  "automatic_payment",
  "automatic_quote_change",
  "automatic_trading",
  "automatic_channel_switch",
  "third_party_submission",
  "approval_workflow",
] as const;

const PROHIBITED_DRAFT_KEYS = new Set([
  ...SHADOW_GUARD_KEYS,
  "automatic_execution",
  "approval_status",
  "approved_at",
  "execution_payload",
  "payment_payload",
  "topup_payload",
  "trade_payload",
]);

function prohibitedDraftKeyPaths(
  value: unknown,
  path = "draft",
): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      prohibitedDraftKeyPaths(item, `${path}.${index}`),
    );
  }
  const record = asRecord(value);
  if (!record) return [];
  return Object.entries(record).flatMap(([key, nested]) => [
    ...(PROHIBITED_DRAFT_KEYS.has(key) ? [`${path}.${key}`] : []),
    ...prohibitedDraftKeyPaths(nested, `${path}.${key}`),
  ]);
}

export function validateAiDraftSchema(
  candidate: unknown,
): AiDraftSchemaValidationResult {
  const parsed = ProviderDraftObjectSchema.safeParse(candidate);
  const guardPaths = prohibitedDraftKeyPaths(candidate);
  const issues = guardPaths.map((path) =>
    issue(
      "AI_SHADOW_GUARD_REJECTED",
      path,
      "Provider draft contains a prohibited guard or execution field",
    ),
  );
  if (!parsed.success) {
    issues.push(
      ...zodIssues(parsed.error, "AI_DRAFT_SCHEMA_INVALID", "draft"),
    );
  }
  return {
    valid: issues.length === 0,
    draft:
      parsed.success && issues.length === 0
        ? deepFreeze(parsed.data)
        : null,
    issues,
  };
}

function shadowObjectIssues(value: unknown, path: string) {
  const parsed = AiRecommendationShadowGuardSchema.safeParse(value);
  return parsed.success
    ? []
    : zodIssues(
        parsed.error,
        "AI_SHADOW_GUARD_REJECTED",
        path,
      );
}

export function validateShadowGuard(
  aiInputCandidate: unknown,
  requestCandidate: unknown,
  draftCandidate?: unknown,
) {
  const issues = [
    ...shadowObjectIssues(
      readNested(aiInputCandidate, "shadow_guard"),
      "ai_input.shadow_guard",
    ),
    ...shadowObjectIssues(
      readNested(requestCandidate, "shadow_guard"),
      "request.shadow_guard",
    ),
    ...shadowObjectIssues(
      readNested(requestCandidate, "structured_input", "shadow_guard"),
      "request.structured_input.shadow_guard",
    ),
  ];
  for (const [path, value] of [
    ["request.tool_policy", readNested(requestCandidate, "tool_policy")],
    [
      "request.model.tool_policy",
      readNested(requestCandidate, "model", "tool_policy"),
    ],
    [
      "request.prompt_version.tool_policy",
      readNested(requestCandidate, "prompt_version", "tool_policy"),
    ],
  ] as const) {
    if (value !== "NO_TOOLS") {
      issues.push(
        issue(
          "AI_SHADOW_GUARD_REJECTED",
          path,
          "Provider tools must remain disabled",
        ),
      );
    }
  }
  if (draftCandidate !== undefined) {
    issues.push(
      ...prohibitedDraftKeyPaths(draftCandidate).map((path) =>
        issue(
          "AI_SHADOW_GUARD_REJECTED",
          path,
          "Provider draft contains a prohibited guard or execution field",
        ),
      ),
    );
  }
  return issues;
}

function requestProjectionIssues(
  aiInput: AiRecommendationInputV1,
  request: AiProviderRequestV1,
) {
  const issues: AiProviderValidationIssue[] = [];
  const expectedProjection = {
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
  if (!sameStructuredValue(request.structured_input, expectedProjection)) {
    issues.push(
      issue(
        "AI_INPUT_PROJECTION_MISMATCH",
        "request.structured_input",
        "Provider request projection must exactly match finalized AI input",
      ),
    );
  }
  if (
    !sameStructuredValue(
      request.prompt_version.prompt_contract_ref,
      aiInput.prompt_contract_ref,
    ) ||
    !sameStructuredValue(
      request.prompt_version.final_output_schema_ref,
      aiInput.output_schema_ref,
    )
  ) {
    issues.push(
      issue(
        "AI_INPUT_PROJECTION_MISMATCH",
        "request.prompt_version",
        "Prompt and output schema metadata must match finalized AI input",
      ),
    );
  }
  return issues;
}

function decimalProjectionIssues(
  aiInput: AiRecommendationInputV1,
  request: AiProviderRequestV1,
) {
  const issues: AiProviderValidationIssue[] = [];
  const inputFacts = new Map(
    aiInput.approved_fact_projection.facts.map((fact) => [
      inputFactKey(fact),
      fact,
    ]),
  );
  const requestFacts =
    request.structured_input.approved_fact_projection.facts;
  for (const requestFact of requestFacts) {
    const inputFact = inputFacts.get(inputFactKey(requestFact));
    if (
      !inputFact ||
      inputFact.value_type !== requestFact.value_type ||
      inputFact.value !== requestFact.value ||
      inputFact.unit !== requestFact.unit
    ) {
      issues.push(
        issue(
          "AI_DECIMAL_INTEGRITY_REJECTED",
          `request.structured_input.approved_fact_projection.${requestFact.fact_id}`,
          "Provider request fact differs from finalized AI input",
        ),
      );
    }
  }
  if (requestFacts.length !== inputFacts.size) {
    issues.push(
      issue(
        "AI_DECIMAL_INTEGRITY_REJECTED",
        "request.structured_input.approved_fact_projection",
        "Provider request fact count differs from finalized AI input",
      ),
    );
  }
  return issues;
}

function responseIdentityIssues(
  request: AiProviderRequestV1,
  response: AiProviderResponseV1,
) {
  const issues: AiProviderValidationIssue[] = [];
  if (
    response.adapter_request_id !== request.adapter_request_id ||
    response.ai_request_id !== request.ai_request_id
  ) {
    issues.push(
      issue(
        "AI_RESPONSE_IDENTITY_MISMATCH",
        "response",
        "Provider response identity must match the adapter request",
      ),
    );
  }
  const run = response.model_run_metadata;
  const model = request.model;
  if (
    run.provider !== model.provider ||
    run.model_id !== model.model_id ||
    run.model_revision !== model.model_revision ||
    run.deployment_id !== model.deployment_id ||
    run.temperature !== model.temperature ||
    run.top_p !== model.top_p ||
    run.max_output_tokens !== model.max_output_tokens ||
    run.seed !== model.seed ||
    run.structured_output_mode !== model.structured_output_mode ||
    run.tool_policy !== model.tool_policy
  ) {
    issues.push(
      issue(
        "AI_MODEL_METADATA_MISMATCH",
        "response.model_run_metadata",
        "Provider response model metadata must match allowlisted request",
      ),
    );
  }
  if (
    Date.parse(run.generation_completed_at) >
    Date.parse(response.received_at)
  ) {
    issues.push(
      issue(
        "AI_RESPONSE_TIME_INVALID",
        "response.received_at",
        "Response cannot be received before generation completes",
      ),
    );
  }
  return issues;
}

function allClaims(draft: ProviderDraftObjectV1) {
  return [...draft.fact_summary, ...draft.risk_summary];
}

export function validateEvidenceReferences(
  draft: ProviderDraftObjectV1,
  request: AiProviderRequestV1,
) {
  const issues: AiProviderValidationIssue[] = [];
  const evidenceIds = new Set(
    request.structured_input.evidence_catalog.map(
      (evidence) => evidence.evidence_id,
    ),
  );
  const deterministicFacts = new Map(
    request.structured_input.approved_fact_projection.facts
      .filter((fact) => fact.source === "DETERMINISTIC_RESULT")
      .map((fact) => [fact.source_path, fact]),
  );
  const snapshotFacts = new Map(
    request.structured_input.approved_fact_projection.facts
      .filter((fact) => fact.source === "SNAPSHOT")
      .map((fact) => [fact.source_path, fact]),
  );
  const claimIds = new Set<string>();
  const citedEvidenceIds: string[] = [];

  for (const claim of allClaims(draft)) {
    if (claimIds.has(claim.claim_id)) {
      issues.push(
        issue(
          "AI_DUPLICATE_IDENTIFIER",
          `draft.claims.${claim.claim_id}`,
          "Claim identifiers must be unique",
        ),
      );
    }
    claimIds.add(claim.claim_id);
    for (const evidenceId of claim.evidence_ids) {
      citedEvidenceIds.push(evidenceId);
      if (!evidenceIds.has(evidenceId)) {
        issues.push(
          issue(
            "AI_EVIDENCE_REFERENCE_MISSING",
            `draft.claims.${claim.claim_id}.evidence_ids`,
            `Evidence ${evidenceId} is not in the approved catalog`,
          ),
        );
      }
    }
    for (const path of claim.deterministic_result_paths) {
      const fact = deterministicFacts.get(path);
      if (!fact) {
        issues.push(
          issue(
            "AI_SOURCE_PATH_NOT_ALLOWLISTED",
            `draft.claims.${claim.claim_id}.deterministic_result_paths`,
            `Deterministic path ${path} is not allowlisted`,
          ),
        );
      } else if (!containsAll(claim.evidence_ids, fact.evidence_ids)) {
        issues.push(
          issue(
            "AI_EVIDENCE_REFERENCE_MISSING",
            `draft.claims.${claim.claim_id}.evidence_ids`,
            `Claim is missing evidence required by ${path}`,
          ),
        );
      }
    }
    for (const path of claim.snapshot_paths) {
      const fact = snapshotFacts.get(path);
      if (!fact) {
        issues.push(
          issue(
            "AI_SOURCE_PATH_NOT_ALLOWLISTED",
            `draft.claims.${claim.claim_id}.snapshot_paths`,
            `Snapshot path ${path} is not allowlisted`,
          ),
        );
      } else if (!containsAll(claim.evidence_ids, fact.evidence_ids)) {
        issues.push(
          issue(
            "AI_EVIDENCE_REFERENCE_MISSING",
            `draft.claims.${claim.claim_id}.evidence_ids`,
            `Claim is missing evidence required by ${path}`,
          ),
        );
      }
    }
    if (
      claim.evidence_ids.length === 0 &&
      claim.deterministic_result_paths.length === 0 &&
      claim.snapshot_paths.length === 0 &&
      claim.limitations.length === 0
    ) {
      issues.push(
        issue(
          "AI_EVIDENCE_REFERENCE_MISSING",
          `draft.claims.${claim.claim_id}`,
          "Every claim must carry evidence, an allowlisted path, or a limitation",
        ),
      );
    }
  }

  const recommendationIds = new Set<string>();
  for (const recommendation of draft.recommendations) {
    if (recommendationIds.has(recommendation.recommendation_id)) {
      issues.push(
        issue(
          "AI_DUPLICATE_IDENTIFIER",
          `draft.recommendations.${recommendation.recommendation_id}`,
          "Recommendation identifiers must be unique",
        ),
      );
    }
    recommendationIds.add(recommendation.recommendation_id);
    for (const claimId of recommendation.claim_ids) {
      if (!claimIds.has(claimId)) {
        issues.push(
          issue(
            "AI_CLAIM_REFERENCE_MISSING",
            `draft.recommendations.${recommendation.recommendation_id}.claim_ids`,
            `Claim ${claimId} does not exist in the draft`,
          ),
        );
      }
    }
    for (const evidenceId of recommendation.evidence_ids) {
      citedEvidenceIds.push(evidenceId);
      if (!evidenceIds.has(evidenceId)) {
        issues.push(
          issue(
            "AI_EVIDENCE_REFERENCE_MISSING",
            `draft.recommendations.${recommendation.recommendation_id}.evidence_ids`,
            `Evidence ${evidenceId} is not in the approved catalog`,
          ),
        );
      }
    }
    for (const path of recommendation.deterministic_result_paths) {
      const fact = deterministicFacts.get(path);
      if (!fact) {
        issues.push(
          issue(
            "AI_SOURCE_PATH_NOT_ALLOWLISTED",
            `draft.recommendations.${recommendation.recommendation_id}.deterministic_result_paths`,
            `Deterministic path ${path} is not allowlisted`,
          ),
        );
      } else if (
        !containsAll(recommendation.evidence_ids, fact.evidence_ids)
      ) {
        issues.push(
          issue(
            "AI_EVIDENCE_REFERENCE_MISSING",
            `draft.recommendations.${recommendation.recommendation_id}.evidence_ids`,
            `Recommendation is missing evidence required by ${path}`,
          ),
        );
      }
    }
    for (const path of recommendation.referenced_value_paths) {
      const matches = [
        deterministicFacts.get(path),
        snapshotFacts.get(path),
      ].filter((fact) => fact !== undefined);
      if (matches.length === 1) {
        const fact = matches[0];
        if (!containsAll(recommendation.evidence_ids, fact.evidence_ids)) {
          issues.push(
            issue(
              "AI_EVIDENCE_REFERENCE_MISSING",
              `draft.recommendations.${recommendation.recommendation_id}.evidence_ids`,
              `Recommendation is missing evidence required by ${path}`,
            ),
          );
        }
      }
    }
  }

  const inheritedLimitations = new Set([
    ...request.structured_input.limitations,
    ...request.structured_input.blocking_reasons,
  ]);
  for (const required of inheritedLimitations) {
    if (!draft.limitations.includes(required)) {
      issues.push(
        issue(
          "AI_INHERITED_LIMITATION_MISSING",
          "draft.limitations",
          `Inherited limitation ${required} must remain visible`,
        ),
      );
    }
  }

  return {
    valid: issues.length === 0,
    evidence_ids: unique(citedEvidenceIds),
    issues,
  };
}

function inputFactKey(fact: {
  source: string;
  source_path: string;
}) {
  return `${fact.source}:${fact.source_path}`;
}

export function validateDecimalIntegrity(
  aiInput: AiRecommendationInputV1,
  request: AiProviderRequestV1,
  draft: ProviderDraftObjectV1,
): DecimalIntegrityValidationResult {
  const issues = decimalProjectionIssues(aiInput, request);
  const requestFacts =
    request.structured_input.approved_fact_projection.facts;

  const factsByPath = new Map<string, typeof requestFacts>();
  for (const fact of requestFacts) {
    const existing = factsByPath.get(fact.source_path) ?? [];
    existing.push(fact);
    factsByPath.set(fact.source_path, existing);
  }
  const referencedPaths = unique(
    draft.recommendations.flatMap(
      (recommendation) => recommendation.referenced_value_paths,
    ),
  );
  const bindings: ValidatedDecimalBindingV1[] = [];
  for (const path of referencedPaths) {
    const matches = factsByPath.get(path) ?? [];
    if (matches.length !== 1) {
      issues.push(
        issue(
          "AI_DECIMAL_INTEGRITY_REJECTED",
          "draft.recommendations.referenced_value_paths",
          `Referenced value path ${path} must resolve to one approved fact`,
        ),
      );
      continue;
    }
    const fact = matches[0];
    if (
      fact.value_type !== "DECIMAL" ||
      typeof fact.value !== "string" ||
      !DecimalStringSchema.safeParse(fact.value).success ||
      fact.unit === null
    ) {
      issues.push(
        issue(
          "AI_DECIMAL_INTEGRITY_REJECTED",
          "draft.recommendations.referenced_value_paths",
          `Referenced value path ${path} is not an approved decimal fact`,
        ),
      );
      continue;
    }
    bindings.push({
      source: fact.source,
      source_path: fact.source_path,
      value: fact.value,
      unit: fact.unit,
      status: fact.status,
      evidence_ids: [...fact.evidence_ids],
    });
  }

  return {
    valid: issues.length === 0,
    bindings: issues.length === 0 ? bindings : [],
    issues,
  };
}

const RESTRICTED_LANGUAGE_PATTERNS: Array<{
  code: string;
  pattern: RegExp;
}> = [
  {
    code: "EXECUTION_INSTRUCTION",
    pattern:
      /(?:^|[.!?]\s*)(?:please\s+)?(?:execute|submit|approve|pay|trade|transfer|schedule)\b/i,
  },
  {
    code: "TOPUP_OR_QUOTE_INSTRUCTION",
    pattern:
      /(?:^|[.!?]\s*)(?:please\s+)?(?:top\s*up|change\b.{0,80}\bquote\b)/i,
  },
  {
    code: "FALSE_EXECUTION_STATUS",
    pattern:
      /\b(?:has been|was|is)\s+(?:executed|submitted|approved|paid|traded|scheduled)\b/i,
  },
  {
    code: "CHINESE_EXECUTION_INSTRUCTION",
    pattern:
      /(?:^|[。！？]\s*)(?:请)?(?:执行|提交|批准|付款|转账|补U|交易|修改.{0,30}报价)/,
  },
  {
    code: "CHINESE_FALSE_EXECUTION_STATUS",
    pattern: /(?:已执行|已提交|已批准|已付款|已补U|已交易|报价已修改)/,
  },
  {
    code: "ACTION_URL_OR_MARKUP",
    pattern: /(?:https?:\/\/|<script\b|javascript:)/i,
  },
];

function draftTextFields(draft: ProviderDraftObjectV1) {
  return [
    ...allClaims(draft).map((claim) => ({
      path: `draft.claims.${claim.claim_id}.claim_text`,
      value: claim.claim_text,
    })),
    ...draft.recommendations.flatMap((recommendation) => [
      {
        path: `draft.recommendations.${recommendation.recommendation_id}.title`,
        value: recommendation.title,
      },
      {
        path: `draft.recommendations.${recommendation.recommendation_id}.statement`,
        value: recommendation.statement,
      },
      {
        path: `draft.recommendations.${recommendation.recommendation_id}.human_review_request`,
        value: recommendation.human_review_request,
      },
    ]),
  ];
}

export function validateRestrictionLanguage(
  draft: ProviderDraftObjectV1,
) {
  const issues: AiProviderValidationIssue[] = [];
  for (const field of draftTextFields(draft)) {
    for (const restriction of RESTRICTED_LANGUAGE_PATTERNS) {
      if (restriction.pattern.test(field.value)) {
        issues.push(
          issue(
            "AI_RESTRICTION_LANGUAGE_REJECTED",
            field.path,
            `Restricted language detected: ${restriction.code}`,
          ),
        );
      }
    }
  }
  return issues;
}

function completedDraftCandidate(response: unknown) {
  return readNested(response, "draft");
}

export async function validateAiProviderResult(
  input: ValidateAiProviderResultInput,
): Promise<AiProviderValidationResultV1> {
  const inputParsed = AiRecommendationInputSchema.safeParse(input.ai_input);
  if (!inputParsed.success) {
    return rejectedResult(
      input.validated_at,
      input.request,
      input.response,
      zodIssues(
        inputParsed.error,
        "AI_INPUT_SCHEMA_INVALID",
        "ai_input",
      ),
    );
  }

  const {
    ai_input_digest: aiInputDigest,
    ...aiInputDigestPayload
  } = inputParsed.data;
  const expectedAiInputDigest = await stableSnapshotDigest(
    aiInputDigestPayload,
  );
  const inputIntegrityIssues =
    aiInputDigest === expectedAiInputDigest
      ? []
      : [
          issue(
            "AI_INPUT_DIGEST_MISMATCH",
            "ai_input.ai_input_digest",
            "Finalized AI input digest does not match its canonical payload",
          ),
        ];

  const preflightShadowIssues = validateShadowGuard(
    input.ai_input,
    input.request,
    completedDraftCandidate(input.response),
  );
  const requestParsed = AiProviderRequestSchema.safeParse(input.request);
  if (!requestParsed.success) {
    return rejectedResult(
      input.validated_at,
      input.request,
      input.response,
      [
        ...inputIntegrityIssues,
        ...preflightShadowIssues,
        ...zodIssues(
          requestParsed.error,
          "AI_PROVIDER_REQUEST_SCHEMA_INVALID",
          "request",
        ),
      ],
    );
  }
  const request = requestParsed.data;
  const requestIssues = [
    ...inputIntegrityIssues,
    ...preflightShadowIssues,
    ...requestProjectionIssues(inputParsed.data, request),
    ...decimalProjectionIssues(inputParsed.data, request),
  ];

  const responseParsed = AiProviderResponseSchema.safeParse(input.response);
  if (!responseParsed.success) {
    const rawDraft = completedDraftCandidate(input.response);
    const draftValidation =
      readString(input.response, "outcome") === "COMPLETED"
        ? validateAiDraftSchema(rawDraft)
        : { valid: false, draft: null, issues: [] };
    const schemaCode =
      readString(input.response, "outcome") === "COMPLETED"
        ? "AI_DRAFT_SCHEMA_INVALID"
        : "AI_PROVIDER_RESPONSE_SCHEMA_INVALID";
    return rejectedResult(
      input.validated_at,
      request,
      input.response,
      [
        ...requestIssues,
        ...draftValidation.issues,
        ...zodIssues(responseParsed.error, schemaCode, "response"),
      ],
    );
  }
  const response = responseParsed.data;
  const responseIssues = [
    ...requestIssues,
    ...responseIdentityIssues(request, response),
  ];
  if (responseIssues.length > 0) {
    return rejectedResult(
      input.validated_at,
      request,
      response,
      responseIssues,
    );
  }

  if (response.outcome !== "COMPLETED") {
    return deepFreeze(
      AiProviderValidationResultSchema.parse({
        ...baseResult(
          "PROVIDER_FAILED",
          input.validated_at,
          request,
          response,
        ),
        issues: [
          issue(
            response.failure.code,
            "response.failure",
            response.failure.safe_message,
          ),
        ],
        validated_draft: null,
        draft_digest: null,
        evidence_ids: [],
        decimal_bindings: [],
        provider_failure: response.failure,
      }),
    );
  }

  const draftValidation = validateAiDraftSchema(response.draft);
  if (!draftValidation.valid || !draftValidation.draft) {
    return rejectedResult(
      input.validated_at,
      request,
      response,
      draftValidation.issues,
    );
  }
  const draft = draftValidation.draft;
  const evidenceValidation = validateEvidenceReferences(draft, request);
  const decimalValidation = validateDecimalIntegrity(
    inputParsed.data,
    request,
    draft,
  );
  const restrictionIssues = validateRestrictionLanguage(draft);
  const shadowIssues = validateShadowGuard(
    inputParsed.data,
    request,
    draft,
  );
  const issues = [
    ...evidenceValidation.issues,
    ...decimalValidation.issues,
    ...restrictionIssues,
    ...shadowIssues,
  ];
  if (issues.length > 0) {
    return rejectedResult(
      input.validated_at,
      request,
      response,
      issues,
    );
  }

  return deepFreeze(
    AiProviderValidationResultSchema.parse({
      ...baseResult(
        "ACCEPTED",
        input.validated_at,
        request,
        response,
      ),
      issues: [],
      validated_draft: draft,
      draft_digest: await stableSnapshotDigest(draft),
      evidence_ids: evidenceValidation.evidence_ids,
      decimal_bindings: decimalValidation.bindings,
      provider_failure: null,
    }),
  );
}

export function providerValidationHasNoExecutionCapability() {
  return [
    AI_RECOMMENDATION_SHADOW_GUARD,
    AI_PROVIDER_ADAPTER_SHADOW_GUARD,
    AI_PROVIDER_VALIDATION_SHADOW_GUARD,
  ].every((guard) =>
    Object.values(guard).every((flag) => flag === false),
  );
}
