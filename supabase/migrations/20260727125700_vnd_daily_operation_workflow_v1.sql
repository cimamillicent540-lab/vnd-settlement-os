-- Task 2.13 — VND Daily Settlement Operating Workflow V1.
-- Three human-triggered, immutable checkpoints: 11:00 decision,
-- 16:00 risk check, and 23:00 end-of-day review.
-- This migration cannot pay, top up, change a quote, or trade.

create table public.daily_operation_decision_snapshots (
  id uuid primary key default gen_random_uuid(),
  client_request_id uuid not null unique,
  operating_date date not null,
  checkpoint_type text not null
    default 'DAY_DECISION_11_00'
    check (checkpoint_type = 'DAY_DECISION_11_00'),
  scheduled_local_time time not null
    default time '11:00:00'
    check (scheduled_local_time = time '11:00:00'),
  captured_at timestamptz not null default now(),
  capture_status text not null
    check (
      capture_status in (
        'EARLY_MANUAL_PREPARATION',
        'ON_TIME',
        'LATE_MANUAL_CAPTURE'
      )
    ),
  currency text not null default 'VND'
    check (currency = 'VND'),
  source_learning_recommendation_id uuid not null
    references public.settlement_learning_recommendations(id),
  source_control_snapshot_id uuid
    references public.settlement_control_center_snapshots(id),
  gross_balance_vnd numeric(38,2) not null
    check (gross_balance_vnd >= 0),
  settleable_balance_vnd numeric(38,2) not null
    check (settleable_balance_vnd >= 0),
  reserve_balance_vnd numeric(38,2) not null
    check (reserve_balance_vnd >= 0),
  available_funds_ratio numeric(18,12) not null
    check (
      available_funds_ratio >= 0
      and available_funds_ratio <= 1
    ),
  settleable_ratio numeric(18,12) not null
    default 0.50
    check (settleable_ratio = 0.50),
  safety_buffer_ratio numeric(18,12) not null
    default 0.10
    check (safety_buffer_ratio = 0.10),
  forecast_payin_vnd numeric(38,2) not null
    check (forecast_payin_vnd >= 0),
  forecast_payout_vnd numeric(38,2) not null
    check (forecast_payout_vnd >= 0),
  forecast_net_demand_vnd numeric(38,2) not null
    check (forecast_net_demand_vnd >= 0),
  peak_16_23_pressure_vnd numeric(38,2) not null
    check (peak_16_23_pressure_vnd >= 0),
  required_settleable_with_buffer_vnd numeric(38,2) not null
    check (required_settleable_with_buffer_vnd >= 0),
  projected_shortfall_vnd numeric(38,2) not null
    check (projected_shortfall_vnd >= 0),
  required_gross_topup_vnd numeric(38,2) not null
    check (required_gross_topup_vnd >= 0),
  topup_recommended boolean not null,
  recommended_topup_usdt numeric(38,8)
    check (
      recommended_topup_usdt is null
      or recommended_topup_usdt >= 0
    ),
  recommended_coverage_time text not null
    check (
      recommended_coverage_time in (
        'NO_TOPUP',
        'IMMEDIATE_MANUAL_REVIEW',
        'BEFORE_16_00',
        'WHEN_OPERATOR_CONFIRMS_P2P_QUOTE'
      )
    ),
  topup_reasons jsonb not null
    check (
      jsonb_typeof(topup_reasons) = 'array'
      and jsonb_array_length(topup_reasons) > 0
    ),
  binance_p2p_rate numeric(38,12) not null
    check (binance_p2p_rate > 0),
  upstream_quote_rate numeric(38,12) not null
    check (upstream_quote_rate > 0),
  xe_rate numeric(38,12) not null
    check (xe_rate > 0),
  best_vnd_source_rate numeric(38,12) not null
    check (best_vnd_source_rate > 0),
  fx_opportunity_spread_vnd_per_usdt numeric(38,12) not null,
  fx_opportunity_spread_ratio numeric(18,12) not null,
  fx_opportunity_status text not null
    check (
      fx_opportunity_status in (
        'ARBITRAGE_SPACE',
        'NORMAL',
        'RISK'
      )
    ),
  arbitrage_space_exists boolean not null,
  fx_observation_snapshot jsonb not null
    check (jsonb_typeof(fx_observation_snapshot) = 'object'),
  data_cutoff_snapshot jsonb not null default '{}'::jsonb
    check (jsonb_typeof(data_cutoff_snapshot) = 'object'),
  rules_version text not null
    default 'VND_DAILY_OPERATION_WORKFLOW_V1',
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
    gross_balance_vnd = 0
    or abs(
      available_funds_ratio
      - settleable_balance_vnd / gross_balance_vnd
    ) <= 0.000000000001
  ),
  check (
    topup_recommended = (projected_shortfall_vnd > 0)
  ),
  check (
    (not topup_recommended)
    or (
      recommended_topup_usdt is not null
      and recommended_topup_usdt > 0
    )
  ),
  check (
    arbitrage_space_exists
    = (fx_opportunity_status = 'ARBITRAGE_SPACE')
  )
);

