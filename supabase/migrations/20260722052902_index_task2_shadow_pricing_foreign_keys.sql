-- Keep the Task 2 foreign-key checks index-backed without changing business data.
create index if not exists payout_matches_matched_by_idx
  on public.payout_account_history_matches(matched_by)
  where matched_by is not null;

create index if not exists payout_allocations_payout_order_idx
  on public.payout_pool_allocations(payout_order_id);

create index if not exists payout_profit_account_history_idx
  on public.payout_profit_calculations(account_history_entry_id)
  where account_history_entry_id is not null;

create index if not exists rate_snapshots_entered_by_idx
  on public.rate_snapshots(entered_by)
  where entered_by is not null;

create index if not exists rate_snapshots_approved_by_idx
  on public.rate_snapshots(approved_by)
  where approved_by is not null;

create index if not exists shadow_pricing_runs_created_by_idx
  on public.shadow_pricing_runs(created_by)
  where created_by is not null;

-- Split the approver mutation policy so it does not create a second SELECT path.
drop policy if exists approver_rate_snapshots on public.rate_snapshots;

create policy approver_insert_rate_snapshots
on public.rate_snapshots
for insert
to authenticated
with check(public.has_role('approver') or public.has_role('admin'));

create policy approver_update_rate_snapshots
on public.rate_snapshots
for update
to authenticated
using(public.has_role('approver') or public.has_role('admin'))
with check(public.has_role('approver') or public.has_role('admin'));

do $$
begin
  if exists(
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'rate_snapshots'
      and policyname = 'approver_rate_snapshots'
  ) then
    raise exception 'BROAD_RATE_SNAPSHOT_POLICY_MUST_BE_REMOVED';
  end if;
end $$;
