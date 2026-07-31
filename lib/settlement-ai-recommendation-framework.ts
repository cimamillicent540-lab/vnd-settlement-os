import Decimal from "decimal.js";
import { z } from "zod";

import {
  SETTLEMENT_DETERMINISTIC_CONTRACT_VERSION,
  SETTLEMENT_DETERMINISTIC_SHADOW_GUARD,
  type SettlementDeterministicCalculationResultV1,
} from "./settlement-deterministic-calculation";
import {
  SETTLEMENT_INPUT_CONTRACT_VERSION,
  SETTLEMENT_INPUT_SHADOW_GUARD,
  stableSnapshotDigest,
  type SettlementInputSnapshotV1,
  type SnapshotQualityStatus,
} from "./settlement-input-snapshot";

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export const AI_RECOMMENDATION_INPUT_CONTRACT_VERSION =
  "SETTLEMENT_AI_RECOMMENDATION_INPUT_V1" as const;
export const AI_RECOMMENDATION_OUTPUT_CONTRACT_VERSION =
  "SETTLEMENT_AI_RECOMMENDATION_OUTPUT_V1" as const;
export const AI_RECOMMENDATION_SNAPSHOT_CONTRACT_VERSION =
  "AI_RECOMMENDATION_SNAPSHOT_V1" as const;

export const AI_RECOMMENDATION_SHADOW_GUARD = Object.freeze({
  automatic_topup: false,
  automatic_payment: false,
  automatic_quote_change: false,
  automatic_trading: false,
  automatic_channel_switch: false,
  third_party_submission: false,
  approval_workflow: false,
});

const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;
const DECIMAL_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;
const RFC3339_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export const DigestSchema = z.string().regex(SHA256_PATTERN);
export const DecimalStringSchema = z
  .string()
  .regex(DECIMAL_PATTERN)
  .refine((value) => new Decimal(value).isFinite(), {
    message: "Decimal string must be finite",
  });
export const TimestampSchema = z
  .string()
  .regex(RFC3339_PATTERN)
  .refine((value) => Number.isFinite(Date.parse(value)), {
    message: "Timestamp must be valid RFC 3339",
  });
export const QualityStatusSchema = z.enum([
  "COMPLETE",
  "LIMITED",
  "BLOCKED",
]);
export const FreshnessStatusSchema = z.enum([
  "FRESH",
  "AGING",
  "STALE",
  "MISSING",
  "FUTURE_DATED",
]);

export const AiRecommendationShadowGuardSchema = z
  .object({
    automatic_topup: z.literal(false),
    automatic_payment: z.literal(false),
    automatic_quote_change: z.literal(false),
    automatic_trading: z.literal(false),
    automatic_channel_switch: z.literal(false),
    third_party_submission: z.literal(false),
    approval_workflow: z.literal(false),
  })
  .strict();

export const SnapshotReferenceSchema = z
  .object({
    contract_version: z.literal(SETTLEMENT_INPUT_CONTRACT_VERSION),
    snapshot_id: z.string().uuid(),
    input_digest: DigestSchema,
    data_quality_status: QualityStatusSchema,
    evidence_ids: z.array(z.string().uuid()),
  })
  .strict();

export const CalculationReferenceSchema = z
  .object({
    contract_version: z.literal(
      SETTLEMENT_DETERMINISTIC_CONTRACT_VERSION,
    ),
    engine_version: z.string().min(1),
    snapshot_id: z.string().uuid(),
    input_digest: DigestSchema,
    ruleset_version: z.string().min(1),
    ruleset_digest: DigestSchema,
    result_digest: DigestSchema,
    status: QualityStatusSchema,
    evidence_refs: z.array(z.string().uuid()),
  })
  .strict();

export const EvidenceCatalogItemSchema = z
  .object({
    evidence_id: z.string().uuid(),
    source_key: z.string().min(1),
    content_digest: DigestSchema,
    observed_at: TimestampSchema,
    cutoff_at: TimestampSchema.nullable(),
    freshness_status: FreshnessStatusSchema,
    completeness_status: z.string().min(1),
    redaction_status: z.literal("NO_SECRETS_INCLUDED"),
  })
  .strict();

export const ApprovedFactSchema = z
  .object({
    fact_id: z.string().uuid(),
    source: z.enum(["SNAPSHOT", "DETERMINISTIC_RESULT"]),
    source_path: z.string().min(1),
    value_type: z.enum([
      "DECIMAL",
      "ENUM",
      "BOOLEAN",
      "TIMESTAMP",
      "TEXT",
      "NULL",
    ]),
    value: z.union([z.string(), z.boolean(), z.null()]),
    unit: z
      .enum([
        "VND",
        "USDT",
        "RATIO",
        "VND_PER_USDT",
        "STATUS",
        "TIMESTAMP",
        "TEXT",
        "NONE",
      ])
      .nullable(),
    status: QualityStatusSchema,
    evidence_ids: z.array(z.string().uuid()),
    limitations: z.array(z.string()),
  })
  .strict()
  .superRefine((fact, context) => {
    if (
      fact.value_type === "DECIMAL" &&
      (typeof fact.value !== "string" ||
        !DecimalStringSchema.safeParse(fact.value).success)
    ) {
      context.addIssue({
        code: "custom",
        path: ["value"],
        message: "DECIMAL fact value must be a decimal string",
      });
    }
    if (fact.value_type === "BOOLEAN" && typeof fact.value !== "boolean") {
      context.addIssue({
        code: "custom",
        path: ["value"],
        message: "BOOLEAN fact value must be boolean",
      });
    }
    if (fact.value_type === "NULL" && fact.value !== null) {
      context.addIssue({
        code: "custom",
        path: ["value"],
        message: "NULL fact value must be null",
      });
    }
    if (
      fact.value_type === "TIMESTAMP" &&
      (typeof fact.value !== "string" ||
        !TimestampSchema.safeParse(fact.value).success)
    ) {
      context.addIssue({
        code: "custom",
        path: ["value"],
        message: "TIMESTAMP fact value must be RFC 3339",
      });
    }
  });

