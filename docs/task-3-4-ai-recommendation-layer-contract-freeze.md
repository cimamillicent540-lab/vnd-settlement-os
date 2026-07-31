# Task 3.4 — AI Recommendation Layer Contract Freeze

## Document Control

- Status: FROZEN FOR TASK 3.4 DESIGN
- Contract family: Settlement Intelligence Engine V1
- Upstream snapshot: `SettlementInputSnapshotV1`
- Upstream calculation: `DeterministicCalculationResultV1`
- AI input contract: `SETTLEMENT_AI_RECOMMENDATION_INPUT_V1`
- AI output contract: `SETTLEMENT_AI_RECOMMENDATION_OUTPUT_V1`
- Immutable snapshot contract: `AI_RECOMMENDATION_SNAPSHOT_V1`
- Currency scope: VND
- Operating timezone: Asia/Shanghai
- Execution mode: Shadow Mode only
- Authority: AI output is non-authoritative

This document is normative. “MUST”, “MUST NOT”, “SHOULD”, and “MAY” define contract requirements.

## 1. Scope and Authority Boundary

Task 3.4 freezes the boundary between:

1. `SettlementInputSnapshotV1`
2. `DeterministicCalculationResultV1`
3. A future AI explanation and recommendation layer
4. An immutable, non-executable recommendation snapshot

The deterministic calculation result remains authoritative for:

- Gross, Reserve, and Settleable values.
- Liquidity pressure and capacity-gap calculations.
- FIFO inventory cost.
- Cash Profit and Economic Profit.
- FX spreads.
- Business-rule thresholds and margin bands.
- Data quality, limitations, blocking reasons, and evidence references.

The AI layer is non-authoritative. It MAY:

- Explain deterministic facts in plain language.
- Summarize current risks and data limitations.
- Prioritize items for human operational review.
- Generate qualitative operational suggestions.

The AI layer MUST NOT:

- Recalculate or replace an authoritative value.
- Invent a missing value, rate, fee, time, merchant state, cost, or event.
- Convert a deterministic capacity-gap equivalent into a topup amount.
- Calculate a new customer quote.
- Create an executable payment, topup, quote, trade, or channel instruction.
- Create an approval, acceptance, rejection, or decision-modification workflow.
- Write to source business data.

If AI text conflicts with the deterministic result, the deterministic result wins. The conflicting claim MUST be removed from the accepted output and recorded as `AI_DETERMINISTIC_CONFLICT`.

## 2. AI Input Contract

### 2.1 Top-level envelope

`SETTLEMENT_AI_RECOMMENDATION_INPUT_V1` MUST contain:

| Field | Type | Requirement |
| --- | --- | --- |
| `contract_version` | string | Exactly `SETTLEMENT_AI_RECOMMENDATION_INPUT_V1`. |
| `ai_request_id` | UUID | Unique trace and idempotency identity. |
| `requested_at` | timestamp | UTC request time. |
| `as_of` | timestamp | Exact upstream decision boundary. |
| `currency` | string | Exactly `VND`. |
| `operating_timezone` | string | Exactly `Asia/Shanghai`. |
| `mode` | string | Exactly `SHADOW`. |
| `input_snapshot_ref` | object | Snapshot ID, contract version, input digest, and quality status. |
| `calculation_result_ref` | object | Result contract, engine version, ruleset, result digest, and status. |
| `approved_fact_projection` | object | Allowlisted facts copied from the two upstream contracts. |
| `evidence_catalog` | array | Allowlisted evidence references and lineage metadata. |
| `limitations` | array | All inherited limitations relevant to the requested scope. |
| `blocking_reasons` | array | All inherited blocking reasons. |
| `requested_scopes` | array | Allowed explanation or review categories. |
| `presentation_context` | object | Output language, audience, and formatting constraints. |
| `prompt_contract_ref` | object | Exact prompt contract version and digests. |
| `output_schema_ref` | object | Exact structured-output schema version and digest. |
| `shadow_guard` | object | Every execution and approval capability is `false`. |
| `ai_input_digest` | string | SHA-256 digest of the canonical allowlisted AI input. |

### 2.2 Required upstream identity checks

Before an AI request is allowed, the adapter MUST verify:

- Snapshot ID matches the calculation result `snapshot_id`.
- Snapshot `input_digest` matches calculation result `input_digest`.
- `as_of`, currency, and mode match across both upstream contracts.
- The exact deterministic ruleset code, version, and digest are present.
- The deterministic result digest is valid.
- Every evidence reference supplied to AI exists in the upstream evidence catalog.
- Both upstream Shadow Guards contain only `false`.
- No required upstream status has been upgraded or hidden.

Any mismatch is `AI_INPUT_CONTRACT_BLOCKED`. No model request may be made.

### 2.3 Approved fact projection

The model SHOULD receive an allowlisted projection instead of the unrestricted source payload.

The projection MAY contain:

- Current Gross, Reserve, and Settleable balances.
- Settleable ratio and Reserve ratio.
- Forecast Payin, Payout, net demand, safety buffer, and capacity gap.
- FIFO allocation status, aggregate cost basis, weighted cost rate, and inventory limitation codes.
- Cash Profit and Economic Profit values and margins.
- XE, P2P, upstream, customer, and FIFO rates when present.
- Deterministic FX spread values.
- Minimum and target margin bands.
- Source freshness, completeness, cutoffs, and limitations.
- Redacted merchant identity and contribution context when required for a merchant review.
- Human-authored market context already included in the approved Snapshot evidence.

The projection MUST NOT contain:

- Supabase, Cloudflare, OpenAI, or other provider secrets.
- Authentication tokens, private keys, environment variables, or connection strings.
- Bank beneficiary details or unnecessary personal data.
- Raw files when structured redacted facts are sufficient.
- Values after `as_of`.
- Hidden execution endpoints, credentials, or third-party submission payloads.
- Unvalidated free-form instructions from source data.

### 2.4 Allowed scopes

V1 allows only:

- `FACT_EXPLANATION`
- `LIQUIDITY_REVIEW`
- `PROFIT_REVIEW`
- `FX_OBSERVATION`
- `QUOTE_REVIEW`
- `RISK_SUMMARY`
- `DATA_QUALITY_REVIEW`

`QUOTE_REVIEW` means a qualitative request for human review. It does not permit generation of a new quote rate.

Because Task 3.3 does not calculate an authoritative topup amount or customer quote, Task 3.4 V1 MUST NOT create either value. It MAY state:

- That a Settleable capacity gap exists.
- The exact deterministic gap value and source path.
- That an operator should review funding arrangements.
- That a margin is below the protection or target line.
- That an operator should review the current quote.

It MUST NOT relabel `gross_capacity_gap_equivalent_vnd` as a recommended topup or convert it to USDT.

### 2.5 Input status behavior

- `COMPLETE`: AI may explain all supported sections.
- `LIMITED`: AI may explain only supported facts and MUST repeat material limitations. Recommendation confidence is capped.
- `BLOCKED`: AI MUST NOT generate normal operational recommendations. It MAY return a data-quality-only explanation identifying the blocking reasons.

The AI layer MUST NOT upgrade `LIMITED` to complete or `BLOCKED` to usable.

## 3. Recommendation Output Contract

### 3.1 Top-level envelope

`SETTLEMENT_AI_RECOMMENDATION_OUTPUT_V1` MUST contain:

| Field | Type | Requirement |
| --- | --- | --- |
| `contract_version` | string | Exactly `SETTLEMENT_AI_RECOMMENDATION_OUTPUT_V1`. |
| `recommendation_snapshot_id` | UUID | Immutable output identity. |
| `recommendation_key` | string | Stable logical recommendation key. |
| `recommendation_version` | integer | Starts at 1 and increases by append-only replacement. |
| `supersedes_snapshot_id` | UUID or null | Prior immutable version, if any. |
| `status` | enum | `ACTIVE`, `LIMITED_BY_DATA`, `BLOCKED_BY_DATA`, or `REJECTED_BY_VALIDATION`. |
| `created_at` | timestamp | UTC generation time. |
| `as_of` | timestamp | Exact upstream boundary. |
| `currency` | string | Exactly `VND`. |
| `mode` | string | Exactly `SHADOW`. |
| `authoritative` | boolean | Exactly `false`. |
| `input_snapshot_ref` | object | Exact snapshot identity and digest. |
| `calculation_result_ref` | object | Exact calculation identity and digest. |
| `ai_input_digest` | string | Digest of the allowlisted model input. |
| `prompt_contract_ref` | object | Exact prompt version and digests. |
| `model_ref` | object | Exact provider, model, revision, and generation metadata. |
| `fact_summary` | array | Evidence-supported factual summaries. |
| `risk_summary` | array | Evidence-supported risks and limitations. |
| `recommendations` | array | Human-review-only recommendations. |
| `confidence` | object | Deterministically calculated output confidence. |
| `limitations` | array | Inherited and AI-validation limitations. |
| `evidence_chain` | object | Ordered lineage and claim support. |
| `output_digest` | string | SHA-256 digest of the canonical accepted output. |
| `shadow_guard` | object | All execution and approval flags are `false`. |

