-- Task 2.14 — VND Shadow Validation Period V1.
-- Declares immutable seven-day periods and appends one evidence-backed
-- validation result per completed operating day. Statistics only.
-- This migration cannot pay, top up, change a quote, or trade.

create table public.shadow_validation_periods (
  id uuid primary key default gen_random_uuid(),
  client_request_id uuid not null unique,
  currency text not null default 'VND'
    check (currency = 'VND'),
  start_date date not null,
  end_date date not null,
  validation_days smallint not null default 7
    check (validation_days = 7),
  rules_version text not null
    default 'VND_SHADOW_VALIDATION_PERIOD_V1',
  created_by uuid not null references auth.users(id),
  shadow_mode boolean not null default true
    check (shadow_mode),
  automatic_payment boolean not null default false
    check (automatic_payment = false),
  automatic_topup boolean not null default false
    check (automatic_topup = false),
  automatic_quote_change boolean not null default false
    check (automatic_quote_change = false),
  automatic_trading boolean not null default false
    check (automatic_trading = false),
  automatic_optimization boolean not null default false
    check (automatic_optimization = false),
  created_at timestamptz not null default now(),
  unique (currency, start_date),
  check (end_date = start_date + 6)
);

create index shadow_validation_periods_window_idx
  on public.shadow_validation_periods(
    currency,
    start_date desc,
    end_date desc,
    id desc
  );
create index shadow_validation_periods_created_by_idx
  on public.shadow_validation_periods(created_by);

