# Task 3.3 — Deterministic Calculation Engine Contract Freeze

## Document Control

- Status: FROZEN FOR TASK 3.3 DESIGN
- Contract family: Settlement Intelligence Engine V1
- Upstream input: `SETTLEMENT_INTELLIGENCE_INPUT_V1`
- Upstream snapshot implementation: `SettlementInputSnapshotV1`
- Calculation output: `SETTLEMENT_DETERMINISTIC_CALCULATION_OUTPUT_V1`
- Ruleset: `VND_DETERMINISTIC_CALCULATION_RULESET_V1.0.0`
- Currency scope: VND
- Rate direction: `VND_PER_USDT`
- Operating timezone: Asia/Shanghai
- Execution mode: Shadow Mode only

This document is normative. “MUST”, “MUST NOT”, “SHOULD”, and “MAY” define contract requirements.

## 1. Scope and Boundary

Task 3.3 freezes the calculation-only sub-contract between `SettlementInputSnapshotV1` and later Settlement Intelligence layers.

Task 3.3 MUST:

- Validate the supplied snapshot, ruleset identity, time boundary, data quality, and Shadow Guard.
- Calculate liquidity, FIFO inventory cost, Cash Profit, Economic Profit, FX comparison inputs, and business-rule bands deterministically.
- Return decimal-string results, calculation status, limitations, formula identifiers, and evidence references.
- Produce the same canonical result and result digest for the same canonical input, ruleset, and engine version.

Task 3.3 MUST NOT:

- Generate AI output or natural-language AI advice.
- Generate a topup recommendation, topup time, or suggested USDT amount.
- Generate a customer quote recommendation or proposed quote change.
- Create a recommendation snapshot.
- Create an approval, decision modification, or decision deletion record.
- Trigger a topup, payment, quote change, trade, channel switch, third-party submission, or any other execution.
- Read from or write to Supabase directly. Its only business input is the supplied immutable snapshot.
- Modify the input snapshot, inventory batch, source record, business data, or historical result.

The wider Task 3.1 contract describes capabilities that may exist in later engine layers. Task 3.3 implements only the authoritative deterministic calculation result. Recommendation assembly and AI explanation remain outside this contract.

## 2. Common Calculation Conventions

### 2.1 Determinism

- All authoritative arithmetic MUST use arbitrary-precision decimal arithmetic.
- Binary floating-point arithmetic MUST NOT be used for money, rates, ratios, thresholds, or comparisons.
- Input arrays whose order affects a result MUST use a documented stable ordering key.
- Current wall-clock time, random values, locale formatting, network state, and database state MUST NOT influence a calculation.
- `generated_at` and storage identifiers, if added by a later persistence layer, MUST be excluded from the deterministic result digest.
- A calculation MUST resolve one exact ruleset version and digest. An unresolved, unknown, or mismatched ruleset is `BLOCKED`.

### 2.2 Input authority

- `SettlementInputSnapshotV1` is the only business-data input.
- Every input record used MUST have an event or record time at or before the snapshot `as_of` boundary.
- A future-dated required input is invalid and MUST NOT be silently ignored or shifted backward.
- Source amounts MUST remain unchanged. Derived Gross, Reserve, and Settleable values are separate outputs.
- Missing data MUST remain `null`; zero MUST NOT be used to represent missing data.
- The engine MUST NOT infer a missing exchange rate, execution time, cost, fee, profit component, or account balance.

### 2.3 Evidence

Every material output MUST identify:

- Formula ID and formula version.
- Exact input field paths.
- Relevant evidence IDs.
- Ruleset version and digest.
- Output status and any limitation codes.

Evidence references MUST be inherited from the snapshot. Task 3.3 MUST NOT fabricate new source evidence.

## 3. Deterministic Calculation Output Contract

`SETTLEMENT_DETERMINISTIC_CALCULATION_OUTPUT_V1` MUST contain:

