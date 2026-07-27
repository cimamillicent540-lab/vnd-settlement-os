-- Task 2.11 — Shadow Operation Validation & Daily Settlement Intelligence V1.
-- Daily operating snapshots and observed outcomes are append-only evidence.
-- This migration records advice and human-observed results only. It cannot
-- pay, top up, change a quote, collect market data, or trade.

create table public.settlement_daily_operation_snapshots (
  id uuid primary key default gen_random_uuid(),
  client_request_id uuid not null unique,
  operating_date date not null,
  snapshot_time timestamptz not null default now(),
  currency text not null check (currency = 'VND'),
  source_control_snapshot_id uuid
    references public.settlement_control_center_snapshots(id),
  source_learning_recommendation_id uuid
    references public.settlement_learning_recommendations(id),
  gross_balance_vnd numeric(38,2) not null
    check (gross_balance_vnd >= 0),
  settleable_balance_vnd numeric(38,2) not null
    check (settleable_balance_vnd >= 0),
  reserve_balance_vnd numeric(38,2) not null
    check (reserve_balance_vnd >= 0),
  today_payin_vnd numeric(38,2) not null
    check (today_payin_vnd >= 0),
  today_payout_vnd numeric(38,2) not null
    check (today_payout_vnd >= 0),
  net_funds_change_vnd numeric(38,2) not null,
  forecast_payout_vnd numeric(38,2) not null
    check (forecast_payout_vnd >= 0),
  forecast_payin_vnd numeric(38,2) not null
    check (forecast_payin_vnd >= 0),
  forecast_net_demand_vnd numeric(38,2) not null
    check (forecast_net_demand_vnd >= 0),
  peak_16_23_pressure_vnd numeric(38,2) not null
    check (peak_16_23_pressure_vnd >= 0),
  funding_shortfall_exists boolean not null,
  projected_shortfall_vnd numeric(38,2) not null
    check (projected_shortfall_vnd >= 0),
  topup_recommended boolean not null,
  recommended_topup_usdt numeric(38,8)
    check (
      recommended_topup_usdt is null
      or recommended_topup_usdt >= 0
    ),
  recommended_topup_time text not null
    check (
      recommended_topup_time in (
        'NO_TOPUP',
        'IMMEDIATE_MANUAL_REVIEW',
        'BEFORE_16_00',
        'WHEN_OPERATOR_CONFIRMS_P2P_QUOTE'
      )
    ),
  topup_recommendation_snapshot jsonb not null default '{}'::jsonb
    check (jsonb_typeof(topup_recommendation_snapshot) = 'object'),
  cash_profit_usdt numeric(38,12) not null,
  cash_profit_margin numeric(18,12),
  economic_profit_usdt numeric(38,12) not null,
  economic_profit_margin numeric(18,12),
  profit_metrics_snapshot jsonb not null
    check (jsonb_typeof(profit_metrics_snapshot) = 'object'),
  merchant_profit_contributions jsonb not null default '[]'::jsonb
    check (jsonb_typeof(merchant_profit_contributions) = 'array'),
  xe_rate numeric(38,12)
    check (xe_rate is null or xe_rate > 0),
  p2p_cost_rate numeric(38,12)
    check (p2p_cost_rate is null or p2p_cost_rate > 0),
  company_quote_rate numeric(38,12)
    check (company_quote_rate is null or company_quote_rate > 0),
  fx_opportunity_status text not null
    check (
      fx_opportunity_status in (
        'BUY_VND_OPPORTUNITY',
        'NORMAL',
        'RISK',
        'WAITING_INPUT'
      )
    ),
  fx_snapshot jsonb not null default '{}'::jsonb
    check (jsonb_typeof(fx_snapshot) = 'object'),
  risk_alerts jsonb not null default '[]'::jsonb
    check (jsonb_typeof(risk_alerts) = 'array'),
  learning_90d_snapshot jsonb not null default '{}'::jsonb
    check (jsonb_typeof(learning_90d_snapshot) = 'object'),
  decision_accuracy_snapshot jsonb not null default '{}'::jsonb
    check (jsonb_typeof(decision_accuracy_snapshot) = 'object'),
  data_cutoff_snapshot jsonb not null default '{}'::jsonb
    check (jsonb_typeof(data_cutoff_snapshot) = 'object'),
  data_completeness_status text not null
    check (
      data_completeness_status in (
        'COMPLETE',
        'PARTIAL_AFTER_ACCOUNT_HISTORY_CUTOFF',
        'NO_ACCOUNT_HISTORY'
      )
    ),
  rules_version text not null
    default 'SHADOW_OPERATION_VALIDATION_V1',
  shadow_mode boolean not null default true check (shadow_mode),
  automatic_payment boolean not null default false
    check (automatic_payment = false),
  automatic_topup boolean not null default false
    check (automatic_topup = false),
  automatic_quote_change boolean not null default false
    check (automatic_quote_change = false),
  automatic_market_data_collection boolean not null default false
    check (automatic_market_data_collection = false),
  automatic_trading boolean not null default false
    check (automatic_trading = false),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  check (
    abs(
      gross_balance_vnd
      - reserve_balance_vnd
      - settleable_balance_vnd
    ) <= 0.02
  ),
  check (
    funding_shortfall_exists
    = (projected_shortfall_vnd > 0)
  ),
  check (
    topup_recommended = funding_shortfall_exists
    or (
      topup_recommended
      and fx_opportunity_status = 'BUY_VND_OPPORTUNITY'
    )
  )
);

