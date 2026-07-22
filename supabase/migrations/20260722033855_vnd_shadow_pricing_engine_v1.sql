-- Task 2 — VND Shadow Pricing, Cost Allocation and Profit Engine.
-- Shadow Mode only. This migration never deletes or overwrites Task 1/1.5 source data.

create schema if not exists private;
revoke all on schema private from public,anon;

create or replace function private.has_role(required_role public.app_role)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select exists(
    select 1 from public.user_roles ur
    where ur.user_id=(select auth.uid()) and ur.role=required_role
  )
$$;
revoke all on function private.has_role(public.app_role) from public,anon;
grant usage on schema private to authenticated,service_role;
grant execute on function private.has_role(public.app_role) to authenticated,service_role;

create or replace function public.has_role(required_role public.app_role)
returns boolean
language sql
stable
security invoker
set search_path=''
as $$ select private.has_role(required_role) $$;
revoke all on function public.has_role(public.app_role) from public,anon;
grant execute on function public.has_role(public.app_role) to authenticated,service_role;

alter table public.system_rules drop constraint if exists system_rules_status_check;
alter table public.system_rules add constraint system_rules_status_check
 check(status in ('DRAFT','PENDING_CONFIRMATION','ACTIVE','INACTIVE'));

insert into public.system_rules(rule_key,currency,numeric_value,effective_from,status)
values
 ('minimum_economic_margin','VND',0.002,'2026-07-20T00:00:00Z','ACTIVE'),
 ('target_economic_margin','VND',0.005,'2026-07-20T00:00:00Z','ACTIVE'),
 ('vnd_payout_fee_rate','VND',0.005,'2026-07-20T00:00:00Z','PENDING_CONFIRMATION'),
 ('vnd_payout_fixed_fee_vnd','VND',0,'2026-07-20T00:00:00Z','PENDING_CONFIRMATION')
on conflict do nothing;

create table public.payout_account_history_matches(
 id uuid primary key default gen_random_uuid(),
 payout_order_id uuid not null references public.payout_orders(id),
 account_history_entry_id uuid references public.account_history_entries(id),
 match_method text not null check(match_method in ('BUSINESS_ORDER_NUMBER','CHANNEL_ORDER_NUMBER','MERCHANT_ORDER_NUMBER','TIME_CURRENCY_AMOUNT','MANUAL_CONFIRMED','NO_ACCOUNT_HISTORY_DATE_RANGE','CONFLICT')),
 match_confidence text not null check(match_confidence in ('HIGH','MEDIUM','LOW','NONE')),
 amount_difference_vnd numeric(30,4),
 time_difference_seconds numeric(30,3),
 matched_by uuid references auth.users(id),
 matched_at timestamptz,
 review_status text not null check(review_status in ('AUTO_CONFIRMED','PENDING_REVIEW','MANUAL_CONFIRMED','REJECTED','NO_MATCH')),
 evidence jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now()
);
create unique index payout_matches_one_review_per_order_idx on public.payout_account_history_matches(payout_order_id);
create index payout_matches_account_idx on public.payout_account_history_matches(account_history_entry_id) where account_history_entry_id is not null;
create index payout_matches_review_idx on public.payout_account_history_matches(review_status,match_confidence);

