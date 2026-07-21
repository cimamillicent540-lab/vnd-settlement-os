-- VND Shadow Pricing & Liquidity OS — Task 1.5
-- Additive real-data schema. No truncate, delete, reset or external fund action.

alter table public.import_batches drop constraint if exists import_batches_source_type_check;
alter table public.import_batches add constraint import_batches_source_type_check
  check (source_type in ('PAYIN','PAYOUT','ACCOUNT_HISTORY'));

alter table public.payin_orders
  alter column payin_amount_vnd type numeric(30,2), alter column refund_amount_vnd type numeric(30,2),
  alter column target_amount_vnd type numeric(30,2), alter column imported_transaction_fee_vnd type numeric(30,2),
  alter column expected_fee_revenue_vnd type numeric(30,2), alter column fee_validation_difference_vnd type numeric(30,2),
  alter column upstream_success_fee_vnd type numeric(30,2), alter column upstream_failure_fee_vnd type numeric(30,2),
  alter column upstream_fee_applied_vnd type numeric(30,2), alter column net_fee_contribution_vnd type numeric(30,2),
  alter column pool_inflow_vnd type numeric(30,2);
alter table public.payin_orders drop constraint if exists payin_orders_currency_check;
alter table public.payin_orders
  add column funding_method text not null default 'INTERNAL_NETTING' check (funding_method='INTERNAL_NETTING'),
  add column external_usdt_spent numeric(38,8) not null default 0 check (external_usdt_spent=0),
  add column cost_basis_method text not null default 'INTERNAL_NETTING' check (cost_basis_method='INTERNAL_NETTING'),
  add column cost_basis_status public.cost_basis_status not null default 'NOT_APPLICABLE' check (cost_basis_status='NOT_APPLICABLE'),
  add column company_payin_fee_revenue_vnd numeric(30,2),
  add column upstream_payin_fee_vnd numeric(30,2),
  add column payin_net_fee_contribution_vnd numeric(30,2);

comment on column public.payin_orders.pool_inflow_vnd is
  'For VND account history use actual balance change. Never deduct the separate 2500 VND upstream fee again.';
comment on column public.payin_orders.external_usdt_spent is
  'No per-order USDT cost for Payin internal netting; periodic USDT settlement belongs in net_settlements.';

alter table public.payout_orders
  alter column payout_amount_vnd type numeric(30,2),
  alter column ar_rate drop not null, alter column as_rate drop not null,
  alter column ap_imported drop not null, alter column aq_imported drop not null;
alter table public.payout_orders
  add column payout_fee_vnd numeric(30,2), add column pool_outflow_vnd numeric(30,2),
  add column merchant_code text, add column merchant_order_number text,
  add column channel_code text, add column channel_order_number text,
  add column total_fee_usdt numeric(38,8),
  add column crypto_dcc_percentage numeric(38,12), add column crypto_dcc_random_percentage numeric(38,12),
  add column crypto_dcc_rate_before numeric(38,18), add column crypto_dcc_rate_after numeric(38,18),
  add column crypto_dcc_income_usdt numeric(38,12),
  add column fiat_dcc_percentage numeric(38,12), add column fiat_dcc_random_percentage numeric(38,12),
  add column fiat_dcc_rate_before numeric(38,18), add column fiat_dcc_rate_after numeric(38,18),
  add column fiat_dcc_income_usdt numeric(38,12);

alter table public.topup_batches
  drop column net_vnd_received, drop column calculated_rate, drop column effective_rate_vnd_per_usdt;
alter table public.topup_batches
  alter column gross_vnd_received type numeric(30,2),
  alter column additional_fee_vnd type numeric(30,2),
  alter column remaining_vnd type numeric(30,2);
alter table public.topup_batches
  add column net_vnd_received numeric(30,2) generated always as (gross_vnd_received-additional_fee_vnd) stored,
  add column calculated_rate numeric(38,12) generated always as (gross_vnd_received/usdt_spent) stored,
  add column effective_rate_vnd_per_usdt numeric(38,12) generated always as ((gross_vnd_received-additional_fee_vnd)/(usdt_spent+additional_fee_usdt)) stored;

