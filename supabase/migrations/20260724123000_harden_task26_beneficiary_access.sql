-- Restricted beneficiary PII is readable only by operators who prepare files.
-- Approvers can review masked readiness snapshots and export audit records.

drop policy if exists payout_beneficiary_read
  on public.payout_beneficiaries;
create policy payout_beneficiary_read
on public.payout_beneficiaries
for select to authenticated
using (
  public.has_role('admin')
  or public.has_role('settlement_operator')
);
