# Task 3.4C — Controlled AI Provider Connection Design

## Document Control

- Status: DESIGN FROZEN FOR CONTROLLED CONNECTION
- Contract family: Settlement Intelligence Engine V1
- Upstream contracts:
  - `SettlementInputSnapshotV1`
  - `DeterministicCalculationResultV1`
  - `SETTLEMENT_AI_RECOMMENDATION_INPUT_V1`
- Runtime contract: `AI_PROVIDER_RUNTIME_V1`
- Validation contract: `AI_PROVIDER_VALIDATION_RESULT_V1`
- Draft contract: `AI_PROVIDER_GENERATED_PAYLOAD_V1`
- Future immutable output: `AI_RECOMMENDATION_SNAPSHOT_V1`
- Currency scope: VND
- Runtime mode: Human-triggered Shadow Mode only
- Real AI provider connection: NOT ENABLED
- Automatic scheduling: NOT ENABLED
- Database change: none
- Migration: none
- Deployment: none

This document defines how a future real AI provider may be connected to the
existing provider-neutral runtime without granting the model operational
authority. It does not authorize implementation, credential creation,
provider invocation, persistence, migration, deployment, or automatic
execution.

Normative terms such as MUST, MUST NOT, SHOULD, and MAY describe the controls
required for a later implementation.

## 1. Goals and Authority Boundary

Task 3.4C designs a controlled, server-only connection from the existing
`AI_PROVIDER_RUNTIME_V1` to one allowlisted AI provider configuration.

The connection MAY be used only to:

- Explain finalized deterministic facts.
- Summarize evidence-backed risks and data limitations.
- Produce structured, non-authoritative suggestions for human review.
- Record provider, model, prompt, timing, and token metadata.

The connection MUST NOT:

- Read operational data beyond the finalized AI input projection.
- Recalculate or replace deterministic values.
- Invent missing amounts, rates, dates, costs, merchant status, or evidence.
- Generate an authoritative topup amount or customer quote.
- Submit a topup, payment, quote change, trade, channel switch, or file.
- Create approval, accept, modify, reject, or delete workflows.
- Run on a schedule, event, webhook, queue, or unattended background trigger.
- Receive a database write client or any financial execution client.

The deterministic result remains authoritative. AI output is untrusted until
all Task 3.4B validation stages pass. A valid provider response is still only a
Shadow Mode draft.

## 2. Controlled Provider Architecture

### 2.1 Server-only component flow

A future connection MUST follow this one-way flow:

1. An authenticated human requests one Shadow analysis run.
2. `HumanTriggerGate` verifies identity, role, request scope, rate limit, and
   idempotency.
3. `RecommendationInputGate` accepts one finalized
   `SETTLEMENT_AI_RECOMMENDATION_INPUT_V1` and verifies its digest.
4. `OutboundProjectionBuilder` constructs a new field-allowlisted provider
   payload. It never forwards the unrestricted source object.
5. `RedactionAndLeakageGate` rejects secrets, prohibited personal data,
   beneficiary data, unknown fields, and post-`as_of` values.
6. `PromptVersionLoader` resolves one exact immutable prompt version and
   verifies every digest.
7. `ModelAllowlistResolver` resolves one exact provider and model
   configuration. Client input cannot select it.
8. A concrete server-only adapter translates the normalized request to the
   selected provider format with tools disabled.
9. `AI_PROVIDER_RUNTIME_V1` captures normalized timing, model, outcome, and
   token metadata.
10. The existing Validation Layer treats the provider response as untrusted
    and fails closed on any schema, evidence, decimal, restriction-language,
    or Shadow Guard violation.
11. Only an accepted validated draft MAY enter the trusted Recommendation
    Snapshot assembly flow.
12. The UI presents the result as `Shadow Mode`, `AI-generated suggestion`,
    `Human review only`, and `No action has been executed`.

No component in this path receives payment, topup, quote mutation, trading,
channel switching, third-party submission, approval, or database mutation
capabilities.

### 2.2 Trust zones

Trusted application artifacts:

- Finalized AI input and its digest.
- Finalized deterministic result references.
- Repository-controlled prompt artifacts and digests.
- Server-side model allowlist.
- Existing schema, evidence, decimal, language, and Shadow Guard validators.
- Trusted Snapshot identity, confidence, lineage, and digest builders.

Untrusted data:

- All provider output, including structured JSON.
- Provider error bodies and headers.
- Provider usage fields until normalized.
- Human-authored market notes carried in approved evidence.
- Any client-supplied provider, model, prompt, endpoint, or generation option.

