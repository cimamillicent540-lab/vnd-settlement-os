-- VND Shadow Pricing & Liquidity OS — Task 1.5 business-ratio correction.
-- Additive/auditable only: no source rows, audit rows, or tables are deleted.

insert into public.system_rules(rule_key,currency,numeric_value,effective_from,status)
values
  ('reserve_ratio','VND',0.50,'2026-07-17T00:00:00Z','ACTIVE'),
  ('settleable_ratio','VND',0.50,'2026-07-17T00:00:00Z','ACTIVE')
on conflict do nothing;

-- Keep the legacy multiplier only as historical evidence on superseded rows.
alter table public.opening_balances drop constraint if exists opening_balances_approval_status_check;
alter table public.opening_balances add constraint opening_balances_approval_status_check
  check (approval_status in ('PENDING','APPROVED','REJECTED','SUPERSEDED'));
alter table public.opening_balances drop constraint if exists opening_balances_check;
alter table public.opening_balances drop constraint if exists opening_balances_multiplier_check;
alter table public.opening_balances drop constraint if exists opening_balances_currency_effective_at_key;
alter table public.opening_balances alter column multiplier drop not null;
alter table public.opening_balances
  add column if not exists gross_opening_balance_vnd numeric(30,2),
  add column if not exists reserve_ratio numeric(12,8),
  add column if not exists reserve_opening_balance_vnd numeric(30,4),
  add column if not exists settleable_ratio numeric(12,8),
  add column if not exists settleable_opening_balance_vnd numeric(30,4),
  add column if not exists model_version text not null default 'LEGACY_MULTIPLIER',
  add column if not exists supersedes_opening_balance_id uuid references public.opening_balances(id),
  add column if not exists superseded_at timestamptz,
  add column if not exists superseded_reason text;
create unique index if not exists opening_balances_one_approved_effective
  on public.opening_balances(currency,effective_at) where approval_status='APPROVED';

update public.opening_balances
set approval_status='SUPERSEDED',
    model_version='LEGACY_MULTIPLIER',
    gross_opening_balance_vnd=source_single_account_balance_vnd,
    superseded_at=now(),
    superseded_reason='Incorrect multiplier=2 model superseded by reserve_ratio=0.50 / settleable_ratio=0.50'
where currency='VND'
  and effective_at='2026-07-17T00:00:00Z'
  and approval_status='APPROVED'
  and multiplier=2;

insert into public.opening_balances(
  currency,opening_balance_vnd,effective_at,source_timezone,source_local_time,
  source_single_account_balance_vnd,multiplier,approval_status,notes,
  gross_opening_balance_vnd,reserve_ratio,reserve_opening_balance_vnd,
  settleable_ratio,settleable_opening_balance_vnd,model_version,
  supersedes_opening_balance_id
)
select
  'VND',1699114395.57,'2026-07-17T00:00:00Z','UTC+8','2026-07-17 08:00:00',
  3398228791.14,null,'APPROVED',
  'Correct pre-08:00 opening: upstream keeps 50% reserve and 50% is settleable.',
  3398228791.14,0.50,1699114395.5700,0.50,1699114395.5700,
  'SETTLEABLE_RATIO_V1',id
from public.opening_balances
where currency='VND'
  and effective_at='2026-07-17T00:00:00Z'
  and approval_status='SUPERSEDED'
order by created_at desc
limit 1;

alter table public.opening_balances add constraint opening_balances_ratio_model_check check (
  approval_status='SUPERSEDED'
  or (
    model_version='SETTLEABLE_RATIO_V1'
    and multiplier is null
    and gross_opening_balance_vnd=3398228791.14
    and reserve_ratio=0.50
    and settleable_ratio=0.50
    and reserve_opening_balance_vnd=round(gross_opening_balance_vnd*reserve_ratio,4)
    and settleable_opening_balance_vnd=round(gross_opening_balance_vnd*settleable_ratio,4)
    and opening_balance_vnd=round(settleable_opening_balance_vnd,2)
  )
);

