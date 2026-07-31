# Task 3.4B — AI Provider Adapter & Validation Layer Design

## Document Control

- Status: DESIGN FOR REVIEW
- Implementation status: NOT STARTED
- Contract family: Settlement Intelligence Engine V1
- Upstream input: `SettlementInputSnapshotV1`
- Upstream calculation: `DeterministicCalculationResultV1`
- Recommendation framework: Task 3.4A
- AI input contract: `SETTLEMENT_AI_RECOMMENDATION_INPUT_V1`
- AI output contract: `SETTLEMENT_AI_RECOMMENDATION_OUTPUT_V1`
- Immutable snapshot contract: `AI_RECOMMENDATION_SNAPSHOT_V1`
- Currency scope: VND
- Mode: Shadow Mode only
- Database change: none
- Migration: none
- Deployment: none

This document designs the Task 3.4B provider boundary and validation
pipeline. It does not authorize implementation, model invocation,
persistence, deployment, approval workflow, or operational execution.

## 1. Goals and Non-goals

Task 3.4B will provide a server-only boundary between the frozen,
deterministic Settlement Intelligence contracts and a future AI provider.

The layer will:

1. Accept only a finalized `SETTLEMENT_AI_RECOMMENDATION_INPUT_V1`.
2. Resolve an exact immutable prompt version.
3. Resolve and record an exact model configuration.
4. Send only the approved, redacted fact projection to an AI provider.
5. Require strict structured output with tools disabled.
6. Validate every claim, value, path, evidence reference, limitation, and
   Shadow Guard constraint.
7. Build an immutable recommendation snapshot only after all validators pass.
8. Return explicit failure information without fabricating a recommendation.

The layer will not:

- Recalculate deterministic values.
- Read additional operational data.
- Write to Supabase or any business table.
- Create a migration or new database table.
- Generate an authoritative topup amount.
- Generate an authoritative customer quote.
- Trigger a topup, payment, quote change, trade, channel switch, or upload.
- Create approval, accept, modify, reject, or delete workflows.
- Deploy itself as part of Task 3.4B design.

## 2. Architecture

### 2.1 Component boundary

The proposed server-only pipeline is:

1. `RecommendationInputGate`
2. `PromptRegistry`
3. `ModelConfigurationResolver`
4. `AiProviderAdapter`
5. `ProviderPayloadParser`
6. `RecommendationOutputValidator`
7. `ConfidenceCalculator`
8. `EvidenceChainBuilder`
9. `ImmutableSnapshotAssembler`
10. `AppendOnlyHistoryValidator`

Each component has one direction of data flow. No component receives a
payment client, quote client, trading client, database write client, webhook
client, or approval service.

### 2.2 Trusted and untrusted zones

Trusted inputs:

- Finalized `SettlementInputSnapshotV1`.
- Finalized `DeterministicCalculationResultV1`.
- Finalized Task 3.4A AI input.
- Versioned prompt artifacts loaded from the application package.
- Server-side model configuration from an allowlist.

Untrusted inputs:

- All provider-generated text and structured output.
- Provider error bodies.
- Provider usage metadata until normalized.
- Human-authored text contained in upstream evidence.

Provider output remains untrusted until the complete validation pipeline
passes. Schema-valid output is not automatically evidence-valid or
Shadow-safe.

### 2.3 Provider-neutral adapter

The adapter contract will be provider-neutral. A provider implementation may
translate the normalized request into a provider SDK request, but it must
return one normalized result type.

The normalized request contains:

| Field | Requirement |
| --- | --- |
| `request_id` | Exact Task 3.4A AI request identity. |
| `prompt_bundle` | Exact resolved prompt version and content digests. |
| `model_config` | Exact allowlisted model and generation parameters. |
| `structured_input` | Finalized, redacted AI input projection. |
| `output_schema` | Exact provider-payload JSON schema. |
| `timeout_ms` | Explicit finite timeout. |
| `tool_policy` | Exactly `NO_TOOLS`. |
| `mode` | Exactly `SHADOW`. |

The normalized provider result is one of:

- `COMPLETED`
- `REFUSED`
- `TIMEOUT`
- `RATE_LIMITED`
- `PROVIDER_UNAVAILABLE`
- `PROVIDER_ERROR`
- `CANCELLED`

Only `COMPLETED` may proceed to payload parsing. It still does not imply an
accepted recommendation.

### 2.4 Two-stage output design

The model must not generate the final immutable recommendation envelope.

The provider may generate only a restricted
`AI_PROVIDER_GENERATED_PAYLOAD_V1` containing:

- Draft factual claims.
- Draft risk claims.
- Draft human-review-only recommendation items.
- Referenced deterministic paths.
- Referenced evidence IDs.
- Plain-language limitations.

