-- VND Shadow Pricing & Liquidity OS — Task 1
-- All timestamps are timestamptz and interpreted/displayed as UTC.
create extension if not exists pgcrypto;

create type public.app_role as enum ('admin','settlement_operator','approver','viewer');
create type public.source_type as enum ('OPENING','PAYIN','TOPUP','ADJUSTMENT');
create type public.time_precision as enum ('DATE_ONLY','EXACT');
create type public.cost_basis_status as enum ('KNOWN','MISSING','ESTIMATED');

create table public.user_roles (
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  primary key (user_id, role)
);

create or replace function public.has_role(required_role public.app_role)
returns boolean language sql stable security definer set search_path = public
as $$ select exists(select 1 from public.user_roles where user_id = auth.uid() and role = required_role) $$;

create table public.system_rules (
  id uuid primary key default gen_random_uuid(),
  rule_key text not null,
  currency text,
  numeric_value numeric(38,12),
  text_value text,
  effective_from timestamptz not null default now(),
  effective_to timestamptz,
  status text not null default 'ACTIVE' check (status in ('DRAFT','ACTIVE','INACTIVE')),
  created_by uuid references auth.users(id),
  approved_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((numeric_value is null) <> (text_value is null)),
  check (effective_to is null or effective_to > effective_from)
);
create unique index system_rules_one_active_key on public.system_rules(rule_key) where status='ACTIVE' and effective_to is null;

create table public.import_batches (
  id uuid primary key default gen_random_uuid(),
  source_type text not null check(source_type in ('PAYIN','PAYOUT')),
  original_file_name text not null,
  file_hash text not null unique check(length(file_hash)=64),
  imported_at timestamptz not null default now(),
  total_rows integer not null default 0 check(total_rows>=0),
  valid_rows integer not null default 0 check(valid_rows>=0),
  invalid_rows integer not null default 0 check(invalid_rows>=0),
  duplicate_rows integer not null default 0 check(duplicate_rows>=0),
  status text not null default 'UPLOADED' check(status in ('UPLOADED','MAPPED','VALIDATED','PROCESSING','PARTIAL','COMPLETED','FAILED','DELETED')),
  error_summary jsonb,
  field_mapping jsonb not null default '{}'::jsonb,
  imported_by uuid references auth.users(id),
  deleted_at timestamptz,
  check(valid_rows+invalid_rows+duplicate_rows<=total_rows)
);

create table public.payin_orders (
  id uuid primary key default gen_random_uuid(),
  import_batch_id uuid not null references public.import_batches(id),
  merchant_code text,
  merchant_name text,
  order_number text not null,
  merchant_order_number text,
  channel_order_number text,
  provider_order_number text,
  channel_code text,
  channel_name text,
  currency text not null default 'VND' check(currency='VND'),
  payin_amount_vnd numeric(30,0) not null check(payin_amount_vnd>=0),
  refund_amount_vnd numeric(30,0) not null default 0 check(refund_amount_vnd>=0),
  target_amount_vnd numeric(30,0),
  imported_transaction_fee_vnd numeric(30,0),
  expected_fee_rate numeric(20,12) not null default 0.008,
  expected_fee_revenue_vnd numeric(30,0),
  fee_validation_difference_vnd numeric(30,0),
  fee_validation_status text check(fee_validation_status in ('MATCH','MISMATCH','MISSING')),
  upstream_success_fee_vnd numeric(30,0) not null default 2500,
  upstream_failure_fee_vnd numeric(30,0) not null default 0,
  upstream_fee_applied_vnd numeric(30,0),
  net_fee_contribution_vnd numeric(30,0),
  pool_inflow_vnd numeric(30,0),
  pool_inflow_status text not null default 'PENDING_CONFIRMATION' check(pool_inflow_status in ('CONFIRMED','PENDING_CONFIRMATION','NOT_APPLICABLE')),
  status text not null,
  failure_reason text,
  created_at timestamptz not null,
  completed_at timestamptz,
  event_time_confidence text not null default 'HIGH' check(event_time_confidence in ('HIGH','MEDIUM','LOW')),
  raw_row_hash text not null unique,
  raw_row_snapshot jsonb,
  created_at_system timestamptz not null default now(),
  check(pool_inflow_vnd is null or pool_inflow_vnd>=0),
  check(pool_inflow_status<>'CONFIRMED' or (status='SUCCESS' and pool_inflow_vnd is not null))
);
create index payin_orders_completed_idx on public.payin_orders(completed_at) where status='SUCCESS';
create index payin_orders_order_number_idx on public.payin_orders(order_number);

