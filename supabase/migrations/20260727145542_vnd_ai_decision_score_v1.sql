-- Task 2.15 — VND AI Decision Score Model V1.
-- Appends versioned, immutable score snapshots over Task 2.14 evidence.
-- This migration only evaluates decisions. It cannot pay, top up,
-- change a customer quote, optimize a model, or trade.

create table public.ai_decision_score_snapshots (
  id uuid primary key default gen_random_uuid(),
  client_request_id uuid not null unique,
  validation_record_id uuid not null
    references public.shadow_validation_daily_records(id),
  period_id uuid not null
    references public.shadow_validation_periods(id),
  score_date date not null,
  score_version integer not null check (score_version > 0),
  supersedes_snapshot_id uuid
    references public.ai_decision_score_snapshots(id),
  model_version text not null
    default 'VND_AI_DECISION_SCORE_V1',

  ai_topup_usdt numeric(38,8)
    check (ai_topup_usdt is null or ai_topup_usdt >= 0),
  human_topup_usdt numeric(38,8) not null
    check (human_topup_usdt >= 0),
  topup_absolute_deviation_usdt numeric(38,12) not null
    check (topup_absolute_deviation_usdt >= 0),
  topup_relative_deviation numeric(18,12) not null
    check (topup_relative_deviation between 0 and 1),
  reference_cost_rate_vnd_per_usdt numeric(38,12)
    check (
      reference_cost_rate_vnd_per_usdt is null
      or reference_cost_rate_vnd_per_usdt > 0
    ),
  ai_topup_reference_cost_vnd numeric(38,2)
    check (
      ai_topup_reference_cost_vnd is null
      or ai_topup_reference_cost_vnd >= 0
    ),
  human_topup_reference_cost_vnd numeric(38,2)
    check (
      human_topup_reference_cost_vnd is null
      or human_topup_reference_cost_vnd >= 0
    ),
  topup_reference_cost_difference_vnd numeric(38,2)
    check (
      topup_reference_cost_difference_vnd is null
      or topup_reference_cost_difference_vnd >= 0
    ),
  topup_cost_evidence_status text not null
    check (
      topup_cost_evidence_status in (
        'DECISION_TIME_P2P_REFERENCE',
        'MISSING_REFERENCE_COST'
      )
    ),
  predicted_fx_gain_usdt numeric(38,12),
  actual_fx_gain_usdt numeric(38,12) not null,
  fx_opportunity_loss_usdt numeric(38,12)
    check (
      fx_opportunity_loss_usdt is null
      or fx_opportunity_loss_usdt >= 0
    ),
  topup_quantity_score numeric(9,6) not null
    check (topup_quantity_score between 0 and 100),
  topup_reference_cost_score numeric(9,6)
    check (
      topup_reference_cost_score is null
      or topup_reference_cost_score between 0 and 100
    ),
  topup_fx_opportunity_score numeric(9,6)
    check (
      topup_fx_opportunity_score is null
      or topup_fx_opportunity_score between 0 and 100
    ),
  topup_decision_score numeric(9,6) not null
    check (topup_decision_score between 0 and 100),

  ai_quote_rate numeric(38,12)
    check (ai_quote_rate is null or ai_quote_rate > 0),
  human_quote_rate numeric(38,12) not null
    check (human_quote_rate > 0),
  quote_absolute_deviation numeric(38,12)
    check (
      quote_absolute_deviation is null
      or quote_absolute_deviation >= 0
    ),
  quote_relative_deviation numeric(18,12)
    check (
      quote_relative_deviation is null
      or quote_relative_deviation between 0 and 1
    ),
  quote_profit_difference_usdt numeric(38,12),
  merchant_competition_concern boolean not null,
  merchant_competition_impact_ratio numeric(18,12) not null
    check (merchant_competition_impact_ratio between 0 and 1),
  transaction_risk_rate numeric(18,12) not null
    check (transaction_risk_rate between 0 and 1),
  quote_rate_score numeric(9,6)
    check (
      quote_rate_score is null
      or quote_rate_score between 0 and 100
    ),
  quote_profit_score numeric(9,6)
    check (
      quote_profit_score is null
      or quote_profit_score between 0 and 100
    ),
  quote_competition_score numeric(9,6)
    check (
      quote_competition_score is null
      or quote_competition_score between 0 and 100
    ),
  quote_transaction_safety_score numeric(9,6) not null
    check (quote_transaction_safety_score between 0 and 100),
  quote_decision_score numeric(9,6)
    check (
      quote_decision_score is null
      or quote_decision_score between 0 and 100
    ),

  predicted_cash_profit_usdt numeric(38,12),
  actual_cash_profit_usdt numeric(38,12) not null,
  cash_profit_difference_usdt numeric(38,12),
  cash_profit_absolute_error_usdt numeric(38,12)
    check (
      cash_profit_absolute_error_usdt is null
      or cash_profit_absolute_error_usdt >= 0
    ),
  predicted_economic_profit_usdt numeric(38,12),
  actual_economic_profit_usdt numeric(38,12) not null,
  economic_profit_difference_usdt numeric(38,12),
  economic_profit_absolute_error_usdt numeric(38,12)
    check (
      economic_profit_absolute_error_usdt is null
      or economic_profit_absolute_error_usdt >= 0
    ),
  profit_prediction_score numeric(9,6)
    check (
      profit_prediction_score is null
      or profit_prediction_score between 0 and 100
    ),

  system_risk_level text not null
    check (system_risk_level in ('LOW', 'MEDIUM', 'HIGH')),
  actual_risk_level text not null
    check (actual_risk_level in ('LOW', 'MEDIUM', 'HIGH')),
  risk_true_positive_count smallint not null
    check (risk_true_positive_count between 0 and 100),
  risk_false_positive_count smallint not null
    check (risk_false_positive_count between 0 and 100),
  risk_false_negative_count smallint not null
    check (risk_false_negative_count between 0 and 100),
  risk_hit_rate numeric(18,12) not null
    check (risk_hit_rate between 0 and 1),
  risk_false_positive_rate numeric(18,12) not null
    check (risk_false_positive_rate between 0 and 1),
  risk_miss_rate numeric(18,12) not null
    check (risk_miss_rate between 0 and 1),
  risk_level_matched boolean not null,
  risk_classification_f1 numeric(18,12) not null
    check (risk_classification_f1 between 0 and 1),
  risk_score numeric(9,6) not null
    check (risk_score between 0 and 100),

  overall_topup_weight numeric(5,4) not null default 0.30
    check (overall_topup_weight = 0.30),
  overall_quote_weight numeric(5,4) not null default 0.30
    check (overall_quote_weight = 0.30),
  overall_profit_weight numeric(5,4) not null default 0.25
    check (overall_profit_weight = 0.25),
  overall_risk_weight numeric(5,4) not null default 0.15
    check (overall_risk_weight = 0.15),
  evaluation_status text not null
    check (
      evaluation_status in (
        'COMPLETE',
        'PARTIAL_INSUFFICIENT_EVIDENCE'
      )
    ),
  ai_decision_score numeric(9,6)
    check (
      ai_decision_score is null
      or ai_decision_score between 0 and 100
    ),

  calculation_snapshot jsonb not null
    check (jsonb_typeof(calculation_snapshot) = 'object'),
  data_cutoff_snapshot jsonb not null default '{}'::jsonb
    check (jsonb_typeof(data_cutoff_snapshot) = 'object'),
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
  actual_execution_performed boolean not null default false
    check (actual_execution_performed = false),
  created_at timestamptz not null default now(),

  unique (
    validation_record_id,
    model_version,
    score_version
  ),
  unique (supersedes_snapshot_id),
  check (
    supersedes_snapshot_id is not null
    or score_version = 1
  ),
  check (
    (
      reference_cost_rate_vnd_per_usdt is null
      and ai_topup_reference_cost_vnd is null
      and human_topup_reference_cost_vnd is null
      and topup_reference_cost_difference_vnd is null
      and topup_reference_cost_score is null
      and topup_cost_evidence_status = 'MISSING_REFERENCE_COST'
    )
    or (
      reference_cost_rate_vnd_per_usdt is not null
      and ai_topup_reference_cost_vnd is not null
      and human_topup_reference_cost_vnd is not null
      and topup_reference_cost_difference_vnd is not null
      and topup_reference_cost_score is not null
      and topup_cost_evidence_status
        = 'DECISION_TIME_P2P_REFERENCE'
    )
  ),
  check (
    (
      evaluation_status = 'COMPLETE'
      and quote_decision_score is not null
      and profit_prediction_score is not null
      and ai_decision_score is not null
    )
    or (
      evaluation_status = 'PARTIAL_INSUFFICIENT_EVIDENCE'
      and (
        quote_decision_score is null
        or profit_prediction_score is null
      )
      and ai_decision_score is null
    )
  )
);