create table public.rate_snapshots(
 id uuid primary key default gen_random_uuid(),
 currency_pair text not null default 'USDT/VND' check(currency_pair='USDT/VND'),
 direction text not null default 'VND_PER_USDT' check(direction='VND_PER_USDT'),
 rate_vnd_per_usdt numeric(30,12) not null check(rate_vnd_per_usdt>0),
 quoted_at timestamptz,
 valid_from timestamptz,
 valid_to timestamptz,
 rate_date date,
 time_precision public.time_precision not null default 'EXACT',
 amount_capacity_usdt numeric(30,8),
 source text not null check(source in ('XE_REFERENCE','BINANCE_P2P','UPSTREAM_EXECUTABLE','TOPUP_ACTUAL','MANUAL_APPROVED')),
 source_reference text,
 topup_batch_id uuid references public.topup_batches(id),
 is_actual_transaction boolean not null default false,
 confidence text not null check(confidence in ('HIGH','MEDIUM','LOW')),
 entered_by uuid references auth.users(id),
 approved_by uuid references auth.users(id),
 approval_status text not null check(approval_status in ('PENDING','APPROVED','REJECTED')),
 created_at timestamptz not null default now(),
 check((time_precision='DATE_ONLY' and quoted_at is null and rate_date is not null) or time_precision='EXACT')
);
create unique index rate_snapshots_topup_unique_idx on public.rate_snapshots(topup_batch_id) where topup_batch_id is not null;
create index rate_snapshots_lookup_idx on public.rate_snapshots(currency_pair,direction,approval_status,valid_from desc);
create index rate_snapshots_date_idx on public.rate_snapshots(rate_date desc) where time_precision='DATE_ONLY';

create table public.shadow_pricing_runs(
 id uuid primary key default gen_random_uuid(),
 run_version bigint generated always as identity,
 run_type text not null check(run_type in ('INTERACTIVE_QUOTE','HISTORICAL_BACKTEST','PORTFOLIO_SCENARIO')),
 rules_version text not null,
 input_snapshot jsonb not null,
 data_cutoff_snapshot jsonb not null,
 status text not null check(status in ('COMPLETED','PARTIAL','FAILED')),
 shadow_mode boolean not null default true check(shadow_mode),
 created_by uuid references auth.users(id),
 created_at timestamptz not null default now()
);
create unique index shadow_pricing_runs_version_idx on public.shadow_pricing_runs(run_version);
create index shadow_pricing_runs_type_created_idx on public.shadow_pricing_runs(run_type,created_at desc);

create table public.shadow_pricing_results(
 id uuid primary key default gen_random_uuid(),
 pricing_run_id uuid not null references public.shadow_pricing_runs(id),
 target_margin numeric(18,12) not null check(target_margin>=0 and target_margin<1),
 received_usdt numeric(30,8) not null check(received_usdt>0),
 economic_cost_per_vnd numeric(30,18),
 company_borne_fee_usdt numeric(30,8) not null default 0,
 estimated_payout_fee_vnd numeric(30,4),
 max_gross_outflow_vnd numeric(30,4),
 max_merchant_principal_vnd numeric(30,4),
 recommended_as_rate numeric(30,12),
 current_manual_as_rate numeric(30,12),
 merchant_principal_difference_vnd numeric(30,4),
 expected_economic_margin numeric(18,12),
 profit_verification_status text not null check(profit_verification_status in ('VERIFIED','PARTIAL','ESTIMATED','NOT_CALCULABLE')),
 data_completeness_status text not null check(data_completeness_status in ('COMPLETE','NO_ACCOUNT_HISTORY','MISSING_RECEIVED_USDT','MISSING_RATE','PARTIAL_AFTER_ACCOUNT_HISTORY_CUTOFF','DATE_ONLY_RATE','MULTIPLE_ISSUES')),
 confidence text not null check(confidence in ('HIGH','MEDIUM','LOW','NOT_CALCULABLE')),
 result_snapshot jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now(),
 unique(pricing_run_id,target_margin)
);
create index shadow_results_run_idx on public.shadow_pricing_results(pricing_run_id);