create table public.payout_orders (
  id uuid primary key default gen_random_uuid(),
  import_batch_id uuid not null references public.import_batches(id),
  order_number text not null,
  merchant text,
  channel text,
  currency text not null default 'VND' check(currency='VND'),
  received_usdt numeric(38,8),
  payout_amount_vnd numeric(30,0) not null check(payout_amount_vnd>0),
  ar_rate numeric(38,12) not null check(ar_rate>0),
  as_rate numeric(38,12) not null check(as_rate>0),
  ap_imported numeric(38,12) not null,
  ap_calculated numeric(38,12) generated always as (as_rate/ar_rate-1) stored,
  aq_imported numeric(38,12) not null,
  aq_is_included boolean not null default true check(aq_is_included=true),
  aq_composition_mode text not null default 'UNKNOWN' check(aq_composition_mode='UNKNOWN'),
  additive_residual numeric(38,12) generated always as (ap_imported-aq_imported) stored,
  multiplicative_residual numeric(38,12) generated always as ((1+ap_imported)/(1+aq_imported)-1) stored,
  diagnostic_only boolean not null default true check(diagnostic_only=true),
  ap_validation_difference numeric(38,12) generated always as (ap_imported-(as_rate/ar_rate-1)) stored,
  ap_validation_status text,
  at_gross_income numeric(38,12),
  status text not null,
  failure_reason text,
  created_at timestamptz not null,
  completed_at timestamptz,
  raw_row_hash text not null unique,
  raw_row_snapshot jsonb,
  created_at_system timestamptz not null default now()
);
create index payout_orders_completed_idx on public.payout_orders(completed_at) where status='SUCCESS';

create table public.topup_batches (
  id uuid primary key default gen_random_uuid(),
  execution_date date not null,
  executed_at timestamptz,
  time_precision public.time_precision not null,
  sequence_within_date integer not null check(sequence_within_date>0),
  channel text,
  usdt_spent numeric(38,8) not null check(usdt_spent>0),
  additional_fee_usdt numeric(38,8) not null default 0 check(additional_fee_usdt>=0),
  gross_vnd_received numeric(30,0) not null check(gross_vnd_received>0),
  additional_fee_vnd numeric(30,0) not null default 0 check(additional_fee_vnd>=0),
  net_vnd_received numeric(30,0) generated always as (gross_vnd_received-additional_fee_vnd) stored,
  stated_rate numeric(38,12),
  calculated_rate numeric(38,12) generated always as (gross_vnd_received/usdt_spent) stored,
  rate_validation_status text check(rate_validation_status in ('MATCH','MISMATCH','MISSING')),
  effective_rate_vnd_per_usdt numeric(38,12) generated always as ((gross_vnd_received-additional_fee_vnd)/(usdt_spent+additional_fee_usdt)) stored,
  remaining_vnd numeric(30,0) not null check(remaining_vnd>=0),
  notes text,
  source text not null default 'MANUAL',
  status text not null default 'PENDING' check(status in ('PENDING','APPROVED','REJECTED')),
  created_by uuid references auth.users(id),
  approved_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(execution_date,sequence_within_date),
  check((time_precision='DATE_ONLY' and executed_at is null) or (time_precision='EXACT' and executed_at is not null)),
  check(remaining_vnd<=gross_vnd_received-additional_fee_vnd),
  check(status<>'APPROVED' or approved_by is not null or source='VERIFIED_SEED')
);

