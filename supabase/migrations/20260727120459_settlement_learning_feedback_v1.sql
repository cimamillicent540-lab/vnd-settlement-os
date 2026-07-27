-- Task 2.8 — Settlement Learning & Human Decision Feedback Loop V1.
-- Phase 1 only: the system records recommendations and humans append decisions.
-- Nothing in this migration can pay, top up, trade, or change a customer quote.

create table public.settlement_learning_recommendations (
  id uuid primary key default gen_random_uuid(),
  client_request_id uuid not null unique,
  currency text not null
    check (currency ~ '^[A-Z]{3}$'),
  recommendation_time timestamptz not null default now(),
  learning_phase text not null default 'PHASE_1_HUMAN_REVIEW'
    check (learning_phase = 'PHASE_1_HUMAN_REVIEW'),
  learning_window_days smallint not null default 90
    check (learning_window_days = 90),
  learning_dimensions text[] not null default array[
    'fx_spread',
    'risk',
    'topup',
    'merchant',
    'channel',
    'geopolitics'
  ]::text[],
  system_topup_recommended boolean not null,
  system_recommended_topup_usdt numeric(38,8)
    check (
      system_recommended_topup_usdt is null
      or system_recommended_topup_usdt >= 0
    ),
  system_required_gross_topup_vnd numeric(38,2) not null
    check (system_required_gross_topup_vnd >= 0),
  system_recommended_quote_rate numeric(38,12)
    check (
      system_recommended_quote_rate is null
      or system_recommended_quote_rate > 0
    ),
  system_target_margin numeric(18,12) not null
    check (system_target_margin >= 0),
  system_risk_alerts jsonb not null default '[]'::jsonb
    check (jsonb_typeof(system_risk_alerts) = 'array'),
  system_expected_profit_usdt numeric(38,12),
  system_expected_profit_margin numeric(18,12),
  system_fx_judgment text not null
    check (
      system_fx_judgment in (
        'BUY_VND_OPPORTUNITY',
        'NORMAL',
        'RISK',
        'WAITING_INPUT'
      )
    ),
  system_xe_rate numeric(38,12)
    check (system_xe_rate is null or system_xe_rate > 0),
  system_p2p_cost_rate numeric(38,12)
    check (
      system_p2p_cost_rate is null
      or system_p2p_cost_rate > 0
    ),
  system_fx_spread_ratio numeric(18,12),
  system_payload jsonb not null
    check (jsonb_typeof(system_payload) = 'object'),
  data_cutoff_snapshot jsonb not null default '{}'::jsonb
    check (jsonb_typeof(data_cutoff_snapshot) = 'object'),
  model_version text not null default 'SETTLEMENT_LEARNING_V1',
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
  generated_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create index settlement_learning_recommendations_currency_time_idx
  on public.settlement_learning_recommendations(
    currency,
    recommendation_time desc,
    id desc
  );
create index settlement_learning_recommendations_generated_by_idx
  on public.settlement_learning_recommendations(generated_by);

create table public.settlement_human_decisions (
  id uuid primary key default gen_random_uuid(),
  recommendation_id uuid not null
    references public.settlement_learning_recommendations(id),
  decision_version integer not null
    check (decision_version > 0),
  supersedes_decision_id uuid
    references public.settlement_human_decisions(id),
  decision_scope text not null
    check (
      decision_scope in (
        'FULL_REVIEW',
        'TOPUP',
        'QUOTE',
        'RISK'
      )
    ),
  acceptance_status text not null
    check (
      acceptance_status in (
        'ACCEPTED',
        'MODIFIED',
        'REJECTED'
      )
    ),
  accepted_system_suggestion boolean generated always as (
    acceptance_status = 'ACCEPTED'
  ) stored,
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
  adjustment_reason text not null
    check (char_length(btrim(adjustment_reason)) > 0),
  merchant_name text,
  transaction_volume_usdt numeric(38,8)
    check (
      transaction_volume_usdt is null
      or transaction_volume_usdt >= 0
    ),
  profit_contribution_usdt numeric(38,12),
  reviewer_id uuid not null references auth.users(id),
  reviewed_at timestamptz not null default now(),
  shadow_mode boolean not null default true
    check (shadow_mode),
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
  created_at timestamptz not null default now(),
  unique (recommendation_id, decision_version),
  unique (supersedes_decision_id),
  check (
    supersedes_decision_id is not null
    or decision_version = 1
  ),
  check (
    decision_scope <> 'QUOTE'
    or (
      final_quote_rate is not null
      and merchant_name is not null
      and char_length(btrim(merchant_name)) > 0
      and transaction_volume_usdt is not null
      and profit_contribution_usdt is not null
    )
  ),
  check (
    decision_scope <> 'TOPUP'
    or final_topup_usdt is not null
  )
);

create index settlement_human_decisions_recommendation_idx
  on public.settlement_human_decisions(
    recommendation_id,
    decision_version desc
  );
create index settlement_human_decisions_reviewer_idx
  on public.settlement_human_decisions(reviewer_id);
create index settlement_human_decisions_reviewed_at_idx
  on public.settlement_human_decisions(reviewed_at desc);

create table public.settlement_risk_feedback (
  id uuid primary key default gen_random_uuid(),
  recommendation_id uuid not null
    references public.settlement_learning_recommendations(id),
  human_decision_id uuid not null
    references public.settlement_human_decisions(id),
  risk_code text not null
    check (char_length(btrim(risk_code)) > 0),
  system_severity text not null
    check (system_severity in ('INFO', 'WARNING', 'HIGH')),
  system_message text not null
    check (char_length(btrim(system_message)) > 0),
  human_judgment text not null
    check (human_judgment in ('CONFIRMED', 'IGNORED')),
  human_note text,
  reviewer_id uuid not null references auth.users(id),
  reviewed_at timestamptz not null default now(),
  shadow_mode boolean not null default true
    check (shadow_mode),
  automatic_action boolean not null default false
    check (automatic_action = false),
  created_at timestamptz not null default now(),
  unique (human_decision_id, risk_code)
);

create index settlement_risk_feedback_recommendation_idx
  on public.settlement_risk_feedback(recommendation_id);
create index settlement_risk_feedback_reviewer_idx
  on public.settlement_risk_feedback(reviewer_id);

create or replace function private.reject_settlement_learning_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception
    'SETTLEMENT_LEARNING_HISTORY_IS_IMMUTABLE_APPEND_A_NEW_DECISION_VERSION';
end
$$;

create trigger settlement_learning_recommendations_immutable
before update or delete on public.settlement_learning_recommendations
for each row
execute function private.reject_settlement_learning_mutation();

create trigger settlement_human_decisions_immutable
before update or delete on public.settlement_human_decisions
for each row
execute function private.reject_settlement_learning_mutation();

create trigger settlement_risk_feedback_immutable
before update or delete on public.settlement_risk_feedback
for each row
execute function private.reject_settlement_learning_mutation();

create or replace function private.validate_settlement_decision_risks()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  expected_risk_count integer;
  recorded_risk_count integer;
begin
  if new.decision_scope not in ('FULL_REVIEW', 'RISK') then
    return null;
  end if;

  select jsonb_array_length(recommendation.system_risk_alerts)
  into expected_risk_count
  from public.settlement_learning_recommendations recommendation
  where recommendation.id = new.recommendation_id;

  select count(*)::integer
  into recorded_risk_count
  from public.settlement_risk_feedback feedback
  where feedback.human_decision_id = new.id;

  if recorded_risk_count <> expected_risk_count then
    raise exception 'ALL_SYSTEM_RISKS_REQUIRE_HUMAN_JUDGMENT';
  end if;
  return null;
end
$$;

create constraint trigger settlement_human_decision_risks_complete
after insert on public.settlement_human_decisions
deferrable initially deferred
for each row
execute function private.validate_settlement_decision_risks();

create or replace function public.record_settlement_human_decision_v1(
  p_recommendation_id uuid,
  p_decision_scope text,
  p_acceptance_status text,
  p_final_topup_usdt numeric,
  p_final_quote_rate numeric,
  p_final_execution_decision text,
  p_adjustment_reason text,
  p_merchant_name text default null,
  p_transaction_volume_usdt numeric default null,
  p_profit_contribution_usdt numeric default null,
  p_risk_feedback jsonb default '[]'::jsonb
)
returns table(decision_id uuid, decision_version integer)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  recommendation_row public.settlement_learning_recommendations%rowtype;
  next_version integer;
  previous_decision_id uuid;
  inserted_decision_id uuid;
  feedback_count integer;
begin
  if (select auth.uid()) is null then
    raise exception 'AUTHENTICATION_REQUIRED';
  end if;
  if not (
    public.has_role('admin'::public.app_role)
    or public.has_role('settlement_operator'::public.app_role)
    or public.has_role('approver'::public.app_role)
  ) then
    raise exception 'INSUFFICIENT_REVIEW_ROLE';
  end if;
  if p_decision_scope not in (
    'FULL_REVIEW',
    'TOPUP',
    'QUOTE',
    'RISK'
  ) then
    raise exception 'INVALID_DECISION_SCOPE';
  end if;
  if p_acceptance_status not in (
    'ACCEPTED',
    'MODIFIED',
    'REJECTED'
  ) then
    raise exception 'INVALID_ACCEPTANCE_STATUS';
  end if;
  if p_final_execution_decision not in (
    'ACCEPT_FOR_MANUAL_EXECUTION',
    'DO_NOT_EXECUTE',
    'DEFER',
    'NOT_APPLICABLE'
  ) then
    raise exception 'INVALID_FINAL_EXECUTION_DECISION';
  end if;
  if p_adjustment_reason is null
    or char_length(btrim(p_adjustment_reason)) = 0 then
    raise exception 'ADJUSTMENT_REASON_REQUIRED';
  end if;
  if jsonb_typeof(p_risk_feedback) <> 'array' then
    raise exception 'RISK_FEEDBACK_MUST_BE_AN_ARRAY';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_recommendation_id::text, 0)
  );

  select *
  into recommendation_row
  from public.settlement_learning_recommendations recommendation
  where recommendation.id = p_recommendation_id;
  if not found then
    raise exception 'SETTLEMENT_RECOMMENDATION_NOT_FOUND';
  end if;

  if p_decision_scope = 'QUOTE'
    and (
      p_final_quote_rate is null
      or p_merchant_name is null
      or char_length(btrim(p_merchant_name)) = 0
      or p_transaction_volume_usdt is null
      or p_profit_contribution_usdt is null
    ) then
    raise exception 'QUOTE_REVIEW_CONTEXT_REQUIRED';
  end if;
  if p_decision_scope = 'TOPUP'
    and p_final_topup_usdt is null then
    raise exception 'FINAL_TOPUP_AMOUNT_REQUIRED';
  end if;

  select count(*)::integer
  into feedback_count
  from jsonb_array_elements(p_risk_feedback);

  if exists (
    select 1
    from jsonb_array_elements(p_risk_feedback) feedback
    where feedback->>'risk_code' is null
      or feedback->>'human_judgment' not in ('CONFIRMED', 'IGNORED')
  ) then
    raise exception 'INVALID_RISK_FEEDBACK';
  end if;
  if feedback_count <> (
    select count(distinct feedback->>'risk_code')
    from jsonb_array_elements(p_risk_feedback) feedback
  ) then
    raise exception 'DUPLICATE_RISK_FEEDBACK';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_risk_feedback) feedback
    where not exists (
      select 1
      from jsonb_array_elements(
        recommendation_row.system_risk_alerts
      ) alert
      where alert->>'code' = feedback->>'risk_code'
    )
  ) then
    raise exception 'RISK_FEEDBACK_NOT_IN_SYSTEM_RECOMMENDATION';
  end if;
  if p_decision_scope in ('FULL_REVIEW', 'RISK')
    and feedback_count <> jsonb_array_length(
      recommendation_row.system_risk_alerts
    ) then
    raise exception 'ALL_SYSTEM_RISKS_REQUIRE_HUMAN_JUDGMENT';
  end if;

  select
    coalesce(max(decision.decision_version), 0) + 1,
    (
      array_agg(
        decision.id
        order by decision.decision_version desc
      )
    )[1]
  into next_version, previous_decision_id
  from public.settlement_human_decisions decision
  where decision.recommendation_id = p_recommendation_id;

  insert into public.settlement_human_decisions(
    recommendation_id,
    decision_version,
    supersedes_decision_id,
    decision_scope,
    acceptance_status,
    final_topup_usdt,
    final_quote_rate,
    final_execution_decision,
    adjustment_reason,
    merchant_name,
    transaction_volume_usdt,
    profit_contribution_usdt,
    reviewer_id,
    shadow_mode,
    actual_execution_performed,
    automatic_payment,
    automatic_topup,
    automatic_quote_change,
    automatic_trading
  )
  values (
    p_recommendation_id,
    next_version,
    previous_decision_id,
    p_decision_scope,
    p_acceptance_status,
    p_final_topup_usdt,
    p_final_quote_rate,
    p_final_execution_decision,
    btrim(p_adjustment_reason),
    nullif(btrim(p_merchant_name), ''),
    p_transaction_volume_usdt,
    p_profit_contribution_usdt,
    (select auth.uid()),
    true,
    false,
    false,
    false,
    false,
    false
  )
  returning id into inserted_decision_id;

  insert into public.settlement_risk_feedback(
    recommendation_id,
    human_decision_id,
    risk_code,
    system_severity,
    system_message,
    human_judgment,
    human_note,
    reviewer_id,
    shadow_mode,
    automatic_action
  )
  select
    p_recommendation_id,
    inserted_decision_id,
    feedback->>'risk_code',
    matched.matching_alert->>'severity',
    matched.matching_alert->>'message',
    feedback->>'human_judgment',
    nullif(btrim(feedback->>'human_note'), ''),
    (select auth.uid()),
    true,
    false
  from jsonb_array_elements(p_risk_feedback) feedback
  join lateral (
    select matching_alert
    from jsonb_array_elements(
      recommendation_row.system_risk_alerts
    ) matching_alert
    where matching_alert->>'code' = feedback->>'risk_code'
    limit 1
  ) matched on true;

  return query
  select inserted_decision_id, next_version;