| Field | Type | Requirement |
| --- | --- | --- |
| `contract_version` | string | Exactly `SETTLEMENT_DETERMINISTIC_CALCULATION_OUTPUT_V1`. |
| `engine_version` | string | Exact deterministic implementation version. |
| `snapshot_id` | UUID | Copied from the input snapshot. |
| `request_id` | UUID | Copied from the input snapshot. |
| `input_digest` | string | Exact validated snapshot digest. |
| `ruleset_ref` | object | Exact ruleset code, version, and digest. |
| `as_of` | timestamp | Exact input boundary. |
| `currency` | string | Exactly `VND`. |
| `mode` | string | Exactly `SHADOW`. |
| `status` | enum | `COMPLETE`, `LIMITED`, or `BLOCKED`. |
| `liquidity_result` | object or null | Section result and status. |
| `fifo_cost_result` | object or null | Section result and status. |
| `profit_result` | object or null | Section result and status. |
| `fx_result` | object or null | Section result and status. |
| `business_rule_result` | object or null | Threshold-band evaluations only. |
| `formula_results` | array | Formula ID, inputs, output, precision, status, and evidence references. |
| `limitations` | array | Stable limitation codes and affected output paths. |
| `blocking_reasons` | array | Stable blocking codes and affected output paths. |
| `result_digest` | string | SHA-256 digest of the canonical calculation result. |
| `shadow_guard` | object | Every execution capability is `false`. |

Each result section MUST contain its own `status`, `limitations`, and `evidence_ids`. A section with no authoritative value because of missing or invalid data MUST return `null` for the affected values, not zero.

The output MUST NOT contain fields named or semantically equivalent to:

- `recommendation`
- `recommended_topup`
- `recommended_topup_time`
- `recommended_quote`
- `approval`
- `execution`
- `payment_instruction`
- `trade_instruction`

## 4. Liquidity Calculation Contract

### 4.1 Balance invariants

Frozen formulas:

- `reserve_balance_vnd = gross_balance_vnd × reserve_ratio`
- `settleable_balance_vnd = gross_balance_vnd × settleable_ratio`
- `reserve_ratio = 0.50`
- `settleable_ratio = 0.50`
- `reserve_ratio + settleable_ratio = 1.00`

The engine MUST verify the supplied snapshot balance against these formulas within the frozen rounding tolerance. A mismatch MUST be reported; the source balance MUST NOT be overwritten.

The legacy `multiplier = 2` MUST NOT exist in any Task 3.3 input interpretation, formula, output, or evidence explanation.

Payout capacity MUST use Settleable balance. Gross balance is never fully available for Payout settlement.

### 4.2 Forecast flow transformation

Payin and Payout forecast inputs are Gross account movements. The engine MUST derive:

- `forecast_settleable_payin_vnd = forecast_gross_payin_vnd × 0.50`
- `forecast_settleable_payout_vnd = forecast_gross_payout_vnd × 0.50`
- `gross_net_flow_vnd = forecast_gross_payin_vnd - forecast_gross_payout_vnd`
- `gross_net_demand_vnd = max(forecast_gross_payout_vnd - forecast_gross_payin_vnd, 0)`
- `settleable_net_flow_vnd = forecast_settleable_payin_vnd - forecast_settleable_payout_vnd`
- `settleable_net_demand_vnd = max(forecast_settleable_payout_vnd - forecast_settleable_payin_vnd, 0)`

Payin MUST NOT be deducted twice. Once it is included in `settleable_net_demand_vnd`, it MUST NOT be deducted again from the resulting capacity requirement.

Matched internal transfer debit and credit MUST net to zero in both Gross and Settleable calculations.

### 4.3 Safety buffer and capacity gap

The 10% safety buffer is frozen against positive Settleable net demand:

- `safety_buffer_vnd = settleable_net_demand_vnd × 0.10`
- `required_opening_settleable_capacity_vnd = settleable_net_demand_vnd + safety_buffer_vnd`
- `settleable_capacity_gap_vnd = max(required_opening_settleable_capacity_vnd - current_settleable_balance_vnd, 0)`
- `projected_settleable_after_flows_vnd = current_settleable_balance_vnd + forecast_settleable_payin_vnd - forecast_settleable_payout_vnd`
- `gross_capacity_gap_equivalent_vnd = settleable_capacity_gap_vnd ÷ settleable_ratio`

