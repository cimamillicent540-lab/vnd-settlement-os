-- Task 1.5 enum expansion is isolated because PostgreSQL requires newly added
-- enum values to be committed before later migrations can use them.
alter type public.source_type add value if not exists 'PAYIN_INTERNAL_NETTING';
alter type public.cost_basis_status add value if not exists 'NOT_APPLICABLE';