create index settlement_daily_operation_latest_idx
  on public.settlement_daily_operation_snapshots(
    currency,
    operating_date desc,
    snapshot_time desc,
    id desc
  );
create index settlement_daily_operation_control_idx
  on public.settlement_daily_operation_snapshots(
    source_control_snapshot_id
  )
  where source_control_snapshot_id is not null;
create index settlement_daily_operation_learning_idx
  on public.settlement_daily_operation_snapshots(
    source_learning_recommendation_id
  )
  where source_learning_recommendation_id is not null;
create index settlement_daily_operation_created_by_idx
  on public.settlement_daily_operation_snapshots(created_by);

create table public.settlement_decision_outcomes (
  id uuid primary key default gen_random_uuid(),
  client_request_id uuid not null unique,
  recommendation_id uuid not null
    references public.settlement_learning_recommendations(id),
  human_decision_id uuid not null
    references public.settlement_human_decisions(id),
  outcome_version integer not null check (outcome_version > 0),
  supersedes_outcome_id uuid
    references public.settlement_decision_outcomes(id),
  measured_at timestamptz not null,
  actual_topup_usdt numeric(38,8)
    check (actual_topup_usdt is null or actual_topup_usdt >= 0),
  actual_quote_rate numeric(38,12)
    check (actual_quote_rate is null or actual_quote_rate > 0),
  actual_cash_profit_usdt numeric(38,12),
  actual_economic_profit_usdt numeric(38,12),
  actual_risk_outcomes jsonb not null default '[]'::jsonb
    check (jsonb_typeof(actual_risk_outcomes) = 'array'),
  outcome_reason text not null
    check (char_length(btrim(outcome_reason)) > 0),
  outcome_snapshot jsonb not null default '{}'::jsonb
    check (jsonb_typeof(outcome_snapshot) = 'object'),
  data_cutoff_snapshot jsonb not null default '{}'::jsonb
    check (jsonb_typeof(data_cutoff_snapshot) = 'object'),
  recorded_by uuid not null references auth.users(id),
  shadow_mode boolean not null default true check (shadow_mode),
  system_execution_performed boolean not null default false
    check (system_execution_performed = false),
  automatic_payment boolean not null default false
    check (automatic_payment = false),
  automatic_topup boolean not null default false
    check (automatic_topup = false),
  automatic_quote_change boolean not null default false
    check (automatic_quote_change = false),
  automatic_trading boolean not null default false
    check (automatic_trading = false),
  created_at timestamptz not null default now(),
  unique (human_decision_id, outcome_version),
  unique (supersedes_outcome_id),
  check (
    supersedes_outcome_id is not null
    or outcome_version = 1
  ),
  check (
    actual_topup_usdt is not null
    or actual_quote_rate is not null
    or actual_cash_profit_usdt is not null
    or actual_economic_profit_usdt is not null
    or jsonb_array_length(actual_risk_outcomes) > 0
  )
);

