-- Task 2.7 — VND Settlement Intelligence Dashboard V1.
-- Decision-support only. No payment, topup, quote update, or trading execution.

create table public.fx_market_inputs (
  id uuid primary key default gen_random_uuid(),
  currency text not null check (currency = 'VND'),
  rate_type text not null
    check (rate_type in ('P2P_COST_RATE', 'XE_BASE_RATE')),
  rate_value numeric(38,12) not null check (rate_value > 0),
  source text not null check (char_length(btrim(source)) > 0),
  record_time timestamptz not null,
  operator uuid references auth.users(id),
  notes text,
  shadow_mode boolean not null default true check (shadow_mode),
  automatic_application boolean not null default false
    check (automatic_application = false),
  created_at timestamptz not null default now(),
  unique (currency, rate_type, source, record_time)
);
create index fx_market_inputs_latest_idx
  on public.fx_market_inputs(currency, rate_type, record_time desc, id desc);
create index fx_market_inputs_operator_idx
  on public.fx_market_inputs(operator)
  where operator is not null;

create table public.quote_adjustment_rules (
  id uuid primary key default gen_random_uuid(),
  currency text not null check (currency = 'VND'),
  base_source text not null check (base_source = 'XE'),
  adjustment numeric(38,12) not null,
  reason text not null
    check (
      reason in (
        'market_competition',
        'risk_adjustment',
        'profit_target'
      )
    ),
  effective_time timestamptz not null,
  operator uuid references auth.users(id),
  notes text,
  status text not null default 'ACTIVE'
    check (status in ('ACTIVE', 'SUPERSEDED')),
  shadow_mode boolean not null default true check (shadow_mode),
  automatic_application boolean not null default false
    check (automatic_application = false),
  created_at timestamptz not null default now()
);
create index quote_adjustment_rules_latest_idx
  on public.quote_adjustment_rules(
    currency,
    base_source,
    status,
    effective_time desc,
    id desc
  );
create index quote_adjustment_rules_operator_idx
  on public.quote_adjustment_rules(operator)
  where operator is not null;

create table public.vnd_inventory_batches (
  id uuid primary key default gen_random_uuid(),
  topup_batch_id uuid unique references public.topup_batches(id),
  batch_time timestamptz,
  batch_date date not null,
  time_precision public.time_precision not null,
  usdt_amount numeric(38,8) not null check (usdt_amount > 0),
  vnd_amount numeric(38,2) not null check (vnd_amount > 0),
  cost_rate numeric(38,12) not null check (cost_rate > 0),
  source text not null check (char_length(btrim(source)) > 0),
  remaining_amount numeric(38,2) not null check (remaining_amount >= 0),
  cost_source_type text not null default 'ACTUAL_TOPUP'
    check (cost_source_type = 'ACTUAL_TOPUP'),
  historical_cost_locked boolean not null default true
    check (historical_cost_locked),
  status text not null default 'OPEN'
    check (status in ('OPEN', 'DEPLETED', 'CLOSED')),
  model_version text not null default 'FIFO_ACTUAL_TOPUP_V1',
  shadow_mode boolean not null default true check (shadow_mode),
  automatic_topup boolean not null default false
    check (automatic_topup = false),
  created_at timestamptz not null default now(),
  check (remaining_amount <= vnd_amount),
  check (
    (time_precision = 'DATE_ONLY' and batch_time is null)
    or (time_precision = 'EXACT' and batch_time is not null)
  ),
  check (
    abs(cost_rate - (vnd_amount / usdt_amount)) <= 0.000001
  ),
  check ((status = 'DEPLETED') = (remaining_amount = 0))
);
create index vnd_inventory_batches_fifo_idx
  on public.vnd_inventory_batches(
    status,
    batch_date,
    batch_time asc nulls first,
    id
  )
  where remaining_amount > 0;