create table public.pool_buckets (
  id uuid primary key default gen_random_uuid(),
  currency text not null default 'VND' check(currency='VND'),
  source_type public.source_type not null,
  source_reference_id uuid,
  original_amount_vnd numeric(30,0) not null check(original_amount_vnd>=0),
  available_amount_vnd numeric(30,0) not null check(available_amount_vnd>=0),
  funding_rate_vnd_per_usdt numeric(38,12),
  funding_cost_usdt numeric(38,8),
  cost_basis_status public.cost_basis_status not null,
  opened_at timestamptz not null,
  closed_at timestamptz,
  status text not null default 'OPEN' check(status in ('OPEN','DEPLETED','CLOSED')),
  created_by uuid references auth.users(id),
  approved_by uuid references auth.users(id),
  notes text,
  created_at timestamptz not null default now(),
  check(available_amount_vnd<=original_amount_vnd),
  check(not(source_type='PAYIN' and funding_cost_usdt=0 and cost_basis_status<>'KNOWN')),
  check((status='DEPLETED')=(available_amount_vnd=0))
);
create index pool_buckets_available_idx on public.pool_buckets(source_type,opened_at,id) where status='OPEN';

create table public.pool_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  event_time timestamptz,
  event_date date not null,
  time_precision public.time_precision not null,
  event_type text not null check(event_type in ('OPENING_BALANCE','PAYIN_INFLOW','TOPUP_INFLOW','PAYOUT_OUTFLOW','MANUAL_ADJUSTMENT','REVERSAL')),
  source_type public.source_type,
  source_reference_id uuid,
  amount_vnd numeric(30,0) not null check(amount_vnd>=0),
  signed_amount_vnd numeric(30,0) not null,
  balance_before_vnd numeric(30,0) not null check(balance_before_vnd>=0),
  balance_after_vnd numeric(30,0) not null check(balance_after_vnd>=0),
  data_confidence text not null default 'HIGH' check(data_confidence in ('HIGH','MEDIUM','LOW')),
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  check((time_precision='DATE_ONLY' and event_time is null) or (time_precision='EXACT' and event_time is not null)),
  check(balance_after_vnd=balance_before_vnd+signed_amount_vnd),
  check(abs(signed_amount_vnd)=amount_vnd)
);
create index pool_ledger_event_idx on public.pool_ledger_entries(event_date desc,event_time desc nulls last);

create table public.payout_pool_allocations (
  id uuid primary key default gen_random_uuid(),
  payout_order_id uuid not null references public.payout_orders(id),
  pool_bucket_id uuid not null references public.pool_buckets(id),
  source_type public.source_type not null,
  balance_before_vnd numeric(30,0) not null,
  allocation_ratio numeric(38,12) not null check(allocation_ratio>=0 and allocation_ratio<=1),
  allocated_vnd numeric(30,0) not null check(allocated_vnd>0),
  funding_rate_vnd_per_usdt numeric(38,12),
  allocated_cost_usdt numeric(38,8),
  cost_basis_status public.cost_basis_status not null,
  created_at timestamptz not null default now(),
  unique(payout_order_id,pool_bucket_id)
);

create table public.pool_alerts (
  id uuid primary key default gen_random_uuid(),
  alert_type text not null check(alert_type in ('LOW_POOL','INSUFFICIENT_BALANCE')),
  status text not null default 'OPEN' check(status in ('OPEN','ACKNOWLEDGED','RESOLVED')),
  vnd_balance_at_calculation numeric(30,0) not null,
  reference_rate_vnd_per_usdt numeric(38,12),
  rate_source text,
  rate_time timestamptz,
  data_confidence text not null check(data_confidence in ('HIGH','MEDIUM','LOW')),
  threshold_usdt numeric(38,8),
  related_reference_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  acknowledged_by uuid references auth.users(id),
  acknowledged_at timestamptz
);

create table public.import_row_errors (
  id uuid primary key default gen_random_uuid(),
  import_batch_id uuid not null references public.import_batches(id) on delete cascade,
  row_number integer not null,
  error_codes text[] not null,
  error_messages text[] not null,
  sanitized_row jsonb,
  created_at timestamptz not null default now()
);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id),
  action text not null,
  entity_type text not null,
  entity_id text,
  before_state jsonb,
  after_state jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_entity_idx on public.audit_logs(entity_type,entity_id,created_at desc);

