-- Task 2.12 — Shadow Run Dashboard V1.
-- Adds an observation layer over the existing Task 2.8–2.11 learning,
-- control-center and daily-report records. It does not create another
-- learning system and cannot pay, top up, change quotes or trade.

create table public.shadow_run_market_context_notes (
  id uuid primary key default gen_random_uuid(),
  client_request_id uuid not null unique,
  currency text not null default 'VND'
    check (currency = 'VND'),
  context_date date not null,
  observed_at timestamptz not null,
  context_category text not null
    check (
      context_category in (
        'VND_POLICY',
        'INTERNATIONAL_GEOPOLITICS',
        'FED_EVENT',
        'BTC_VOLATILITY',
        'FX_ANOMALY',
        'PAYMENT_COMPANY_RISK'
      )
    ),
  severity text not null
    check (severity in ('INFO', 'WARNING', 'HIGH')),
  title text not null
    check (char_length(btrim(title)) between 1 and 200),
  observation_reason text not null
    check (
      char_length(btrim(observation_reason)) between 1 and 2000
    ),
  evidence_reference text
    check (
      evidence_reference is null
      or char_length(evidence_reference) <= 1000
    ),
  recorded_by uuid not null references auth.users(id),
  shadow_mode boolean not null default true
    check (shadow_mode),
  quote_impact_applied boolean not null default false
    check (quote_impact_applied = false),
  automatic_action boolean not null default false
    check (automatic_action = false),
  automatic_payment boolean not null default false
    check (automatic_payment = false),
  automatic_topup boolean not null default false
    check (automatic_topup = false),
  automatic_quote_change boolean not null default false
    check (automatic_quote_change = false),
  automatic_trading boolean not null default false
    check (automatic_trading = false),
  created_at timestamptz not null default now()
);

create index shadow_run_market_notes_currency_date_idx
  on public.shadow_run_market_context_notes(
    currency,
    context_date desc,
    observed_at desc,
    id desc
  );
create index shadow_run_market_notes_category_date_idx
  on public.shadow_run_market_context_notes(
    context_category,
    context_date desc
  );
create index shadow_run_market_notes_recorded_by_idx
  on public.shadow_run_market_context_notes(recorded_by);

create or replace function
  private.reject_shadow_run_market_context_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception
    'SHADOW_RUN_MARKET_CONTEXT_IS_IMMUTABLE_APPEND_A_NEW_NOTE';
end
$$;

create trigger shadow_run_market_context_notes_immutable
before update or delete
on public.shadow_run_market_context_notes
for each row execute function
  private.reject_shadow_run_market_context_mutation();