end
$$;

create or replace view public.settlement_learning_latest_decisions
with (security_invoker = true)
as
select distinct on (decision.recommendation_id)
  decision.id,
  decision.recommendation_id,
  decision.decision_version,
  decision.supersedes_decision_id,
  decision.decision_scope,
  decision.acceptance_status,
  decision.accepted_system_suggestion,
  decision.final_topup_usdt,
  decision.final_quote_rate,
  decision.final_execution_decision,
  decision.adjustment_reason,
  decision.merchant_name,
  decision.transaction_volume_usdt,
  decision.profit_contribution_usdt,
  decision.reviewer_id,
  decision.reviewed_at,
  decision.shadow_mode,
  decision.actual_execution_performed
from public.settlement_human_decisions decision
order by
  decision.recommendation_id,
  decision.decision_version desc,
  decision.id desc;

create or replace view public.settlement_learning_90d_summary
with (security_invoker = true)
as
with recent_recommendations as (
  select recommendation.*
  from public.settlement_learning_recommendations recommendation
  where recommendation.recommendation_time >= now() - interval '90 days'
),
latest_decisions as (
  select latest.*
  from public.settlement_learning_latest_decisions latest
),
risk_totals as (
  select
    decision.recommendation_id,
    count(*) filter (
      where feedback.human_judgment = 'CONFIRMED'
    )::bigint as confirmed_risk_count,
    count(*) filter (
      where feedback.human_judgment = 'IGNORED'
    )::bigint as ignored_risk_count
  from latest_decisions decision
  join public.settlement_risk_feedback feedback
    on feedback.human_decision_id = decision.id
  group by decision.recommendation_id
)
select
  recommendation.currency,
  90::smallint as learning_window_days,
  count(*)::bigint as recommendation_count,
  count(decision.id)::bigint as reviewed_count,
  count(*) filter (
    where decision.id is null
  )::bigint as pending_count,
  count(*) filter (
    where decision.acceptance_status = 'ACCEPTED'
  )::bigint as accepted_count,
  count(*) filter (
    where decision.acceptance_status = 'MODIFIED'
  )::bigint as modified_count,
  count(*) filter (
    where decision.acceptance_status = 'REJECTED'
  )::bigint as rejected_count,
  avg(recommendation.system_recommended_topup_usdt)
    as average_system_topup_usdt,
  avg(decision.final_topup_usdt)
    as average_human_topup_usdt,
  avg(
    abs(
      decision.final_topup_usdt
      - recommendation.system_recommended_topup_usdt
    )
  ) as average_topup_adjustment_usdt,
  avg(recommendation.system_recommended_quote_rate)
    as average_system_quote_rate,
  avg(decision.final_quote_rate)
    as average_human_quote_rate,
  avg(
    abs(
      decision.final_quote_rate
      - recommendation.system_recommended_quote_rate
    )
  ) as average_quote_adjustment,
  coalesce(sum(risk.confirmed_risk_count), 0)::bigint
    as confirmed_risk_count,
  coalesce(sum(risk.ignored_risk_count), 0)::bigint
    as ignored_risk_count,
  max(recommendation.recommendation_time)
    as latest_recommendation_time