export const ApprovedFactProjectionSchema = z
  .object({
    projection_version: z.literal("SETTLEMENT_AI_FACT_PROJECTION_V1"),
    facts: z.array(ApprovedFactSchema),
  })
  .strict();

export const PromptContractReferenceSchema = z
  .object({
    prompt_contract_code: z.string().min(1),
    prompt_contract_version: z.string().min(1),
    system_prompt_digest: DigestSchema,
    developer_prompt_digest: DigestSchema,
    user_input_template_digest: DigestSchema,
    output_schema_version: z.string().min(1),
    output_schema_digest: DigestSchema,
    safety_policy_version: z.string().min(1),
    allowed_scope_version: z.string().min(1),
    language: z.string().min(1),
  })
  .strict();

export const OutputSchemaReferenceSchema = z
  .object({
    schema_code: z.literal(AI_RECOMMENDATION_OUTPUT_CONTRACT_VERSION),
    schema_version: z.string().min(1),
    schema_digest: DigestSchema,
  })
  .strict();

export const ModelVersionMetadataSchema = z
  .object({
    provider: z.string().min(1),
    model_id: z.string().min(1),
    model_revision: z.string().min(1).nullable(),
    deployment_id: z.string().min(1).nullable(),
    provider_request_id: z.string().min(1).nullable(),
    generation_started_at: TimestampSchema,
    generation_completed_at: TimestampSchema,
    temperature: DecimalStringSchema,
    top_p: DecimalStringSchema,
    max_output_tokens: z.number().int().positive(),
    seed: z.number().int().nullable(),
    structured_output_mode: z.literal(true),
    tool_policy: z.literal("NO_TOOLS"),
    input_tokens: z.number().int().nonnegative().nullable(),
    output_tokens: z.number().int().nonnegative().nullable(),
  })
  .strict()
  .superRefine((metadata, context) => {
    if (
      Date.parse(metadata.generation_completed_at) <
      Date.parse(metadata.generation_started_at)
    ) {
      context.addIssue({
        code: "custom",
        path: ["generation_completed_at"],
        message: "Model generation cannot complete before it starts",
      });
    }
  });

export const RecommendationScopeSchema = z.enum([
  "FACT_EXPLANATION",
  "LIQUIDITY_REVIEW",
  "PROFIT_REVIEW",
  "FX_OBSERVATION",
  "QUOTE_REVIEW",
  "RISK_SUMMARY",
  "DATA_QUALITY_REVIEW",
]);

export const AiRecommendationInputSchema = z
  .object({
    contract_version: z.literal(
      AI_RECOMMENDATION_INPUT_CONTRACT_VERSION,
    ),
    ai_request_id: z.string().uuid(),
    requested_at: TimestampSchema,
    as_of: TimestampSchema,
    currency: z.literal("VND"),
    operating_timezone: z.literal("Asia/Shanghai"),
    mode: z.literal("SHADOW"),
    input_snapshot_ref: SnapshotReferenceSchema,
    calculation_result_ref: CalculationReferenceSchema,
    approved_fact_projection: ApprovedFactProjectionSchema,
    evidence_catalog: z.array(EvidenceCatalogItemSchema),
    limitations: z.array(z.string()),
    blocking_reasons: z.array(z.string()),
    requested_scopes: z.array(RecommendationScopeSchema).min(1),
    presentation_context: z
      .object({
        language: z.string().min(1),
        audience: z.enum(["SETTLEMENT_OPERATOR", "CEO", "INTERNAL_REVIEW"]),
        output_style: z.literal("STRUCTURED_FACTUAL"),
      })
      .strict(),
    prompt_contract_ref: PromptContractReferenceSchema,
    output_schema_ref: OutputSchemaReferenceSchema,
    shadow_guard: AiRecommendationShadowGuardSchema,
    ai_input_digest: DigestSchema,
  })
  .strict();

export const ClaimSchema = z
  .object({
    claim_id: z.string().uuid(),
    claim_text: z.string().min(1),
    claim_type: z.enum([
      "DETERMINISTIC_FACT",
      "SOURCE_FACT",
      "LIMITATION",
      "QUALITATIVE_REVIEW_SUGGESTION",
    ]),
    deterministic_result_paths: z.array(z.string().min(1)),
    snapshot_paths: z.array(z.string().min(1)),
    evidence_ids: z.array(z.string().uuid()),
    support_status: z.enum([
      "SUPPORTED",
      "LIMITED_SUPPORT",
      "UNSUPPORTED",
      "CONFLICT",
    ]),
    limitations: z.array(z.string()),
  })
  .strict();

export const ReferencedValueSchema = z
  .object({
    source_path: z.string().min(1),
    value: DecimalStringSchema,
    unit: z.enum(["VND", "USDT", "RATIO", "VND_PER_USDT"]),
    currency: z.enum(["VND", "USDT"]).nullable(),
    formula_id: z.string().min(1).nullable(),
    evidence_ids: z.array(z.string().uuid()),
    status: QualityStatusSchema,
  })
  .strict();

const ConfidenceScoreSchema = z
  .string()
  .regex(/^(?:0|1)\.\d{6}$/)
  .refine((value) => {
    const score = new Decimal(value);
    return score.gte(0) && score.lte(1);
  });

export const ConfidenceSchema = z
  .object({
    input_quality_score: ConfidenceScoreSchema,
    evidence_coverage_score: ConfidenceScoreSchema,
    freshness_score: ConfidenceScoreSchema,
    deterministic_support_score: ConfidenceScoreSchema,
    schema_validation_score: ConfidenceScoreSchema,
    raw_score: ConfidenceScoreSchema,
    applied_caps: z.array(
      z
        .object({
          code: z.string().min(1),
          max_score: ConfidenceScoreSchema,
        })
        .strict(),
    ),
    final_score: ConfidenceScoreSchema,
    band: z.enum(["HIGH", "MEDIUM", "LOW", "INSUFFICIENT"]),
    reason_codes: z.array(z.string()),
  })
  .strict();