Untrusted data never becomes an accepted Snapshot merely because it is valid
JSON or was returned by an allowlisted provider.

### 2.3 Network boundary

The future concrete adapter MAY connect only to the exact allowlisted HTTPS
provider endpoint. It MUST NOT:

- Accept an endpoint URL from a client request.
- Follow redirects to a different host.
- Use provider tool calling, browsing, code execution, file retrieval, or
  remote MCP tools.
- Upload source files or attachments.
- Make secondary network requests based on model output.
- Send requests from client-side code.

Outbound calls MUST have a finite timeout, bounded body size, TLS validation,
and sanitized failure handling. Provider-specific SDK objects must remain
behind the provider-neutral adapter interface.

## 3. Data Redaction and Allowed Outbound Fields

### 3.1 Data-minimization rule

The provider receives a purpose-built projection, not the original
`SettlementInputSnapshotV1`, database rows, source files, or unrestricted
`DeterministicCalculationResultV1`.

Every outbound field must satisfy all of the following:

1. It is explicitly present in the allowlist below.
2. It is required for one requested explanation or review scope.
3. It is valid at or before the exact `as_of` boundary.
4. It has passed upstream contract and evidence validation.
5. It contains no secret, credential, beneficiary detail, or unnecessary
   personal data.

Unknown fields fail closed. The projection builder must not use an exclusion
list as its primary control.

### 3.2 Always-allowed metadata

The following metadata MAY be sent:

- AI request ID and adapter request ID.
- Currency, operating timezone, mode, and exact `as_of`.
- Input Snapshot contract version, ID, digest, and quality status.
- Deterministic calculation contract, engine, ruleset, and result digests.
- Requested recommendation scopes.
- Presentation language, audience category, and output style.
- Exact prompt and provider-draft schema references.
- Material limitations and blocking reason codes.
- Shadow Guard flags, all exactly `false`.

### 3.3 Allowed deterministic facts

Only fields already present in the finalized `approved_fact_projection` MAY
be sent. Depending on the requested scope, these may include:

- Gross, Reserve, and Settleable balances and ratios.
- Forecast Payin, Payout, net demand, safety buffer, and capacity gap.
- FIFO allocation status, aggregate cost basis, weighted cost rate, and
  inventory limitation codes.
- Cash Profit and Economic Profit values and margins.
- XE, P2P, upstream, customer, and FIFO rates when present and supported.
- Deterministic FX spread values.
- Frozen minimum and target margin bands.
- Freshness, completeness, source cutoffs, and data-quality status.
- Redacted merchant category or stable pseudonymous merchant reference when a
  merchant-scoped explanation is necessary.

Every fact retains its exact decimal string, source path, unit, status,
evidence IDs, and limitations. Numeric values MUST NOT be rounded, converted,
or reformatted for the provider.

### 3.4 Allowed evidence metadata

The provider MAY receive only the evidence catalog fields already approved by
the AI input contract:

- Evidence ID.
- Source key or redacted source category.
- Content digest.
- Observed time and cutoff time.
- Freshness, completeness, and redaction status.

Raw evidence contents are excluded by default. A human-authored market note
may be included only when it is already an approved, redacted upstream fact
and is clearly delimited as untrusted reference data rather than an
instruction.

### 3.5 Prohibited outbound data

The following MUST NOT be sent:

- Provider, Supabase, Cloudflare, GitHub, Lark, or other secrets.
- Environment variables, authorization headers, cookies, session tokens,
  private keys, connection strings, or signed URLs.
- Bank account, beneficiary, wallet, payment-file, or payout execution data.
- Raw merchant names when a stable pseudonym or category is sufficient.
- Email addresses, phone numbers, personal names, IP addresses, device IDs,
  or unnecessary user identifiers.
- Raw Excel files, account-history exports, database dumps, or unbounded logs.
- Source rows after `as_of`.
- Unvalidated free-form instructions embedded in source data.
- Internal endpoints, infrastructure topology, stack traces, or secret names
  whose disclosure is unnecessary.
- Approval fields, execution payloads, or external action URLs.

### 3.6 Redaction and leakage gates

Before a provider call, the application MUST:

1. Build the strict allowlisted projection.
2. Reject unknown fields and unsupported scopes.
3. Verify all source paths and evidence IDs against finalized input.
4. Verify exact decimal strings and time boundaries.
5. Apply deterministic secret-pattern and prohibited-data checks.
6. Enforce field count, array count, string length, and total byte limits.
7. Canonicalize the payload and calculate an outbound digest.
8. Record only the digest and safe metadata in logs.