create or replace view public.shadow_run_daily_metrics
with (security_invoker = true)
as
with recommendation_days as (
  select
    recommendation.currency,
    (
      recommendation.recommendation_time
      at time zone 'Asia/Shanghai'
    )::date as shadow_date,
    count(*)::bigint as system_recommendation_count,
    count(*) filter (
      where recommendation.system_recommended_topup_usdt
        is not null
    )::bigint as topup_suggestion_count,
    count(*) filter (
      where recommendation.system_recommended_quote_rate
        is not null
    )::bigint as quote_suggestion_count,
    coalesce(
      sum(
        jsonb_array_length(recommendation.system_risk_alerts)
      ),
      0
    )::bigint as risk_alert_count
  from public.settlement_learning_recommendations recommendation
  group by
    recommendation.currency,
    (
      recommendation.recommendation_time
      at time zone 'Asia/Shanghai'
    )::date
),
decision_days as (
  select
    recommendation.currency,
    (
      decision.reviewed_at at time zone 'Asia/Shanghai'
    )::date as shadow_date,
    count(*)::bigint as human_decision_count,
    count(*) filter (
      where decision.acceptance_status = 'ACCEPTED'
    )::bigint as accepted_count,
    count(*) filter (
      where decision.acceptance_status = 'MODIFIED'
    )::bigint as modified_count,
    count(*) filter (
      where decision.acceptance_status = 'REJECTED'
    )::bigint as rejected_count
  from public.settlement_human_decisions decision
  join public.settlement_learning_recommendations recommendation
    on recommendation.id = decision.recommendation_id
  group by
    recommendation.currency,
    (
      decision.reviewed_at at time zone 'Asia/Shanghai'
    )::date
),
all_days as (
  select currency, shadow_date from recommendation_days
  union
  select currency, shadow_date from decision_days
)
select
  all_days.currency,
  all_days.shadow_date,
  coalesce(
    recommendation_days.system_recommendation_count,
    0
  )::bigint as system_recommendation_count,
  coalesce(
    recommendation_days.topup_suggestion_count,
    0
  )::bigint as topup_suggestion_count,
  coalesce(
    recommendation_days.quote_suggestion_count,
    0
  )::bigint as quote_suggestion_count,
  coalesce(
    recommendation_days.risk_alert_count,
    0
  )::bigint as risk_alert_count,
  coalesce(
    decision_days.human_decision_count,
    0
  )::bigint as human_decision_count,
  coalesce(
    decision_days.accepted_count,
    0
  )::bigint as accepted_count,
  coalesce(
    decision_days.modified_count,
    0
  )::bigint as modified_count,
  coalesce(
    decision_days.rejected_count,
    0
  )::bigint as rejected_count,
  (
    coalesce(decision_days.accepted_count, 0)::numeric
    / nullif(decision_days.human_decision_count, 0)
  )::numeric(18,12) as acceptance_rate,
  (
    coalesce(decision_days.modified_count, 0)::numeric
    / nullif(decision_days.human_decision_count, 0)
  )::numeric(18,12) as modification_rate,
  (
    coalesce(decision_days.rejected_count, 0)::numeric
    / nullif(decision_days.human_decision_count, 0)
  )::numeric(18,12) as rejection_rate,
  true as shadow_mode,
  false as automatic_optimization,
  false as automatic_action
from all_days
left join recommendation_days
  on recommendation_days.currency = all_days.currency
  and recommendation_days.shadow_date = all_days.shadow_date
left join decision_days
  on decision_days.currency = all_days.currency
  and decision_days.shadow_date = all_days.shadow_date;