create or replace function public.audit_mutation() returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,before_state,after_state)
  values(auth.uid(),tg_op,tg_table_name,coalesce((to_jsonb(new)->>'id'),(to_jsonb(old)->>'id')),case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end);
  return coalesce(new,old);
end $$;

create trigger audit_import_batches after insert or update or delete on public.import_batches for each row execute function public.audit_mutation();
create trigger audit_topup_batches after insert or update or delete on public.topup_batches for each row execute function public.audit_mutation();
create trigger audit_system_rules after insert or update or delete on public.system_rules for each row execute function public.audit_mutation();
create trigger audit_pool_buckets after insert or update or delete on public.pool_buckets for each row execute function public.audit_mutation();

-- Atomic proportional payout allocation. Buckets are locked in stable order.
create or replace function public.allocate_payout_from_pool(target_payout_id uuid)
returns setof public.payout_pool_allocations
language plpgsql security definer set search_path=public as $$
declare
  payout public.payout_orders%rowtype;
  bucket public.pool_buckets%rowtype;
  total_available numeric(30,0);
  payout_remaining numeric(30,0);
  allocated numeric(30,0);
  running_balance numeric(30,0);
  row_no integer := 0;
  bucket_count integer;
  saved public.payout_pool_allocations%rowtype;
begin
  if not(public.has_role('settlement_operator') or public.has_role('admin')) then raise exception 'INSUFFICIENT_ROLE'; end if;
  select * into payout from public.payout_orders where id=target_payout_id for update;
  if not found then raise exception 'PAYOUT_NOT_FOUND'; end if;
  if payout.status <> 'SUCCESS' or payout.completed_at is null then raise exception 'PAYOUT_NOT_FINAL_SUCCESS'; end if;
  if exists(select 1 from public.payout_pool_allocations where payout_order_id=target_payout_id) then raise exception 'PAYOUT_ALREADY_ALLOCATED'; end if;

  select coalesce(sum(available_amount_vnd),0),count(*) into total_available,bucket_count
  from public.pool_buckets where currency='VND' and status='OPEN' and available_amount_vnd>0;
  if total_available < payout.payout_amount_vnd then
    insert into public.pool_alerts(alert_type,vnd_balance_at_calculation,data_confidence,related_reference_id,details)
    values('INSUFFICIENT_BALANCE',total_available,'HIGH',target_payout_id,jsonb_build_object('requested_vnd',payout.payout_amount_vnd));
    return;
  end if;

  payout_remaining := payout.payout_amount_vnd;
  running_balance := total_available;
  for bucket in select * from public.pool_buckets where currency='VND' and status='OPEN' and available_amount_vnd>0 order by opened_at,id for update loop
    row_no := row_no+1;
    if row_no=bucket_count then allocated:=payout_remaining;
    else allocated:=floor(payout.payout_amount_vnd*bucket.available_amount_vnd/total_available); end if;
    if allocated>bucket.available_amount_vnd then raise exception 'ALLOCATION_WOULD_OVERDRAW_BUCKET %',bucket.id; end if;
    if allocated>0 then
      insert into public.payout_pool_allocations(payout_order_id,pool_bucket_id,source_type,balance_before_vnd,allocation_ratio,allocated_vnd,funding_rate_vnd_per_usdt,allocated_cost_usdt,cost_basis_status)
      values(target_payout_id,bucket.id,bucket.source_type,bucket.available_amount_vnd,bucket.available_amount_vnd/total_available,allocated,bucket.funding_rate_vnd_per_usdt,case when bucket.funding_rate_vnd_per_usdt>0 then round(allocated/bucket.funding_rate_vnd_per_usdt,8) end,bucket.cost_basis_status)
      returning * into saved;
      update public.pool_buckets set available_amount_vnd=available_amount_vnd-allocated,status=case when available_amount_vnd-allocated=0 then 'DEPLETED' else 'OPEN' end,closed_at=case when available_amount_vnd-allocated=0 then payout.completed_at end where id=bucket.id;
      insert into public.pool_ledger_entries(event_time,event_date,time_precision,event_type,source_type,source_reference_id,amount_vnd,signed_amount_vnd,balance_before_vnd,balance_after_vnd,notes)
      values(payout.completed_at,payout.completed_at::date,'EXACT','PAYOUT_OUTFLOW',bucket.source_type,target_payout_id,allocated,-allocated,running_balance,running_balance-allocated,'Proportional allocation; integer residual assigned to final active bucket');
      running_balance:=running_balance-allocated; payout_remaining:=payout_remaining-allocated;
      return next saved;
    end if;
  end loop;
  if payout_remaining<>0 then raise exception 'ALLOCATION_RESIDUAL %',payout_remaining; end if;
