-- VND Shadow Pricing & Liquidity OS — Task 2.5
-- Additive validation model. Raw Account History amounts remain immutable.
-- No payment, topup, channel switch, quote update, truncate, reset or delete.

alter table public.import_batches
  add column if not exists excluded_rows integer not null default 0
    check (excluded_rows >= 0),
  add column if not exists source_timezone text,
  add column if not exists source_period_start timestamptz,
  add column if not exists source_period_end timestamptz;

alter table public.account_history_entries
  drop constraint if exists account_history_entries_event_type_check;
alter table public.account_history_entries
  add constraint account_history_entries_event_type_check check (
    event_type in (
      'PAYIN_INFLOW',
      'PAYOUT_OUTFLOW',
      'REFUND_CREDIT',
      'INTERNAL_TRANSFER_DEBIT',
      'INTERNAL_TRANSFER_CREDIT',
      'MANUAL_ADJUSTMENT'
    )
  );
alter table public.account_history_entries
  add column if not exists source_file_hash text
    check (source_file_hash is null or length(source_file_hash) = 64),
  add column if not exists dedupe_key text,
  add column if not exists refund_original_business_order_number text,
  add column if not exists refund_credit_vnd numeric(30,2),
  add column if not exists refund_match_status text check (
    refund_match_status is null or refund_match_status in (
      'MATCHED',
      'AMOUNT_MISMATCH',
      'ORIGINAL_NOT_FOUND',
      'NOT_APPLICABLE'
    )
  );
create unique index if not exists account_history_dedupe_key_idx
  on public.account_history_entries(dedupe_key)
  where dedupe_key is not null;
create index if not exists account_history_refund_original_idx
  on public.account_history_entries(refund_original_business_order_number)
  where refund_original_business_order_number is not null;

create table public.payout_order_identifiers (
  id uuid primary key default gen_random_uuid(),
  payout_order_id uuid not null unique references public.payout_orders(id),
  source_file_hash text not null check (length(source_file_hash) = 64),
  order_number text not null,
  channel_order_number text,
  cp_order_number text,
  cp_payment_order_number text,
  merchant_order_number text,
  payment_order_number text,
  provider_order_number text,
  raw_identifier_snapshot jsonb not null,
  created_at timestamptz not null default now()
);
create index payout_identifiers_channel_idx
  on public.payout_order_identifiers(channel_order_number)
  where channel_order_number is not null;
create index payout_identifiers_cp_order_idx
  on public.payout_order_identifiers(cp_order_number)
  where cp_order_number is not null;
create index payout_identifiers_cp_payment_idx
  on public.payout_order_identifiers(cp_payment_order_number)
  where cp_payment_order_number is not null;
create index payout_identifiers_merchant_order_idx
  on public.payout_order_identifiers(merchant_order_number)
  where merchant_order_number is not null;
create index payout_identifiers_payment_order_idx
  on public.payout_order_identifiers(payment_order_number)
  where payment_order_number is not null;
create index payout_identifiers_provider_idx
  on public.payout_order_identifiers(provider_order_number)
  where provider_order_number is not null;