The provider payload must not contain:

- Snapshot identity or version.
- `status`.
- `authoritative`.
- Prompt or model metadata.
- Confidence scores.
- Evidence-chain digests.
- Output digests.
- Shadow Guard values.
- Approval fields.
- Execution payloads.

These fields are created only by trusted application code after validation.
This prevents a model from granting authority, upgrading status, changing
lineage, or asserting that an action was executed.

## 3. Prompt Version Management

### 3.1 Versioned prompt bundle

Every prompt bundle consists of:

- System prompt.
- Developer prompt.
- User input template.
- Provider-output schema.
- Safety policy.
- Allowed-scope catalog.
- Language.

Every bundle has an immutable semantic version and the digests required by
`PromptContractReferenceSchema`.

The first implementation should use repository-controlled, versioned prompt
artifacts and a static server-side registry. No database table or migration is
needed for V1.

### 3.2 Resolution rules

- A run requests an exact prompt-contract version.
- The value `latest` is forbidden in stored or accepted run metadata.
- Missing versions block the request before any provider call.
- Digest mismatch blocks the request before any provider call.
- Prompt content is immutable after release.
- Any material text, schema, safety, scope, or language change requires a new
  semantic version.
- Rollback selects an older exact version; it does not rewrite a version.

### 3.3 Prompt construction rules

- Upstream facts are serialized as structured data, not concatenated as
  privileged instructions.
- Human-authored evidence text is clearly delimited as untrusted data.
- Provider secrets and environment variables never enter the prompt.
- Raw bank details, beneficiary data, credentials, and unnecessary personal
  data are excluded.
- The prompt explicitly states that missing facts remain missing.
- The prompt forbids new calculations, inferred rates, topup amounts, quote
  rates, approvals, and execution instructions.
- Private chain-of-thought is neither requested nor stored.
- The provider is instructed to return structured output only.

### 3.4 Prompt release verification

Before a prompt version is available to the adapter, automated checks should
verify:

- All required bundle parts exist.
- Digests match the registry.
- The output-schema digest matches the requested schema.
- The Shadow Mode policy is present.
- Tool use is disabled.
- Prohibited capability terms do not create execution instructions.
- Test fixtures for `COMPLETE`, `LIMITED`, and `BLOCKED` inputs are covered.

## 4. Model Version Recording

### 4.1 Server-side model allowlist

The model resolver accepts only a named server-side configuration from an
allowlist. Client input cannot select an arbitrary provider, model, endpoint,
deployment, tool, or generation parameter.

Each configuration records:

- Provider.
- Concrete model ID.
- Model revision when available.
- Deployment ID when applicable.
- Temperature.
- Top P.
- Maximum output tokens.
- Seed when supported.
- Structured-output mode, exactly `true`.
- Tool policy, exactly `NO_TOOLS`.
- Request timeout.

### 4.2 Per-run metadata

Every completed or failed provider attempt records normalized metadata:

- AI request ID.
- Provider.
- Concrete model ID and revision.
- Deployment ID.
- Provider request or response ID, when available.
- Generation start and completion times.
- Effective generation parameters.
- Input and output token counts, when available.
- Provider outcome.
- Retry attempt number.

Secrets, authorization headers, request signatures, raw environment values,
and provider API keys are never recorded.

### 4.3 Alias and fallback rules

- A provider alias must resolve to a concrete recorded model ID when the
  provider supports it.
- A model or material generation-parameter change requires a new
  recommendation version.
- V1 has no silent fallback model.
- A future fallback must be a separate provider attempt with separate model
  metadata and must produce a new validated snapshot version.

## 5. Output Schema Validation

### 5.1 Validation order

Validation must be fail-closed and run in this order:

1. Confirm provider outcome is `COMPLETED`.
2. Enforce response-size and content-type limits.
3. Parse exactly one structured JSON payload.
4. Reject unknown fields.
5. Validate `AI_PROVIDER_GENERATED_PAYLOAD_V1`.
6. Enforce count and string-length limits.
7. Verify every claim path against the approved fact projection.
8. Verify every monetary value as the exact upstream decimal string.
9. Verify every evidence ID is in the AI input evidence catalog.
10. Verify inherited limitations and blocking reasons remain visible.
11. Detect deterministic conflicts.
12. Reject executable, approval, or false execution-status language.
13. Calculate confidence deterministically.
14. Derive output status from upstream quality and validation results.
15. Inject trusted version, prompt, model, Shadow Guard, and lineage metadata.
16. Build and verify the evidence chain.
17. Compute the canonical output digest.
18. Validate append-only version linkage.

No later stage may repair or silently omit a failed material claim. Material
failure rejects the candidate output or, where the frozen contract permits,
returns only a data-quality explanation.