create or replace view public.shadow_run_decision_comparisons
with (security_invoker = true)
as
with comparison_base as (
  select
    recommendation.id as recommendation_id,
    recommendation.currency,
    recommendation.recommendation_time,
    (
      recommendation.recommendation_time
      at time zone 'Asia/Shanghai'
    )::date as recommendation_date,
    recommendation.system_payload,
    recommendation.system_risk_alerts,
    recommendation.system_recommended_topup_usdt,
    recommendation.system_recommended_quote_rate,
    recommendation.system_cash_profit_usdt,
    recommendation.system_economic_profit_usdt,
    decision.id as human_decision_id,
    decision.decision_scope,
    decision.acceptance_status,
    decision.final_topup_usdt,
    decision.final_quote_rate,
    decision.final_execution_decision,
    decision.adjustment_reason,
    decision.reviewed_at,
    (
      decision.reviewed_at at time zone 'Asia/Shanghai'
    )::date as review_date,
    outcome.id as latest_outcome_id,
    outcome.actual_topup_usdt,
    outcome.actual_quote_rate,
    outcome.actual_cash_profit_usdt,
    outcome.actual_economic_profit_usdt,
    outcome.actual_risk_outcomes,
    outcome.outcome_reason,
    outcome.outcome_snapshot,
    outcome.measured_at
  from public.settlement_learning_recommendations recommendation
  join public.settlement_learning_latest_decisions decision
    on decision.recommendation_id = recommendation.id
  left join public.settlement_decision_latest_outcomes outcome
    on outcome.human_decision_id = decision.id
),
expanded as (
  select
    comparison_base.*,
    suggestion.suggestion_type
  from comparison_base
  cross join lateral (
    select 'TOPUP'::text as suggestion_type
    where comparison_base.decision_scope in (
      'FULL_REVIEW',
      'TOPUP'
    )
    union all
    select 'QUOTE'::text
    where comparison_base.decision_scope in (
      'FULL_REVIEW',
      'QUOTE'
    )
      and (
        comparison_base.system_recommended_quote_rate is not null
        or comparison_base.final_quote_rate is not null
      )
    union all
    select 'RISK_ALERT'::text
    where comparison_base.decision_scope in (
      'FULL_REVIEW',
      'RISK'
    )
      and jsonb_array_length(
        comparison_base.system_risk_alerts
      ) > 0
  ) suggestion
)
select
  expanded.recommendation_id,
  expanded.currency,
  expanded.recommendation_time,
  expanded.recommendation_date,
  expanded.human_decision_id,
  expanded.decision_scope,
  expanded.suggestion_type,
  case expanded.suggestion_type
    when 'TOPUP' then jsonb_build_object(
      'recommendedTopupUsdt',
      expanded.system_recommended_topup_usdt
    )
    when 'QUOTE' then jsonb_build_object(
      'recommendedQuoteRate',
      expanded.system_recommended_quote_rate
    )
    else expanded.system_risk_alerts
  end as system_suggested_value,
  case expanded.suggestion_type
    when 'TOPUP' then coalesce(
      nullif(
        expanded.system_payload
          #>> '{topupRecommendation,reasons}',
        ''
      ),
      nullif(
        expanded.system_payload
          #>> '{controlCenter,topup,reasons}',
        ''
      ),
      '基于Settleable余额、未来需求与16:00-23:00高峰压力'
    )
    when 'QUOTE' then
      '基于XE基础、公司调整、人工P2P成本与目标利润'
    else expanded.system_risk_alerts::text
  end as system_suggestion_reason,
  expanded.acceptance_status,
  case expanded.suggestion_type
    when 'TOPUP' then jsonb_build_object(
      'finalTopupUsdt',
      expanded.final_topup_usdt
    )
    when 'QUOTE' then jsonb_build_object(
      'finalQuoteRate',
      expanded.final_quote_rate
    )
    else coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'riskCode',
            feedback.risk_code,
            'humanJudgment',
            feedback.human_judgment,
            'humanNote',
            feedback.human_note
          )
          order by feedback.risk_code
        )
        from public.settlement_risk_feedback feedback
        where feedback.human_decision_id
          = expanded.human_decision_id
      ),
      '[]'::jsonb
    )
  end as human_final_value,
  expanded.final_execution_decision,
  expanded.adjustment_reason,
  expanded.reviewed_at,
  expanded.review_date,
  expanded.latest_outcome_id,
  case expanded.suggestion_type
    when 'TOPUP' then to_jsonb(expanded.actual_topup_usdt)
    when 'QUOTE' then to_jsonb(expanded.actual_quote_rate)
    else expanded.actual_risk_outcomes
  end as observed_actual_value,
  expanded.actual_cash_profit_usdt,
  expanded.actual_economic_profit_usdt,
  expanded.outcome_reason,
  expanded.measured_at,
  case expanded.suggestion_type
    when 'TOPUP' then abs(
      expanded.final_topup_usdt
      - expanded.system_recommended_topup_usdt
    )
    when 'QUOTE' then abs(
      expanded.final_quote_rate
      - expanded.system_recommended_quote_rate
    )
    else null
  end::numeric(38,12) as absolute_human_difference,
  case
    when (
      expanded.outcome_snapshot
        ->> 'fundingPressureBeforeVnd'
    ) ~ '^[0-9]+([.][0-9]+)?$'
      and (
        expanded.outcome_snapshot
          ->> 'fundingPressureAfterVnd'
      ) ~ '^[0-9]+([.][0-9]+)?$'
      then (
        (
          expanded.outcome_snapshot
            ->> 'fundingPressureAfterVnd'
        )::numeric
        < (
          expanded.outcome_snapshot
            ->> 'fundingPressureBeforeVnd'
        )::numeric
      )
    else null
  end as funding_pressure_improved,
  true as descriptive_statistics_only,
  true as shadow_mode,
  false as automatic_optimization,
  false as automatic_action
from expanded;