create table public.account_history_payout_executions (
  id uuid primary key default gen_random_uuid(),
  source_file_hash text not null check (length(source_file_hash) = 64),
  original_account_history_entry_id uuid not null unique
    references public.account_history_entries(id),
  refund_account_history_entry_id uuid unique
    references public.account_history_entries(id),
  payout_order_id uuid references public.payout_orders(id),
  upstream_business_order_number text not null,
  match_method text not null check (
    match_method in (
      'FULL_ORDER_NUMBER',
      'CHANNEL_ORDER_NUMBER',
      'ORDER_AND_AMOUNT',
      'ORDER_AND_TIME',
      'NO_EXACT_IDENTIFIER_MATCH',
      'CONFLICT'
    )
  ),
  match_confidence text not null check (
    match_confidence in ('HIGH','MEDIUM','LOW','NONE')
  ),
  match_evidence jsonb not null default '{}'::jsonb,
  original_payout_principal_vnd numeric(30,2) not null,
  original_upstream_fee_vnd numeric(30,2) not null,
  original_gross_outflow_vnd numeric(30,2) not null,
  refund_credit_vnd numeric(30,2) not null default 0,
  final_payout_status text not null check (
    final_payout_status in ('SUCCESS','REFUNDED')
  ),
  final_upstream_fee_vnd numeric(30,2) not null,
  final_gross_outflow_vnd numeric(30,2) not null,
  refund_reversal_status text not null check (
    refund_reversal_status in (
      'NOT_APPLICABLE',
      'ACCOUNT_HISTORY_NET_ZERO',
      'PAYOUT_ALLOCATION_REVERSED',
      'NO_PAYOUT_ALLOCATION_LINK'
    )
  ),
  payout_execution_cost_status text not null check (
    payout_execution_cost_status in ('VERIFIED','REFUNDED_ZERO','CONFLICT')
  ),
  profit_verification_status text not null check (
    profit_verification_status in (
      'VERIFIED','PARTIAL','ESTIMATED','NOT_CALCULABLE'
    )
  ),
  created_at timestamptz not null default now(),
  check (
    original_gross_outflow_vnd =
      original_payout_principal_vnd + original_upstream_fee_vnd
  ),
  check (
    (final_payout_status = 'REFUNDED'
      and refund_account_history_entry_id is not null
      and final_upstream_fee_vnd = 0
      and final_gross_outflow_vnd = 0)
    or
    (final_payout_status = 'SUCCESS'
      and refund_account_history_entry_id is null
      and final_upstream_fee_vnd = original_upstream_fee_vnd
      and final_gross_outflow_vnd = original_gross_outflow_vnd)
  )
);
create index account_history_payout_execution_order_idx
  on public.account_history_payout_executions(payout_order_id)
  where payout_order_id is not null;
create index account_history_payout_execution_status_idx
  on public.account_history_payout_executions(
    final_payout_status,
    profit_verification_status
  );

alter table public.payout_orders
  add column if not exists amount_usdt numeric(38,8)
    generated always as (received_usdt) stored,
  add column if not exists merchant_fee_usdt numeric(38,8)
    generated always as (total_fee_usdt) stored,
  add column if not exists merchant_fee_rate numeric(38,18)
    generated always as (
      total_fee_usdt / nullif(received_usdt, 0)
    ) stored,
  add column if not exists merchant_id text
    generated always as (merchant_code) stored,
  add column if not exists merchant_name text
    generated always as (merchant) stored,
  add column if not exists at_dcc_revenue numeric(38,12)
    generated always as (at_gross_income) stored,
  add column if not exists dcc_revenue_usdt numeric(38,12)
    generated always as (
      coalesce(crypto_dcc_income_usdt, 0)
      + coalesce(fiat_dcc_income_usdt, 0)
    ) stored,
  add column if not exists total_company_revenue_usdt numeric(38,12)
    generated always as (
      coalesce(total_fee_usdt, 0)
      + coalesce(crypto_dcc_income_usdt, 0)
      + coalesce(fiat_dcc_income_usdt, 0)
    ) stored;

alter table public.payout_profit_calculations
  add column if not exists amount_usdt numeric(30,8),
  add column if not exists merchant_fee_usdt numeric(30,8),
  add column if not exists merchant_fee_rate numeric(38,18),
  add column if not exists dcc_revenue_usdt numeric(30,12),
  add column if not exists total_company_revenue_usdt numeric(30,12),
  add column if not exists upstream_payout_fee_vnd numeric(30,4),
  add column if not exists upstream_payout_fee_usdt numeric(30,8),
  add column if not exists funding_principal_cost_usdt numeric(30,8),
  add column if not exists payout_execution_cost_status text check (
    payout_execution_cost_status is null or payout_execution_cost_status in (
      'VERIFIED','ESTIMATED','REFUNDED_ZERO','MISSING'
    )
  ),
  add column if not exists final_payout_status text check (
    final_payout_status is null or final_payout_status in (
      'SUCCESS','REFUNDED','UNMATCHED'
    )
  ),
  add column if not exists refund_reversal_vnd numeric(30,4),
  add column if not exists net_settlement_status text check (
    net_settlement_status is null or net_settlement_status in (
      'VERIFIED_VND_LEG',
      'PENDING_DIRECTION_CONFIRMATION',
      'NOT_LINKED'
    )
  ),
  add column if not exists realized_profit_eligible boolean not null default false
    check (realized_profit_eligible = false);

