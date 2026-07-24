-- Task 2.5 final DCC correction.
-- The previously applied denominator migration and its Shadow run remain
-- immutable. This creates a new auditable run using:
-- total_company_revenue_usdt = merchant_fee_revenue_usdt - dcc_revenue_usdt.

drop view if exists public.payout_merchant_fee_summary;

alter table public.payout_orders
  drop column total_company_revenue_usdt;
alter table public.payout_orders
  add column total_company_revenue_usdt numeric(38,12)
    generated always as (
      coalesce(total_fee_usdt, 0)
      - coalesce(crypto_dcc_income_usdt, 0)
      - coalesce(fiat_dcc_income_usdt, 0)
    ) stored;

comment on column public.payout_orders.total_company_revenue_usdt is
  'merchant_fee_revenue_usdt minus dcc_revenue_usdt; DCC is deducted once.';

create view public.payout_merchant_fee_summary
with (security_invoker = true)
as
select
  merchant_id,
  merchant_name,
  count(*) as payout_count,
  sum(merchant_total_debit_usdt) as merchant_total_debit_usdt,
  sum(merchant_principal_usdt) as merchant_principal_usdt,
  sum(merchant_fee_usdt) as merchant_fee_usdt,
  min(merchant_fee_rate) as minimum_merchant_fee_rate,
  percentile_cont(0.5) within group (order by merchant_fee_rate)
    as median_merchant_fee_rate,
  max(merchant_fee_rate) as maximum_merchant_fee_rate,
  min(fee_rate_on_total) as minimum_fee_rate_on_total,
  percentile_cont(0.5) within group (order by fee_rate_on_total)
    as median_fee_rate_on_total,
  max(fee_rate_on_total) as maximum_fee_rate_on_total,
  sum(dcc_revenue_usdt) as dcc_revenue_usdt,
  sum(total_company_revenue_usdt) as total_company_revenue_usdt
from public.payout_orders
group by merchant_id, merchant_name;

grant select on public.payout_merchant_fee_summary to authenticated;

do $$
declare
  source_run_id uuid;
  new_run_id uuid;
  validation public.task25_validation_runs%rowtype;