-- Preserve imported source columns. New gross/settleable fields are derived,
-- never written back into change_amount_vnd or source balance columns.
alter table public.account_history_entries
  add column if not exists gross_balance_before_vnd numeric(30,2)
    generated always as (balance_before_vnd) stored,
  add column if not exists gross_balance_after_vnd numeric(30,2)
    generated always as (balance_after_vnd) stored,
  add column if not exists gross_balance_vnd numeric(30,2)
    generated always as (balance_after_vnd) stored,
  add column if not exists gross_change_vnd numeric(30,2)
    generated always as (change_amount_vnd) stored,
  add column if not exists gross_signed_change_vnd numeric(30,2)
    generated always as (signed_amount_vnd) stored,
  add column if not exists reserve_ratio numeric(12,8) not null default 0.50,
  add column if not exists reserve_amount_vnd numeric(30,4)
    generated always as (round(balance_after_vnd*0.50,4)) stored,
  add column if not exists settleable_ratio numeric(12,8) not null default 0.50,
  add column if not exists settleable_balance_before_vnd numeric(30,4)
    generated always as (round(balance_before_vnd*0.50,4)) stored,
  add column if not exists settleable_balance_vnd numeric(30,4)
    generated always as (round(balance_after_vnd*0.50,4)) stored,
  add column if not exists settleable_change_vnd numeric(30,4)
    generated always as (round(change_amount_vnd*0.50,4)) stored,
  add column if not exists settleable_signed_change_vnd numeric(30,4)
    generated always as (round(signed_amount_vnd*0.50,4)) stored;
alter table public.account_history_entries add constraint account_history_ratio_check
  check (reserve_ratio=0.50 and settleable_ratio=0.50);

alter table public.topup_batches
  add column if not exists account_history_match_status text,
  add column if not exists matched_account_history_entry_id uuid references public.account_history_entries(id),
  add column if not exists account_history_match_evidence jsonb not null default '{}'::jsonb,
  add column if not exists gross_ledger_treatment text,
  add column if not exists settleable_increase_vnd numeric(30,4)
    generated always as (round((gross_vnd_received-additional_fee_vnd)*0.50,4)) stored;

update public.topup_batches
set account_history_match_status='NOT_IN_ACCOUNT_HISTORY_DATE_RANGE',
    matched_account_history_entry_id=null,
    gross_ledger_treatment='ADD_GROSS_AND_SETTLEABLE_INFLOW',
    account_history_match_evidence=jsonb_build_object(
      'account_history_min_local','2026-07-15 00:00:26',
      'account_history_max_local','2026-07-18 23:59:28',
      'topup_execution_date',execution_date,
      'exact_date_amount_matches',0,
      'same_amount_any_date_matches',0,
      'checked_fields',jsonb_build_array('date','amount','business_order_number_or_notes','account_change'),
      'conclusion','Topup is outside Account History date range and has no matching adjustment amount'
    )
where source='VERIFIED_SEED';

alter table public.pool_buckets
  add column if not exists gross_original_amount_vnd numeric(30,2),
  add column if not exists gross_available_amount_vnd numeric(30,2),
  add column if not exists reserve_ratio numeric(12,8) not null default 0.50,
  add column if not exists reserve_amount_vnd numeric(30,4),
  add column if not exists settleable_ratio numeric(12,8) not null default 0.50,
  add column if not exists settleable_original_amount_vnd numeric(30,4),
  add column if not exists settleable_available_amount_vnd numeric(30,4),
  add column if not exists balance_model_version text not null default 'SETTLEABLE_RATIO_V1';

