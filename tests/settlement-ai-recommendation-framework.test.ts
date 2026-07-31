import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  AI_RECOMMENDATION_INPUT_CONTRACT_VERSION,
  AI_RECOMMENDATION_OUTPUT_CONTRACT_VERSION,
  AI_RECOMMENDATION_SHADOW_GUARD,
  AI_RECOMMENDATION_SNAPSHOT_CONTRACT_VERSION,
  AiRecommendationInputSchema,
  ModelVersionMetadataSchema,
  RecommendationFrameworkValidationError,
  RecommendationSnapshotSchema,
  appendRecommendationSnapshot,
  calculateRecommendationConfidence,
  finalizeAiRecommendationInput,
  finalizeEvidenceChain,
  finalizeRecommendationSnapshot,
  frameworkHasNoExecutionCapability,
  validateAiRecommendationInputAgainstUpstream,
  validateRecommendationAppendOnlyHistory,
  validateRecommendationSnapshotAgainstInput,
  type AiRecommendationInputV1,
  type EvidenceChainStepV1,
  type RecommendationClaimV1,
  type RecommendationSnapshotV1,
} from "../lib/settlement-ai-recommendation-framework";
import {
  SETTLEMENT_DETERMINISTIC_CONTRACT_VERSION,
  SETTLEMENT_DETERMINISTIC_SHADOW_GUARD,
  type SettlementDeterministicCalculationResultV1,
} from "../lib/settlement-deterministic-calculation";
import {
  SETTLEMENT_INPUT_CONTRACT_VERSION,
  SETTLEMENT_INPUT_SHADOW_GUARD,
  type SettlementInputSnapshotV1,
} from "../lib/settlement-input-snapshot";

const AS_OF = "2026-07-30T03:00:00.000Z";
const CREATED_AT = "2026-07-30T03:01:00.000Z";
const SNAPSHOT_ID = "00000000-0000-4000-8000-000000000201";
const REQUEST_ID = "00000000-0000-4000-8000-000000000202";
const EVIDENCE_ID = "00000000-0000-4000-8000-000000000203";
const FACT_ID = "00000000-0000-4000-8000-000000000204";
const CLAIM_ID = "00000000-0000-4000-8000-000000000205";
const FIRST_RECOMMENDATION_ID =
  "00000000-0000-4000-8000-000000000206";
const SECOND_RECOMMENDATION_ID =
  "00000000-0000-4000-8000-000000000207";
const INPUT_DIGEST = `sha256:${"1".repeat(64)}`;
const RULESET_DIGEST = `sha256:${"2".repeat(64)}`;
const RESULT_DIGEST = `sha256:${"3".repeat(64)}`;
const EVIDENCE_DIGEST = `sha256:${"4".repeat(64)}`;
const PROMPT_DIGEST = `sha256:${"5".repeat(64)}`;
const SCHEMA_DIGEST = `sha256:${"6".repeat(64)}`;

function upstream(status: "COMPLETE" | "LIMITED" | "BLOCKED" = "COMPLETE") {
  const limitations =
    status === "LIMITED" ? ["UPSTREAM_LIMITED"] : [];
  const blockingReasons =
    status === "BLOCKED" ? ["UPSTREAM_BLOCKED"] : [];
  const snapshot = {
    contract_version: SETTLEMENT_INPUT_CONTRACT_VERSION,
    snapshot_id: SNAPSHOT_ID,
    request_id: REQUEST_ID,
    as_of: AS_OF,
    currency: "VND",
    mode: "SHADOW",
    input_digest: INPUT_DIGEST,
    data_quality: {
      status,
      limitations,
      blocking_reasons: blockingReasons,
    },
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
    status,
    liquidity_result: {
      settleable_capacity_gap_vnd: "50.0000",
    },
    fifo_cost_result: null,
    profit_result: null,
    fx_result: null,
    business_rule_result: null,
    formula_results: [],
    evidence_refs: [EVIDENCE_ID],
    limitations,
    blocking_reasons: blockingReasons,
    result_digest: RESULT_DIGEST,
    shadow_guard: SETTLEMENT_DETERMINISTIC_SHADOW_GUARD,
  } as unknown as SettlementDeterministicCalculationResultV1;
  return { snapshot, calculation };
}