from recent_recommendations recommendation
left join latest_decisions decision
  on decision.recommendation_id = recommendation.id
left join risk_totals risk
  on risk.recommendation_id = recommendation.id
group by recommendation.currency;

alter table public.settlement_learning_recommendations
  enable row level security;
alter table public.settlement_human_decisions
  enable row level security;
alter table public.settlement_risk_feedback
  enable row level security;

create policy settlement_learning_recommendations_read
on public.settlement_learning_recommendations
for select to authenticated
using (true);

create policy settlement_learning_recommendations_insert
on public.settlement_learning_recommendations
for insert to authenticated
with check (
  (select auth.uid()) = generated_by
  and (
    public.has_role('admin'::public.app_role)
    or public.has_role('settlement_operator'::public.app_role)
  )
  and learning_phase = 'PHASE_1_HUMAN_REVIEW'
  and learning_window_days = 90
  and shadow_mode
  and not automatic_payment
  and not automatic_topup
  and not automatic_quote_change
  and not automatic_trading
);

create policy settlement_human_decisions_read
on public.settlement_human_decisions
for select to authenticated
using (true);

create policy settlement_human_decisions_insert
on public.settlement_human_decisions
for insert to authenticated
with check (
  (select auth.uid()) = reviewer_id
  and (
    public.has_role('admin'::public.app_role)
    or public.has_role('settlement_operator'::public.app_role)
    or public.has_role('approver'::public.app_role)
  )
  and shadow_mode
  and not actual_execution_performed
  and not automatic_payment
  and not automatic_topup
  and not automatic_quote_change
  and not automatic_trading
);