create table public.payout_profit_calculations(
 id uuid primary key default gen_random_uuid(),
 pricing_run_id uuid not null references public.shadow_pricing_runs(id),
 payout_order_id uuid not null references public.payout_orders(id),
 account_history_entry_id uuid references public.account_history_entries(id),
 gross_outflow_vnd numeric(30,4),
 settleable_impact_vnd numeric(30,4),
 merchant_principal_vnd numeric(30,4),
 payout_fee_vnd numeric(30,4),
 payout_fee_status text not null check(payout_fee_status in ('ACTUAL','MANUAL_INPUT','PENDING_RULE_ESTIMATE','MISSING')),
 received_usdt numeric(30,8),
 company_borne_fee_usdt numeric(30,8) not null default 0,
 external_cash_cost_usdt numeric(30,8),
 economic_replacement_cost_usdt numeric(30,8),
 internal_netting_advantage_usdt numeric(30,8),
 economic_profit_usdt numeric(30,8),
 economic_profit_margin numeric(18,12),
 realized_profit_status text not null check(realized_profit_status in ('VERIFIED','NOT_FULLY_VERIFIED')),
 profit_verification_status text not null check(profit_verification_status in ('VERIFIED','PARTIAL','ESTIMATED','NOT_CALCULABLE')),
 data_completeness_status text not null check(data_completeness_status in ('COMPLETE','NO_ACCOUNT_HISTORY','MISSING_RECEIVED_USDT','MISSING_RATE','PARTIAL_AFTER_ACCOUNT_HISTORY_CUTOFF','DATE_ONLY_RATE','MULTIPLE_ISSUES')),
 current_manual_as_rate numeric(30,12),
 ar_rate numeric(30,12),
 as_rate numeric(30,12),
 ap_imported numeric(18,12),
 ap_calculated numeric(18,12),
 aq_imported numeric(18,12),
 aq_relationship_status text not null default 'RELATIONSHIP_PENDING_CONFIRMATION',
 minimum_margin_quote numeric(30,12),
 target_margin_quote numeric(30,12),
 issue_codes jsonb not null default '[]'::jsonb,
 calculation_snapshot jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now(),
 unique(pricing_run_id,payout_order_id)
);
create index payout_profit_order_idx on public.payout_profit_calculations(payout_order_id);
create index payout_profit_run_status_idx on public.payout_profit_calculations(pricing_run_id,profit_verification_status);

create table public.daily_portfolio_summaries(
 id uuid primary key default gen_random_uuid(),
 pricing_run_id uuid not null references public.shadow_pricing_runs(id),
 summary_date date not null,
 backtest_window text not null check(backtest_window in ('VERIFIED_WINDOW','PARTIAL_AFTER_ACCOUNT_HISTORY_CUTOFF')),
 payin_fee_revenue_vnd numeric(30,4) not null default 0,
 payin_upstream_fee_vnd numeric(30,4) not null default 0,
 payin_net_fee_contribution_vnd numeric(30,4) not null default 0,
 payout_economic_profit_usdt numeric(30,8),
 external_topup_cash_cost_usdt numeric(30,8),
 internal_netting_advantage_usdt numeric(30,8),
 verified_count bigint not null default 0,
 partial_count bigint not null default 0,
 estimated_count bigint not null default 0,
 not_calculable_count bigint not null default 0,
 below_minimum_margin_count bigint not null default 0,
 at_or_above_target_margin_count bigint not null default 0,
 gross_balance_vnd numeric(30,4),
 reserve_balance_vnd numeric(30,4),
 settleable_balance_vnd numeric(30,4),
 data_cutoff_snapshot jsonb not null,
 created_at timestamptz not null default now(),
 unique(pricing_run_id,summary_date)
);
create index daily_portfolio_date_idx on public.daily_portfolio_summaries(summary_date desc);

alter table public.payout_pool_allocations
 add column if not exists pricing_run_id uuid references public.shadow_pricing_runs(id),
 add column if not exists account_history_entry_id uuid references public.account_history_entries(id),
 add column if not exists allocated_gross_outflow_vnd numeric(30,4),
 add column if not exists allocated_settleable_impact_vnd numeric(30,4),
 add column if not exists economic_rate_vnd_per_usdt numeric(30,12),
 add column if not exists cost_method text,
 add column if not exists external_cash_cost_usdt numeric(30,8),
 add column if not exists economic_cost_usdt numeric(30,8),
 add column if not exists internal_netting_advantage_usdt numeric(30,8),
 add column if not exists cost_confidence text,
 add column if not exists allocation_status text,
 add column if not exists input_snapshot jsonb not null default '{}'::jsonb;