create index daily_operation_decision_latest_idx
  on public.daily_operation_decision_snapshots(
    currency,
    operating_date desc,
    captured_at desc,
    id desc
  );
create index daily_operation_decision_learning_idx
  on public.daily_operation_decision_snapshots(
    source_learning_recommendation_id
  );
create index daily_operation_decision_control_idx
  on public.daily_operation_decision_snapshots(
    source_control_snapshot_id
  )
  where source_control_snapshot_id is not null;
create index daily_operation_decision_created_by_idx
  on public.daily_operation_decision_snapshots(created_by);

create table public.daily_operation_risk_checks (
  id uuid primary key default gen_random_uuid(),
  client_request_id uuid not null unique,
  operating_date date not null,
  checkpoint_type text not null
    default 'RISK_CHECK_16_00'
    check (checkpoint_type = 'RISK_CHECK_16_00'),
  scheduled_local_time time not null
    default time '16:00:00'
    check (scheduled_local_time = time '16:00:00'),
  captured_at timestamptz not null default now(),
  capture_status text not null
    check (
      capture_status in (
        'EARLY_MANUAL_PREPARATION',
        'ON_TIME',
        'LATE_MANUAL_CAPTURE'
      )
    ),
  currency text not null default 'VND'
    check (currency = 'VND'),
  day_decision_snapshot_id uuid not null
    references public.daily_operation_decision_snapshots(id),
  settleable_balance_vnd numeric(38,2) not null
    check (settleable_balance_vnd >= 0),
  projected_shortfall_vnd numeric(38,2) not null
    check (projected_shortfall_vnd >= 0),
  maximum_hourly_payout_concentration numeric(18,12)
    check (
      maximum_hourly_payout_concentration is null
      or (
        maximum_hourly_payout_concentration >= 0
        and maximum_hourly_payout_concentration <= 1
      )
    ),
  economic_profit_margin numeric(18,12),
  fx_spread_ratio numeric(18,12),
  payout_concentration_risk boolean not null,
  settleable_insufficient_risk boolean not null,
  profit_below_0_2_percent_risk boolean not null,
  fx_anomaly_risk boolean not null,
  international_market_risk boolean not null,
  risk_score smallint not null
    check (risk_score between 0 and 5),
  risk_level text not null
    check (risk_level in ('LOW', 'MEDIUM', 'HIGH')),
  risk_alerts jsonb not null
    check (jsonb_typeof(risk_alerts) = 'array'),
  international_market_notes jsonb not null default '[]'::jsonb
    check (jsonb_typeof(international_market_notes) = 'array'),
  data_cutoff_snapshot jsonb not null default '{}'::jsonb
    check (jsonb_typeof(data_cutoff_snapshot) = 'object'),
  rules_version text not null
    default 'VND_DAILY_OPERATION_WORKFLOW_V1',
  shadow_mode boolean not null default true check (shadow_mode),
  automatic_payment boolean not null default false
    check (automatic_payment = false),
  automatic_topup boolean not null default false
    check (automatic_topup = false),
  automatic_quote_change boolean not null default false
    check (automatic_quote_change = false),
  automatic_trading boolean not null default false
    check (automatic_trading = false),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  check (
    risk_score
    = payout_concentration_risk::integer
      + settleable_insufficient_risk::integer
      + profit_below_0_2_percent_risk::integer
      + fx_anomaly_risk::integer
      + international_market_risk::integer
  ),
  check (
    risk_level = case
      when settleable_insufficient_risk or risk_score >= 3
        then 'HIGH'
      when risk_score > 0 then 'MEDIUM'
      else 'LOW'
    end
  )
);