### 3.2 Individual recommendation

Every recommendation item MUST contain:

- `recommendation_id`
- `recommendation_type`
- `title`
- `statement`
- `reason_codes`
- `priority`
- `action_mode`, exactly `HUMAN_REVIEW_ONLY`
- `human_review_request`
- `referenced_values`
- `claim_ids`
- `deterministic_result_paths`
- `evidence_ids`
- `confidence`
- `limitations`
- `automatic_execution`, exactly `false`

Allowed `recommendation_type` values:

- `LIQUIDITY_REVIEW`
- `PROFIT_REVIEW`
- `FX_OBSERVATION`
- `QUOTE_REVIEW`
- `RISK_MONITORING`
- `DATA_QUALITY_REVIEW`

Allowed `priority` values:

- `INFO`
- `LOW`
- `MEDIUM`
- `HIGH`
- `CRITICAL`

Priority is non-authoritative triage metadata. It MUST NOT replace a deterministic severity or business-rule result.

### 3.3 Referenced values

Every financial value in AI output MUST be copied from an authoritative upstream path and recorded as:

- `source_path`
- `value`
- `unit`
- `currency`
- `formula_id`, when applicable
- `evidence_ids`

Rules:

- Decimal strings MUST be copied without changing the authoritative value.
- A presentation label MAY format a value, but the structured value remains exact.
- AI MUST NOT add, subtract, divide, multiply, round, extrapolate, or convert authoritative amounts.
- AI MUST NOT produce a new topup amount, quote rate, profit value, spread, or risk threshold.
- A value with `LIMITED` or `BLOCKED` status MUST carry that status into the claim.

### 3.4 Natural-language boundaries

Allowed language:

- “Settleable capacity gap is present; review funding arrangements.”
- “Economic Profit is below the target margin; review the current commercial setup.”
- “P2P input is missing, so FX comparison is limited.”
- “The deterministic result reports an unresolved FIFO ordering limitation.”

Prohibited language:

- “Execute a topup of X USDT.”
- “Change Merchant A’s quote to Y.”
- “Approve and pay this batch.”
- “Trade now.”
- “The missing rate is probably Z.”
- Any statement implying an action has been approved, submitted, or executed.

The stored rationale MUST be a concise evidence-based explanation. Private model chain-of-thought MUST NOT be requested, stored, or exposed.

## 4. Evidence Reference Rules

### 4.1 Claim-level support

Every material factual claim MUST contain:

- `claim_id`
- `claim_text`
- `claim_type`
- `deterministic_result_paths`
- `snapshot_paths`
- `evidence_ids`
- `support_status`
- `limitations`

Allowed `claim_type` values:

- `DETERMINISTIC_FACT`
- `SOURCE_FACT`
- `LIMITATION`
- `QUALITATIVE_REVIEW_SUGGESTION`

Allowed `support_status` values:

- `SUPPORTED`
- `LIMITED_SUPPORT`
- `UNSUPPORTED`
- `CONFLICT`

`UNSUPPORTED` and `CONFLICT` claims MUST NOT appear in an `ACTIVE` or `LIMITED_BY_DATA` accepted recommendation.

### 4.2 Evidence subset rule

- All cited evidence IDs MUST be a subset of upstream Snapshot evidence IDs.
- All cited deterministic paths MUST exist in the exact referenced result digest.
- AI MUST NOT invent evidence IDs or source paths.
- External news, market data, or web content MUST NOT be introduced directly by the model.
- Future external context must first enter an approved Snapshot evidence source with timestamp, cutoff, digest, and redaction metadata.
- Missing evidence remains missing and MUST be stated as a limitation.

### 4.3 Material claim validation

A deterministic post-model validator MUST:

1. Parse the structured output schema.
2. Verify every deterministic path.
3. Compare every cited value with the exact upstream decimal string.
4. Verify evidence-ID membership.
5. Reject unsupported calculations and executable language.
6. Verify all Shadow Guard fields remain false.
7. Remove or reject claims that conflict with upstream facts.

