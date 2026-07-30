# Task 3.1 — Settlement Intelligence Engine Foundation Contract

## Document Control

- Status: FROZEN FOR TASK 3.1
- Contract family: Settlement Intelligence Engine V1
- Input contract: `SETTLEMENT_INTELLIGENCE_INPUT_V1`
- Output contract: `SETTLEMENT_INTELLIGENCE_OUTPUT_V1`
- Recommendation snapshot contract: `RECOMMENDATION_SNAPSHOT_V1`
- Ruleset contract: `SETTLEMENT_RULESET_V1`
- Current currency scope: VND
- Operating timezone: Asia/Shanghai
- Execution mode: Shadow Mode only

This document is normative. “MUST”, “MUST NOT”, “SHOULD”, and “MAY” define contract requirements.

## 1. Scope

Task 3.1 freezes the boundary between settlement data, deterministic calculations, future AI explanations, and immutable recommendations.

It defines:

- Engine input and output envelopes.
- Rule Engine and AI Layer responsibilities.
- Recommendation snapshot structure and immutability.
- Ruleset identity, versioning, parameters, and formula metadata.
- Data freshness classifications and degradation behavior.
- Evidence Chain structure and traceability requirements.

It does not authorize:

- A database migration.
- A production database change.
- An AI model integration.
- A deployment.
- An approval workflow.
- Modification or deletion of a decision.
- Any automatic payment, topup, quote change, trade, channel switch, or third-party submission.

## 2. Common Contract Conventions

### 2.1 Serialization

- Contract payloads MUST be valid JSON objects.
- Field names MUST use `snake_case`.
- Timestamps MUST use RFC 3339 UTC values, for example `2026-07-30T03:00:00Z`.
- The operating timezone MUST be stored separately as an IANA timezone.
- Calendar dates MUST use `YYYY-MM-DD`.
- IDs MUST be UUIDs unless a field explicitly declares another format.
- Enumerations MUST use uppercase `SNAKE_CASE`.
- Optional or unavailable values MUST be `null`; zero MUST NOT represent missing data.

### 2.2 Numeric values

- Monetary amounts and rates MUST be serialized as decimal strings.
- VND amounts MUST support at least 2 decimal places.
- USDT amounts MUST support at least 8 decimal places.
- Rates and ratios MUST support at least 12 decimal places.
- Floating-point binary numbers MUST NOT be used as authoritative monetary inputs.
- Every amount MUST have an explicit currency or a field name with a currency suffix.
- Every signed amount MUST document whether positive means income, inflow, or advantage.

### 2.3 Version and integrity values

- Every top-level contract MUST include `contract_version`.
- Every engine result MUST identify both `ruleset_version` and `engine_version`.
- Future AI output MUST identify `ai_model_version` and `prompt_contract_version`.
- Canonical payload digests MUST use SHA-256 and the `sha256:<hex>` format.
- Hash calculation MUST exclude storage-generated fields such as database row ID and insertion time.

## 3. Engine Input Contract

### 3.1 Top-level envelope

`SETTLEMENT_INTELLIGENCE_INPUT_V1` MUST contain:

| Field | Type | Required | Requirement |
| --- | --- | --- | --- |
| `contract_version` | string | yes | Exactly `SETTLEMENT_INTELLIGENCE_INPUT_V1`. |
| `request_id` | UUID | yes | Idempotency and trace correlation key. |
| `requested_at` | timestamp | yes | Time the run was requested. |
| `as_of` | timestamp | yes | Decision time; all freshness calculations use this value. |
| `currency` | string | yes | Exactly `VND` in V1. |
| `operating_timezone` | string | yes | Exactly `Asia/Shanghai` in the frozen V1 rules. |
| `run_trigger` | enum | yes | `MANUAL`, `SCHEDULED_1100`, `SCHEDULED_1600`, or `SCHEDULED_2300`. |
| `mode` | string | yes | Exactly `SHADOW`. |
| `ruleset_ref` | object | yes | Requested ruleset ID, version, and hash. |
| `data_sources` | array | yes | Freshness and lineage descriptor for every source used. |
| `balance_position` | object | yes | Gross, reserve, and settleable balances. |
| `liquidity_context` | object | yes | Current and forecast Payin/Payout information. |
| `fx_context` | object | yes | XE, P2P, upstream, and quote inputs with timestamps. |
| `inventory_context` | object | yes | Immutable topup batches and FIFO position. |
| `merchant_contexts` | array | yes | Merchant quote and contribution inputs; may be empty. |
| `profit_context` | object | yes | Cash and economic profit components with evidence status. |
| `market_context` | array | yes | Human market notes; may be empty and MUST remain non-executable. |
| `input_evidence` | array | yes | Evidence items or stable evidence references. |
| `shadow_guard` | object | yes | Every execution flag MUST be `false`. |