export const RecommendationItemSchema = z
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
    title: z.string().min(1),
    statement: z.string().min(1),
    reason_codes: z.array(z.string()),
    priority: z.enum(["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"]),
    action_mode: z.literal("HUMAN_REVIEW_ONLY"),
    human_review_request: z.string().min(1),
    referenced_values: z.array(ReferencedValueSchema),
    claim_ids: z.array(z.string().uuid()),
    deterministic_result_paths: z.array(z.string().min(1)),
    evidence_ids: z.array(z.string().uuid()),
    confidence: ConfidenceSchema,
    limitations: z.array(z.string()),
    automatic_execution: z.literal(false),
  })
  .strict();

export const EvidenceChainStepSchema = z
  .object({
    step: z.enum([
      "SNAPSHOT_REFERENCED",
      "DETERMINISTIC_RESULT_REFERENCED",
      "AI_FACT_PROJECTION_CREATED",
      "AI_INPUT_VALIDATED",
      "MODEL_GENERATED",
      "OUTPUT_SCHEMA_VALIDATED",
      "CLAIMS_EVIDENCE_VALIDATED",
      "SHADOW_GUARD_VALIDATED",
      "RECOMMENDATION_SNAPSHOT_FINALIZED",
    ]),
    step_time: TimestampSchema,
    validator_version: z.string().min(1),
    input_digest: DigestSchema,
    output_digest: DigestSchema,
    status: z.enum(["COMPLETE", "LIMITED", "BLOCKED", "REJECTED"]),
    codes: z.array(z.string()),
  })
  .strict();

export const EvidenceChainSchema = z
  .object({
    chain_version: z.literal("AI_RECOMMENDATION_EVIDENCE_CHAIN_V1"),
    steps: z.array(EvidenceChainStepSchema).length(9),
    chain_digest: DigestSchema,
  })
  .strict();

export const RecommendationSnapshotSchema = z
  .object({
    contract_version: z.literal(
      AI_RECOMMENDATION_OUTPUT_CONTRACT_VERSION,
    ),
    snapshot_contract_version: z.literal(
      AI_RECOMMENDATION_SNAPSHOT_CONTRACT_VERSION,
    ),
    recommendation_snapshot_id: z.string().uuid(),
    recommendation_key: z.string().min(1),
    recommendation_version: z.number().int().positive(),
    supersedes_snapshot_id: z.string().uuid().nullable(),
    status: z.enum([
      "ACTIVE",
      "LIMITED_BY_DATA",
      "BLOCKED_BY_DATA",
      "REJECTED_BY_VALIDATION",
    ]),
    created_at: TimestampSchema,
    as_of: TimestampSchema,
    currency: z.literal("VND"),
    mode: z.literal("SHADOW"),
    authoritative: z.literal(false),
    input_snapshot_ref: SnapshotReferenceSchema,
    calculation_result_ref: CalculationReferenceSchema,
    ai_input_digest: DigestSchema,
    prompt_contract_ref: PromptContractReferenceSchema,
    model_ref: ModelVersionMetadataSchema,
    fact_summary: z.array(ClaimSchema),
    risk_summary: z.array(ClaimSchema),
    recommendations: z.array(RecommendationItemSchema),
    confidence: ConfidenceSchema,
    limitations: z.array(z.string()),
    evidence_chain: EvidenceChainSchema,
    output_digest: DigestSchema,
    shadow_guard: AiRecommendationShadowGuardSchema,
  })
  .strict();

export type AiRecommendationInputV1 = z.infer<
  typeof AiRecommendationInputSchema
>;
export type RecommendationClaimV1 = z.infer<typeof ClaimSchema>;
export type RecommendationConfidenceV1 = z.infer<
  typeof ConfidenceSchema
>;
export type RecommendationSnapshotV1 = z.infer<
  typeof RecommendationSnapshotSchema
>;
export type RecommendationItemV1 = z.infer<
  typeof RecommendationItemSchema
>;
export type EvidenceChainStepV1 = z.infer<
  typeof EvidenceChainStepSchema
>;

export interface FrameworkValidationIssue {
  code: string;
  path: string;
  message: string;
}

export interface FrameworkValidationReport {
  valid: boolean;
  issues: FrameworkValidationIssue[];
}

export interface ConfidenceCalculationInput {
  input_status: SnapshotQualityStatus;
  freshness_statuses: Array<
    "FRESH" | "AGING" | "STALE" | "MISSING" | "FUTURE_DATED"
  >;
  material_claim_count: number;
  supported_material_claim_count: number;
  deterministic_claim_count: number;
  verified_deterministic_claim_count: number;
  schema_valid: boolean;
  data_quality_only: boolean;
}

export class RecommendationFrameworkValidationError extends Error {
  readonly issues: FrameworkValidationIssue[];

  constructor(message: string, issues: FrameworkValidationIssue[]) {
    super(message);
    this.name = "RecommendationFrameworkValidationError";
    this.issues = issues;
  }
}

function unique(values: readonly string[]) {
  return [...new Set(values)].sort((left, right) =>
    left.localeCompare(right),
  );
}

function score(value: Decimal.Value) {
  const decimal = new Decimal(value);
  const bounded = Decimal.max(0, Decimal.min(decimal, 1));
  return bounded.toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toFixed(6);
}

function confidenceBand(value: Decimal.Value) {
  const decimal = new Decimal(value);
  if (decimal.gte("0.850000")) return "HIGH" as const;
  if (decimal.gte("0.650000")) return "MEDIUM" as const;
  if (decimal.gte("0.350000")) return "LOW" as const;
  return "INSUFFICIENT" as const;
}

function validatedCount(
  value: number,
  maximum: number | null,
  label: string,
) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  if (maximum !== null && value > maximum) {
    throw new Error(`${label} cannot exceed its total`);
  }
  return new Decimal(value);
}

