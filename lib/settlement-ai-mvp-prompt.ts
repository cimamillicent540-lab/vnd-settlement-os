import {
  AI_PROVIDER_DRAFT_CONTRACT_VERSION,
  AI_PROVIDER_PROMPT_METADATA_CONTRACT_VERSION,
} from "./settlement-ai-provider-adapter";
import {
  AI_PROVIDER_PROMPT_BUNDLE_CONTRACT_VERSION,
  InMemoryPromptVersionLoader,
  calculatePromptArtifactDigests,
  type PromptArtifactBundleV1,
  type PromptArtifactContentV1,
  type PromptArtifactDigestsV1,
} from "./settlement-ai-provider-runtime";
import {
  AI_RECOMMENDATION_OUTPUT_CONTRACT_VERSION,
} from "./settlement-ai-recommendation-framework";
import { stableSnapshotDigest } from "./settlement-input-snapshot";

export const SETTLEMENT_AI_MVP_PROMPT_CODE =
  "VND_SETTLEMENT_AI_INTELLIGENCE_MVP" as const;
export const SETTLEMENT_AI_MVP_PROMPT_VERSION = "1.0.0" as const;
export const SETTLEMENT_AI_MVP_OUTPUT_SCHEMA_VERSION = "1.0.0" as const;
export const SETTLEMENT_AI_MVP_SAFETY_POLICY_VERSION = "1.0.0" as const;
export const SETTLEMENT_AI_MVP_ALLOWED_SCOPE_VERSION = "1.0.0" as const;

const claimSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "claim_id",
    "claim_text",
    "claim_type",
    "deterministic_result_paths",
    "snapshot_paths",
    "evidence_ids",
    "limitations",
  ],
  properties: {
    claim_id: { type: "string" },
    claim_text: { type: "string" },
    claim_type: {
      type: "string",
      enum: [
        "DETERMINISTIC_FACT",
        "SOURCE_FACT",
        "LIMITATION",
        "QUALITATIVE_REVIEW_SUGGESTION",
      ],
    },
    deterministic_result_paths: {
      type: "array",
      items: { type: "string" },
    },
    snapshot_paths: {
      type: "array",
      items: { type: "string" },
    },
    evidence_ids: {
      type: "array",
      items: { type: "string" },
    },
    limitations: {
      type: "array",
      items: { type: "string" },
    },
  },
} as const;

const recommendationSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "recommendation_id",
    "recommendation_type",
    "title",
    "statement",
    "reason_codes",
    "priority",
    "human_review_request",
    "referenced_value_paths",
    "claim_ids",
    "deterministic_result_paths",
    "evidence_ids",
    "limitations",
  ],
  properties: {
    recommendation_id: { type: "string" },
    recommendation_type: {
      type: "string",
      enum: [
        "LIQUIDITY_REVIEW",
        "PROFIT_REVIEW",
        "FX_OBSERVATION",
        "RISK_MONITORING",
        "DATA_QUALITY_REVIEW",
      ],
    },
    title: { type: "string" },
    statement: { type: "string" },
    reason_codes: {
      type: "array",
      items: { type: "string" },
    },
    priority: {
      type: "string",
      enum: ["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"],
    },
    human_review_request: { type: "string" },
    referenced_value_paths: {
      type: "array",
      items: { type: "string" },
    },
    claim_ids: {
      type: "array",
      items: { type: "string" },
    },
    deterministic_result_paths: {
      type: "array",
      items: { type: "string" },
    },
    evidence_ids: {
      type: "array",
      items: { type: "string" },
    },
    limitations: {
      type: "array",
      items: { type: "string" },
    },
  },
} as const;