create or replace view public.shadow_run_decision_accuracy_metrics
with (security_invoker = true)
as
with pressure_evidence as (
  select distinct on (comparison.human_decision_id)
    comparison.currency,
    comparison.human_decision_id,
    comparison.funding_pressure_improved
  from public.shadow_run_decision_comparisons comparison
  where comparison.suggestion_type = 'TOPUP'
    and comparison.recommendation_time
      >= now() - interval '90 days'
  order by
    comparison.human_decision_id,
    comparison.measured_at desc nulls last
),
pressure_summary as (
  select
    pressure_evidence.currency,
    count(*) filter (
      where pressure_evidence.funding_pressure_improved
        is not null
    )::bigint as topup_pressure_evaluable_count,
    avg(
      pressure_evidence.funding_pressure_improved::integer
    ) filter (
      where pressure_evidence.funding_pressure_improved
        is not null
    )::numeric(18,12) as
      topup_pressure_improvement_rate
  from pressure_evidence
  group by pressure_evidence.currency
)
select
  accuracy.currency,
  accuracy.learning_window_days,
  accuracy.reviewed_decision_count,
  accuracy.evaluated_outcome_count,
  accuracy.topup_evaluable_count,
  accuracy.average_topup_absolute_error_usdt,
  accuracy.topup_accuracy_rate as
    topup_amount_within_ten_percent_rate,
  coalesce(
    pressure_summary.topup_pressure_evaluable_count,
    0
  )::bigint as topup_pressure_evaluable_count,
  pressure_summary.topup_pressure_improvement_rate,
  accuracy.quote_evaluable_count,
  accuracy.average_quote_absolute_deviation,
  accuracy.cash_profit_evaluable_count,
  accuracy.average_cash_profit_absolute_error_usdt,
  accuracy.economic_profit_evaluable_count,
  accuracy.average_economic_profit_absolute_error_usdt,
  accuracy.risk_evaluable_count,
  accuracy.risk_alert_hit_rate,
  accuracy.latest_measured_at,
  true as descriptive_statistics_only,
  false as automatic_optimization,
  false as automatic_action
from public.settlement_decision_accuracy_90d accuracy
left join pressure_summary
  on pressure_summary.currency = accuracy.currency;

create or replace view public.shadow_run_daily_reviews
with (security_invoker = true)
as
select
  daily.currency,
  daily.shadow_date as review_date,
  daily.system_recommendation_count,
  daily.human_decision_count,
  daily.accepted_count,
  daily.modified_count,
  daily.rejected_count,
  coalesce(
    jsonb_agg(
      jsonb_build_object(
        'recommendationId',
        comparison.recommendation_id,
        'suggestionType',
        comparison.suggestion_type,
        'systemValue',
        comparison.system_suggested_value,
        'systemReason',
        comparison.system_suggestion_reason
      )
      order by
        comparison.recommendation_time,
        comparison.suggestion_type
    ) filter (
      where comparison.recommendation_id is not null
    ),
    '[]'::jsonb
  ) as system_major_suggestions,
  coalesce(
    jsonb_agg(
      jsonb_build_object(
        'humanDecisionId',
        comparison.human_decision_id,
        'suggestionType',
        comparison.suggestion_type,
        'acceptanceStatus',
        comparison.acceptance_status,
        'finalValue',
        comparison.human_final_value,
        'reason',
        comparison.adjustment_reason
      )
      order by
        comparison.reviewed_at,
        comparison.suggestion_type
    ) filter (
      where comparison.acceptance_status in (
        'MODIFIED',
        'REJECTED'
      )
    ),
    '[]'::jsonb
  ) as human_major_adjustments,
  biggest.suggestion_type as biggest_difference_type,
  biggest.system_suggested_value as
    biggest_difference_system_value,
  biggest.human_final_value as
    biggest_difference_human_value,
  biggest.absolute_human_difference as
    biggest_absolute_difference,
  biggest.adjustment_reason as biggest_difference_reason,
  coalesce(
    jsonb_agg(
      jsonb_build_object(
        'humanDecisionId',
        comparison.human_decision_id,
        'learningReason',
        comparison.adjustment_reason,
        'observedOutcomeReason',
        comparison.outcome_reason
      )
      order by comparison.reviewed_at
    ) filter (
      where comparison.acceptance_status in (
        'MODIFIED',
        'REJECTED'
      )
    ),
    '[]'::jsonb
  ) as learning_records,
  true as auto_generated,
  true as descriptive_statistics_only,
  true as shadow_mode,
  false as automatic_optimization,
  false as automatic_action
