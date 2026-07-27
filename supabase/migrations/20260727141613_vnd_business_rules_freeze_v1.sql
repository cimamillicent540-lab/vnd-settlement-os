-- Task 2.10 — VND Settlement Business Rules Freeze V1.
-- Structures confirmed human business rules and exposes the existing Phase 1
-- learning workflow as the operator confirmation center.
-- No payment, topup, quote update, market-data collection, or trade is added.

create table public.settlement_business_rule_sets (
  id uuid primary key default gen_random_uuid(),
  rule_set_code text not null unique
    check (char_length(btrim(rule_set_code)) > 0),
  currency text not null check (currency = 'VND'),
  version integer not null check (version > 0),
  freeze_status text not null check (freeze_status = 'FROZEN'),
  current_automation_stage text not null
    check (current_automation_stage = 'STAGE_1_HUMAN_REVIEW'),
  automation_stage_definitions jsonb not null
    check (
      jsonb_typeof(automation_stage_definitions) = 'array'
      and jsonb_array_length(automation_stage_definitions) = 3
    ),
  description text not null
    check (char_length(btrim(description)) > 0),
  source_task text not null default 'TASK_2_10',
  effective_at timestamptz not null,
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
  unique (currency, version)
);

create table public.settlement_business_rules (
  id uuid primary key default gen_random_uuid(),
  rule_set_id uuid not null
    references public.settlement_business_rule_sets(id),
  rule_key text not null
    check (char_length(btrim(rule_key)) > 0),
  rule_category text not null
    check (
      rule_category in (
        'TOPUP',
        'PROFIT',
        'QUOTE',
        'RISK',
        'AUTOMATION_STAGE'
      )
    ),
  rule_name text not null
    check (char_length(btrim(rule_name)) > 0),
  condition_definition jsonb not null
    check (jsonb_typeof(condition_definition) = 'object'),
  system_suggested_action jsonb not null
    check (jsonb_typeof(system_suggested_action) = 'object'),
  requires_human_approval boolean not null,
  priority integer not null check (priority between 1 and 1000),
  applicable_stage text not null
    check (
      applicable_stage in (
        'STAGE_1_HUMAN_REVIEW',
        'STAGE_2_HUMAN_REVIEW_CONDITIONAL_EXECUTION',
        'STAGE_3_FULL_AUTOMATION'
      )
    ),
  rule_status text not null
    check (rule_status in ('CONFIRMED', 'PLANNED')),
  effective_at timestamptz not null,
  shadow_mode boolean not null default true check (shadow_mode),
  automatic_action boolean not null default false
    check (automatic_action = false),
  created_at timestamptz not null default now(),
  unique (rule_set_id, rule_key)
);

create index settlement_business_rules_rule_set_idx
  on public.settlement_business_rules(rule_set_id);
create index settlement_business_rules_category_priority_idx
  on public.settlement_business_rules(
    rule_set_id,
    rule_category,
    priority,
    rule_key
  );
create index settlement_business_rules_stage_status_idx
  on public.settlement_business_rules(
    applicable_stage,
    rule_status,
    priority
  );

create or replace function private.reject_business_rules_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception
    'BUSINESS_RULES_ARE_FROZEN_CREATE_A_NEW_VERSION';
end
$$;

create trigger settlement_business_rule_sets_immutable
before update or delete
on public.settlement_business_rule_sets
for each row execute function private.reject_business_rules_mutation();

create trigger settlement_business_rules_immutable
before update or delete
on public.settlement_business_rules
for each row execute function private.reject_business_rules_mutation();

create trigger audit_settlement_business_rule_sets
after insert or update or delete
on public.settlement_business_rule_sets
for each row execute function public.audit_mutation();

create trigger audit_settlement_business_rules
after insert or update or delete
on public.settlement_business_rules
for each row execute function public.audit_mutation();

alter table public.settlement_business_rule_sets
  enable row level security;
alter table public.settlement_business_rules
  enable row level security;