export const SETTLEMENT_AI_MVP_PROVIDER_DRAFT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "contract_version",
    "fact_summary",
    "risk_summary",
    "recommendations",
    "limitations",
  ],
  properties: {
    contract_version: {
      type: "string",
      enum: [AI_PROVIDER_DRAFT_CONTRACT_VERSION],
    },
    fact_summary: {
      type: "array",
      maxItems: 24,
      items: claimSchema,
    },
    risk_summary: {
      type: "array",
      maxItems: 12,
      items: claimSchema,
    },
    recommendations: {
      type: "array",
      maxItems: 12,
      items: recommendationSchema,
    },
    limitations: {
      type: "array",
      items: { type: "string" },
    },
  },
} as const;

export const SETTLEMENT_AI_MVP_PROMPT_CONTENT = Object.freeze({
  system_prompt: [
    "You are the VND Settlement Intelligence narrator operating only in Shadow Mode.",
    "The deterministic input is authoritative. Explain it without recalculating, rounding, converting, or inventing any value.",
    "Return only the required structured JSON. Do not use tools, external knowledge, browsing, files, or hidden data.",
  ].join("\n"),
  developer_prompt: [
    "Produce only: executive summary facts, liquidity explanation, profit explanation, FX explanation, risk summary, and human review notes.",
    "Use fact_summary for executive/liquidity/profit/FX explanations, risk_summary for risks, and recommendations only for non-executable human review notes.",
    "Every claim and review note must cite allowlisted paths and evidence IDs from the structured input.",
    "If text includes a decimal, copy the complete decimal string exactly from one approved fact and include that path in referenced_value_paths.",
    "Copy all inherited limitations and blocking reasons into limitations without changing their spelling.",
    "Never provide a topup quantity, new quote number, payment instruction, trade instruction, approval action, channel change, upload, schedule, or statement that an action occurred.",
    "Never use QUOTE_REVIEW. Never create or request execution, approval, modification, rejection, or deletion.",
    "For BLOCKED input, output data-quality review only.",
  ].join("\n"),
  user_input_template:
    "Analyze only the following finalized structured input:\n{{structured_input}}",
  provider_draft_schema_json:
    SETTLEMENT_AI_MVP_PROVIDER_DRAFT_JSON_SCHEMA,
  safety_policy: [
    "Human review only. No action has been executed.",
    "All Shadow Guard fields remain false.",
    "Reject missing evidence, changed decimals, executable language, and invented facts.",
  ].join("\n"),
  allowed_scopes: [
    "FACT_EXPLANATION",
    "LIQUIDITY_REVIEW",
    "PROFIT_REVIEW",
    "FX_OBSERVATION",
    "RISK_SUMMARY",
    "DATA_QUALITY_REVIEW",
  ] as PromptArtifactContentV1["allowed_scopes"],
  language: "zh-CN",
}) satisfies PromptArtifactContentV1;

// These values are pinned to prompt version 1.0.0. Any content change must
// update the semantic version and all pinned digests in one reviewed change.
export const SETTLEMENT_AI_MVP_PINNED_PROMPT_DIGESTS = Object.freeze({
  system_prompt_digest:
    "sha256:cc1b6c57aa98ac9d5da7cf3c2281b076c780e92d14e002d68f80f247fd232c98",
  developer_prompt_digest:
    "sha256:cd4c40971a49d6de8e35d5da84f817931a1d3ec0620651566c56b01e072af30f",
  user_input_template_digest:
    "sha256:cc2bcaf84e312ce24ccd7e08bdb90607f594328eb795ed39d1f74e48f1220020",
  provider_draft_schema_digest:
    "sha256:17fcbf1bddb18ad8e898f60599855e8590056c86af6ab9ed6d63a98f4868aedd",
  bundle_digest:
    "sha256:63193aae6cf7503bcc50d4bc0c0d36e76513d2bca734cece66f87ba46fabf863",
});

export const SETTLEMENT_AI_MVP_FINAL_SCHEMA_BASIS = Object.freeze({
  schema_code: AI_RECOMMENDATION_OUTPUT_CONTRACT_VERSION,
  schema_version: SETTLEMENT_AI_MVP_OUTPUT_SCHEMA_VERSION,
  snapshot_contract_version: "AI_RECOMMENDATION_SNAPSHOT_V1",
  authority: "NON_AUTHORITATIVE",
  mode: "SHADOW",
});