create index daily_operation_risk_latest_idx
  on public.daily_operation_risk_checks(
    currency,
    operating_date desc,
    captured_at desc,
    id desc
  );
create index daily_operation_risk_day_decision_idx
  on public.daily_operation_risk_checks(
    day_decision_snapshot_id
  );
create index daily_operation_risk_created_by_idx
  on public.daily_operation_risk_checks(created_by);

create table public.settlement_decision_reason_classifications (
  id uuid primary key default gen_random_uuid(),
  client_request_id uuid not null unique,
  human_decision_id uuid not null unique
    references public.settlement_human_decisions(id),
  reason_category text not null
    check (
      reason_category in (
        'MARKET_COMPETITION',
        'MERCHANT_RELATIONSHIP',
        'FX_OPPORTUNITY',
        'RISK_CONTROL',
        'FUNDING_ARRANGEMENT',
        'OTHER'
      )
    ),
  classified_reason text not null
    check (char_length(btrim(classified_reason)) between 1 and 1000),
  recorded_by uuid not null references auth.users(id),
  learning_window_days smallint not null default 90
    check (learning_window_days = 90),
  shadow_mode boolean not null default true check (shadow_mode),
  automatic_action boolean not null default false
    check (automatic_action = false),
  created_at timestamptz not null default now()
);

create index settlement_decision_reason_category_idx
  on public.settlement_decision_reason_classifications(
    reason_category,
    created_at desc
  );
create index settlement_decision_reason_recorded_by_idx
  on public.settlement_decision_reason_classifications(recorded_by);