function aiInputCandidate(
  status: "COMPLETE" | "LIMITED" | "BLOCKED" = "COMPLETE",
): Omit<AiRecommendationInputV1, "ai_input_digest"> {
  const limitations =
    status === "LIMITED" ? ["UPSTREAM_LIMITED"] : [];
  const blockingReasons =
    status === "BLOCKED" ? ["UPSTREAM_BLOCKED"] : [];
  return {
    contract_version: AI_RECOMMENDATION_INPUT_CONTRACT_VERSION,
    ai_request_id: "00000000-0000-4000-8000-000000000208",
    requested_at: CREATED_AT,
    as_of: AS_OF,
    currency: "VND",
    operating_timezone: "Asia/Shanghai",
    mode: "SHADOW",
    input_snapshot_ref: {
      contract_version: SETTLEMENT_INPUT_CONTRACT_VERSION,
      snapshot_id: SNAPSHOT_ID,
      input_digest: INPUT_DIGEST,
      data_quality_status: status,
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
      status,
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
          status,
          evidence_ids: [EVIDENCE_ID],
          limitations,
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
        completeness_status:
          status === "COMPLETE" ? "COMPLETE" : "PARTIAL",
        redaction_status: "NO_SECRETS_INCLUDED",
      },
    ],
    limitations,
    blocking_reasons: blockingReasons,
    requested_scopes:
      status === "BLOCKED"
        ? ["DATA_QUALITY_REVIEW"]
        : ["FACT_EXPLANATION", "LIQUIDITY_REVIEW"],
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
      output_schema_digest: SCHEMA_DIGEST,
      safety_policy_version: "1.0.0",
      allowed_scope_version: "1.0.0",
      language: "zh-CN",
    },
    output_schema_ref: {
      schema_code: AI_RECOMMENDATION_OUTPUT_CONTRACT_VERSION,
      schema_version: "1.0.0",
      schema_digest: SCHEMA_DIGEST,
    },
    shadow_guard: AI_RECOMMENDATION_SHADOW_GUARD,
  };
}

function modelMetadata() {
  return {
    provider: "TEST_PROVIDER",
    model_id: "TEST_MODEL",
    model_revision: "test-revision-1",
    deployment_id: null,
    provider_request_id: "test-request",
    generation_started_at: "2026-07-30T03:00:10.000Z",
    generation_completed_at: "2026-07-30T03:00:11.000Z",
    temperature: "0",
    top_p: "1",
    max_output_tokens: 1000,
    seed: 1,
    structured_output_mode: true as const,
    tool_policy: "NO_TOOLS" as const,
    input_tokens: 100,
    output_tokens: 50,
  };
}

function supportedClaim(): RecommendationClaimV1 {
  return {
    claim_id: CLAIM_ID,
    claim_text: "Test fixture: deterministic capacity gap is present.",
    claim_type: "DETERMINISTIC_FACT",
    deterministic_result_paths: [
      "liquidity_result.settleable_capacity_gap_vnd",
    ],
    snapshot_paths: [],
    evidence_ids: [EVIDENCE_ID],
    support_status: "SUPPORTED",
    limitations: [],
  };
}

function fullConfidence() {
  return calculateRecommendationConfidence({
    input_status: "COMPLETE",
    freshness_statuses: ["FRESH"],
    material_claim_count: 1,
    supported_material_claim_count: 1,
    deterministic_claim_count: 1,
    verified_deterministic_claim_count: 1,
    schema_valid: true,
    data_quality_only: false,
  });
}

async function evidenceChain(createdAt = CREATED_AT) {
  const steps = [
    "SNAPSHOT_REFERENCED",
    "DETERMINISTIC_RESULT_REFERENCED",
    "AI_FACT_PROJECTION_CREATED",
    "AI_INPUT_VALIDATED",
    "MODEL_GENERATED",
    "OUTPUT_SCHEMA_VALIDATED",
    "CLAIMS_EVIDENCE_VALIDATED",
    "SHADOW_GUARD_VALIDATED",
    "RECOMMENDATION_SNAPSHOT_FINALIZED",
  ].map(
    (step) =>
      ({
        step,
        step_time: createdAt,
        validator_version: "1.0.0",
        input_digest: INPUT_DIGEST,
        output_digest: RESULT_DIGEST,
        status: "COMPLETE",
        codes: [],
      }) as EvidenceChainStepV1,
  );
  return finalizeEvidenceChain(steps);
}

