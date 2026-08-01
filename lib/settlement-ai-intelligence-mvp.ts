import {
  AI_RECOMMENDATION_INPUT_CONTRACT_VERSION,
  AI_RECOMMENDATION_OUTPUT_CONTRACT_VERSION,
  AI_RECOMMENDATION_SHADOW_GUARD,
  AI_RECOMMENDATION_SNAPSHOT_CONTRACT_VERSION,
  calculateRecommendationConfidence,
  finalizeAiRecommendationInput,
  finalizeEvidenceChain,
  finalizeRecommendationSnapshot,
  type AiRecommendationInputV1,
  type EvidenceChainStepV1,
  type RecommendationConfidenceV1,
  type RecommendationSnapshotV1,
} from "./settlement-ai-recommendation-framework";
import {
  createAiProviderRuntime,
  type AiProviderRuntimeResultV1,
} from "./settlement-ai-provider-runtime";
import type {
  AiProviderAdapterV1,
  ProviderModelMetadataV1,
} from "./settlement-ai-provider-adapter";
import type { SettlementInputSnapshotV1 } from "./settlement-input-snapshot";
import { stableSnapshotDigest } from "./settlement-input-snapshot";
import type { SettlementDeterministicCalculationResultV1 } from "./settlement-deterministic-calculation";
import {
  createSettlementAiMvpPromptLoader,
  loadSettlementAiMvpPromptBundle,
} from "./settlement-ai-mvp-prompt";

export const SETTLEMENT_AI_INTELLIGENCE_MVP_VERSION = "1.0.0" as const;

export type SettlementAiMvpStatus =
  | "READY"
  | "PROVIDER_NOT_CONFIGURED"
  | "PROVIDER_FAILED"
  | "VALIDATION_FAILED"
  | "INTERNAL_ERROR";

export interface SettlementAiMvpResult {
  status: SettlementAiMvpStatus;
  recommendation_id: string | null;
  snapshot_id: string | null;
  input_digest: string | null;
  calculation_result_digest: string | null;
  recommendation_contract_version: string;
  created_at: string | null;
  evidence_refs: string[];
  limitations: string[];
  recommendation_snapshot: RecommendationSnapshotV1 | null;
  attempts: number;
  validation_issues: Array<{ code: string; path: string; message: string }>;
  safe_message: string;
  as_of: string | null;
  data_cutoffs: Array<{
    source_key: string;
    cutoff_at: string | null;
    freshness_status: string;
  }>;
  provider: string;
  model: string;
  model_revision: string | null;
  prompt_version: string;
  prompt_digest: string;
  token_usage: {
    input_tokens: number | null;
    output_tokens: number | null;
    total_tokens: number | null;
  };
  mode: "SHADOW";
  shadow_guard: typeof AI_RECOMMENDATION_SHADOW_GUARD;
}

function unique(values: readonly string[]) {
  return [...new Set(values)].sort((left, right) =>
    left.localeCompare(right),
  );
}

function unitForPath(path: string) {
  if (path.endsWith("_vnd")) return "VND" as const;
  if (path.endsWith("_usdt")) return "USDT" as const;
  if (path.includes("rate") && !path.includes("margin")) {
    return "VND_PER_USDT" as const;
  }
  return "RATIO" as const;
}

function inheritedStatus(
  snapshot: SettlementInputSnapshotV1,
  calculation: SettlementDeterministicCalculationResultV1,
) {
  const values = [snapshot.data_quality.status, calculation.status];
  return values.includes("BLOCKED")
    ? ("BLOCKED" as const)
    : values.includes("LIMITED")
      ? ("LIMITED" as const)
      : ("COMPLETE" as const);
}