`gross_capacity_gap_equivalent_vnd` is a mathematical capacity-gap equivalent only. It MUST NOT be labelled or exposed as a topup recommendation.

### 4.4 Forecast limitations

- The existing forecast input is a historical hourly average baseline, not a proven future-demand model.
- Aggregated inflow and outflow do not establish intrahorizon event order. A positive aggregate ending balance does not prove that every intermediate Payout can be funded.
- The `16:00-23:00` local peak window MAY be calculated as a separate pressure horizon, but remains a deterministic baseline calculation.
- Any result based on incomplete hourly coverage MUST be `LIMITED`.

## 5. FIFO Cost Calculation Contract

### 5.1 Inventory layer

- FIFO inventory is maintained on the Gross VND inventory layer.
- A Payout inventory-consumption request uses the actual Gross VND outflow.
- The 50% Settleable ratio is a payment-capacity rule and MUST NOT halve FIFO inventory consumption or historical batch cost.
- Current P2P, XE, upstream, or customer rates MUST NOT overwrite historical batch cost rates.
- Calculation MUST NOT mutate `remaining_amount` in any input batch.

### 5.2 Batch eligibility and stable order

Only batches satisfying all of the following are eligible:

- Batch date or exact time is at or before `as_of`.
- Historical cost is locked.
- Cost rate is positive.
- Remaining VND amount is positive.
- Batch is in an eligible inventory status under the exact ruleset.

Frozen FIFO ordering:

1. `batch_date` ascending.
2. Exact `batch_time` ascending when an exact time exists.
3. Immutable `sequence_within_date` or equivalent `fifo_sequence_key` ascending.
4. Stable batch ID ascending only as a final deterministic tie-breaker after the business sequence is known.

A batch ID MUST NOT be used to invent the business order of otherwise ambiguous `DATE_ONLY` batches.

### 5.3 Allocation formulas

For each eligible batch:

- `consumed_vnd = min(batch_remaining_vnd, remaining_requested_vnd)`
- `cost_basis_usdt = consumed_vnd ÷ batch_cost_rate_vnd_per_usdt`
- `remaining_requested_vnd = remaining_requested_vnd - consumed_vnd`

Aggregate formulas:

- `allocated_vnd = sum(consumed_vnd)`
- `unallocated_vnd = requested_consumption_vnd - allocated_vnd`
- `fifo_cost_basis_usdt = sum(cost_basis_usdt)`
- `weighted_fifo_cost_rate = allocated_vnd ÷ fifo_cost_basis_usdt`, when cost basis is positive

Inventory shortage MUST be explicit. `unallocated_vnd` MUST NOT be silently priced with a current market rate.

### 5.4 DATE_ONLY ordering limitation

`DATE_ONLY` inputs MUST NOT receive an invented timestamp.

When multiple same-date `DATE_ONLY` batches lack an immutable business sequence:

- If their order can change which batch is partially consumed or change the calculated cost, the affected FIFO allocation and cost are not authoritative and MUST be `LIMITED`.
- If the missing order prevents any defensible allocation, the FIFO section MUST be `BLOCKED`.
- If all ambiguous batches are fully consumed and the aggregate numeric cost is order-independent, the aggregate MAY be returned as `LIMITED`, but batch-level allocation order MUST remain unresolved.

The current `SettlementInputSnapshotV1` batch shape does not retain `sequence_within_date`. The implementation phase MUST resolve this contract gap without inventing time and without requiring a database migration.

### 5.5 Historical inventory limitation

The current inventory-position source represents current remaining positions and is not fully historically versioned. Therefore:

- A historical `as_of` FIFO calculation MUST NOT claim complete reconstruction solely from the current position view.
- If historical remaining quantities cannot be proven at `as_of`, the FIFO result is at least `LIMITED`.
- If the requested allocation depends materially on an unprovable historical remaining quantity, the affected FIFO cost is `BLOCKED`.

## 6. Cash Profit and Economic Profit Contract

### 6.1 Signed component convention

