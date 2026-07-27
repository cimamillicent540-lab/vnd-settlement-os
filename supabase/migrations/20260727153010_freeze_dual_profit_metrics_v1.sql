-- Task 2.10 addendum — Cash Profit + Economic Profit must coexist.
-- This migration appends a new immutable rule-set version and exposes an
-- auditable daily dual-profit view. It does not rewrite historical runs.

alter table public.settlement_business_rule_sets
  add column supersedes_rule_set_id uuid
    references public.settlement_business_rule_sets(id);

create unique index settlement_business_rule_sets_supersedes_idx
  on public.settlement_business_rule_sets(supersedes_rule_set_id)
  where supersedes_rule_set_id is not null;

alter table public.settlement_learning_recommendations
  add column system_cash_profit_usdt numeric(38,12),
  add column system_cash_profit_margin numeric(18,12),
  add column system_economic_profit_usdt numeric(38,12),
  add column system_economic_profit_margin numeric(18,12),
  add column profit_metrics_snapshot jsonb not null default '{}'::jsonb
    check (jsonb_typeof(profit_metrics_snapshot) = 'object');

alter table public.settlement_control_center_snapshots
  add column cash_profit_usdt numeric(38,12),
  add column cash_profit_margin numeric(18,12),
  add column economic_profit_usdt numeric(38,12),
  add column economic_profit_margin numeric(18,12),
  add column profit_metrics_snapshot jsonb not null default '{}'::jsonb
    check (jsonb_typeof(profit_metrics_snapshot) = 'object');

with prior_rule_set as (
  select rule_set.*
  from public.settlement_business_rule_sets rule_set
  where rule_set.rule_set_code = 'VND_BUSINESS_RULES_FREEZE_V1'
),
inserted_rule_set as (
  insert into public.settlement_business_rule_sets(
    rule_set_code,
    currency,
    version,
    freeze_status,
    current_automation_stage,
    automation_stage_definitions,
    description,
    source_task,
    effective_at,
    shadow_mode,
    automatic_payment,
    automatic_topup,
    automatic_quote_change,
    automatic_trading,
    supersedes_rule_set_id
  )
  select
    'VND_BUSINESS_RULES_FREEZE_V2',
    prior.currency,
    2,
    'FROZEN',
    prior.current_automation_stage,
    prior.automation_stage_definitions,
    'Task 2.10 dual Cash Profit and Economic Profit addendum',
    'TASK_2_10_PROFIT_ADDENDUM',
    '2026-07-27T00:00:00Z'::timestamptz,
    true,
    false,
    false,
    false,
    false,
    prior.id
  from prior_rule_set prior
  returning id, effective_at
)
insert into public.settlement_business_rules(
  rule_set_id,
  rule_key,
  rule_category,
  rule_name,
  condition_definition,
  system_suggested_action,
  requires_human_approval,
  priority,
  applicable_stage,
  rule_status,
  effective_at,
  shadow_mode,
  automatic_action
)
select
  inserted.id,
  prior_rule.rule_key,
  prior_rule.rule_category,
  prior_rule.rule_name,
  prior_rule.condition_definition,
  prior_rule.system_suggested_action,
  prior_rule.requires_human_approval,
  prior_rule.priority,
  prior_rule.applicable_stage,
  prior_rule.rule_status,
  inserted.effective_at,
  true,
  false
from inserted_rule_set inserted
join prior_rule_set prior on true
join public.settlement_business_rules prior_rule
  on prior_rule.rule_set_id = prior.id;

insert into public.settlement_business_rules(
  rule_set_id,
  rule_key,
  rule_category,
  rule_name,
  condition_definition,
  system_suggested_action,
  requires_human_approval,
  priority,
  applicable_stage,
  rule_status,
  effective_at,
  shadow_mode,
  automatic_action
)
select
  rule_set.id,
  seed.rule_key,
  'PROFIT',
  seed.rule_name,
  seed.condition_definition,
  seed.system_suggested_action,
  true,
  seed.priority,
  'STAGE_1_HUMAN_REVIEW',
  'CONFIRMED',
  rule_set.effective_at,
  true,
  false
