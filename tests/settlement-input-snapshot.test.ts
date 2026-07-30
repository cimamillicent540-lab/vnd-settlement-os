import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildSettlementInputSnapshotFromRepository,
  classifyFreshness,
  SETTLEMENT_INPUT_CONTRACT_VERSION,
  SETTLEMENT_INPUT_SHADOW_GUARD,
  type SettlementReadBoundary,
  type SettlementReadEnvelope,
  type SettlementSnapshotReadRepository,
} from "../lib/settlement-input-snapshot";

const AS_OF = "2026-07-30T03:00:00.000Z";
const SNAPSHOT_ID = "00000000-0000-4000-8000-000000000001";
const REQUEST_ID = "00000000-0000-4000-8000-000000000002";

function envelope<T>(
  data: T,
  overrides: Partial<SettlementReadEnvelope<T>> = {},
): SettlementReadEnvelope<T> {
  return {
    data,
    observedAt: AS_OF,
    cutoffAt: AS_OF,
    recordCount: 1,
    completenessStatus: "COMPLETE",
    limitations: [],
    ...overrides,
  };
}

function completeRepository(
  boundaries?: SettlementReadBoundary[],
): SettlementSnapshotReadRepository {
  const capture = (boundary: SettlementReadBoundary) => {
    boundaries?.push(boundary);
  };
  return {
    async readBalanceContext(boundary) {
      capture(boundary);
      return envelope({
        position: {
          as_of: boundary.asOf,
          balance_source: "POOL_LEDGER_ACTIVE" as const,
          gross_balance_vnd: "17725938423.00",
          reserve_ratio: "0.50",
          reserve_balance_vnd: "8862969211.50",
          settleable_ratio: "0.50",
          settleable_balance_vnd: "8862969211.50",
          account_history_cutoff_at: "2026-07-18T15:59:28.000Z",
          account_history_cutoff_local: "2026-07-18 23:59:28",
          account_history_timezone: "UTC+8",
          topup_cutoff_date: "2026-07-20",
          payout_cutoff_at: "2026-07-20T15:00:00.000Z",
          reconciliation_status: "BALANCED",
        },
      });
    },
    async readLiquidityContext(boundary) {
      capture(boundary);
      return envelope({
        historical_window_days: 90,
        history_window_start: boundary.historyWindowStart,
        history_window_end: boundary.asOf,
        forecast_window_start: "2026-07-29T16:00:00.000Z",
        forecast_window_end: "2026-07-30T15:59:59.999Z",
        forecast_payin_vnd: "992000.00",
        forecast_payout_vnd: "47473331.73",
        forecast_net_demand_vnd: "46481331.73",
        peak_window: "16:00-23:00" as const,
        hourly_forecast: [],
        forecast_method:
          "HISTORICAL_HOURLY_AVERAGE_INPUT_V1" as const,
        forecast_version: "SETTLEMENT_READ_AGGREGATION_V1" as const,
      });
    },
    async readInventoryContext(boundary) {
      capture(boundary);
      return envelope({
        cost_method: "FIFO_ACTUAL_TOPUP_V1" as const,
        position_as_of: boundary.asOf,
        total_remaining_vnd: "14533500000.12345678",
        batches: [
          {
            id: "batch-1",
            topup_batch_id: "topup-1",
            batch_time: "2026-07-19T01:00:00.000Z",
            batch_date: "2026-07-19",
            time_precision: "EXACT" as const,
            usdt_amount: "150000.12345678",
            vnd_amount: "3938250000.12",
            cost_rate: "26255.123456789012",
            source: "VERIFIED_TOPUP",
            remaining_amount: "3938250000.12",
            remaining_ratio: "1.000000000000",
            cost_source_type: "ACTUAL_TOPUP",
            historical_cost_locked: true,
            status: "OPEN",
            model_version: "FIFO_ACTUAL_TOPUP_V1",
          },
        ],
        unmatched_inventory_status: "COMPLETE" as const,
      });
    },
    async readFxContext(boundary) {
      capture(boundary);
      return envelope({
        xe_rate: {
          id: "xe-1",
          rate_type: "XE_BASE_RATE" as const,
          rate_value: "26200.123456789012",
          source: "MANUAL_XE",
          record_time: AS_OF,
          operator_id: null,
        },
        p2p_cost_rates: [
          {
            id: "p2p-1",
            rate_type: "P2P_COST_RATE" as const,
            rate_value: "26255.987654321098",
            source: "MANUAL_BINANCE_P2P",
            record_time: AS_OF,
            operator_id: null,
          },
        ],
        upstream_quote_rate: null,
        current_customer_quote_rate: null,
        quote_adjustment: null,
      });
    },
    async readMerchantContexts(boundary) {
      capture(boundary);
      return envelope([
        {
          merchant_name: "Merchant A",
          payout_count: "1",
          channel_count: "1",
          transaction_volume_usdt: "100.12345678",
          contribution_usdt: "1.123456789012",
          current_quote_rate: "26200.123456789012",
          current_profit_margin: "0.005000000000",
          merchant_fee_rate_on_principal: "0.008000000000",
          source_rules_version: "SHADOW_PRICING_V1",
          source_run_time: AS_OF,
        },
      ]);
    },
    async readProfitContext(boundary) {
      capture(boundary);
      return envelope({
        daily_metrics: [
          {
            pricing_run_id: "run-1",
            pricing_rules_version: "SHADOW_PRICING_V1",
            pricing_run_time: AS_OF,
            profit_date: boundary.localDate,
            payout_count: "1",
            merchant_principal_usdt: "100.123456789012",
            merchant_fee_revenue_usdt: "0.800987654321",
            signed_dcc_revenue_usdt: "1.234567890123",
            realized_fx_profit_usdt: "0.100000000001",
            channel_fees_usdt: "0.050000000001",
            other_actual_fees_usdt: "0.010000000001",
            cash_profit_usdt: "2.075555544443",
            cash_profit_margin: "0.020730000000",
            signed_internal_funding_advantage_usdt: "0.200000000001",
            shadow_cost_usdt: "0.030000000001",
            opportunity_cost_usdt: "0.040000000001",
            unrealized_risk_cost_usdt: "0.050000000001",
            economic_profit_usdt: "2.155555544441",
            economic_profit_margin: "0.021530000000",
            data_status: "COMPLETE",
          },
        ],
      });
    },
    async readMarketContext(boundary) {
      capture(boundary);
      return envelope([
        {
          id: "market-note-1",
          context_date: boundary.localDate,
          observed_at: AS_OF,
          context_category: "FX_ANOMALY",
          severity: "INFO",
          title: "Manual observation",
          observation_reason: "Read-only context",
          evidence_reference: null,
          shadow_mode: true as const,
          quote_impact_applied: false as const,
          automatic_action: false as const,
        },
      ]);
    },
  };
}