update public.pool_buckets b
set gross_original_amount_vnd=t.net_vnd_received,
    gross_available_amount_vnd=t.remaining_vnd,
    reserve_ratio=0.50,
    reserve_amount_vnd=round(t.remaining_vnd*0.50,4),
    settleable_ratio=0.50,
    settleable_original_amount_vnd=round(t.net_vnd_received*0.50,4),
    settleable_available_amount_vnd=round(t.remaining_vnd*0.50,4),
    original_amount_vnd=round(t.net_vnd_received*0.50,2),
    available_amount_vnd=round(t.remaining_vnd*0.50,2),
    balance_model_version='SETTLEABLE_RATIO_V1',
    notes=concat_ws(' | ',b.notes,'Gross source amount preserved; legacy available_amount_vnd now means settleable availability at 50%.')
from public.topup_batches t
where b.source_type='TOPUP' and b.source_reference_id=t.id;

-- Supersede, do not delete, the multiplier=2 ledger.
alter table public.pool_ledger_entries drop constraint if exists pool_ledger_entries_check1;
alter table public.pool_ledger_entries add constraint pool_ledger_entries_settleable_continuity_check
  check (abs(balance_after_vnd-(balance_before_vnd+signed_amount_vnd))<=0.51);
alter table public.pool_ledger_entries
  add column if not exists record_status text not null default 'ACTIVE'
    check (record_status in ('ACTIVE','SUPERSEDED')),
  add column if not exists model_version text not null default 'LEGACY_MULTIPLIER',
  add column if not exists superseded_at timestamptz,
  add column if not exists superseded_reason text,
  add column if not exists gross_amount_vnd numeric(30,2),
  add column if not exists gross_signed_amount_vnd numeric(30,2),
  add column if not exists gross_balance_before_vnd numeric(30,2),
  add column if not exists gross_balance_after_vnd numeric(30,2),
  add column if not exists source_gross_balance_before_vnd numeric(30,2),
  add column if not exists source_gross_balance_after_vnd numeric(30,2),
  add column if not exists reserve_ratio numeric(12,8),
  add column if not exists reserve_balance_after_vnd numeric(30,4),
  add column if not exists settleable_ratio numeric(12,8),
  add column if not exists settleable_amount_vnd numeric(30,4),
  add column if not exists settleable_signed_amount_vnd numeric(30,4),
  add column if not exists settleable_balance_before_vnd numeric(30,4),
  add column if not exists settleable_balance_after_vnd numeric(30,4);

insert into public.audit_logs(action,entity_type,entity_id,before_state,after_state,metadata)
select 'SUPERSEDE_MODEL','pool_ledger_model','SETTLEABLE_RATIO_V1',
  jsonb_build_object('active_rows',count(*),'model','LEGACY_MULTIPLIER','incorrect_multiplier',2),
  jsonb_build_object('model','SETTLEABLE_RATIO_V1','reserve_ratio',0.50,'settleable_ratio',0.50),
  jsonb_build_object('reason','Business-rule correction; source Account History rows remain unchanged')
from public.pool_ledger_entries where record_status='ACTIVE';

update public.pool_ledger_entries
set record_status='SUPERSEDED',
    superseded_at=now(),
    superseded_reason='Incorrect multiplier=2 ledger superseded; retained for audit',
    model_version='LEGACY_MULTIPLIER'
where record_status='ACTIVE';

insert into public.pool_ledger_entries(
  event_time,event_date,time_precision,event_type,source_type,source_reference_id,
  amount_vnd,signed_amount_vnd,balance_before_vnd,balance_after_vnd,
  data_confidence,notes,source_event_key,is_net_zero_transfer,
  record_status,model_version,gross_amount_vnd,gross_signed_amount_vnd,
  gross_balance_before_vnd,gross_balance_after_vnd,
  source_gross_balance_before_vnd,source_gross_balance_after_vnd,
  reserve_ratio,reserve_balance_after_vnd,settleable_ratio,
  settleable_amount_vnd,settleable_signed_amount_vnd,
  settleable_balance_before_vnd,settleable_balance_after_vnd
) values (
  '2026-07-17T00:00:00Z','2026-07-17','EXACT','OPENING_BALANCE','OPENING',null,
  1699114395.57,1699114395.57,0,1699114395.57,
  'HIGH','Correct gross/reserve/settleable opening; no multiplier.',
  'ratio50:opening:2026-07-17T00:00:00Z',false,
  'ACTIVE','SETTLEABLE_RATIO_V1',3398228791.14,3398228791.14,
  0,3398228791.14,0,3398228791.14,
  0.50,1699114395.5700,0.50,1699114395.5700,1699114395.5700,
  0,1699114395.5700
);

