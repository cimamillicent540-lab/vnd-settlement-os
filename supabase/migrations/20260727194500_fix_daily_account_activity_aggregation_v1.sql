-- Task 2.11 correction — aggregate Account History in Postgres before the
-- Data API row limit is applied. Raw Account History remains unchanged.

create or replace view public.settlement_daily_account_activity
with (security_invoker = true)
as
select
  (
    entry.transaction_time at time zone 'Asia/Shanghai'
  )::date as operating_date,
  count(*)::bigint as account_event_count,
  count(*) filter (
    where entry.event_type = 'PAYIN_INFLOW'
  )::bigint as payin_event_count,
  count(*) filter (
    where entry.event_type = 'PAYOUT_OUTFLOW'
  )::bigint as payout_event_count,
  coalesce(
    sum(entry.gross_change_vnd) filter (
      where entry.event_type = 'PAYIN_INFLOW'
    ),
    0
  )::numeric(38,2) as today_payin_vnd,
  coalesce(
    sum(entry.gross_change_vnd) filter (
      where entry.event_type = 'PAYOUT_OUTFLOW'
    ),
    0
  )::numeric(38,2) as today_payout_vnd,
  coalesce(
    sum(entry.gross_signed_change_vnd),
    0
  )::numeric(38,2) as net_funds_change_vnd,
  min(entry.transaction_time) as first_event_at,
  max(entry.transaction_time) as last_event_at,
  'ACCOUNT_HISTORY_GROSS_CHANGE'::text as source_method
from public.account_history_entries entry
group by (
  entry.transaction_time at time zone 'Asia/Shanghai'
)::date;

revoke all on public.settlement_daily_account_activity from anon;
grant select on public.settlement_daily_account_activity
to authenticated, service_role;

comment on view public.settlement_daily_account_activity is
  'Complete daily Account History aggregation calculated before Data API pagination. Payin/Payout use original gross_change_vnd; net change uses gross_signed_change_vnd.';
