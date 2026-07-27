-- Task 2.9 — VND Settlement Control Center V1.
-- Daily aggregation and human review only. No payment, topup, quote update,
-- market-data collection, or trading execution is introduced.

create table public.settlement_control_center_snapshots (
  id uuid primary key default gen_random_uuid(),
  client_request_id uuid not null unique,
  snapshot_date date not null,
  as_of timestamptz not null default now(),
  currency text not null check (currency = 'VND'),
  source_learning_recommendation_id uuid
    references public.settlement_learning_recommendations(id),
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
  funds_risk_status text not null
    check (funds_risk_status in ('NORMAL', 'WARNING', 'CRITICAL')),
  forecast_payout_vnd numeric(38,2) not null
    check (forecast_payout_vnd >= 0),
  forecast_payin_vnd numeric(38,2) not null
    check (forecast_payin_vnd >= 0),
  forecast_net_demand_vnd numeric(38,2) not null
    check (forecast_net_demand_vnd >= 0),
  peak_pressure_vnd numeric(38,2) not null
    check (peak_pressure_vnd >= 0),
  learning_adjustment_vnd numeric(38,2) not null default 0
    check (learning_adjustment_vnd >= 0),
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
  topup_reasons jsonb not null default '[]'::jsonb
    check (jsonb_typeof(topup_reasons) = 'array'),
  topup_objectives text[] not null,
  inventory_vnd numeric(38,2) not null
    check (inventory_vnd >= 0),
  inventory_limit_rate numeric(38,12) not null default 26500
    check (inventory_limit_rate = 26500),
  maximum_inventory_usdt numeric(38,8) not null default 50000
    check (maximum_inventory_usdt = 50000),
  maximum_inventory_vnd numeric(38,2) not null default 1325000000
    check (maximum_inventory_vnd = 1325000000),
  projected_inventory_vnd numeric(38,2) not null
    check (projected_inventory_vnd >= 0),
  inventory_limit_status text not null
    check (
      inventory_limit_status in (
        'WITHIN_LIMIT',
        'MANUAL_CONFIRMATION_REQUIRED'
      )
    ),
  manual_inventory_confirmation_required boolean not null,
  xe_rate numeric(38,12)
    check (xe_rate is null or xe_rate > 0),
  p2p_cost_rate numeric(38,12)
    check (p2p_cost_rate is null or p2p_cost_rate > 0),
  company_quote_rate numeric(38,12)
    check (company_quote_rate is null or company_quote_rate > 0),
  fx_spread_vnd_per_usdt numeric(38,12),
  fx_opportunity_status text not null
    check (
      fx_opportunity_status in (
        'BUY_VND_OPPORTUNITY',
        'NORMAL',
        'RISK',
        'WAITING_INPUT'
      )
    ),
  merchant_quote_recommendations jsonb not null default '[]'::jsonb
    check (jsonb_typeof(merchant_quote_recommendations) = 'array'),
  execution_ready_count bigint not null
    check (execution_ready_count >= 0),
  execution_blocked_count bigint not null
    check (execution_blocked_count >= 0),
  execution_warning_count bigint not null
    check (execution_warning_count >= 0),
  execution_guard_snapshot jsonb not null default '{}'::jsonb
    check (jsonb_typeof(execution_guard_snapshot) = 'object'),
  risk_alerts jsonb not null default '[]'::jsonb
    check (jsonb_typeof(risk_alerts) = 'array'),
  learning_90d_snapshot jsonb not null default '{}'::jsonb
    check (jsonb_typeof(learning_90d_snapshot) = 'object'),
  data_cutoff_snapshot jsonb not null default '{}'::jsonb
    check (jsonb_typeof(data_cutoff_snapshot) = 'object'),
  rules_version text not null default 'SETTLEMENT_CONTROL_CENTER_V1',
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
    gross_balance_vnd = 0
    or abs(
      available_funds_ratio
      - settleable_balance_vnd / gross_balance_vnd
    ) <= 0.000000000001
  ),
  check (
    (inventory_limit_status = 'MANUAL_CONFIRMATION_REQUIRED')
    = manual_inventory_confirmation_required
  ),
  check (
    (projected_inventory_vnd > maximum_inventory_vnd)
    = manual_inventory_confirmation_required
  )
);

create index settlement_control_center_snapshots_latest_idx
  on public.settlement_control_center_snapshots(
    currency,
    snapshot_date desc,
    as_of desc,
    id desc
  );
create index settlement_control_center_snapshots_learning_idx
  on public.settlement_control_center_snapshots(
    source_learning_recommendation_id
  )
  where source_learning_recommendation_id is not null;
create index settlement_control_center_snapshots_created_by_idx
  on public.settlement_control_center_snapshots(created_by);