- Revenue and realized advantage are positive.
- Fees, costs, and risk costs are supplied as non-negative deductions unless a field explicitly uses a signed convention.
- `signed_dcc_revenue_usdt` is positive when DCC creates company revenue and negative when DCC represents a discount or company-borne cost.
- `signed_internal_funding_advantage_usdt` is positive for an advantage and negative for a disadvantage.

### 6.2 Cash Profit

Frozen formula:

`cash_profit_usdt = merchant_fee_revenue_usdt + signed_dcc_revenue_usdt + realized_fx_profit_usdt - channel_fees_usdt - other_actual_fees_usdt`

Cash Profit is the financial cash view. Positive DCC increases Cash Profit; negative DCC reduces it.

Historical merchant fee revenue MUST use actual source `merchant_fee_usdt` values when available. It MUST NOT be reconstructed from a fee rate.

### 6.3 Economic Profit

Frozen formula:

`economic_profit_usdt = cash_profit_usdt + signed_internal_funding_advantage_usdt - shadow_cost_usdt - opportunity_cost_usdt - unrealized_risk_cost_usdt`

Economic Profit is the management and learning view. It MUST be calculated and returned together with Cash Profit; one MUST NOT replace the other.

### 6.4 Cost-basis integration and reconciliation

- A realized FX component derived from FIFO MUST reference the FIFO formula result and evidence chain.
- The same FIFO-derived value MUST NOT be counted again as both `realized_fx_profit_usdt` and `shadow_cost_usdt`.
- Exactly one authoritative derivation path MUST be recorded for each profit component.
- If the snapshot contains precomputed Cash or Economic Profit, Task 3.3 MUST independently recompute it from available components and return the difference as a reconciliation value.
- A non-zero reconciliation difference MUST be reported with its precision and source paths; source history MUST NOT be overwritten.

### 6.5 Profit margins

When merchant principal is positive:

- `cash_profit_margin = cash_profit_usdt ÷ merchant_principal_usdt`
- `economic_profit_margin = economic_profit_usdt ÷ merchant_principal_usdt`

When merchant principal is zero or missing, the affected margin is `null`, never zero.

## 7. FX Calculation Contract

### 7.1 Rate selection

- Every rate is expressed as VND per USDT.
- Only rate records at or before `as_of` are eligible.
- For multiple eligible P2P inputs, the latest `record_time` is selected; an immutable rate ID is the deterministic tie-breaker.
- Manually entered P2P and upstream rates MUST retain operator, source, and record time evidence.
- Missing rates remain `null`.

### 7.2 Comparison inputs

Task 3.3 MUST calculate only the available raw comparison inputs:

- `p2p_minus_xe = p2p_cost_rate - xe_rate`
- `p2p_vs_xe_ratio = (p2p_cost_rate - xe_rate) ÷ xe_rate`
- `upstream_minus_xe = upstream_quote_rate - xe_rate`
- `upstream_vs_xe_ratio = (upstream_quote_rate - xe_rate) ÷ xe_rate`
- `fifo_minus_xe = weighted_fifo_cost_rate - xe_rate`
- `fifo_vs_xe_ratio = (weighted_fifo_cost_rate - xe_rate) ÷ xe_rate`
- `p2p_minus_fifo = p2p_cost_rate - weighted_fifo_cost_rate`
- `p2p_vs_fifo_ratio = (p2p_cost_rate - weighted_fifo_cost_rate) ÷ weighted_fifo_cost_rate`
- `customer_quote_minus_fifo = current_customer_quote_rate - weighted_fifo_cost_rate`
- `customer_quote_vs_fifo_ratio = (current_customer_quote_rate - weighted_fifo_cost_rate) ÷ weighted_fifo_cost_rate`

The operand order MUST be included in each formula ID and output name. Because the business meaning of a positive spread depends on the transaction side, Task 3.3 MUST NOT convert a spread sign into an opportunity recommendation.

### 7.3 FX classification deferral

Task 3.3 does not freeze BUY, NORMAL, or RISK classification thresholds.

The output classification MUST be `NOT_EVALUATED`. `BUY_VND_OPPORTUNITY`, `NORMAL`, `RISK`, quote changes, and trading actions are deferred to a separately reviewed later contract.