### 5.2 Exact value policy

- All money and rate values remain decimal strings.
- The provider must not calculate, round, reformat, convert, add, subtract,
  multiply, or divide authoritative values.
- A cited value must match the allowlisted upstream value byte-for-byte after
  schema parsing.
- Presentation formatting happens outside the stored structured value.
- A deterministic capacity gap must not be renamed as a recommended topup.
- Missing P2P, quote, FIFO, merchant, or cost data remains missing.

### 5.3 Status propagation

- `COMPLETE` input may produce `ACTIVE` only after all validations pass.
- `LIMITED` input can produce only `LIMITED_BY_DATA`; confidence caps and
  limitations are mandatory.
- `BLOCKED` input can produce only `BLOCKED_BY_DATA` data-quality output.
- Any schema, evidence, deterministic-conflict, executable-language, or
  Shadow Guard failure results in `REJECTED_BY_VALIDATION`.
- Provider failure produces no recommendation snapshot.

### 5.4 Confidence authority

The provider does not provide authoritative confidence.

Task 3.4A's deterministic confidence calculator remains authoritative for:

- Input quality.
- Evidence coverage.
- Freshness.
- Deterministic support.
- Schema validation.
- Required confidence caps.
- Final score and band.

Any model-supplied confidence field is an unknown field and is rejected.

## 6. Shadow Guard Validation

### 6.1 Required checks

Shadow Guard is checked:

1. Before the provider call, across both upstream contracts and the finalized
   AI input.
2. After provider payload validation and before snapshot assembly.
3. After final immutable snapshot assembly.

All required flags remain exactly `false`:

- `automatic_topup`
- `automatic_payment`
- `automatic_quote_change`
- `automatic_trading`
- `automatic_channel_switch`
- `third_party_submission`
- `approval_workflow`

Missing, unknown, or true values block or reject the run.

### 6.2 Capability isolation

The provider adapter runtime must not receive:

- Payment, banking, topup, exchange, or trading clients.
- Quote mutation functions.
- Channel-switching functions.
- Supabase service-role write clients.
- Payment-file generation or upload functions.
- Webhook, queue, scheduler, or command-execution tools.
- Approval workflow APIs.

Provider tool calling is disabled at both configuration and request levels.
The only permitted external call is the configured AI provider request using
the already redacted AI input.

### 6.3 Shadow Mode output labels

Every accepted presentation must include:

- `Shadow Mode`
- `AI-generated suggestion`
- `Human review only`
- `No action has been executed`
- Exact `as_of`
- Data-quality status
- Material limitations

These labels are trusted presentation metadata, not model-authored claims.

## 7. AI Failure Handling

### 7.1 Failure taxonomy

| Code | Meaning | Recommendation snapshot |
| --- | --- | --- |
| `AI_INPUT_CONTRACT_BLOCKED` | Upstream identity, evidence, or guard failed. | None |
| `PROMPT_VERSION_NOT_FOUND` | Exact prompt version is unavailable. | None |
| `PROMPT_DIGEST_MISMATCH` | Prompt artifact integrity failed. | None |
| `MODEL_CONFIG_NOT_ALLOWED` | Model configuration is outside the allowlist. | None |
| `AI_PROVIDER_TIMEOUT` | Provider exceeded the finite timeout. | None |
| `AI_PROVIDER_RATE_LIMITED` | Provider rate limit was returned. | None |
| `AI_PROVIDER_REFUSED` | Provider refused the request. | None |
| `AI_PROVIDER_UNAVAILABLE` | Provider could not serve the request. | None |
| `AI_PROVIDER_ERROR` | Other normalized provider failure. | None |
| `AI_OUTPUT_MALFORMED` | Response was not one strict JSON payload. | None |
| `AI_OUTPUT_SCHEMA_REJECTED` | Structured schema failed. | None |
| `AI_EVIDENCE_VALIDATION_REJECTED` | Evidence or exact-value checks failed. | Rejected candidate only |
| `AI_DETERMINISTIC_CONFLICT` | Output conflicts with authoritative calculation. | Rejected candidate only |
| `AI_SHADOW_GUARD_REJECTED` | Safety boundary failed. | Rejected candidate only |

The deterministic calculation remains available and unchanged after every AI
failure.

### 7.2 Retry policy

- No retry occurs for input, prompt, schema, evidence, conflict, refusal, or
  Shadow Guard failures.
- A bounded retry may be considered only for timeout, rate limit, or temporary
  provider unavailability.
- V1 should allow at most one transient retry.
- Retry uses the same finalized AI input, prompt version, model configuration,
  and tool-free policy.
- Each attempt receives separate timing and provider-request metadata.
- A retry must not silently switch models.
- Exhausted retries return a failure result, not fallback advice.

### 7.3 Failure records

