/**
 * 存储基座 S3:主站存储 API fetch 封装(图片双轨判定 + 附件列表/上传/删除)。
 *
 * 约定(与 src/lib/shop/merchantProducts.ts 同源):
 * - MERCHANT_API_BASE = 主站 origin(不带 /api 前缀,尾斜杠剥离;缺省回退主站正式域名);
 * - 路径一律以 / 开头拼在 base 后;MERCHANT_API_TOKEN 仅服务端使用,绝不回传浏览器;
 * - BLOG 站身份 = BLOG_SITE_ID(merchant_services.id),缺失时一律按 legacy 降级;
 * - 图床双轨判定 GET /api/storage/image-backend?site_id= 带 60s 进程内缓存,
 *   任何失败(未配置/超时/非白名单)一律回退 legacy_landcloud——旧链路(兰空)保持可用,
 *   宁可停在旧链也不落到未配置的新链(与主站 lib/storage/quota.ts 同语义)。
 */

import { getBlogSiteIdOrNull } from '@/src/lib/gallery/blogSite'

export type SiteImageBackend = 'legacy_landcloud' | 'storage_base'

const IMAGE_BACKEND_CACHE_MS = 60_000
const MAIN_FETCH_TIMEOUT_MS = 8_000
const MAIN_UPLOAD_TIMEOUT_MS = 30_000

/** 主站网关 origin(不带 /api;MERCHANT_API_BASE 惯例与商品查询一致) */
export function resolveMainStorageBase(): string {
  return (
    (process.env.MERCHANT_API_BASE || '').trim().replace(/\/+$/, '') ||
    'https://creator.proplus.onl'
  )
}

function mainApiToken(): string {
  return (process.env.MERCHANT_API_TOKEN || '').trim()
}

let backendMemo: { value: SiteImageBackend; at: number } | null = null
let backendInflight: Promise<SiteImageBackend> | null = null

/**
 * 当前站点的图床后端(60s 缓存;失败不缓存,下一张图自动重试)。
 * 模板编辑器图片上传前调用;video 不走本判定(仅 image 双轨)。
 */
export async function resolveSiteImageBackend(): Promise<SiteImageBackend> {
  const siteId = getBlogSiteIdOrNull()
  if (!siteId) return 'legacy_landcloud'

  if (backendMemo && Date.now() - backendMemo.at < IMAGE_BACKEND_CACHE_MS) {
    return backendMemo.value
  }
  if (backendInflight) return backendInflight

  backendInflight = (async (): Promise<SiteImageBackend> => {
    try {
      const res = await fetch(
        `${resolveMainStorageBase()}/api/storage/image-backend?site_id=${siteId}`,
        {
          headers: {
            Accept: 'application/json',
            ...(mainApiToken() ? { Authorization: `Bearer ${mainApiToken()}` } : {}),
          },
          signal: AbortSignal.timeout(MAIN_FETCH_TIMEOUT_MS),
          cache: 'no-store',
        }
      )
      if (!res.ok) return 'legacy_landcloud'
      const payload = (await res.json()) as { backend?: unknown }
      const value: SiteImageBackend =
        payload?.backend === 'storage_base' ? 'storage_base' : 'legacy_landcloud'
      backendMemo = { value, at: Date.now() }
      return value
    } catch {
      // 查询失败按 legacy 兜底且不缓存(短暂故障后下一张图即恢复)
      return 'legacy_landcloud'
    } finally {
      backendInflight = null
    }
  })()

  return backendInflight
}

/** 测试辅助:清空图床后端缓存 */
export function __resetImageBackendCacheForTest(): void {
  backendMemo = null
  backendInflight = null
}

// ---------------------------------------------------------------------------
// 附件(attachment)主站代理原语:列表 / 上传 / 删除
// ---------------------------------------------------------------------------

export type MainSiteAttachment = {
  key: string
  original_name: string | null
  size: number
  mime: string | null
  created_at: string
  /** 模板侧拼接的绝对下载地址(`${base}/files/${key}`) */
  download_url: string
}

const POST_KEY_RE = /^[a-z0-9-]{1,120}$/