create policy settlement_business_rule_sets_read
on public.settlement_business_rule_sets
for select to authenticated
using (true);

create policy settlement_business_rules_read
on public.settlement_business_rules
for select to authenticated
using (true);

revoke all on
  public.settlement_business_rule_sets,
  public.settlement_business_rules
from anon, authenticated;

grant select on
  public.settlement_business_rule_sets,
  public.settlement_business_rules
to authenticated, service_role;

with inserted_rule_set as (
  insert into public.settlement_business_rule_sets(
    rule_set_code,
    currency,
    version,
    freeze_status,
    current_automation_stage,
    automation_stage_definitions,
    description,
    source_task,
    effective_at,
    shadow_mode,
    automatic_payment,
    automatic_topup,
    automatic_quote_change,
    automatic_trading
  )
  values (
    'VND_BUSINESS_RULES_FREEZE_V1',
    'VND',
    1,
    'FROZEN',
    'STAGE_1_HUMAN_REVIEW',
    jsonb_build_array(
      jsonb_build_object(
        'stage', 'STAGE_1_HUMAN_REVIEW',
        'sequence', 1,
        'status', 'CURRENT',
        'description', '人工审核系统建议，不执行自动操作'
      ),
      jsonb_build_object(
        'stage', 'STAGE_2_HUMAN_REVIEW_CONDITIONAL_EXECUTION',
        'sequence', 2,
        'status', 'PLANNED',
        'description', '人工审核后才允许条件执行；当前未实现'
      ),
      jsonb_build_object(
        'stage', 'STAGE_3_FULL_AUTOMATION',
        'sequence', 3,
        'status', 'PLANNED',
        'description', '完全自动化；当前未实现'
      )
    ),
    'Task 2.10 confirmed VND settlement decision rules',
    'TASK_2_10',
    '2026-07-27T00:00:00Z'::timestamptz,
    true,
    false,
    false,
    false,
    false
  )
  returning id, effective_at
)
insert into public.settlement_business_rules(
  rule_set_id,
  rule_key,
  rule_category,
  rule_name,
  condition_definition,
  system_suggested_action,
  requires_human_approval,
  priority,
  applicable_stage,
  rule_status,
  effective_at,
  shadow_mode,
  automatic_action
)
select
  rule_set.id,
  seed.rule_key,
  seed.rule_category,
  seed.rule_name,
  seed.condition_definition,
  seed.system_suggested_action,
  seed.requires_human_approval,
  seed.priority,
  seed.applicable_stage,
  seed.rule_status,
  rule_set.effective_at,
  true,
  false
