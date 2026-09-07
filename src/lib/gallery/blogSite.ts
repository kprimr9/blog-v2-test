import { isSupabaseGalleryConfigured } from '@/src/lib/supabase/admin'

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isValidBlogSiteId(siteId: string): boolean {
  return UUID_RE.test(siteId.trim())
}

/** 当前 Blog 部署绑定的商户站点 ID（merchant_services.id） */
export function getBlogSiteId(): string {
  const siteId = process.env.BLOG_SITE_ID?.trim()
  if (!siteId) {
    throw new Error('站点身份尚未配置')
  }
  if (!isValidBlogSiteId(siteId)) {
    throw new Error('站点身份配置无效')
  }
  return siteId
}

export function getBlogSiteIdOrNull(): string | null {
  const siteId = process.env.BLOG_SITE_ID?.trim()
  if (!siteId || !isValidBlogSiteId(siteId)) return null
  return siteId
}

/** 图库 / 统计：Supabase + BLOG_SITE_ID 均已配置 */
export function isGalleryTenantConfigured(): boolean {
  return isSupabaseGalleryConfigured() && Boolean(getBlogSiteIdOrNull())
}

/** 图库配额（GB）与会员计划的关系（P2-A 修：免费 5GB / 专业版 50GB，
 * 与平台 PLAN_LIMITS.galleryGb 及 /admin/blogs/pause 判定常量一致）。 */
export const GALLERY_QUOTA_GB_FREE = 5
export const GALLERY_QUOTA_GB_PRO = 50

export function getGalleryQuotaGbForPlan(plan: 'free' | 'pro'): number {
  return plan === 'pro' ? GALLERY_QUOTA_GB_PRO : GALLERY_QUOTA_GB_FREE
}

/**
 * 每商户图库容量上限（字节）。
 * P2-A 修（Q-FIX）：显式 env 覆盖（GALLERY_QUOTA_GB，运维逐站扩容用）优先；
 * 未配置时按会员计划走 free 5GB / pro 50GB（此前默认一律 50GB，
 * 免费站形同失效）。plan 判定由调用方传入（galleryStorage.resolveGalleryQuotaBytes
 * 读共用库 blog_quota_state，读取失败按 free 安全侧兜底）。
 */
export function getGalleryQuotaBytesForPlan(plan: 'free' | 'pro'): number {
  const raw = process.env.GALLERY_QUOTA_GB?.trim()
  if (raw) {
    const gb = parseFloat(raw)
    if (Number.isFinite(gb) && gb > 0) {
      return gb * 1024 * 1024 * 1024
    }
  }
  return getGalleryQuotaGbForPlan(plan) * 1024 * 1024 * 1024
}

/** @deprecated 旧口径：env 缺省时一律 50GB。仅为兼容残留调用保留；
 * 新调用一律走 galleryStorage.resolveGalleryQuotaBytes（plan 感知）。 */
export function getGalleryQuotaBytes(): number {
  const raw = process.env.GALLERY_QUOTA_GB?.trim()
  const gb = raw ? parseFloat(raw) : 50
  if (!Number.isFinite(gb) || gb <= 0) {
    return 50 * 1024 * 1024 * 1024
  }
  return gb * 1024 * 1024 * 1024
}

export function formatGalleryStorageBytes(bytes: number): string {
  const n = Math.max(0, Number(bytes) || 0)
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GB`
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`
  if (n >= 1024) return `${Math.round(n / 1024)} KB`
  return `${n} B`
}