/** 附件关联文章 slug 白名单(与主站上传 API/migration CHECK 同口径) */
export function isValidAttachmentPostKey(raw: string): boolean {
  return POST_KEY_RE.test((raw || '').trim())
}

type MainCallResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string }

async function mainFetchJson<T>(
  url: string,
  init: RequestInit
): Promise<MainCallResult<T>> {
  try {
    const res = await fetch(url, {
      ...init,
      headers: {
        Accept: 'application/json',
        ...(mainApiToken() ? { Authorization: `Bearer ${mainApiToken()}` } : {}),
        ...(init.headers as Record<string, string> | undefined),
      },
    })
    const payload = (await res.json().catch(() => null)) as
      | (T & { success?: boolean; message?: string; error?: string })
      | null
    if (!res.ok || !payload || payload.success === false) {
      return {
        ok: false,
        status: res.status,
        error: payload?.message || payload?.error || `主站接口返回 HTTP ${res.status}`,
      }
    }
    return { ok: true, data: payload as T }
  } catch (error) {
    return {
      ok: false,
      status: 502,
      error: error instanceof Error ? error.message : '主站接口请求失败',
    }
  }
}

/** 读取某文章 slug 的附件列表(主站返回白名单字段 + 模板拼绝对下载地址)。 */
export async function listMainSiteAttachments(postKey: string): Promise<MainCallResult<{ items: MainSiteAttachment[] }>> {
  const siteId = getBlogSiteIdOrNull()
  const slug = (postKey || '').trim()
  if (!siteId) return { ok: false, status: 500, error: '站点身份尚未配置(BLOG_SITE_ID)' }
  if (!isValidAttachmentPostKey(slug)) return { ok: false, status: 400, error: '文章 slug 格式不合法' }

  const base = resolveMainStorageBase()
  const result = await mainFetchJson<{ items: Array<Omit<MainSiteAttachment, 'download_url'>> }>(
    `${base}/api/storage/attachments?site_id=${siteId}&post_key=${encodeURIComponent(slug)}`,
    { method: 'GET' }
  )
  if (!result.ok) return result

  return {
    ok: true,
    data: {
      items: (result.data.items || []).map((item) => ({
        ...item,
        download_url: `${base}/files/${item.key}`,
      })),
    },
  }
}

/** 上传附件(type=attachment + post_key;buffer 来自模板服务端读流,不经浏览器)。 */
export async function uploadMainSiteAttachment(input: {
  buffer: Buffer
  filename: string
  contentType: string
  postKey: string
}): Promise<MainCallResult<{ key: string; url: string; size: number }>> {
  const siteId = getBlogSiteIdOrNull()
  const slug = (input.postKey || '').trim()
  if (!siteId) return { ok: false, status: 500, error: '站点身份尚未配置(BLOG_SITE_ID)' }
  if (!isValidAttachmentPostKey(slug)) return { ok: false, status: 400, error: '文章 slug 格式不合法' }
  if (!mainApiToken()) return { ok: false, status: 500, error: '主站凭据未配置(MERCHANT_API_TOKEN)' }

  const form = new FormData()
  form.append(
    'file',
    new Blob([input.buffer], { type: input.contentType }),
    input.filename || 'attachment'
  )
  form.append('type', 'attachment')
  form.append('site_id', siteId)
  form.append('post_key', slug)

  return mainFetchJson<{ key: string; url: string; size: number }>(
    `${resolveMainStorageBase()}/api/storage/upload`,
    {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(MAIN_UPLOAD_TIMEOUT_MS),
    }
  )
}

/** 删除附件(软删元数据 + 驱动删除;幂等)。 */
export async function deleteMainSiteObject(key: string): Promise<MainCallResult<{ key: string; already_deleted?: boolean }>> {
  const siteId = getBlogSiteIdOrNull()
  const trimmed = (key || '').trim()
  if (!siteId) return { ok: false, status: 500, error: '站点身份尚未配置(BLOG_SITE_ID)' }
  if (!trimmed) return { ok: false, status: 400, error: '缺少待删除对象 key' }

  return mainFetchJson<{ key: string; already_deleted?: boolean }>(
    `${resolveMainStorageBase()}/api/storage/delete`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: trimmed, site_id: siteId }),
    }
  )
}