export function calculateRecommendationConfidence(
  input: ConfidenceCalculationInput,
): RecommendationConfidenceV1 {
  const materialClaims = validatedCount(
    input.material_claim_count,
    null,
    "material_claim_count",
  );
  const supportedClaims = validatedCount(
    input.supported_material_claim_count,
    input.material_claim_count,
    "supported_material_claim_count",
  );
  const deterministicClaims = validatedCount(
    input.deterministic_claim_count,
    input.material_claim_count,
    "deterministic_claim_count",
  );
  const verifiedDeterministicClaims = validatedCount(
    input.verified_deterministic_claim_count,
    input.deterministic_claim_count,
    "verified_deterministic_claim_count",
  );

  const inputQuality = new Decimal(
    input.input_status === "COMPLETE"
      ? 1
      : input.input_status === "LIMITED"
        ? "0.6"
        : 0,
  );
  const freshnessValues = input.freshness_statuses.map((status) =>
    new Decimal(
      status === "FRESH"
        ? 1
        : status === "AGING"
          ? "0.75"
          : status === "STALE"
            ? "0.25"
            : 0,
    ),
  );
  const freshness =
    freshnessValues.length === 0
      ? new Decimal(0)
      : freshnessValues
          .reduce((sum, value) => sum.plus(value), new Decimal(0))
          .div(freshnessValues.length);
  const evidenceCoverage = materialClaims.eq(0)
    ? new Decimal(0)
    : supportedClaims.div(materialClaims);
  const deterministicSupport = deterministicClaims.eq(0)
    ? new Decimal(input.data_quality_only ? 1 : 0)
    : verifiedDeterministicClaims.div(deterministicClaims);
  const schemaValidation = new Decimal(input.schema_valid ? 1 : 0);
  const raw = inputQuality
    .mul("0.30")
    .plus(evidenceCoverage.mul("0.25"))
    .plus(freshness.mul("0.20"))
    .plus(deterministicSupport.mul("0.20"))
    .plus(schemaValidation.mul("0.05"));

  const caps: RecommendationConfidenceV1["applied_caps"] = [];
  const reasonCodes: string[] = [];
  if (input.input_status === "LIMITED") {
    caps.push({
      code: "INPUT_QUALITY_LIMITED_CAP",
      max_score: "0.700000",
    });
    reasonCodes.push("INPUT_QUALITY_LIMITED");
  }
  if (input.input_status === "BLOCKED") {
    caps.push({
      code: "INPUT_QUALITY_BLOCKED_CAP",
      max_score: "0.000000",
    });
    reasonCodes.push("INPUT_QUALITY_BLOCKED");
  }
  if (input.freshness_statuses.includes("STALE")) {
    caps.push({
      code: "STALE_EVIDENCE_CAP",
      max_score: "0.500000",
    });
    reasonCodes.push("STALE_EVIDENCE_CITED");
  }
  if (!input.schema_valid) {
    caps.push({
      code: "SCHEMA_VALIDATION_FAILED_CAP",
      max_score: "0.000000",
    });
    reasonCodes.push("SCHEMA_VALIDATION_FAILED");
  }
  const capped = caps.reduce(
    (value, cap) => Decimal.min(value, cap.max_score),
    raw,
  );
  const finalScore = score(capped);

  return ConfidenceSchema.parse({
    input_quality_score: score(inputQuality),
    evidence_coverage_score: score(evidenceCoverage),
    freshness_score: score(freshness),
    deterministic_support_score: score(deterministicSupport),
    schema_validation_score: score(schemaValidation),
    raw_score: score(raw),
    applied_caps: caps,
    final_score: finalScore,
    band: confidenceBand(finalScore),
    reason_codes: unique(reasonCodes),
  });
}

function zodIssues(error: z.ZodError) {
  return error.issues.map(
    (issue): FrameworkValidationIssue => ({
      code: "SCHEMA_INVALID",
      path: issue.path.join("."),
      message: issue.message,
    }),
  );
}

function issue(
  issues: FrameworkValidationIssue[],
  code: string,
  path: string,
  message: string,
) {
  issues.push({ code, path, message });
}

function report(issues: FrameworkValidationIssue[]) {
  return {
    valid: issues.length === 0,
    issues,
  } satisfies FrameworkValidationReport;
}

function allFalse(value: Record<string, unknown>) {
  return Object.values(value).every((flag) => flag === false);
}