create table public.daily_operation_end_reviews (
  id uuid primary key default gen_random_uuid(),
  client_request_id uuid not null unique,
  operating_date date not null,
  checkpoint_type text not null
    default 'END_REVIEW_23_00'
    check (checkpoint_type = 'END_REVIEW_23_00'),
  scheduled_local_time time not null
    default time '23:00:00'
    check (scheduled_local_time = time '23:00:00'),
  captured_at timestamptz not null default now(),
  capture_status text not null
    check (
      capture_status in (
        'EARLY_MANUAL_PREPARATION',
        'ON_TIME',
        'LATE_MANUAL_CAPTURE'
      )
    ),
  currency text not null default 'VND'
    check (currency = 'VND'),
  day_decision_snapshot_id uuid not null
    references public.daily_operation_decision_snapshots(id),
  risk_check_id uuid not null
    references public.daily_operation_risk_checks(id),
  source_daily_report_snapshot_id uuid
    references public.settlement_daily_operation_snapshots(id),
  source_learning_recommendation_id uuid not null
    references public.settlement_learning_recommendations(id),
  human_decision_id uuid not null unique
    references public.settlement_human_decisions(id),
  reason_classification_id uuid not null unique
    references public.settlement_decision_reason_classifications(id),
  decision_outcome_id uuid not null unique
    references public.settlement_decision_outcomes(id),
  cash_profit_usdt numeric(38,12) not null,
  economic_profit_usdt numeric(38,12) not null,
  system_recommendations_snapshot jsonb not null
    check (
      jsonb_typeof(system_recommendations_snapshot) = 'object'
    ),
  human_final_decision_snapshot jsonb not null
    check (
      jsonb_typeof(human_final_decision_snapshot) = 'object'
    ),
  acceptance_status text not null
    check (
      acceptance_status in (
        'ACCEPTED',
        'MODIFIED',
        'REJECTED'
      )
    ),
  adjustment_reason_category text not null
    check (
      adjustment_reason_category in (
        'MARKET_COMPETITION',
        'MERCHANT_RELATIONSHIP',
        'FX_OPPORTUNITY',
        'RISK_CONTROL',
        'FUNDING_ARRANGEMENT',
        'OTHER'
      )
    ),
  adjustment_reason text not null
    check (char_length(btrim(adjustment_reason)) between 1 and 1000),
  final_topup_usdt numeric(38,8)
    check (final_topup_usdt is null or final_topup_usdt >= 0),
  final_quote_rate numeric(38,12)
    check (final_quote_rate is null or final_quote_rate > 0),
  final_execution_decision text not null
    check (
      final_execution_decision in (
        'ACCEPT_FOR_MANUAL_EXECUTION',
        'DO_NOT_EXECUTE',
        'DEFER',
        'NOT_APPLICABLE'
      )
    ),
  risk_feedback_snapshot jsonb not null default '[]'::jsonb
    check (jsonb_typeof(risk_feedback_snapshot) = 'array'),
  learning_record_snapshot jsonb not null
    check (jsonb_typeof(learning_record_snapshot) = 'object'),
  data_cutoff_snapshot jsonb not null default '{}'::jsonb
    check (jsonb_typeof(data_cutoff_snapshot) = 'object'),
  learning_window_days smallint not null default 90
    check (learning_window_days = 90),
  rules_version text not null
    default 'VND_DAILY_OPERATION_WORKFLOW_V1',
  shadow_mode boolean not null default true check (shadow_mode),
  actual_execution_performed boolean not null default false
    check (actual_execution_performed = false),
  automatic_payment boolean not null default false
    check (automatic_payment = false),
  automatic_topup boolean not null default false
    check (automatic_topup = false),
  automatic_quote_change boolean not null default false
    check (automatic_quote_change = false),
  automatic_trading boolean not null default false
    check (automatic_trading = false),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create index daily_operation_end_latest_idx
  on public.daily_operation_end_reviews(
    currency,
    operating_date desc,
    captured_at desc,
    id desc
  );
create index daily_operation_end_day_decision_idx
  on public.daily_operation_end_reviews(
    day_decision_snapshot_id
  );
create index daily_operation_end_risk_check_idx
  on public.daily_operation_end_reviews(risk_check_id);
create index daily_operation_end_learning_idx
  on public.daily_operation_end_reviews(
    source_learning_recommendation_id
  );
create index daily_operation_end_daily_report_idx
  on public.daily_operation_end_reviews(
    source_daily_report_snapshot_id
  )
  where source_daily_report_snapshot_id is not null;
create index daily_operation_end_created_by_idx
  on public.daily_operation_end_reviews(created_by);

create or replace function
  private.reject_daily_operation_workflow_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception
    'DAILY_OPERATION_HISTORY_IS_IMMUTABLE_APPEND_A_NEW_RECORD';
end
$$;

create trigger daily_operation_decision_snapshots_immutable
before update or delete
on public.daily_operation_decision_snapshots
for each row execute function
  private.reject_daily_operation_workflow_mutation();

create trigger daily_operation_risk_checks_immutable
before update or delete
on public.daily_operation_risk_checks
for each row execute function
  private.reject_daily_operation_workflow_mutation();

create trigger settlement_decision_reason_classifications_immutable
before update or delete
on public.settlement_decision_reason_classifications
for each row execute function
  private.reject_daily_operation_workflow_mutation();

create trigger daily_operation_end_reviews_immutable
before update or delete
on public.daily_operation_end_reviews
for each row execute function
  private.reject_daily_operation_workflow_mutation();

create or replace function
  private.validate_daily_operation_workflow_links()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  day_row public.daily_operation_decision_snapshots%rowtype;
  risk_row public.daily_operation_risk_checks%rowtype;
  decision_row public.settlement_human_decisions%rowtype;
  classification_row
    public.settlement_decision_reason_classifications%rowtype;
  outcome_row public.settlement_decision_outcomes%rowtype;
begin
  if tg_table_name = 'daily_operation_risk_checks' then
    select *
    into day_row
    from public.daily_operation_decision_snapshots day_snapshot
    where day_snapshot.id = new.day_decision_snapshot_id;
    if not found
      or day_row.operating_date <> new.operating_date
      or day_row.currency <> new.currency then
      raise exception 'RISK_CHECK_DAY_DECISION_MISMATCH';
    end if;
    return new;
  end if;

  if tg_table_name
    = 'settlement_decision_reason_classifications' then
    select *
    into decision_row
    from public.settlement_human_decisions decision
    where decision.id = new.human_decision_id;
    if not found
      or decision_row.reviewer_id <> new.recorded_by
      or btrim(decision_row.adjustment_reason)
        <> btrim(new.classified_reason) then
      raise exception 'DECISION_REASON_CLASSIFICATION_MISMATCH';
    end if;
    return new;
  end if;

  select *
  into day_row
  from public.daily_operation_decision_snapshots day_snapshot
  where day_snapshot.id = new.day_decision_snapshot_id;
  select *
  into risk_row
  from public.daily_operation_risk_checks risk_check
  where risk_check.id = new.risk_check_id;
  select *
  into decision_row
  from public.settlement_human_decisions decision
  where decision.id = new.human_decision_id;
  select *
  into classification_row
  from public.settlement_decision_reason_classifications classification
  where classification.id = new.reason_classification_id;
  select *
  into outcome_row
  from public.settlement_decision_outcomes outcome
  where outcome.id = new.decision_outcome_id;

  if day_row.id is null
    or risk_row.id is null
    or decision_row.id is null
    or classification_row.id is null
    or outcome_row.id is null then
    raise exception 'DAILY_END_REVIEW_SOURCE_MISSING';
  end if;
  if day_row.operating_date <> new.operating_date
    or risk_row.operating_date <> new.operating_date
    or risk_row.day_decision_snapshot_id <> day_row.id
    or day_row.source_learning_recommendation_id
      <> new.source_learning_recommendation_id then
    raise exception 'DAILY_END_REVIEW_CHECKPOINT_MISMATCH';
  end if;
  if decision_row.recommendation_id
      <> new.source_learning_recommendation_id
    or decision_row.acceptance_status <> new.acceptance_status
    or btrim(decision_row.adjustment_reason)
      <> btrim(new.adjustment_reason)
    or classification_row.human_decision_id <> decision_row.id
    or classification_row.reason_category
      <> new.adjustment_reason_category
    or outcome_row.human_decision_id <> decision_row.id
    or outcome_row.recommendation_id
      <> new.source_learning_recommendation_id then
    raise exception 'DAILY_END_REVIEW_LEARNING_LINK_MISMATCH';
  end if;
  return new;
end
$$;

create trigger daily_operation_risk_checks_consistency
before insert on public.daily_operation_risk_checks
for each row execute function
  private.validate_daily_operation_workflow_links();

create trigger settlement_decision_reason_classifications_consistency
before insert on public.settlement_decision_reason_classifications
for each row execute function
  private.validate_daily_operation_workflow_links();

create trigger daily_operation_end_reviews_consistency
before insert on public.daily_operation_end_reviews
for each row execute function
  private.validate_daily_operation_workflow_links();

create or replace function
  public.record_settlement_human_decision_v2(
    p_client_request_id uuid,
    p_recommendation_id uuid,
    p_decision_scope text,
    p_acceptance_status text,
    p_final_topup_usdt numeric,
    p_final_quote_rate numeric,
    p_final_execution_decision text,
    p_adjustment_reason_category text,
    p_adjustment_reason text,
    p_merchant_name text default null,
    p_transaction_volume_usdt numeric default null,
    p_profit_contribution_usdt numeric default null,
    p_risk_feedback jsonb default '[]'::jsonb
  )
returns table(
  decision_id uuid,
  decision_version integer,
  reason_classification_id uuid,
  idempotent_replay boolean
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  existing_classification
    public.settlement_decision_reason_classifications%rowtype;
  existing_decision public.settlement_human_decisions%rowtype;
  inserted_decision_id uuid;
  inserted_decision_version integer;
  inserted_classification_id uuid;
begin
  if p_client_request_id is null then
    raise exception 'CLIENT_REQUEST_ID_REQUIRED';
  end if;
  if p_adjustment_reason_category not in (
    'MARKET_COMPETITION',
    'MERCHANT_RELATIONSHIP',
    'FX_OPPORTUNITY',
    'RISK_CONTROL',
    'FUNDING_ARRANGEMENT',
    'OTHER'
  ) then
    raise exception 'INVALID_ADJUSTMENT_REASON_CATEGORY';
  end if;
  if p_adjustment_reason is null
    or char_length(btrim(p_adjustment_reason)) = 0 then
    raise exception 'ADJUSTMENT_REASON_REQUIRED';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_client_request_id::text, 0)
  );

  select *
  into existing_classification
  from public.settlement_decision_reason_classifications classification
  where classification.client_request_id = p_client_request_id;
  if found then
    select *
    into existing_decision
    from public.settlement_human_decisions decision
    where decision.id = existing_classification.human_decision_id;
    return query select
      existing_decision.id,
      existing_decision.decision_version,
      existing_classification.id,
      true;
    return;
  end if;

  select
    recorded.decision_id,
    recorded.decision_version
  into
    inserted_decision_id,
    inserted_decision_version
  from public.record_settlement_human_decision_v1(
    p_recommendation_id,
    p_decision_scope,
    p_acceptance_status,
    p_final_topup_usdt,
    p_final_quote_rate,
    p_final_execution_decision,
    p_adjustment_reason,
    p_merchant_name,
    p_transaction_volume_usdt,
    p_profit_contribution_usdt,
    p_risk_feedback
  ) recorded;

  insert into public.settlement_decision_reason_classifications(
    client_request_id,
    human_decision_id,
    reason_category,
    classified_reason,
    recorded_by,
    learning_window_days,
    shadow_mode,
    automatic_action
  )
  values (
    p_client_request_id,
    inserted_decision_id,
    p_adjustment_reason_category,
    btrim(p_adjustment_reason),
    (select auth.uid()),
    90,
    true,
    false
  )
  returning id into inserted_classification_id;

  return query select
    inserted_decision_id,
    inserted_decision_version,
    inserted_classification_id,
    false;
