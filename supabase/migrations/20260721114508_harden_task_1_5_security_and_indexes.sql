-- Task 1.5 post-import hardening. No data mutation.
revoke all on function public.rls_auto_enable() from public,anon,authenticated;

-- allocate_payout_from_pool is a shadow-ledger mutation and is not exposed as a
-- signed-in client RPC. Server-side workflows may call it after authorization.
revoke all on function public.allocate_payout_from_pool(uuid) from authenticated;
grant execute on function public.allocate_payout_from_pool(uuid) to service_role;

alter policy roles_self_read on public.user_roles
  using (user_id=(select auth.uid()) or public.has_role('admin'));

create index if not exists payin_orders_import_batch_idx on public.payin_orders(import_batch_id);
create index if not exists payout_orders_import_batch_idx on public.payout_orders(import_batch_id);
create index if not exists account_history_import_batch_idx on public.account_history_entries(import_batch_id);
create index if not exists import_row_errors_batch_idx on public.import_row_errors(import_batch_id);
create index if not exists payout_allocations_bucket_idx on public.payout_pool_allocations(pool_bucket_id);
create index if not exists audit_logs_actor_idx on public.audit_logs(actor_id);