Validation is authoritative. The model cannot waive a validation failure.

### 4.4 Ordered evidence chain

The accepted evidence chain MUST record:

1. `SNAPSHOT_REFERENCED`
2. `DETERMINISTIC_RESULT_REFERENCED`
3. `AI_FACT_PROJECTION_CREATED`
4. `AI_INPUT_VALIDATED`
5. `MODEL_GENERATED`
6. `OUTPUT_SCHEMA_VALIDATED`
7. `CLAIMS_EVIDENCE_VALIDATED`
8. `SHADOW_GUARD_VALIDATED`
9. `RECOMMENDATION_SNAPSHOT_FINALIZED`

Each step MUST include:

- Step time.
- Contract or validator version.
- Input and output digests.
- Status.
- Limitation or error codes.

## 5. Confidence Contract

### 5.1 Authority

Confidence MUST be calculated by a deterministic validator after model output. It MUST NOT use the model’s self-reported confidence as an authoritative input.

Confidence describes evidence support and input quality. It does not predict that an operational suggestion will be profitable or correct.

### 5.2 Confidence components

Each recommendation MUST record decimal-string component scores from `0.000000` to `1.000000`:

| Component | Weight | Source |
| --- | ---: | --- |
| `input_quality_score` | `0.30` | Upstream `COMPLETE/LIMITED/BLOCKED` and section status. |
| `evidence_coverage_score` | `0.25` | Supported material claims divided by all material claims. |
| `freshness_score` | `0.20` | Freshness of sources cited by the recommendation. |
| `deterministic_support_score` | `0.20` | Claims backed by valid deterministic paths and exact values. |
| `schema_validation_score` | `0.05` | Structured schema and Shadow Guard validation. |

Frozen formula:

`confidence_score = input_quality_score × 0.30 + evidence_coverage_score × 0.25 + freshness_score × 0.20 + deterministic_support_score × 0.20 + schema_validation_score × 0.05`

The calculation uses decimal arithmetic and `ROUND_HALF_UP` to six decimal places.

### 5.3 Component scoring

Input quality:

- `COMPLETE = 1.000000`
- `LIMITED = 0.600000`
- `BLOCKED = 0.000000`

Freshness per cited source:

- `FRESH = 1.000000`
- `AGING = 0.750000`
- `STALE = 0.250000`
- `MISSING = 0.000000`
- `FUTURE_DATED = 0.000000`

The recommendation freshness score is the arithmetic mean of cited source scores. No cited source produces `0.000000`.

Evidence coverage:

`supported material claims ÷ all material claims`

Deterministic support:

`material claims with verified deterministic paths and exact values ÷ material claims that require deterministic support`

If no claim requires deterministic support, this component is `1.000000` only when the recommendation is a data-quality explanation supported by upstream limitation paths.

Schema validation:

- Full schema and guard validation: `1.000000`
- Any schema or guard failure: `0.000000` and output status `REJECTED_BY_VALIDATION`

### 5.4 Confidence caps and rejection rules

- Overall or dependent section `LIMITED`: confidence is capped at `0.700000`.
- Any cited source `STALE`: confidence is capped at `0.500000`.
- Any dependent section `BLOCKED`: normal recommendation is suppressed; only data-quality explanation is allowed.
- Missing support for any material monetary claim: the claim is rejected, not merely assigned low confidence.
- Any deterministic conflict: the conflicting item is rejected and records `AI_DETERMINISTIC_CONFLICT`.
- Any executable instruction or true Shadow Guard flag: the whole output is `REJECTED_BY_VALIDATION`.

Confidence bands:

- `HIGH`: score at least `0.850000`
- `MEDIUM`: score at least `0.650000` and below `0.850000`
- `LOW`: score at least `0.350000` and below `0.650000`
- `INSUFFICIENT`: below `0.350000`

Every confidence object MUST include component values, applied caps, final score, band, and stable reason codes.

## 6. Prompt and Model Version Contract

### 6.1 Prompt contract reference

Every generation MUST record:

- `prompt_contract_code`
- `prompt_contract_version`
- `system_prompt_digest`
- `developer_prompt_digest`
- `user_input_template_digest`
- `output_schema_version`
- `output_schema_digest`
- `safety_policy_version`
- `allowed_scope_version`
- `language`

Prompt content changes require a new semantic prompt-contract version. A run MUST resolve an exact version; “latest” is not a stored version.