The raw outbound payload SHOULD NOT be logged. Tests and snapshots MUST use
synthetic fixtures only.

## 4. Secret Management Strategy

### 4.1 Secret location

A future provider credential MUST be stored only as a server-side runtime
secret in the production execution environment.

It MUST:

- Never use a `NEXT_PUBLIC_` prefix.
- Never be committed to Git or stored in a prompt artifact.
- Never enter a client bundle, API response, log, test snapshot, exception,
  recommendation Snapshot, or evidence chain.
- Be read only inside the concrete server-side provider adapter.
- Be unavailable to Recommendation Framework, deterministic calculation,
  browser code, and presentation components.

The design uses a logical secret reference such as
`AI_PROVIDER_CREDENTIAL_REF`; the model allowlist stores the reference name,
not the secret value. A concrete environment variable name will be selected
only during a separately approved provider implementation.

### 4.2 Environment separation

- Development, test, preview, and production use separate credentials.
- Offline tests use no credential and no network.
- A preview credential must not have production billing or data privileges.
- Production secrets are configured outside the repository.
- Secret presence checks may report only `configured` or `missing`.

### 4.3 Rotation and revocation

- Credentials must be individually revocable and scoped to the selected AI
  service only.
- Rotation creates a new secret version without changing historical run
  metadata.
- Logs record only a non-secret credential version label or fingerprint
  supplied by configuration.
- Suspected exposure immediately disables the Provider Runtime kill switch;
  deterministic dashboards remain available.

### 4.4 Logging rules

Logs MAY include request IDs, digests, provider and model IDs, safe status
codes, duration, and token counts. Logs MUST NOT include the credential, full
prompt payload, raw provider response, provider error body, authorization
header, environment dump, or private model reasoning.

## 5. Model Allowlist and Version Recording

### 5.1 Server-side allowlist

The allowlist is repository-controlled or supplied by immutable server-side
configuration. Each entry records:

- Configuration ID and configuration version.
- Provider identifier.
- Exact model ID.
- Model revision or snapshot ID when exposed.
- Deployment ID when applicable.
- Exact allowlisted endpoint identity.
- Structured-output support, exactly `true`.
- Tool policy, exactly `NO_TOOLS`.
- Temperature, top P, maximum output tokens, and seed when supported.
- Finite timeout.
- Allowed prompt-contract versions.
- Allowed provider-draft schema versions.
- Shadow Mode, exactly `true`.
- Status: `TEST_ONLY`, `ENABLED_FOR_HUMAN_TRIGGER`, or `DISABLED`.

The client cannot provide or override provider, model, endpoint, deployment,
prompt, tool policy, or generation parameters.

### 5.2 Alias resolution

Provider aliases such as `latest` are forbidden in immutable run metadata.
When a provider API accepts an alias, the adapter must capture the concrete
model or deployment revision returned by the provider. If the concrete
revision cannot be identified, the run is marked with an explicit limitation
and cannot claim reproducibility.

There is no silent model fallback. A different model requires a separate
allowlist entry and a separate run attempt with its own metadata.

### 5.3 Per-attempt metadata

Every provider attempt records normalized, non-secret metadata:

- AI request ID and adapter request ID.
- Attempt number.
- Provider, model ID, model revision, and deployment ID.
- Configuration ID and version.
- Prompt contract, prompt bundle, and schema versions and digests.
- Provider request ID when safely available.
- Generation start and completion times.
- Effective generation parameters.
- Provider outcome and sanitized failure code.
- Input, output, and total token usage when provided.
- Data-quality status, `as_of`, and Shadow Mode.

Changing a model, material parameter, prompt, schema, upstream digest, or
ruleset produces a distinct run identity and, if accepted, a new immutable
recommendation version.

## 6. Token and Cost Control

### 6.1 Hard limits

The future connection MUST define server-side limits for:

- Maximum serialized input bytes.
- Maximum estimated input tokens.
- Maximum output tokens.
- Maximum facts, claims, evidence references, and recommendation items.
- Maximum provider attempts per human trigger.
- Maximum human-triggered runs per operator and time window.
- Maximum daily token and estimated-cost budget per environment.

A request exceeding an input, output, rate, or daily budget limit fails before
the provider call. The client cannot raise these limits.

### 6.2 Token estimation and capture