end
$$;

create or replace view public.daily_operation_latest_day_decisions
with (security_invoker = true)
as
select distinct on (
  snapshot.currency,
  snapshot.operating_date
)
  snapshot.*
from public.daily_operation_decision_snapshots snapshot
order by
  snapshot.currency,
  snapshot.operating_date,
  snapshot.captured_at desc,
  snapshot.id desc;

create or replace view public.daily_operation_latest_risk_checks
with (security_invoker = true)
as
select distinct on (
  risk_check.currency,
  risk_check.operating_date
)
  risk_check.*
from public.daily_operation_risk_checks risk_check
order by
  risk_check.currency,
  risk_check.operating_date,
  risk_check.captured_at desc,
  risk_check.id desc;

create or replace view public.daily_operation_latest_end_reviews
with (security_invoker = true)
as
select distinct on (
  end_review.currency,
  end_review.operating_date
)
  end_review.*
from public.daily_operation_end_reviews end_review
order by
  end_review.currency,
  end_review.operating_date,
  end_review.captured_at desc,
  end_review.id desc;

create or replace view public.daily_operation_workflow_status
with (security_invoker = true)
as
with workflow_days as (
  select currency, operating_date
  from public.daily_operation_decision_snapshots
  union
  select currency, operating_date
  from public.daily_operation_risk_checks
  union
  select currency, operating_date
  from public.daily_operation_end_reviews
)
select
  workflow_days.currency,
  workflow_days.operating_date,
  day_snapshot.id as day_decision_snapshot_id,
  day_snapshot.captured_at as day_decision_captured_at,
  day_snapshot.topup_recommended,
  day_snapshot.recommended_topup_usdt,
  day_snapshot.fx_opportunity_status,
  risk_check.id as risk_check_id,
  risk_check.captured_at as risk_check_captured_at,
  risk_check.risk_level,
  risk_check.risk_score,
  end_review.id as end_review_id,
  end_review.captured_at as end_review_captured_at,
  end_review.cash_profit_usdt,
  end_review.economic_profit_usdt,
  end_review.acceptance_status,
  end_review.adjustment_reason_category,
  day_snapshot.id is not null as day_decision_complete,
  risk_check.id is not null as risk_check_complete,
  end_review.id is not null as end_review_complete,
  true as shadow_mode,
  false as automatic_action