from public.settlement_business_rule_sets rule_set
cross join (
  values
    (
      'PROFIT_DUAL_METRICS_REQUIRED',
      'Cash Profit与Economic Profit必须同时保存和展示',
      '{
        "cash_profit_formula": "merchant_fee_revenue + signed_dcc_revenue + realized_fx_profit - channel_fees - other_actual_fees",
        "economic_profit_formula": "cash_profit + signed_internal_funding_advantage - shadow_cost - opportunity_cost - unrealized_risk_cost",
        "dcc_sign_rule": "positive_is_company_revenue_negative_is_discount_or_company_cost",
        "display_mode": "BOTH_REQUIRED"
      }'::jsonb,
      '{
        "action": "DISPLAY_AND_SAVE_BOTH_PROFIT_METRICS",
        "cash_profit_purpose": "FINANCE",
        "economic_profit_purpose": "OPERATIONS_AND_AI",
        "automatic_action": false
      }'::jsonb,
      140
    ),
    (
      'PROFIT_DUAL_METRICS_90D_LEARNING',
      '90天学习模型必须同时使用两套利润',
      '{
        "learning_window_days": 90,
        "required_features": [
          "cash_profit_usdt",
          "cash_profit_margin",
          "economic_profit_usdt",
          "economic_profit_margin"
        ]
      }'::jsonb,
      '{
        "action": "STORE_DUAL_PROFIT_IN_IMMUTABLE_LEARNING_SNAPSHOT",
        "missing_value_rule": "PRESERVE_NULL_AND_DATA_STATUS_DO_NOT_INVENT",
        "automatic_action": false
      }'::jsonb,
      150
    )
) as seed(
  rule_key,
  rule_name,
  condition_definition,
  system_suggested_action,
  priority
)
where rule_set.rule_set_code = 'VND_BUSINESS_RULES_FREEZE_V2';

create or replace view public.settlement_business_rules_current
with (security_invoker = true)
as
with latest_rule_set as (
  select rule_set.*
  from public.settlement_business_rule_sets rule_set
  where rule_set.currency = 'VND'
  order by rule_set.version desc, rule_set.created_at desc, rule_set.id desc
  limit 1
)
select
  rule_set.rule_set_code,
  rule_set.currency,
  rule_set.version as rule_set_version,
  rule_set.freeze_status,
  rule_set.current_automation_stage,
  rule_set.automation_stage_definitions,
  rule_set.effective_at as rule_set_effective_at,
  rule.id,
  rule.rule_key,
  rule.rule_category,
  rule.rule_name,
  rule.condition_definition,
  rule.system_suggested_action,
  rule.requires_human_approval,
  rule.priority,
  rule.applicable_stage,
  rule.rule_status,
  rule.shadow_mode,
  rule.automatic_action
from latest_rule_set rule_set
join public.settlement_business_rules rule
  on rule.rule_set_id = rule_set.id;

