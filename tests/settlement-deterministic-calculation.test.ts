import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  calculateSettlementDeterministicResult,
  SETTLEMENT_DETERMINISTIC_CONTRACT_VERSION,
  SETTLEMENT_DETERMINISTIC_SHADOW_GUARD,
} from "../lib/settlement-deterministic-calculation";
import {
  SETTLEMENT_INPUT_CONTRACT_VERSION,
  SETTLEMENT_INPUT_SHADOW_GUARD,
  type SettlementInputSnapshotV1,
  type SnapshotSourceKey,
} from "../lib/settlement-input-snapshot";

const AS_OF = "2026-07-30T03:00:00.000Z";
const SOURCE_KEYS: SnapshotSourceKey[] = [
  "BALANCE_POSITION",
  "LIQUIDITY_HISTORY",
  "VND_INVENTORY",
  "FX_MARKET_INPUTS",
  "MERCHANT_CONTEXT",
  "PROFIT_CONTEXT",
  "MARKET_CONTEXT",
];
const INPUT_DIGEST = `sha256:${"1".repeat(64)}`;
const INPUT_RULESET_DIGEST = `sha256:${"2".repeat(64)}`;

function inventoryBatch(input: {
  id: string;
  batchDate: string;
  batchTime: string | null;
  timePrecision: "DATE_ONLY" | "EXACT";
  remaining: string;
  rate: string;
  sequence?: number | null;
}) {
  return {
    id: input.id,
    topup_batch_id: `topup-${input.id}`,
    batch_time: input.batchTime,
    batch_date: input.batchDate,
    time_precision: input.timePrecision,
    sequence_within_date: input.sequence ?? null,
    usdt_amount: "1.00000000",
    vnd_amount: input.remaining,
    cost_rate: input.rate,
    source: "ACTUAL_TOPUP",
    remaining_amount: input.remaining,
    remaining_ratio: "1.000000000000",
    cost_source_type: "ACTUAL_TOPUP",
    historical_cost_locked: true,
    status: "OPEN",
    model_version: "FIFO_ACTUAL_TOPUP_V1",
  };
}