create index settlement_decision_outcomes_recommendation_idx
  on public.settlement_decision_outcomes(
    recommendation_id,
    measured_at desc
  );
create index settlement_decision_outcomes_decision_idx
  on public.settlement_decision_outcomes(
    human_decision_id,
    outcome_version desc
  );
create index settlement_decision_outcomes_recorded_by_idx
  on public.settlement_decision_outcomes(recorded_by);
create index settlement_decision_outcomes_measured_at_idx
  on public.settlement_decision_outcomes(measured_at desc);

create or replace function
  private.reject_shadow_operation_validation_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception
    'SHADOW_OPERATION_VALIDATION_IS_IMMUTABLE_APPEND_A_NEW_VERSION';
end
$$;

create trigger settlement_daily_operation_snapshots_immutable
before update or delete
on public.settlement_daily_operation_snapshots
for each row execute function
  private.reject_shadow_operation_validation_mutation();

create trigger settlement_decision_outcomes_immutable
before update or delete
on public.settlement_decision_outcomes
for each row execute function
  private.reject_shadow_operation_validation_mutation();

create or replace function
  private.validate_settlement_decision_outcome_consistency()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  expected_recommendation_id uuid;
  prior_outcome public.settlement_decision_outcomes%rowtype;
  system_risks jsonb;
begin
  select decision.recommendation_id
  into expected_recommendation_id
  from public.settlement_human_decisions decision
  where decision.id = new.human_decision_id;
  if expected_recommendation_id is null
    or expected_recommendation_id <> new.recommendation_id then
    raise exception 'OUTCOME_RECOMMENDATION_DECISION_MISMATCH';
  end if;

  if new.outcome_version > 1 then
    select *
    into prior_outcome
    from public.settlement_decision_outcomes outcome
    where outcome.id = new.supersedes_outcome_id;
    if not found
      or prior_outcome.human_decision_id
        <> new.human_decision_id
      or prior_outcome.outcome_version
        <> new.outcome_version - 1 then
      raise exception 'INVALID_OUTCOME_VERSION_CHAIN';
    end if;
  end if;

  select recommendation.system_risk_alerts
  into system_risks
  from public.settlement_learning_recommendations recommendation
  where recommendation.id = new.recommendation_id;
  if exists (
    select 1
    from jsonb_array_elements(new.actual_risk_outcomes) risk
    where nullif(btrim(risk->>'risk_code'), '') is null
      or risk->>'realized' not in ('true', 'false')
      or not exists (
        select 1
        from jsonb_array_elements(system_risks) alert
        where alert->>'code' = risk->>'risk_code'
      )
  ) then
    raise exception 'INVALID_OR_UNKNOWN_ACTUAL_RISK_OUTCOME';
  end if;
  return new;
end
$$;

create trigger settlement_decision_outcomes_consistency
before insert on public.settlement_decision_outcomes
for each row execute function
  private.validate_settlement_decision_outcome_consistency();