alter table public.pool_buckets drop constraint if exists pool_buckets_check1;
alter table public.pool_buckets
  alter column original_amount_vnd type numeric(30,2), alter column available_amount_vnd type numeric(30,2);
alter table public.pool_buckets add constraint pool_buckets_internal_netting_cost_check check (
  source_type <> 'PAYIN_INTERNAL_NETTING'
  or (funding_cost_usdt=0 and funding_rate_vnd_per_usdt is null and cost_basis_status='NOT_APPLICABLE')
);

alter table public.pool_ledger_entries
  alter column amount_vnd type numeric(30,2), alter column signed_amount_vnd type numeric(30,2),
  alter column balance_before_vnd type numeric(30,2), alter column balance_after_vnd type numeric(30,2);
alter table public.pool_ledger_entries drop constraint if exists pool_ledger_entries_event_type_check;
alter table public.pool_ledger_entries add constraint pool_ledger_entries_event_type_check check (
  event_type in ('OPENING_BALANCE','PAYIN_INFLOW','TOPUP_INFLOW','PAYOUT_OUTFLOW',
    'INTERNAL_TRANSFER_DEBIT','INTERNAL_TRANSFER_CREDIT','MANUAL_ADJUSTMENT','REVERSAL')
);
alter table public.pool_ledger_entries
  add column source_event_key text unique,
  add column is_net_zero_transfer boolean not null default false;

alter table public.payout_pool_allocations
  alter column balance_before_vnd type numeric(30,2), alter column allocated_vnd type numeric(30,2);
alter table public.pool_alerts alter column vnd_balance_at_calculation type numeric(30,2);

create table public.opening_balances (
  id uuid primary key default gen_random_uuid(), currency text not null check (currency='VND'),
  opening_balance_vnd numeric(30,2) not null check (opening_balance_vnd>=0), effective_at timestamptz not null,
  source_timezone text not null, source_local_time timestamp not null,
  source_single_account_balance_vnd numeric(30,2) not null,
  multiplier numeric(20,8) not null check (multiplier>0),
  approval_status text not null check (approval_status in ('PENDING','APPROVED','REJECTED')),
  approved_by uuid references auth.users(id), notes text, created_at timestamptz not null default now(),
  unique(currency,effective_at),
  check (opening_balance_vnd=round(source_single_account_balance_vnd*multiplier,2))
);

create table public.account_history_entries (
  id uuid primary key default gen_random_uuid(),
  import_batch_id uuid not null references public.import_batches(id),
  source_row_number integer not null check (source_row_number>=2),
  merchant_code text, merchant_name text, business_order_number text,
  currency text not null, balance_type text, transaction_type text not null,
  event_type text not null check (event_type in ('PAYIN_INFLOW','PAYOUT_OUTFLOW','INTERNAL_TRANSFER_DEBIT','INTERNAL_TRANSFER_CREDIT','MANUAL_ADJUSTMENT')),
  change_amount_vnd numeric(30,2) not null check (change_amount_vnd>=0),
  gross_order_amount_vnd numeric(30,2), fee_vnd numeric(30,2), direction text not null,
  signed_amount_vnd numeric(30,2) not null,
  payout_principal_vnd numeric(30,2), payout_fee_vnd numeric(30,2),
  pool_inflow_vnd numeric(30,2), pool_outflow_vnd numeric(30,2),
  balance_before_vnd numeric(30,2) not null, balance_after_vnd numeric(30,2) not null,
  transaction_time timestamptz not null, source_local_time timestamp not null,
  source_timezone text not null default 'UTC+8', product_code text, reason text,
  balance_validation_difference_vnd numeric(30,2) not null,
  balance_validation_status text not null check (balance_validation_status in ('MATCH','MISMATCH')),
  continuity_status text check (continuity_status in ('MATCH','MISMATCH','FIRST')),
  transfer_pair_key text, transfer_pair_status text check (transfer_pair_status in ('PAIRED','UNMATCHED','NOT_APPLICABLE')),
  raw_row_hash text not null unique, raw_row_snapshot jsonb not null,
  created_at timestamptz not null default now(), unique(import_batch_id,source_row_number),
  check (signed_amount_vnd = case when direction='增加' then change_amount_vnd else -change_amount_vnd end),
  check (pool_inflow_vnd is null or event_type='PAYIN_INFLOW'),
  check (pool_outflow_vnd is null or event_type='PAYOUT_OUTFLOW')
);
create index account_history_chronological_idx on public.account_history_entries(transaction_time,source_row_number desc);
create index account_history_order_idx on public.account_history_entries(business_order_number,change_amount_vnd,transaction_time);