- Preflight token estimation is a conservative admission control, not billing
  truth.
- Actual provider-reported input and output token counts are normalized by the
  existing Runtime.
- Missing usage remains `UNAVAILABLE`; partial usage remains `PARTIAL`.
- The application MUST NOT fabricate missing token counts.
- Token usage metadata is separate from financial settlement calculations and
  cannot alter Cash Profit or Economic Profit.

### 6.3 Cost metadata

Estimated AI cost MAY be calculated for operational monitoring only from a
versioned pricing configuration with currency, effective time, source, and
input/output unit prices. Provider prices must never be hardcoded into an
immutable historical run without a version and effective date.

An unavailable or stale price produces `COST_UNAVAILABLE`; it does not block
an otherwise safe Shadow analysis unless the daily budget cannot be enforced.

### 6.4 Budget response

When a budget is exhausted:

- New provider calls are blocked.
- Existing deterministic pages remain available.
- The UI displays a safe `AI_BUDGET_BLOCKED` state.
- No cheaper model is selected automatically.
- No offline text is fabricated as an AI response.

## 7. Human Trigger Runtime Mode

### 7.1 Trigger semantics

V1 allows only an explicit, authenticated human action such as
`Generate Shadow Analysis`. One trigger represents one bounded attempt for
one finalized AI input.

The trigger is not an approval action and does not authorize any operational
execution. The human may read the result only.

### 7.2 Trigger gate

Before a run starts, the server MUST verify:

- Cloudflare Access or equivalent authenticated identity is present.
- Existing application role checks permit internal analysis access.
- The request uses POST with CSRF and origin protection.
- The idempotency key maps to the finalized AI input digest.
- The selected scope is allowlisted.
- The provider kill switch is enabled only for human-triggered Shadow runs.
- The exact prompt and model configurations are released and allowlisted.
- Data status permits the requested scope.
- Rate and token budgets are available.

The browser receives no provider credential and cannot call the provider
directly.

### 7.3 No automatic triggers

The following MUST remain disabled:

- Cron and scheduled generation.
- Event-driven generation from Payin, Payout, balance, import, or market data.
- Queue consumers and unattended retries.
- Webhook-triggered generation.
- Automatic generation on page load.
- Generation triggered by an AI response.

Page refreshes may read an existing result but must not create a new provider
call.

### 7.4 Concurrency and idempotency

- One finalized AI input, prompt version, model configuration, and explicit
  trigger key identify one attempt.
- Duplicate in-flight triggers return the same safe in-progress identity or
  are rejected.
- A retry is a separate attempt linked to the original trigger.
- Concurrent runs cannot overwrite each other.
- No run mutates the upstream Snapshot or deterministic calculation.

## 8. Recommendation Snapshot Generation Flow

### 8.1 Provider output is not a Snapshot

The real provider returns only `AI_PROVIDER_GENERATED_PAYLOAD_V1`. It cannot
set:

- Snapshot ID, key, version, status, or supersession identity.
- Authority or Shadow Mode flags.
- Prompt or model metadata.
- Confidence values or caps.
- Evidence-chain digests or output digest.
- Approval or execution fields.

These values are created only by trusted application code.

### 8.2 Trusted assembly stages

An immutable Snapshot MAY be assembled only after:

1. Runtime outcome is `VALIDATED_DRAFT`.
2. Provider response schema is valid and contains no unknown fields.
3. Evidence references, deterministic paths, and decimal strings exactly
   match finalized input.
4. Restriction-language and Shadow Guard validation pass.
5. Every material claim has the required evidence and deterministic support.
6. Confidence is calculated by deterministic framework code, including
   `LIMITED` and `BLOCKED` caps.
7. Trusted code creates Snapshot identity, recommendation key, version,
   lineage, status, timestamps, and all-false guards.
8. Trusted code builds and verifies the evidence chain.
9. `finalizeRecommendationSnapshot()` calculates the output digest and
   validates the complete object against the finalized AI input.

Any failure produces no accepted Recommendation Snapshot.

### 8.3 Status propagation

- `COMPLETE` input may produce an `ACTIVE` Shadow Snapshot after full
  validation.
- `LIMITED` input may produce only `LIMITED_BY_DATA` and must carry every
  material limitation and confidence cap.
- `BLOCKED` input may produce only a data-quality explanation with
  `BLOCKED_BY_DATA`; it cannot contain normal operational suggestions.
- Rejected provider content remains a rejected runtime result, not an active
  Snapshot.