export const SETTLEMENT_AI_MVP_PINNED_FINAL_SCHEMA_DIGEST =
  "sha256:266dc629b7009b1e1412dc4302c0f3f5456e997ebdedcd1546f691d153125e82";

function sameDigests(
  actual: PromptArtifactDigestsV1,
  expected: typeof SETTLEMENT_AI_MVP_PINNED_PROMPT_DIGESTS,
) {
  return Object.entries(expected).every(
    ([key, value]) => actual[key as keyof PromptArtifactDigestsV1] === value,
  );
}

export async function loadSettlementAiMvpPromptBundle(): Promise<PromptArtifactBundleV1> {
  const actual = await calculatePromptArtifactDigests(
    SETTLEMENT_AI_MVP_PROMPT_CONTENT,
  );
  const finalSchemaDigest = await stableSnapshotDigest(
    SETTLEMENT_AI_MVP_FINAL_SCHEMA_BASIS,
  );
  if (
    !sameDigests(actual, SETTLEMENT_AI_MVP_PINNED_PROMPT_DIGESTS) ||
    finalSchemaDigest !== SETTLEMENT_AI_MVP_PINNED_FINAL_SCHEMA_DIGEST
  ) {
    throw new Error("SETTLEMENT_AI_MVP_PROMPT_DIGEST_MISMATCH");
  }

  return {
    contract_version: AI_PROVIDER_PROMPT_BUNDLE_CONTRACT_VERSION,
    metadata: {
      contract_version: AI_PROVIDER_PROMPT_METADATA_CONTRACT_VERSION,
      bundle_id: `${SETTLEMENT_AI_MVP_PROMPT_CODE}@${SETTLEMENT_AI_MVP_PROMPT_VERSION}`,
      prompt_contract_ref: {
        prompt_contract_code: SETTLEMENT_AI_MVP_PROMPT_CODE,
        prompt_contract_version: SETTLEMENT_AI_MVP_PROMPT_VERSION,
        system_prompt_digest: actual.system_prompt_digest,
        developer_prompt_digest: actual.developer_prompt_digest,
        user_input_template_digest: actual.user_input_template_digest,
        output_schema_version: SETTLEMENT_AI_MVP_OUTPUT_SCHEMA_VERSION,
        output_schema_digest: finalSchemaDigest,
        safety_policy_version: SETTLEMENT_AI_MVP_SAFETY_POLICY_VERSION,
        allowed_scope_version: SETTLEMENT_AI_MVP_ALLOWED_SCOPE_VERSION,
        language: SETTLEMENT_AI_MVP_PROMPT_CONTENT.language,
      },
      final_output_schema_ref: {
        schema_code: AI_RECOMMENDATION_OUTPUT_CONTRACT_VERSION,
        schema_version: SETTLEMENT_AI_MVP_OUTPUT_SCHEMA_VERSION,
        schema_digest: finalSchemaDigest,
      },
      provider_draft_schema_ref: {
        schema_code: AI_PROVIDER_DRAFT_CONTRACT_VERSION,
        schema_version: SETTLEMENT_AI_MVP_OUTPUT_SCHEMA_VERSION,
        schema_digest: actual.provider_draft_schema_digest,
      },
      bundle_digest: actual.bundle_digest,
      release_status: "RELEASED",
      released_at: "2026-08-01T00:00:00.000Z",
      immutable: true,
      mode: "SHADOW",
      tool_policy: "NO_TOOLS",
    },
    content: SETTLEMENT_AI_MVP_PROMPT_CONTENT,
  };
}

export async function createSettlementAiMvpPromptLoader() {
  return new InMemoryPromptVersionLoader([
    await loadSettlementAiMvpPromptBundle(),
  ]);
}