from workflow_days
left join public.daily_operation_latest_day_decisions day_snapshot
  on day_snapshot.currency = workflow_days.currency
  and day_snapshot.operating_date = workflow_days.operating_date
left join public.daily_operation_latest_risk_checks risk_check
  on risk_check.currency = workflow_days.currency
  and risk_check.operating_date = workflow_days.operating_date
left join public.daily_operation_latest_end_reviews end_review
  on end_review.currency = workflow_days.currency
  and end_review.operating_date = workflow_days.operating_date;

alter table public.daily_operation_decision_snapshots
  enable row level security;
alter table public.daily_operation_risk_checks
  enable row level security;
alter table public.settlement_decision_reason_classifications
  enable row level security;
alter table public.daily_operation_end_reviews
  enable row level security;

create policy daily_operation_decision_snapshots_read
on public.daily_operation_decision_snapshots
for select to authenticated
using (true);

create policy daily_operation_decision_snapshots_insert
on public.daily_operation_decision_snapshots
for insert to authenticated
with check (
  (select auth.uid()) = created_by
  and (
    (select public.has_role('admin'::public.app_role))
    or (
      select public.has_role(
        'settlement_operator'::public.app_role
      )
    )
  )
  and shadow_mode
  and not automatic_payment
  and not automatic_topup
  and not automatic_quote_change
  and not automatic_market_data_collection
  and not automatic_trading
);