create or replace function public.record_settlement_decision_outcome_v1(
  p_client_request_id uuid,
  p_human_decision_id uuid,
  p_measured_at timestamptz,
  p_actual_topup_usdt numeric,
  p_actual_quote_rate numeric,
  p_actual_cash_profit_usdt numeric,
  p_actual_economic_profit_usdt numeric,
  p_actual_risk_outcomes jsonb,
  p_outcome_reason text,
  p_outcome_snapshot jsonb default '{}'::jsonb,
  p_data_cutoff_snapshot jsonb default '{}'::jsonb
)
returns table(outcome_id uuid, outcome_version integer)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  decision_row public.settlement_human_decisions%rowtype;
  recommendation_row
    public.settlement_learning_recommendations%rowtype;
  next_version integer;
  previous_outcome_id uuid;
  inserted_outcome_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'AUTHENTICATION_REQUIRED';
  end if;
  if not (
    public.has_role('admin'::public.app_role)
    or public.has_role('settlement_operator'::public.app_role)
    or public.has_role('approver'::public.app_role)
  ) then
    raise exception 'INSUFFICIENT_OUTCOME_REVIEW_ROLE';
  end if;
  if p_measured_at is null then
    raise exception 'OUTCOME_MEASURED_AT_REQUIRED';
  end if;
  if p_outcome_reason is null
    or char_length(btrim(p_outcome_reason)) = 0 then
    raise exception 'OUTCOME_REASON_REQUIRED';
  end if;
  if jsonb_typeof(p_actual_risk_outcomes) <> 'array'
    or jsonb_typeof(p_outcome_snapshot) <> 'object'
    or jsonb_typeof(p_data_cutoff_snapshot) <> 'object' then
    raise exception 'INVALID_OUTCOME_JSON_SHAPE';
  end if;
  if p_actual_topup_usdt is null
    and p_actual_quote_rate is null
    and p_actual_cash_profit_usdt is null
    and p_actual_economic_profit_usdt is null
    and jsonb_array_length(p_actual_risk_outcomes) = 0 then
    raise exception 'AT_LEAST_ONE_ACTUAL_OUTCOME_IS_REQUIRED';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_actual_risk_outcomes) risk
    where nullif(btrim(risk->>'risk_code'), '') is null
      or risk->>'realized' not in ('true', 'false')
  ) then
    raise exception 'INVALID_ACTUAL_RISK_OUTCOME';
  end if;
  if (
    select count(*)
    from jsonb_array_elements(p_actual_risk_outcomes)
  ) <> (
    select count(distinct risk->>'risk_code')
    from jsonb_array_elements(p_actual_risk_outcomes) risk
  ) then
    raise exception 'DUPLICATE_ACTUAL_RISK_OUTCOME';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_human_decision_id::text, 0)
  );

  select *
  into decision_row
  from public.settlement_human_decisions decision
  where decision.id = p_human_decision_id;
  if not found then
    raise exception 'HUMAN_DECISION_NOT_FOUND';
  end if;

  select *
  into recommendation_row
  from public.settlement_learning_recommendations recommendation
  where recommendation.id = decision_row.recommendation_id;

  if exists (
    select 1
    from jsonb_array_elements(p_actual_risk_outcomes) risk
    where not exists (
      select 1
      from jsonb_array_elements(
        recommendation_row.system_risk_alerts
      ) alert
      where alert->>'code' = risk->>'risk_code'
    )
  ) then
    raise exception 'ACTUAL_RISK_NOT_IN_SYSTEM_RECOMMENDATION';
  end if;

  select
    coalesce(max(outcome.outcome_version), 0) + 1,
    (
      array_agg(
        outcome.id
        order by outcome.outcome_version desc
      )
    )[1]
  into next_version, previous_outcome_id
  from public.settlement_decision_outcomes outcome
  where outcome.human_decision_id = p_human_decision_id;

  insert into public.settlement_decision_outcomes(
    client_request_id,
    recommendation_id,
    human_decision_id,
    outcome_version,
    supersedes_outcome_id,
    measured_at,
    actual_topup_usdt,
    actual_quote_rate,
    actual_cash_profit_usdt,
    actual_economic_profit_usdt,
    actual_risk_outcomes,
    outcome_reason,
    outcome_snapshot,
    data_cutoff_snapshot,
    recorded_by,
    shadow_mode,
    system_execution_performed,
    automatic_payment,
    automatic_topup,
    automatic_quote_change,
    automatic_trading
  )
  values (
    p_client_request_id,
    decision_row.recommendation_id,
    p_human_decision_id,
    next_version,
    previous_outcome_id,
    p_measured_at,
    p_actual_topup_usdt,
    p_actual_quote_rate,
    p_actual_cash_profit_usdt,
    p_actual_economic_profit_usdt,
    p_actual_risk_outcomes,
    btrim(p_outcome_reason),
    p_outcome_snapshot,
    p_data_cutoff_snapshot,
    (select auth.uid()),
    true,
    false,
    false,
    false,
    false,
    false
  )
  returning id into inserted_outcome_id;

  return query select inserted_outcome_id, next_version;
end
$$;

create or replace view public.settlement_daily_operation_latest
with (security_invoker = true)
as
select distinct on (snapshot.currency, snapshot.operating_date)
  snapshot.*