function valueAtPath(value: unknown, path: string): unknown {
  let current = value;
  for (const part of path.split(".")) {
    if (
      current === null ||
      typeof current !== "object" ||
      !(part in current)
    ) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function samePrimitive(left: unknown, right: unknown) {
  return (
    (left === null || ["string", "boolean", "number"].includes(typeof left)) &&
    left === right
  );
}

function containsAll(
  container: readonly string[],
  required: readonly string[],
) {
  const values = new Set(container);
  return required.every((value) => values.has(value));
}

function sameStringSet(
  left: readonly string[],
  right: readonly string[],
) {
  return (
    left.length === right.length &&
    unique(left).every((value, index) => value === unique(right)[index])
  );
}

function sameStructuredValue(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

const PROHIBITED_EXECUTION_LANGUAGE = [
  /(?:^|[.!?]\s*)(?:please\s+)?(?:execute|submit|approve|pay|trade)\b/i,
  /(?:^|[.!?]\s*)(?:please\s+)?(?:top\s*up|change\b.{0,80}\bquote\b)/i,
  /(?:^|[。！？]\s*)(?:请)?(?:执行|提交|批准|付款|补U|交易|修改.{0,30}报价)/,
];

function containsProhibitedExecutionLanguage(value: string) {
  return PROHIBITED_EXECUTION_LANGUAGE.some((pattern) =>
    pattern.test(value),
  );
}

export function validateAiRecommendationInputAgainstUpstream(
  candidate: unknown,
  snapshot: SettlementInputSnapshotV1,
  calculation: SettlementDeterministicCalculationResultV1,
): FrameworkValidationReport {
  const parsed = AiRecommendationInputSchema.safeParse(candidate);
  if (!parsed.success) return report(zodIssues(parsed.error));
  const input = parsed.data;
  const issues: FrameworkValidationIssue[] = [];

  if (input.input_snapshot_ref.snapshot_id !== snapshot.snapshot_id) {
    issue(
      issues,
      "SNAPSHOT_ID_MISMATCH",
      "input_snapshot_ref.snapshot_id",
      "Snapshot ID does not match upstream",
    );
  }
  if (
    input.input_snapshot_ref.input_digest !== snapshot.input_digest ||
    input.calculation_result_ref.input_digest !== snapshot.input_digest
  ) {
    issue(
      issues,
      "INPUT_DIGEST_MISMATCH",
      "input_snapshot_ref.input_digest",
      "Input digest does not match upstream",
    );
  }
  if (
    input.calculation_result_ref.snapshot_id !== calculation.snapshot_id ||
    input.calculation_result_ref.result_digest !==
      calculation.result_digest ||
    input.calculation_result_ref.engine_version !==
      calculation.engine_version ||
    input.calculation_result_ref.ruleset_version !==
      calculation.ruleset_ref.ruleset_version ||
    input.calculation_result_ref.ruleset_digest !==
      calculation.ruleset_ref.ruleset_digest ||
    !sameStringSet(
      input.calculation_result_ref.evidence_refs,
      calculation.evidence_refs,
    )
  ) {
    issue(
      issues,
      "CALCULATION_REFERENCE_MISMATCH",
      "calculation_result_ref",
      "Calculation reference does not match upstream",
    );
  }
  if (
    !sameStringSet(
      input.input_snapshot_ref.evidence_ids,
      snapshot.input_evidence.map((evidence) => evidence.evidence_id),
    )
  ) {
    issue(
      issues,
      "SNAPSHOT_EVIDENCE_REFERENCE_MISMATCH",
      "input_snapshot_ref.evidence_ids",
      "Snapshot evidence references must exactly match upstream",
    );
  }
  if (
    input.as_of !== snapshot.as_of ||
    input.as_of !== calculation.as_of
  ) {
    issue(
      issues,
      "AS_OF_MISMATCH",
      "as_of",
      "as_of must match both upstream contracts",
    );
  }
  if (
    input.input_snapshot_ref.data_quality_status !==
      snapshot.data_quality.status ||
    input.calculation_result_ref.status !== calculation.status
  ) {
    issue(
      issues,
      "QUALITY_STATUS_MISMATCH",
      "input_snapshot_ref.data_quality_status",
      "Quality status must not be upgraded or hidden",
    );
  }
  if (
    !allFalse(snapshot.shadow_guard) ||
    !allFalse(calculation.shadow_guard) ||
    !allFalse(input.shadow_guard)
  ) {
    issue(
      issues,
      "SHADOW_GUARD_INVALID",
      "shadow_guard",
      "Every Shadow Guard flag must be false",
    );
  }

  const snapshotEvidence = new Map(
    snapshot.input_evidence.map((evidence) => [
      evidence.evidence_id,
      evidence,
    ]),
  );
  const upstreamEvidenceIds = new Set([
    ...snapshotEvidence.keys(),
    ...calculation.evidence_refs,
  ]);
  for (const evidence of input.evidence_catalog) {
    const upstream = snapshotEvidence.get(evidence.evidence_id);
    if (!upstreamEvidenceIds.has(evidence.evidence_id) || !upstream) {
      issue(
        issues,
        "EVIDENCE_NOT_IN_UPSTREAM",
        `evidence_catalog.${evidence.evidence_id}`,
        "Evidence ID is not present in the upstream snapshot",
      );
      continue;
    }
    if (evidence.content_digest !== upstream.content_digest) {
      issue(
        issues,
        "EVIDENCE_DIGEST_MISMATCH",
        `evidence_catalog.${evidence.evidence_id}.content_digest`,
        "Evidence digest does not match upstream",
      );
    }
  }
  const catalogIds = new Set(
    input.evidence_catalog.map((evidence) => evidence.evidence_id),
  );
  const seenFactIds = new Set<string>();
  for (const fact of input.approved_fact_projection.facts) {
    if (seenFactIds.has(fact.fact_id)) {
      issue(
        issues,
        "DUPLICATE_FACT_ID",
        `approved_fact_projection.${fact.fact_id}`,
        "Fact IDs must be unique",
      );
    }
    seenFactIds.add(fact.fact_id);
    const source =
      fact.source === "SNAPSHOT" ? snapshot : calculation;
    const upstreamValue = valueAtPath(source, fact.source_path);
    if (upstreamValue === undefined) {
      issue(
        issues,
        "FACT_SOURCE_PATH_INVALID",
        `approved_fact_projection.${fact.fact_id}.source_path`,
        "Approved fact path does not exist upstream",
      );
    } else if (!samePrimitive(fact.value, upstreamValue)) {
      issue(
        issues,
        "FACT_VALUE_MISMATCH",
        `approved_fact_projection.${fact.fact_id}.value`,
        "Approved fact value must exactly match upstream",
      );
    }
    for (const evidenceId of fact.evidence_ids) {
      if (!catalogIds.has(evidenceId)) {
        issue(
          issues,
          "FACT_EVIDENCE_NOT_ALLOWLISTED",
          `approved_fact_projection.${fact.fact_id}.evidence_ids`,
          "Fact evidence must exist in the allowlisted catalog",
        );
      }
    }
  }

  if (
    !containsAll(input.limitations, [
      ...snapshot.data_quality.limitations,
      ...calculation.limitations,
    ])
  ) {
    issue(
      issues,
      "INHERITED_LIMITATION_MISSING",
      "limitations",
      "AI input must preserve upstream limitations",
    );
  }
  if (
    !containsAll(input.blocking_reasons, [
      ...snapshot.data_quality.blocking_reasons,
      ...calculation.blocking_reasons,
    ])
  ) {
    issue(
      issues,
      "INHERITED_BLOCKER_MISSING",
      "blocking_reasons",
      "AI input must preserve upstream blocking reasons",
    );
  }

  return report(issues);
}

export async function finalizeAiRecommendationInput(
  candidate: Omit<AiRecommendationInputV1, "ai_input_digest">,
  snapshot: SettlementInputSnapshotV1,
  calculation: SettlementDeterministicCalculationResultV1,
) {
  const parsedCandidate = AiRecommendationInputSchema.omit({
    ai_input_digest: true,
  }).parse(candidate);
  const finalized = {
    ...parsedCandidate,
    ai_input_digest: await stableSnapshotDigest(parsedCandidate),
  };
  const validation = validateAiRecommendationInputAgainstUpstream(
    finalized,
    snapshot,
    calculation,
  );
  if (!validation.valid) {
    throw new RecommendationFrameworkValidationError(
      "AI recommendation input validation failed",
      validation.issues,
    );
  }
  return deepFreeze(AiRecommendationInputSchema.parse(finalized));
}

function confidenceConsistencyIssues(
  confidence: RecommendationConfidenceV1,
  path: string,
) {
  const issues: FrameworkValidationIssue[] = [];
  const raw = new Decimal(confidence.input_quality_score)
    .mul("0.30")
    .plus(
      new Decimal(confidence.evidence_coverage_score).mul("0.25"),
    )
    .plus(new Decimal(confidence.freshness_score).mul("0.20"))
    .plus(
      new Decimal(confidence.deterministic_support_score).mul("0.20"),
    )
    .plus(
      new Decimal(confidence.schema_validation_score).mul("0.05"),
    );
  const expectedRaw = score(raw);
  if (confidence.raw_score !== expectedRaw) {
    issue(
      issues,
      "CONFIDENCE_RAW_SCORE_MISMATCH",
      `${path}.raw_score`,
      "Raw confidence score does not match frozen weights",
    );
  }
  const capped = confidence.applied_caps.reduce(
    (value, cap) => Decimal.min(value, cap.max_score),
    raw,
  );
  const expectedFinal = score(capped);
  if (confidence.final_score !== expectedFinal) {
    issue(
      issues,
      "CONFIDENCE_FINAL_SCORE_MISMATCH",
      `${path}.final_score`,
      "Final confidence score does not match applied caps",
    );
  }
  if (confidence.band !== confidenceBand(expectedFinal)) {
    issue(
      issues,
      "CONFIDENCE_BAND_MISMATCH",
      `${path}.band`,
      "Confidence band does not match final score",
    );
  }
  return issues;
}

function confidenceCapIssues(
  confidence: RecommendationConfidenceV1,
  path: string,
  inputStatus: SnapshotQualityStatus,
  freshnessStatuses: Array<
    "FRESH" | "AGING" | "STALE" | "MISSING" | "FUTURE_DATED"
  >,
) {
  const issues: FrameworkValidationIssue[] = [];
  const requiredCaps: Array<{ code: string; maxScore: string }> = [];
  if (inputStatus === "LIMITED") {
    requiredCaps.push({
      code: "INPUT_QUALITY_LIMITED_CAP",
      maxScore: "0.700000",
    });
  }
  if (inputStatus === "BLOCKED") {
    requiredCaps.push({
      code: "INPUT_QUALITY_BLOCKED_CAP",
      maxScore: "0.000000",
    });
  }
  if (freshnessStatuses.includes("STALE")) {
    requiredCaps.push({
      code: "STALE_EVIDENCE_CAP",
      maxScore: "0.500000",
    });
  }
  for (const required of requiredCaps) {
    if (
      !confidence.applied_caps.some(
        (cap) =>
          cap.code === required.code &&
          cap.max_score === required.maxScore,
      )
    ) {
      issue(
        issues,
        "CONFIDENCE_REQUIRED_CAP_MISSING",
        `${path}.applied_caps`,
        `Required confidence cap ${required.code} is missing`,
      );
    }
    if (new Decimal(confidence.final_score).gt(required.maxScore)) {
      issue(
        issues,
        "CONFIDENCE_CAP_EXCEEDED",
        `${path}.final_score`,
        `Confidence exceeds required cap ${required.maxScore}`,
      );
    }
  }
  return issues;
}

function allClaims(snapshot: RecommendationSnapshotV1) {
  return [...snapshot.fact_summary, ...snapshot.risk_summary];
}

function inheritedStatus(
  input: AiRecommendationInputV1,
): SnapshotQualityStatus {
  const statuses = [
    input.input_snapshot_ref.data_quality_status,
    input.calculation_result_ref.status,
  ];
  return statuses.includes("BLOCKED")
    ? "BLOCKED"
    : statuses.includes("LIMITED")
      ? "LIMITED"
      : "COMPLETE";
}

const EVIDENCE_CHAIN_ORDER = [
  "SNAPSHOT_REFERENCED",
  "DETERMINISTIC_RESULT_REFERENCED",
  "AI_FACT_PROJECTION_CREATED",
  "AI_INPUT_VALIDATED",
  "MODEL_GENERATED",
  "OUTPUT_SCHEMA_VALIDATED",
  "CLAIMS_EVIDENCE_VALIDATED",
  "SHADOW_GUARD_VALIDATED",
  "RECOMMENDATION_SNAPSHOT_FINALIZED",
] as const;

export async function validateRecommendationSnapshotAgainstInput(
  candidate: unknown,
  input: AiRecommendationInputV1,
): Promise<FrameworkValidationReport> {
  const parsed = RecommendationSnapshotSchema.safeParse(candidate);
  if (!parsed.success) return report(zodIssues(parsed.error));
  const snapshot = parsed.data;
  const issues: FrameworkValidationIssue[] = [];

  if (
    !sameStructuredValue(
      snapshot.input_snapshot_ref,
      input.input_snapshot_ref,
    )
  ) {
    issue(
      issues,
      "OUTPUT_SNAPSHOT_REFERENCE_MISMATCH",
      "input_snapshot_ref",
      "Output snapshot reference must match AI input",
    );
  }
  if (
    !sameStructuredValue(
      snapshot.calculation_result_ref,
      input.calculation_result_ref,
    )
  ) {
    issue(
      issues,
      "OUTPUT_CALCULATION_REFERENCE_MISMATCH",
      "calculation_result_ref",
      "Output calculation reference must match AI input",
    );
  }
  if (
    snapshot.ai_input_digest !== input.ai_input_digest ||
    snapshot.as_of !== input.as_of
  ) {
    issue(
      issues,
      "OUTPUT_INPUT_IDENTITY_MISMATCH",
      "ai_input_digest",
      "Output must retain exact AI input identity",
    );
  }
  if (
    !sameStructuredValue(
      snapshot.prompt_contract_ref,
      input.prompt_contract_ref,
    )
  ) {
    issue(
      issues,
      "PROMPT_VERSION_MISMATCH",
      "prompt_contract_ref",
      "Output prompt metadata must match AI input",
    );
  }

  const inputStatus = inheritedStatus(input);
  if (inputStatus === "BLOCKED") {
    if (
      snapshot.status !== "BLOCKED_BY_DATA" &&
      snapshot.status !== "REJECTED_BY_VALIDATION"
    ) {
      issue(
        issues,
        "BLOCKED_INPUT_STATUS_UPGRADED",
        "status",
        "Blocked input cannot produce a normal recommendation snapshot",
      );
    }
    if (
      snapshot.recommendations.some(
        (item) => item.recommendation_type !== "DATA_QUALITY_REVIEW",
      )
    ) {
      issue(
        issues,
        "BLOCKED_INPUT_OPERATIONAL_REVIEW_PRESENT",
        "recommendations",
        "Blocked input may contain data-quality review only",
      );
    }
  }
  if (inputStatus === "LIMITED" && snapshot.status === "ACTIVE") {
    issue(
      issues,
      "LIMITED_INPUT_STATUS_UPGRADED",
      "status",
      "Limited input cannot produce ACTIVE status",
    );
  }

  const evidenceIds = new Set(
    input.evidence_catalog.map((evidence) => evidence.evidence_id),
  );
  const deterministicPaths = new Map(
    input.approved_fact_projection.facts
      .filter((fact) => fact.source === "DETERMINISTIC_RESULT")
      .map((fact) => [fact.source_path, fact]),
  );
  const snapshotPaths = new Set(
    input.approved_fact_projection.facts
      .filter((fact) => fact.source === "SNAPSHOT")
      .map((fact) => fact.source_path),
  );
  const claimIds = new Set<string>();
  for (const claim of allClaims(snapshot)) {
    if (claimIds.has(claim.claim_id)) {
      issue(
        issues,
        "DUPLICATE_CLAIM_ID",
        `claims.${claim.claim_id}`,
        "Claim IDs must be unique",
      );
    }
    claimIds.add(claim.claim_id);
    if (containsProhibitedExecutionLanguage(claim.claim_text)) {
      issue(
        issues,
        "EXECUTABLE_LANGUAGE_REJECTED",
        `claims.${claim.claim_id}.claim_text`,
        "Claim text contains prohibited execution language",
      );
    }
    if (
      ["ACTIVE", "LIMITED_BY_DATA"].includes(snapshot.status) &&
      ["UNSUPPORTED", "CONFLICT"].includes(claim.support_status)
    ) {
      issue(
        issues,
        "UNSUPPORTED_CLAIM_ACCEPTED",
        `claims.${claim.claim_id}.support_status`,
        "Unsupported or conflicting claims cannot be accepted",
      );
    }
    for (const evidenceId of claim.evidence_ids) {
      if (!evidenceIds.has(evidenceId)) {
        issue(
          issues,
          "CLAIM_EVIDENCE_NOT_ALLOWLISTED",
          `claims.${claim.claim_id}.evidence_ids`,
          "Claim evidence must exist in AI input catalog",
        );
      }
    }
    for (const path of claim.deterministic_result_paths) {
      if (!deterministicPaths.has(path)) {
        issue(
          issues,
          "CLAIM_DETERMINISTIC_PATH_NOT_ALLOWLISTED",
          `claims.${claim.claim_id}.deterministic_result_paths`,
          "Claim deterministic path is not allowlisted",
        );
      }
    }
    for (const path of claim.snapshot_paths) {
      if (!snapshotPaths.has(path)) {
        issue(
          issues,
          "CLAIM_SNAPSHOT_PATH_NOT_ALLOWLISTED",
          `claims.${claim.claim_id}.snapshot_paths`,
          "Claim snapshot path is not allowlisted",
        );
      }
    }
  }

  for (const item of snapshot.recommendations) {
    if (
      [
        item.title,
        item.statement,
        item.human_review_request,
      ].some(containsProhibitedExecutionLanguage)
    ) {
      issue(
        issues,
        "EXECUTABLE_LANGUAGE_REJECTED",
        `recommendations.${item.recommendation_id}`,
        "Recommendation contains prohibited execution language",
      );
    }
    for (const claimId of item.claim_ids) {
      if (!claimIds.has(claimId)) {
        issue(
          issues,
          "RECOMMENDATION_CLAIM_NOT_FOUND",
          `recommendations.${item.recommendation_id}.claim_ids`,
          "Recommendation claim does not exist",
        );
      }
    }
    for (const evidenceId of item.evidence_ids) {
      if (!evidenceIds.has(evidenceId)) {
        issue(
          issues,
          "RECOMMENDATION_EVIDENCE_NOT_ALLOWLISTED",
          `recommendations.${item.recommendation_id}.evidence_ids`,
          "Recommendation evidence is not allowlisted",
        );
      }
    }
    for (const path of item.deterministic_result_paths) {
      if (!deterministicPaths.has(path)) {
        issue(
          issues,
          "RECOMMENDATION_PATH_NOT_ALLOWLISTED",
          `recommendations.${item.recommendation_id}.deterministic_result_paths`,
          "Recommendation deterministic path is not allowlisted",
        );
      }
    }
    for (const referencedValue of item.referenced_values) {
      const fact = deterministicPaths.get(referencedValue.source_path);
      if (!fact || fact.value !== referencedValue.value) {
        issue(
          issues,
          "REFERENCED_VALUE_MISMATCH",
          `recommendations.${item.recommendation_id}.referenced_values`,
          "Referenced value must exactly match an allowlisted deterministic fact",
        );
      }
    }
    issues.push(
      ...confidenceConsistencyIssues(
        item.confidence,
        `recommendations.${item.recommendation_id}.confidence`,
      ),
    );
    const itemEvidenceIds = new Set(item.evidence_ids);
    issues.push(
      ...confidenceCapIssues(
        item.confidence,
        `recommendations.${item.recommendation_id}.confidence`,
        inputStatus,
        input.evidence_catalog
          .filter((evidence) => itemEvidenceIds.has(evidence.evidence_id))
          .map((evidence) => evidence.freshness_status),
      ),
    );
  }
  issues.push(
    ...confidenceConsistencyIssues(snapshot.confidence, "confidence"),
    ...confidenceCapIssues(
      snapshot.confidence,
      "confidence",
      inputStatus,
      input.evidence_catalog.map(
        (evidence) => evidence.freshness_status,
      ),
    ),
  );

  const actualChainOrder = snapshot.evidence_chain.steps.map(
    (step) => step.step,
  );
  if (
    actualChainOrder.some(
      (step, index) => step !== EVIDENCE_CHAIN_ORDER[index],
    )
  ) {
    issue(
      issues,
      "EVIDENCE_CHAIN_ORDER_INVALID",
      "evidence_chain.steps",
      "Evidence chain steps must follow the frozen order",
    );
  }
  const expectedChainDigest = await stableSnapshotDigest(
    snapshot.evidence_chain.steps,
  );
  if (snapshot.evidence_chain.chain_digest !== expectedChainDigest) {
    issue(
      issues,
      "EVIDENCE_CHAIN_DIGEST_MISMATCH",
      "evidence_chain.chain_digest",
      "Evidence chain digest must match canonical steps",
    );
  }

  const { output_digest: outputDigest, ...withoutOutputDigest } = snapshot;
  const expectedOutputDigest =
    await stableSnapshotDigest(withoutOutputDigest);
  if (outputDigest !== expectedOutputDigest) {
    issue(
      issues,
      "OUTPUT_DIGEST_MISMATCH",
      "output_digest",
      "Output digest must match canonical snapshot payload",
    );
  }
  if (!allFalse(snapshot.shadow_guard)) {
    issue(
      issues,
      "OUTPUT_SHADOW_GUARD_INVALID",
      "shadow_guard",
      "Every output Shadow Guard flag must be false",
    );
  }

  return report(issues);
}

export async function finalizeEvidenceChain(
  steps: EvidenceChainStepV1[],
) {
  const parsedSteps = z.array(EvidenceChainStepSchema).length(9).parse(steps);
  return deepFreeze(
    EvidenceChainSchema.parse({
      chain_version: "AI_RECOMMENDATION_EVIDENCE_CHAIN_V1",
      steps: parsedSteps,
      chain_digest: await stableSnapshotDigest(parsedSteps),
    }),
  );
}

export async function finalizeRecommendationSnapshot(
  candidate: Omit<RecommendationSnapshotV1, "output_digest">,
  input: AiRecommendationInputV1,
) {
  const parsedCandidate = RecommendationSnapshotSchema.omit({
    output_digest: true,
  }).parse(candidate);
  const finalized = {
    ...parsedCandidate,
    output_digest: await stableSnapshotDigest(parsedCandidate),
  };
  const validation = await validateRecommendationSnapshotAgainstInput(
    finalized,
    input,
  );
  if (!validation.valid) {
    throw new RecommendationFrameworkValidationError(
      "Recommendation snapshot validation failed",
      validation.issues,
    );
  }
  return deepFreeze(RecommendationSnapshotSchema.parse(finalized));
}

async function appendOnlyIssues(history: RecommendationSnapshotV1[]) {
  const issues: FrameworkValidationIssue[] = [];
  const ids = new Set<string>();
  for (let index = 0; index < history.length; index += 1) {
    const current = history[index];
    const { output_digest: outputDigest, ...payload } = current;
    const expectedDigest = await stableSnapshotDigest(payload);
    if (outputDigest !== expectedDigest) {
      issue(
        issues,
        "APPEND_ONLY_PAYLOAD_DIGEST_MISMATCH",
        `${index}.output_digest`,
        "Immutable snapshot payload no longer matches its digest",
      );
    }
    if (ids.has(current.recommendation_snapshot_id)) {
      issue(
        issues,
        "DUPLICATE_RECOMMENDATION_SNAPSHOT_ID",
        `${index}.recommendation_snapshot_id`,
        "Recommendation snapshot IDs must be unique",
      );
    }
    ids.add(current.recommendation_snapshot_id);
    if (index === 0) {
      if (
        current.recommendation_version !== 1 ||
        current.supersedes_snapshot_id !== null
      ) {
        issue(
          issues,
          "APPEND_ONLY_FIRST_VERSION_INVALID",
          `${index}.recommendation_version`,
          "First version must be 1 and supersede null",
        );
      }
      continue;
    }
    const previous = history[index - 1];
    if (
      current.recommendation_key !== previous.recommendation_key ||
      current.recommendation_version !==
        previous.recommendation_version + 1 ||
      current.supersedes_snapshot_id !==
        previous.recommendation_snapshot_id
    ) {
      issue(
        issues,
        "APPEND_ONLY_CHAIN_INVALID",
        `${index}`,
        "Each version must append to the immediately prior immutable snapshot",
      );
    }
    if (Date.parse(current.created_at) < Date.parse(previous.created_at)) {
      issue(
        issues,
        "APPEND_ONLY_TIME_REGRESSION",
        `${index}.created_at`,
        "Append-only versions cannot move backward in time",
      );
    }
  }
  return issues;
}

export async function validateRecommendationAppendOnlyHistory(
  candidate: unknown,
): Promise<FrameworkValidationReport> {
  const parsed = z.array(RecommendationSnapshotSchema).safeParse(candidate);
  if (!parsed.success) return report(zodIssues(parsed.error));
  return report(await appendOnlyIssues(parsed.data));
}

export async function appendRecommendationSnapshot(
  history: readonly RecommendationSnapshotV1[],
  next: RecommendationSnapshotV1,
) {
  const parsedHistory = z
    .array(RecommendationSnapshotSchema)
    .parse(history);
  const parsedNext = RecommendationSnapshotSchema.parse(next);
  const appended = [...parsedHistory, parsedNext];
  const validation = await validateRecommendationAppendOnlyHistory(
    appended,
  );
  if (!validation.valid) {
    throw new RecommendationFrameworkValidationError(
      "Append-only recommendation history validation failed",
      validation.issues,
    );
  }
  return deepFreeze(appended);
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

export function frameworkHasNoExecutionCapability() {
  return (
    allFalse(AI_RECOMMENDATION_SHADOW_GUARD) &&
    allFalse(SETTLEMENT_INPUT_SHADOW_GUARD) &&
    allFalse(SETTLEMENT_DETERMINISTIC_SHADOW_GUARD)
  );
}