async function finalizedInput(
  status: "COMPLETE" | "LIMITED" | "BLOCKED" = "COMPLETE",
) {
  const sources = upstream(status);
  const input = await finalizeAiRecommendationInput(
    aiInputCandidate(status),
    sources.snapshot,
    sources.calculation,
  );
  return { ...sources, input };
}

async function snapshotCandidate(input: AiRecommendationInputV1) {
  return {
    contract_version: AI_RECOMMENDATION_OUTPUT_CONTRACT_VERSION,
    snapshot_contract_version: AI_RECOMMENDATION_SNAPSHOT_CONTRACT_VERSION,
    recommendation_snapshot_id: FIRST_RECOMMENDATION_ID,
    recommendation_key: "VND:2026-07-30:MANUAL",
    recommendation_version: 1,
    supersedes_snapshot_id: null,
    status: "ACTIVE" as const,
    created_at: CREATED_AT,
    as_of: AS_OF,
    currency: "VND" as const,
    mode: "SHADOW" as const,
    authoritative: false as const,
    input_snapshot_ref: input.input_snapshot_ref,
    calculation_result_ref: input.calculation_result_ref,
    ai_input_digest: input.ai_input_digest,
    prompt_contract_ref: input.prompt_contract_ref,
    model_ref: modelMetadata(),
    fact_summary: [supportedClaim()],
    risk_summary: [],
    recommendations: [],
    confidence: fullConfidence(),
    limitations: [],
    evidence_chain: await evidenceChain(),
    shadow_guard: AI_RECOMMENDATION_SHADOW_GUARD,
  };
}