alter table public.daily_portfolio_summaries
  add column if not exists merchant_fee_revenue_usdt numeric(30,8)
    not null default 0,
  add column if not exists dcc_revenue_usdt numeric(30,12)
    not null default 0,
  add column if not exists total_company_revenue_usdt numeric(30,12)
    not null default 0,
  add column if not exists upstream_payout_fee_vnd numeric(30,4)
    not null default 0,
  add column if not exists refund_count bigint not null default 0,
  add column if not exists refund_reversal_vnd numeric(30,4)
    not null default 0,
  add column if not exists net_settlement_vnd numeric(30,4)
    not null default 0,
  add column if not exists net_settlement_usdt numeric(30,8)
    not null default 0;

alter table public.net_settlements
  alter column settlement_period_start drop not null,
  alter column settlement_period_end drop not null;
alter table public.net_settlements
  drop constraint if exists net_settlements_check;
alter table public.net_settlements
  add constraint net_settlements_period_check check (
    settlement_period_start is null
    or settlement_period_end is null
    or settlement_period_end > settlement_period_start
  );
alter table public.net_settlements
  add column if not exists settled_at timestamptz,
  add column if not exists settlement_direction text check (
    settlement_direction is null or settlement_direction in (
      'VND_DEBIT',
      'VND_CREDIT'
    )
  ),
  add column if not exists usdt_amount numeric(38,8),
  add column if not exists vnd_amount numeric(30,2),
  add column if not exists actual_rate_vnd_per_usdt numeric(38,12),
  add column if not exists account_history_entry_id uuid
    references public.account_history_entries(id),
  add column if not exists reason_raw text,
  add column if not exists verification_status text check (
    verification_status is null or verification_status in (
      'VERIFIED',
      'PENDING',
      'REJECTED'
    )
  ),
  add column if not exists counter_leg_status text check (
    counter_leg_status is null or counter_leg_status in (
      'VERIFIED',
      'PENDING_DIRECTION_CONFIRMATION',
      'MISSING'
    )
  ),
  add column if not exists realized_profit_effect_usdt numeric(30,8)
    not null default 0,
  add column if not exists source_file_hash text
    check (source_file_hash is null or length(source_file_hash) = 64),
  add constraint net_settlements_actual_rate_check check (
    usdt_amount is null
    or vnd_amount is null
    or actual_rate_vnd_per_usdt is null
    or abs(
      actual_rate_vnd_per_usdt - vnd_amount / nullif(usdt_amount, 0)
    ) < 0.000001
  ),
  add constraint net_settlements_pending_profit_check check (
    counter_leg_status <> 'PENDING_DIRECTION_CONFIRMATION'
    or realized_profit_effect_usdt = 0
  );
create unique index if not exists net_settlements_account_entry_idx
  on public.net_settlements(account_history_entry_id)
  where account_history_entry_id is not null;

create table public.task25_validation_runs (
  id uuid primary key default gen_random_uuid(),
  source_file_name text not null,
  source_file_hash text not null unique check (length(source_file_hash) = 64),
  source_period_start timestamptz not null,
  source_period_end timestamptz not null,
  total_source_rows integer not null,
  vnd_source_rows integer not null,
  imported_rows integer not null,
  duplicate_rows integer not null,
  excluded_non_vnd_rows integer not null,
  payout_debit_rows integer not null,
  refund_rows integer not null,
  refund_matched_rows integer not null,
  refund_unmatched_rows integer not null,
  successful_unrefunded_rows integer not null,
  successful_principal_vnd numeric(30,2) not null,
  successful_upstream_fee_vnd numeric(30,2) not null,
  successful_gross_outflow_vnd numeric(30,2) not null,
  payout_exact_match_rows integer not null,
  payout_conflict_rows integer not null,
  payout_unmatched_rows integer not null,
  net_settlement_rows integer not null,
  net_settlement_usdt numeric(38,8) not null,
  net_settlement_vnd numeric(30,2) not null,
  net_settlement_weighted_rate numeric(38,12) not null,
  account_history_cutoff timestamptz not null,
  account_history_closing_gross_vnd numeric(30,2) not null,
  balance_mismatch_rows integer not null,
  continuity_mismatch_rows integer not null,
  evidence jsonb not null,
  shadow_mode boolean not null default true check (shadow_mode),
  created_at timestamptz not null default now(),
  check (
    refund_matched_rows + refund_unmatched_rows = refund_rows
  ),
  check (
    payout_exact_match_rows + payout_conflict_rows + payout_unmatched_rows
      = payout_debit_rows
  )
);

