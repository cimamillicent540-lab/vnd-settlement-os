-- Task 2.6 — Payout Execution Guard + upstream batch-template integration.
-- Shadow Mode only: this migration does not execute, schedule, or submit payments.

create table if not exists public.payment_template_versions (
  id uuid primary key default gen_random_uuid(),
  template_code text not null,
  version text not null,
  source_file_name text not null,
  source_file_hash text not null check (length(source_file_hash) = 64),
  main_sheet_name text not null,
  bank_sheet_name text not null,
  country_sheet_name text not null,
  instruction_text text not null,
  ordered_headers jsonb not null,
  source_bank_rows integer not null default 0 check (source_bank_rows >= 0),
  source_country_rows integer not null default 0 check (source_country_rows >= 0),
  source_example_rows_excluded integer not null default 0
    check (source_example_rows_excluded >= 0),
  status text not null default 'ACTIVE'
    check (status in ('DRAFT', 'ACTIVE', 'SUPERSEDED')),
  shadow_mode boolean not null default true check (shadow_mode),
  created_by uuid references auth.users(id),
  approved_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (template_code, version),
  unique (source_file_hash)
);

create table if not exists public.country_currency_reference (
  id uuid primary key default gen_random_uuid(),
  template_version_id uuid not null
    references public.payment_template_versions(id),
  country_code text not null,
  country_name text not null,
  currency text not null,
  source_row_number integer not null check (source_row_number > 0),
  status text not null default 'ACTIVE'
    check (status in ('ACTIVE', 'INACTIVE', 'REVIEW_REQUIRED')),
  created_at timestamptz not null default now(),
  unique (template_version_id, source_row_number),
  unique (template_version_id, country_code, currency)
);
create index if not exists country_currency_lookup_idx
  on public.country_currency_reference(country_code, currency)
  where status = 'ACTIVE';

create table if not exists public.bank_reference (
  id uuid primary key default gen_random_uuid(),
  template_version_id uuid not null
    references public.payment_template_versions(id),
  country_name text not null,
  country_code text not null,
  currency text,
  bank_code text not null,
  bank_name_en text not null,
  bank_name_local text,
  source_row_number integer not null check (source_row_number > 0),
  duplicate_group_key text,
  status text not null default 'ACTIVE'
    check (status in ('ACTIVE', 'INACTIVE', 'REVIEW_REQUIRED')),
  created_at timestamptz not null default now(),
  unique (template_version_id, source_row_number)
);
create index if not exists bank_reference_lookup_idx
  on public.bank_reference(country_code, bank_code, status);

create table if not exists public.payout_beneficiaries (
  id uuid primary key default gen_random_uuid(),
  payout_order_id uuid not null unique references public.payout_orders(id),
  transaction_type text not null default 'B2C',
  beneficiary_name text,
  beneficiary_account text,
  account_type text,
  bank_code text,
  country_code text,
  iban text,
  region text,
  province_state text,
  branch_name text,
  branch_code text,
  id_type text,
  id_number text,
  phone text,
  email text,
  bank_name text,
  remark text check (remark is null or char_length(remark) <= 30),
  source text not null default 'MANUAL'
    check (source in ('MANUAL', 'API', 'SECURE_IMPORT')),
  verification_status text not null default 'UNVERIFIED'
    check (verification_status in ('UNVERIFIED', 'VERIFIED', 'REJECTED')),
  data_classification text not null default 'RESTRICTED'
    check (data_classification = 'RESTRICTED'),
  verified_by uuid references auth.users(id),
  verified_at timestamptz,
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (transaction_type in ('B2C', 'B2B'))
);