Missing XE, P2P, upstream, current customer quote, or FIFO rate limits only the comparisons that depend on that rate. No substitute rate may be inferred.

## 8. Business Rules Contract

The following rules are frozen:

| Rule | Value | Deterministic use |
| --- | --- | --- |
| Reserve ratio | `0.50` | Gross balance locked as reserve. |
| Settleable ratio | `0.50` | Gross balance available for settlement capacity. |
| Liquidity safety buffer | `0.10` | Applied to positive forecast Settleable net demand. |
| Minimum margin | `0.002` | Market protection line. |
| Target margin | `0.005` | Target line. |
| FIFO method | `FIFO_ACTUAL_TOPUP_V1` | Historical inventory cost. |
| Rate direction | `VND_PER_USDT` | All FX comparisons. |
| Peak window | `16:00-23:00` | Asia/Shanghai liquidity pressure window. |
| Mode | `SHADOW` | Calculation and observation only. |

Margin bands are evaluated separately for Cash Profit margin and Economic Profit margin:

- Margin below `0.002`: `BELOW_PROTECTION`
- Margin at least `0.002` and below `0.005`: `BETWEEN_PROTECTION_AND_TARGET`
- Margin at least `0.005`: `AT_OR_ABOVE_TARGET`
- Missing or invalid denominator: `NOT_EVALUATED`

A margin band is a factual threshold result, not a quote recommendation.

Changing a formula, threshold, input basis, rounding rule, missing-data rule, or propagation rule requires a new ruleset semantic version and digest.

## 9. Decimal Precision and Rounding Rules

### 9.1 Arithmetic

- Decimal arithmetic context precision: 40 significant digits.
- Rounding mode: `ROUND_HALF_UP`.
- Intermediate calculations MUST retain full available precision.
- Rounding MUST occur only when serializing an authoritative output field.
- Repeated step-by-step rounding is prohibited.

### 9.2 Canonical output scales

| Value class | Canonical scale |
| --- | --- |
| Source amounts | Preserve the exact source decimal string in evidence. |
| Derived VND amounts | 4 decimal places. |
| Derived USDT amounts and profit components | 12 decimal places. |
| Exchange rates | 12 decimal places. |
| Ratios and margins | 12 decimal places. |
| Counts | Base-10 integer strings. |

Derived VND uses 4 decimal places so a 50% transformation of a two-decimal Gross value does not lose precision. Presentation layers MAY display fewer decimals but MUST NOT alter the authoritative value.

Additional rules:

- Canonical output MUST use plain base-10 notation, not scientific notation.
- Canonical zero MUST be positive; negative zero MUST normalize to zero at the field scale.
- Percentages MUST be stored as ratios: `0.002`, not `0.2`.
- Division by zero MUST return `null` for the affected result and a limitation or blocking code. It MUST NOT return zero, infinity, or NaN.
- The result digest MUST be calculated from canonical decimal strings.

## 10. Missing Data Handling

### 10.1 General rules

- Missing, unavailable, invalid, stale-beyond-policy, or future-dated data MUST NOT be replaced by zero or an estimate.
- A legitimate zero requires source evidence or an explicit `NOT_APPLICABLE` status.
- A missing component affects only dependent formulas unless it is a global contract requirement.
- Partial arithmetic MUST NOT be presented as a complete total.
- Error and limitation messages MUST contain stable codes and field paths, not secrets or raw credentials.

### 10.2 Required behavior by dependency

| Condition | Required behavior |
| --- | --- |
| Missing or invalid snapshot identity, digest, ruleset, currency, mode, or `as_of` | Entire calculation `BLOCKED`. |
| Missing or invalid Shadow Guard | Entire calculation `BLOCKED`. |
| Missing Gross/Settleable balance | Liquidity section `BLOCKED`; overall result `BLOCKED`. |
| Missing liquidity forecast | Liquidity forecast outputs `LIMITED` or `BLOCKED`; current balance invariants may still be returned. |
| Missing inventory batches or unprovable remaining position | FIFO `LIMITED` or `BLOCKED`; dependent cost and Economic Profit fields become at least `LIMITED`. |
| Missing actual profit component | Dependent Cash/Economic total is `LIMITED` with a `null` authoritative total unless explicitly `NOT_APPLICABLE`. |
| Missing XE or P2P | Dependent FX comparisons `null`; FX section `LIMITED`. |
| Missing upstream or customer quote | Only dependent comparisons `null`; FX section `LIMITED`. |
| Future-dated required source | Affected section `BLOCKED`; entire calculation `BLOCKED` when the source is required globally. |
| Stale source | Apply the exact snapshot/ruleset freshness policy and list affected outputs. |