alter table public.payout_pool_allocations drop constraint if exists payout_pool_allocations_payout_order_id_pool_bucket_id_key;
create index if not exists payout_allocations_run_idx on public.payout_pool_allocations(pricing_run_id);
create index if not exists payout_allocations_account_idx on public.payout_pool_allocations(account_history_entry_id) where account_history_entry_id is not null;
create unique index if not exists payout_allocations_version_bucket_idx on public.payout_pool_allocations(pricing_run_id,payout_order_id,pool_bucket_id) where pricing_run_id is not null;

insert into public.rate_snapshots(id,rate_vnd_per_usdt,rate_date,time_precision,amount_capacity_usdt,source,source_reference,topup_batch_id,is_actual_transaction,confidence,approval_status)
select ('10000000-0000-4000-8000-'||right(replace(t.id::text,'-',''),12))::uuid,
       t.effective_rate_vnd_per_usdt,t.execution_date,'DATE_ONLY',t.usdt_spent,
       'TOPUP_ACTUAL',t.id::text,t.id,true,'MEDIUM','APPROVED'
from public.topup_batches t
where t.status='APPROVED'
on conflict(topup_batch_id) where topup_batch_id is not null do nothing;

-- Reconstruct two auditable aggregated Account History source buckets without
-- changing any raw Account History amount. Negative events deplete sources
-- proportionally; the final 0.22 VND display-rounding difference is reconciled
-- proportionally to the source closing balance.
do $$
declare
 r record;
 opening_original numeric:=3398228791.14;
 opening_available numeric:=3398228791.14;
 payin_original numeric:=0;
 payin_available numeric:=0;
 adjustment_original numeric:=0;
 adjustment_available numeric:=0;
 total_available numeric;
 outflow numeric;
 source_close numeric;
 scale_factor numeric;
begin
 for r in
   select event_type,gross_change_vnd,gross_signed_change_vnd
   from public.account_history_entries
   where source_local_time>='2026-07-17 08:00:00'
   order by transaction_time,source_row_number desc
 loop
   if r.event_type='PAYIN_INFLOW' then
     payin_original:=payin_original+r.gross_change_vnd;
     payin_available:=payin_available+r.gross_change_vnd;
   elsif r.event_type='MANUAL_ADJUSTMENT' and r.gross_signed_change_vnd>0 then
     adjustment_original:=adjustment_original+r.gross_change_vnd;
     adjustment_available:=adjustment_available+r.gross_change_vnd;
   elsif r.event_type in ('PAYOUT_OUTFLOW','MANUAL_ADJUSTMENT') and r.gross_signed_change_vnd<0 then
     outflow:=abs(r.gross_signed_change_vnd);
     total_available:=opening_available+payin_available+adjustment_available;
     if outflow>total_available then raise exception 'TASK2_SOURCE_REBUILD_INSUFFICIENT_BALANCE'; end if;
     opening_available:=opening_available-(outflow*opening_available/total_available);
     payin_available:=payin_available-(outflow*payin_available/total_available);
     adjustment_available:=adjustment_available-(outflow*adjustment_available/total_available);
   end if;
 end loop;
 select gross_balance_after_vnd into source_close
 from public.account_history_entries
 where source_local_time>='2026-07-17 08:00:00'
 order by transaction_time desc,source_row_number asc limit 1;
 scale_factor:=source_close/nullif(opening_available+payin_available+adjustment_available,0);
 opening_available:=opening_available*scale_factor;
 payin_available:=payin_available*scale_factor;
 adjustment_available:=adjustment_available*scale_factor;

 insert into public.pool_buckets(id,currency,source_type,source_reference_id,original_amount_vnd,available_amount_vnd,funding_rate_vnd_per_usdt,funding_cost_usdt,cost_basis_status,opened_at,status,notes,gross_original_amount_vnd,gross_available_amount_vnd,reserve_ratio,reserve_amount_vnd,settleable_ratio,settleable_original_amount_vnd,settleable_available_amount_vnd,balance_model_version)
 values
 ('20000000-0000-4000-8000-000000020001','VND','OPENING',null,round(opening_original*.5,2),round(opening_available*.5,2),null,null,'ESTIMATED','2026-07-17T00:00:00Z','OPEN','Task 2 reconstructed opening-source position; replacement rate required for economic cost.',opening_original,round(opening_available,2),.5,round(opening_available*.5,4),.5,round(opening_original*.5,4),round(opening_available*.5,4),'SHADOW_PRICING_V1'),
 ('20000000-0000-4000-8000-000000020002','VND','PAYIN_INTERNAL_NETTING',null,round(payin_original*.5,2),round(payin_available*.5,2),null,0,'NOT_APPLICABLE','2026-07-17T00:00:00Z','OPEN','Aggregated Payin internal-netting source; external cash cost is zero but economic cost uses replacement rate.',payin_original,round(payin_available,2),.5,round(payin_available*.5,4),.5,round(payin_original*.5,4),round(payin_available*.5,4),'SHADOW_PRICING_V1')
 on conflict(id) do nothing;
 if adjustment_original>0 then
   insert into public.pool_buckets(id,currency,source_type,original_amount_vnd,available_amount_vnd,cost_basis_status,opened_at,status,notes,gross_original_amount_vnd,gross_available_amount_vnd,reserve_ratio,reserve_amount_vnd,settleable_ratio,settleable_original_amount_vnd,settleable_available_amount_vnd,balance_model_version)
   values('20000000-0000-4000-8000-000000020003','VND','ADJUSTMENT',round(adjustment_original*.5,2),round(adjustment_available*.5,2),'ESTIMATED','2026-07-17T00:00:00Z','OPEN','Reconstructed positive adjustments.',adjustment_original,round(adjustment_available,2),.5,round(adjustment_available*.5,4),.5,round(adjustment_original*.5,4),round(adjustment_available*.5,4),'SHADOW_PRICING_V1')
   on conflict(id) do nothing;
 end if;
