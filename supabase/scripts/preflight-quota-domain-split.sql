-- BLOG 配额 Q-FIX preflight:blog_quota_state 增列 storage_pct / storage_status(只读)
-- Revision: 20260907.quota-domain-split.1
-- 执行本库(bloggallery)supabase/migrations/020_quota_domain_split.sql 前运行。
-- 期望 ready=true。本脚本不创建或修改任何数据。

with relations as (
  select to_regclass('public.blog_quota_state') is not null as quota_state_exists
),
columns as (
  select
    count(*) filter (where column_name = 'brand_clean') = 1 as brand_clean_present,
    count(*) filter (where column_name = 'storage_pct') = 0 as storage_pct_absent,
    count(*) filter (where column_name = 'storage_status') = 0 as storage_status_absent
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'blog_quota_state'
),
report as (
  select relations.*, columns.* from relations cross join columns
)
select
  '20260907.quota-domain-split.1' as revision,
  (quota_state_exists and brand_clean_present and storage_pct_absent and storage_status_absent) as ready,
  to_jsonb(report) as checks,
  case
    when not quota_state_exists then
      'blog_quota_state is missing; run 015_blog_quota_state.sql first.'
    when not brand_clean_present then
      'brand_clean column missing; run 017_blog_quota_state_brand_clean.sql first.'
    when not storage_pct_absent or not storage_status_absent then
      'storage_pct/storage_status column(s) already exist; inspect before running migration.'
    else 'Ready. Run 020_quota_domain_split.sql, then verify-quota-domain-split.sql.'
  end as next_step
from report;