### 3.2 Data source descriptor

Every item in `data_sources` MUST contain:

```json
{
  "source_key": "ACCOUNT_HISTORY",
  "source_type": "SUPABASE_QUERY",
  "source_system": "VND_SETTLEMENT_OS",
  "observed_at": "2026-07-30T02:58:00Z",
  "cutoff_at": "2026-07-30T02:55:00Z",
  "record_count": 120,
  "freshness_policy_key": "ACCOUNT_HISTORY_OPERATIONAL_V1",
  "freshness_status": "FRESH",
  "completeness_status": "COMPLETE",
  "content_digest": "sha256:<hex>",
  "evidence_ids": ["<uuid>"]
}
```

Allowed `freshness_status` values:

- `FRESH`
- `AGING`
- `STALE`
- `MISSING`
- `FUTURE_DATED`

Allowed `completeness_status` values:

- `COMPLETE`
- `PARTIAL`
- `PARTIAL_AFTER_ACCOUNT_HISTORY_CUTOFF`
- `UNAVAILABLE`
- `INVALID`

### 3.3 Balance position

`balance_position` MUST contain:

- `as_of`
- `gross_balance_vnd`
- `reserve_ratio`
- `reserve_balance_vnd`
- `settleable_ratio`
- `settleable_balance_vnd`
- `balance_source`
- `account_history_cutoff_at`
- `reconciliation_status`
- `evidence_ids`

Required invariants:

- `reserve_ratio = 0.50` and `settleable_ratio = 0.50` for the frozen V1 ruleset.
- `reserve_ratio + settleable_ratio = 1`.
- `reserve_balance_vnd = gross_balance_vnd × reserve_ratio`.
- `settleable_balance_vnd = gross_balance_vnd × settleable_ratio`.
- Raw Account History amounts MUST NOT be divided, multiplied, or overwritten.
- Payout capacity MUST use `settleable_balance_vnd`, never `gross_balance_vnd`.
- No contract may contain or derive the legacy `multiplier = 2`.

### 3.4 Liquidity context

`liquidity_context` MUST contain:

- `historical_window_days`
- `forecast_window_start`
- `forecast_window_end`
- `forecast_payin_vnd`
- `forecast_payout_vnd`
- `forecast_net_demand_vnd`
- `peak_window`
- `hourly_forecast`
- `current_payout_pressure`
- `forecast_method`
- `forecast_version`
- `evidence_ids`

The V1 peak window MUST be `16:00-23:00` in the operating timezone.

Payin and Payout inputs MUST preserve actual pool movement:

- Payin pool inflow uses the Account History `gross_change_vnd` magnitude.
- Payout pool outflow uses the Account History `gross_change_vnd` magnitude,
  including fees; its signed ledger direction is negative.
- Settleable changes are derived using the frozen settleable ratio.
- Matched internal transfer debit and credit MUST net to zero at both Gross and Settleable layers.

### 3.5 FX context

Each FX input MUST contain:

- `rate_type`
- `rate_value`
- `source`
- `record_time`
- `operator_id` when manually entered
- `freshness_status`
- `evidence_ids`

Supported V1 rate types:

- `XE_BASE_RATE`
- `P2P_COST_RATE`
- `UPSTREAM_QUOTE_RATE`
- `CURRENT_CUSTOMER_QUOTE_RATE`

Rules:

- Missing rates MUST remain `null`.
- Historical FIFO costs MUST NOT be overwritten by current P2P or XE rates.
- A missing P2P rate MUST block a USDT-denominated topup recommendation.
- A missing XE or P2P rate MUST reduce or block quote recommendation confidence according to the active ruleset.
- Manually entered rates MUST retain the operator and record time.

### 3.6 Inventory context

`inventory_context` MUST contain:

- `cost_method`, exactly `FIFO_ACTUAL_TOPUP_V1`
- `position_as_of`
- `total_remaining_vnd`
- `batches`
- `unmatched_inventory_status`
- `evidence_ids`

Each batch MUST retain:

- Batch ID and source Topup ID.
- Batch date and time precision.
- Original USDT amount.
- Original VND amount.
- Actual cost rate.
- Remaining VND amount.
- Source and historical-cost lock.

`DATE_ONLY` topups MUST NOT be assigned an invented execution time.

### 3.7 Merchant and profit context

Each merchant context SHOULD contain:

- `merchant_id`
- `merchant_name`
- `merchant_tier`
- `current_quote_rate`
- `merchant_principal_usdt`
- `merchant_fee_usdt`
- `merchant_fee_rate_on_principal`
- `transaction_volume_usdt`
- `cash_profit_contribution_usdt`
- `economic_profit_contribution_usdt`
- `risk_level`
- `evidence_ids`

Formal merchant fee rate:

`merchant_fee_rate_on_principal = merchant_fee_usdt ÷ merchant_principal_usdt`

Historical merchant fee revenue MUST use the original `merchant_fee_usdt`; it MUST NOT be reconstructed from a rate when actual fee evidence exists.

`profit_context` MUST preserve the signed DCC convention and both profit views:

`cash_profit = merchant_fee_revenue + signed_dcc_revenue + realized_fx_profit - channel_fees - other_actual_fees`

`economic_profit = cash_profit + signed_internal_funding_advantage - shadow_cost - opportunity_cost - unrealized_risk_cost`

Positive DCC is company revenue. Negative DCC is a discount or company-borne cost.

### 3.8 Shadow guard

The input MUST include:

```json
{
  "automatic_topup": false,
  "automatic_payment": false,
  "automatic_quote_change": false,
  "automatic_trading": false,
  "automatic_channel_switch": false,
  "third_party_submission": false
}
```

Any `true` value is a hard contract failure.

## 4. Engine Output Contract

### 4.1 Top-level envelope

`SETTLEMENT_INTELLIGENCE_OUTPUT_V1` MUST contain:

| Field | Type | Requirement |
| --- | --- | --- |
| `contract_version` | string | Exactly `SETTLEMENT_INTELLIGENCE_OUTPUT_V1`. |
| `engine_run_id` | UUID | Unique immutable run identity. |
| `request_id` | UUID | Copied from the input. |
| `generated_at` | timestamp | Output generation time. |
| `as_of` | timestamp | Copied from the input. |
| `currency` | string | Copied from the input. |
| `mode` | string | Exactly `SHADOW`. |
| `engine_version` | string | Deterministic engine implementation version. |
| `ruleset_ref` | object | Exact ruleset used. |
| `input_digest` | string | Digest of canonical validated input. |
| `run_status` | enum | `COMPLETED`, `COMPLETED_WITH_LIMITATIONS`, or `BLOCKED`. |
| `data_quality` | object | Freshness, completeness, limitations, and blocking reasons. |
| `rule_engine_result` | object | Authoritative deterministic result. |
| `ai_layer_result` | object | AI status and optional explanation; non-authoritative. |
| `recommendation_snapshot` | object or null | Immutable recommendation if the run is not blocked. |
| `evidence_chain` | object | Ordered evidence and transformation lineage. |
| `shadow_guard` | object | All execution flags remain `false`. |

### 4.2 Rule Engine result

`rule_engine_result` MUST contain:

- `balance_summary`
- `liquidity_forecast`
- `topup_advice`
- `fx_intelligence`
- `quote_advice`
- `profit_forecast`
- `risk_signals`
- `formula_results`
- `calculation_warnings`

Rule Engine values are authoritative. The AI Layer MUST NOT overwrite them.

Topup advice status:

- `NO_TOPUP`
- `TOPUP_RECOMMENDED`
- `INSUFFICIENT_MARKET_DATA`
- `DATA_TOO_STALE`

FX judgment:

- `BUY_VND_OPPORTUNITY`
- `NORMAL`
- `RISK`
- `WAITING_INPUT`

Risk severity:

- `INFO`
- `WARNING`
- `HIGH`
- `CRITICAL`

### 4.3 AI Layer result

Task 3.1 and Task 3.2 MUST emit:

```json
{
  "status": "NOT_IMPLEMENTED",
  "authoritative": false,
  "ai_model_version": null,
  "prompt_contract_version": null,
  "narrative": null,
  "prioritized_risks": [],
  "limitations": ["AI Layer is outside Task 3.1"]
}
```

When a future task implements the AI Layer:

- It MUST receive only the validated Rule Engine result and approved evidence summaries.
- It MUST NOT receive secrets or unnecessary personal data.
- It MUST NOT recalculate or replace monetary values.
- It MUST cite Rule Engine result paths and evidence IDs for material claims.
- It MUST clearly label generated text as a suggestion.
- Failure of the AI Layer MUST NOT invalidate a completed Rule Engine result.

## 5. Rule Engine and AI Layer Boundary

| Capability | Rule Engine | AI Layer |
| --- | --- | --- |
| Balance and ratio calculation | authoritative | prohibited |
| FIFO cost allocation | authoritative | prohibited |
| Cash/Economic Profit calculation | authoritative | prohibited |
| Freshness and completeness status | authoritative | may explain |
| Threshold and risk evaluation | authoritative | may prioritize |
| Topup quantity calculation | authoritative | may explain |
| Quote rate calculation | authoritative | may explain |
| Natural-language summary | structured facts only | allowed |
| Invent missing data | prohibited | prohibited |
| Change a deterministic result | not applicable | prohibited |
| Execute an action | prohibited | prohibited |

Conflicts MUST resolve in favor of the Rule Engine. A conflict MUST be recorded as `AI_RULE_CONFLICT`, and the conflicting AI text MUST not be presented as an authoritative recommendation.

## 6. Recommendation Snapshot Contract

### 6.1 Identity and versioning

`RECOMMENDATION_SNAPSHOT_V1` MUST contain:

- `snapshot_id`
- `recommendation_key`
- `recommendation_version`
- `supersedes_snapshot_id`
- `status`
- `created_at`
- `as_of`
- `currency`
- `operating_date`
- `engine_run_id`
- `input_digest`
- `ruleset_ref`
- `engine_version`
- `ai_model_version`
- `data_quality`
- `balance_snapshot`
- `topup_recommendation`
- `quote_recommendations`
- `fx_judgment`
- `profit_forecast`
- `risk_signals`
- `recommendation_reasons`
- `evidence_chain_hash`
- `evidence_ids`
- `shadow_guard`

Allowed status values:

- `ACTIVE`
- `LIMITED_BY_DATA`

`SUPERSEDED` is an effective read status derived from a later snapshot's
`supersedes_snapshot_id` or an append-only supersession event. It MUST NOT be
written back into the immutable prior snapshot payload.

### 6.2 Recommendation fields

`topup_recommendation` MUST distinguish:

- VND shortfall.
- Required Gross topup VND.
- Suggested USDT amount.
- Recommended time window.
- Expected coverage window.
- Advice status.
- Reasons.
- Confidence.

If P2P evidence is missing or stale beyond the ruleset limit:

- VND shortfall MAY be present.
- Required Gross topup VND MAY be present.
- Suggested USDT amount MUST be `null`.
- Advice status MUST be `INSUFFICIENT_MARKET_DATA` or `DATA_TOO_STALE`.

Every quote recommendation MUST contain:

- Merchant identity.
- Current quote rate.
- Suggested quote rate or `null`.
- Minimum and target margins.
- Expected Cash and Economic Profit impact.
- Evidence IDs.
- Confidence and limitations.
- `automatic_quote_change: false`.

### 6.3 Immutability

- A persisted snapshot MUST NOT be updated or deleted.
- Recalculation MUST append a new version.
- A newer version MUST reference the prior snapshot with `supersedes_snapshot_id`.
- Supersession MUST be represented by the newer snapshot or a separate
  append-only event; the prior payload remains unchanged.
- Actual outcomes MUST be stored separately and linked by snapshot ID.
- Approval, decision modification, and decision deletion are outside this contract.
- Snapshot creation MUST NOT imply approval or execution.

Recommended idempotency key:

`currency + operating_date + run_trigger + ruleset_version + input_digest`

## 7. Ruleset Version Contract

### 7.1 Required structure

`SETTLEMENT_RULESET_V1` MUST contain:

```json
{
  "ruleset_id": "<uuid>",
  "ruleset_code": "VND_SETTLEMENT_INTELLIGENCE_RULESET",
  "ruleset_version": "1.0.0",
  "compatibility_aliases": [
    "SETTLEMENT_INTELLIGENCE_V1",
    "VND_BUSINESS_RULES_FREEZE_V2"
  ],
  "currency": "VND",
  "effective_at": "2026-07-30T00:00:00Z",
  "status": "ACTIVE",
  "parameters": {},
  "formula_catalog": [],
  "freshness_policies": [],
  "rounding_policy": {},
  "shadow_guard": {},
  "source_references": [],
  "ruleset_digest": "sha256:<hex>"
}
```

