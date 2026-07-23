-- Task 2.5 corrected, versioned Shadow pricing run.
-- Merchant fees and DCC are revenue. Existing Task 2 results remain immutable.

do $$
declare
  source_run_id uuid;
  new_run_id uuid;
  validation public.task25_validation_runs%rowtype;
begin
  if exists (
    select 1
    from public.shadow_pricing_runs
    where rules_version = 'SHADOW_PRICING_REAL_VALIDATION_V1'
  ) then
    return;
  end if;

  select id
  into source_run_id
  from public.shadow_pricing_runs
  where rules_version = 'SHADOW_PRICING_V1'
    and run_type = 'HISTORICAL_BACKTEST'
  order by created_at desc
  limit 1;

  select *
  into validation
  from public.task25_validation_runs
  order by created_at desc
  limit 1;

  if source_run_id is null then
    raise exception 'TASK25_SOURCE_SHADOW_RUN_NOT_FOUND';
  end if;
  if validation.id is null then
    raise exception 'TASK25_VALIDATION_RUN_NOT_FOUND';
  end if;

  insert into public.shadow_pricing_runs(
    run_type,
    rules_version,
    input_snapshot,
    data_cutoff_snapshot,
    status,
    shadow_mode
  )
  values (
    'HISTORICAL_BACKTEST',
    'SHADOW_PRICING_REAL_VALIDATION_V1',
    jsonb_build_object(
      'source_pricing_run_id', source_run_id,
      'account_history_validation_run_id', validation.id,
      'merchant_fee_treatment', 'COMPANY_REVENUE',
      'dcc_treatment', 'SEPARATE_COMPANY_REVENUE',
      'upstream_fee_treatment', 'ACTUAL_WHEN_EXACTLY_MATCHED',
      'exact_payout_matches', validation.payout_exact_match_rows,
      'net_settlement_counter_leg_status',
        'PENDING_DIRECTION_CONFIRMATION',
      'automatic_funds_actions', false
    ),
    jsonb_build_object(
      'account_history_cutoff', validation.account_history_cutoff,
      'account_history_source_period_end', validation.source_period_end,
      'payout_cutoff_local', '2026-07-20 23:59:55 UTC+8',
      'net_settlement_cutoff_local', '2026-07-20 22:44:43 UTC+8',
      'completeness', 'PARTIAL_AFTER_ACCOUNT_HISTORY_CUTOFF'
    ),
    'PARTIAL',
    true
  )
  returning id into new_run_id;

  insert into public.payout_pool_allocations(
    payout_order_id,
    pool_bucket_id,
    source_type,
    balance_before_vnd,
    allocation_ratio,
    allocated_vnd,
    funding_rate_vnd_per_usdt,
    allocated_cost_usdt,
    cost_basis_status,
    pricing_run_id,
    account_history_entry_id,
    allocated_gross_outflow_vnd,
    allocated_settleable_impact_vnd,
    economic_rate_vnd_per_usdt,
    cost_method,
    external_cash_cost_usdt,
    economic_cost_usdt,
    internal_netting_advantage_usdt,
    cost_confidence,
    allocation_status,
    input_snapshot
  )
  select
    payout_order_id,
    pool_bucket_id,
    source_type,
    balance_before_vnd,
    allocation_ratio,
    allocated_vnd,
    funding_rate_vnd_per_usdt,
    allocated_cost_usdt,
    cost_basis_status,
    new_run_id,
    null,
    allocated_gross_outflow_vnd,
    allocated_settleable_impact_vnd,
    economic_rate_vnd_per_usdt,
    cost_method,
    external_cash_cost_usdt,
    economic_cost_usdt,
    internal_netting_advantage_usdt,
    cost_confidence,
    allocation_status,
    input_snapshot || jsonb_build_object(
      'task25_reused_versioned_allocation', true,
      'account_history_exact_match', false
    )
  from public.payout_pool_allocations
  where pricing_run_id = source_run_id;

  insert into public.payout_profit_calculations(
    pricing_run_id,
    payout_order_id,
    account_history_entry_id,
    gross_outflow_vnd,
    settleable_impact_vnd,
    merchant_principal_vnd,
    payout_fee_vnd,
    payout_fee_status,
    received_usdt,
    company_borne_fee_usdt,
    external_cash_cost_usdt,
    economic_replacement_cost_usdt,
    internal_netting_advantage_usdt,
    economic_profit_usdt,
    economic_profit_margin,
    realized_profit_status,
    profit_verification_status,
    data_completeness_status,
    current_manual_as_rate,
    ar_rate,
    as_rate,
    ap_imported,
    ap_calculated,
    aq_imported,
    aq_relationship_status,
    minimum_margin_quote,
    target_margin_quote,
    issue_codes,
    calculation_snapshot,
    amount_usdt,
    merchant_fee_usdt,
    merchant_fee_rate,
    dcc_revenue_usdt,
    total_company_revenue_usdt,
    upstream_payout_fee_vnd,
    upstream_payout_fee_usdt,
    funding_principal_cost_usdt,
    payout_execution_cost_status,
    final_payout_status,
    refund_reversal_vnd,
    net_settlement_status,
    realized_profit_eligible
  )
  select
    new_run_id,
    source.payout_order_id,
    null,
    source.gross_outflow_vnd,
    source.settleable_impact_vnd,
    source.merchant_principal_vnd,
    source.payout_fee_vnd,
    'PENDING_RULE_ESTIMATE',
    payout.amount_usdt,
    0,
    source.external_cash_cost_usdt,
    source.economic_replacement_cost_usdt,
    source.internal_netting_advantage_usdt,
    round(
      payout.amount_usdt
        + payout.merchant_fee_usdt
        + payout.dcc_revenue_usdt
        - source.economic_replacement_cost_usdt,
      8
    ),
    (
      payout.amount_usdt
        + payout.merchant_fee_usdt
        + payout.dcc_revenue_usdt
        - source.economic_replacement_cost_usdt
    ) / nullif(payout.amount_usdt, 0),
    'NOT_FULLY_VERIFIED',
    'ESTIMATED',
    'MULTIPLE_ISSUES',
    source.current_manual_as_rate,
    source.ar_rate,
    source.as_rate,
    source.ap_imported,
    source.ap_calculated,
    source.aq_imported,
    source.aq_relationship_status,
    (
      (
        (
          payout.amount_usdt
            + payout.merchant_fee_usdt
            + payout.dcc_revenue_usdt
        ) * (1 - 0.002)
      )
      / nullif(
        source.economic_replacement_cost_usdt
          / nullif(source.gross_outflow_vnd, 0),
        0
      )
      / 1.005
    ) / nullif(payout.amount_usdt, 0),
    (
      (
        (
          payout.amount_usdt
            + payout.merchant_fee_usdt
            + payout.dcc_revenue_usdt
        ) * (1 - 0.005)
      )
      / nullif(
        source.economic_replacement_cost_usdt
          / nullif(source.gross_outflow_vnd, 0),
        0
      )
      / 1.005
    ) / nullif(payout.amount_usdt, 0),
    jsonb_build_array(
      'PAYOUT_EXACT_IDENTIFIER_NOT_FOUND',
      'ACCOUNT_HISTORY_EXECUTION_COST_NOT_ALLOCATABLE',
      'PARTIAL_AFTER_ACCOUNT_HISTORY_CUTOFF',
      'DATE_ONLY_RATE',
      'NET_SETTLEMENT_COUNTER_LEG_PENDING'
    ),
    jsonb_build_object(
      'merchant_fee_treatment', 'REVENUE',
      'dcc_treatment', 'SEPARATE_REVENUE_INCLUDED_ONCE',
      'upstream_fee_source', 'TASK2_ESTIMATE_NO_EXACT_PAYOUT_LINK',
      'verified_amount_time_fallback_used', false,
      'shadow_mode', true,
      'automatic_funds_actions', false
    ),
    payout.amount_usdt,
    payout.merchant_fee_usdt,
    payout.merchant_fee_rate,
    payout.dcc_revenue_usdt,
    payout.total_company_revenue_usdt,
    source.payout_fee_vnd,
    round(
      source.payout_fee_vnd
        * source.economic_replacement_cost_usdt
        / nullif(source.gross_outflow_vnd, 0),
      8
    ),
    round(
      source.economic_replacement_cost_usdt
        - (
          source.payout_fee_vnd
            * source.economic_replacement_cost_usdt
            / nullif(source.gross_outflow_vnd, 0)
        ),
      8
    ),
    'ESTIMATED',
    'UNMATCHED',
    0,
    'PENDING_DIRECTION_CONFIRMATION',
    false
  from public.payout_profit_calculations source
  join public.payout_orders payout
    on payout.id = source.payout_order_id
  where source.pricing_run_id = source_run_id;

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
  with dates as (
    select distinct
      (completed_at at time zone 'Asia/Shanghai')::date as summary_date
    from public.payout_orders
  ),
  payout_day as (
    select
      (p.completed_at at time zone 'Asia/Shanghai')::date as summary_date,
      sum(c.economic_profit_usdt) as economic_profit,
      sum(c.external_cash_cost_usdt) as external_cash_cost,
      sum(c.internal_netting_advantage_usdt) as internal_advantage,
      count(*) filter (
        where c.profit_verification_status = 'VERIFIED'
      ) as verified_count,
      count(*) filter (
        where c.profit_verification_status = 'PARTIAL'
      ) as partial_count,
      count(*) filter (
        where c.profit_verification_status = 'ESTIMATED'
      ) as estimated_count,
      count(*) filter (
        where c.profit_verification_status = 'NOT_CALCULABLE'
      ) as not_calculable_count,
      count(*) filter (
        where c.economic_profit_margin < 0.002
      ) as below_minimum_count,
      count(*) filter (
        where c.economic_profit_margin >= 0.005
      ) as at_target_count,
      sum(c.merchant_fee_usdt) as merchant_fee,
      sum(c.dcc_revenue_usdt) as dcc_revenue,
      sum(c.total_company_revenue_usdt) as company_revenue
    from public.payout_profit_calculations c
    join public.payout_orders p on p.id = c.payout_order_id
    where c.pricing_run_id = new_run_id
    group by 1
  ),
  account_day as (
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
    group by 1
  ),
  execution_day as (
    select
      (e.transaction_time at time zone 'Asia/Shanghai')::date
        as summary_date,
      sum(x.final_upstream_fee_vnd) as actual_upstream_fee,
      count(*) filter (
        where x.final_payout_status = 'REFUNDED'
      ) as refund_count,
      sum(x.refund_credit_vnd) filter (
        where x.final_payout_status = 'REFUNDED'
      ) as refund_reversal
    from public.account_history_payout_executions x
    join public.account_history_entries e
      on e.id = x.original_account_history_entry_id
    where x.source_file_hash = validation.source_file_hash
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
    new_run_id,
    dates.summary_date,
    'PARTIAL_AFTER_ACCOUNT_HISTORY_CUTOFF',
    coalesce(account_day.payin_revenue, 0),
    coalesce(account_day.payin_cost, 0),
    coalesce(account_day.payin_revenue, 0)
      - coalesce(account_day.payin_cost, 0),
    payout_day.economic_profit,
    payout_day.external_cash_cost,
    payout_day.internal_advantage,
    payout_day.verified_count,
    payout_day.partial_count,
    payout_day.estimated_count,
    payout_day.not_calculable_count,
    payout_day.below_minimum_count,
    payout_day.at_target_count,
    account_day.gross_closing,
    account_day.gross_closing * 0.5,
    account_day.gross_closing * 0.5,
    jsonb_build_object(
      'account_history_cutoff', validation.account_history_cutoff,
      'payout_cutoff_local', '2026-07-20 23:59:55 UTC+8',
      'completeness', 'PARTIAL_AFTER_ACCOUNT_HISTORY_CUTOFF',
      'net_settlement_counter_leg',
        'PENDING_DIRECTION_CONFIRMATION'
    ),
    payout_day.merchant_fee,
    payout_day.dcc_revenue,
    payout_day.company_revenue,
    coalesce(execution_day.actual_upstream_fee, 0),
    coalesce(execution_day.refund_count, 0),
    coalesce(execution_day.refund_reversal, 0),
    coalesce(settlement_day.settlement_vnd, 0),
    coalesce(settlement_day.settlement_usdt, 0)
  from dates
  join payout_day using (summary_date)
  left join account_day using (summary_date)
  left join execution_day using (summary_date)
  left join settlement_day using (summary_date);

  insert into public.audit_logs(
    action,
    entity_type,
    entity_id,
    after_state,
    metadata
  )
  values (
    'CREATE_TASK25_SHADOW_PRICING_RUN',
    'pricing_run',
    new_run_id,
    jsonb_build_object(
      'mode', 'SHADOW',
      'rules_version', 'SHADOW_PRICING_REAL_VALIDATION_V1',
      'merchant_fee_treatment', 'REVENUE',
      'dcc_treatment', 'SEPARATE_REVENUE',
      'automatic_funds_actions', false
    ),
    jsonb_build_object(
      'account_history_validation_run_id', validation.id,
      'payout_exact_matches', validation.payout_exact_match_rows,
      'net_settlement_counter_leg',
        'PENDING_DIRECTION_CONFIRMATION'
    )
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
    select count(*)
    from public.payout_profit_calculations
    where pricing_run_id = task25_run_id
  ) <> (
    select count(*)
    from public.payout_orders
  ) then
    raise exception 'TASK25_PAYOUT_CALCULATION_COUNT_MISMATCH';
  end if;

  if exists (
    select 1
    from public.payout_profit_calculations
    where pricing_run_id = task25_run_id
      and (
        merchant_fee_usdt is distinct from
          (
            select p.total_fee_usdt
            from public.payout_orders p
            where p.id = payout_order_id
          )
        or total_company_revenue_usdt is distinct from
          merchant_fee_usdt + dcc_revenue_usdt
        or company_borne_fee_usdt <> 0
        or realized_profit_eligible
      )
  ) then
    raise exception 'TASK25_REVENUE_OR_SHADOW_MODE_ASSERTION_FAILED';
  end if;
end
$$;