Until persistence is separately authorized, Task 3.4B returns an in-memory,
non-financial run result. It does not create a database table.

A future append-only run record may store:

- Internal request ID.
- Upstream digests.
- Prompt and model versions.
- Normalized failure code.
- Attempt count and timings.
- Sanitized provider request ID.
- Safe error classification.

It must not store secrets, authorization headers, raw stack traces containing
environment values, private chain-of-thought, or an unvalidated provider
payload.

## 8. AI Output Safety Rules

### 8.1 Allowed output

AI may:

- Explain exact deterministic facts.
- Summarize evidence-backed risks.
- Repeat material data limitations.
- Prioritize supported items for human review.
- Suggest that an operator review funding or commercial conditions without
  specifying an invented transaction or quote.

### 8.2 Prohibited output

AI must not:

- State or imply that a topup, payment, quote change, trade, approval, or
  channel switch was submitted, approved, scheduled, or completed.
- Produce a new topup quantity, payment instruction, beneficiary detail,
  customer quote, exchange rate, cost, fee, or profit amount.
- Recalculate or reinterpret deterministic amounts.
- Invent missing evidence, market facts, dates, rates, or merchant state.
- Produce executable code, commands, links, signed payloads, files, or API
  requests.
- Ask for or expose credentials, secrets, tokens, or private keys.
- Create approval, acceptance, modification, rejection, or deletion actions.
- Request or expose private model reasoning.
- Introduce external news or web facts not already present in approved input
  evidence.

### 8.3 Content controls

The provider-payload schema should enforce:

- Plain text only for titles, statements, and human-review requests.
- Bounded item counts and string lengths.
- No HTML, scripts, embedded objects, or action URLs.
- No control characters or hidden payloads.
- Exact enumerations for scope, claim type, priority, and support status.
- No unknown fields.
- No provider-defined tool calls or attachments.

Executable-language detection is defense in depth. Evidence and schema
validation remain mandatory even when the text scan passes.

## 9. Runtime and Secret Boundary

Any future provider credential:

- Is a server-only runtime secret.
- Is never prefixed with `NEXT_PUBLIC_`.
- Is never included in client bundles, prompts, logs, snapshots, tests, or
  error messages.
- Is not read by Task 3.4A framework code.
- Is accessed only inside the concrete server-side provider adapter.

The adapter must not log the full structured input or raw provider output by
default. Logs use request IDs, digests, safe status codes, duration, and token
counts.

## 10. Proposed Implementation Units

Task 3.4B implementation should be divided into:

1. Provider-neutral request/result types.
2. Static versioned prompt registry and digest verification.
3. Server-only model configuration resolver.
4. One concrete provider adapter with tools disabled.
5. Restricted provider-payload schema.
6. Validation orchestrator using Task 3.4A validators.
7. Failure normalization and bounded transient retry.
8. Trusted immutable snapshot assembly.
9. Unit and contract tests.

No UI, persistence, migration, deployment, approval workflow, or execution
integration is included.

## 11. Test Plan for the Future Implementation

Required tests:

1. Exact prompt version resolves; `latest` and unknown versions fail.
2. Prompt digest mismatch blocks the provider call.
3. Non-allowlisted model configuration fails before the provider call.
4. Provider receives only the approved fact projection and safe metadata.
5. Tool policy is always `NO_TOOLS`.
6. Model cannot set status, authority, confidence, guards, or version metadata.
7. Unknown output fields fail strict schema validation.
8. Invented evidence IDs and paths fail.
9. Changed decimal strings fail exact-value validation.
10. `LIMITED` and `BLOCKED` statuses cannot be upgraded.
11. Required confidence caps are deterministic.
12. Executable and approval language is rejected.
13. Timeout, refusal, rate limit, malformed JSON, and provider errors create no
    recommendation snapshot.
14. Transient retry is bounded and never changes the model.
15. Secrets never appear in prompts, logs, snapshots, or errors.
16. Accepted snapshots have valid evidence-chain and output digests.
17. Append-only version validation prevents rewrite or deletion.
18. Input objects remain unchanged.
19. Static checks confirm no payment, topup, quote, trade, approval, database
    write, or deployment capability.

## 12. Design Decision

Task 3.4B will use a provider-neutral, server-only, fail-closed adapter. The AI
provider produces only an untrusted structured draft. Trusted deterministic
code owns identity, validation, confidence, status, lineage, Shadow Guard,
digest, and immutable versioning.

The design explicitly prohibits:

- Automatic topup.
- Automatic payment.
- Automatic quote modification.
- Automatic trading.
- Approval workflows.

No code implementation, migration, database change, provider call, secret
configuration, or deployment has been performed in this design stage. Task
3.4B implementation requires a separate explicit instruction.