from public.settlement_daily_operation_snapshots snapshot
order by
  snapshot.currency,
  snapshot.operating_date,
  snapshot.snapshot_time desc,
  snapshot.id desc;

create or replace view public.settlement_decision_latest_outcomes
with (security_invoker = true)
as
select distinct on (outcome.human_decision_id)
  outcome.*
from public.settlement_decision_outcomes outcome
order by
  outcome.human_decision_id,
  outcome.outcome_version desc,
  outcome.id desc;

create or replace view public.settlement_decision_validation_queue
with (security_invoker = true)
as
select
  recommendation.id as recommendation_id,
  recommendation.currency,
  recommendation.recommendation_time,
  recommendation.system_recommended_topup_usdt,
  recommendation.system_recommended_quote_rate,
  recommendation.system_cash_profit_usdt,
  recommendation.system_economic_profit_usdt,
  recommendation.system_risk_alerts,
  decision.id as human_decision_id,
  decision.decision_scope,
  decision.acceptance_status,
  decision.final_topup_usdt,
  (
    decision.final_topup_usdt
    - recommendation.system_recommended_topup_usdt
  )::numeric(38,8) as topup_adjustment_usdt,
  decision.final_quote_rate,
  (
    decision.final_quote_rate
    - recommendation.system_recommended_quote_rate
  )::numeric(38,12) as quote_adjustment,
  decision.final_execution_decision,
  decision.adjustment_reason,
  decision.reviewed_at,
  outcome.id as latest_outcome_id,
  outcome.outcome_version,
  outcome.actual_topup_usdt,
  outcome.actual_quote_rate,
  outcome.actual_cash_profit_usdt,
  outcome.actual_economic_profit_usdt,
  outcome.actual_risk_outcomes,
  outcome.outcome_reason,
  outcome.measured_at,
  outcome.id is null as pending_outcome,
  true as shadow_mode,
  false as automatic_action
from public.settlement_learning_latest_decisions decision
join public.settlement_learning_recommendations recommendation
  on recommendation.id = decision.recommendation_id
left join public.settlement_decision_latest_outcomes outcome
  on outcome.human_decision_id = decision.id;

create or replace view public.settlement_decision_accuracy_90d
with (security_invoker = true)
as
with evaluated as (
  select
    queue.*,
    case
      when queue.actual_topup_usdt is null
        or queue.system_recommended_topup_usdt is null
        then null
      when queue.actual_topup_usdt = 0
        then queue.system_recommended_topup_usdt = 0
      else
        abs(
          queue.system_recommended_topup_usdt
          - queue.actual_topup_usdt
        ) / queue.actual_topup_usdt <= 0.10
    end as topup_within_ten_percent
  from public.settlement_decision_validation_queue queue
  where queue.recommendation_time >= now() - interval '90 days'
),
risk_evaluated as (
  select
    evaluated.currency,
    risk->>'risk_code' as risk_code,
    (risk->>'realized')::boolean as realized
  from evaluated
  cross join lateral jsonb_array_elements(
    coalesce(evaluated.actual_risk_outcomes, '[]'::jsonb)
  ) risk
)
select
  evaluated.currency,
  90::smallint as learning_window_days,
  count(*)::bigint as reviewed_decision_count,
  count(evaluated.latest_outcome_id)::bigint
    as evaluated_outcome_count,
  count(evaluated.actual_topup_usdt) filter (
    where evaluated.system_recommended_topup_usdt is not null
  )::bigint as topup_evaluable_count,
  avg(
    abs(
      evaluated.system_recommended_topup_usdt
      - evaluated.actual_topup_usdt
    )
  ) filter (
    where evaluated.system_recommended_topup_usdt is not null
      and evaluated.actual_topup_usdt is not null
  )::numeric(38,8) as average_topup_absolute_error_usdt,
  avg(
    evaluated.topup_within_ten_percent::integer
  ) filter (
    where evaluated.topup_within_ten_percent is not null
  )::numeric(18,12) as topup_accuracy_rate,
  count(evaluated.actual_quote_rate) filter (
    where evaluated.system_recommended_quote_rate is not null
  )::bigint as quote_evaluable_count,
  avg(
    abs(
      evaluated.system_recommended_quote_rate
      - evaluated.actual_quote_rate
    )
  ) filter (
    where evaluated.system_recommended_quote_rate is not null
      and evaluated.actual_quote_rate is not null
  )::numeric(38,12) as average_quote_absolute_deviation,
  count(evaluated.actual_cash_profit_usdt) filter (
    where evaluated.system_cash_profit_usdt is not null
  )::bigint as cash_profit_evaluable_count,
  avg(
    abs(
      evaluated.system_cash_profit_usdt
      - evaluated.actual_cash_profit_usdt
    )
  ) filter (
    where evaluated.system_cash_profit_usdt is not null
      and evaluated.actual_cash_profit_usdt is not null
  )::numeric(38,12) as average_cash_profit_absolute_error_usdt,
  count(evaluated.actual_economic_profit_usdt) filter (
    where evaluated.system_economic_profit_usdt is not null
  )::bigint as economic_profit_evaluable_count,
  avg(
    abs(
      evaluated.system_economic_profit_usdt
      - evaluated.actual_economic_profit_usdt
    )
  ) filter (
    where evaluated.system_economic_profit_usdt is not null
      and evaluated.actual_economic_profit_usdt is not null
  )::numeric(38,12) as
    average_economic_profit_absolute_error_usdt,
  (
    select count(*)::bigint
    from risk_evaluated risk
    where risk.currency = evaluated.currency
  ) as risk_evaluable_count,
  (
    select avg(risk.realized::integer)::numeric(18,12)
    from risk_evaluated risk
    where risk.currency = evaluated.currency
  ) as risk_alert_hit_rate,
  max(evaluated.measured_at) as latest_measured_at