create table if not exists public.payment_execution_checks (
  id uuid primary key default gen_random_uuid(),
  payout_order_id uuid not null references public.payout_orders(id),
  template_version_id uuid references public.payment_template_versions(id),
  rules_version text not null default 'VND_EXECUTION_GUARD_V1',
  check_status text not null
    check (check_status in ('READY', 'WARNING', 'BLOCKED')),
  risk_level text not null check (risk_level in ('LOW', 'MEDIUM', 'HIGH')),
  check_results jsonb not null,
  blocking_codes text[] not null default '{}',
  warning_codes text[] not null default '{}',
  payout_principal_vnd numeric(38,2) not null check (payout_principal_vnd >= 0),
  estimated_upstream_fee_vnd numeric(38,2) not null default 0
    check (estimated_upstream_fee_vnd >= 0),
  required_gross_debit_vnd numeric(38,2) not null
    check (required_gross_debit_vnd >= 0),
  available_settleable_balance_vnd numeric(38,2) not null
    check (available_settleable_balance_vnd >= 0),
  beneficiary_snapshot_masked jsonb not null default '{}'::jsonb,
  shadow_mode boolean not null default true check (shadow_mode),
  automatic_execution boolean not null default false
    check (automatic_execution = false),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists payment_checks_payout_created_idx
  on public.payment_execution_checks(payout_order_id, created_at desc);
create index if not exists payment_checks_status_idx
  on public.payment_execution_checks(check_status, created_at desc);

create table if not exists public.payment_export_batches (
  id uuid primary key default gen_random_uuid(),
  template_version_id uuid not null
    references public.payment_template_versions(id),
  currency text not null check (currency = 'VND'),
  order_count integer not null check (order_count > 0),
  total_payout_principal_vnd numeric(38,2) not null
    check (total_payout_principal_vnd > 0),
  estimated_gross_debit_vnd numeric(38,2) not null
    check (estimated_gross_debit_vnd > 0),
  settleable_balance_snapshot_vnd numeric(38,2) not null
    check (settleable_balance_snapshot_vnd >= 0),
  file_name text not null,
  file_hash text not null check (length(file_hash) = 64),
  status text not null default 'PREPARED'
    check (status in ('PREPARED', 'DOWNLOADED', 'VOIDED')),
  shadow_mode boolean not null default true check (shadow_mode),
  submitted_to_upstream boolean not null default false
    check (submitted_to_upstream = false),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (file_hash)
);

create table if not exists public.payment_export_items (
  id uuid primary key default gen_random_uuid(),
  export_batch_id uuid not null
    references public.payment_export_batches(id),
  payout_order_id uuid not null unique references public.payout_orders(id),
  readiness_check_id uuid not null
    references public.payment_execution_checks(id),
  export_row_number integer not null check (export_row_number >= 3),
  payout_principal_vnd numeric(38,2) not null check (payout_principal_vnd > 0),
  beneficiary_account_last4 text,
  created_at timestamptz not null default now(),
  unique (export_batch_id, export_row_number)
);

create or replace view public.payment_readiness_latest
with (security_invoker = true)
as
select distinct on (check_row.payout_order_id)
  check_row.*
from public.payment_execution_checks check_row
order by check_row.payout_order_id, check_row.created_at desc, check_row.id desc;

create or replace view public.payment_readiness_summary
with (security_invoker = true)
as
select
  check_status,
  risk_level,
  count(*) as order_count,
  sum(payout_principal_vnd) as payout_principal_vnd,
  sum(required_gross_debit_vnd) as required_gross_debit_vnd
from public.payment_readiness_latest
group by check_status, risk_level;

create or replace view public.payment_block_reason_summary
with (security_invoker = true)
as
select reason.code, count(*) as order_count
from public.payment_readiness_latest check_row
cross join lateral unnest(check_row.blocking_codes) as reason(code)
group by reason.code;

comment on table public.payout_beneficiaries is
  'Restricted payment-recipient data. UI must mask account, identity, phone, and email.';
comment on table public.payment_export_batches is
  'Shadow Mode batch-payment preparation only; no upstream submission capability.';

alter table public.payment_template_versions enable row level security;
alter table public.country_currency_reference enable row level security;
alter table public.bank_reference enable row level security;
alter table public.payout_beneficiaries enable row level security;
alter table public.payment_execution_checks enable row level security;
alter table public.payment_export_batches enable row level security;
alter table public.payment_export_items enable row level security;

create policy payment_template_read
on public.payment_template_versions
for select to authenticated using (true);
create policy country_reference_read
on public.country_currency_reference
for select to authenticated using (true);
create policy bank_reference_read
on public.bank_reference
for select to authenticated using (true);

create policy payout_beneficiary_read
on public.payout_beneficiaries
for select to authenticated
using (
  public.has_role('admin')
  or public.has_role('settlement_operator')
  or public.has_role('approver')
);
create policy payout_beneficiary_insert
on public.payout_beneficiaries
for insert to authenticated
with check (
  public.has_role('admin')
  or public.has_role('settlement_operator')
);
create policy payout_beneficiary_update
on public.payout_beneficiaries
for update to authenticated
using (
  public.has_role('admin')
  or public.has_role('settlement_operator')
)
with check (
  public.has_role('admin')
  or public.has_role('settlement_operator')
);

create policy payment_checks_read
on public.payment_execution_checks
for select to authenticated using (true);
create policy payment_checks_insert
on public.payment_execution_checks
for insert to authenticated
with check (
  public.has_role('admin')
  or public.has_role('settlement_operator')
);

create policy payment_exports_read
on public.payment_export_batches
for select to authenticated
using (
  public.has_role('admin')
  or public.has_role('settlement_operator')
  or public.has_role('approver')
);
create policy payment_exports_insert
on public.payment_export_batches
for insert to authenticated
with check (
  public.has_role('admin')
  or public.has_role('settlement_operator')
);
create policy payment_export_items_read
on public.payment_export_items
for select to authenticated
using (
  public.has_role('admin')
  or public.has_role('settlement_operator')
  or public.has_role('approver')
);
create policy payment_export_items_insert
on public.payment_export_items
for insert to authenticated
with check (
  public.has_role('admin')
  or public.has_role('settlement_operator')
);

grant select on public.payment_template_versions,
  public.country_currency_reference,
  public.bank_reference,
  public.payment_readiness_latest,
  public.payment_readiness_summary,
  public.payment_block_reason_summary
to authenticated;
grant select, insert, update on public.payout_beneficiaries to authenticated;
grant select, insert on public.payment_execution_checks,
  public.payment_export_batches,
  public.payment_export_items
to authenticated;
grant all on public.payment_template_versions,
  public.country_currency_reference,
  public.bank_reference,
  public.payout_beneficiaries,
  public.payment_execution_checks,
  public.payment_export_batches,
  public.payment_export_items
to service_role;

create or replace function private.audit_sensitive_beneficiary()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  insert into public.audit_logs(
    actor_id,
    action,
    entity_type,
    entity_id,
    metadata
  )
  values (
    auth.uid(),
    tg_op,
    tg_table_name,
    coalesce(new.id, old.id)::text,
    jsonb_build_object(
      'payout_order_id', coalesce(new.payout_order_id, old.payout_order_id),
      'restricted_fields_redacted', true,
      'account_last4',
        right(coalesce(new.beneficiary_account, old.beneficiary_account, ''), 4),
      'verification_status',
        coalesce(new.verification_status, old.verification_status)
    )
  );
  return coalesce(new, old);
end
$$;

drop trigger if exists audit_payout_beneficiary
  on public.payout_beneficiaries;
create trigger audit_payout_beneficiary
after insert or update or delete on public.payout_beneficiaries
for each row execute function private.audit_sensitive_beneficiary();

create trigger audit_payment_execution_checks
after insert on public.payment_execution_checks
for each row execute function public.audit_mutation();
create trigger audit_payment_export_batches
after insert or update on public.payment_export_batches
for each row execute function public.audit_mutation();
create trigger audit_payment_export_items
after insert on public.payment_export_items
for each row execute function public.audit_mutation();

create or replace function private.register_payment_export(
  requested_template_version_id uuid,
  requested_file_name text,
  requested_file_hash text,
  requested_settleable_balance_vnd numeric,
  requested_items jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  item_count integer;
  valid_item_count integer;
  distinct_payout_count integer;
  total_principal numeric(38,2);
  total_required numeric(38,2);
  current_settleable_balance numeric(38,2);
  new_batch_id uuid;
begin
  if not (
    public.has_role('admin')
    or public.has_role('settlement_operator')
  ) then
    raise exception 'INSUFFICIENT_ROLE';
  end if;
  if requested_file_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'INVALID_FILE_HASH';
  end if;
  if jsonb_typeof(requested_items) <> 'array' then
    raise exception 'INVALID_EXPORT_ITEMS';
  end if;

  select
    count(*),
    count(distinct item.payout_order_id),
    coalesce(sum(item.payout_principal_vnd), 0)::numeric(38,2)
  into item_count, distinct_payout_count, total_principal
  from jsonb_to_recordset(requested_items) as item(
    payout_order_id uuid,
    readiness_check_id uuid,
    export_row_number integer,
    payout_principal_vnd numeric,
    beneficiary_account_last4 text
  );
  if item_count = 0 or distinct_payout_count <> item_count then
    raise exception 'EMPTY_OR_DUPLICATE_EXPORT_ITEMS';
  end if;

  select
    count(*),
    coalesce(sum(check_row.required_gross_debit_vnd), 0)::numeric(38,2)
  into valid_item_count, total_required
  from jsonb_to_recordset(requested_items) as item(
    payout_order_id uuid,
    readiness_check_id uuid,
    export_row_number integer,
    payout_principal_vnd numeric,
    beneficiary_account_last4 text
  )
  join public.payment_readiness_latest check_row
    on check_row.payout_order_id = item.payout_order_id
    and check_row.id = item.readiness_check_id
    and check_row.check_status = 'READY'
    and check_row.automatic_execution = false
  where item.export_row_number >= 3
    and item.payout_principal_vnd = check_row.payout_principal_vnd
    and not exists (
      select 1
      from public.payment_export_items existing
      where existing.payout_order_id = item.payout_order_id
    );
  if valid_item_count <> item_count then
    raise exception 'EXPORT_ITEM_NOT_READY_OR_ALREADY_EXPORTED';
  end if;
  select coalesce(sum(settleable_available_amount_vnd), 0)::numeric(38,2)
  into current_settleable_balance
  from public.pool_buckets
  where currency = 'VND' and status = 'OPEN';
  if abs(current_settleable_balance - requested_settleable_balance_vnd) > 0.01 then
    raise exception 'STALE_SETTLEABLE_BALANCE_SNAPSHOT';
  end if;
  if total_required > current_settleable_balance then
    raise exception 'INSUFFICIENT_BATCH_SETTLEABLE_BALANCE';
  end if;

  insert into public.payment_export_batches(
    template_version_id,
    currency,
    order_count,
    total_payout_principal_vnd,
    estimated_gross_debit_vnd,
    settleable_balance_snapshot_vnd,
    file_name,
    file_hash,
    status,
    shadow_mode,
    submitted_to_upstream,
    created_by
  )
  values (
    requested_template_version_id,
    'VND',
    item_count,
    total_principal,
    total_required,
    current_settleable_balance,
    requested_file_name,
    requested_file_hash,
    'PREPARED',
    true,
    false,
    auth.uid()
  )
  returning id into new_batch_id;

  insert into public.payment_export_items(
    export_batch_id,
    payout_order_id,
    readiness_check_id,
    export_row_number,
    payout_principal_vnd,
    beneficiary_account_last4
  )
  select
    new_batch_id,
    item.payout_order_id,
    item.readiness_check_id,
    item.export_row_number,
    item.payout_principal_vnd,
    item.beneficiary_account_last4
  from jsonb_to_recordset(requested_items) as item(
    payout_order_id uuid,
    readiness_check_id uuid,
    export_row_number integer,
    payout_principal_vnd numeric,
    beneficiary_account_last4 text
  );

  return new_batch_id;
end
$$;
revoke all on function private.register_payment_export(
  uuid,text,text,numeric,jsonb
) from public,anon;
grant execute on function private.register_payment_export(
  uuid,text,text,numeric,jsonb
) to authenticated,service_role;

create or replace function public.register_payment_export(
  requested_template_version_id uuid,
  requested_file_name text,
  requested_file_hash text,
  requested_settleable_balance_vnd numeric,
  requested_items jsonb
)
returns uuid
language sql
security invoker
set search_path = public, private
as $$
  select private.register_payment_export(
    requested_template_version_id,
    requested_file_name,
    requested_file_hash,
    requested_settleable_balance_vnd,
    requested_items
  )
$$;
revoke all on function public.register_payment_export(
  uuid,text,text,numeric,jsonb
) from public,anon;
grant execute on function public.register_payment_export(
  uuid,text,text,numeric,jsonb
) to authenticated,service_role;

insert into public.payment_template_versions(
  template_code,
  version,
  source_file_name,
  source_file_hash,
  main_sheet_name,
  bank_sheet_name,
  country_sheet_name,
  instruction_text,
  ordered_headers,
  source_bank_rows,
  source_country_rows,
  source_example_rows_excluded,
  status,
  shadow_mode
)
values (
  'LOCAL_BATCH_PAYMENT',
  'LOCAL_BATCH_PAYMENT_V1',
  'Batch Payment Templates_Local (1).xlsx',
  '49cafd91f2f9954ff1245ff38bd97b1d2b805290369eaeed606049a538bc70bf',
  '批量模板',
  '银行编码',
  '国家编码',
  '19-field upstream batch-payment workbook; examples excluded.',
  '["*交易类型","*代付币种","*到账金额","*收款账户名称","*收款账号","*收款账户类型","*银行编码/电子钱包编码","*国家编码","IBAN","地区","省/州","支行名称","支行编号","证件类型","证件号","手机号","邮箱","银行名称","附言"]'::jsonb,
  1556,
  35,
  2,
  'ACTIVE',
  true
)
on conflict (template_code, version) do nothing;

with template as (
  select id
  from public.payment_template_versions
  where template_code = 'LOCAL_BATCH_PAYMENT'
    and version = 'LOCAL_BATCH_PAYMENT_V1'
)
insert into public.country_currency_reference(
  template_version_id,
  country_code,
  country_name,
  currency,
  source_row_number
)
select template.id, values_row.country_code, values_row.country_name,
  values_row.currency, values_row.source_row_number
from template
cross join (
  values
    ('IDN','印度尼西亚','IDR',2), ('PHL','菲律宾','PHP',3),
    ('VNM','越南','VND',4), ('NGA','尼日利亚','NGN',5),
    ('THA','泰国','THB',6), ('BRA','巴西','BRL',7),
    ('TWN','台湾','TWD',8), ('MYS','马来西亚','MYR',9),
    ('EGY','埃及','EGP',10), ('JPN','日本','JPY',11),
    ('ARE','阿联酋','AED',12), ('HKG','中国香港','HKD/USD',13),
    ('PAK','巴基斯坦','PKR',14), ('BGD','孟加拉国','BDT',15),
    ('SAU','沙特阿拉伯','SAR',16), ('KEN','肯尼亚','KES',17),
    ('GHA','加纳','GHS',18), ('IND','印度','INR',19),
    ('KOR','韩国','KRW',20), ('RUS','俄罗斯','RUB',21),
    ('EU','欧盟','EUR',22), ('USA','美国','USD',23),
    ('UGA','乌干达','UGX',24), ('TZA','坦桑尼亚','TZS',25),
    ('CMR','喀麦隆','XAF',26), ('MEX','墨西哥','MXN',27),
    ('COL','哥伦比亚','COP',28), ('PER','秘鲁','PEN',29),
    ('CHL','智利','CLP',30), ('ARG','阿根廷','ARS',31),
    ('ECU','厄瓜多尔','USD',32), ('CIV','科特迪瓦','XOF',33),
    ('ZMB','赞比亚','ZMW',34), ('ETH','埃塞俄比亚','ETB',35),
    ('RWA','卢旺达','RWF',36)
) as values_row(country_code, country_name, currency, source_row_number)
on conflict (template_version_id, country_code, currency) do nothing;

-- V1 embeds all 40 VND bank codes for immediate readiness checks.
-- The companion importer loads the complete 1,556-row appendix for future currencies.
with template as (
  select id
  from public.payment_template_versions
  where template_code = 'LOCAL_BATCH_PAYMENT'
    and version = 'LOCAL_BATCH_PAYMENT_V1'
)
insert into public.bank_reference(
  template_version_id,
  country_name,
  country_code,
  currency,
  bank_code,
  bank_name_en,
  bank_name_local,
  source_row_number
)
select template.id, '越南', 'VNM', 'VND', row_data.bank_code,
  row_data.bank_name_en, row_data.bank_name_local, row_data.source_row_number
from template
cross join (
  values
    ('ABB','An Binh Commercial Joint Stock Bank (AnBinh Bank)','NGAN HANG TMCP AN BINH (ABBANK)',287),
    ('ACB','Asia Commercial Bank (ACB)','NGAN HANG TMCP A CHAU (ACB)',288),
    ('GPB','Global Petro Sole Member Limited Commercial Bank (GPBank)','NGAN HANG TMCP DAU KHI TOAN CAU (GPB)',289),
    ('HDB','Ho Chi Minh City Development Joint Stock Commercial Bank (HDBank)','NGAN HANG TMCP PHAT TRIEN TP.HCM (HDB)',290),
    ('VCB','Joint Stock Commercial Bank for Foreign Trade of Vietnam (Vietcombank)','NGAN HANG TMCP NGOAI THUONG VIET NAM (VIETCOMBANK)',291),
    ('KLB','Kien Long Commercial Joint Stock Bank (KienLong Bank)','NGAN HANG TMCP KIEN LONG (KIENLONGBANK)',292),
    ('LPB','Lien Viet Post Joint Stock Commercial Bank (LienViet Bank)','NGAN HANG LIEN DOANH VIET NGA (VRB)',293),
    ('OCEANBANK','Ocean Commercial One Member Limited Liability Bank (OceanBank)','NGAN HANG TMCP DAI DUONG (OCEANBANK)',294),
    ('PGB','Petrolimex Group Commercial Joint Stock Bank (PG Bank)','NGAN HANG TMCP XANG DAU PETROLIMEX (PG BANK)',295),
    ('SHB','Saigon - Hanoi Commercial Joint Stock Bank (SHB)','NGAN HANG TMCP SAI GON HA NOI (SHB)',296),
    ('SGICB','Saigon Bank for Industry and Trade (SaigonBank)','NGAN HANG TMCP SAI GON CONG THUONG (SAIGONBANK)',297),
    ('STB','Saigon Thuong Tin Commercial Joint Stock Bank (SacomBank)','NGAN HANG TMCP SAI GON THUONG TIN (SACOMBANK)',298),
    ('SEAB','Southeast Asia Commercial Joint Stock Bank (SeaBank)','NGAN HANG TMCP DONG NAM A (SEABANK)',299),
    ('TPB','Tienphong commercial Joint Stock Bank (TienPhong Bank)','NGAN HANG TMCP TIEN PHONG (TPBANK)',300),
    ('VIB','Vietnam International Commercial Joint Stock Bank (VIB)','NGAN HANG TMCP QUOC TE VIB',301),
    ('ICB','Vietnam Joint Stock Commercial Bank for Intrustry and Trade (VietinBank)','NGAN HANG TMCP CONG THUONG VIET NAM (VIETINBANK)',302),
    ('VPB','Vietnam Prosperity Joint Stock Commercial Bank (VPBank)','NGAN HANG TMCP VIET NAM THINH VUONG (VPBANK)',303),
    ('TCB','Vietnam Technological and commercial Joint Stock Bank (Techcom Bank)','NGAN HANG TMCP KY THUONG VIET NAM (TECHCOMBANK)',304),
    ('BIDV','Bank for Investment and Development of Vietnam Joint Stock Commercial Bank (BIDV)','NGAN HANG TMCP DAU TU VA PHAT TRIEN VIET NAM (BIDV)',305),
    ('MSB','Vietnam Maritime Commercial Joint Stock Bank (Maritime Bank)','NGAN HANG TMCP HANG HAI VIET NAM (MSB)',306),
    ('NAB','Nam A Commercial Joint Stock Bank (NamA Bank)','NGAN HANG TMCP NAM A (NAMABANK)',307),
    ('MB','Military Commercial Joint Stock bank (MB)','NGAN HANG TMCP QUAN DOI (MB)',308),
    ('VBA','Vietnam Bank for Agriculture and Rural Development (AgriBank)','NGAN HANG NN VA PTNT VIETNAM (AGRIBANK)',309),
    ('DOB','Dong A Joint Stock Commercial Bank (DongA Bank)','NGAN HANG TMCP DONG A (DONGABANK)',310),
    ('EIB','Vietnam Export Import Commercial Joint Stock Bank (EximBank)','NGAN HANG TMCP XUAT NHAP KHAU VIET NAM (EXIMBANK)',311),
    ('VCCB','Viet Capital Joint Stock Commercial Bank (Viet Capital Bank)','NGAN HANG TMCP BAN VIET (VIETCAPITAL BANK)',312),
    ('OCB','Orient Commercial Bank (OCB)','NGAN HANG TMCP PHUONG DONG (OCB)',313),
    ('VAB','Viet A Joint Stock Commercial Bank (Viet A Bank)','NGAN HANG TMCP VIET A (VAB)',314),
    ('VIETBANK','Vietnam Thuong Tin Commercial Joint Stock Bank (Vietbank)','NGAN HANG TMCP VIET NAM THUONG TIN (VIETBANK)',315),
    ('BVB','BaoViet Commercial Joint Stock Bank (BaoViet Bank)','NGAN HANG TMCP BAO VIET (BVB)',316),
    ('PVCB','Vietnam Public Joint Stock Commercial Bank (PVcomBank)','NGAN HANG TMCP DAI CHUNG VIET NAM (PVCOMBANK)',317),
    ('PBVN','Public Bank Vietnam Limited (Public Bank)','NGAN HANG TNHH MTV PUBLIC VIET NAM (PBVN)',318),
    ('IVB','Indovina Bank','NGAN HANG TNHH INDOVINA',319),
    ('VRB','Vietnam Russia Joint Venture Bank (VR Bank)','NGAN HANG LIEN DOANH VIET NGA (VRB)',320),
    ('HLBVN','Hong Leong Bank Vietnam','NGAN HANG TNHH MTV HONGLEONG VIET NAM',321),
    ('SHBVN','Shinhan Bank Vietnam (SHBVN)','NGAN HANG TNHH MTV SHINHAN VIET NAM (SHBVN)',322),
    ('WVN','Woori Bank','NGAN HANG WOORIBANK',323),
    ('NCB','National Citizen Commercial Joint Stock Bank (NCB)','NGAN HANG TMCP QUOC DAN (NCB)',324),
    ('CIMB','Cimb Bank (Vietnam) Limited','NGAN HANG TNHH MTV CIMB (CIMB)',325),
    ('UOB','United Overseas Bank (Vietnam) Limited','NGAN HANG TNHH MTV UNITED OVERSEAS BANK (UOB)',326)
) as row_data(bank_code, bank_name_en, bank_name_local, source_row_number)
on conflict (template_version_id, source_row_number) do nothing;

-- Existing records are completed historical payouts. Seed a versioned guard result
-- so they are visibly blocked from being paid a second time.
with template as (
  select id
  from public.payment_template_versions
  where template_code = 'LOCAL_BATCH_PAYMENT'
    and version = 'LOCAL_BATCH_PAYMENT_V1'
),
balance as (
  select coalesce(sum(settleable_available_amount_vnd), 0)::numeric(38,2)
    as available_settleable_balance_vnd
  from public.pool_buckets
  where currency = 'VND' and status = 'OPEN'
)
insert into public.payment_execution_checks(
  payout_order_id,
  template_version_id,
  check_status,
  risk_level,
  check_results,
  blocking_codes,
  warning_codes,
  payout_principal_vnd,
  estimated_upstream_fee_vnd,
  required_gross_debit_vnd,
  available_settleable_balance_vnd,
  beneficiary_snapshot_masked,
  shadow_mode,
  automatic_execution
)
select
  payout.id,
  template.id,
  'BLOCKED',
  'HIGH',
  jsonb_build_array(
    jsonb_build_object(
      'code', 'ALREADY_COMPLETED',
      'severity', 'BLOCKED',
      'message', 'Historical completed payout; re-export is prohibited.'
    ),
    jsonb_build_object(
      'code', 'MISSING_BENEFICIARY_ACCOUNT',
      'severity', 'BLOCKED',
      'message', 'No restricted beneficiary record is linked.'
    )
  ),
  array['ALREADY_COMPLETED','MISSING_BENEFICIARY_ACCOUNT']::text[],
  '{}'::text[],
  payout.payout_amount_vnd,
  round(payout.payout_amount_vnd * 0.005, 2),
  round(payout.payout_amount_vnd * 1.005, 2),
  balance.available_settleable_balance_vnd,
  '{}'::jsonb,
  true,
  false
from public.payout_orders payout
cross join template
cross join balance
where upper(payout.status) in ('SUCCESS', 'COMPLETED', 'PAID')
  and not exists (
    select 1 from public.payment_execution_checks existing
    where existing.payout_order_id = payout.id
      and existing.rules_version = 'VND_EXECUTION_GUARD_V1'
  );