The AI layer cannot upgrade data quality or remove limitations.

### 8.4 Immutability and persistence boundary

An accepted Snapshot is append-only and immutable. Regeneration creates a new
version and may reference the prior Snapshot through
`supersedes_snapshot_id`; it never edits or deletes the prior payload.

Task 3.4C does not authorize persistence. Until a separate persistence design,
migration, and implementation are approved, accepted Snapshots remain
in-memory results or synthetic test fixtures only. No production database
write is permitted.

## 9. Provider Failure and Degradation Strategy

### 9.1 Fail-closed outcomes

The connection uses the existing normalized outcomes:

- `COMPLETED`
- `REFUSED`
- `TIMEOUT`
- `RATE_LIMITED`
- `PROVIDER_UNAVAILABLE`
- `PROVIDER_ERROR`
- `CANCELLED`

Only `COMPLETED` proceeds to validation. Provider failure, malformed output,
schema rejection, evidence mismatch, decimal tampering, prohibited language,
or guard failure creates no accepted Snapshot.

### 9.2 Retry policy

- No retry for input, prompt, model allowlist, budget, schema, evidence,
  deterministic conflict, refusal, or Shadow Guard failures.
- At most one bounded retry MAY be permitted for timeout, rate limit, or
  temporary provider unavailability.
- The retry requires the same human trigger context, finalized input, prompt,
  model, parameters, and tool-free policy.
- Each attempt has separate timing, provider-request, token, and failure
  metadata.
- Retry must not silently change providers or models.
- No unattended retry continues after the human request lifecycle ends.

### 9.3 Safe degradation

When AI is unavailable or rejected, the application falls back only to the
existing deterministic dashboard and facts. It may display:

- AI status unavailable.
- Safe normalized failure category.
- Deterministic values, freshness, completeness, and limitations.
- A human-readable instruction to review the deterministic result manually.

It MUST NOT fabricate AI text, reuse a stale recommendation as current,
silently switch models, omit limitations, or claim that an action was taken.

### 9.4 Circuit breaker and kill switch

A server-side kill switch MUST block all new provider calls without affecting
deterministic pages. The future runtime SHOULD open a circuit after repeated
provider, validation, leakage-gate, or budget failures. Reset requires an
explicit operational action; it is not automatic execution of a financial
operation.

### 9.5 Error confidentiality

Provider error bodies are never returned directly to the browser or written
to normal logs. The application returns only normalized codes and safe
messages. Secrets, input payloads, raw provider output, stack traces, and
private model reasoning are excluded.

## 10. Required Shadow Guard

Every future input, provider request, Runtime result, validated draft, and
Recommendation Snapshot must preserve:

- `automatic_topup: false`
- `automatic_payment: false`
- `automatic_quote_change: false`
- `automatic_trading: false`
- `automatic_channel_switch: false`
- `third_party_submission: false`
- `approval_workflow: false`

Any missing, unknown, or `true` value blocks the provider call or rejects the
result. No provider response can alter these flags.

## 11. Future Implementation Gates

Connecting a real provider requires a separate explicit task and all of the
following before any production call:

1. One named provider and concrete model are selected and reviewed.
2. Data-processing, retention, regional, and contractual requirements are
   approved.
3. The outbound allowlist and redaction tests pass with synthetic fixtures.
4. A server-only credential is configured without exposing its value.
5. Model, prompt, endpoint, parameter, and budget allowlists are frozen.
6. Human-trigger authentication, authorization, CSRF, idempotency, and rate
   limits pass security review.
7. Timeout, cancellation, one-retry, circuit-breaker, and kill-switch tests
   pass.
8. Provider output passes existing schema, evidence, decimal, language, and
   Shadow Guard validators.
9. Static tests confirm the adapter has no database-write or execution client.
10. Offline, malformed, refusal, timeout, rate-limit, provider-unavailable,
    leakage, and budget-blocked tests pass.
11. Deployment and production enablement receive separate authorization.

No migration is required for the connection skeleton itself. Any future
append-only persistence requires a separate data-model review and migration
approval.

## 12. Design Decision

Task 3.4C adopts a human-triggered, server-only, provider-neutral, fail-closed
connection. Only a minimized and redacted fact projection may leave the
application. Provider output remains untrusted and cannot create authority,
confidence, version, evidence lineage, or execution state.

The system remains Shadow Mode. This design does not connect a real AI
provider, create a migration, modify a database, deploy, enable automatic
generation, or implement topup, payment, quote modification, trading, or
approval functionality.