from inserted_rule_set rule_set
cross join (
  values
    (
      'TOPUP_SETTLEABLE_BALANCE',
      'TOPUP',
      '补U基于资金池可结算余额',
      '{"metric":"settleable_balance_vnd","source":"SETTLEMENT_INTELLIGENCE","operator":"COMPARE_TO_FORECAST_NEED"}'::jsonb,
      '{"action":"RECOMMEND_TOPUP_ONLY","execution":"NONE","basis":"SETTLEABLE_BALANCE"}'::jsonb,
      true,
      10,
      'STAGE_1_HUMAN_REVIEW',
      'CONFIRMED'
    ),
    (
      'TOPUP_PEAK_16_23_FORECAST',
      'TOPUP',
      '补U纳入16:00-23:00预测需求',
      '{"metric":"peak_pressure_vnd","local_timezone":"UTC+8","hours":[16,17,18,19,20,21,22,23]}'::jsonb,
      '{"action":"INCLUDE_IN_TOPUP_RECOMMENDATION","execution":"NONE"}'::jsonb,
      true,
      20,
      'STAGE_1_HUMAN_REVIEW',
      'CONFIRMED'
    ),
    (
      'TOPUP_BASE_INVENTORY_LIMIT',
      'TOPUP',
      '最大5万USDT基础库存额度',
      '{"inventory_limit_usdt":50000,"reference_rate_vnd_per_usdt":26500,"inventory_limit_vnd":1325000000}'::jsonb,
      '{"action":"FLAG_LIMIT_STATUS","execution":"NONE"}'::jsonb,
      true,
      40,
      'STAGE_1_HUMAN_REVIEW',
      'CONFIRMED'
    ),
    (
      'TOPUP_ABOVE_LIMIT_MANUAL_CONFIRMATION',
      'TOPUP',
      '超过基础库存额度必须人工确认',
      '{"operator":"GREATER_THAN","left":"projected_inventory_vnd","right":"maximum_inventory_vnd"}'::jsonb,
      '{"action":"REQUIRE_MANUAL_CONFIRMATION","automatic_topup":false}'::jsonb,
      true,
      50,
      'STAGE_1_HUMAN_REVIEW',
      'CONFIRMED'
    ),
    (
      'TOPUP_SAFETY_BUFFER_10_PERCENT',
      'TOPUP',
      '补U需求包含10%安全缓冲',
      '{"metric":"required_settleable_vnd","formula":"max(forecast_net_demand_vnd, peak_pressure_vnd) * 1.10","safety_buffer":"0.10"}'::jsonb,
      '{"action":"INCLUDE_SAFETY_BUFFER_IN_TOPUP_RECOMMENDATION","execution":"NONE"}'::jsonb,
      true,
      30,
      'STAGE_1_HUMAN_REVIEW',
      'CONFIRMED'
    ),
    (
      'PROFIT_MARKET_PROTECTION_0_2_PERCENT',
      'PROFIT',
      '千2市场保护线',
      '{"metric":"economic_profit_margin","minimum":"0.002"}'::jsonb,
      '{"action":"RAISE_LOW_MARGIN_ALERT","execution":"NONE"}'::jsonb,
      true,
      110,
      'STAGE_1_HUMAN_REVIEW',
      'CONFIRMED'
    ),
    (
      'PROFIT_TARGET_0_5_PERCENT',
      'PROFIT',
      '千5目标利润线',
      '{"metric":"target_profit_margin","target":"0.005"}'::jsonb,
      '{"action":"RECOMMEND_TARGET_MARGIN","execution":"NONE"}'::jsonb,
      true,
      120,
      'STAGE_1_HUMAN_REVIEW',
      'CONFIRMED'
    ),
    (
      'PROFIT_HIGH_VOLATILITY_HUMAN_INCREASE',
      'PROFIT',
      '高波动行情由人工提高利润目标',
      '{"market_volatility":"HIGH","market_data_source":"MANUAL_INPUT"}'::jsonb,
      '{"action":"SUGGEST_HIGHER_TARGET_FOR_HUMAN_REVIEW","automatic_quote_change":false}'::jsonb,
      true,
      130,
      'STAGE_1_HUMAN_REVIEW',
      'CONFIRMED'
    ),
    (
      'QUOTE_XE_BASE',
      'QUOTE',
      '客户报价以XE为基础',
      '{"base_source":"XE","collection_mode":"MANUAL_INPUT"}'::jsonb,
      '{"action":"USE_AS_QUOTE_BASE","execution":"NONE"}'::jsonb,
      true,
      210,
      'STAGE_1_HUMAN_REVIEW',
      'CONFIRMED'
    ),
    (
      'QUOTE_COMPANY_ADJUSTMENT',
      'QUOTE',
      '客户报价叠加公司调整',
      '{"formula":"CUSTOMER_QUOTE_RATE = XE_RATE + COMPANY_ADJUSTMENT"}'::jsonb,
      '{"action":"APPLY_APPROVED_ADJUSTMENT_IN_SHADOW_QUOTE","automatic_quote_change":false}'::jsonb,
      true,
      220,
      'STAGE_1_HUMAN_REVIEW',
      'CONFIRMED'
    ),
    (
      'QUOTE_P2P_MANUAL_COST_INPUT',
      'QUOTE',
      '报价参考人工录入P2P成本',
      '{"rate_type":"P2P_COST_RATE","collection_mode":"MANUAL_INPUT"}'::jsonb,
      '{"action":"INCLUDE_IN_MARGIN_PROTECTION","automatic_collection":false}'::jsonb,
      true,
      230,
      'STAGE_1_HUMAN_REVIEW',
      'CONFIRMED'
    ),
    (
      'QUOTE_MERCHANT_TIER',
      'QUOTE',
      '报价按商户等级阶梯建议',
      '{"dimensions":["merchant_contribution","transaction_volume","risk_level"]}'::jsonb,
      '{"action":"RECOMMEND_MERCHANT_TIER_QUOTE","automatic_quote_change":false}'::jsonb,
      true,
      240,
      'STAGE_1_HUMAN_REVIEW',
      'CONFIRMED'
    ),
    (
      'RISK_SETTLEABLE_INSUFFICIENT',
      'RISK',
      'Settleable余额不足风险',
      '{"metric":"settleable_balance_vnd","operator":"LESS_THAN","right":"required_settleable_vnd"}'::jsonb,
      '{"action":"RAISE_SETTLEABLE_CAPACITY_RISK","execution":"NONE"}'::jsonb,
      true,
      260,
      'STAGE_1_HUMAN_REVIEW',
      'CONFIRMED'
    ),
    (
      'RISK_HIGH_VOLATILITY',
      'RISK',
      '高波动汇率风险',
      '{"market_volatility":"HIGH","input_mode":"MANUAL"}'::jsonb,
      '{"action":"RAISE_FX_VOLATILITY_RISK","execution":"NONE"}'::jsonb,
      true,
      270,
      'STAGE_1_HUMAN_REVIEW',
      'CONFIRMED'
    ),
    (
      'RISK_P2P_INPUT_MISSING',
      'RISK',
      '人工P2P成本价格缺失风险',
      '{"rate_type":"P2P_COST_RATE","operator":"IS_MISSING"}'::jsonb,
      '{"action":"RAISE_P2P_INPUT_MISSING_RISK","automatic_collection":false}'::jsonb,
      true,
      280,
      'STAGE_1_HUMAN_REVIEW',
      'CONFIRMED'
    ),
    (
      'RISK_INTERNATIONAL_MARKET_HUMAN_FLAG',
      'RISK',
      '国际局势风险由人工标记',
      '{"risk_dimension":"GEOPOLITICS","assessment_mode":"HUMAN"}'::jsonb,
      '{"action":"REQUEST_HUMAN_CONFIRM_IGNORE_OR_NOTE","execution":"NONE"}'::jsonb,
      true,
      290,
      'STAGE_1_HUMAN_REVIEW',
      'CONFIRMED'
    ),
    (
      'AUTOMATION_STAGE_1',
      'AUTOMATION_STAGE',
      'Stage 1：人工审核系统建议',
      '{"stage_sequence":1,"current":true}'::jsonb,
      '{"action":"HUMAN_REVIEW_ONLY","automatic_execution":false}'::jsonb,
      true,
      310,
      'STAGE_1_HUMAN_REVIEW',
      'CONFIRMED'
    ),
    (
      'AUTOMATION_STAGE_2',
      'AUTOMATION_STAGE',
      'Stage 2：人工审核加条件执行',
      '{"stage_sequence":2,"current":false}'::jsonb,
      '{"action":"FUTURE_CONDITIONAL_EXECUTION","implemented":false}'::jsonb,
      true,
      320,
      'STAGE_2_HUMAN_REVIEW_CONDITIONAL_EXECUTION',
      'PLANNED'
    ),
    (
      'AUTOMATION_STAGE_3',
      'AUTOMATION_STAGE',
      'Stage 3：完全自动化',
      '{"stage_sequence":3,"current":false}'::jsonb,
      '{"action":"FUTURE_FULL_AUTOMATION","implemented":false}'::jsonb,
      false,
      330,
      'STAGE_3_FULL_AUTOMATION',
      'PLANNED'
    )
) as seed(
  rule_key,
  rule_category,
  rule_name,
  condition_definition,
  system_suggested_action,
  requires_human_approval,
  priority,
  applicable_stage,
  rule_status
);