from public.shadow_run_daily_metrics daily
left join public.shadow_run_decision_comparisons comparison
  on comparison.currency = daily.currency
  and comparison.review_date = daily.shadow_date
left join lateral (
  select ranked.*
  from public.shadow_run_decision_comparisons ranked
  where ranked.currency = daily.currency
    and ranked.review_date = daily.shadow_date
    and ranked.acceptance_status in ('MODIFIED', 'REJECTED')
  order by
    ranked.absolute_human_difference desc nulls last,
    ranked.reviewed_at desc,
    ranked.human_decision_id
  limit 1
) biggest on true
group by
  daily.currency,
  daily.shadow_date,
  daily.system_recommendation_count,
  daily.human_decision_count,
  daily.accepted_count,
  daily.modified_count,
  daily.rejected_count,
  biggest.suggestion_type,
  biggest.system_suggested_value,
  biggest.human_final_value,
  biggest.absolute_human_difference,
  biggest.adjustment_reason;

alter table public.shadow_run_market_context_notes
  enable row level security;

create policy shadow_run_market_context_notes_read
on public.shadow_run_market_context_notes
for select to authenticated
using (true);

create policy shadow_run_market_context_notes_insert
on public.shadow_run_market_context_notes
for insert to authenticated
with check (
  (select auth.uid()) = recorded_by
  and (
    public.has_role('admin'::public.app_role)
    or public.has_role('settlement_operator'::public.app_role)
    or public.has_role('approver'::public.app_role)
  )
  and shadow_mode
  and not quote_impact_applied
  and not automatic_action
  and not automatic_payment
  and not automatic_topup
  and not automatic_quote_change
  and not automatic_trading
);

revoke all on public.shadow_run_market_context_notes
from anon, authenticated;
grant select, insert on public.shadow_run_market_context_notes
to authenticated;
grant all on public.shadow_run_market_context_notes
to service_role;

revoke all on
  public.shadow_run_daily_metrics,
  public.shadow_run_decision_comparisons,
  public.shadow_run_decision_accuracy_metrics,
  public.shadow_run_daily_reviews
from anon;
grant select on
  public.shadow_run_daily_metrics,
  public.shadow_run_decision_comparisons,
  public.shadow_run_decision_accuracy_metrics,
  public.shadow_run_daily_reviews
to authenticated, service_role;

create trigger audit_shadow_run_market_context_notes
after insert or update or delete
on public.shadow_run_market_context_notes
for each row execute function public.audit_mutation();

do $$
begin
  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'shadow_run_market_context_notes'
      and cmd in ('UPDATE', 'DELETE', 'ALL')
  ) then
    raise exception
      'SHADOW_RUN_MARKET_NOTES_MUST_NOT_HAVE_MUTATION_POLICIES';
  end if;
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'shadow_run_market_context_notes_immutable'
      and not tgisinternal
  ) then
    raise exception 'SHADOW_RUN_MARKET_NOTE_IMMUTABILITY_MISSING';
  end if;
  if exists (
    select 1
    from public.shadow_run_market_context_notes note
    where not note.shadow_mode
      or note.quote_impact_applied
      or note.automatic_action
      or note.automatic_payment
      or note.automatic_topup
      or note.automatic_quote_change
      or note.automatic_trading
  ) then
    raise exception 'TASK_2_12_SHADOW_GUARD_FAILED';
  end if;
end
$$;

comment on table public.shadow_run_market_context_notes is
  'Immutable human market observations. Notes do not automatically affect quotes, funding or execution.';
comment on view public.shadow_run_daily_metrics is
  'Daily recommendation and human-decision activity with acceptance, modification and rejection rates.';
comment on view public.shadow_run_decision_comparisons is
  'Suggestion-versus-human-result evidence derived from the existing immutable learning and outcome records.';
comment on view public.shadow_run_decision_accuracy_metrics is
  '90-day descriptive accuracy metrics only; no automatic model optimization or execution.';
comment on view public.shadow_run_daily_reviews is
  'Automatically derived daily review summary. It does not create or execute a recommendation.';
