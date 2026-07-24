-- Task 2.6 performance hardening for foreign-key lookups.

create index if not exists payment_template_created_by_idx
  on public.payment_template_versions(created_by)
  where created_by is not null;
create index if not exists payment_template_approved_by_idx
  on public.payment_template_versions(approved_by)
  where approved_by is not null;

create index if not exists payout_beneficiaries_verified_by_idx
  on public.payout_beneficiaries(verified_by)
  where verified_by is not null;
create index if not exists payout_beneficiaries_created_by_idx
  on public.payout_beneficiaries(created_by)
  where created_by is not null;
create index if not exists payout_beneficiaries_updated_by_idx
  on public.payout_beneficiaries(updated_by)
  where updated_by is not null;

create index if not exists payment_checks_template_idx
  on public.payment_execution_checks(template_version_id)
  where template_version_id is not null;
create index if not exists payment_checks_created_by_idx
  on public.payment_execution_checks(created_by)
  where created_by is not null;

create index if not exists payment_export_batches_template_idx
  on public.payment_export_batches(template_version_id);
create index if not exists payment_export_batches_created_by_idx
  on public.payment_export_batches(created_by);

create index if not exists payment_export_items_readiness_idx
  on public.payment_export_items(readiness_check_id);