create index ai_decision_score_source_idx
  on public.ai_decision_score_snapshots(
    validation_record_id,
    model_version,
    score_version desc
  );
create index ai_decision_score_period_date_idx
  on public.ai_decision_score_snapshots(
    period_id,
    score_date desc,
    score_version desc
  );
create index ai_decision_score_trend_idx
  on public.ai_decision_score_snapshots(
    score_date desc,
    model_version,
    id desc
  );
create index ai_decision_score_created_by_idx
  on public.ai_decision_score_snapshots(created_by);

create or replace function
  private.reject_ai_decision_score_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception
    'AI_DECISION_SCORE_HISTORY_IS_IMMUTABLE_APPEND_A_NEW_VERSION';
end;
$$;

create trigger ai_decision_score_snapshots_immutable
before update or delete
on public.ai_decision_score_snapshots
for each row execute function
  private.reject_ai_decision_score_mutation();

create or replace function
  private.validate_ai_decision_score_snapshot()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  source_row public.shadow_validation_daily_records%rowtype;
  recommendation_row
    public.settlement_learning_recommendations%rowtype;
  prior_row public.ai_decision_score_snapshots%rowtype;
  expected_overall numeric;
begin
  select * into source_row
  from public.shadow_validation_daily_records source
  where source.id = new.validation_record_id;

  if source_row.id is null then
    raise exception 'AI_SCORE_SOURCE_VALIDATION_RECORD_MISSING';
  end if;

  select * into recommendation_row
  from public.settlement_learning_recommendations recommendation
  where recommendation.id = source_row.recommendation_id;

  if recommendation_row.id is null then
    raise exception 'AI_SCORE_SOURCE_RECOMMENDATION_MISSING';
  end if;

  if new.period_id <> source_row.period_id
    or new.score_date <> source_row.validation_date
    or new.ai_topup_usdt is distinct from
      source_row.system_recommended_topup_usdt
    or new.human_topup_usdt
      <> source_row.actual_topup_usdt
    or new.predicted_fx_gain_usdt is distinct from
      source_row.system_predicted_fx_gain_usdt
    or new.actual_fx_gain_usdt <> source_row.actual_fx_gain_usdt
    or new.ai_quote_rate is distinct from
      source_row.system_recommended_quote_rate
    or new.human_quote_rate <> source_row.actual_quote_rate
    or new.predicted_cash_profit_usdt is distinct from
      source_row.system_predicted_cash_profit_usdt
    or new.actual_cash_profit_usdt
      <> source_row.actual_cash_profit_usdt
    or new.predicted_economic_profit_usdt is distinct from
      source_row.system_predicted_economic_profit_usdt
    or new.actual_economic_profit_usdt
      <> source_row.actual_economic_profit_usdt
    or new.system_risk_level <> source_row.system_risk_level
    or new.risk_false_negative_count
      <> source_row.unexpected_risk_count
    or new.data_cutoff_snapshot <> source_row.data_cutoff_snapshot
  then
    raise exception 'AI_SCORE_SOURCE_SNAPSHOT_MISMATCH';
  end if;

  if new.reference_cost_rate_vnd_per_usdt
      is distinct from recommendation_row.system_p2p_cost_rate
  then
    raise exception 'AI_SCORE_REFERENCE_COST_MISMATCH';
  end if;

  if abs(
    new.topup_absolute_deviation_usdt
    - abs(coalesce(new.ai_topup_usdt, 0) - new.human_topup_usdt)
  ) > 0.000000000001 then
    raise exception 'AI_SCORE_TOPUP_DEVIATION_MISMATCH';
  end if;

  if new.reference_cost_rate_vnd_per_usdt is not null
    and (
      abs(
        new.ai_topup_reference_cost_vnd
        - round(
          coalesce(new.ai_topup_usdt, 0)
          * new.reference_cost_rate_vnd_per_usdt,
          2
        )
      ) > 0.01
      or abs(
        new.human_topup_reference_cost_vnd
        - round(
          new.human_topup_usdt
          * new.reference_cost_rate_vnd_per_usdt,
          2
        )
      ) > 0.01
      or abs(
        new.topup_reference_cost_difference_vnd
        - abs(
          new.ai_topup_reference_cost_vnd
          - new.human_topup_reference_cost_vnd
        )
      ) > 0.01
    ) then
    raise exception 'AI_SCORE_TOPUP_REFERENCE_COST_MISMATCH';
  end if;

  if new.predicted_fx_gain_usdt is not null
    and abs(
      new.fx_opportunity_loss_usdt
      - greatest(
        new.predicted_fx_gain_usdt - new.actual_fx_gain_usdt,
        0
      )
    ) > 0.000000000001 then
    raise exception 'AI_SCORE_FX_OPPORTUNITY_MISMATCH';
  end if;

  if new.ai_quote_rate is not null
    and abs(
      new.quote_absolute_deviation
      - abs(new.ai_quote_rate - new.human_quote_rate)
    ) > 0.000000000001 then
    raise exception 'AI_SCORE_QUOTE_DEVIATION_MISMATCH';
  end if;

  if new.score_version > 1 then
    select * into prior_row
    from public.ai_decision_score_snapshots prior
    where prior.id = new.supersedes_snapshot_id;
    if prior_row.id is null
      or prior_row.validation_record_id
        <> new.validation_record_id
      or prior_row.score_version <> new.score_version - 1
    then
      raise exception 'AI_SCORE_INVALID_VERSION_CHAIN';
    end if;
  end if;

  if new.evaluation_status = 'COMPLETE' then
    expected_overall :=
      new.topup_decision_score * 0.30
      + new.quote_decision_score * 0.30
      + new.profit_prediction_score * 0.25
      + new.risk_score * 0.15;
    if abs(new.ai_decision_score - expected_overall) > 0.000001
    then
      raise exception 'AI_SCORE_OVERALL_WEIGHT_MISMATCH';
    end if;
  end if;
  return new;