begin
  if exists (
    select 1
    from public.shadow_pricing_runs
    where rules_version =
      'SHADOW_PRICING_MERCHANT_FEE_DENOMINATOR_DCC_SUBTRACTION_V1'
      and run_type = 'HISTORICAL_BACKTEST'
  ) then
    return;
  end if;

  select id
  into source_run_id
  from public.shadow_pricing_runs
  where rules_version = 'SHADOW_PRICING_MERCHANT_FEE_DENOMINATOR_V1'
    and run_type = 'HISTORICAL_BACKTEST'
  order by created_at desc
  limit 1;

  select *
  into validation
  from public.task25_validation_runs
  order by created_at desc
  limit 1;

  if source_run_id is null then
    raise exception 'DCC_SUBTRACTION_SOURCE_RUN_NOT_FOUND';
  end if;
  if validation.id is null then
    raise exception 'DCC_SUBTRACTION_VALIDATION_RUN_NOT_FOUND';
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
    'SHADOW_PRICING_MERCHANT_FEE_DENOMINATOR_DCC_SUBTRACTION_V1',
    jsonb_build_object(
      'source_pricing_run_id', source_run_id,
      'account_history_validation_run_id', validation.id,
      'merchant_total_debit_source', '金额USDT',
      'merchant_principal_formula', 'TOTAL_DEBIT_MINUS_FEE',
      'merchant_fee_rate_denominator', 'MERCHANT_PRINCIPAL_USDT',
      'fee_rate_on_total', 'DIAGNOSTIC_ONLY',
      'historical_merchant_fee_source', 'ORIGINAL_FEE_USDT',
      'dcc_treatment', 'SUBTRACTED_ONCE_FROM_MERCHANT_FEE_REVENUE',
      'per_order_verified_count', validation.payout_exact_match_rows,
      'aggregate_execution_validation_status',
        validation.aggregate_execution_validation_status,
      'aggregate_execution_validated_count',
        validation.aggregate_execution_validated_count,
      'automatic_funds_actions', false
    ),
    jsonb_build_object(
      'account_history_cutoff', validation.account_history_cutoff,
      'account_history_source_period_end', validation.source_period_end,
      'payout_cutoff_local', '2026-07-20 23:59:55 UTC+8',
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
    input_snapshot || jsonb_build_object(
      'dcc_subtraction_run', true,
      'source_pricing_run_id', source_run_id
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
    merchant_total_debit_usdt,
    merchant_principal_usdt,
    merchant_fee_usdt,
    merchant_fee_rate,
    fee_rate_on_total,
    dcc_revenue_usdt,
    total_company_revenue_usdt,
    upstream_payout_fee_vnd,
    upstream_payout_fee_usdt,
    funding_principal_cost_usdt,
    payout_execution_cost_status,
    final_payout_status,
    refund_reversal_vnd,
    net_settlement_status,
    realized_profit_eligible,
    aggregate_execution_validation_status
  )
  select
    new_run_id,
    source.payout_order_id,
    source.account_history_entry_id,
    source.gross_outflow_vnd,
    source.settleable_impact_vnd,
    source.merchant_principal_vnd,
    source.payout_fee_vnd,
    source.payout_fee_status,
    payout.merchant_total_debit_usdt,
    0,
    source.external_cash_cost_usdt,
    source.economic_replacement_cost_usdt,
    source.internal_netting_advantage_usdt,
    round(
      payout.merchant_principal_usdt
        + payout.merchant_fee_usdt
        - payout.dcc_revenue_usdt
        - source.economic_replacement_cost_usdt,
      8
    ),
    (
      payout.merchant_principal_usdt
        + payout.merchant_fee_usdt
        - payout.dcc_revenue_usdt
        - source.economic_replacement_cost_usdt
    ) / nullif(payout.merchant_principal_usdt, 0),
    'NOT_FULLY_VERIFIED',
    'ESTIMATED',
    source.data_completeness_status,
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
          payout.merchant_total_debit_usdt
            - payout.dcc_revenue_usdt
        ) * (1 - 0.002)
      )
      / nullif(
        source.economic_replacement_cost_usdt
          / nullif(source.gross_outflow_vnd, 0),
        0
      )
      / 1.005
    ) / nullif(payout.merchant_principal_usdt, 0),
    (
      (
        (
          payout.merchant_total_debit_usdt
            - payout.dcc_revenue_usdt
        ) * (1 - 0.005)
      )
      / nullif(
        source.economic_replacement_cost_usdt
          / nullif(source.gross_outflow_vnd, 0),
        0
      )
      / 1.005
    ) / nullif(payout.merchant_principal_usdt, 0),
    source.issue_codes || jsonb_build_array(
      'DCC_SUBTRACTED_ONCE_FROM_COMPANY_REVENUE'
    ),
    source.calculation_snapshot || jsonb_build_object(
      'dcc_treatment', 'SUBTRACTED_ONCE_FROM_MERCHANT_FEE_REVENUE',
      'historical_fee_amount_preserved', true,
      'merchant_fee_rate_denominator', 'MERCHANT_PRINCIPAL_USDT',
      'verified_amount_time_fallback_used', false,
      'shadow_mode', true,
      'automatic_funds_actions', false
    ),
    payout.merchant_total_debit_usdt,
    payout.merchant_total_debit_usdt,
    payout.merchant_principal_usdt,
    payout.merchant_fee_usdt,
    payout.merchant_fee_rate,
    payout.fee_rate_on_total,
    payout.dcc_revenue_usdt,
    payout.total_company_revenue_usdt,
    source.upstream_payout_fee_vnd,
    source.upstream_payout_fee_usdt,
    source.funding_principal_cost_usdt,
    source.payout_execution_cost_status,
    source.final_payout_status,
    source.refund_reversal_vnd,
    source.net_settlement_status,
    false,
    validation.aggregate_execution_validation_status
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
  with payout_day as (
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
  )
  select
    new_run_id,
    source.summary_date,
    source.backtest_window,
    source.payin_fee_revenue_vnd,
    source.payin_upstream_fee_vnd,
    source.payin_net_fee_contribution_vnd,
    coalesce(payout_day.economic_profit, 0),
    coalesce(payout_day.external_cash_cost, 0),
    coalesce(payout_day.internal_advantage, 0),
    coalesce(payout_day.verified_count, 0),
    coalesce(payout_day.partial_count, 0),
    coalesce(payout_day.estimated_count, 0),
    coalesce(payout_day.not_calculable_count, 0),
    coalesce(payout_day.below_minimum_count, 0),
    coalesce(payout_day.at_target_count, 0),
    source.gross_balance_vnd,
    source.reserve_balance_vnd,
    source.settleable_balance_vnd,
    source.data_cutoff_snapshot || jsonb_build_object(
      'dcc_treatment', 'SUBTRACTED_ONCE_FROM_MERCHANT_FEE_REVENUE'
    ),
    coalesce(payout_day.merchant_fee, 0),
    coalesce(payout_day.dcc_revenue, 0),
    coalesce(payout_day.company_revenue, 0),
    source.upstream_payout_fee_vnd,
    source.refund_count,
    source.refund_reversal_vnd,
    source.net_settlement_vnd,
    source.net_settlement_usdt
  from public.daily_portfolio_summaries source
  left join payout_day using (summary_date)
  where source.pricing_run_id = source_run_id;

  insert into public.audit_logs(
    action,
    entity_type,
    entity_id,
    after_state,
    metadata
  )
  values (
    'CREATE_DCC_SUBTRACTION_SHADOW_RUN',
    'pricing_run',
    new_run_id,
    jsonb_build_object(
      'mode', 'SHADOW',
      'rules_version',
        'SHADOW_PRICING_MERCHANT_FEE_DENOMINATOR_DCC_SUBTRACTION_V1',
      'dcc_treatment', 'SUBTRACTED_ONCE_FROM_MERCHANT_FEE_REVENUE',
      'automatic_funds_actions', false
    ),
    jsonb_build_object(
      'source_pricing_run_id', source_run_id,
      'per_order_verified_count', validation.payout_exact_match_rows,
      'aggregate_execution_validated_count',
        validation.aggregate_execution_validated_count
    )
  );