### 7.2 Frozen V1 parameters

| Parameter | V1 value | Meaning |
| --- | --- | --- |
| `reserve_ratio` | `0.50` | Gross balance locked as reserve. |
| `settleable_ratio` | `0.50` | Gross balance available for settlement. |
| `liquidity_safety_buffer` | `0.10` | Forecast liquidity safety buffer. |
| `minimum_margin` | `0.002` | Market protection line. |
| `target_margin` | `0.005` | Target margin. |
| `maximum_inventory_usdt` | `50000` | Base inventory limit requiring human attention above the limit. |
| `peak_window_start_hour` | `16` | Local peak window start. |
| `peak_window_end_hour` | `23` | Local peak window end. |
| `inventory_cost_method` | `FIFO_ACTUAL_TOPUP_V1` | Historical VND inventory cost method. |

The ruleset MUST also contain:

- Formula IDs and human-readable expressions.
- Input field paths for every formula.
- Output precision and rounding mode.
- Missing-data behavior.
- Risk threshold source and rationale.
- Freshness policy references.
- All Shadow Guard flags set to `false`.

### 7.3 Versioning rules

- Rulesets are immutable after becoming `ACTIVE`.
- A parameter, formula, threshold, rounding, or freshness change requires a new semantic version.
- Patch versions MAY clarify metadata without changing numeric outcomes.
- Minor or major versions MUST be used when calculations or decision outcomes may change.
- A new active ruleset MUST retain the prior digest and supersession reference.
- A run MUST resolve exactly one ruleset version before calculation.
- Failure to resolve an exact version is a blocking error.
- Ruleset selection MUST NOT use “latest” without resolving and recording the exact version and digest.

## 8. Data Freshness Standard

### 8.1 Policy structure

Each source-specific policy MUST define:

- `policy_key`
- `source_key`
- `required`
- `soft_age_seconds`
- `max_age_seconds`
- `future_tolerance_seconds`
- `missing_behavior`
- `stale_behavior`
- `affected_outputs`

Freshness age:

`age_seconds = as_of - cutoff_at`

Classification:

- `FRESH`: age is at or below `soft_age_seconds`.
- `AGING`: age is above the soft limit and at or below `max_age_seconds`.
- `STALE`: age is above `max_age_seconds`.
- `MISSING`: no cutoff or usable record exists.
- `FUTURE_DATED`: cutoff is later than `as_of + future_tolerance_seconds`.

Thresholds MUST live in a versioned ruleset. They MUST NOT be hardcoded only in UI or AI prompts.

### 8.2 Degradation behavior

| Condition | Required behavior |
| --- | --- |
| Account History missing or invalid | Block balance-dependent recommendations. |
| Account History older than newer Topup/Payout evidence | Mark `PARTIAL_AFTER_ACCOUNT_HISTORY_CUTOFF`; do not call the balance real-time. |
| P2P cost rate missing | Keep VND liquidity result; set USDT topup amount to `null`. |
| P2P cost rate stale | Set FX and USDT topup outputs to limited or blocked according to the ruleset. |
| XE rate missing or stale | Block a complete quote recommendation; show `WAITING_INPUT`. |
| Inventory evidence incomplete | Mark FIFO cost and Economic Profit as limited; do not invent cost. |
| Merchant fee evidence missing | Do not overwrite historical revenue with an estimate. |
| Required source future-dated | Block the run and emit a data-quality alert. |

Overall data quality:

- `COMPLETE`: all required sources are usable.
- `LIMITED`: the Rule Engine can produce a subset of outputs with explicit limitations.
- `BLOCKED`: authoritative recommendations cannot be produced.

Every page and notification MUST show `as_of`, source cutoffs, and the overall quality status.

## 9. Evidence Chain Standard

### 9.1 Evidence item

Every evidence item MUST contain:

- `evidence_id`
- `source_key`
- `source_type`
- `source_record_locator`
- `observed_at`
- `cutoff_at`
- `event_time`
- `content_digest`
- `extraction_version`
- `classification`
- `redaction_status`
- `metadata`

Evidence MUST NOT contain:

- Supabase secrets.
- Cloudflare secrets.
- Private keys.
- Unnecessary personal or beneficiary data.
- Values fabricated to replace missing records.