create table public.vnd_inventory_fifo_allocations (
  id uuid primary key default gen_random_uuid(),
  payout_order_id uuid not null references public.payout_orders(id),
  inventory_batch_id uuid not null references public.vnd_inventory_batches(id),
  allocation_sequence integer not null check (allocation_sequence > 0),
  vnd_consumed numeric(38,2) not null check (vnd_consumed > 0),
  cost_basis_usdt numeric(38,8) not null check (cost_basis_usdt > 0),
  cost_rate numeric(38,12) not null check (cost_rate > 0),
  inventory_batch_source text not null,
  model_version text not null default 'FIFO_ACTUAL_TOPUP_V1',
  shadow_mode boolean not null default true check (shadow_mode),
  automatic_execution boolean not null default false
    check (automatic_execution = false),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (payout_order_id, allocation_sequence),
  unique (payout_order_id, inventory_batch_id)
);
create index vnd_inventory_fifo_allocations_batch_idx
  on public.vnd_inventory_fifo_allocations(inventory_batch_id);
create index vnd_inventory_fifo_allocations_created_by_idx
  on public.vnd_inventory_fifo_allocations(created_by)
  where created_by is not null;

create table public.settlement_intelligence_snapshots (
  id uuid primary key default gen_random_uuid(),
  snapshot_date date not null,
  as_of timestamptz not null,
  gross_balance_vnd numeric(38,2) not null check (gross_balance_vnd >= 0),
  settleable_balance_vnd numeric(38,2) not null
    check (settleable_balance_vnd >= 0),
  forecast_payout_vnd numeric(38,2) not null
    check (forecast_payout_vnd >= 0),
  forecast_payin_vnd numeric(38,2) not null
    check (forecast_payin_vnd >= 0),
  projected_shortfall_vnd numeric(38,2) not null
    check (projected_shortfall_vnd >= 0),
  recommended_topup_usdt numeric(38,8),
  recommendation_status text not null
    check (
      recommendation_status in (
        'NO_TOPUP',
        'TOPUP_RECOMMENDED',
        'INSUFFICIENT_MARKET_DATA'
      )
    ),
  xe_rate numeric(38,12),
  p2p_cost_rate numeric(38,12),
  recommended_quote_rate numeric(38,12),
  target_margin numeric(18,12) not null
    check (target_margin >= 0.002),
  expected_profit_usdt numeric(38,12),
  expected_profit_margin numeric(18,12),
  risk_alerts jsonb not null default '[]'::jsonb,
  data_cutoff_snapshot jsonb not null default '{}'::jsonb,
  rules_version text not null default 'SETTLEMENT_INTELLIGENCE_V1',
  shadow_mode boolean not null default true check (shadow_mode),
  automatic_payment boolean not null default false
    check (automatic_payment = false),
  automatic_topup boolean not null default false
    check (automatic_topup = false),
  automatic_quote_change boolean not null default false
    check (automatic_quote_change = false),
  automatic_trading boolean not null default false
    check (automatic_trading = false),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index settlement_intelligence_snapshots_latest_idx
  on public.settlement_intelligence_snapshots(
    snapshot_date desc,
    as_of desc,
    id desc
  );
create index settlement_intelligence_snapshots_created_by_idx
  on public.settlement_intelligence_snapshots(created_by)
  where created_by is not null;

create or replace view public.vnd_inventory_positions
with (security_invoker = true)
as
select
  batch.id,
  batch.topup_batch_id,
  batch.batch_time,
  batch.batch_date,
  batch.time_precision,
  batch.usdt_amount,
  batch.vnd_amount,
  batch.cost_rate,
  batch.source,
  batch.remaining_amount,
  case
    when batch.vnd_amount = 0 then 0
    else batch.remaining_amount / batch.vnd_amount
  end as remaining_ratio,
  batch.cost_source_type,
  batch.historical_cost_locked,
  batch.status,
  batch.model_version,
  batch.shadow_mode
from public.vnd_inventory_batches batch;

create or replace view public.hourly_liquidity_forecast
with (security_invoker = true)
as
with event_dates as (
  select distinct
    (payin.completed_at at time zone 'Asia/Shanghai')::date as local_date
  from public.payin_orders payin
  where payin.completed_at is not null
  union
  select distinct
    (payout.completed_at at time zone 'Asia/Shanghai')::date as local_date
  from public.payout_orders payout
  where payout.completed_at is not null
),
hours as (
  select generate_series(0, 23)::integer as local_hour
),
payin_daily as (
  select
    (payin.completed_at at time zone 'Asia/Shanghai')::date as local_date,
    extract(
      hour from payin.completed_at at time zone 'Asia/Shanghai'
    )::integer as local_hour,
    sum(payin.pool_inflow_vnd) as payin_vnd
  from public.payin_orders payin
  where payin.status = 'SUCCESS'
    and payin.completed_at is not null
  group by 1, 2
),
payout_daily as (
  select
    (payout.completed_at at time zone 'Asia/Shanghai')::date as local_date,
    extract(
      hour from payout.completed_at at time zone 'Asia/Shanghai'
    )::integer as local_hour,
    sum(
      coalesce(
        payout.pool_outflow_vnd,
        payout.payout_amount_vnd + coalesce(payout.payout_fee_vnd, 0)
      )
    ) as payout_vnd
  from public.payout_orders payout
  where payout.status = 'SUCCESS'
    and payout.completed_at is not null
  group by 1, 2
),
hourly as (
  select
    hour_row.local_hour,
    count(date_row.local_date)::bigint as observed_days,
    avg(coalesce(payin.payin_vnd, 0))::numeric(38,2)
      as forecast_payin_vnd,
    avg(coalesce(payout.payout_vnd, 0))::numeric(38,2)
      as forecast_payout_vnd
  from event_dates date_row
  cross join hours hour_row
  left join payin_daily payin
    on payin.local_date = date_row.local_date
    and payin.local_hour = hour_row.local_hour
  left join payout_daily payout
    on payout.local_date = date_row.local_date
    and payout.local_hour = hour_row.local_hour
  group by hour_row.local_hour
)
select
  hourly.local_hour,
  hourly.observed_days,
  hourly.forecast_payin_vnd,
  hourly.forecast_payout_vnd,
  (
    hourly.forecast_payout_vnd - hourly.forecast_payin_vnd
  )::numeric(38,2) as forecast_net_demand_vnd,
  hourly.local_hour between 16 and 23 as is_peak_window,
  case
    when sum(hourly.forecast_payout_vnd) over () = 0 then 0
    else
      hourly.forecast_payout_vnd
      / sum(hourly.forecast_payout_vnd) over ()
  end::numeric(18,12) as payout_concentration_ratio
from hourly
order by hourly.local_hour;

create or replace view public.settlement_revenue_rate_benchmarks
with (security_invoker = true)
as
select
  count(*)::bigint as payout_count,
  coalesce(sum(payout.merchant_principal_usdt), 0)::numeric(38,8)
    as merchant_principal_usdt,
  coalesce(sum(payout.merchant_fee_usdt), 0)::numeric(38,8)
    as merchant_fee_revenue_usdt,
  coalesce(sum(payout.dcc_revenue_usdt), 0)::numeric(38,12)
    as dcc_revenue_usdt,
  coalesce(sum(payout.total_company_revenue_usdt), 0)::numeric(38,12)
    as total_company_revenue_usdt,
  case
    when coalesce(sum(payout.merchant_principal_usdt), 0) = 0 then 0
    else
      sum(payout.merchant_fee_usdt)
      / sum(payout.merchant_principal_usdt)
  end::numeric(18,12) as merchant_fee_rate,
  case
    when coalesce(sum(payout.merchant_principal_usdt), 0) = 0 then 0
    else
      sum(payout.dcc_revenue_usdt)
      / sum(payout.merchant_principal_usdt)
  end::numeric(18,12) as dcc_revenue_rate
from public.payout_orders payout
where payout.status = 'SUCCESS';

insert into public.vnd_inventory_batches(
  topup_batch_id,
  batch_time,
  batch_date,
  time_precision,
  usdt_amount,
  vnd_amount,
  cost_rate,
  source,
  remaining_amount,
  status
)
select
  topup.id,
  topup.executed_at,
  topup.execution_date,
  topup.time_precision,
  topup.usdt_spent + topup.additional_fee_usdt,
  topup.net_vnd_received,
  topup.effective_rate_vnd_per_usdt,
  'TOPUP_BATCH:' || topup.id::text,
  topup.remaining_vnd,
  case when topup.remaining_vnd = 0 then 'DEPLETED' else 'OPEN' end
from public.topup_batches topup
where topup.status = 'APPROVED'
on conflict (topup_batch_id) do nothing;

alter table public.fx_market_inputs enable row level security;
alter table public.quote_adjustment_rules enable row level security;
alter table public.vnd_inventory_batches enable row level security;
alter table public.vnd_inventory_fifo_allocations enable row level security;
alter table public.settlement_intelligence_snapshots enable row level security;

create policy fx_market_inputs_read
on public.fx_market_inputs
for select to authenticated
using (true);
create policy fx_market_inputs_insert
on public.fx_market_inputs
for insert to authenticated
with check (
  (select auth.uid()) = operator
  and (
    public.has_role('admin')
    or public.has_role('settlement_operator')
  )
  and shadow_mode
  and not automatic_application
);

create policy quote_adjustment_rules_read
on public.quote_adjustment_rules
for select to authenticated
using (true);
create policy quote_adjustment_rules_insert
on public.quote_adjustment_rules
for insert to authenticated
with check (
  (select auth.uid()) = operator
  and (
    public.has_role('admin')
    or public.has_role('settlement_operator')
  )
  and shadow_mode
  and not automatic_application
);

create policy vnd_inventory_batches_read
on public.vnd_inventory_batches
for select to authenticated
using (true);
create policy vnd_inventory_fifo_allocations_read
on public.vnd_inventory_fifo_allocations
for select to authenticated
using (true);

create policy settlement_intelligence_snapshots_read
on public.settlement_intelligence_snapshots
for select to authenticated
using (true);
create policy settlement_intelligence_snapshots_insert
on public.settlement_intelligence_snapshots
for insert to authenticated
with check (
  (select auth.uid()) = created_by
  and (
    public.has_role('admin')
    or public.has_role('settlement_operator')
  )
  and shadow_mode
  and not automatic_payment
  and not automatic_topup
  and not automatic_quote_change
  and not automatic_trading
);

revoke all on public.fx_market_inputs,
  public.quote_adjustment_rules,
  public.vnd_inventory_batches,
  public.vnd_inventory_fifo_allocations,
  public.settlement_intelligence_snapshots
from anon;
grant select, insert on public.fx_market_inputs,
  public.quote_adjustment_rules,
  public.settlement_intelligence_snapshots
to authenticated;
grant select on public.vnd_inventory_batches,
  public.vnd_inventory_fifo_allocations,
  public.vnd_inventory_positions,
  public.hourly_liquidity_forecast,
  public.settlement_revenue_rate_benchmarks
to authenticated;
grant all on public.fx_market_inputs,
  public.quote_adjustment_rules,
  public.vnd_inventory_batches,
  public.vnd_inventory_fifo_allocations,
  public.settlement_intelligence_snapshots
to service_role;

create trigger audit_fx_market_inputs
after insert or update or delete on public.fx_market_inputs
for each row execute function public.audit_mutation();
create trigger audit_quote_adjustment_rules
after insert or update or delete on public.quote_adjustment_rules
for each row execute function public.audit_mutation();
create trigger audit_vnd_inventory_batches
after insert or update or delete on public.vnd_inventory_batches
for each row execute function public.audit_mutation();
create trigger audit_vnd_inventory_fifo_allocations
after insert or update or delete on public.vnd_inventory_fifo_allocations
for each row execute function public.audit_mutation();
create trigger audit_settlement_intelligence_snapshots
after insert or update or delete on public.settlement_intelligence_snapshots
for each row execute function public.audit_mutation();

comment on table public.fx_market_inputs is
  'Manual market observations only. P2P rates never overwrite historical inventory costs.';
comment on table public.quote_adjustment_rules is
  'Versioned Shadow Mode adjustments to XE; rows do not update customer quotes.';
comment on table public.vnd_inventory_batches is
  'Immutable actual-topup cost lots used by the FIFO decision-support model.';
comment on table public.vnd_inventory_fifo_allocations is
  'Auditable FIFO cost allocations only; no external payout or balance movement.';
comment on table public.settlement_intelligence_snapshots is
  'Daily Shadow Mode recommendations; all automatic action flags are constrained false.';