function makeSnapshot(): SettlementInputSnapshotV1 {
  const evidenceIds = Object.fromEntries(
    SOURCE_KEYS.map((sourceKey) => [
      sourceKey,
      `00000000-0000-4000-8000-${String(
        SOURCE_KEYS.indexOf(sourceKey) + 1,
      ).padStart(12, "0")}`,
    ]),
  ) as Record<SnapshotSourceKey, string>;

  return {
    contract_version: SETTLEMENT_INPUT_CONTRACT_VERSION,
    snapshot_id: "00000000-0000-4000-8000-000000000101",
    request_id: "00000000-0000-4000-8000-000000000102",
    requested_at: AS_OF,
    created_at: AS_OF,
    as_of: AS_OF,
    currency: "VND",
    operating_timezone: "Asia/Shanghai",
    run_trigger: "MANUAL",
    mode: "SHADOW",
    ruleset_ref: {
      ruleset_code: "VND_SETTLEMENT_INTELLIGENCE_RULESET",
      ruleset_version: "1.0.0",
      ruleset_digest: INPUT_RULESET_DIGEST,
    },
    input_digest: INPUT_DIGEST,
    data_sources: SOURCE_KEYS.map((sourceKey) => ({
      source_key: sourceKey,
      source_type: "SUPABASE_SELECT",
      source_system: "VND_SETTLEMENT_OS",
      observed_at: AS_OF,
      cutoff_at: AS_OF,
      record_count: 1,
      freshness_policy_key: `${sourceKey}_V1`,
      freshness_status: "FRESH",
      completeness_status: "COMPLETE",
      content_digest: `sha256:${"3".repeat(64)}`,
      evidence_ids: [evidenceIds[sourceKey]],
      limitations: [],
    })),
    balance_position: {
      as_of: AS_OF,
      balance_source: "POOL_LEDGER_ACTIVE",
      gross_balance_vnd: "1000.00",
      reserve_ratio: "0.50",
      reserve_balance_vnd: "500.00",
      settleable_ratio: "0.50",
      settleable_balance_vnd: "500.00",
      account_history_cutoff_at: AS_OF,
      account_history_cutoff_local: "2026-07-30 11:00:00",
      account_history_timezone: "UTC+8",
      topup_cutoff_date: "2026-07-29",
      payout_cutoff_at: AS_OF,
      reconciliation_status: "BALANCED",
    },
    liquidity_context: {
      historical_window_days: 90,
      history_window_start: "2026-05-01T03:00:00.000Z",
      history_window_end: AS_OF,
      forecast_window_start: AS_OF,
      forecast_window_end: "2026-07-31T03:00:00.000Z",
      forecast_payin_vnd: "200.00",
      forecast_payout_vnd: "1200.00",
      forecast_net_demand_vnd: "1000.00",
      peak_window: "16:00-23:00",
      hourly_forecast: [
        {
          local_hour: 16,
          observed_days: 90,
          forecast_payin_vnd: "200.00",
          forecast_payout_vnd: "1200.00",
          forecast_net_demand_vnd: "1000.00",
          is_peak_window: true,
          payout_concentration_ratio: "1.000000000000",
        },
      ],
      forecast_method: "HISTORICAL_HOURLY_AVERAGE_INPUT_V1",
      forecast_version: "SETTLEMENT_READ_AGGREGATION_V1",
    },
    inventory_context: {
      cost_method: "FIFO_ACTUAL_TOPUP_V1",
      position_as_of: AS_OF,
      total_remaining_vnd: "2000.00",
      batches: [
        inventoryBatch({
          id: "batch-later",
          batchDate: "2026-07-29",
          batchTime: "2026-07-29T01:00:00.000Z",
          timePrecision: "EXACT",
          remaining: "1000.00",
          rate: "20000.00",
        }),
        inventoryBatch({
          id: "batch-earlier",
          batchDate: "2026-07-28",
          batchTime: "2026-07-28T01:00:00.000Z",
          timePrecision: "EXACT",
          remaining: "1000.00",
          rate: "25000.00",
        }),
      ],
      unmatched_inventory_status: "COMPLETE",
    },
    fx_context: {
      xe_rate: {
        id: "xe-1",
        rate_type: "XE_BASE_RATE",
        rate_value: "25000.00",
        source: "MANUAL_XE",
        record_time: "2026-07-30T02:00:00.000Z",
        operator_id: null,
      },
      p2p_cost_rates: [
        {
          id: "p2p-older",
          rate_type: "P2P_COST_RATE",
          rate_value: "25500.00",
          source: "MANUAL_P2P",
          record_time: "2026-07-30T01:00:00.000Z",
          operator_id: null,
        },
        {
          id: "p2p-latest",
          rate_type: "P2P_COST_RATE",
          rate_value: "26000.00",
          source: "MANUAL_P2P",
          record_time: "2026-07-30T02:30:00.000Z",
          operator_id: null,
        },
      ],
      upstream_quote_rate: {
        id: "upstream-1",
        rate_type: "UPSTREAM_QUOTE_RATE",
        rate_value: "25500.00",
        source: "MANUAL_UPSTREAM",
        record_time: "2026-07-30T02:00:00.000Z",
        operator_id: null,
      },
      current_customer_quote_rate: {
        id: "customer-1",
        rate_type: "CURRENT_CUSTOMER_QUOTE_RATE",
        rate_value: "27000.00",
        source: "CURRENT_QUOTE",
        record_time: "2026-07-30T02:00:00.000Z",
        operator_id: null,
      },
      quote_adjustment: null,
    },
    merchant_contexts: [
      {
        merchant_name: "Merchant A",
        payout_count: "1",
        channel_count: "1",
        transaction_volume_usdt: "1000.00000000",
        contribution_usdt: "5.000000000000",
        current_quote_rate: "27000.000000000000",
        current_profit_margin: "0.002000000000",
        merchant_fee_rate_on_principal: "0.005000000000",
        source_rules_version: "SHADOW_PRICING_V1",
        source_run_time: "2026-07-30T02:00:00.000Z",
      },
    ],
    profit_context: {
      daily_metrics: [
        {
          pricing_run_id: "profit-run-1",
          pricing_rules_version: "SHADOW_PRICING_V1",
          pricing_run_time: "2026-07-30T02:00:00.000Z",
          profit_date: "2026-07-30",
          payout_count: "1",
          merchant_principal_usdt: "1000.00",
          merchant_fee_revenue_usdt: "2.00",
          signed_dcc_revenue_usdt: "0.00",
          realized_fx_profit_usdt: "0.00",
          channel_fees_usdt: "0.00",
          other_actual_fees_usdt: "0.00",
          cash_profit_usdt: "2.00",
          cash_profit_margin: "0.002",
          signed_internal_funding_advantage_usdt: "3.00",
          shadow_cost_usdt: "0.00",
          opportunity_cost_usdt: "0.00",
          unrealized_risk_cost_usdt: "0.00",
          economic_profit_usdt: "5.00",
          economic_profit_margin: "0.005",
          data_status: "COMPLETE",
        },
      ],
    },
    market_context: [],
    data_quality: {
      status: "COMPLETE",
      limitations: [],
      blocking_reasons: [],
    },
    input_evidence: SOURCE_KEYS.map((sourceKey) => ({
      evidence_id: evidenceIds[sourceKey],
      source_key: sourceKey,
      source_type: "SUPABASE_SELECT",
      observed_at: AS_OF,
      cutoff_at: AS_OF,
      content_digest: `sha256:${"3".repeat(64)}`,
      extraction_version: "SETTLEMENT_READ_AGGREGATION_V1",
      classification: "INTERNAL_OPERATIONAL_DATA",
      redaction_status: "NO_SECRETS_INCLUDED",
    })),
    shadow_guard: SETTLEMENT_INPUT_SHADOW_GUARD,
  };
}