create table public.settlement_control_center_risk_reviews (
  id uuid primary key default gen_random_uuid(),
  control_snapshot_id uuid not null
    references public.settlement_control_center_snapshots(id),
  risk_code text not null
    check (char_length(btrim(risk_code)) > 0),
  review_version integer not null
    check (review_version > 0),
  supersedes_review_id uuid
    references public.settlement_control_center_risk_reviews(id),
  human_judgment text not null
    check (human_judgment in ('CONFIRMED', 'IGNORED')),
  human_note text,
  reviewed_by uuid not null references auth.users(id),
  reviewed_at timestamptz not null default now(),
  shadow_mode boolean not null default true check (shadow_mode),
  automatic_action boolean not null default false
    check (automatic_action = false),
  created_at timestamptz not null default now(),
  unique (control_snapshot_id, risk_code, review_version),
  unique (supersedes_review_id),
  check (
    supersedes_review_id is not null
    or review_version = 1
  )
);

create index settlement_control_center_risk_reviews_lookup_idx
  on public.settlement_control_center_risk_reviews(
    control_snapshot_id,
    risk_code,
    review_version desc
  );
create index settlement_control_center_risk_reviews_reviewed_by_idx
  on public.settlement_control_center_risk_reviews(reviewed_by);

create or replace view public.settlement_control_center_merchant_baseline
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
  payout.merchant as merchant_name,
  count(*)::bigint as payout_count,
  count(distinct payout.channel)::bigint as channel_count,
  coalesce(
    sum(calculation.merchant_principal_usdt),
    0
  )::numeric(38,8) as transaction_volume_usdt,
  coalesce(
    sum(calculation.total_company_revenue_usdt),
    0
  )::numeric(38,12) as contribution_usdt,
  avg(calculation.current_manual_as_rate)::numeric(38,12)
    as current_quote_rate,
  case
    when coalesce(
      sum(calculation.merchant_principal_usdt),
      0
    ) = 0 then null
    else (
      sum(calculation.economic_profit_usdt)
      / sum(calculation.merchant_principal_usdt)
    )::numeric(18,12)
  end as current_profit_margin,
  case
    when coalesce(
      sum(calculation.merchant_principal_usdt),
      0
    ) = 0 then null
    else (
      sum(calculation.merchant_fee_usdt)
      / sum(calculation.merchant_principal_usdt)
    )::numeric(18,12)
  end as merchant_fee_rate,
  max(latest_run.rules_version) as source_rules_version,
  max(latest_run.created_at) as source_run_time
from latest_run
join public.payout_profit_calculations calculation
  on calculation.pricing_run_id = latest_run.id
join public.payout_orders payout
  on payout.id = calculation.payout_order_id
where payout.status = 'SUCCESS'
  and payout.merchant is not null
  and char_length(btrim(payout.merchant)) > 0
group by payout.merchant;

create or replace view
  public.settlement_control_center_latest_risk_reviews
with (security_invoker = true)
as
select distinct on (
  review.control_snapshot_id,
  review.risk_code
)
  review.id,
  review.control_snapshot_id,
  review.risk_code,
  review.review_version,
  review.supersedes_review_id,
  review.human_judgment,
  review.human_note,
  review.reviewed_by,
  review.reviewed_at,
  review.shadow_mode,
  review.automatic_action
from public.settlement_control_center_risk_reviews review
order by
  review.control_snapshot_id,
  review.risk_code,
  review.review_version desc,
  review.id desc;

create or replace function private.reject_control_center_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception
    'CONTROL_CENTER_HISTORY_IS_IMMUTABLE_CREATE_A_NEW_SNAPSHOT_OR_REVIEW';
end
$$;

create trigger settlement_control_center_snapshots_immutable
before update or delete
on public.settlement_control_center_snapshots
for each row execute function private.reject_control_center_mutation();

create trigger settlement_control_center_risk_reviews_immutable
before update or delete
on public.settlement_control_center_risk_reviews
for each row execute function private.reject_control_center_mutation();

create or replace function
  public.record_settlement_control_risk_review_v1(
    p_control_snapshot_id uuid,
    p_risk_code text,
    p_human_judgment text,
    p_human_note text default null
  )
