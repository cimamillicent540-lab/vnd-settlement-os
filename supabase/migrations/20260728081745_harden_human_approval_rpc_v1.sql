-- Task 2.16 security hardening.
-- The public RPC now executes with caller privileges. A strict RLS policy
-- and validation trigger preserve the append-only approval contract.

create or replace function private.validate_approval_action_insert()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  request_row public.approval_requests%rowtype;
  reason_row public.approval_reason_catalog%rowtype;
  prior_action public.approval_actions%rowtype;
  expected_outcome text;
  expected_amount numeric(38,12);
  expected_ratio numeric(18,12);
begin
  if actor_id is null
    or new.reviewed_by <> actor_id
    or not (
      public.has_role('admin'::public.app_role)
      or public.has_role('settlement_operator'::public.app_role)
    )
  then
    raise exception 'APPROVAL_ROLE_REQUIRED';
  end if;

  select *
  into request_row
  from public.approval_requests
  where id = new.approval_request_id;
  if not found then
    raise exception 'APPROVAL_REQUEST_NOT_FOUND';
  end if;

  select *
  into reason_row
  from public.approval_reason_catalog
  where id = new.reason_catalog_id
    and reason_code = new.reason_code
    and active;
  if not found
    or not (request_row.request_type = any(reason_row.applies_to))
    or char_length(btrim(new.reason_detail)) = 0
  then
    raise exception 'APPROVAL_REASON_INVALID';
  end if;

  if new.ai_original_suggestion <> request_row.ai_original_suggestion
    or new.predicted_cash_profit_usdt
      is distinct from request_row.predicted_cash_profit_usdt
    or new.predicted_economic_profit_usdt
      is distinct from request_row.predicted_economic_profit_usdt
  then
    raise exception 'AI_APPROVAL_EVIDENCE_MUST_MATCH_REQUEST';
  end if;

  if not new.shadow_mode
    or new.actual_execution_performed
    or new.automatic_payment
    or new.automatic_topup
    or new.automatic_quote_change
    or new.automatic_trading
  then
    raise exception 'APPROVAL_ACTION_MUST_REMAIN_SHADOW_ONLY';
  end if;

  if request_row.request_type in ('TOPUP', 'QUOTE') then
    if new.action_type not in ('ACCEPTED', 'MODIFIED', 'REJECTED') then
      raise exception 'INVALID_FINANCIAL_APPROVAL_ACTION';
    end if;
    expected_outcome := new.action_type;
  else
    if new.action_type not in ('CONFIRMED', 'ADJUSTED', 'IGNORED') then
      raise exception 'INVALID_RISK_APPROVAL_ACTION';
    end if;
    expected_outcome := case new.action_type
      when 'CONFIRMED' then 'ACCEPTED'
      when 'ADJUSTED' then 'MODIFIED'
      else 'REJECTED'
    end;
  end if;

  if new.normalized_outcome <> expected_outcome then
    raise exception 'NORMALIZED_APPROVAL_OUTCOME_INVALID';
  end if;

  if request_row.request_type = 'TOPUP' then
    if new.final_topup_usdt is null
      or new.final_quote_rate is not null
      or new.final_risk_level is not null
    then
      raise exception 'TOPUP_APPROVAL_RESULT_INVALID';
    end if;
    if new.action_type = 'ACCEPTED'
      and new.final_topup_usdt <> request_row.ai_topup_usdt
    then
      raise exception 'ACCEPTED_TOPUP_MUST_MATCH_AI';
    end if;
    if new.action_type = 'MODIFIED'
      and new.final_topup_usdt = request_row.ai_topup_usdt
    then
      raise exception 'MODIFIED_TOPUP_MUST_DIFFER';
    end if;
    if new.action_type = 'REJECTED'
      and new.final_topup_usdt <> 0
    then
      raise exception 'REJECTED_TOPUP_MUST_BE_ZERO';
    end if;
    expected_amount :=
      new.final_topup_usdt - request_row.ai_topup_usdt;
    expected_ratio := case
      when request_row.ai_topup_usdt = 0 then null
      else expected_amount / request_row.ai_topup_usdt
    end;
  elsif request_row.request_type = 'QUOTE' then
    if new.final_quote_rate is null
      or new.final_topup_usdt is not null
      or new.final_risk_level is not null
    then
      raise exception 'QUOTE_APPROVAL_RESULT_INVALID';
    end if;
    if new.action_type = 'ACCEPTED'
      and new.final_quote_rate <> request_row.ai_quote_rate
    then
      raise exception 'ACCEPTED_QUOTE_MUST_MATCH_AI';
    end if;
    if new.action_type = 'MODIFIED'
      and new.final_quote_rate = request_row.ai_quote_rate
    then
      raise exception 'MODIFIED_QUOTE_MUST_DIFFER';
    end if;
    if new.action_type = 'REJECTED'
      and new.final_quote_rate <> request_row.current_quote_rate
    then
      raise exception 'REJECTED_QUOTE_MUST_KEEP_CURRENT';
    end if;
    expected_amount :=
      new.final_quote_rate - request_row.ai_quote_rate;
    expected_ratio := expected_amount / request_row.ai_quote_rate;
  else
    if new.final_risk_level is null
      or new.final_topup_usdt is not null
      or new.final_quote_rate is not null
      or new.adjustment_amount is not null
      or new.adjustment_ratio is not null
    then
      raise exception 'RISK_APPROVAL_RESULT_INVALID';
    end if;
    if new.action_type = 'CONFIRMED'
      and new.final_risk_level <> request_row.ai_risk_level
    then
      raise exception 'CONFIRMED_RISK_MUST_MATCH_AI';
    end if;
    if new.action_type = 'ADJUSTED'
      and new.final_risk_level = request_row.ai_risk_level
    then
      raise exception 'ADJUSTED_RISK_MUST_DIFFER';
    end if;
    if new.action_type = 'IGNORED'
      and new.final_risk_level <> 'LOW'
    then
      raise exception 'IGNORED_RISK_MUST_BE_LOW';
    end if;
  end if;

  if new.adjustment_amount is distinct from expected_amount
    or new.adjustment_ratio is distinct from expected_ratio
  then
    raise exception 'APPROVAL_ADJUSTMENT_INVALID';
  end if;

  select *
  into prior_action
  from public.approval_actions
  where approval_request_id = new.approval_request_id
  order by action_version desc
  limit 1;

  if new.action_version <> coalesce(prior_action.action_version, 0) + 1
    or new.supersedes_action_id is distinct from prior_action.id
  then
    raise exception 'APPROVAL_ACTION_VERSION_INVALID';
  end if;

  return new;
end
$$;

create trigger approval_actions_validate_insert
before insert on public.approval_actions
for each row execute function private.validate_approval_action_insert();

create policy approval_actions_insert
on public.approval_actions
for insert to authenticated
with check (
  (select auth.uid()) = reviewed_by
  and (
    public.has_role('admin'::public.app_role)
    or public.has_role('settlement_operator'::public.app_role)
  )
  and shadow_mode
  and not actual_execution_performed
  and not automatic_payment
  and not automatic_topup
  and not automatic_quote_change
  and not automatic_trading
);

grant insert on public.approval_actions to authenticated;

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
security invoker
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

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_approval_request_id::text, 0)
  );

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
  where id = p_approval_request_id;
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

comment on function public.record_approval_action_v1 is
  'Caller-rights RPC for append-only human approval actions. Strict RLS and validation enforce Shadow Mode.';