create policy settlement_risk_feedback_read
on public.settlement_risk_feedback
for select to authenticated
using (true);

create policy settlement_risk_feedback_insert
on public.settlement_risk_feedback
for insert to authenticated
with check (
  (select auth.uid()) = reviewer_id
  and exists (
    select 1
    from public.settlement_human_decisions decision
    where decision.id = human_decision_id
      and decision.recommendation_id = recommendation_id
      and decision.reviewer_id = (select auth.uid())
  )
  and (
    public.has_role('admin'::public.app_role)
    or public.has_role('settlement_operator'::public.app_role)
    or public.has_role('approver'::public.app_role)
  )
  and shadow_mode
  and not automatic_action
);

revoke all on
  public.settlement_learning_recommendations,
  public.settlement_human_decisions,
  public.settlement_risk_feedback
from anon;
revoke all on
  public.settlement_learning_recommendations,
  public.settlement_human_decisions,
  public.settlement_risk_feedback
from authenticated;

grant select, insert on
  public.settlement_learning_recommendations,
  public.settlement_human_decisions,
  public.settlement_risk_feedback
to authenticated;
grant select on
  public.settlement_learning_latest_decisions,
  public.settlement_learning_90d_summary
to authenticated;
grant all on
  public.settlement_learning_recommendations,
  public.settlement_human_decisions,
  public.settlement_risk_feedback