create table public.shadow_validation_daily_records (
  id uuid primary key default gen_random_uuid(),
  client_request_id uuid not null unique,
  period_id uuid not null
    references public.shadow_validation_periods(id),
  validation_date date not null,
  day_number smallint not null check (day_number between 1 and 7),
  currency text not null default 'VND'
    check (currency = 'VND'),
  source_end_review_id uuid not null unique
    references public.daily_operation_end_reviews(id),
  recommendation_id uuid not null
    references public.settlement_learning_recommendations(id),
  human_decision_id uuid not null
    references public.settlement_human_decisions(id),
  decision_outcome_id uuid not null unique
    references public.settlement_decision_outcomes(id),
  reason_classification_id uuid not null
    references public.settlement_decision_reason_classifications(id),

  system_topup_recommended boolean not null,
  system_recommended_topup_usdt numeric(38,8)
    check (
      system_recommended_topup_usdt is null
      or system_recommended_topup_usdt >= 0
    ),
  system_recommended_quote_rate numeric(38,12)
    check (
      system_recommended_quote_rate is null
      or system_recommended_quote_rate > 0
    ),
  system_predicted_cash_profit_usdt numeric(38,12),
  system_predicted_economic_profit_usdt numeric(38,12),
  system_predicted_fx_gain_usdt numeric(38,12),
  system_predicted_risk_alerts jsonb not null default '[]'::jsonb
    check (jsonb_typeof(system_predicted_risk_alerts) = 'array'),
  system_risk_level text not null
    check (system_risk_level in ('LOW', 'MEDIUM', 'HIGH')),

  acceptance_status text not null
    check (
      acceptance_status in ('ACCEPTED', 'MODIFIED', 'REJECTED')
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

  actual_topup_usdt numeric(38,8) not null
    check (actual_topup_usdt >= 0),
  actual_quote_rate numeric(38,12) not null
    check (actual_quote_rate > 0),
  actual_cash_profit_usdt numeric(38,12) not null,
  actual_economic_profit_usdt numeric(38,12) not null,
  actual_fx_gain_usdt numeric(38,12) not null,
  actual_funding_pressure_before_vnd numeric(38,2) not null
    check (actual_funding_pressure_before_vnd >= 0),
  actual_funding_pressure_after_vnd numeric(38,2) not null
    check (actual_funding_pressure_after_vnd >= 0),
  actual_risk_outcomes jsonb not null default '[]'::jsonb
    check (jsonb_typeof(actual_risk_outcomes) = 'array'),
  unexpected_risk_count smallint not null default 0
    check (unexpected_risk_count between 0 and 100),
  unexpected_risk_notes text
    check (
      unexpected_risk_notes is null
      or char_length(btrim(unexpected_risk_notes)) between 1 and 2000
    ),

  topup_absolute_error_usdt numeric(38,12) not null
    check (topup_absolute_error_usdt >= 0),
  topup_relative_error numeric(18,12) not null
    check (topup_relative_error between 0 and 1),
  topup_accuracy_score numeric(18,12) not null
    check (topup_accuracy_score between 0 and 1),
  topup_within_ten_percent boolean not null,
  quote_absolute_deviation numeric(38,12)
    check (
      quote_absolute_deviation is null
      or quote_absolute_deviation >= 0
    ),
  quote_adopted boolean,
  quote_adoption_score numeric(18,12)
    check (
      quote_adoption_score is null
      or quote_adoption_score between 0 and 1
    ),
  cash_profit_absolute_error_usdt numeric(38,12)
    check (
      cash_profit_absolute_error_usdt is null
      or cash_profit_absolute_error_usdt >= 0
    ),
  economic_profit_absolute_error_usdt numeric(38,12)
    check (
      economic_profit_absolute_error_usdt is null
      or economic_profit_absolute_error_usdt >= 0
    ),
  profit_prediction_score numeric(18,12)
    check (
      profit_prediction_score is null
      or profit_prediction_score between 0 and 1
    ),
  predicted_risk_count smallint not null
    check (predicted_risk_count between 0 and 100),
  realized_predicted_risk_count smallint not null
    check (
      realized_predicted_risk_count between 0
      and predicted_risk_count
    ),
  risk_prediction_accuracy_score numeric(18,12) not null
    check (risk_prediction_accuracy_score between 0 and 1),
  fx_gain_absolute_error_usdt numeric(38,12)
    check (
      fx_gain_absolute_error_usdt is null
      or fx_gain_absolute_error_usdt >= 0
    ),
  funding_pressure_improved boolean not null,
  ai_accuracy_score numeric(9,6) not null
    check (ai_accuracy_score between 0 and 100),
  score_component_count smallint not null
    check (score_component_count between 2 and 4),

  data_cutoff_snapshot jsonb not null default '{}'::jsonb
    check (jsonb_typeof(data_cutoff_snapshot) = 'object'),
  rules_version text not null
    default 'VND_SHADOW_VALIDATION_PERIOD_V1',
  recorded_by uuid not null references auth.users(id),
  shadow_mode boolean not null default true
    check (shadow_mode),
  automatic_payment boolean not null default false
    check (automatic_payment = false),
  automatic_topup boolean not null default false
    check (automatic_topup = false),
  automatic_quote_change boolean not null default false
    check (automatic_quote_change = false),
  automatic_trading boolean not null default false
    check (automatic_trading = false),
  automatic_optimization boolean not null default false
    check (automatic_optimization = false),
  actual_execution_performed boolean not null default false
    check (actual_execution_performed = false),
  created_at timestamptz not null default now(),
  unique (period_id, validation_date),
  unique (period_id, day_number),
  check (
    unexpected_risk_count = 0
    or unexpected_risk_notes is not null
  ),
  check (
    (quote_adopted is null)
      = (system_recommended_quote_rate is null)
  ),
  check (
    (quote_adoption_score is null)
      = (system_recommended_quote_rate is null)
  ),
  check (
    (quote_absolute_deviation is null)
      = (system_recommended_quote_rate is null)
  ),
  check (
    (cash_profit_absolute_error_usdt is null)
      = (system_predicted_cash_profit_usdt is null)
  ),
  check (
    (economic_profit_absolute_error_usdt is null)
      = (system_predicted_economic_profit_usdt is null)
  ),
  check (
    (profit_prediction_score is null)
      = (
        system_predicted_cash_profit_usdt is null
        and system_predicted_economic_profit_usdt is null
      )
  ),
  check (
    (fx_gain_absolute_error_usdt is null)
      = (system_predicted_fx_gain_usdt is null)
  )
);

create index shadow_validation_daily_period_idx
  on public.shadow_validation_daily_records(
    period_id,
    day_number,
    validation_date
  );
create index shadow_validation_daily_date_idx
  on public.shadow_validation_daily_records(
    currency,
    validation_date desc,
    id desc
  );
create index shadow_validation_daily_recommendation_idx
  on public.shadow_validation_daily_records(recommendation_id);
create index shadow_validation_daily_decision_idx
  on public.shadow_validation_daily_records(human_decision_id);
create index shadow_validation_daily_classification_idx
  on public.shadow_validation_daily_records(reason_classification_id);
create index shadow_validation_daily_recorded_by_idx
  on public.shadow_validation_daily_records(recorded_by);

create or replace function
  private.reject_shadow_validation_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception
    'SHADOW_VALIDATION_HISTORY_IS_IMMUTABLE_APPEND_A_NEW_RECORD';
end;
$$;

create trigger shadow_validation_periods_immutable
before update or delete
on public.shadow_validation_periods
for each row execute function
  private.reject_shadow_validation_mutation();

create trigger shadow_validation_daily_records_immutable
before update or delete
on public.shadow_validation_daily_records
for each row execute function
  private.reject_shadow_validation_mutation();

create or replace function
  private.validate_shadow_validation_period()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(
    hashtextextended('VND_SHADOW_VALIDATION_PERIOD', 0)
  );
  if exists (
    select 1
    from public.shadow_validation_periods period
    where period.currency = new.currency
      and daterange(
        period.start_date,
        period.end_date,
        '[]'
      ) && daterange(new.start_date, new.end_date, '[]')
  ) then
    raise exception 'SHADOW_VALIDATION_PERIOD_OVERLAP';
  end if;
  return new;
end;
$$;

create trigger shadow_validation_periods_no_overlap
before insert on public.shadow_validation_periods
for each row execute function
  private.validate_shadow_validation_period();

create or replace function
  private.validate_shadow_validation_daily_record()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  period_row public.shadow_validation_periods%rowtype;
  review_row public.daily_operation_end_reviews%rowtype;
  risk_check_row public.daily_operation_risk_checks%rowtype;
  recommendation_row
    public.settlement_learning_recommendations%rowtype;
  decision_row public.settlement_human_decisions%rowtype;
  outcome_row public.settlement_decision_outcomes%rowtype;
  classification_row
    public.settlement_decision_reason_classifications%rowtype;
  expected_predicted_risk_count integer;
  expected_realized_risk_count integer;
  expected_risk_denominator integer;
  expected_score numeric;
  expected_component_count integer;
begin
  select * into period_row
  from public.shadow_validation_periods period
  where period.id = new.period_id;
  select * into review_row
  from public.daily_operation_end_reviews review
  where review.id = new.source_end_review_id;
  select * into recommendation_row
  from public.settlement_learning_recommendations recommendation
  where recommendation.id = new.recommendation_id;
  select * into decision_row
  from public.settlement_human_decisions decision
  where decision.id = new.human_decision_id;
  select * into outcome_row
  from public.settlement_decision_outcomes outcome
  where outcome.id = new.decision_outcome_id;
  select * into classification_row
  from public.settlement_decision_reason_classifications classification
  where classification.id = new.reason_classification_id;
  select * into risk_check_row
  from public.daily_operation_risk_checks risk_check
  where risk_check.id = review_row.risk_check_id;

  if period_row.id is null
    or review_row.id is null
    or recommendation_row.id is null
    or decision_row.id is null
    or outcome_row.id is null
    or classification_row.id is null
    or risk_check_row.id is null then
    raise exception 'SHADOW_VALIDATION_SOURCE_MISSING';
  end if;
  if new.validation_date < period_row.start_date
    or new.validation_date > period_row.end_date
    or new.day_number
      <> new.validation_date - period_row.start_date + 1
    or new.currency <> period_row.currency then
    raise exception 'SHADOW_VALIDATION_DAY_MISMATCH';
  end if;
  if review_row.operating_date <> new.validation_date
    or review_row.source_learning_recommendation_id
      <> recommendation_row.id
    or review_row.human_decision_id <> decision_row.id
    or review_row.reason_classification_id
      <> classification_row.id
    or decision_row.recommendation_id <> recommendation_row.id
    or outcome_row.recommendation_id <> recommendation_row.id
    or outcome_row.human_decision_id <> decision_row.id then
    raise exception 'SHADOW_VALIDATION_SOURCE_LINK_MISMATCH';
  end if;
  if new.acceptance_status <> decision_row.acceptance_status
    or btrim(new.adjustment_reason)
      <> btrim(decision_row.adjustment_reason)
    or new.adjustment_reason_category
      <> classification_row.reason_category
    or btrim(new.adjustment_reason)
      <> btrim(classification_row.classified_reason) then
    raise exception 'SHADOW_VALIDATION_HUMAN_DECISION_MISMATCH';
  end if;
  if new.system_topup_recommended
      <> recommendation_row.system_topup_recommended
    or new.system_recommended_topup_usdt
      is distinct from
        recommendation_row.system_recommended_topup_usdt
    or new.system_recommended_quote_rate
      is distinct from
        recommendation_row.system_recommended_quote_rate
    or new.system_predicted_cash_profit_usdt
      is distinct from
        recommendation_row.system_cash_profit_usdt
    or new.system_predicted_economic_profit_usdt
      is distinct from
        recommendation_row.system_economic_profit_usdt
    or new.system_predicted_risk_alerts
      <> recommendation_row.system_risk_alerts
    or new.system_risk_level <> risk_check_row.risk_level
    or new.system_predicted_fx_gain_usdt
      is distinct from (
        case
        when recommendation_row.system_recommended_topup_usdt
            is null
          or recommendation_row.system_fx_spread_ratio is null
          then null
        else round(
          recommendation_row.system_recommended_topup_usdt
          * recommendation_row.system_fx_spread_ratio,
          12
        )
        end
      ) then
    raise exception 'SHADOW_VALIDATION_AI_SNAPSHOT_MISMATCH';
  end if;
  if new.actual_topup_usdt
      is distinct from outcome_row.actual_topup_usdt
    or new.actual_quote_rate
      is distinct from outcome_row.actual_quote_rate
    or new.actual_cash_profit_usdt
      is distinct from outcome_row.actual_cash_profit_usdt
    or new.actual_economic_profit_usdt
      is distinct from outcome_row.actual_economic_profit_usdt
    or new.actual_risk_outcomes
      <> outcome_row.actual_risk_outcomes then
    raise exception 'SHADOW_VALIDATION_ACTUAL_OUTCOME_MISMATCH';
  end if;
  if (
    outcome_row.outcome_snapshot->>'actualFxGainUsdt'
  ) is null
    or (
      outcome_row.outcome_snapshot->>'fundingPressureBeforeVnd'
    ) is null
    or (
      outcome_row.outcome_snapshot->>'fundingPressureAfterVnd'
    ) is null
    or new.actual_fx_gain_usdt
      <> (
        outcome_row.outcome_snapshot->>'actualFxGainUsdt'
      )::numeric
    or new.actual_funding_pressure_before_vnd
      <> (
        outcome_row.outcome_snapshot
          ->>'fundingPressureBeforeVnd'
      )::numeric
    or new.actual_funding_pressure_after_vnd
      <> (
        outcome_row.outcome_snapshot
          ->>'fundingPressureAfterVnd'
      )::numeric
    or new.unexpected_risk_count
      <> coalesce(
        (
          outcome_row.outcome_snapshot
            ->>'unexpectedRiskCount'
        )::integer,
        0
      )
    or coalesce(new.unexpected_risk_notes, '')
      <> coalesce(
        outcome_row.outcome_snapshot
          ->>'unexpectedRiskNotes',
        ''
      ) then
    raise exception 'SHADOW_VALIDATION_ACTUAL_EVIDENCE_MISMATCH';
  end if;

  expected_predicted_risk_count :=
    jsonb_array_length(new.system_predicted_risk_alerts);
  expected_realized_risk_count := (
    select count(*)
    from jsonb_array_elements(new.actual_risk_outcomes) risk
    where risk->>'realized' = 'true'
  );
  if new.predicted_risk_count
      <> expected_predicted_risk_count
    or new.realized_predicted_risk_count
      <> expected_realized_risk_count then
    raise exception 'SHADOW_VALIDATION_RISK_COUNT_MISMATCH';
  end if;
  expected_risk_denominator :=
    expected_predicted_risk_count + new.unexpected_risk_count;
  expected_score := case
    when expected_risk_denominator = 0 then 1
    else expected_realized_risk_count::numeric
      / expected_risk_denominator
  end;
  if abs(
    new.risk_prediction_accuracy_score - expected_score
  ) > 0.000000000001 then
    raise exception 'SHADOW_VALIDATION_RISK_SCORE_MISMATCH';
  end if;

  if abs(
    new.topup_absolute_error_usdt
    - abs(
      coalesce(new.system_recommended_topup_usdt, 0)
      - new.actual_topup_usdt
    )
  ) > 0.000000000001
    or abs(
      new.topup_relative_error
      - (
        new.topup_absolute_error_usdt
        / greatest(
          abs(coalesce(new.system_recommended_topup_usdt, 0)),
          abs(new.actual_topup_usdt),
          1
        )
      )
    ) > 0.000000000001
    or abs(
      new.topup_accuracy_score
      - (1 - new.topup_relative_error)
    ) > 0.000000000001
    or new.topup_within_ten_percent
      <> (new.topup_relative_error <= 0.10) then
    raise exception 'SHADOW_VALIDATION_TOPUP_SCORE_MISMATCH';
  end if;
  if new.system_recommended_quote_rate is not null
    and (
      abs(
        new.quote_absolute_deviation
        - abs(
          new.system_recommended_quote_rate
          - new.actual_quote_rate
        )
      ) > 0.000000000001
      or new.quote_adopted
        <> (
          abs(
            new.system_recommended_quote_rate
            - new.actual_quote_rate
          ) <= 0.000001
        )
      or new.quote_adoption_score
        <> new.quote_adopted::integer
    ) then
    raise exception 'SHADOW_VALIDATION_QUOTE_SCORE_MISMATCH';
  end if;
  if new.system_predicted_cash_profit_usdt is not null
    and abs(
      new.cash_profit_absolute_error_usdt
      - abs(
        new.system_predicted_cash_profit_usdt
        - new.actual_cash_profit_usdt
      )
    ) > 0.000000000001 then
    raise exception 'SHADOW_VALIDATION_CASH_SCORE_MISMATCH';
  end if;
  if new.system_predicted_economic_profit_usdt is not null
    and abs(
      new.economic_profit_absolute_error_usdt
      - abs(
        new.system_predicted_economic_profit_usdt
        - new.actual_economic_profit_usdt
      )
    ) > 0.000000000001 then
    raise exception 'SHADOW_VALIDATION_ECONOMIC_SCORE_MISMATCH';
  end if;
  expected_score := (
    (
      case
        when new.system_predicted_cash_profit_usdt is null
          then 0
        else greatest(
          0,
          least(
            1,
            1 - abs(
              new.system_predicted_cash_profit_usdt
              - new.actual_cash_profit_usdt
            ) / greatest(
              abs(new.system_predicted_cash_profit_usdt),
              abs(new.actual_cash_profit_usdt),
              1
            )
          )
        )
      end
    )
    + (
      case
        when new.system_predicted_economic_profit_usdt is null
          then 0
        else greatest(
          0,
          least(
            1,
            1 - abs(
              new.system_predicted_economic_profit_usdt
              - new.actual_economic_profit_usdt
            ) / greatest(
              abs(new.system_predicted_economic_profit_usdt),
              abs(new.actual_economic_profit_usdt),
              1
            )
          )
        )
      end
    )
  ) / nullif(
    (
      (new.system_predicted_cash_profit_usdt is not null)::integer
      + (
        new.system_predicted_economic_profit_usdt is not null
      )::integer
    ),
    0
  );
  if new.profit_prediction_score is not null
    and abs(
      new.profit_prediction_score - expected_score
    ) > 0.000000000001 then
    raise exception 'SHADOW_VALIDATION_PROFIT_SCORE_MISMATCH';
  end if;
  if new.system_predicted_fx_gain_usdt is not null
    and abs(
      new.fx_gain_absolute_error_usdt
      - abs(
        new.system_predicted_fx_gain_usdt
        - new.actual_fx_gain_usdt
      )
    ) > 0.000000000001 then
    raise exception 'SHADOW_VALIDATION_FX_SCORE_MISMATCH';
  end if;
  if new.funding_pressure_improved
    <> (
      new.actual_funding_pressure_after_vnd
      < new.actual_funding_pressure_before_vnd
    ) then
    raise exception 'SHADOW_VALIDATION_PRESSURE_RESULT_MISMATCH';
  end if;

  expected_component_count :=
    2
    + (new.quote_adoption_score is not null)::integer
    + (new.profit_prediction_score is not null)::integer;
  if new.score_component_count <> expected_component_count then
    raise exception 'SHADOW_VALIDATION_COMPONENT_COUNT_MISMATCH';
  end if;
  expected_score := (
    new.topup_accuracy_score
    + new.risk_prediction_accuracy_score
    + coalesce(new.quote_adoption_score, 0)
    + coalesce(new.profit_prediction_score, 0)
  ) / expected_component_count * 100;
  if abs(new.ai_accuracy_score - expected_score) > 0.000001 then
    raise exception 'SHADOW_VALIDATION_AI_SCORE_MISMATCH';
  end if;
  return new;
end;
$$;

create trigger shadow_validation_daily_records_consistency
before insert on public.shadow_validation_daily_records
for each row execute function
  private.validate_shadow_validation_daily_record();

create or replace view public.shadow_validation_daily_comparisons
with (security_invoker = true)
as
select
  daily.id,
  daily.period_id,
  daily.validation_date,
  daily.day_number,
  daily.currency,
  daily.source_end_review_id,
  daily.recommendation_id,
  daily.human_decision_id,
  daily.decision_outcome_id,
  daily.reason_classification_id,
  daily.system_topup_recommended,
  daily.system_recommended_topup_usdt,
  daily.system_recommended_quote_rate,
  daily.system_predicted_cash_profit_usdt,
  daily.system_predicted_economic_profit_usdt,
  daily.system_predicted_fx_gain_usdt,
  daily.system_predicted_risk_alerts,
  daily.system_risk_level,
  daily.acceptance_status,
  daily.adjustment_reason_category,
  daily.adjustment_reason,
  daily.actual_topup_usdt,
  daily.actual_quote_rate,
  daily.actual_cash_profit_usdt,
  daily.actual_economic_profit_usdt,
  daily.actual_fx_gain_usdt,
  daily.actual_funding_pressure_before_vnd,
  daily.actual_funding_pressure_after_vnd,
  daily.actual_risk_outcomes,
  daily.unexpected_risk_count,
  daily.unexpected_risk_notes,
  daily.topup_accuracy_score,
  daily.topup_within_ten_percent,
  daily.quote_adopted,
  daily.quote_adoption_score,
  daily.cash_profit_absolute_error_usdt,
  daily.economic_profit_absolute_error_usdt,
  daily.profit_prediction_score,
  daily.risk_prediction_accuracy_score,
  daily.fx_gain_absolute_error_usdt,
  daily.funding_pressure_improved,
  daily.ai_accuracy_score,
  daily.score_component_count,
  daily.created_at,
  true as descriptive_statistics_only,
  true as shadow_mode,
  false as automatic_optimization,
  false as automatic_action
from public.shadow_validation_daily_records daily;

create or replace view public.shadow_validation_period_metrics
with (security_invoker = true)
as
select
  period.id as period_id,
  period.currency,
  period.start_date,
  period.end_date,
  period.validation_days,
  count(daily.id)::smallint as captured_days,
  (
    count(daily.id)::numeric / period.validation_days
  )::numeric(18,12) as completion_rate,
  avg(daily.ai_accuracy_score)::numeric(9,6)
    as average_ai_accuracy_score,
  avg(daily.topup_accuracy_score)::numeric(18,12)
    as topup_recommendation_accuracy_rate,
  avg(daily.topup_within_ten_percent::integer)::numeric(18,12)
    as topup_within_ten_percent_rate,
  avg(daily.quote_adoption_score)::numeric(18,12)
    as quote_recommendation_adoption_rate,
  avg(daily.cash_profit_absolute_error_usdt)::numeric(38,12)
    as average_cash_profit_absolute_error_usdt,
  avg(daily.economic_profit_absolute_error_usdt)::numeric(38,12)
    as average_economic_profit_absolute_error_usdt,
  avg(daily.profit_prediction_score)::numeric(18,12)
    as profit_prediction_accuracy_rate,
  avg(daily.risk_prediction_accuracy_score)::numeric(18,12)
    as risk_prediction_accuracy_rate,
  avg(daily.fx_gain_absolute_error_usdt)::numeric(38,12)
    as average_fx_gain_absolute_error_usdt,
  avg(daily.funding_pressure_improved::integer)::numeric(18,12)
    as funding_pressure_improvement_rate,
  max(daily.validation_date) as latest_validation_date,
  true as descriptive_statistics_only,
  true as shadow_mode,
  false as automatic_optimization,
  false as automatic_action
from public.shadow_validation_periods period
left join public.shadow_validation_daily_records daily
  on daily.period_id = period.id
group by
  period.id,
  period.currency,
  period.start_date,
  period.end_date,
  period.validation_days;

create or replace view public.shadow_validation_period_status
with (security_invoker = true)
as
select
  metrics.*,
  least(
    greatest(
      (
        (
          now() at time zone 'Asia/Shanghai'
        )::date - metrics.start_date + 1
      ),
      0
    ),
    metrics.validation_days
  )::smallint as calendar_day_number,
  case
    when (now() at time zone 'Asia/Shanghai')::date
      < metrics.start_date then 'NOT_STARTED'
    when metrics.captured_days = metrics.validation_days
      then 'COMPLETED'
    when (now() at time zone 'Asia/Shanghai')::date
      > metrics.end_date then 'EXPIRED_INCOMPLETE'
    else 'IN_PROGRESS'
  end as period_status,
  case
    when metrics.captured_days >= metrics.validation_days
      then null
    else metrics.captured_days + 1
  end::smallint as next_uncaptured_day,
  metrics.captured_days = metrics.validation_days
    as validation_complete
from public.shadow_validation_period_metrics metrics;

alter table public.shadow_validation_periods
  enable row level security;
alter table public.shadow_validation_daily_records
  enable row level security;

create policy shadow_validation_periods_read
on public.shadow_validation_periods
for select to authenticated
using (true);

create policy shadow_validation_periods_insert
on public.shadow_validation_periods
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
  and not automatic_optimization
);

