-- BLOG 配额 Q-FIX verify:blog_quota_state 增列 storage_pct / storage_status
-- Revision: 20260907.quota-domain-split.1
-- 执行本库(bloggallery)supabase/migrations/020_quota_domain_split.sql 后运行。
-- 期望 ready=true。断言:两列形态(类型/可空/默认 null)+ storage_status check 约束
-- + 015/016/017 权限与 RLS 口径不变 + 行为自检(写读回滚,不留数据)。

-- ---------------------------------------------------------------------------
-- 行为自检(begin/rollback 自包含,不留数据):
-- 造临时行 → 写 storage_pct/storage_status → 读回断言 → 非法状态必须被
-- check 约束拒绝 → 回滚。
-- ---------------------------------------------------------------------------
begin;

do $$
declare
  v_site constant uuid := '00000000-0000-0000-0000-00000000f20a';
  v_pct numeric;
  v_status text;
begin
  insert into public.blog_quota_state (site_id, storage_pct, storage_status)
  values (v_site, 42.50, 'warning');

  select storage_pct, storage_status into v_pct, v_status
  from public.blog_quota_state where site_id = v_site;
  if v_pct <> 42.50 or coalesce(v_status, '') <> 'warning' then
    raise exception 'storage_pct/storage_status write-read mismatch: % / %', v_pct, v_status;
  end if;

  -- 未提供容量字段的 upsert(月度重置形态)不得清空既有容量值
  update public.blog_quota_state
  set read_only = false, status = 'normal'
  where site_id = v_site;
  select storage_pct, storage_status into v_pct, v_status
  from public.blog_quota_state where site_id = v_site;
  if v_pct is null or coalesce(v_status, '') <> 'warning' then
    raise exception 'monthly-reset-shaped update must not clear storage fields: % / %', v_pct, v_status;
  end if;

  -- 状态升级 full 正常
  update public.blog_quota_state set storage_status = 'full', storage_pct = 100
  where site_id = v_site;
  select storage_status into v_status from public.blog_quota_state where site_id = v_site;
  if coalesce(v_status, '') <> 'full' then
    raise exception 'storage_status upgrade to full failed: %', v_status;
  end if;

  -- 非法状态必须被 check 拒绝(read_only/paused 是流量域 status 的值,不得进入容量域)
  begin
    update public.blog_quota_state set storage_status = 'paused'
    where site_id = v_site;
    raise exception 'storage_status check constraint not enforced for paused';
  exception
    when check_violation then null; -- 预期:约束生效
  end;
end $$;

rollback;

-- ---------------------------------------------------------------------------

with relations as (
  select to_regclass('public.blog_quota_state') is not null as quota_state_exists
),
storage_columns as (
  select
    count(*) filter (
      where column_name = 'storage_pct'
        and data_type = 'numeric'
        and numeric_precision = 6
        and numeric_scale = 2
        and is_nullable = 'YES'
    ) = 1 as storage_pct_ok,
    count(*) filter (
      where column_name = 'storage_status'
        and data_type = 'text'
        and is_nullable = 'YES'
    ) = 1 as storage_status_ok,
    count(*) filter (
      where column_name in ('storage_pct', 'storage_status')
        and column_default is not null
    ) = 0 as defaults_null_ok
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'blog_quota_state'
),
constraints as (
  select
    count(*) filter (
      where conname = 'blog_quota_state_storage_status_check'
        and contype = 'c'
    ) = 1 as status_check_ok
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace ns on ns.oid = rel.relnamespace
  where ns.nspname = 'public'
    and rel.relname = 'blog_quota_state'
),
rls as (
  select coalesce(bool_and(relrowsecurity), false) as rls_enabled
  from pg_class rel
  join pg_namespace namespace on namespace.oid = rel.relnamespace
  where namespace.nspname = 'public'
    and rel.relname = 'blog_quota_state'
),
privileges as (
  select
    not has_table_privilege('anon', 'public.blog_quota_state', 'SELECT,INSERT,UPDATE,DELETE')
      as anon_no_privs,
    not has_table_privilege('authenticated', 'public.blog_quota_state', 'SELECT,INSERT,UPDATE,DELETE')
      as authenticated_no_privs,
    has_table_privilege('service_role', 'public.blog_quota_state', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      as service_role_full_privs
),
policies as (
  select count(*) = 0 as no_policies
  from pg_policies
  where schemaname = 'public'
    and tablename = 'blog_quota_state'
)
select
  '20260907.quota-domain-split.1' as revision,
  (
    quota_state_exists
    and storage_pct_ok and storage_status_ok and defaults_null_ok
    and status_check_ok
    and rls_enabled
    and anon_no_privs and authenticated_no_privs and service_role_full_privs
    and no_policies
  ) as ready,
  jsonb_build_object(
    'relations', to_jsonb(relations),
    'storage_columns', to_jsonb(storage_columns),
    'constraints', to_jsonb(constraints),
    'rls', to_jsonb(rls),
    'privileges', to_jsonb(privileges),
    'policies', to_jsonb(policies)
  ) as checks,
  case
    when not quota_state_exists then 'blog_quota_state is missing; run 015 first.'
    when not (storage_pct_ok and storage_status_ok and defaults_null_ok) then
      'storage_pct/storage_status column shape mismatch; inspect blog_quota_state.'
    when not status_check_ok then 'storage_status check constraint missing.'
    when not rls_enabled then 'RLS is not enabled on blog_quota_state.'
    when not (anon_no_privs and authenticated_no_privs) then
      'Browser-role privileges are wider than designed.'
    when not service_role_full_privs then 'service_role lacks full table privileges.'
    when not no_policies then 'Unexpected RLS policies exist on blog_quota_state.'
    else 'Ready. Storage domain columns live; main-site enforce cron can glue capacity fields daily.'
  end as next_step
from relations, storage_columns, constraints, rls, privileges, policies;