end $$;

alter table public.user_roles enable row level security;
alter table public.system_rules enable row level security;
alter table public.import_batches enable row level security;
alter table public.payin_orders enable row level security;
alter table public.payout_orders enable row level security;
alter table public.topup_batches enable row level security;
alter table public.pool_buckets enable row level security;
alter table public.pool_ledger_entries enable row level security;
alter table public.payout_pool_allocations enable row level security;
alter table public.pool_alerts enable row level security;
alter table public.import_row_errors enable row level security;
alter table public.audit_logs enable row level security;

-- All authenticated roles can read. Mutations are intentionally narrow.
do $$ declare t text; begin
  foreach t in array array['system_rules','import_batches','payin_orders','payout_orders','topup_batches','pool_buckets','pool_ledger_entries','payout_pool_allocations','pool_alerts','import_row_errors','audit_logs'] loop
    execute format('create policy read_authenticated on public.%I for select to authenticated using (true)',t);
  end loop;
end $$;
create policy roles_self_read on public.user_roles for select to authenticated using(user_id=auth.uid() or public.has_role('admin'));
create policy roles_admin_write on public.user_roles for all to authenticated using(public.has_role('admin')) with check(public.has_role('admin'));
create policy operator_imports on public.import_batches for insert to authenticated with check(public.has_role('settlement_operator') or public.has_role('admin'));
create policy operator_import_updates on public.import_batches for update to authenticated using(public.has_role('settlement_operator') or public.has_role('admin')) with check(public.has_role('settlement_operator') or public.has_role('admin'));
create policy admin_import_delete on public.import_batches for delete to authenticated using(public.has_role('admin'));
create policy operator_payin on public.payin_orders for insert to authenticated with check(public.has_role('settlement_operator') or public.has_role('admin'));
create policy operator_payout on public.payout_orders for insert to authenticated with check(public.has_role('settlement_operator') or public.has_role('admin'));
create policy operator_topup_insert on public.topup_batches for insert to authenticated with check(public.has_role('settlement_operator') or public.has_role('admin'));
create policy approver_topup_update on public.topup_batches for update to authenticated using(public.has_role('approver') or public.has_role('admin')) with check(public.has_role('approver') or public.has_role('admin'));
create policy approver_pool on public.pool_buckets for all to authenticated using(public.has_role('approver') or public.has_role('admin')) with check(public.has_role('approver') or public.has_role('admin'));
create policy admin_rules on public.system_rules for all to authenticated using(public.has_role('admin')) with check(public.has_role('admin'));

comment on column public.payout_orders.additive_residual is 'diagnostic_only; must never be used for pricing or formal profit';
comment on column public.payout_orders.multiplicative_residual is 'diagnostic_only; AQ composition relationship remains UNKNOWN';
comment on column public.payin_orders.pool_inflow_vnd is 'Actual/target VND received; never derive by deducting fee and upstream cost without evidence';
comment on function public.allocate_payout_from_pool(uuid) is 'Shadow Mode ledger allocation only; does not execute external payment or move real funds';
revoke all on function public.allocate_payout_from_pool(uuid) from public,anon;
grant execute on function public.allocate_payout_from_pool(uuid) to authenticated;
