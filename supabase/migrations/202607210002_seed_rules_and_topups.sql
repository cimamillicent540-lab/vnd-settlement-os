insert into public.system_rules(rule_key,currency,numeric_value,text_value,effective_from,status) values
 ('vnd_payin_fee_rate','VND',0.008,null,'2026-07-21 00:00:00+00','ACTIVE'),
 ('vnd_payin_success_upstream_fee','VND',2500,null,'2026-07-21 00:00:00+00','ACTIVE'),
 ('vnd_payin_failure_upstream_fee','VND',0,null,'2026-07-21 00:00:00+00','ACTIVE'),
 ('vnd_internal_transfer_fee','VND',0,null,'2026-07-21 00:00:00+00','ACTIVE'),
 ('vnd_pool_low_threshold_usdt','USDT',50000,null,'2026-07-21 00:00:00+00','ACTIVE'),
 ('minimum_net_margin',null,0.002,null,'2026-07-21 00:00:00+00','ACTIVE'),
 ('target_net_margin',null,0.005,null,'2026-07-21 00:00:00+00','ACTIVE'),
 ('timezone',null,null,'UTC','2026-07-21 00:00:00+00','ACTIVE');

insert into public.topup_batches(id,execution_date,executed_at,time_precision,sequence_within_date,channel,usdt_spent,additional_fee_usdt,gross_vnd_received,additional_fee_vnd,stated_rate,rate_validation_status,remaining_vnd,notes,source,status) values
 ('00000000-0000-4000-8000-000000007191','2026-07-19',null,'DATE_ONLY',1,'OTC Desk A',150000,0,3938250000,0,26255,'MATCH',3938250000,'真实记录；执行时间仅精确到日期','VERIFIED_SEED','APPROVED'),
 ('00000000-0000-4000-8000-000000007192','2026-07-19',null,'DATE_ONLY',2,'OTC Desk A',150000,0,3938250000,0,26255,'MATCH',3938250000,'真实记录；执行时间仅精确到日期','VERIFIED_SEED','APPROVED'),
 ('00000000-0000-4000-8000-000000007201','2026-07-20',null,'DATE_ONLY',1,'OTC Desk B',250000,0,6657000000,0,26628,'MATCH',6657000000,'真实记录；执行时间仅精确到日期','VERIFIED_SEED','APPROVED');

insert into public.pool_buckets(source_type,source_reference_id,original_amount_vnd,available_amount_vnd,funding_rate_vnd_per_usdt,funding_cost_usdt,cost_basis_status,opened_at,status,notes)
select 'TOPUP',id,net_vnd_received,remaining_vnd,effective_rate_vnd_per_usdt,usdt_spent+additional_fee_usdt,'KNOWN',execution_date::timestamptz,'OPEN','日期级资金桶；opened_at 仅用于日序分析，不代表真实执行时刻'
from public.topup_batches where source='VERIFIED_SEED';

insert into public.pool_ledger_entries(event_time,event_date,time_precision,event_type,source_type,source_reference_id,amount_vnd,signed_amount_vnd,balance_before_vnd,balance_after_vnd,data_confidence,notes)
select null,execution_date,'DATE_ONLY','TOPUP_INFLOW','TOPUP',id,net_vnd_received,net_vnd_received,
 sum(net_vnd_received) over(order by execution_date,sequence_within_date)-net_vnd_received,
 sum(net_vnd_received) over(order by execution_date,sequence_within_date),'MEDIUM','种子补U；执行时间仅精确到日期'
from public.topup_batches where source='VERIFIED_SEED';