end $$;

insert into public.payout_account_history_matches(payout_order_id,account_history_entry_id,match_method,match_confidence,amount_difference_vnd,time_difference_seconds,review_status,evidence)
select p.id,null,'NO_ACCOUNT_HISTORY_DATE_RANGE','NONE',null,null,'NO_MATCH',jsonb_build_object(
 'payout_local_date',(p.completed_at at time zone 'Asia/Shanghai')::date,
 'account_history_max_local','2026-07-18 23:59:28',
 'reason','Payout source begins after Account History cutoff; no verified match is possible',
 'order_number_match_count',0,'amount_time_match_count',0
)
from public.payout_orders p
on conflict(payout_order_id) do nothing;

insert into public.shadow_pricing_runs(id,run_type,rules_version,input_snapshot,data_cutoff_snapshot,status)
values('30000000-0000-4000-8000-000000020001','HISTORICAL_BACKTEST','SHADOW_PRICING_V1',
 jsonb_build_object('fee_rate',.005,'fee_rule_status','PENDING_CONFIRMATION','topup_timing_assumption','All DATE_ONLY topups available for partial scenario only'),
 jsonb_build_object('account_history_cutoff_local','2026-07-18 23:59:28 UTC+8','topup_cutoff','2026-07-20 DATE_ONLY','payout_cutoff_local','2026-07-20 23:59:55 UTC+8','completeness','PARTIAL_AFTER_ACCOUNT_HISTORY_CUTOFF'),
 'PARTIAL') on conflict(id) do nothing;