insert into public.pool_ledger_entries(
  event_time,event_date,time_precision,event_type,source_type,source_reference_id,
  amount_vnd,signed_amount_vnd,balance_before_vnd,balance_after_vnd,
  data_confidence,notes,source_event_key,is_net_zero_transfer,
  record_status,model_version,gross_amount_vnd,gross_signed_amount_vnd,
  gross_balance_before_vnd,gross_balance_after_vnd,
  source_gross_balance_before_vnd,source_gross_balance_after_vnd,
  reserve_ratio,reserve_balance_after_vnd,settleable_ratio,
  settleable_amount_vnd,settleable_signed_amount_vnd,
  settleable_balance_before_vnd,settleable_balance_after_vnd
)
select
  transaction_time,source_local_time::date,'EXACT',event_type,
  case when event_type='PAYIN_INFLOW' then 'PAYIN_INTERNAL_NETTING'::public.source_type else null end,
  id,
  round(settleable_change_vnd,2),round(settleable_signed_change_vnd,2),
  round(settleable_balance_before_vnd,2),round(settleable_balance_vnd,2),
  'HIGH',
  'Gross source values preserved; settleable layer derived at 50%.',
  'ratio50:account:'||raw_row_hash,
  transfer_pair_status='PAIRED',
  'ACTIVE','SETTLEABLE_RATIO_V1',
  gross_change_vnd,gross_signed_change_vnd,
  gross_balance_before_vnd,gross_balance_after_vnd,
  gross_balance_before_vnd,gross_balance_after_vnd,
  reserve_ratio,reserve_amount_vnd,settleable_ratio,
  settleable_change_vnd,settleable_signed_change_vnd,
  settleable_balance_before_vnd,settleable_balance_vnd
from public.account_history_entries
where source_local_time>='2026-07-17 08:00:00'
order by transaction_time,source_row_number desc;

with source_close as (
  select balance_after_vnd gross_closing
  from public.account_history_entries
  where source_local_time>='2026-07-17 08:00:00'
  order by transaction_time desc,source_row_number asc
  limit 1
), ordered_topups as (
  select t.*,
    coalesce(sum(net_vnd_received) over(order by execution_date,sequence_within_date rows between unbounded preceding and 1 preceding),0) prior_topup_vnd,
    sum(net_vnd_received) over(order by execution_date,sequence_within_date) cumulative_topup_vnd
  from public.topup_batches t
  where source='VERIFIED_SEED'
)
insert into public.pool_ledger_entries(
  event_time,event_date,time_precision,event_type,source_type,source_reference_id,
  amount_vnd,signed_amount_vnd,balance_before_vnd,balance_after_vnd,
  data_confidence,notes,source_event_key,is_net_zero_transfer,
  record_status,model_version,gross_amount_vnd,gross_signed_amount_vnd,
  gross_balance_before_vnd,gross_balance_after_vnd,
  source_gross_balance_before_vnd,source_gross_balance_after_vnd,
  reserve_ratio,reserve_balance_after_vnd,settleable_ratio,
  settleable_amount_vnd,settleable_signed_amount_vnd,
  settleable_balance_before_vnd,settleable_balance_after_vnd
)
select
  null,t.execution_date,'DATE_ONLY','TOPUP_INFLOW','TOPUP',t.id,
  round(t.net_vnd_received*0.50,2),round(t.net_vnd_received*0.50,2),
  round((s.gross_closing+t.prior_topup_vnd)*0.50,2),
  round((s.gross_closing+t.cumulative_topup_vnd)*0.50,2),
  'MEDIUM',
  'No Account History match: topup is after source window; add gross inflow once and derive 50% settleable.',
  'ratio50:topup:'||t.id,false,
  'ACTIVE','SETTLEABLE_RATIO_V1',
  t.net_vnd_received,t.net_vnd_received,
  s.gross_closing+t.prior_topup_vnd,s.gross_closing+t.cumulative_topup_vnd,
  null,null,
  0.50,round((s.gross_closing+t.cumulative_topup_vnd)*0.50,4),0.50,
  round(t.net_vnd_received*0.50,4),round(t.net_vnd_received*0.50,4),
  round((s.gross_closing+t.prior_topup_vnd)*0.50,4),
  round((s.gross_closing+t.cumulative_topup_vnd)*0.50,4)