## 11. LIMITED and BLOCKED Propagation

Status severity is ordered:

`COMPLETE < LIMITED < BLOCKED`

Propagation rules:

1. Task 3.3 MUST NOT upgrade the input snapshot quality. A `LIMITED` input cannot produce an overall `COMPLETE` result; a `BLOCKED` input produces an overall `BLOCKED` result.
2. Each section computes its own status from its dependencies.
3. A formula inherits the highest severity of its required inputs.
4. A downstream formula inherits the highest severity of its upstream formula results.
5. The overall result is the highest severity among the input snapshot and required Task 3.3 sections.
6. Independent diagnostic values MAY be returned from usable inputs during a `LIMITED` or `BLOCKED` run, but MUST be labelled non-authoritative when blocked.
7. `BLOCKED` values MUST NOT be consumed by later recommendation, AI, UI action, notification-action, or execution layers.
8. Every propagated limitation or block MUST retain its originating source, affected field path, and evidence references.

Examples:

- Missing P2P does not block Gross/Settleable arithmetic, but makes P2P-dependent FX comparisons `LIMITED`.
- Unprovable FIFO history makes FIFO cost and dependent Economic Profit at least `LIMITED`; it does not change the source Cash Profit.
- A true execution flag in the Shadow Guard blocks the entire calculation even if all financial data is complete.

## 12. Shadow Guard Constraints

The input and output Shadow Guard MUST contain exactly false execution capabilities:

- `automatic_topup: false`
- `automatic_payment: false`
- `automatic_quote_change: false`
- `automatic_trading: false`
- `automatic_channel_switch: false`
- `third_party_submission: false`

Task 3.3 MUST be a pure calculation boundary:

- No database client.
- No network client.
- No file export for payment or topup.
- No queue, webhook, scheduler, email, Lark, or third-party submission.
- No AI model invocation.
- No recommendation persistence.
- No approval workflow.
- No operational side effects.

Any missing, unknown, or true Shadow Guard execution flag is a hard contract failure and makes the calculation `BLOCKED`.

## 13. Known Limitations

### 13.1 DATE_ONLY FIFO ordering

`SettlementInputSnapshotV1` currently omits an immutable same-day FIFO sequence. Multiple `DATE_ONLY` batches may therefore be ambiguous. Task 3.3 cannot invent execution times or use arbitrary IDs as business order.

### 13.2 Historical inventory reconstruction

The current inventory position is not fully historically versioned. Past remaining batch positions cannot always be reconstructed as of an earlier snapshot time. Historical FIFO results must be limited or blocked according to materiality.

### 13.3 Historical merchant-state versioning

Merchant context currently relies on latest-run state in parts of the read model. A historical `as_of` snapshot may not reproduce the exact merchant tier, quote, contribution, or margin state that existed at that time.

### 13.4 FX classification deferred

Task 3.3 calculates comparable FX inputs and spreads only. Opportunity classification thresholds and BUY/NORMAL/RISK judgments are not frozen and remain outside this contract.

### 13.5 Forecast interpretation

The current liquidity forecast is a historical-average baseline. It does not prove the order of future inflows and outflows and must not be described as a guaranteed funding outcome.

## 14. Freeze Decision

Task 3.3 is frozen as an immutable-input, deterministic, calculation-only engine contract.

It produces authoritative arithmetic only when evidence and data quality permit. It produces no AI advice, no topup advice, no quote advice, no approval, and no execution instruction.

Implementation is explicitly outside this document task and requires a separate authorization.