with active_buckets as (
 select b.*,coalesce(b.funding_rate_vnd_per_usdt,(select rate_vnd_per_usdt from public.rate_snapshots where approval_status='APPROVED' order by rate_date desc,created_at desc limit 1)) economic_rate,
        b.settleable_available_amount_vnd/sum(b.settleable_available_amount_vnd) over() allocation_ratio,
        row_number() over(order by b.id) bucket_number,count(*) over() bucket_count
 from public.pool_buckets b where b.status='OPEN' and b.settleable_available_amount_vnd>0
), payout_inputs as (
 select p.*,round(p.payout_amount_vnd*.005,2) estimated_fee_vnd,
        p.payout_amount_vnd+round(p.payout_amount_vnd*.005,2) estimated_gross_vnd
 from public.payout_orders p where p.status='SUCCESS'
), provisional as (
 select p.id payout_id,p.estimated_gross_vnd,b.*,
        trunc(p.estimated_gross_vnd*b.allocation_ratio,2) provisional_gross
 from payout_inputs p cross join active_buckets b
), allocated as (
 select *,case when bucket_number=bucket_count then estimated_gross_vnd-sum(provisional_gross) over(partition by payout_id)+provisional_gross else provisional_gross end allocated_gross
 from provisional
)
insert into public.payout_pool_allocations(payout_order_id,pool_bucket_id,source_type,balance_before_vnd,allocation_ratio,allocated_vnd,funding_rate_vnd_per_usdt,allocated_cost_usdt,cost_basis_status,pricing_run_id,account_history_entry_id,allocated_gross_outflow_vnd,allocated_settleable_impact_vnd,economic_rate_vnd_per_usdt,cost_method,external_cash_cost_usdt,economic_cost_usdt,internal_netting_advantage_usdt,cost_confidence,allocation_status,input_snapshot)
select payout_id,id,source_type,settleable_available_amount_vnd,allocation_ratio,allocated_gross,economic_rate,allocated_gross/economic_rate,
       case when source_type='TOPUP' then 'KNOWN'::public.cost_basis_status else 'ESTIMATED'::public.cost_basis_status end,
       '30000000-0000-4000-8000-000000020001',null,allocated_gross,round(allocated_gross*settleable_ratio,4),economic_rate,
       case when source_type='TOPUP' then 'ACTUAL_TOPUP' when source_type='PAYIN_INTERNAL_NETTING' then 'INTERNAL_NETTING_SHADOW' when source_type='OPENING' then 'OPENING_SHADOW' else 'MANUAL_APPROVED_RATE' end,
       case when source_type='TOPUP' then round(allocated_gross/nullif(funding_rate_vnd_per_usdt,0),8) else 0 end,
       round(allocated_gross/economic_rate,8),
       case when source_type='TOPUP' then round(allocated_gross/economic_rate-allocated_gross/nullif(funding_rate_vnd_per_usdt,0),8) else round(allocated_gross/economic_rate,8) end,
       case when source_type='TOPUP' then 'MEDIUM' else 'LOW' end,'ESTIMATED_OUTFLOW',
       jsonb_build_object('account_history_match','NO_ACCOUNT_HISTORY','payout_fee_rule','PENDING_CONFIRMATION','rate_precision','DATE_ONLY')
from allocated
on conflict(pricing_run_id,payout_order_id,pool_bucket_id) where pricing_run_id is not null do nothing;