export async function buildSettlementAiRecommendationInput(
  snapshot: SettlementInputSnapshotV1,
  calculation: SettlementDeterministicCalculationResultV1,
  requestedAt = new Date().toISOString(),
): Promise<AiRecommendationInputV1> {
  const bundle = await loadSettlementAiMvpPromptBundle();
  const status = inheritedStatus(snapshot, calculation);
  const facts = calculation.formula_results
    .filter((formula) => formula.value !== null)
    .map((formula) => ({
      fact_id: globalThis.crypto.randomUUID(),
      source: "DETERMINISTIC_RESULT" as const,
      source_path: formula.output_path,
      value_type: "DECIMAL" as const,
      value: formula.value as string,
      unit: unitForPath(formula.output_path),
      status: formula.status,
      evidence_ids: unique(formula.evidence_refs),
      limitations: unique(
        formula.status === "COMPLETE" ? [] : calculation.limitations,
      ),
    }));

  return finalizeAiRecommendationInput(
    {
      contract_version: AI_RECOMMENDATION_INPUT_CONTRACT_VERSION,
      ai_request_id: globalThis.crypto.randomUUID(),
      requested_at: requestedAt,
      as_of: snapshot.as_of,
      currency: "VND",
      operating_timezone: "Asia/Shanghai",
      mode: "SHADOW",
      input_snapshot_ref: {
        contract_version: snapshot.contract_version,
        snapshot_id: snapshot.snapshot_id,
        input_digest: snapshot.input_digest,
        data_quality_status: snapshot.data_quality.status,
        evidence_ids: unique(
          snapshot.input_evidence.map((item) => item.evidence_id),
        ),
      },
      calculation_result_ref: {
        contract_version: calculation.contract_version,
        engine_version: calculation.engine_version,
        snapshot_id: calculation.snapshot_id,
        input_digest: calculation.input_digest,
        ruleset_version: calculation.ruleset_version,
        ruleset_digest: calculation.ruleset_ref.ruleset_digest,
        result_digest: calculation.result_digest,
        status: calculation.status,
        evidence_refs: unique(calculation.evidence_refs),
      },
      approved_fact_projection: {
        projection_version: "SETTLEMENT_AI_FACT_PROJECTION_V1",
        facts,
      },
      evidence_catalog: snapshot.input_evidence.map((evidence) => {
        const source = snapshot.data_sources.find(
          (item) => item.source_key === evidence.source_key,
        );
        return {
          evidence_id: evidence.evidence_id,
          source_key: evidence.source_key,
          content_digest: evidence.content_digest,
          observed_at: evidence.observed_at,
          cutoff_at: evidence.cutoff_at,
          freshness_status: source?.freshness_status ?? "MISSING",
          completeness_status:
            source?.completeness_status ?? "UNAVAILABLE",
          redaction_status: "NO_SECRETS_INCLUDED" as const,
        };
      }),
      limitations: unique([
        ...snapshot.data_quality.limitations,
        ...calculation.limitations,
      ]),
      blocking_reasons: unique([
        ...snapshot.data_quality.blocking_reasons,
        ...calculation.blocking_reasons,
      ]),
      requested_scopes:
        status === "BLOCKED"
          ? ["DATA_QUALITY_REVIEW"]
          : [
              "FACT_EXPLANATION",
              "LIQUIDITY_REVIEW",
              "PROFIT_REVIEW",
              "FX_OBSERVATION",
              "RISK_SUMMARY",
              "DATA_QUALITY_REVIEW",
            ],
      presentation_context: {
        language: "zh-CN",
        audience: "SETTLEMENT_OPERATOR",
        output_style: "STRUCTURED_FACTUAL",
      },
      prompt_contract_ref: bundle.metadata.prompt_contract_ref,
      output_schema_ref: bundle.metadata.final_output_schema_ref,
      shadow_guard: AI_RECOMMENDATION_SHADOW_GUARD,
    },
    snapshot,
    calculation,
  );
}

function confidenceFor(
  input: AiRecommendationInputV1,
  claimCount: number,
): RecommendationConfidenceV1 {
  const status =
    input.input_snapshot_ref.data_quality_status === "BLOCKED" ||
    input.calculation_result_ref.status === "BLOCKED"
      ? "BLOCKED"
      : input.input_snapshot_ref.data_quality_status === "LIMITED" ||
          input.calculation_result_ref.status === "LIMITED"
        ? "LIMITED"
        : "COMPLETE";
  return calculateRecommendationConfidence({
    input_status: status,
    freshness_statuses: input.evidence_catalog.map(
      (item) => item.freshness_status,
    ),
    material_claim_count: claimCount,
    supported_material_claim_count: claimCount,
    deterministic_claim_count: claimCount,
    verified_deterministic_claim_count: claimCount,
    schema_valid: true,
    data_quality_only: input.requested_scopes.every(
      (scope) => scope === "DATA_QUALITY_REVIEW",
    ),
  });
}

async function evidenceChain(
  input: AiRecommendationInputV1,
  calculation: SettlementDeterministicCalculationResultV1,
  runtime: AiProviderRuntimeResultV1,
  at: string,
) {
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
  ] as const;
  return finalizeEvidenceChain(
    await Promise.all(
      steps.map(async (step) =>
        ({
          step,
          step_time: at,
          validator_version: SETTLEMENT_AI_INTELLIGENCE_MVP_VERSION,
          input_digest: input.ai_input_digest,
          output_digest: await stableSnapshotDigest({
            step,
            input: input.ai_input_digest,
            result: calculation.result_digest,
            provider: runtime.provider_outcome,
          }),
          status:
            input.calculation_result_ref.status === "BLOCKED"
              ? "BLOCKED"
              : input.calculation_result_ref.status,
          codes: [],
        }) satisfies EvidenceChainStepV1,
      ),
    ),
  );
}