### 6.2 Model reference

Every generation MUST record:

- `provider`
- `model_id`
- `model_revision` when the provider exposes one
- `deployment_id` when applicable
- `request_id` or provider response ID
- `generation_started_at`
- `generation_completed_at`
- `temperature`
- `top_p`
- `max_output_tokens`
- `seed` when supported
- `structured_output_mode`
- `tool_policy`, exactly `NO_TOOLS`
- Token usage metadata when available

Secrets, authorization headers, and raw API keys MUST NOT be stored.

Model aliases MUST be resolved to a recorded concrete model identifier or deployment version when the provider supports it. Changing the model or material generation parameters creates a new recommendation version.

### 6.3 Model failure

- Model timeout, refusal, malformed output, or provider failure MUST NOT invalidate the deterministic result.
- No recommendation snapshot is accepted until schema, evidence, conflict, and Shadow Guard validation pass.
- Failure MAY produce a separate non-financial run-status record, but MUST NOT fabricate a recommendation.

## 7. Recommendation Immutability

An accepted `AI_RECOMMENDATION_SNAPSHOT_V1` is immutable.

Requirements:

- It MUST NOT be updated or deleted.
- Regeneration appends a new version.
- A new version references the prior version with `supersedes_snapshot_id`.
- The prior payload remains unchanged.
- `SUPERSEDED` is derived from an append-only supersession reference or event; it is not written back into the prior snapshot.
- A changed Snapshot, calculation digest, ruleset, prompt, model, projection, or material limitation requires a new version.
- Corrections are represented by a new immutable snapshot.
- Later actual outcomes are stored separately and linked by recommendation snapshot ID.
- Human approval, accept, modify, reject, and delete operations are outside Task 3.4.

Recommended idempotency basis:

`currency + as_of + input_digest + deterministic_result_digest + prompt_contract_version + model_id + model_revision + ai_input_digest`

An exact repeat MAY return the existing immutable snapshot. It MUST NOT create a conflicting duplicate version.

## 8. Shadow Mode Boundary

### 8.1 Required guards

Input and output MUST contain:

- `automatic_topup: false`
- `automatic_payment: false`
- `automatic_quote_change: false`
- `automatic_trading: false`
- `automatic_channel_switch: false`
- `third_party_submission: false`
- `approval_workflow: false`

Any missing, unknown, or true flag blocks the AI request or rejects the output.

### 8.2 Prohibited capabilities

Task 3.4 MUST NOT:

- Call a payment, banking, topup, exchange, trading, quote, or channel API.
- Generate a payment or topup submission file.
- Upload data to a third-party execution system.
- Modify a merchant quote.
- Create an executable queue item, webhook, job, or command.
- Create an approval task or approval status.
- Present a recommendation as approved or executed.
- Include executable buttons, signed requests, credentials, or hidden action payloads.

### 8.3 Presentation

Every AI output MUST visibly state:

- `Shadow Mode`
- `AI-generated suggestion`
- `Human review only`
- `No action has been executed`
- The exact `as_of`
- Overall data quality
- Material limitations

AI output MAY be displayed or included in a future read-only reminder. Notification delivery and Lark integration are outside this contract and MUST not add action execution.

## 9. Inherited Known Limitations

Task 3.4 inherits and MUST disclose relevant Task 3.3 limitations:

- `DATE_ONLY` FIFO ordering may be unresolved.
- Historical inventory positions cannot always be reconstructed completely.
- Historical merchant state may use a latest-run view rather than a fully versioned state.
- FX opportunity classification is deferred.
- Liquidity forecast is a historical-average baseline and does not prove intrahorizon event order.

The AI layer cannot resolve these limitations by inference.

Task 3.4 V1 also has these recommendation limits:

- No deterministic topup amount is available from Task 3.3.
- No deterministic customer quote is available from Task 3.3.
- No BUY/NORMAL/RISK FX classification is available from Task 3.3.
- Therefore V1 recommendations are explanatory and qualitative review requests only.

## 10. Freeze Decision

Task 3.4 is frozen as a non-authoritative, evidence-bound, immutable recommendation layer operating exclusively in Shadow Mode.

AI may explain facts, summarize risks, and generate human-review-only operational suggestions. It may not change deterministic values, invent missing information, create approvals, or trigger any operational action.

This design task authorizes no code, migration, database change, deployment, model integration, or execution capability.