create or replace view public.settlement_business_rules_current
with (security_invoker = true)
as
select
  rule_set.rule_set_code,
  rule_set.currency,
  rule_set.version as rule_set_version,
  rule_set.freeze_status,
  rule_set.current_automation_stage,
  rule_set.automation_stage_definitions,
  rule_set.effective_at as rule_set_effective_at,
  rule.id,
  rule.rule_key,
  rule.rule_category,
  rule.rule_name,
  rule.condition_definition,
  rule.system_suggested_action,
  rule.requires_human_approval,
  rule.priority,
  rule.applicable_stage,
  rule.rule_status,
  rule.shadow_mode,
  rule.automatic_action
from public.settlement_business_rule_sets rule_set
join public.settlement_business_rules rule
  on rule.rule_set_id = rule_set.id
where rule_set.rule_set_code = 'VND_BUSINESS_RULES_FREEZE_V1';

create or replace view public.settlement_operator_confirmation_center
with (security_invoker = true)
as
select
  recommendation.id as recommendation_id,
  recommendation.currency,
  (
    recommendation.recommendation_time
    at time zone 'Asia/Shanghai'
  )::date as operating_date,
  recommendation.recommendation_time,
  recommendation.system_topup_recommended,
  recommendation.system_recommended_topup_usdt,
  recommendation.system_recommended_quote_rate,
  recommendation.system_target_margin,
  recommendation.system_risk_alerts,
  recommendation.system_expected_profit_usdt,
  recommendation.system_expected_profit_margin,
  recommendation.system_fx_judgment,
  recommendation.system_payload,
  recommendation.data_cutoff_snapshot,
  recommendation.model_version,
  recommendation.shadow_mode,
  decision.id as latest_decision_id,
  decision.decision_version,
  decision.decision_scope,
  decision.acceptance_status,
  decision.final_topup_usdt,
  decision.final_quote_rate,
  decision.final_execution_decision,
  decision.adjustment_reason,
  decision.reviewer_id,
  decision.reviewed_at,
  decision.actual_execution_performed,
  decision.id is null as pending_human_confirmation