with allocation_costs as (
 select payout_order_id,sum(external_cash_cost_usdt) external_cost,sum(economic_cost_usdt) economic_cost,sum(internal_netting_advantage_usdt) internal_advantage,
        sum(allocated_gross_outflow_vnd) gross_outflow,sum(allocated_settleable_impact_vnd) settleable_impact,
        sum(economic_cost_usdt)/nullif(sum(allocated_gross_outflow_vnd),0) cost_per_vnd
 from public.payout_pool_allocations where pricing_run_id='30000000-0000-4000-8000-000000020001' group by payout_order_id
)
insert into public.payout_profit_calculations(pricing_run_id,payout_order_id,account_history_entry_id,gross_outflow_vnd,settleable_impact_vnd,merchant_principal_vnd,payout_fee_vnd,payout_fee_status,received_usdt,company_borne_fee_usdt,external_cash_cost_usdt,economic_replacement_cost_usdt,internal_netting_advantage_usdt,economic_profit_usdt,economic_profit_margin,realized_profit_status,profit_verification_status,data_completeness_status,current_manual_as_rate,ar_rate,as_rate,ap_imported,ap_calculated,aq_imported,minimum_margin_quote,target_margin_quote,issue_codes,calculation_snapshot)
select '30000000-0000-4000-8000-000000020001',p.id,null,a.gross_outflow,a.settleable_impact,p.payout_amount_vnd,round(p.payout_amount_vnd*.005,2),'PENDING_RULE_ESTIMATE',p.received_usdt,p.total_fee_usdt,a.external_cost,a.economic_cost,a.internal_advantage,
       p.received_usdt-p.total_fee_usdt-a.economic_cost,(p.received_usdt-p.total_fee_usdt-a.economic_cost)/nullif(p.received_usdt,0),
       'NOT_FULLY_VERIFIED','ESTIMATED','MULTIPLE_ISSUES',p.payout_amount_vnd/nullif(p.received_usdt,0),
       1/nullif(p.fiat_dcc_rate_before,0),1/nullif(p.fiat_dcc_rate_after,0),p.fiat_dcc_percentage,
       (1/nullif(p.fiat_dcc_rate_after,0))/(1/nullif(p.fiat_dcc_rate_before,0))-1,p.fiat_dcc_random_percentage,
       (((p.received_usdt*(1-.002)-p.total_fee_usdt)/a.cost_per_vnd)/(1+.005))/nullif(p.received_usdt,0),
       (((p.received_usdt*(1-.005)-p.total_fee_usdt)/a.cost_per_vnd)/(1+.005))/nullif(p.received_usdt,0),
       jsonb_build_array('NO_ACCOUNT_HISTORY','PARTIAL_AFTER_ACCOUNT_HISTORY_CUTOFF','DATE_ONLY_RATE','PENDING_FEE_RULE','NO_NET_SETTLEMENT'),
       jsonb_build_object('aq_relationship','RELATIONSHIP_PENDING_CONFIRMATION','rate_direction','VND_PER_USDT','shadow_mode',true)
from public.payout_orders p join allocation_costs a on a.payout_order_id=p.id
on conflict(pricing_run_id,payout_order_id) do nothing;

insert into public.daily_portfolio_summaries(pricing_run_id,summary_date,backtest_window,payout_economic_profit_usdt,external_topup_cash_cost_usdt,internal_netting_advantage_usdt,verified_count,partial_count,estimated_count,not_calculable_count,below_minimum_margin_count,at_or_above_target_margin_count,gross_balance_vnd,reserve_balance_vnd,settleable_balance_vnd,data_cutoff_snapshot)
select '30000000-0000-4000-8000-000000020001',(p.completed_at at time zone 'Asia/Shanghai')::date,'PARTIAL_AFTER_ACCOUNT_HISTORY_CUTOFF',
 sum(c.economic_profit_usdt),sum(c.external_cash_cost_usdt),sum(c.internal_netting_advantage_usdt),
 count(*) filter(where c.profit_verification_status='VERIFIED'),count(*) filter(where c.profit_verification_status='PARTIAL'),count(*) filter(where c.profit_verification_status='ESTIMATED'),count(*) filter(where c.profit_verification_status='NOT_CALCULABLE'),
 count(*) filter(where c.economic_profit_margin<.002),count(*) filter(where c.economic_profit_margin>=.005),
 17725938423,8862969211.5,8862969211.5,
 jsonb_build_object('account_history_cutoff','2026-07-18 23:59:28 UTC+8','payout_cutoff','2026-07-20 23:59:55 UTC+8','completeness','PARTIAL_AFTER_ACCOUNT_HISTORY_CUTOFF')
from public.payout_profit_calculations c join public.payout_orders p on p.id=c.payout_order_id
where c.pricing_run_id='30000000-0000-4000-8000-000000020001'
group by (p.completed_at at time zone 'Asia/Shanghai')::date
on conflict(pricing_run_id,summary_date) do nothing;

insert into public.daily_portfolio_summaries(pricing_run_id,summary_date,backtest_window,payin_fee_revenue_vnd,payin_upstream_fee_vnd,payin_net_fee_contribution_vnd,data_cutoff_snapshot)
select '30000000-0000-4000-8000-000000020001',source_local_time::date,'VERIFIED_WINDOW',
 sum(gross_order_amount_vnd*.008),count(*)*2500,sum(gross_order_amount_vnd*.008)-count(*)*2500,
 jsonb_build_object('account_history_cutoff','2026-07-18 23:59:28 UTC+8','completeness','COMPLETE_TO_ACCOUNT_HISTORY_CUTOFF')
