-- Task 2 audit hardening: versioned Shadow results are append-only.
create or replace function private.reject_shadow_pricing_mutation()
returns trigger
language plpgsql
security invoker
set search_path=''
as $$
begin
  raise exception 'SHADOW_PRICING_RECORDS_ARE_IMMUTABLE_CREATE_A_NEW_RUN';
end $$;

create trigger shadow_runs_immutable
before update or delete on public.shadow_pricing_runs
for each row execute function private.reject_shadow_pricing_mutation();

create trigger shadow_results_immutable
before update or delete on public.shadow_pricing_results
for each row execute function private.reject_shadow_pricing_mutation();

create trigger payout_profit_calculations_immutable
before update or delete on public.payout_profit_calculations
for each row execute function private.reject_shadow_pricing_mutation();

create trigger daily_portfolio_summaries_immutable
before update or delete on public.daily_portfolio_summaries
for each row execute function private.reject_shadow_pricing_mutation();

create or replace function private.reject_versioned_allocation_mutation()
returns trigger
language plpgsql
security invoker
set search_path=''
as $$
begin
  if old.pricing_run_id is not null then
    raise exception 'VERSIONED_PAYOUT_ALLOCATIONS_ARE_IMMUTABLE_CREATE_A_NEW_RUN';
  end if;
  return old;
end $$;

create trigger versioned_payout_allocations_immutable
before update or delete on public.payout_pool_allocations
for each row execute function private.reject_versioned_allocation_mutation();

do $$
begin
  if not exists(select 1 from pg_trigger where tgname='shadow_runs_immutable' and not tgisinternal) then
    raise exception 'SHADOW_RUN_IMMUTABILITY_TRIGGER_MISSING';
  end if;
  if exists(
    select 1 from pg_policies
    where schemaname='public' and tablename in ('shadow_pricing_runs','shadow_pricing_results','payout_profit_calculations','daily_portfolio_summaries')
      and cmd in ('UPDATE','DELETE','ALL')
  ) then
    raise exception 'SHADOW_VERSION_TABLES_MUST_NOT_HAVE_MUTATION_POLICIES';
  end if;
end $$;
