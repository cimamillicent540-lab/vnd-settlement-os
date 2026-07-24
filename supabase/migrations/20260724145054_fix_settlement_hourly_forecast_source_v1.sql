-- Task 2.7 correction: forecast from actual Account History balance changes.
-- payin_orders.pool_inflow_vnd is not populated in the current source import.
-- Never substitute the Payin gross order amount for actual pool inflow.

create or replace view public.hourly_liquidity_forecast
with (security_invoker = true)
as
with event_dates as (
  select distinct
    (
      entry.transaction_time at time zone 'Asia/Shanghai'
    )::date as local_date
  from public.account_history_entries entry
  where entry.event_type in ('PAYIN_INFLOW', 'PAYOUT_OUTFLOW')
),
hours as (
  select generate_series(0, 23)::integer as local_hour
),
payin_daily as (
  select
    (
      entry.transaction_time at time zone 'Asia/Shanghai'
    )::date as local_date,
    extract(
      hour from entry.transaction_time at time zone 'Asia/Shanghai'
    )::integer as local_hour,
    sum(abs(entry.gross_change_vnd)) as payin_vnd
  from public.account_history_entries entry
  where entry.event_type = 'PAYIN_INFLOW'
  group by 1, 2
),
payout_daily as (
  select
    (
      entry.transaction_time at time zone 'Asia/Shanghai'
    )::date as local_date,
    extract(
      hour from entry.transaction_time at time zone 'Asia/Shanghai'
    )::integer as local_hour,
    sum(abs(entry.gross_change_vnd)) as payout_vnd
  from public.account_history_entries entry
  where entry.event_type = 'PAYOUT_OUTFLOW'
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

comment on view public.hourly_liquidity_forecast is
  'Uses actual Account History gross_change_vnd for Payin/Payout; never uses Payin gross order amount.';