from evaluated
group by evaluated.currency;

create or replace view
  public.settlement_daily_merchant_profit_contributions
with (security_invoker = true)
as
with latest_run as (
  select run.id, run.rules_version, run.created_at
  from public.shadow_pricing_runs run
  where run.run_type = 'HISTORICAL_BACKTEST'
  order by run.created_at desc, run.id desc
  limit 1
)
select
  latest_run.id as pricing_run_id,
  latest_run.rules_version as pricing_rules_version,
  latest_run.created_at as pricing_run_time,
  (
    payout.completed_at at time zone 'Asia/Shanghai'
  )::date as profit_date,
  payout.merchant as merchant_name,
  count(*)::bigint as payout_count,
  sum(calculation.merchant_principal_usdt)
    ::numeric(38,12) as merchant_principal_usdt,
  sum(
    calculation.merchant_fee_usdt
    + calculation.dcc_revenue_usdt
    - calculation.upstream_payout_fee_usdt
    - calculation.company_borne_fee_usdt
  )::numeric(38,12) as cash_profit_contribution_usdt,
  sum(calculation.economic_profit_usdt)
    ::numeric(38,12) as economic_profit_contribution_usdt
from latest_run
join public.payout_profit_calculations calculation
  on calculation.pricing_run_id = latest_run.id
join public.payout_orders payout
  on payout.id = calculation.payout_order_id
where payout.completed_at is not null
group by
  latest_run.id,
  latest_run.rules_version,
  latest_run.created_at,
  (
    payout.completed_at at time zone 'Asia/Shanghai'
  )::date,
  payout.merchant;

alter table public.settlement_daily_operation_snapshots
  enable row level security;
alter table public.settlement_decision_outcomes
  enable row level security;

create policy settlement_daily_operation_snapshots_read
on public.settlement_daily_operation_snapshots
for select to authenticated
using (true);

create policy settlement_daily_operation_snapshots_insert
on public.settlement_daily_operation_snapshots
for insert to authenticated
with check (
  (select auth.uid()) = created_by
  and (
    public.has_role('admin'::public.app_role)
    or public.has_role('settlement_operator'::public.app_role)
  )
  and shadow_mode
  and not automatic_payment
  and not automatic_topup
  and not automatic_quote_change
  and not automatic_market_data_collection
  and not automatic_trading
);

create policy settlement_decision_outcomes_read
on public.settlement_decision_outcomes
for select to authenticated
using (true);

