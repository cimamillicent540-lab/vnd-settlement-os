-- Task 2.16 — VND Human Approval Center V1.
-- Phase 1 only: AI suggestions are queued for a human decision. Every
-- decision is append-only evidence and never executes a payment, topup,
-- quote change, trade, or other external financial action.

create table public.approval_reason_catalog (
  id uuid primary key default gen_random_uuid(),
  reason_code text not null unique
    check (reason_code ~ '^[A-Z][A-Z0-9_]{2,79}$'),
  reason_category text not null
    check (
      reason_category in (
        'COMMERCIAL',
        'FX',
        'RISK',
        'FUNDING',
        'PROFIT',
        'DATA',
        'OTHER'
      )
    ),
  display_name text not null
    check (char_length(btrim(display_name)) > 0),
  description text not null
    check (char_length(btrim(description)) > 0),
  applies_to text[] not null
    check (
      cardinality(applies_to) > 0
      and applies_to <@ array['TOPUP', 'QUOTE', 'RISK']::text[]
    ),
  requires_detail boolean not null default true
    check (requires_detail),
  catalog_version integer not null default 1
    check (catalog_version > 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.approval_reason_catalog (
  reason_code,
  reason_category,
  display_name,
  description,
  applies_to
)
values
  (
    'MARKET_COMPETITION',
    'COMMERCIAL',
    '市场竞争',
    '因市场竞争和外部报价变化调整人工决定。',
    array['QUOTE', 'RISK']::text[]
  ),
  (
    'MERCHANT_RELATIONSHIP',
    'COMMERCIAL',
    '商户关系',
    '因商户等级、关系维护或特殊约定调整人工决定。',
    array['QUOTE', 'RISK']::text[]
  ),
  (
    'FX_OPPORTUNITY',
    'FX',
    '汇率机会',
    '因人工观察到的汇率机会调整补U或报价判断。',
    array['TOPUP', 'QUOTE', 'RISK']::text[]
  ),
  (
    'RISK_CONTROL',
    'RISK',
    '风险控制',
    '因余额、集中度、波动或其他风险控制因素调整决定。',
    array['TOPUP', 'QUOTE', 'RISK']::text[]
  ),
  (
    'FUNDING_ARRANGEMENT',
    'FUNDING',
    '资金安排',
    '因人工资金排期、库存限制或结算安排调整补U决定。',
    array['TOPUP', 'RISK']::text[]
  ),
  (
    'PROFIT_TARGET',
    'PROFIT',
    '利润目标',
    '因现金利润或经济利润目标调整报价或资金建议。',
    array['TOPUP', 'QUOTE', 'RISK']::text[]
  ),
  (
    'DATA_QUALITY',
    'DATA',
    '数据质量',
    '因数据截止、缺失、异常或证据不足调整人工判断。',
    array['TOPUP', 'QUOTE', 'RISK']::text[]
  ),
  (
    'OTHER',
    'OTHER',
    '其他',
    '其他需要人工说明的审批原因。',
    array['TOPUP', 'QUOTE', 'RISK']::text[]
  );

create table public.approval_requests (
  id uuid primary key default gen_random_uuid(),
  client_request_id uuid not null unique,
  request_batch_id uuid not null,
  recommendation_id uuid not null
    references public.settlement_learning_recommendations(id),
  request_type text not null
    check (request_type in ('TOPUP', 'QUOTE', 'RISK')),
  request_key text not null
    check (char_length(btrim(request_key)) > 0),
  request_version integer not null default 1
    check (request_version > 0),
  supersedes_request_id uuid
    references public.approval_requests(id),
  operating_date date not null,
  recommendation_time timestamptz not null,
  currency text not null default 'VND'
    check (currency = 'VND'),
  ai_original_suggestion jsonb not null
    check (jsonb_typeof(ai_original_suggestion) = 'object'),
  ai_reason text not null
    check (char_length(btrim(ai_reason)) > 0),
  ai_topup_usdt numeric(38,8)
    check (ai_topup_usdt is null or ai_topup_usdt >= 0),
  estimated_topup_cost_vnd numeric(38,2)
    check (
      estimated_topup_cost_vnd is null
      or estimated_topup_cost_vnd >= 0
    ),
  estimated_coverage_time text,
  merchant_name text,
  current_quote_rate numeric(38,12)
    check (current_quote_rate is null or current_quote_rate > 0),
  ai_quote_rate numeric(38,12)
    check (ai_quote_rate is null or ai_quote_rate > 0),
  predicted_profit_impact_usdt numeric(38,12),
  predicted_profit_impact_ratio numeric(18,12),
  merchant_tier text
    check (
      merchant_tier is null
      or merchant_tier in ('HIGH', 'MEDIUM', 'LOW')
    ),
  risk_code text,
  ai_risk_level text not null
    check (ai_risk_level in ('LOW', 'MEDIUM', 'HIGH')),
  risk_message text,
  predicted_cash_profit_usdt numeric(38,12),
  predicted_economic_profit_usdt numeric(38,12),
  data_cutoff_snapshot jsonb not null default '{}'::jsonb
    check (jsonb_typeof(data_cutoff_snapshot) = 'object'),
  model_version text not null default 'HUMAN_APPROVAL_CENTER_V1',
  learning_window_days smallint not null default 90
    check (learning_window_days = 90),
  requested_by uuid not null references auth.users(id),
  shadow_mode boolean not null default true check (shadow_mode),
  automatic_payment boolean not null default false
    check (automatic_payment = false),
  automatic_topup boolean not null default false
    check (automatic_topup = false),
  automatic_quote_change boolean not null default false
    check (automatic_quote_change = false),
  automatic_trading boolean not null default false
    check (automatic_trading = false),
  created_at timestamptz not null default now(),
  unique (
    recommendation_id,
    request_type,
    request_key,
    request_version
  ),
  unique (supersedes_request_id),
  check (
    (supersedes_request_id is null and request_version = 1)
    or (supersedes_request_id is not null and request_version > 1)
  ),
  check (
    request_type <> 'TOPUP'
    or (
      merchant_name is null
      and risk_code is null
      and ai_topup_usdt is not null
      and estimated_coverage_time is not null
    )
  ),
  check (
    request_type <> 'QUOTE'
    or (
      merchant_name is not null
      and char_length(btrim(merchant_name)) > 0
      and current_quote_rate is not null
      and ai_quote_rate is not null
      and merchant_tier is not null
    )
  ),
  check (
    request_type <> 'RISK'
    or (
      risk_code is not null
      and char_length(btrim(risk_code)) > 0
      and risk_message is not null
      and char_length(btrim(risk_message)) > 0
    )
  )
);

create index approval_requests_queue_idx
  on public.approval_requests(
    operating_date desc,
    request_type,
    recommendation_time desc,
    id desc
  );
create index approval_requests_recommendation_idx
  on public.approval_requests(recommendation_id);
create index approval_requests_requested_by_idx
  on public.approval_requests(requested_by);
create index approval_requests_supersedes_idx
  on public.approval_requests(supersedes_request_id)
  where supersedes_request_id is not null;

create table public.approval_actions (
  id uuid primary key default gen_random_uuid(),
  client_request_id uuid not null unique,
  approval_request_id uuid not null
    references public.approval_requests(id),
  action_version integer not null
    check (action_version > 0),
  supersedes_action_id uuid
    references public.approval_actions(id),
  action_type text not null
    check (
      action_type in (
        'ACCEPTED',
        'MODIFIED',
        'REJECTED',
        'CONFIRMED',
        'ADJUSTED',
        'IGNORED'
      )
    ),
  normalized_outcome text not null
    check (
      normalized_outcome in (
        'ACCEPTED',
        'MODIFIED',
        'REJECTED'
      )
    ),
  ai_original_suggestion jsonb not null
    check (jsonb_typeof(ai_original_suggestion) = 'object'),
  final_topup_usdt numeric(38,8)
    check (final_topup_usdt is null or final_topup_usdt >= 0),
  final_quote_rate numeric(38,12)
    check (final_quote_rate is null or final_quote_rate > 0),
  final_risk_level text
    check (
      final_risk_level is null
      or final_risk_level in ('LOW', 'MEDIUM', 'HIGH')
    ),
  adjustment_amount numeric(38,12),
  adjustment_ratio numeric(18,12),
  reason_catalog_id uuid not null
    references public.approval_reason_catalog(id),
  reason_code text not null,
  reason_detail text not null
    check (char_length(btrim(reason_detail)) > 0),
  predicted_cash_profit_usdt numeric(38,12),
  predicted_economic_profit_usdt numeric(38,12),
  final_cash_profit_result_usdt numeric(38,12),
  final_economic_profit_result_usdt numeric(38,12),
  profit_result_status text not null default 'PENDING_OUTCOME'
    check (
      profit_result_status in (
        'PENDING_OUTCOME',
        'OBSERVED'
      )
    ),
  human_execution_intent text not null
    check (
      human_execution_intent in (
        'MANUAL_REVIEW_ONLY',
        'DO_NOT_EXECUTE'
      )
    ),
  reviewed_by uuid not null references auth.users(id),
  reviewed_at timestamptz not null default now(),
  learning_window_days smallint not null default 90
    check (learning_window_days = 90),
  shadow_mode boolean not null default true check (shadow_mode),
  actual_execution_performed boolean not null default false
    check (actual_execution_performed = false),
  automatic_payment boolean not null default false
    check (automatic_payment = false),
  automatic_topup boolean not null default false
    check (automatic_topup = false),
  automatic_quote_change boolean not null default false
    check (automatic_quote_change = false),
  automatic_trading boolean not null default false
    check (automatic_trading = false),
  created_at timestamptz not null default now(),
  unique (approval_request_id, action_version),
  unique (supersedes_action_id),
  check (
    (supersedes_action_id is null and action_version = 1)
    or (supersedes_action_id is not null and action_version > 1)
  ),
  check (
    (profit_result_status = 'PENDING_OUTCOME'
      and final_cash_profit_result_usdt is null
      and final_economic_profit_result_usdt is null)
    or
    (profit_result_status = 'OBSERVED'
      and final_cash_profit_result_usdt is not null
      and final_economic_profit_result_usdt is not null)
  )
);

create index approval_actions_request_idx
  on public.approval_actions(
    approval_request_id,
    action_version desc,
    reviewed_at desc
  );
create index approval_actions_reviewer_idx
  on public.approval_actions(reviewed_by);
create index approval_actions_reviewed_at_idx
  on public.approval_actions(reviewed_at desc);
create index approval_actions_reason_idx
  on public.approval_actions(reason_catalog_id);
create index approval_actions_supersedes_idx
  on public.approval_actions(supersedes_action_id)
  where supersedes_action_id is not null;

create or replace function private.reject_human_approval_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception
    'HUMAN_APPROVAL_HISTORY_IS_IMMUTABLE_APPEND_A_NEW_VERSION';
end
$$;

create trigger approval_reason_catalog_immutable
before update or delete on public.approval_reason_catalog
for each row execute function private.reject_human_approval_mutation();

create trigger approval_requests_immutable
before update or delete on public.approval_requests
for each row execute function private.reject_human_approval_mutation();

create trigger approval_actions_immutable
before update or delete on public.approval_actions
for each row execute function private.reject_human_approval_mutation();

create or replace function public.record_approval_action_v1(
  p_client_request_id uuid,
  p_approval_request_id uuid,
  p_action_type text,
  p_final_topup_usdt numeric default null,
  p_final_quote_rate numeric default null,
  p_final_risk_level text default null,
  p_reason_code text default null,
  p_reason_detail text default null
)
returns public.approval_actions
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  request_row public.approval_requests%rowtype;
  reason_row public.approval_reason_catalog%rowtype;
  prior_action public.approval_actions%rowtype;
  action_row public.approval_actions%rowtype;
  normalized text;
  final_topup numeric(38,8);
  final_quote numeric(38,12);
  final_risk text;
  difference numeric(38,12);
  ratio numeric(18,12);
begin
  if actor_id is null then
    raise exception 'AUTHENTICATION_REQUIRED';
  end if;

  if not (
    public.has_role('admin'::public.app_role)
    or public.has_role('settlement_operator'::public.app_role)
  ) then
    raise exception 'APPROVAL_ROLE_REQUIRED';
  end if;

  select *
  into action_row
  from public.approval_actions
  where client_request_id = p_client_request_id;
  if found then
    return action_row;
  end if;

  select *
  into request_row
  from public.approval_requests
  where id = p_approval_request_id
  for update;
  if not found then
    raise exception 'APPROVAL_REQUEST_NOT_FOUND';
  end if;

  select *
  into reason_row
  from public.approval_reason_catalog
  where reason_code = upper(btrim(p_reason_code))
    and active;
  if not found then
    raise exception 'APPROVAL_REASON_NOT_FOUND';
  end if;
  if not (request_row.request_type = any(reason_row.applies_to)) then
    raise exception 'APPROVAL_REASON_NOT_APPLICABLE';
  end if;
  if p_reason_detail is null
    or char_length(btrim(p_reason_detail)) = 0
  then
    raise exception 'APPROVAL_REASON_DETAIL_REQUIRED';
  end if;

  if request_row.request_type in ('TOPUP', 'QUOTE') then
    if p_action_type not in ('ACCEPTED', 'MODIFIED', 'REJECTED') then
      raise exception 'INVALID_FINANCIAL_APPROVAL_ACTION';
    end if;
    normalized := p_action_type;
  else
    if p_action_type not in ('CONFIRMED', 'ADJUSTED', 'IGNORED') then
      raise exception 'INVALID_RISK_APPROVAL_ACTION';
    end if;
    normalized := case p_action_type
      when 'CONFIRMED' then 'ACCEPTED'
      when 'ADJUSTED' then 'MODIFIED'
      else 'REJECTED'
    end;
  end if;

  if request_row.request_type = 'TOPUP' then
    final_topup := case
      when p_action_type = 'ACCEPTED' then request_row.ai_topup_usdt
      when p_action_type = 'REJECTED' then 0
      else p_final_topup_usdt
    end;
    if final_topup is null or final_topup < 0 then
      raise exception 'FINAL_TOPUP_REQUIRED';
    end if;
    if p_action_type = 'MODIFIED'
      and final_topup = request_row.ai_topup_usdt
    then
      raise exception 'MODIFIED_TOPUP_MUST_DIFFER';
    end if;
    difference := final_topup - request_row.ai_topup_usdt;
    ratio := case
      when request_row.ai_topup_usdt = 0 then null
      else difference / request_row.ai_topup_usdt
    end;
  elsif request_row.request_type = 'QUOTE' then
    final_quote := case
      when p_action_type = 'ACCEPTED' then request_row.ai_quote_rate
      when p_action_type = 'REJECTED' then request_row.current_quote_rate
      else p_final_quote_rate
    end;
    if final_quote is null or final_quote <= 0 then
      raise exception 'FINAL_QUOTE_REQUIRED';
    end if;
    if p_action_type = 'MODIFIED'
      and final_quote = request_row.ai_quote_rate
    then
      raise exception 'MODIFIED_QUOTE_MUST_DIFFER';
    end if;
    difference := final_quote - request_row.ai_quote_rate;
    ratio := difference / request_row.ai_quote_rate;
  else
    final_risk := case
      when p_action_type = 'CONFIRMED' then request_row.ai_risk_level
      when p_action_type = 'IGNORED' then 'LOW'
      else p_final_risk_level
    end;
    if final_risk not in ('LOW', 'MEDIUM', 'HIGH') then
      raise exception 'FINAL_RISK_LEVEL_REQUIRED';
    end if;
    if p_action_type = 'ADJUSTED'
      and final_risk = request_row.ai_risk_level
    then
      raise exception 'ADJUSTED_RISK_MUST_DIFFER';
    end if;
  end if;

  select *
  into prior_action
  from public.approval_actions
  where approval_request_id = request_row.id
  order by action_version desc
  limit 1;

  insert into public.approval_actions (
    client_request_id,
    approval_request_id,
    action_version,
    supersedes_action_id,
    action_type,
    normalized_outcome,
    ai_original_suggestion,
    final_topup_usdt,
    final_quote_rate,
    final_risk_level,
    adjustment_amount,
    adjustment_ratio,
    reason_catalog_id,
    reason_code,
    reason_detail,
    predicted_cash_profit_usdt,
    predicted_economic_profit_usdt,
    human_execution_intent,
    reviewed_by
  )
  values (
    p_client_request_id,
    request_row.id,
    coalesce(prior_action.action_version, 0) + 1,
    prior_action.id,
    p_action_type,
    normalized,
    request_row.ai_original_suggestion,
    final_topup,
    final_quote,
    final_risk,
    difference,
    ratio,
    reason_row.id,
    reason_row.reason_code,
    btrim(p_reason_detail),
    request_row.predicted_cash_profit_usdt,
    request_row.predicted_economic_profit_usdt,
    case
      when normalized = 'REJECTED' then 'DO_NOT_EXECUTE'
      else 'MANUAL_REVIEW_ONLY'
    end,
    actor_id
  )
  returning * into action_row;

  return action_row;
end
$$;

create or replace view public.approval_request_latest
with (security_invoker = true)
as
select request.*
from public.approval_requests request
where not exists (
  select 1
  from public.approval_requests newer
  where newer.supersedes_request_id = request.id
);

create or replace view public.approval_action_latest
with (security_invoker = true)
as
select action.*
from public.approval_actions action
where not exists (
  select 1
  from public.approval_actions newer
  where newer.supersedes_action_id = action.id
);

create or replace view public.approval_center_queue
with (security_invoker = true)
as
select
  request.*,
  action.id as latest_action_id,
  action.action_version as latest_action_version,
  action.action_type as latest_action_type,
  action.normalized_outcome as latest_normalized_outcome,
  action.final_topup_usdt,
  action.final_quote_rate,
  action.final_risk_level,
  action.adjustment_amount,
  action.adjustment_ratio,
  action.reason_code,
  action.reason_detail,
  action.profit_result_status,
  action.final_cash_profit_result_usdt,
  action.final_economic_profit_result_usdt,
  action.reviewed_by,
  action.reviewed_at,
  action.human_execution_intent,
  action.actual_execution_performed
from public.approval_request_latest request
left join public.approval_action_latest action
  on action.approval_request_id = request.id;

create or replace view public.approval_learning_90d
with (security_invoker = true)
as
select
  request.id as approval_request_id,
  request.recommendation_id,
  request.request_type,
  request.request_key,
  request.operating_date,
  request.recommendation_time,
  request.ai_original_suggestion,
  request.ai_topup_usdt,
  request.ai_quote_rate,
  request.ai_risk_level,
  request.predicted_cash_profit_usdt,
  request.predicted_economic_profit_usdt,
  action.id as approval_action_id,
  action.action_version,
  action.action_type,
  action.normalized_outcome,
  action.final_topup_usdt,
  action.final_quote_rate,
  action.final_risk_level,
  action.adjustment_amount,
  action.adjustment_ratio,
  action.reason_code,
  action.reason_detail,
  action.final_cash_profit_result_usdt,
  action.final_economic_profit_result_usdt,
  action.profit_result_status,
  action.reviewed_at,
  action.shadow_mode,
  action.actual_execution_performed
from public.approval_request_latest request
join public.approval_action_latest action
  on action.approval_request_id = request.id
where request.recommendation_time >= now() - interval '90 days';

alter table public.approval_reason_catalog enable row level security;
alter table public.approval_requests enable row level security;
alter table public.approval_actions enable row level security;

create policy approval_reason_catalog_read
on public.approval_reason_catalog
for select to authenticated
using (
  public.has_role('admin'::public.app_role)
  or public.has_role('settlement_operator'::public.app_role)
);

create policy approval_requests_read
on public.approval_requests
for select to authenticated
using (
  public.has_role('admin'::public.app_role)
  or public.has_role('settlement_operator'::public.app_role)
);

create policy approval_requests_insert
on public.approval_requests
for insert to authenticated
with check (
  (select auth.uid()) = requested_by
  and (
    public.has_role('admin'::public.app_role)
    or public.has_role('settlement_operator'::public.app_role)
  )
  and shadow_mode
  and not automatic_payment
  and not automatic_topup
  and not automatic_quote_change
  and not automatic_trading
);

create policy approval_actions_read
on public.approval_actions
for select to authenticated
using (
  public.has_role('admin'::public.app_role)
  or public.has_role('settlement_operator'::public.app_role)
);

revoke all on
  public.approval_reason_catalog,
  public.approval_requests,
  public.approval_actions
from anon, authenticated;

grant select on
  public.approval_reason_catalog,
  public.approval_actions
to authenticated;
grant select, insert on public.approval_requests to authenticated;
grant all on
  public.approval_reason_catalog,
  public.approval_requests,
  public.approval_actions
to service_role;

revoke all on
  public.approval_request_latest,
  public.approval_action_latest,
  public.approval_center_queue,
  public.approval_learning_90d
from anon, authenticated;
grant select on
  public.approval_request_latest,
  public.approval_action_latest,
  public.approval_center_queue,
  public.approval_learning_90d
to authenticated, service_role;

revoke all on function public.record_approval_action_v1(
  uuid,
  uuid,
  text,
  numeric,
  numeric,
  text,
  text,
  text
) from public, anon;
grant execute on function public.record_approval_action_v1(
  uuid,
  uuid,
  text,
  numeric,
  numeric,
  text,
  text,
  text
) to authenticated, service_role;

create trigger audit_approval_reason_catalog
after insert or update or delete on public.approval_reason_catalog
for each row execute function public.audit_mutation();

create trigger audit_approval_requests
after insert or update or delete on public.approval_requests
for each row execute function public.audit_mutation();

create trigger audit_approval_actions
after insert or update or delete on public.approval_actions
for each row execute function public.audit_mutation();

do $$
begin
  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'approval_reason_catalog',
        'approval_requests',
        'approval_actions'
      )
      and cmd in ('UPDATE', 'DELETE', 'ALL')
  ) then
    raise exception 'APPROVAL_TABLES_MUST_NOT_HAVE_MUTATION_POLICIES';
  end if;

  if (
    select count(*)
    from pg_trigger
    where tgname in (
      'approval_reason_catalog_immutable',
      'approval_requests_immutable',
      'approval_actions_immutable'
    )
      and not tgisinternal
  ) <> 3 then
    raise exception 'APPROVAL_IMMUTABILITY_TRIGGER_MISSING';
  end if;
end
$$;

comment on table public.approval_reason_catalog is
  'Immutable, versioned human-approval reason catalog for VND Phase 1.';
comment on table public.approval_requests is
  'Immutable AI suggestion approval requests. Rows are evidence only and never execute an external action.';
comment on table public.approval_actions is
  'Append-only human approval decisions and adjustments retained for the 90-day learning loop.';
comment on view public.approval_center_queue is
  'Latest AI approval request and latest appended human action for the VND Human Approval Center.';
comment on view public.approval_learning_90d is
  'Latest human approval evidence for the 90-day learning loop, including explicit pending or observed profit-result status.';
comment on function public.record_approval_action_v1 is
  'Appends a versioned human approval action. It cannot pay, top up, change a quote, or trade.';