async function createRecommendationSnapshot(
  input: AiRecommendationInputV1,
  calculation: SettlementDeterministicCalculationResultV1,
  runtime: AiProviderRuntimeResultV1,
  createdAt: string,
) {
  const draft = runtime.validation_result?.validated_draft;
  const model = runtime.model_run_metadata;
  if (!draft || !model) throw new Error("AI_VALIDATED_DRAFT_MISSING");
  const allClaims = [...draft.fact_summary, ...draft.risk_summary];
  const confidence = confidenceFor(input, allClaims.length);
  const factByPath = new Map(
    input.approved_fact_projection.facts.map((fact) => [
      fact.source_path,
      fact,
    ]),
  );
  const formulaByPath = new Map(
    calculation.formula_results.map((formula) => [
      formula.output_path,
      formula,
    ]),
  );
  const supportStatus =
    input.calculation_result_ref.status === "COMPLETE"
      ? ("SUPPORTED" as const)
      : ("LIMITED_SUPPORT" as const);
  const mapClaim = (claim: (typeof allClaims)[number]) => ({
    ...claim,
    support_status: supportStatus,
  });
  const status =
    input.calculation_result_ref.status === "BLOCKED"
      ? ("BLOCKED_BY_DATA" as const)
      : input.calculation_result_ref.status === "LIMITED" ||
          input.input_snapshot_ref.data_quality_status === "LIMITED"
        ? ("LIMITED_BY_DATA" as const)
        : ("ACTIVE" as const);
  const recommendationSnapshotId = globalThis.crypto.randomUUID();
  return finalizeRecommendationSnapshot(
    {
      contract_version: AI_RECOMMENDATION_OUTPUT_CONTRACT_VERSION,
      snapshot_contract_version:
        AI_RECOMMENDATION_SNAPSHOT_CONTRACT_VERSION,
      recommendation_snapshot_id: recommendationSnapshotId,
      recommendation_key: `VND:${input.as_of}:MANUAL:${input.ai_request_id}`,
      recommendation_version: 1,
      supersedes_snapshot_id: null,
      status,
      created_at: createdAt,
      as_of: input.as_of,
      currency: "VND",
      mode: "SHADOW",
      authoritative: false,
      input_snapshot_ref: input.input_snapshot_ref,
      calculation_result_ref: input.calculation_result_ref,
      ai_input_digest: input.ai_input_digest,
      prompt_contract_ref: input.prompt_contract_ref,
      model_ref: model,
      fact_summary: draft.fact_summary.map(mapClaim),
      risk_summary: draft.risk_summary.map(mapClaim),
      recommendations: draft.recommendations.map((recommendation) => ({
        recommendation_id: recommendation.recommendation_id,
        recommendation_type: recommendation.recommendation_type,
        title: recommendation.title,
        statement: recommendation.statement,
        reason_codes: recommendation.reason_codes,
        priority: recommendation.priority,
        action_mode: "HUMAN_REVIEW_ONLY",
        human_review_request: recommendation.human_review_request,
        referenced_values: recommendation.referenced_value_paths.map(
          (path) => {
            const fact = factByPath.get(path);
            if (
              !fact ||
              fact.value_type !== "DECIMAL" ||
              typeof fact.value !== "string" ||
              !["VND", "USDT", "RATIO", "VND_PER_USDT"].includes(
                fact.unit ?? "",
              )
            ) {
              throw new Error("AI_DECIMAL_BINDING_MISSING");
            }
            return {
              source_path: path,
              value: fact.value,
              unit: fact.unit as "VND" | "USDT" | "RATIO" | "VND_PER_USDT",
              currency:
                fact.unit === "VND"
                  ? ("VND" as const)
                  : fact.unit === "USDT"
                    ? ("USDT" as const)
                    : null,
              formula_id: formulaByPath.get(path)?.formula_id ?? null,
              evidence_ids: fact.evidence_ids,
              status: fact.status,
            };
          },
        ),
        claim_ids: recommendation.claim_ids,
        deterministic_result_paths:
          recommendation.deterministic_result_paths,
        evidence_ids: recommendation.evidence_ids,
        confidence,
        limitations: recommendation.limitations,
        automatic_execution: false,
      })),
      confidence,
      limitations: draft.limitations,
      evidence_chain: await evidenceChain(
        input,
        calculation,
        runtime,
        createdAt,
      ),
      shadow_guard: AI_RECOMMENDATION_SHADOW_GUARD,
    },
    input,
  );
}