async function build(repository = completeRepository()) {
  return buildSettlementInputSnapshotFromRepository(
    {
      asOf: AS_OF,
      requestedAt: AS_OF,
      snapshotId: SNAPSHOT_ID,
      requestId: REQUEST_ID,
      runTrigger: "MANUAL",
    },
    repository,
  );
}

describe("Settlement Input Snapshot contract", () => {
  it("builds the frozen read-only V1 contract", async () => {
    const snapshot = await build();
    expect(snapshot.contract_version).toBe(
      SETTLEMENT_INPUT_CONTRACT_VERSION,
    );
    expect(snapshot.mode).toBe("SHADOW");
    expect(snapshot.currency).toBe("VND");
    expect(snapshot.data_sources).toHaveLength(7);
    expect(snapshot.data_quality.status).toBe("COMPLETE");
    expect(snapshot).not.toHaveProperty("recommendation_snapshot");
    expect(snapshot).not.toHaveProperty("ai_layer_result");
  });

  it("preserves high-precision decimal strings without Number coercion", async () => {
    const snapshot = await build();
    expect(snapshot.balance_position?.gross_balance_vnd).toBe(
      "17725938423.00",
    );
    expect(snapshot.inventory_context.total_remaining_vnd).toBe(
      "14533500000.12345678",
    );
    expect(snapshot.inventory_context.batches[0].cost_rate).toBe(
      "26255.123456789012",
    );
    expect(snapshot.fx_context.p2p_cost_rates[0].rate_value).toBe(
      "26255.987654321098",
    );
    expect(
      snapshot.profit_context.daily_metrics[0]
        .signed_dcc_revenue_usdt,
    ).toBe("1.234567890123");
  });

  it("produces a stable input digest for identical data", async () => {
    const first = await build();
    const second = await build();
    expect(first.input_digest).toBe(second.input_digest);
    expect(first.ruleset_ref.ruleset_digest).toBe(
      second.ruleset_ref.ruleset_digest,
    );
  });
});