from public.settlement_learning_recommendations recommendation
left join public.settlement_learning_latest_decisions decision
  on decision.recommendation_id = recommendation.id
where recommendation.currency = 'VND';

grant select on
  public.settlement_business_rules_current,
  public.settlement_operator_confirmation_center
to authenticated, service_role;

do $$
declare
  seeded_rule_count integer;
begin
  select count(*)::integer
  into seeded_rule_count
  from public.settlement_business_rules_current;

  if seeded_rule_count <> 19 then
    raise exception
      'BUSINESS_RULE_FREEZE_EXPECTED_19_RULES_GOT_%',
      seeded_rule_count;
  end if;
  if exists (
    select 1
    from public.settlement_business_rule_sets rule_set
    where not rule_set.shadow_mode
      or rule_set.automatic_payment
      or rule_set.automatic_topup
      or rule_set.automatic_quote_change
      or rule_set.automatic_trading
  ) then
    raise exception 'BUSINESS_RULE_FREEZE_SHADOW_GUARD_FAILED';
  end if;
  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'settlement_business_rule_sets',
        'settlement_business_rules'
      )
      and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
  ) then
    raise exception 'FROZEN_RULE_TABLES_MUST_BE_READ_ONLY';
  end if;
end
$$;

comment on table public.settlement_business_rule_sets is
  'Immutable VND rule-freeze versions. The current version remains Stage 1 and Shadow Mode.';
comment on table public.settlement_business_rules is
  'Immutable structured decision rules: condition, suggested action, approval requirement, and priority.';
comment on view public.settlement_operator_confirmation_center is
  'Operator view backed by Task 2.8 learning recommendations and human decisions. Confirmation never executes an external action.';