from ordered_topups t cross join source_close s
order by t.execution_date,t.sequence_within_date;

alter table public.reconciliation_runs drop constraint if exists reconciliation_runs_status_check;
alter table public.reconciliation_runs add constraint reconciliation_runs_status_check
  check (status in ('RUNNING','BALANCED','BALANCED_WITH_SOURCE_ROUNDING','DIFFERENCE','INCOMPLETE','SUPERSEDED'));
alter table public.reconciliation_runs
  add column if not exists record_status text not null default 'ACTIVE'
    check (record_status in ('ACTIVE','SUPERSEDED')),
  add column if not exists model_version text not null default 'LEGACY_MULTIPLIER',
  add column if not exists superseded_at timestamptz,
  add column if not exists superseded_reason text,
  add column if not exists period_start timestamptz,
  add column if not exists period_end timestamptz,
  add column if not exists gross_opening_balance_vnd numeric(30,2),
  add column if not exists gross_payin_vnd numeric(30,2),
  add column if not exists gross_topup_vnd numeric(30,2),
  add column if not exists gross_payout_vnd numeric(30,2),
  add column if not exists gross_adjustment_vnd numeric(30,2),
  add column if not exists gross_internal_transfer_net_vnd numeric(30,2),
  add column if not exists gross_reconstructed_ending_vnd numeric(30,2),
  add column if not exists gross_source_ending_vnd numeric(30,2),
  add column if not exists gross_difference_vnd numeric(30,2),
  add column if not exists reserve_ratio numeric(12,8),
  add column if not exists reserve_ending_vnd numeric(30,4),
  add column if not exists settleable_ratio numeric(12,8),
  add column if not exists settleable_opening_balance_vnd numeric(30,4),
  add column if not exists settleable_payin_vnd numeric(30,4),
  add column if not exists settleable_topup_vnd numeric(30,4),
  add column if not exists settleable_payout_vnd numeric(30,4),
  add column if not exists settleable_adjustment_vnd numeric(30,4),
  add column if not exists settleable_internal_transfer_net_vnd numeric(30,4),
  add column if not exists settleable_reconstructed_ending_vnd numeric(30,4),
  add column if not exists settleable_source_ending_vnd numeric(30,4),
  add column if not exists settleable_difference_vnd numeric(30,4),
  add column if not exists topup_match_conclusion text;

update public.reconciliation_runs
set record_status='SUPERSEDED',status='SUPERSEDED',superseded_at=now(),
    superseded_reason='Incorrect multiplier=2 reconciliation superseded; retained for audit',
    model_version='LEGACY_MULTIPLIER'
where record_status='ACTIVE';