end
$$;

do $$
declare
  corrected_run_id uuid;
begin
  select id
  into corrected_run_id
  from public.shadow_pricing_runs
  where rules_version =
    'SHADOW_PRICING_MERCHANT_FEE_DENOMINATOR_DCC_SUBTRACTION_V1'
    and run_type = 'HISTORICAL_BACKTEST'
  order by created_at desc
  limit 1;

  if corrected_run_id is null then
    raise exception 'DCC_SUBTRACTION_RUN_NOT_CREATED';
  end if;

  if exists (
    select 1
    from public.payout_orders
    where total_company_revenue_usdt is distinct from
      merchant_fee_usdt - dcc_revenue_usdt
  ) then
    raise exception 'DCC_SUBTRACTION_ORDER_ASSERTION_FAILED';
  end if;

  if (
    select count(*)
    from public.payout_profit_calculations
    where pricing_run_id = corrected_run_id
  ) <> (
    select count(*)
    from public.payout_orders
  ) then
    raise exception 'DCC_SUBTRACTION_CALCULATION_COUNT_MISMATCH';
  end if;

  if exists (
    select 1
    from public.payout_profit_calculations
    where pricing_run_id = corrected_run_id
      and (
        total_company_revenue_usdt is distinct from
          merchant_fee_usdt - dcc_revenue_usdt
        or economic_profit_usdt is distinct from round(
          merchant_principal_usdt
            + merchant_fee_usdt
            - dcc_revenue_usdt
            - economic_replacement_cost_usdt,
          8
        )
        or profit_verification_status = 'VERIFIED'
        or aggregate_execution_validation_status
          <> 'AGGREGATE_EXECUTION_VALIDATED'
        or realized_profit_eligible
      )
  ) then
    raise exception 'DCC_SUBTRACTION_SHADOW_ASSERTION_FAILED';
  end if;

  if (
    select
      count(*) filter (where economic_profit_margin < 0.002)
      + count(*) filter (
        where economic_profit_margin >= 0.002
          and economic_profit_margin < 0.005
      )
      + count(*) filter (where economic_profit_margin >= 0.005)
    from public.payout_profit_calculations
    where pricing_run_id = corrected_run_id
  ) <> (
    select count(*)
    from public.payout_profit_calculations
    where pricing_run_id = corrected_run_id
      and economic_profit_margin is not null
  ) then
    raise exception 'DCC_SUBTRACTION_MARGIN_PARTITION_FAILED';
  end if;
end
$$;