create policy settlement_decision_outcomes_insert
on public.settlement_decision_outcomes
for insert to authenticated
with check (
  (select auth.uid()) = recorded_by
  and (
    public.has_role('admin'::public.app_role)
    or public.has_role('settlement_operator'::public.app_role)
    or public.has_role('approver'::public.app_role)
  )
  and shadow_mode
  and not system_execution_performed
  and not automatic_payment
  and not automatic_topup
  and not automatic_quote_change
  and not automatic_trading
);

revoke all on
  public.settlement_daily_operation_snapshots,
  public.settlement_decision_outcomes
from anon, authenticated;
grant select, insert on
  public.settlement_daily_operation_snapshots,
  public.settlement_decision_outcomes
to authenticated;
grant all on
  public.settlement_daily_operation_snapshots,
  public.settlement_decision_outcomes
to service_role;

revoke all on
  public.settlement_daily_operation_latest,
  public.settlement_decision_latest_outcomes,
  public.settlement_decision_validation_queue,
  public.settlement_decision_accuracy_90d,
  public.settlement_daily_merchant_profit_contributions
from anon;
grant select on
  public.settlement_daily_operation_latest,
  public.settlement_decision_latest_outcomes,
  public.settlement_decision_validation_queue,
  public.settlement_decision_accuracy_90d,
  public.settlement_daily_merchant_profit_contributions
to authenticated, service_role;

revoke all on function
  public.record_settlement_decision_outcome_v1(
    uuid,
    uuid,
    timestamptz,
    numeric,
    numeric,
    numeric,
    numeric,
    jsonb,
    text,
    jsonb,
    jsonb
  )
from public, anon;
grant execute on function
  public.record_settlement_decision_outcome_v1(
    uuid,
    uuid,
    timestamptz,
    numeric,
    numeric,
    numeric,
    numeric,
    jsonb,
    text,
    jsonb,
    jsonb
  )
to authenticated, service_role;

create trigger audit_settlement_daily_operation_snapshots
after insert or update or delete
on public.settlement_daily_operation_snapshots
for each row execute function public.audit_mutation();

create trigger audit_settlement_decision_outcomes
after insert or update or delete
on public.settlement_decision_outcomes
for each row execute function public.audit_mutation();

do $$
begin
  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'settlement_daily_operation_snapshots',
        'settlement_decision_outcomes'
      )
      and cmd in ('UPDATE', 'DELETE', 'ALL')
  ) then
    raise exception
      'TASK_2_11_TABLES_MUST_NOT_HAVE_MUTATION_POLICIES';
  end if;
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'settlement_daily_operation_snapshots_immutable'
      and not tgisinternal
  ) or not exists (
    select 1
    from pg_trigger
    where tgname = 'settlement_decision_outcomes_immutable'
      and not tgisinternal
  ) then
    raise exception 'TASK_2_11_IMMUTABILITY_TRIGGER_MISSING';
  end if;
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'settlement_decision_outcomes_consistency'
      and not tgisinternal
  ) then
    raise exception 'TASK_2_11_OUTCOME_CONSISTENCY_TRIGGER_MISSING';
  end if;
  if exists (
    select 1
    from public.settlement_daily_operation_snapshots snapshot
    where not snapshot.shadow_mode
      or snapshot.automatic_payment
      or snapshot.automatic_topup
      or snapshot.automatic_quote_change
      or snapshot.automatic_market_data_collection
      or snapshot.automatic_trading
  ) then
    raise exception 'TASK_2_11_SHADOW_GUARD_FAILED';
  end if;
end
$$;

comment on table public.settlement_daily_operation_snapshots is
  'Immutable daily CEO settlement evidence: funds, pressure, dual profit, FX, topup advice and risks. Advice only.';
comment on table public.settlement_decision_outcomes is
  'Versioned human-observed outcomes used to measure advice accuracy. Recording an outcome never executes an action.';
comment on view public.settlement_decision_accuracy_90d is
  '90-day descriptive accuracy statistics only. It does not optimize models or execute decisions.';
comment on function public.record_settlement_decision_outcome_v1 is
  'Appends a reasoned observed outcome for a human decision. No payment, topup, quote change or trade is performed.';