returns table(review_id uuid, review_version integer)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  snapshot_row public.settlement_control_center_snapshots%rowtype;
  next_version integer;
  previous_review_id uuid;
  inserted_review_id uuid;
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
  if p_human_judgment not in ('CONFIRMED', 'IGNORED') then
    raise exception 'INVALID_RISK_JUDGMENT';
  end if;
  if p_risk_code is null
    or char_length(btrim(p_risk_code)) = 0 then
    raise exception 'RISK_CODE_REQUIRED';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      p_control_snapshot_id::text || ':' || btrim(p_risk_code),
      0
    )
  );

  select *
  into snapshot_row
  from public.settlement_control_center_snapshots snapshot
  where snapshot.id = p_control_snapshot_id;
  if not found then
    raise exception 'CONTROL_CENTER_SNAPSHOT_NOT_FOUND';
  end if;
  if not exists (
    select 1
    from jsonb_array_elements(snapshot_row.risk_alerts) alert
    where alert->>'code' = btrim(p_risk_code)
  ) then
    raise exception 'RISK_NOT_PRESENT_IN_CONTROL_SNAPSHOT';
  end if;

  select
    coalesce(max(review.review_version), 0) + 1,
    (
      array_agg(
        review.id
        order by review.review_version desc
      )
    )[1]
  into next_version, previous_review_id
  from public.settlement_control_center_risk_reviews review
  where review.control_snapshot_id = p_control_snapshot_id
    and review.risk_code = btrim(p_risk_code);

  insert into public.settlement_control_center_risk_reviews(
    control_snapshot_id,
    risk_code,
    review_version,
    supersedes_review_id,
    human_judgment,
    human_note,
    reviewed_by,
    shadow_mode,
    automatic_action
  )
  values (
    p_control_snapshot_id,
    btrim(p_risk_code),
    next_version,
    previous_review_id,
    p_human_judgment,
    nullif(btrim(p_human_note), ''),
    (select auth.uid()),
    true,
    false
  )
  returning id into inserted_review_id;

  return query
  select inserted_review_id, next_version;
end
$$;

alter table public.settlement_control_center_snapshots
  enable row level security;
alter table public.settlement_control_center_risk_reviews
  enable row level security;

create policy settlement_control_center_snapshots_read
on public.settlement_control_center_snapshots
for select to authenticated
using (true);

create policy settlement_control_center_snapshots_insert
on public.settlement_control_center_snapshots
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

create policy settlement_control_center_risk_reviews_read
on public.settlement_control_center_risk_reviews
for select to authenticated
using (true);

create policy settlement_control_center_risk_reviews_insert
on public.settlement_control_center_risk_reviews
for insert to authenticated
with check (
  (select auth.uid()) = reviewed_by
  and (
    public.has_role('admin'::public.app_role)
    or public.has_role('settlement_operator'::public.app_role)
    or public.has_role('approver'::public.app_role)
  )
  and shadow_mode
  and not automatic_action
);

revoke all on
  public.settlement_control_center_snapshots,
  public.settlement_control_center_risk_reviews
from anon, authenticated;

grant select, insert on
  public.settlement_control_center_snapshots,
  public.settlement_control_center_risk_reviews
to authenticated;
grant select on
  public.settlement_control_center_merchant_baseline,
  public.settlement_control_center_latest_risk_reviews
to authenticated;
grant all on
  public.settlement_control_center_snapshots,
  public.settlement_control_center_risk_reviews
to service_role;
grant select on
  public.settlement_control_center_merchant_baseline,
  public.settlement_control_center_latest_risk_reviews
to service_role;

revoke all on function
  public.record_settlement_control_risk_review_v1(
    uuid,
    text,
    text,
    text
  )
from public, anon;
grant execute on function
  public.record_settlement_control_risk_review_v1(
    uuid,
    text,
    text,
    text
  )
to authenticated, service_role;

create trigger audit_settlement_control_center_snapshots
after insert or update or delete
on public.settlement_control_center_snapshots
for each row execute function public.audit_mutation();

create trigger audit_settlement_control_center_risk_reviews
after insert or update or delete
on public.settlement_control_center_risk_reviews
for each row execute function public.audit_mutation();

do $$
begin
  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'settlement_control_center_snapshots',
        'settlement_control_center_risk_reviews'
      )
      and cmd in ('UPDATE', 'DELETE', 'ALL')
  ) then
    raise exception
      'CONTROL_CENTER_TABLES_MUST_NOT_HAVE_MUTATION_POLICIES';
  end if;
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'settlement_control_center_snapshots_immutable'
      and not tgisinternal
  ) then
    raise exception 'CONTROL_CENTER_IMMUTABILITY_TRIGGER_MISSING';
  end if;
end
$$;

comment on table public.settlement_control_center_snapshots is
  'Immutable VND daily operating decision snapshots. Suggestions only; every automatic action is constrained false.';
comment on table public.settlement_control_center_risk_reviews is
  'Append-only human risk judgments and notes. Reviews never execute an operational action.';
comment on view public.settlement_control_center_merchant_baseline is
  'Latest immutable Shadow Pricing merchant baseline for control-center recommendations.';
comment on function public.record_settlement_control_risk_review_v1 is
  'Appends an audited human risk review. It performs no payment, topup, quote change, data collection, or trade.';