from public.account_history_entries where event_type='PAYIN_INFLOW' and source_local_time<'2026-07-19'
group by source_local_time::date
on conflict(pricing_run_id,summary_date) do update set payin_fee_revenue_vnd=excluded.payin_fee_revenue_vnd,payin_upstream_fee_vnd=excluded.payin_upstream_fee_vnd,payin_net_fee_contribution_vnd=excluded.payin_net_fee_contribution_vnd;

alter table public.payout_account_history_matches enable row level security;
alter table public.rate_snapshots enable row level security;
alter table public.shadow_pricing_runs enable row level security;
alter table public.shadow_pricing_results enable row level security;
alter table public.payout_profit_calculations enable row level security;
alter table public.daily_portfolio_summaries enable row level security;

create policy read_authenticated on public.payout_account_history_matches for select to authenticated using(true);
create policy read_authenticated on public.rate_snapshots for select to authenticated using(true);
create policy read_authenticated on public.shadow_pricing_runs for select to authenticated using(true);
create policy read_authenticated on public.shadow_pricing_results for select to authenticated using(true);
create policy read_authenticated on public.payout_profit_calculations for select to authenticated using(true);
create policy read_authenticated on public.daily_portfolio_summaries for select to authenticated using(true);
create policy operator_shadow_runs on public.shadow_pricing_runs for insert to authenticated with check(public.has_role('settlement_operator') or public.has_role('admin'));
create policy operator_shadow_results on public.shadow_pricing_results for insert to authenticated with check(public.has_role('settlement_operator') or public.has_role('admin'));
create policy approver_rate_snapshots on public.rate_snapshots for all to authenticated using(public.has_role('approver') or public.has_role('admin')) with check(public.has_role('approver') or public.has_role('admin'));
create policy approver_matches on public.payout_account_history_matches for update to authenticated using(public.has_role('approver') or public.has_role('admin')) with check(public.has_role('approver') or public.has_role('admin'));

grant select on public.payout_account_history_matches,public.rate_snapshots,public.shadow_pricing_runs,public.shadow_pricing_results,public.payout_profit_calculations,public.daily_portfolio_summaries to authenticated;
grant insert on public.shadow_pricing_runs,public.shadow_pricing_results to authenticated;
grant usage,select on sequence public.shadow_pricing_runs_run_version_seq to authenticated;
grant update on public.payout_account_history_matches to authenticated;
grant select,insert,update on public.rate_snapshots to authenticated;

insert into public.audit_logs(action,entity_type,entity_id,after_state,metadata)
values('CREATE_SHADOW_PRICING_MODEL','pricing_run','30000000-0000-4000-8000-000000020001',
 jsonb_build_object('mode','SHADOW','rules_version','SHADOW_PRICING_V1','automatic_funds_actions',false),
 jsonb_build_object('account_history_matches',0,'payout_data_status','PARTIAL_AFTER_ACCOUNT_HISTORY_CUTOFF','realized_profit_status','NOT_FULLY_VERIFIED'));

-- Security assertions fail the migration if has_role regresses.
do $$
declare public_definer boolean; private_search_path text;
begin
 select prosecdef into public_definer from pg_proc where oid='public.has_role(public.app_role)'::regprocedure;
 if public_definer then raise exception 'PUBLIC_HAS_ROLE_MUST_BE_SECURITY_INVOKER'; end if;
 select array_to_string(proconfig,',') into private_search_path from pg_proc where oid='private.has_role(public.app_role)'::regprocedure;
 if private_search_path not in ('search_path=','search_path=""') then raise exception 'PRIVATE_HAS_ROLE_SEARCH_PATH_NOT_FIXED'; end if;
 if has_function_privilege('anon','public.has_role(public.app_role)','EXECUTE') then raise exception 'ANON_MUST_NOT_EXECUTE_HAS_ROLE'; end if;
end $$;