to service_role;
grant select on
  public.settlement_learning_latest_decisions,
  public.settlement_learning_90d_summary
to service_role;

revoke all on function public.record_settlement_human_decision_v1(
  uuid,
  text,
  text,
  numeric,
  numeric,
  text,
  text,
  text,
  numeric,
  numeric,
  jsonb
) from public, anon;
grant execute on function public.record_settlement_human_decision_v1(
  uuid,
  text,
  text,
  numeric,
  numeric,
  text,
  text,
  text,
  numeric,
  numeric,
  jsonb
) to authenticated, service_role;

create trigger audit_settlement_learning_recommendations
after insert or update or delete
on public.settlement_learning_recommendations
for each row execute function public.audit_mutation();

create trigger audit_settlement_human_decisions
after insert or update or delete
on public.settlement_human_decisions
for each row execute function public.audit_mutation();

create trigger audit_settlement_risk_feedback
after insert or update or delete
on public.settlement_risk_feedback
for each row execute function public.audit_mutation();

do $$
begin
  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'settlement_learning_recommendations',
        'settlement_human_decisions',
        'settlement_risk_feedback'
      )
      and cmd in ('UPDATE', 'DELETE', 'ALL')
  ) then
    raise exception
      'SETTLEMENT_LEARNING_TABLES_MUST_NOT_HAVE_MUTATION_POLICIES';
  end if;
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'settlement_learning_recommendations_immutable'
      and not tgisinternal
  ) then
    raise exception
      'SETTLEMENT_LEARNING_IMMUTABILITY_TRIGGER_MISSING';
  end if;
end
$$;

comment on table public.settlement_learning_recommendations is
  'Immutable Phase 1 system recommendations, isolated by currency and retained for the 90-day learning window.';
comment on table public.settlement_human_decisions is
  'Append-only human decisions. ACCEPT_FOR_MANUAL_EXECUTION records intent only and never performs an external action.';
comment on table public.settlement_risk_feedback is
  'Append-only human confirmation or rejection of each system risk alert.';
comment on function public.record_settlement_human_decision_v1 is
  'Atomically appends a Phase 1 human decision and risk feedback. It performs no payment, topup, quote change, or trade.';