create policy daily_operation_risk_checks_read
on public.daily_operation_risk_checks
for select to authenticated
using (true);

create policy daily_operation_risk_checks_insert
on public.daily_operation_risk_checks
for insert to authenticated
with check (
  (select auth.uid()) = created_by
  and (
    (select public.has_role('admin'::public.app_role))
    or (
      select public.has_role(
        'settlement_operator'::public.app_role
      )
    )
  )
  and shadow_mode
  and not automatic_payment
  and not automatic_topup
  and not automatic_quote_change
  and not automatic_trading
);

create policy settlement_decision_reason_classifications_read
on public.settlement_decision_reason_classifications
for select to authenticated
using (true);

create policy settlement_decision_reason_classifications_insert
on public.settlement_decision_reason_classifications
for insert to authenticated
with check (
  (select auth.uid()) = recorded_by
  and (
    (select public.has_role('admin'::public.app_role))
    or (
      select public.has_role(
        'settlement_operator'::public.app_role
      )
    )
    or (select public.has_role('approver'::public.app_role))
  )
  and shadow_mode
  and not automatic_action
);

create policy daily_operation_end_reviews_read
on public.daily_operation_end_reviews
for select to authenticated
using (true);

create policy daily_operation_end_reviews_insert
on public.daily_operation_end_reviews
for insert to authenticated
with check (
  (select auth.uid()) = created_by
  and (
    (select public.has_role('admin'::public.app_role))
    or (
      select public.has_role(
        'settlement_operator'::public.app_role
      )
    )
    or (select public.has_role('approver'::public.app_role))
  )
  and shadow_mode
  and not actual_execution_performed
  and not automatic_payment
  and not automatic_topup
  and not automatic_quote_change
  and not automatic_trading
);

revoke all on
  public.daily_operation_decision_snapshots,
  public.daily_operation_risk_checks,
  public.settlement_decision_reason_classifications,
  public.daily_operation_end_reviews
from anon, authenticated;

grant select, insert on
  public.daily_operation_decision_snapshots,
  public.daily_operation_risk_checks,
  public.settlement_decision_reason_classifications,
  public.daily_operation_end_reviews
to authenticated;

grant all on
  public.daily_operation_decision_snapshots,
  public.daily_operation_risk_checks,
  public.settlement_decision_reason_classifications,
  public.daily_operation_end_reviews
