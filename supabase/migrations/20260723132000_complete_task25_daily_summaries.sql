-- Complete Task 2.5 daily summaries for Account History-only dates.
-- Existing immutable summary rows are preserved.

do $$
declare
  task25_run_id uuid;
  validation public.task25_validation_runs%rowtype;
begin
  select id
  into task25_run_id
  from public.shadow_pricing_runs
  where rules_version = 'SHADOW_PRICING_REAL_VALIDATION_V1'
  order by created_at desc
  limit 1;

  select *
  into validation
  from public.task25_validation_runs
  order by created_at desc
  limit 1;

  if task25_run_id is null or validation.id is null then
    raise exception 'TASK25_DAILY_SUMMARY_SOURCE_NOT_FOUND';
  end if;

  insert into public.daily_portfolio_summaries(
    pricing_run_id,
    summary_date,
    backtest_window,
    payin_fee_revenue_vnd,
    payin_upstream_fee_vnd,
    payin_net_fee_contribution_vnd,
    payout_economic_profit_usdt,
    external_topup_cash_cost_usdt,
    internal_netting_advantage_usdt,
    verified_count,
    partial_count,
    estimated_count,
    not_calculable_count,
    below_minimum_margin_count,
    at_or_above_target_margin_count,
    gross_balance_vnd,
    reserve_balance_vnd,
    settleable_balance_vnd,
    data_cutoff_snapshot,
    merchant_fee_revenue_usdt,
    dcc_revenue_usdt,
    total_company_revenue_usdt,
    upstream_payout_fee_vnd,
    refund_count,
    refund_reversal_vnd,
    net_settlement_vnd,
    net_settlement_usdt
  )
  with account_day as (
    select
      source_local_time::date as summary_date,
      sum(gross_order_amount_vnd * 0.008) filter (
        where event_type = 'PAYIN_INFLOW'
      ) as payin_revenue,
      count(*) filter (
        where event_type = 'PAYIN_INFLOW'
      ) * 2500 as payin_cost,
      (
        array_agg(
          gross_balance_after_vnd
          order by transaction_time desc, source_row_number asc
        )
      )[1] as gross_closing
    from public.account_history_entries
    where source_file_hash = validation.source_file_hash
    group by 1
  ),
  execution_day as (
    select
      (entry.transaction_time at time zone 'Asia/Shanghai')::date
        as summary_date,
      sum(execution.final_upstream_fee_vnd) as actual_upstream_fee,
      count(*) filter (
        where execution.final_payout_status = 'REFUNDED'
      ) as refund_count,
      sum(execution.refund_credit_vnd) filter (
        where execution.final_payout_status = 'REFUNDED'
      ) as refund_reversal
    from public.account_history_payout_executions execution
    join public.account_history_entries entry
      on entry.id = execution.original_account_history_entry_id
    where execution.source_file_hash = validation.source_file_hash
    group by 1
  ),
  settlement_day as (
    select
      (settled_at at time zone 'Asia/Shanghai')::date as summary_date,
      sum(vnd_amount) as settlement_vnd,
      sum(usdt_amount) as settlement_usdt
    from public.net_settlements
    where source_file_hash = validation.source_file_hash
    group by 1
  )
  select
    task25_run_id,
    account_day.summary_date,
    'PARTIAL_AFTER_ACCOUNT_HISTORY_CUTOFF',
    coalesce(account_day.payin_revenue, 0),
    coalesce(account_day.payin_cost, 0),
    coalesce(account_day.payin_revenue, 0)
      - coalesce(account_day.payin_cost, 0),
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    account_day.gross_closing,
    account_day.gross_closing * 0.5,
    account_day.gross_closing * 0.5,
    jsonb_build_object(
      'account_history_cutoff', validation.account_history_cutoff,
      'payout_activity_on_date', false,
      'completeness', 'PARTIAL_AFTER_ACCOUNT_HISTORY_CUTOFF',
      'net_settlement_counter_leg',
        'PENDING_DIRECTION_CONFIRMATION'
    ),
    0,
    0,
    0,
    coalesce(execution_day.actual_upstream_fee, 0),
    coalesce(execution_day.refund_count, 0),
    coalesce(execution_day.refund_reversal, 0),
    coalesce(settlement_day.settlement_vnd, 0),
    coalesce(settlement_day.settlement_usdt, 0)
  from account_day
  left join execution_day using (summary_date)
  left join settlement_day using (summary_date)
  where not exists (
    select 1
    from public.daily_portfolio_summaries existing
    where existing.pricing_run_id = task25_run_id
      and existing.summary_date = account_day.summary_date
  );
end
$$;

do $$
declare
  task25_run_id uuid;
begin
  select id
  into task25_run_id
  from public.shadow_pricing_runs
  where rules_version = 'SHADOW_PRICING_REAL_VALIDATION_V1'
  order by created_at desc
  limit 1;

  if (
    select coalesce(sum(upstream_payout_fee_vnd), 0)
    from public.daily_portfolio_summaries
    where pricing_run_id = task25_run_id
  ) <> (
    select coalesce(sum(final_upstream_fee_vnd), 0)
    from public.account_history_payout_executions
    where final_payout_status = 'SUCCESS'
  ) then
    raise exception 'TASK25_DAILY_UPSTREAM_FEE_TOTAL_MISMATCH';
  end if;
end
$$;