create view public.payout_merchant_fee_summary
with (security_invoker = true)
as
select
  merchant_id,
  merchant_name,
  count(*) as payout_count,
  sum(amount_usdt) as amount_usdt,
  sum(merchant_fee_usdt) as merchant_fee_usdt,
  min(merchant_fee_rate) as minimum_merchant_fee_rate,
  percentile_cont(0.5) within group (order by merchant_fee_rate)
    as median_merchant_fee_rate,
  max(merchant_fee_rate) as maximum_merchant_fee_rate,
  sum(dcc_revenue_usdt) as dcc_revenue_usdt,
  sum(total_company_revenue_usdt) as total_company_revenue_usdt
from public.payout_orders
group by merchant_id, merchant_name;

alter table public.payout_order_identifiers enable row level security;
alter table public.account_history_payout_executions enable row level security;
alter table public.task25_validation_runs enable row level security;

create policy read_authenticated
on public.payout_order_identifiers
for select to authenticated using (true);
create policy read_authenticated
on public.account_history_payout_executions
for select to authenticated using (true);
create policy read_authenticated
on public.task25_validation_runs
for select to authenticated using (true);

grant select on public.payout_order_identifiers,
  public.account_history_payout_executions,
  public.task25_validation_runs,
  public.payout_merchant_fee_summary
to authenticated;
grant all on public.payout_order_identifiers,
  public.account_history_payout_executions,
  public.task25_validation_runs
to service_role;

create or replace function private.reject_task25_source_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'TASK25_SOURCE_AND_VALIDATION_RECORDS_ARE_IMMUTABLE';
end
$$;

create trigger account_history_entries_immutable
before update or delete on public.account_history_entries
for each row execute function private.reject_task25_source_mutation();

create trigger payout_order_identifiers_immutable
before update or delete on public.payout_order_identifiers
for each row execute function private.reject_task25_source_mutation();

create trigger account_history_payout_executions_immutable
before update or delete on public.account_history_payout_executions
for each row execute function private.reject_task25_source_mutation();

create trigger task25_validation_runs_immutable
before update or delete on public.task25_validation_runs
for each row execute function private.reject_task25_source_mutation();

do $$
begin
  if exists (
    select 1
    from public.payout_orders
    where merchant_fee_rate is not null
      and abs(
        merchant_fee_rate
        - merchant_fee_usdt / nullif(amount_usdt, 0)
      ) > 0.000000000000000001
  ) then
    raise exception 'MERCHANT_FEE_RATE_DERIVATION_FAILED';
  end if;
  if exists (
    select 1
    from public.payout_orders
    where total_company_revenue_usdt is distinct from
      coalesce(merchant_fee_usdt, 0) + coalesce(dcc_revenue_usdt, 0)
  ) then
    raise exception 'COMPANY_REVENUE_MUST_SEPARATE_MERCHANT_FEE_AND_DCC';
  end if;
  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'payout_order_identifiers',
        'account_history_payout_executions',
        'task25_validation_runs'
      )
      and cmd in ('INSERT','UPDATE','DELETE','ALL')
  ) then
    raise exception 'TASK25_AUDIT_TABLES_MUST_NOT_HAVE_MUTATION_POLICIES';
  end if;
end
$$;