create table public.reconciliation_runs (
  id uuid primary key default gen_random_uuid(), started_at timestamptz not null default now(), completed_at timestamptz,
  opening_balance_vnd numeric(30,2) not null, total_inflow_vnd numeric(30,2) not null default 0,
  total_outflow_vnd numeric(30,2) not null default 0, reconstructed_balance_vnd numeric(30,2) not null,
  source_closing_balance_vnd numeric(30,2), difference_vnd numeric(30,2),
  status text not null check (status in ('RUNNING','BALANCED','DIFFERENCE','INCOMPLETE')),
  details jsonb not null default '{}'::jsonb
);

create table public.data_quality_issues (
  id uuid primary key default gen_random_uuid(), issue_type text not null,
  severity text not null check (severity in ('INFO','WARNING','ERROR')),
  source_reference text, details jsonb not null default '{}'::jsonb,
  status text not null default 'OPEN' check (status in ('OPEN','RESOLVED')), created_at timestamptz not null default now()
);

create table public.net_settlements (
  id uuid primary key default gen_random_uuid(), settlement_period_start timestamptz not null,
  settlement_period_end timestamptz not null, external_usdt_spent numeric(38,8), settled_vnd numeric(30,2),
  status text not null default 'PENDING' check (status in ('PENDING','APPROVED','REJECTED')),
  notes text, created_at timestamptz not null default now(),
  check (settlement_period_end>settlement_period_start)
);

insert into public.opening_balances(currency,opening_balance_vnd,effective_at,source_timezone,source_local_time,
  source_single_account_balance_vnd,multiplier,approval_status,notes)
values ('VND',6796457582.28,'2026-07-17T00:00:00Z','UTC+8','2026-07-17 08:00:00',
  3398228791.14,2,'APPROVED','Pre-08:00 balance; excludes the 992000 VND Payin inflow to prevent double counting.')
on conflict (currency,effective_at) do nothing;

alter table public.opening_balances enable row level security;
alter table public.account_history_entries enable row level security;
alter table public.reconciliation_runs enable row level security;
alter table public.data_quality_issues enable row level security;
alter table public.net_settlements enable row level security;
create policy read_authenticated on public.opening_balances for select to authenticated using (true);
create policy read_authenticated on public.account_history_entries for select to authenticated using (true);
create policy read_authenticated on public.reconciliation_runs for select to authenticated using (true);
create policy read_authenticated on public.data_quality_issues for select to authenticated using (true);
create policy read_authenticated on public.net_settlements for select to authenticated using (true);

grant usage on schema public to anon,authenticated,service_role;
grant select on all tables in schema public to authenticated;
grant select,insert,update on public.import_batches,public.payin_orders,public.payout_orders,
  public.account_history_entries,public.import_row_errors,public.topup_batches to authenticated;
grant all on all tables in schema public to service_role;
grant usage,select on all sequences in schema public to service_role;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant usage,select on sequences to service_role;

revoke all on function public.has_role(public.app_role) from public,anon;
grant execute on function public.has_role(public.app_role) to authenticated,service_role;
revoke all on function public.audit_mutation() from public,anon,authenticated;
revoke all on function public.allocate_payout_from_pool(uuid) from public,anon;
grant execute on function public.allocate_payout_from_pool(uuid) to authenticated,service_role;

create trigger audit_opening_balances after insert or update or delete on public.opening_balances
  for each row execute function public.audit_mutation();
create trigger audit_reconciliation_runs after insert or update or delete on public.reconciliation_runs
  for each row execute function public.audit_mutation();
create trigger audit_net_settlements after insert or update or delete on public.net_settlements
  for each row execute function public.audit_mutation();

comment on table public.net_settlements is
  'Periodic company/downstream USDT net settlement; never force-allocated to individual Payin orders.';
comment on table public.account_history_entries is
  'Source timezone UTC+8. Canonical rebuild order: transaction_time ASC, source_row_number DESC.';
