-- Task 2.5 resumable import repair.
-- A regular UNIQUE constraint permits multiple NULLs and is addressable by
-- PostgREST ON CONFLICT, unlike the existing partial unique index.

alter table public.net_settlements
  add constraint net_settlements_account_history_entry_unique
  unique (account_history_entry_id);