### 9.2 Transformation chain

The ordered Evidence Chain MUST record:

1. `SOURCE_OBSERVED`
2. `INPUT_NORMALIZED`
3. `INPUT_VALIDATED`
4. `FRESHNESS_EVALUATED`
5. `RULESET_RESOLVED`
6. `RULE_CALCULATED`
7. `AI_EXPLAINED` when a future AI Layer is used
8. `RECOMMENDATION_SNAPSHOTTED`

Each transformation step MUST contain:

- Sequence number.
- Step type.
- Input evidence or result hashes.
- Rule or model version.
- Output hash.
- Timestamp.
- Warnings and limitations.

The final `evidence_chain_hash` MUST cover the ordered transformation chain. A user-visible amount or material claim MUST resolve to at least one Rule Engine result path and one source evidence ID.

## 10. Validation and Failure Contract

Hard failures:

- Contract version mismatch.
- Currency other than VND.
- Mode other than Shadow.
- Any Shadow Guard flag set to `true`.
- Invalid monetary string or non-finite amount.
- Reserve and settleable ratios inconsistent with the resolved ruleset.
- Missing ruleset version or digest.
- Required source future-dated beyond tolerance.
- Evidence digest mismatch.

Limited-result conditions:

- Missing or stale optional FX data.
- Incomplete FIFO inventory evidence.
- Partial data after the Account History cutoff.
- Missing merchant-specific context.
- Future AI Layer unavailable.

Errors MUST use stable codes, including:

- `CONTRACT_VERSION_UNSUPPORTED`
- `INPUT_VALIDATION_FAILED`
- `RULESET_NOT_RESOLVED`
- `RULESET_DIGEST_MISMATCH`
- `DATA_FRESHNESS_BLOCKED`
- `EVIDENCE_DIGEST_MISMATCH`
- `SHADOW_GUARD_VIOLATION`
- `AI_RULE_CONFLICT`

Error messages MUST NOT include secrets or raw sensitive data.

## 11. Contract Conformance Scenarios

Future implementation tests MUST cover:

1. Identical canonical inputs and ruleset produce identical Rule Engine results and hashes.
2. `multiplier = 2` is rejected or absent from every accepted input.
3. Gross, Reserve, and Settleable invariants are enforced.
4. Payout capacity uses Settleable balance.
5. Missing P2P preserves the VND shortfall but prevents a USDT topup amount.
6. Stale XE prevents a complete quote recommendation.
7. FIFO cost never uses a current rate to overwrite historical batch cost.
8. Positive and negative signed DCC values flow correctly into Cash Profit.
9. Cash Profit and Economic Profit are both present or explicitly limited.
10. AI output cannot alter a Rule Engine value.
11. A recommendation is append-only and supersession creates a new version.
12. Evidence hashes and transformation order are reproducible.
13. A future-dated required source blocks the run.
14. Every Shadow Guard execution flag remains `false`.
15. No approval, decision modification, decision deletion, or execution operation exists in the contract.

Task 3.1 does not add executable contract tests. The scenarios above are frozen acceptance criteria for later implementation tasks.

## 12. Compatibility With Existing VND Settlement OS

The V1 contract preserves existing concepts:

- `settlement_intelligence_snapshots.rules_version`
- `settlement_learning_recommendations.model_version`
- `settlement_learning_recommendations.system_payload`
- `settlement_learning_recommendations.data_cutoff_snapshot`
- Gross, Reserve, and Settleable balance layers
- FIFO actual Topup cost
- Cash Profit and Economic Profit
- Immutable Shadow Mode recommendation history
- All automatic-action flags set to `false`

Compatibility does not authorize reuse of the existing approval workflow in Task 3. Existing approval records remain historical evidence, but approval, modification, and deletion features are outside the Settlement Intelligence Engine V1 contract.

## 13. Task 3.1 Exit Criteria

Task 3.1 is complete when:

- Input and output envelopes are frozen.
- Rule Engine and AI Layer responsibilities are unambiguous.
- Recommendation identity, versioning, and immutability are defined.
- Ruleset resolution, versioning, and hashing are defined.
- Freshness states and degradation behavior are defined.
- Evidence Chain items and transformations are defined.
- Shadow Mode prohibitions are explicit.
- No code, migration, database change, deployment, AI model, approval flow, or execution capability is introduced.

Task 3.2 MUST begin from this frozen contract and MUST treat any contract change as an explicit design revision.