describe("Task 3.4A AI input and metadata schemas", () => {
  it("finalizes an evidence-allowlisted AI input without changing upstream data", async () => {
    const { snapshot, calculation } = upstream();
    const snapshotBefore = structuredClone(snapshot);
    const calculationBefore = structuredClone(calculation);
    const input = await finalizeAiRecommendationInput(
      aiInputCandidate(),
      snapshot,
      calculation,
    );

    expect(input.contract_version).toBe(
      AI_RECOMMENDATION_INPUT_CONTRACT_VERSION,
    );
    expect(input.ai_input_digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(input.approved_fact_projection.facts[0].value).toBe("50.0000");
    expect(Object.isFrozen(input)).toBe(true);
    expect(Object.isFrozen(input.approved_fact_projection.facts)).toBe(
      true,
    );
    expect(snapshot).toEqual(snapshotBefore);
    expect(calculation).toEqual(calculationBefore);
  });

  it("rejects an invented fact value", async () => {
    const { snapshot, calculation } = upstream();
    const candidate = aiInputCandidate();
    candidate.approved_fact_projection.facts[0].value = "500.0000";
    const withDigest = {
      ...candidate,
      ai_input_digest: INPUT_DIGEST,
    };

    const validation = validateAiRecommendationInputAgainstUpstream(
      withDigest,
      snapshot,
      calculation,
    );
    expect(validation.valid).toBe(false);
    expect(validation.issues.map((item) => item.code)).toEqual(
      expect.arrayContaining(["FACT_VALUE_MISMATCH"]),
    );
  });

  it("rejects an invented upstream path", async () => {
    const { snapshot, calculation } = upstream();
    const candidate = aiInputCandidate();
    candidate.approved_fact_projection.facts[0].source_path =
      "liquidity_result.missing_value";
    const validation = validateAiRecommendationInputAgainstUpstream(
      {
        ...candidate,
        ai_input_digest: INPUT_DIGEST,
      },
      snapshot,
      calculation,
    );

    expect(validation.valid).toBe(false);
    expect(validation.issues.map((item) => item.code)).toEqual(
      expect.arrayContaining(["FACT_SOURCE_PATH_INVALID"]),
    );
  });

  it("freezes model metadata to structured output with no tools", () => {
    expect(ModelVersionMetadataSchema.parse(modelMetadata()).tool_policy).toBe(
      "NO_TOOLS",
    );
    expect(
      ModelVersionMetadataSchema.safeParse({
        ...modelMetadata(),
        tool_policy: "EXECUTION_TOOLS",
      }).success,
    ).toBe(false);
    expect(
      AiRecommendationInputSchema.safeParse({
        ...aiInputCandidate(),
        ai_input_digest: INPUT_DIGEST,
        approval_status: "APPROVED",
      }).success,
    ).toBe(false);
  });
});

describe("Task 3.4A deterministic confidence", () => {
  it("calculates the frozen weighted confidence from evidence sources", () => {
    expect(fullConfidence()).toEqual({
      input_quality_score: "1.000000",
      evidence_coverage_score: "1.000000",
      freshness_score: "1.000000",
      deterministic_support_score: "1.000000",
      schema_validation_score: "1.000000",
      raw_score: "1.000000",
      applied_caps: [],
      final_score: "1.000000",
      band: "HIGH",
      reason_codes: [],
    });
  });

  it("applies LIMITED, stale, BLOCKED and schema caps deterministically", () => {
    const limited = calculateRecommendationConfidence({
      input_status: "LIMITED",
      freshness_statuses: ["FRESH"],
      material_claim_count: 1,
      supported_material_claim_count: 1,
      deterministic_claim_count: 1,
      verified_deterministic_claim_count: 1,
      schema_valid: true,
      data_quality_only: false,
    });
    expect(limited.raw_score).toBe("0.880000");
    expect(limited.final_score).toBe("0.700000");
    expect(limited.band).toBe("MEDIUM");

    const stale = calculateRecommendationConfidence({
      input_status: "COMPLETE",
      freshness_statuses: ["STALE"],
      material_claim_count: 1,
      supported_material_claim_count: 1,
      deterministic_claim_count: 1,
      verified_deterministic_claim_count: 1,
      schema_valid: true,
      data_quality_only: false,
    });
    expect(stale.final_score).toBe("0.500000");

    const blocked = calculateRecommendationConfidence({
      input_status: "BLOCKED",
      freshness_statuses: ["MISSING"],
      material_claim_count: 1,
      supported_material_claim_count: 0,
      deterministic_claim_count: 1,
      verified_deterministic_claim_count: 0,
      schema_valid: false,
      data_quality_only: true,
    });
    expect(blocked.final_score).toBe("0.000000");
    expect(blocked.band).toBe("INSUFFICIENT");
  });
});

describe("Task 3.4A recommendation snapshot validation", () => {
  it("finalizes an immutable, non-authoritative empty recommendation framework snapshot", async () => {
    const { input } = await finalizedInput();
    const finalized = await finalizeRecommendationSnapshot(
      await snapshotCandidate(input),
      input,
    );

    expect(finalized.output_digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(finalized.authoritative).toBe(false);
    expect(finalized.recommendations).toEqual([]);
    expect(finalized.model_ref.tool_policy).toBe("NO_TOOLS");
    expect(finalized.shadow_guard).toEqual(
      AI_RECOMMENDATION_SHADOW_GUARD,
    );
    expect(Object.values(finalized.shadow_guard).every((flag) => !flag)).toBe(
      true,
    );
    expect(Object.isFrozen(finalized)).toBe(true);
    expect(Object.isFrozen(finalized.fact_summary)).toBe(true);
  });

  it("rejects claims with evidence or deterministic values outside the allowlist", async () => {
    const { input } = await finalizedInput();
    const candidate = await snapshotCandidate(input);
    candidate.fact_summary[0].evidence_ids = [
      "00000000-0000-4000-8000-999999999999",
    ];
    const evidence = await finalizeEvidenceChain([
      ...candidate.evidence_chain.steps,
    ]);
    const invalid = {
      ...candidate,
      evidence_chain: evidence,
      output_digest: INPUT_DIGEST,
    };
    const validation = await validateRecommendationSnapshotAgainstInput(
      invalid,
      input,
    );

    expect(validation.valid).toBe(false);
    expect(validation.issues.map((item) => item.code)).toContain(
      "CLAIM_EVIDENCE_NOT_ALLOWLISTED",
    );
  });

  it("rejects executable language even when the structure is Shadow-only", async () => {
    const { input } = await finalizedInput();
    const candidate = await snapshotCandidate(input);
    candidate.fact_summary[0].claim_text =
      "Execute a topup. Test fixture only.";
    const validation = await validateRecommendationSnapshotAgainstInput(
      {
        ...candidate,
        output_digest: INPUT_DIGEST,
      },
      input,
    );

    expect(validation.valid).toBe(false);
    expect(validation.issues.map((item) => item.code)).toContain(
      "EXECUTABLE_LANGUAGE_REJECTED",
    );
  });

  it("prevents LIMITED or BLOCKED input from becoming ACTIVE", async () => {
    const limited = await finalizedInput("LIMITED");
    const limitedCandidate = await snapshotCandidate(limited.input);
    const limitedOutput = {
      ...limitedCandidate,
      output_digest: INPUT_DIGEST,
    };
    const limitedValidation =
      await validateRecommendationSnapshotAgainstInput(
        limitedOutput,
        limited.input,
      );
    expect(limitedValidation.issues.map((item) => item.code)).toContain(
      "LIMITED_INPUT_STATUS_UPGRADED",
    );

    const blocked = await finalizedInput("BLOCKED");
    const blockedCandidate = await snapshotCandidate(blocked.input);
    const blockedOutput = {
      ...blockedCandidate,
      output_digest: INPUT_DIGEST,
    };
    const blockedValidation =
      await validateRecommendationSnapshotAgainstInput(
        blockedOutput,
        blocked.input,
      );
    expect(blockedValidation.issues.map((item) => item.code)).toContain(
      "BLOCKED_INPUT_STATUS_UPGRADED",
    );
  });
});

describe("Task 3.4A immutable append-only history", () => {
  it("appends a linked version without mutating either source snapshot", async () => {
    const { input } = await finalizedInput();
    const first = await finalizeRecommendationSnapshot(
      await snapshotCandidate(input),
      input,
    );
    const secondCandidate = {
      ...(await snapshotCandidate(input)),
      recommendation_snapshot_id: SECOND_RECOMMENDATION_ID,
      recommendation_version: 2,
      supersedes_snapshot_id: FIRST_RECOMMENDATION_ID,
      created_at: "2026-07-30T03:02:00.000Z",
      evidence_chain: await evidenceChain(
        "2026-07-30T03:02:00.000Z",
      ),
    };
    const second = await finalizeRecommendationSnapshot(
      secondCandidate,
      input,
    );
    const sourceHistory = [first] as RecommendationSnapshotV1[];
    const appended = await appendRecommendationSnapshot(
      sourceHistory,
      second,
    );

    expect(sourceHistory).toHaveLength(1);
    expect(appended).toHaveLength(2);
    expect(appended[1].supersedes_snapshot_id).toBe(
      FIRST_RECOMMENDATION_ID,
    );
    expect(
      (await validateRecommendationAppendOnlyHistory(appended)).valid,
    ).toBe(true);
    expect(Object.isFrozen(appended)).toBe(true);
    expect(Object.isFrozen(appended[0])).toBe(true);
  });

  it("rejects gaps, rewrites, and invalid supersession links", async () => {
    const { input } = await finalizedInput();
    const first = await finalizeRecommendationSnapshot(
      await snapshotCandidate(input),
      input,
    );
    const invalid = {
      ...first,
      recommendation_snapshot_id: SECOND_RECOMMENDATION_ID,
      recommendation_version: 3,
      supersedes_snapshot_id: null,
    };

    await expect(
      appendRecommendationSnapshot(
        [first],
        invalid as RecommendationSnapshotV1,
      ),
    ).rejects.toThrow(RecommendationFrameworkValidationError);
  });
});

describe("Task 3.4A safety boundary", () => {
  it("contains no model invocation, database client, network call, approval, or execution capability", () => {
    const sourceCode = readFileSync(
      resolve(
        process.cwd(),
        "lib/settlement-ai-recommendation-framework.ts",
      ),
      "utf8",
    );
    expect(sourceCode).not.toMatch(
      /@supabase|createClient|\.from\s*\(|\.(insert|update|upsert|delete|rpc)\s*\(/,
    );
    expect(sourceCode).not.toMatch(
      /\bfetch\s*\(|chat\.completions|responses\.create|automaticTopup|automaticPayment/,
    );
    expect(frameworkHasNoExecutionCapability()).toBe(true);
    expect(
      RecommendationSnapshotSchema.safeParse({
        approval_workflow: true,
        automatic_execution: true,
      }).success,
    ).toBe(false);
  });
});