create policy shadow_validation_daily_records_read
on public.shadow_validation_daily_records
for select to authenticated
using (true);

create policy shadow_validation_daily_records_insert
on public.shadow_validation_daily_records
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
  and not actual_execution_performed
  and not automatic_payment
  and not automatic_topup
  and not automatic_quote_change
  and not automatic_trading
  and not automatic_optimization
);

revoke all on
  public.shadow_validation_periods,
  public.shadow_validation_daily_records
from anon, authenticated;

grant select, insert on
  public.shadow_validation_periods,
  public.shadow_validation_daily_records
to authenticated;

grant all on
  public.shadow_validation_periods,
  public.shadow_validation_daily_records
to service_role;

revoke all on
  public.shadow_validation_daily_comparisons,
  public.shadow_validation_period_metrics,
  public.shadow_validation_period_status
from anon;

grant select on
  public.shadow_validation_daily_comparisons,
  public.shadow_validation_period_metrics,
  public.shadow_validation_period_status
to authenticated, service_role;

create trigger audit_shadow_validation_periods
after insert or update or delete
on public.shadow_validation_periods
for each row execute function public.audit_mutation();

create trigger audit_shadow_validation_daily_records
after insert or update or delete
on public.shadow_validation_daily_records
for each row execute function public.audit_mutation();

