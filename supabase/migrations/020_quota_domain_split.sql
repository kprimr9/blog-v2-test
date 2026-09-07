-- ============================================================
-- BLOG 配额 Q-FIX:容量域分列(storage_pct / storage_status)
-- Revision: 20260907.quota-domain-split.1
-- 依据:MERCHANT_QUOTA_QFIX_BRIEF.md A(分域归一:容量退出 P3 停站状态机)
--
-- 共用库(bloggallery):site_id 即主站 merchant_services.id。
-- 主站写入点:/api/cron/enforce-blog-quota 容量域(创作者级合并口径 =
--   名下所有站 gallery_images 字节 + 主站库 storage_objects 未软删字节
--   vs 存储配额 free 500MB / pro 100GB):
--   - storage_pct numeric(6,2) null:创作者级合并容量占比(仅展示;同 creator
--     各站同步写;null=尚未计算,如 020 刚执行、cron 未跑或计量读取失败降级);
--   - storage_status text null check('normal','warning','full'):
--     >=70% warning / >=100% full;仅通知与展示用 ——
--     不驱动 read_only/status(那是流量域 PV/带宽 专属状态机);
--     容量不随月度重置清零(monthly_reset patch 不触碰本二列)。
-- 超限实际强制在主站上传 API(429/403)与兰空链路站内硬闸,不在本表。
--
-- 本迁移只加列;015 的 RLS / revoke / grant 对表继续生效,
-- alter 不改变既有权限(verify 断言权限与 015/016/017 verify 口径一致)。
--
-- 执行顺序:
--   supabase/scripts/preflight-quota-domain-split.sql(只读,期望 ready=true)
--   → 本迁移 → supabase/scripts/verify-quota-domain-split.sql(断言+行为自检,期望 ready=true)
-- ============================================================

alter table public.blog_quota_state
  add column if not exists storage_pct numeric(6,2),
  add column if not exists storage_status text;

alter table public.blog_quota_state
  drop constraint if exists blog_quota_state_storage_status_check;

alter table public.blog_quota_state
  add constraint blog_quota_state_storage_status_check
  check (storage_status in ('normal','warning','full'));

comment on column public.blog_quota_state.storage_pct is
  'Q-FIX 容量域:创作者级合并容量占比(gallery+storage_objects vs 存储配额 free500MB/pro100GB;numeric 6,2;主站 enforce cron 每日写入;同 creator 各站同步;仅展示,null=未计算)';
comment on column public.blog_quota_state.storage_status is
  'Q-FIX 容量域状态:normal|warning(>=70%)|full(>=100%);仅通知与展示,不驱动只读/暂停;容量不随月度重置清零';