describe("asOf and data-quality boundaries", () => {
  it("passes one normalized asOf boundary to every read group", async () => {
    const boundaries: SettlementReadBoundary[] = [];
    await build(completeRepository(boundaries));
    expect(boundaries).toHaveLength(7);
    for (const boundary of boundaries) {
      expect(boundary).toEqual({
        asOf: AS_OF,
        localDate: "2026-07-30",
        historyWindowStart: "2026-05-01T03:00:00.000Z",
      });
    }
  });

  it("classifies fresh, aging, stale, missing and future data", () => {
    const policy = { softAgeSeconds: 60, maxAgeSeconds: 300 };
    expect(classifyFreshness(AS_OF, AS_OF, policy)).toBe("FRESH");
    expect(
      classifyFreshness(
        AS_OF,
        "2026-07-30T02:58:00.000Z",
        policy,
      ),
    ).toBe("AGING");
    expect(
      classifyFreshness(
        AS_OF,
        "2026-07-30T02:50:00.000Z",
        policy,
      ),
    ).toBe("STALE");
    expect(classifyFreshness(AS_OF, null, policy)).toBe("MISSING");
    expect(
      classifyFreshness(
        AS_OF,
        "2026-07-30T03:02:00.000Z",
        policy,
      ),
    ).toBe("FUTURE_DATED");
  });

  it("returns LIMITED for incomplete non-blocking data", async () => {
    const repository = completeRepository();
    repository.readFxContext = async () =>
      envelope(
        {
          xe_rate: null,
          p2p_cost_rates: [],
          upstream_quote_rate: null,
          current_customer_quote_rate: null,
          quote_adjustment: null,
        },
        {
          cutoffAt: null,
          completenessStatus: "PARTIAL",
          limitations: ["P2P_COST_RATE_MISSING"],
        },
      );
    const snapshot = await build(repository);
    expect(snapshot.data_quality.status).toBe("LIMITED");
    expect(snapshot.data_quality.limitations).toContain(
      "P2P_COST_RATE_MISSING",
    );
  });

  it("returns BLOCKED when the balance read fails", async () => {
    const repository = completeRepository();
    repository.readBalanceContext = async () => {
      throw new Error("simulated read failure");
    };
    const snapshot = await build(repository);
    expect(snapshot.data_quality.status).toBe("BLOCKED");
    expect(snapshot.balance_position).toBeNull();
    expect(snapshot.data_quality.blocking_reasons).toContain(
      "BALANCE_POSITION_MISSING",
    );
  });
});

describe("Shadow Mode and no-write boundary", () => {
  it("freezes every execution capability to false", async () => {
    const snapshot = await build();
    expect(snapshot.shadow_guard).toEqual(
      SETTLEMENT_INPUT_SHADOW_GUARD,
    );
    expect(Object.values(snapshot.shadow_guard).every((flag) => !flag)).toBe(
      true,
    );
  });

  it("uses only read operations in the Supabase adapter", () => {
    const source = readFileSync(
      resolve(
        process.cwd(),
        "lib/settlement-input-snapshot-server.ts",
      ),
      "utf8",
    );
    expect(source).toContain(".select(");
    expect(source).toContain('.lte("transaction_time", boundary.asOf)');
    expect(source).toContain('.lte("record_time", boundary.asOf)');
    expect(source).toContain('.lte("pricing_run_time", boundary.asOf)');
    expect(source).toContain('.lt("execution_date", boundary.localDate)');
    expect(source).not.toMatch(
      /\.(insert|update|upsert|delete|rpc)\s*\(/,
    );
    expect(source).not.toMatch(
      /recommendTopup|recommendCustomerQuote|buildSettlementRiskAlerts/,
    );
  });
});