with window_rows as (
  select *
  from public.account_history_entries
  where source_local_time>='2026-07-17 08:00:00'
), totals as (
  select
    coalesce(sum(gross_signed_change_vnd) filter(where event_type='PAYIN_INFLOW'),0) gross_payin,
    coalesce(-sum(gross_signed_change_vnd) filter(where event_type='PAYOUT_OUTFLOW'),0) gross_payout,
    coalesce(sum(gross_signed_change_vnd) filter(where event_type='MANUAL_ADJUSTMENT'),0) gross_adjustment,
    coalesce(sum(gross_signed_change_vnd) filter(where event_type in ('INTERNAL_TRANSFER_DEBIT','INTERNAL_TRANSFER_CREDIT')),0) transfer_net,
    min(transaction_time) period_start,
    max(transaction_time) period_end
  from window_rows
), closing as (
  select gross_balance_after_vnd source_ending
  from window_rows
  order by transaction_time desc,source_row_number asc
  limit 1
), calc as (
  select t.*,c.source_ending,
    round(3398228791.14+t.gross_payin-t.gross_payout+t.gross_adjustment+t.transfer_net,2) reconstructed
  from totals t cross join closing c
)
insert into public.reconciliation_runs(
  completed_at,opening_balance_vnd,total_inflow_vnd,total_outflow_vnd,
  reconstructed_balance_vnd,source_closing_balance_vnd,difference_vnd,status,details,
  record_status,model_version,period_start,period_end,
  gross_opening_balance_vnd,gross_payin_vnd,gross_topup_vnd,gross_payout_vnd,
  gross_adjustment_vnd,gross_internal_transfer_net_vnd,
  gross_reconstructed_ending_vnd,gross_source_ending_vnd,gross_difference_vnd,
  reserve_ratio,reserve_ending_vnd,settleable_ratio,settleable_opening_balance_vnd,
  settleable_payin_vnd,settleable_topup_vnd,settleable_payout_vnd,
  settleable_adjustment_vnd,settleable_internal_transfer_net_vnd,
  settleable_reconstructed_ending_vnd,settleable_source_ending_vnd,
  settleable_difference_vnd,topup_match_conclusion
)
select
  now(),1699114395.57,round(gross_payin*0.50,2),
  round((gross_payout-gross_adjustment)*0.50,2),
  round(reconstructed*0.50,2),round(source_ending*0.50,2),
  round((reconstructed-source_ending)*0.50,2),'BALANCED_WITH_SOURCE_ROUNDING',
  jsonb_build_object(
    'balance_model','gross_and_settleable_50_percent',
    'source_balance_precision','Source balances are displayed to whole VND while changes retain cents',
    'topups_in_period',0,
    'topups_after_period',3,
    'topup_total_vnd_after_period',14533500000,
    'topup_duplicate_entry',false
  ),
  'ACTIVE','SETTLEABLE_RATIO_V1',period_start,period_end,
  3398228791.14,gross_payin,0,gross_payout,gross_adjustment,transfer_net,
  reconstructed,source_ending,reconstructed-source_ending,
  0.50,round(source_ending*0.50,4),0.50,1699114395.5700,
  round(gross_payin*0.50,4),0,round(gross_payout*0.50,4),
  round(gross_adjustment*0.50,4),round(transfer_net*0.50,4),
  round(reconstructed*0.50,4),round(source_ending*0.50,4),
  round((reconstructed-source_ending)*0.50,4),
  'All 3 topups are dated after Account History max time and have no matching adjustment amount; add once after the source period.'
from calc;

comment on column public.opening_balances.multiplier is
  'Deprecated historical field. Must be null for active SETTLEABLE_RATIO_V1 records; multiplier=2 remains only on SUPERSEDED audit rows.';
comment on column public.pool_buckets.available_amount_vnd is
  'Active model: settleable availability only. Never use gross account balance for payout capacity.';
comment on column public.pool_alerts.vnd_balance_at_calculation is
  'Must contain settleable_balance_vnd, never gross_account_balance_vnd.';