function publicResult(
  status: SettlementAiMvpStatus,
  snapshot: SettlementInputSnapshotV1 | null,
  recommendation: RecommendationSnapshotV1 | null,
  runtime: AiProviderRuntimeResultV1 | null,
  model: ProviderModelMetadataV1,
  promptDigest: string,
  attempts: number,
  safeMessage: string,
): SettlementAiMvpResult {
  return {
    status,
    recommendation_id: recommendation?.recommendation_snapshot_id ?? null,
    snapshot_id: recommendation?.input_snapshot_ref.snapshot_id ?? null,
    input_digest: recommendation?.input_snapshot_ref.input_digest ?? null,
    calculation_result_digest:
      recommendation?.calculation_result_ref.result_digest ?? null,
    recommendation_contract_version:
      AI_RECOMMENDATION_SNAPSHOT_CONTRACT_VERSION,
    created_at: recommendation?.created_at ?? null,
    evidence_refs: recommendation
      ? unique([
          ...recommendation.fact_summary.flatMap((claim) => claim.evidence_ids),
          ...recommendation.risk_summary.flatMap((claim) => claim.evidence_ids),
          ...recommendation.recommendations.flatMap(
            (item) => item.evidence_ids,
          ),
        ])
      : [],
    limitations: recommendation?.limitations ?? [],
    recommendation_snapshot: recommendation,
    attempts,
    validation_issues:
      runtime?.validation_result?.issues.map((item) => ({
        code: item.code,
        path: item.path,
        message: item.message,
      })) ?? [],
    safe_message: safeMessage,
    as_of: snapshot?.as_of ?? null,
    data_cutoffs:
      snapshot?.data_sources.map((source) => ({
        source_key: source.source_key,
        cutoff_at: source.cutoff_at,
        freshness_status: source.freshness_status,
      })) ?? [],
    provider: model.provider,
    model: runtime?.model_run_metadata?.model_id ?? model.model_id,
    model_revision:
      runtime?.model_run_metadata?.model_revision ?? model.model_revision,
    prompt_version: "1.0.0",
    prompt_digest: promptDigest,
    token_usage: {
      input_tokens: runtime?.token_usage.input_tokens ?? null,
      output_tokens: runtime?.token_usage.output_tokens ?? null,
      total_tokens: runtime?.token_usage.total_tokens ?? null,
    },
    mode: "SHADOW",
    shadow_guard: AI_RECOMMENDATION_SHADOW_GUARD,
  };
}

export async function generateControlledSettlementAiIntelligence(input: {
  snapshot: SettlementInputSnapshotV1;
  calculation: SettlementDeterministicCalculationResultV1;
  adapter: AiProviderAdapterV1;
  model: ProviderModelMetadataV1;
  clock?: () => string;
}): Promise<SettlementAiMvpResult> {
  const clock = input.clock ?? (() => new Date().toISOString());
  const prompt = await loadSettlementAiMvpPromptBundle();
  const aiInput = await buildSettlementAiRecommendationInput(
    input.snapshot,
    input.calculation,
    clock(),
  );
  const runtime = createAiProviderRuntime({
    adapter: input.adapter,
    prompt_loader: await createSettlementAiMvpPromptLoader(),
    model: input.model,
    clock,
  });
  let attempts = 0;
  let result: AiProviderRuntimeResultV1;
  do {
    attempts += 1;
    result = await runtime.run({
      ai_input: aiInput,
      adapter_request_id: globalThis.crypto.randomUUID(),
      requested_at: clock(),
    });
  } while (
    attempts < 2 &&
    result.status === "PROVIDER_FAILED" &&
    ["TIMEOUT", "RATE_LIMITED", "PROVIDER_UNAVAILABLE"].includes(
      result.provider_outcome ?? "",
    )
  );

  if (result.status !== "VALIDATED_DRAFT") {
    return publicResult(
      result.status === "VALIDATION_REJECTED"
        ? "VALIDATION_FAILED"
        : "PROVIDER_FAILED",
      input.snapshot,
      null,
      result,
      input.model,
      prompt.metadata.bundle_digest,
      attempts,
      result.status === "VALIDATION_REJECTED"
        ? "AI 输出未通过安全验证，未生成最终快照。"
        : "AI Provider 暂时不可用，未生成最终快照。",
    );
  }
  const recommendation = await createRecommendationSnapshot(
    aiInput,
    input.calculation,
    result,
    clock(),
  );
  return publicResult(
    "READY",
    input.snapshot,
    recommendation,
    result,
    input.model,
    prompt.metadata.bundle_digest,
    attempts,
    "AI 结算解读已通过验证，仅供人工查看。",
  );
}

export async function providerNotConfiguredResult(
  model: ProviderModelMetadataV1,
): Promise<SettlementAiMvpResult> {
  const prompt = await loadSettlementAiMvpPromptBundle();
  return publicResult(
    "PROVIDER_NOT_CONFIGURED",
    null,
    null,
    null,
    model,
    prompt.metadata.bundle_digest,
    0,
    "生产 AI Provider Secret 尚未配置；没有发起外部调用。",
  );
}