end;
$$;

create trigger ai_decision_score_snapshots_consistency
before insert
on public.ai_decision_score_snapshots
for each row execute function
  private.validate_ai_decision_score_snapshot();

create or replace view public.ai_decision_score_latest
with (security_invoker = true)
as
select distinct on (
  score.validation_record_id,
  score.model_version
)
  score.*
from public.ai_decision_score_snapshots score
order by
  score.validation_record_id,
  score.model_version,
  score.score_version desc,
  score.created_at desc,
  score.id desc;

create or replace view public.ai_decision_score_recent_7_days
with (security_invoker = true)
as
with ranked as (
  select
    latest.*,
    dense_rank() over (
      partition by latest.model_version
      order by latest.score_date desc
    ) as recent_day_rank
  from public.ai_decision_score_latest latest
)
select *
from ranked
where recent_day_rank <= 7;

create or replace view public.ai_decision_score_summary
with (security_invoker = true)
as
select
  score.model_version,
  count(*)::integer as scored_days,
  count(score.ai_decision_score)::integer
    as complete_score_days,
  avg(score.ai_decision_score)::numeric(9,6)
    as average_ai_decision_score,
  avg(score.topup_decision_score)::numeric(9,6)
    as average_topup_decision_score,
  avg(score.quote_decision_score)::numeric(9,6)
    as average_quote_decision_score,
  avg(score.profit_prediction_score)::numeric(9,6)
    as average_profit_prediction_score,
  avg(score.risk_score)::numeric(9,6)
    as average_risk_score,
  avg(score.risk_hit_rate)::numeric(18,12)
    as risk_hit_rate,
  avg(score.risk_false_positive_rate)::numeric(18,12)
    as risk_false_positive_rate,
  avg(score.risk_miss_rate)::numeric(18,12)
    as risk_miss_rate,
  avg(score.cash_profit_absolute_error_usdt)::numeric(38,12)
    as average_cash_profit_absolute_error_usdt,
  avg(score.economic_profit_absolute_error_usdt)::numeric(38,12)
    as average_economic_profit_absolute_error_usdt,
  max(score.score_date) as latest_score_date,
  true as descriptive_statistics_only,
  true as shadow_mode,
  false as automatic_optimization,
  false as automatic_action