do $$
begin
  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'shadow_validation_periods',
        'shadow_validation_daily_records'
      )
      and cmd in ('UPDATE', 'DELETE', 'ALL')
  ) then
    raise exception
      'SHADOW_VALIDATION_TABLES_MUST_NOT_HAVE_MUTATION_POLICIES';
  end if;
  if (
    select count(*)
    from pg_trigger
    where tgname in (
      'shadow_validation_periods_immutable',
      'shadow_validation_daily_records_immutable'
    )
      and not tgisinternal
  ) <> 2 then
    raise exception 'SHADOW_VALIDATION_IMMUTABILITY_TRIGGER_MISSING';
  end if;
  if exists (
    select 1
    from public.shadow_validation_periods period
    where not period.shadow_mode
      or period.automatic_payment
      or period.automatic_topup
      or period.automatic_quote_change
      or period.automatic_trading
      or period.automatic_optimization
  ) or exists (
    select 1
    from public.shadow_validation_daily_records daily
    where not daily.shadow_mode
      or daily.actual_execution_performed
      or daily.automatic_payment
      or daily.automatic_topup
      or daily.automatic_quote_change
      or daily.automatic_trading
      or daily.automatic_optimization
  ) then
    raise exception 'TASK_2_14_SHADOW_GUARD_FAILED';
  end if;
end;
$$;

comment on table public.shadow_validation_periods is
  'Immutable VND seven-day Shadow Validation period declarations.';
comment on table public.shadow_validation_daily_records is
  'Immutable daily AI-versus-human-versus-actual validation evidence and descriptive scores.';
comment on view public.shadow_validation_period_status is
  'Derived Day 1/7 through Day 7/7 progress; it never performs an action.';