create or replace view public.settlement_daily_profit_dual_metrics
with (security_invoker = true)
as
with latest_run as (
  select run.id, run.rules_version, run.created_at
  from public.shadow_pricing_runs run
  where run.run_type = 'HISTORICAL_BACKTEST'
  order by run.created_at desc, run.id desc
  limit 1
),
payout_day as (
  select
    (payout.completed_at at time zone 'Asia/Shanghai')::date
      as profit_date,
    count(*)::bigint as payout_count,
    coalesce(sum(calculation.merchant_principal_usdt), 0)
      ::numeric(38,12) as merchant_principal_usdt,
    coalesce(sum(calculation.merchant_fee_usdt), 0)
      ::numeric(38,12) as merchant_fee_revenue_usdt,
    coalesce(sum(calculation.dcc_revenue_usdt), 0)
      ::numeric(38,12) as dcc_revenue_usdt,
    coalesce(sum(calculation.upstream_payout_fee_usdt), 0)
      ::numeric(38,12) as channel_fees_usdt,
    coalesce(sum(calculation.company_borne_fee_usdt), 0)
      ::numeric(38,12) as other_actual_fees_usdt,
    coalesce(sum(calculation.internal_netting_advantage_usdt), 0)
      ::numeric(38,12) as internal_funding_advantage_usdt,
    coalesce(sum(calculation.economic_profit_usdt), 0)
      ::numeric(38,12) as existing_economic_profit_usdt
  from latest_run run
  join public.payout_profit_calculations calculation
    on calculation.pricing_run_id = run.id
  join public.payout_orders payout
    on payout.id = calculation.payout_order_id
  where payout.completed_at is not null
  group by 1
),
settlement_day as (
  select
    (settlement.settled_at at time zone 'Asia/Shanghai')::date
      as profit_date,
    coalesce(sum(settlement.realized_profit_effect_usdt), 0)
      ::numeric(38,12) as realized_fx_profit_usdt
  from public.net_settlements settlement
  where settlement.verification_status = 'VERIFIED'
    and settlement.realized_profit_effect_usdt is not null
  group by 1
),
combined as (
  select
    coalesce(payout.profit_date, settlement.profit_date)
      as profit_date,
    coalesce(payout.payout_count, 0) as payout_count,
    coalesce(payout.merchant_principal_usdt, 0)
      as merchant_principal_usdt,
    coalesce(payout.merchant_fee_revenue_usdt, 0)
      as merchant_fee_revenue_usdt,
    coalesce(payout.dcc_revenue_usdt, 0) as dcc_revenue_usdt,
    coalesce(settlement.realized_fx_profit_usdt, 0)
      as realized_fx_profit_usdt,
    coalesce(payout.channel_fees_usdt, 0) as channel_fees_usdt,
    coalesce(payout.other_actual_fees_usdt, 0)
      as other_actual_fees_usdt,
    coalesce(payout.internal_funding_advantage_usdt, 0)
      as internal_funding_advantage_usdt,
    coalesce(payout.existing_economic_profit_usdt, 0)
      as existing_economic_profit_usdt
  from payout_day payout
  full join settlement_day settlement using (profit_date)
),
profit as (
  select
    combined.*,
    (
      merchant_fee_revenue_usdt
      + dcc_revenue_usdt
      + realized_fx_profit_usdt
      - channel_fees_usdt
      - other_actual_fees_usdt
    )::numeric(38,12) as cash_profit_usdt,
    (
      existing_economic_profit_usdt
      + realized_fx_profit_usdt
    )::numeric(38,12) as economic_profit_usdt
  from combined
)
select
  run.id as pricing_run_id,
  run.rules_version as pricing_rules_version,
  run.created_at as pricing_run_time,
  profit.profit_date,
  profit.payout_count,
  profit.merchant_principal_usdt,
  profit.merchant_fee_revenue_usdt,
  profit.dcc_revenue_usdt,
  profit.realized_fx_profit_usdt,
  profit.channel_fees_usdt,
  profit.other_actual_fees_usdt,
  profit.cash_profit_usdt,
  case
    when profit.merchant_principal_usdt = 0 then null
    else (
      profit.cash_profit_usdt / profit.merchant_principal_usdt
    )::numeric(18,12)
  end as cash_profit_margin,
  profit.internal_funding_advantage_usdt,
  (
    profit.cash_profit_usdt
    + profit.internal_funding_advantage_usdt
    - profit.economic_profit_usdt
  )::numeric(38,12) as shadow_cost_usdt,
  0::numeric(38,12) as opportunity_cost_usdt,
  0::numeric(38,12) as unrealized_risk_cost_usdt,
  profit.economic_profit_usdt,
  case
    when profit.merchant_principal_usdt = 0 then null
    else (
      profit.economic_profit_usdt / profit.merchant_principal_usdt
    )::numeric(18,12)
  end as economic_profit_margin,
  'PARTIAL_ESTIMATED_COSTS'::text as profit_data_status,
  jsonb_build_object(
    'cash_profit_formula',
      'MERCHANT_FEE + SIGNED_DCC + REALIZED_FX - CHANNEL_FEES - OTHER_ACTUAL_FEES',
    'economic_profit_formula',
      'CASH_PROFIT + SIGNED_INTERNAL_FUNDING_ADVANTAGE - SHADOW_COST - OPPORTUNITY_COST - UNREALIZED_RISK_COST',
    'opportunity_cost_status', 'NOT_AVAILABLE_ZERO_NOT_INVENTED',
    'unrealized_risk_cost_status', 'NOT_AVAILABLE_ZERO_NOT_INVENTED',
    'shadow_cost_method', 'RECONCILIATION_TO_EXISTING_IMMUTABLE_ECONOMIC_PROFIT',
    'both_metrics_required', true,
    'learning_window_days', 90
  ) as calculation_snapshot
from profit
cross join latest_run run;

revoke all on
  public.settlement_daily_profit_dual_metrics
from anon;
grant select on
  public.settlement_daily_profit_dual_metrics
to authenticated, service_role;

do $$
begin
  if (
    select count(*)
    from public.settlement_business_rules_current
  ) <> 21 then
    raise exception 'BUSINESS_RULES_V2_EXPECTED_21_RULES';
  end if;
  if not exists (
    select 1
    from public.settlement_business_rules_current rule
    where rule.rule_key = 'PROFIT_DUAL_METRICS_REQUIRED'
      and rule.condition_definition->>'display_mode'
        = 'BOTH_REQUIRED'
  ) then
    raise exception 'DUAL_PROFIT_DISPLAY_RULE_MISSING';
  end if;
  if exists (
    select 1
    from public.settlement_business_rule_sets rule_set
    where rule_set.rule_set_code = 'VND_BUSINESS_RULES_FREEZE_V2'
      and (
        not rule_set.shadow_mode
        or rule_set.automatic_payment
        or rule_set.automatic_topup
        or rule_set.automatic_quote_change
        or rule_set.automatic_trading
      )
  ) then
    raise exception 'DUAL_PROFIT_RULE_SET_SHADOW_GUARD_FAILED';
  end if;
end
$$;

comment on view public.settlement_daily_profit_dual_metrics is
  'Daily Cash Profit and Economic Profit shown together. Missing opportunity and unrealized-risk costs remain explicit zero with NOT_AVAILABLE status, never invented.';
comment on column public.settlement_learning_recommendations.system_cash_profit_usdt is
  'Finance-view Cash Profit stored alongside Economic Profit for 90-day learning.';
comment on column public.settlement_learning_recommendations.system_economic_profit_usdt is
  'Decision-view Economic Profit stored alongside Cash Profit for 90-day learning.';