from public.ai_decision_score_recent_7_days score
group by score.model_version;

alter table public.ai_decision_score_snapshots
  enable row level security;

create policy ai_decision_score_snapshots_read
on public.ai_decision_score_snapshots
for select to authenticated
using (true);

create policy ai_decision_score_snapshots_insert
on public.ai_decision_score_snapshots
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
  and not automatic_payment
  and not automatic_topup
  and not automatic_quote_change
  and not automatic_trading
  and not automatic_optimization
  and not actual_execution_performed
);

revoke all on public.ai_decision_score_snapshots
from anon, authenticated;

grant select, insert on public.ai_decision_score_snapshots
to authenticated;

grant all on public.ai_decision_score_snapshots
to service_role;

revoke all on
  public.ai_decision_score_latest,
  public.ai_decision_score_recent_7_days,
  public.ai_decision_score_summary
from anon;

grant select on
  public.ai_decision_score_latest,
  public.ai_decision_score_recent_7_days,
  public.ai_decision_score_summary
to authenticated, service_role;

create trigger audit_ai_decision_score_snapshots
after insert or update or delete
on public.ai_decision_score_snapshots
for each row execute function public.audit_mutation();

do $$
begin
  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'ai_decision_score_snapshots'
      and cmd in ('UPDATE', 'DELETE', 'ALL')
  ) then
    raise exception
      'AI_DECISION_SCORE_MUST_NOT_HAVE_MUTATION_POLICIES';
  end if;
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'ai_decision_score_snapshots_immutable'
      and not tgisinternal
  ) then
    raise exception 'AI_DECISION_SCORE_IMMUTABILITY_MISSING';
  end if;
  if exists (
    select 1
    from public.ai_decision_score_snapshots score
    where not score.shadow_mode
      or score.automatic_payment
      or score.automatic_topup
      or score.automatic_quote_change
      or score.automatic_trading
      or score.automatic_optimization
      or score.actual_execution_performed
  ) then
    raise exception 'TASK_2_15_SHADOW_GUARD_FAILED';
  end if;
end;
$$;

comment on table public.ai_decision_score_snapshots is
  'Immutable, versioned VND AI-versus-human decision scores. Descriptive Shadow Mode only.';
comment on column
  public.ai_decision_score_snapshots.reference_cost_rate_vnd_per_usdt
is
  'Decision-time manual P2P cost reference. Null means cost evidence is unavailable; no rate is invented.';
comment on view public.ai_decision_score_recent_7_days is
  'Latest immutable score version for each source day across the most recent seven scored dates.';