function source(
  snapshot: SettlementInputSnapshotV1,
  key: SnapshotSourceKey,
) {
  const manifest = snapshot.data_sources.find(
    (candidate) => candidate.source_key === key,
  );
  if (!manifest) throw new Error(`Missing source ${key}`);
  return manifest;
}

describe("Task 3.3 deterministic liquidity engine", () => {
  it("calculates Gross, Reserve, Settleable pressure and buffer without multiplier two", async () => {
    const result = await calculateSettlementDeterministicResult(
      makeSnapshot(),
    );
    const liquidity = result.liquidity_result;

    expect(result.contract_version).toBe(
      SETTLEMENT_DETERMINISTIC_CONTRACT_VERSION,
    );
    expect(result.status).toBe("COMPLETE");
    expect(liquidity?.gross_balance_vnd).toBe("1000.0000");
    expect(liquidity?.calculated_reserve_balance_vnd).toBe(
      "500.0000",
    );
    expect(liquidity?.calculated_settleable_balance_vnd).toBe(
      "500.0000",
    );
    expect(liquidity?.forecast_settleable_payin_vnd).toBe("100.0000");
    expect(liquidity?.forecast_settleable_payout_vnd).toBe(
      "600.0000",
    );
    expect(liquidity?.settleable_net_demand_vnd).toBe("500.0000");
    expect(liquidity?.safety_buffer_vnd).toBe("50.0000");
    expect(
      liquidity?.required_opening_settleable_capacity_vnd,
    ).toBe("550.0000");
    expect(liquidity?.settleable_capacity_gap_vnd).toBe("50.0000");
    expect(liquidity?.projected_settleable_after_flows_vnd).toBe(
      "0.0000",
    );
    expect(liquidity?.gross_capacity_gap_equivalent_vnd).toBe(
      "100.0000",
    );
    expect(JSON.stringify(result)).not.toContain("multiplier");
  });

  it("produces identical output and digest without mutating input", async () => {
    const snapshot = makeSnapshot();
    const before = structuredClone(snapshot);
    const first = await calculateSettlementDeterministicResult(snapshot);
    const second = await calculateSettlementDeterministicResult(snapshot);

    expect(snapshot).toEqual(before);
    expect(first).toEqual(second);
    expect(first.result_digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(first.ruleset_version).toBe("1.0.0");
    expect(first.as_of).toBe(AS_OF);
    expect(first.evidence_refs.length).toBe(SOURCE_KEYS.length);
    expect(first).not.toHaveProperty("recommendation");
    expect(first).not.toHaveProperty("recommended_topup");
    expect(first).not.toHaveProperty("recommended_quote");
  });
});

describe("Task 3.3 deterministic FIFO engine", () => {
  it("sorts batches by historical FIFO order and protects their cost rates", async () => {
    const snapshot = makeSnapshot();
    const inputOrder = snapshot.inventory_context.batches.map(
      (batch) => batch.id,
    );
    const result = await calculateSettlementDeterministicResult(snapshot);
    const fifo = result.fifo_cost_result;

    expect(inputOrder).toEqual(["batch-later", "batch-earlier"]);
    expect(fifo?.allocations.map((item) => item.batch_id)).toEqual([
      "batch-earlier",
      "batch-later",
    ]);
    expect(fifo?.allocations.map((item) => item.consumed_vnd)).toEqual([
      "1000.0000",
      "200.0000",
    ]);
    expect(fifo?.cost_basis_usdt).toBe("0.050000000000");
    expect(fifo?.weighted_cost_rate_vnd_per_usdt).toBe(
      "24000.000000000000",
    );
    expect(fifo?.unallocated_vnd).toBe("0.0000");
    expect(snapshot.inventory_context.batches.map((batch) => batch.id)).toEqual(
      inputOrder,
    );
  });

  it("uses an immutable same-day sequence when timestamps tie", async () => {
    const snapshot = makeSnapshot();
    snapshot.liquidity_context.forecast_payout_vnd = "1500.00";
    snapshot.inventory_context.batches = [
      inventoryBatch({
        id: "sequence-2",
        batchDate: "2026-07-29",
        batchTime: "2026-07-29T01:00:00.000Z",
        timePrecision: "EXACT",
        remaining: "1000.00",
        rate: "20000.00",
        sequence: 2,
      }),
      inventoryBatch({
        id: "sequence-1",
        batchDate: "2026-07-29",
        batchTime: "2026-07-29T01:00:00.000Z",
        timePrecision: "EXACT",
        remaining: "1000.00",
        rate: "25000.00",
        sequence: 1,
      }),
    ];
    snapshot.inventory_context.total_remaining_vnd = "2000.00";

    const result = await calculateSettlementDeterministicResult(snapshot);
    expect(
      result.fifo_cost_result?.allocations.map((item) => item.batch_id),
    ).toEqual(["sequence-1", "sequence-2"]);
    expect(result.fifo_cost_result?.cost_basis_usdt).toBe(
      "0.065000000000",
    );
  });

  it("orders exact timestamps before using a same-day sequence tie-breaker", async () => {
    const snapshot = makeSnapshot();
    snapshot.liquidity_context.forecast_payout_vnd = "1500.00";
    snapshot.inventory_context.batches = [
      inventoryBatch({
        id: "later-time",
        batchDate: "2026-07-29",
        batchTime: "2026-07-29T02:00:00.000Z",
        timePrecision: "EXACT",
        remaining: "1000.00",
        rate: "20000.00",
        sequence: 1,
      }),
      inventoryBatch({
        id: "earlier-time",
        batchDate: "2026-07-29",
        batchTime: "2026-07-29T01:00:00.000Z",
        timePrecision: "EXACT",
        remaining: "1000.00",
        rate: "25000.00",
        sequence: 2,
      }),
    ];
    snapshot.inventory_context.total_remaining_vnd = "2000.00";

    const result = await calculateSettlementDeterministicResult(snapshot);
    expect(
      result.fifo_cost_result?.allocations.map((item) => item.batch_id),
    ).toEqual(["earlier-time", "later-time"]);
    expect(result.fifo_cost_result?.cost_basis_usdt).toBe(
      "0.065000000000",
    );
  });

  it("blocks a partial allocation across ambiguous DATE_ONLY batches", async () => {
    const snapshot = makeSnapshot();
    snapshot.inventory_context.batches = [
      inventoryBatch({
        id: "date-only-a",
        batchDate: "2026-07-29",
        batchTime: null,
        timePrecision: "DATE_ONLY",
        remaining: "1000.00",
        rate: "25000.00",
      }),
      inventoryBatch({
        id: "date-only-b",
        batchDate: "2026-07-29",
        batchTime: null,
        timePrecision: "DATE_ONLY",
        remaining: "1000.00",
        rate: "20000.00",
      }),
    ];
    snapshot.inventory_context.total_remaining_vnd = "2000.00";

    const result = await calculateSettlementDeterministicResult(snapshot);
    expect(result.status).toBe("BLOCKED");
    expect(result.fifo_cost_result?.status).toBe("BLOCKED");
    expect(result.fifo_cost_result?.cost_basis_usdt).toBeNull();
    expect(result.fifo_cost_result?.blocking_reasons).toContain(
      "FIFO_AMBIGUOUS_PARTIAL_GROUP",
    );
  });
});

describe("Task 3.3 deterministic profit and business rules", () => {
  it("calculates both profit views and freezes the 0.2% and 0.5% boundaries", async () => {
    const result = await calculateSettlementDeterministicResult(
      makeSnapshot(),
    );

    expect(result.profit_result?.aggregate?.cash_profit_usdt).toBe(
      "2.000000000000",
    );
    expect(result.profit_result?.aggregate?.economic_profit_usdt).toBe(
      "5.000000000000",
    );
    expect(result.profit_result?.aggregate?.cash_profit_margin).toBe(
      "0.002000000000",
    );
    expect(result.profit_result?.aggregate?.economic_profit_margin).toBe(
      "0.005000000000",
    );
    expect(
      result.business_rule_result?.cash_profit_margin_band,
    ).toBe("BETWEEN_PROTECTION_AND_TARGET");
    expect(
      result.business_rule_result?.economic_profit_margin_band,
    ).toBe("AT_OR_ABOVE_TARGET");
  });

  it("uses signed DCC and returns null margins for a zero principal", async () => {
    const positive = makeSnapshot();
    positive.profit_context.daily_metrics[0].signed_dcc_revenue_usdt =
      "3.00";
    positive.profit_context.daily_metrics[0].cash_profit_usdt = "5.00";
    positive.profit_context.daily_metrics[0].economic_profit_usdt =
      "8.00";
    const positiveResult =
      await calculateSettlementDeterministicResult(positive);
    expect(positiveResult.profit_result?.aggregate?.cash_profit_usdt).toBe(
      "5.000000000000",
    );

    const negative = makeSnapshot();
    negative.profit_context.daily_metrics[0].merchant_principal_usdt =
      "0.00";
    negative.profit_context.daily_metrics[0].signed_dcc_revenue_usdt =
      "-1.00";
    negative.profit_context.daily_metrics[0].cash_profit_usdt = "1.00";
    negative.profit_context.daily_metrics[0].economic_profit_usdt =
      "4.00";
    const negativeResult =
      await calculateSettlementDeterministicResult(negative);
    expect(negativeResult.profit_result?.aggregate?.cash_profit_usdt).toBe(
      "1.000000000000",
    );
    expect(
      negativeResult.profit_result?.aggregate?.cash_profit_margin,
    ).toBeNull();
    expect(
      negativeResult.business_rule_result?.cash_profit_margin_band,
    ).toBe("NOT_EVALUATED");
  });
});

describe("Task 3.3 deterministic FX spreads", () => {
  it("keeps VND_PER_USDT operand direction and does not classify an opportunity", async () => {
    const result = await calculateSettlementDeterministicResult(
      makeSnapshot(),
    );
    const fx = result.fx_result;

    expect(fx?.rate_direction).toBe("VND_PER_USDT");
    expect(fx?.p2p_cost_rate).toBe("26000.000000000000");
    expect(fx?.p2p_minus_xe.absolute_vnd_per_usdt).toBe(
      "1000.000000000000",
    );
    expect(fx?.p2p_minus_xe.ratio).toBe("0.040000000000");
    expect(fx?.upstream_minus_xe.absolute_vnd_per_usdt).toBe(
      "500.000000000000",
    );
    expect(fx?.p2p_minus_fifo.absolute_vnd_per_usdt).toBe(
      "2000.000000000000",
    );
    expect(fx?.customer_quote_minus_fifo.ratio).toBe(
      "0.125000000000",
    );
    expect(fx?.classification).toBe("NOT_EVALUATED");
  });
});

describe("Task 3.3 status propagation and Shadow Guard", () => {
  it("propagates LIMITED without blocking independent calculations", async () => {
    const snapshot = makeSnapshot();
    source(snapshot, "FX_MARKET_INPUTS").completeness_status = "PARTIAL";
    source(snapshot, "FX_MARKET_INPUTS").limitations = [
      "UPSTREAM_RATE_COVERAGE_PARTIAL",
    ];
    snapshot.fx_context.upstream_quote_rate = null;
    snapshot.data_quality = {
      status: "LIMITED",
      limitations: ["UPSTREAM_RATE_COVERAGE_PARTIAL"],
      blocking_reasons: [],
    };

    const result = await calculateSettlementDeterministicResult(snapshot);
    expect(result.status).toBe("LIMITED");
    expect(result.liquidity_result?.status).toBe("COMPLETE");
    expect(result.fx_result?.status).toBe("LIMITED");
    expect(result.fx_result?.upstream_minus_xe.ratio).toBeNull();
    expect(result.limitations).toContain(
      "UPSTREAM_RATE_COVERAGE_PARTIAL",
    );
  });

  it("propagates BLOCKED when the critical balance is unavailable", async () => {
    const snapshot = makeSnapshot();
    snapshot.balance_position = null;
    source(snapshot, "BALANCE_POSITION").freshness_status = "MISSING";
    source(snapshot, "BALANCE_POSITION").completeness_status =
      "UNAVAILABLE";
    snapshot.data_quality = {
      status: "BLOCKED",
      limitations: [],
      blocking_reasons: ["BALANCE_POSITION_MISSING"],
    };

    const result = await calculateSettlementDeterministicResult(snapshot);
    expect(result.status).toBe("BLOCKED");
    expect(result.liquidity_result?.status).toBe("BLOCKED");
    expect(result.blocking_reasons).toContain(
      "BALANCE_POSITION_MISSING",
    );
  });

  it("hard-blocks an invalid execution flag while output guards stay false", async () => {
    const snapshot = makeSnapshot();
    (snapshot as unknown as { shadow_guard: Record<string, boolean> })
      .shadow_guard = {
      ...snapshot.shadow_guard,
      automatic_payment: true,
    };

    const result = await calculateSettlementDeterministicResult(snapshot);
    expect(result.status).toBe("BLOCKED");
    expect(result.liquidity_result).toBeNull();
    expect(result.blocking_reasons).toContain(
      "SHADOW_GUARD_INVALID_AUTOMATIC_PAYMENT",
    );
    expect(result.shadow_guard).toEqual(
      SETTLEMENT_DETERMINISTIC_SHADOW_GUARD,
    );
    expect(
      Object.values(result.shadow_guard).every((flag) => flag === false),
    ).toBe(true);
  });

  it("contains no database, network, AI, or operational write boundary", () => {
    const sourceCode = readFileSync(
      resolve(
        process.cwd(),
        "lib/settlement-deterministic-calculation.ts",
      ),
      "utf8",
    );
    expect(sourceCode).not.toMatch(
      /@supabase|createClient|\.from\s*\(|\.(insert|update|upsert|delete|rpc)\s*\(/,
    );
    expect(sourceCode).not.toMatch(
      /\bfetch\s*\(|openai|anthropic|automaticPayment|automaticTopup/,
    );
  });
});