to service_role;

revoke all on
  public.daily_operation_latest_day_decisions,
  public.daily_operation_latest_risk_checks,
  public.daily_operation_latest_end_reviews,
  public.daily_operation_workflow_status
from anon;

grant select on
  public.daily_operation_latest_day_decisions,
  public.daily_operation_latest_risk_checks,
  public.daily_operation_latest_end_reviews,
  public.daily_operation_workflow_status
to authenticated, service_role;

revoke all on function
  public.record_settlement_human_decision_v2(
    uuid,
    uuid,
    text,
    text,
    numeric,
    numeric,
    text,
    text,
    text,
    text,
    numeric,
    numeric,
    jsonb
  )
from public, anon;

grant execute on function
  public.record_settlement_human_decision_v2(
    uuid,
    uuid,
    text,
    text,
    numeric,
    numeric,
    text,
    text,
    text,
    text,
    numeric,
    numeric,
    jsonb
  )
to authenticated, service_role;

create trigger audit_daily_operation_decision_snapshots
after insert or update or delete
on public.daily_operation_decision_snapshots
for each row execute function public.audit_mutation();

create trigger audit_daily_operation_risk_checks
after insert or update or delete
on public.daily_operation_risk_checks
for each row execute function public.audit_mutation();

create trigger audit_settlement_decision_reason_classifications
after insert or update or delete
on public.settlement_decision_reason_classifications
for each row execute function public.audit_mutation();

create trigger audit_daily_operation_end_reviews
after insert or update or delete
on public.daily_operation_end_reviews
for each row execute function public.audit_mutation();

do $$
begin
  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'daily_operation_decision_snapshots',
        'daily_operation_risk_checks',
        'settlement_decision_reason_classifications',
        'daily_operation_end_reviews'
      )
      and cmd in ('UPDATE', 'DELETE', 'ALL')
  ) then
    raise exception
      'DAILY_OPERATION_TABLES_MUST_NOT_HAVE_MUTATION_POLICIES';
  end if;
  if (
    select count(*)
    from pg_trigger
    where tgname in (
      'daily_operation_decision_snapshots_immutable',
      'daily_operation_risk_checks_immutable',
      'settlement_decision_reason_classifications_immutable',
      'daily_operation_end_reviews_immutable'
    )
      and not tgisinternal
  ) <> 4 then
    raise exception 'DAILY_OPERATION_IMMUTABILITY_TRIGGER_MISSING';
  end if;
  if exists (
    select 1
    from public.daily_operation_decision_snapshots snapshot
    where not snapshot.shadow_mode
      or snapshot.automatic_payment
      or snapshot.automatic_topup
      or snapshot.automatic_quote_change
      or snapshot.automatic_market_data_collection
      or snapshot.automatic_trading
  ) or exists (
    select 1
    from public.daily_operation_risk_checks risk_check
    where not risk_check.shadow_mode
      or risk_check.automatic_payment
      or risk_check.automatic_topup
      or risk_check.automatic_quote_change
      or risk_check.automatic_trading
  ) or exists (
    select 1
    from public.daily_operation_end_reviews end_review
    where not end_review.shadow_mode
      or end_review.actual_execution_performed
      or end_review.automatic_payment
      or end_review.automatic_topup
      or end_review.automatic_quote_change
      or end_review.automatic_trading
  ) then
    raise exception 'TASK_2_13_SHADOW_GUARD_FAILED';
  end if;
end
$$;

comment on table public.daily_operation_decision_snapshots is
  'Immutable human-triggered 11:00 VND decision snapshots. Advice only.';
comment on table public.daily_operation_risk_checks is
  'Immutable human-triggered 16:00 VND risk checks. Alerts only.';
comment on table
  public.settlement_decision_reason_classifications is
  'Immutable reason categories extending existing 90-day human decision learning records.';
comment on table public.daily_operation_end_reviews is
  'Immutable human-triggered 23:00 review linking dual profit, advice, human decision, and observed outcome.';
comment on function
  public.record_settlement_human_decision_v2 is
  'Appends an existing learning decision plus required reason category. It performs no financial action.';
