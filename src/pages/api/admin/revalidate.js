import { slugify } from '@/src/lib/util'
import CONFIG from '@/blog.config'
import {
  clearContentBuildCaches,
  collectDeleteRevalidatePaths,
  collectDownloadInstructionsRevalidatePaths,
  collectGalleryAdRevalidatePaths,
  collectPageRevalidatePaths,
  collectPostRevalidatePaths,
  collectShellRevalidatePaths,
  collectShellWithCustomPagePaths,
  collectSiteConfigRevalidatePaths,
  collectThemePostRevalidatePaths,
  revalidateMany,
  resolveRevalidateOrigin,
} from '@/src/lib/blog/contentRevalidation'
import {
  claimDueRevalidateJobs,
  countPendingRevalidateJobs,
  enqueueRevalidatePaths,
  getDefaultRevalidateQueueDelayMs,
  getNewPostSlugsFromReason,
  isRevalidateQueueConfigured,
  markRevalidateJobDone,
  markRevalidateJobFailed,
  resetStaleRevalidateJobs,
} from '@/src/lib/blog/revalidateQueue'
import { isPostIndexedBySlug } from '@/src/lib/notion/getBlogData'
import { getBlogSiteIdOrNull } from '@/src/lib/gallery/blogSite'
import { getSupabaseAdmin } from '@/src/lib/supabase/admin'

export const config = {
  maxDuration: 300,
}

/** 手动「刷新BLOG」最小间隔（服务端持久化兜底，防多标签/脚本连点） */
const MANUAL_SHELL_REVALIDATE_MIN_MS = 30 * 60 * 1000
let lastManualShellRevalidateAt = 0

const MANUAL_REFRESH_TABLE = 'blog_site_settings'
const MANUAL_REFRESH_COLUMN = 'last_manual_refresh_at'
/** 进程内兜底（无 Supabase / 无 site_id 时尽力限制，与 fullRedeploy.ts 同风格） */
const memoryLastManualRefresh = new Map()

function formatManualRefreshRetryHint(retryAfterSec) {
  const s = Math.max(0, Math.ceil(Number(retryAfterSec) || 0))
  return s >= 60 ? `${Math.round(s / 60)} 分钟` : `${s} 秒`
}

async function readLastManualRefreshMs(siteId) {
  const supabase = getSupabaseAdmin()
  if (supabase) {
    const { data, error } = await supabase
      .from(MANUAL_REFRESH_TABLE)
      .select(MANUAL_REFRESH_COLUMN)
      .eq('site_id', siteId)
      .maybeSingle()
    if (!error && data?.[MANUAL_REFRESH_COLUMN]) {
      const ms = new Date(data[MANUAL_REFRESH_COLUMN]).getTime()
      if (!Number.isNaN(ms)) return ms
    }
  }
  const mem = memoryLastManualRefresh.get(siteId)
  return typeof mem === 'number' ? mem : null
}

async function writeLastManualRefreshMs(siteId, atMs) {
  memoryLastManualRefresh.set(siteId, atMs)

  const supabase = getSupabaseAdmin()
  if (!supabase) return

  const at = new Date(atMs).toISOString()
  const { error: updateError } = await supabase
    .from(MANUAL_REFRESH_TABLE)
    .update({ [MANUAL_REFRESH_COLUMN]: at, updated_at: at })
    .eq('site_id', siteId)

  if (!updateError) return

  const { error: upsertError } = await supabase.from(MANUAL_REFRESH_TABLE).upsert(
    {
      site_id: siteId,
      theme_code: 'gallery',
      [MANUAL_REFRESH_COLUMN]: at,
      updated_at: at,
    },
    { onConflict: 'site_id' }
  )

  if (upsertError) {
    throw new Error(upsertError.message)
  }
}

function isMissingRevalidateQueueTable(error) {
  const code = String(error?.code || '')
  const message = String(error?.message || error || '')
  return code === '42P01' || /blog_revalidate_queue/i.test(message)
}

async function drainRevalidateQueue(res, limit = 25) {
  if (!isRevalidateQueueConfigured()) {
    return {
      success: false,
      configured: false,
      drained: 0,
      failed: 0,
      pending: 0,
      results: [],
      error: '文章更新队列尚未配置',
    }
  }

  const staleReset = await resetStaleRevalidateJobs()
  const jobs = await claimDueRevalidateJobs(limit)
  if (jobs.length === 0) {
    const pending = await countPendingRevalidateJobs()
    return {
      success: true,
      configured: true,
      drained: 0,
      failed: 0,
      pending,
      staleReset,
      results: [],
    }
  }

  const newPostSlugs = Array.from(
    new Set(jobs.flatMap((job) => getNewPostSlugsFromReason(job.reason)))
  )
  const indexedBySlug = new Map()
  await Promise.all(
    newPostSlugs.map(async (slug) => {
      try {
        indexedBySlug.set(slug, await isPostIndexedBySlug(slug))
      } catch (error) {
        console.warn(`[admin/revalidate] Notion index check failed: ${slug}`, error)
        indexedBySlug.set(slug, false)
      }
    })
  )

  const deferredJobs = jobs.filter((job) =>
    getNewPostSlugsFromReason(job.reason).some(
      (slug) => indexedBySlug.get(slug) !== true
    )
  )
  const deferredIds = new Set(deferredJobs.map((job) => job.id))
  const readyJobs = jobs.filter((job) => !deferredIds.has(job.id))
  const deferredResults = deferredJobs.map((job) => ({
    path: job.path,
    ok: false,
    error: '新文章尚在同步，已自动延迟重试',
  }))

  for (const job of deferredJobs) {
    await markRevalidateJobFailed(
      job,
      '新文章尚在同步，已自动延迟重试'
    )
  }

  const readyPaths = readyJobs.map((job) => job.path)
  const readyResults = readyJobs.length > 0
    ? await revalidateMany(res, readyPaths, {
        freshTheme: readyJobs.some((job) => job.fresh_theme),
        clearCaches: readyJobs.some((job) => job.clear_caches),
        warmPaths: readyJobs.some((job) => job.warm_paths),
        origin: readyJobs.some((job) => job.warm_paths)
          ? resolveRevalidateOrigin()
          : undefined,
        expectedTheme:
          readyJobs.find((job) => job.expected_theme)?.expected_theme || null,
        contentChange: readyJobs.some((job) => job.content_change),
      })
    : []
  const results = [...deferredResults, ...readyResults]
  const resultByPath = new Map(readyResults.map((item) => [item.path, item]))

  let failed = deferredJobs.length
  for (const job of readyJobs) {
    const result = resultByPath.get(job.path)
    if (result?.ok) {
      await markRevalidateJobDone(job.id)
    } else {
      failed += 1
      await markRevalidateJobFailed(
        job,
        result?.error || 'revalidate failed'
      )
    }
  }

  const pending = await countPendingRevalidateJobs()
  return {
    success: failed === 0,
    configured: true,
    drained: jobs.length,
    succeeded: jobs.length - failed,
    failed,
    pending,
    staleReset,
    results,
  }
}

function resolveTagIds(tagsString) {
  return (tagsString || '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
    .map((name) => slugify(name))
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' })
  }

  try {
    if (req.body?.action === 'drain') {
      const result = await drainRevalidateQueue(res, req.body?.limit)
      return res.status(result.configured === false ? 503 : 200).json(result)
    }

    const {
      scope = 'post',
      slug,
      category,
      tags,
      previousCategory,
      previousTags,
      previousSlug,
      listScope = 'shell',
      paths: explicitPaths,
      clearCaches = true,
      freshTheme = false,
      warmPaths = false,
      expectedTheme = null,
      manualShell = false,
      contentChange = false,
      queue = false,
      queueDelayMs,
      queuePriority = 0,
      queueReason,
      queueMaxAttempts,
    } = req.body ?? {}

    if (scope === 'shell' && manualShell) {
      const now = Date.now()
      const siteId = getBlogSiteIdOrNull()
      let lastAt = lastManualShellRevalidateAt
      if (siteId) {
        try {
          const persisted = await readLastManualRefreshMs(siteId)
          if (typeof persisted === 'number' && persisted > lastAt) {
            lastAt = persisted
          }
        } catch (cooldownReadError) {
          console.warn(
            '[admin/revalidate] read manual refresh cooldown failed',
            cooldownReadError
          )
        }
      }
      const elapsed = now - lastAt
      if (lastAt > 0 && elapsed < MANUAL_SHELL_REVALIDATE_MIN_MS) {
        const retryAfterSec = Math.ceil(
          (MANUAL_SHELL_REVALIDATE_MIN_MS - elapsed) / 1000
        )
        return res.status(429).json({
          success: false,
          error: `刷新过于频繁，请 ${formatManualRefreshRetryHint(retryAfterSec)}后再试`,
          retryAfterSec,
        })
      }
      lastManualShellRevalidateAt = now
      if (siteId) {
        try {
          await writeLastManualRefreshMs(siteId, now)
        } catch (cooldownWriteError) {
          console.warn(
            '[admin/revalidate] persist manual refresh cooldown failed',
            cooldownWriteError
          )
        }
      }
    }

    if (scope === 'list') {
      let paths = []
      if (listScope === 'full' || listScope === 'site-config') {
        paths = await collectSiteConfigRevalidatePaths()
      } else if (listScope === 'shell') {
        paths = await collectShellWithCustomPagePaths()
      } else if (listScope === 'theme') {
        paths = await collectGalleryAdRevalidatePaths()
      } else if (listScope === 'theme-posts') {
        paths = await collectThemePostRevalidatePaths()
      } else if (listScope === 'download-instructions') {
        paths = await collectDownloadInstructionsRevalidatePaths()
      } else if (listScope === 'gallery-ad' || listScope === 'vending' || listScope === 'announcement-popup') {
        // 全站渲染面：gallery-ad 全主题文章内页+下载页；vending/公告弹窗经 withNavFooter 壳层在全部公开页面生效
        paths = await collectGalleryAdRevalidatePaths()
      } else if (listScope === 'popup-ad' || listScope === 'click-ad') {
        // 仅首页渲染（SitePopups 内 isHomePage 守卫，非首页不展示）
        paths = ['/']
      } else if (listScope === 'social-links') {
        // 壳层渲染面（gallery 侧栏/tweet Contact/shop Footer/首页 Profile），与 nav/footer 刷新口径一致
        paths = await collectShellWithCustomPagePaths()
      } else if (listScope === 'banner') {
        // P18-C4-1: Banner 仅 shop 首页顶部渲染
        paths = ['/']
      }
      return res.status(200).json({
        success: true,
        paths,
        total: paths.length,
      })
    }

    const categoryId = category?.trim() ? slugify(category.trim()) : null
    const previousCategoryId = previousCategory?.trim()
      ? slugify(previousCategory.trim())
      : null
    const tagIds = resolveTagIds(tags)
    const previousTagIds = resolveTagIds(previousTags)

    let paths
    if (scope === 'batch') {
      paths = Array.isArray(explicitPaths) ? explicitPaths : []
    } else if (scope === 'full' || scope === 'site-config') {
      paths = await collectSiteConfigRevalidatePaths()
    } else if (scope === 'shell') {
      paths = await collectShellWithCustomPagePaths()
    } else if (scope === 'gallery-ad' || scope === 'vending' || scope === 'announcement-popup') {
      // 全站渲染面：gallery-ad 全主题文章内页+下载页；vending/公告弹窗经 withNavFooter 壳层在全部公开页面生效
      paths = await collectGalleryAdRevalidatePaths()
    } else if (scope === 'popup-ad' || scope === 'click-ad') {
      // 仅首页渲染（SitePopups 内 isHomePage 守卫，非首页不展示）
      paths = ['/']
    } else if (scope === 'social-links') {
      // 壳层渲染面（gallery 侧栏/tweet Contact/shop Footer/首页 Profile），与 nav/footer 刷新口径一致
      paths = await collectShellWithCustomPagePaths()
    } else if (scope === 'banner') {
      // P18-C4-1: Banner 仅 shop 首页顶部渲染
      paths = ['/']
    } else if (scope === 'delete' && slug) {
      paths = await collectDeleteRevalidatePaths(slug, {
        categoryId,
        previousCategoryId,
        tagIds,
        previousTagIds,
      })
    } else if (scope === 'post' && slug) {
      paths = await collectPostRevalidatePaths(slug, {
        categoryId,
        previousCategoryId,
        tagIds,
        previousTagIds,
        previousSlug,
      })
    } else if (scope === 'page' && slug) {
      if (slug === CONFIG.DEFAULT_SPECIAL_PAGES.DOWNLOAD) {
        paths = await collectDownloadInstructionsRevalidatePaths()
      } else {
        paths = collectPageRevalidatePaths(slug, { previousSlug })
      }
    } else if (scope === 'friends') {
      paths = ['/', '/friends']
    } else if (scope === 'widget') {
      paths = ['/', '/about', '/download']
    } else if (slug) {
      paths = await collectPostRevalidatePaths(slug, {
        categoryId,
        previousCategoryId,
        tagIds,
        previousTagIds,
        previousSlug,
      })
    } else {
      paths = collectShellRevalidatePaths()
    }

    if (clearCaches && scope !== 'batch') {
      clearContentBuildCaches()
    }

    if (queue) {
      let queued = null
      try {
        queued = await enqueueRevalidatePaths(paths, {
          scope,
          reason: queueReason || scope,
          priority: queuePriority,
          maxAttempts: queueMaxAttempts,
          delayMs:
            queueDelayMs == null
              ? getDefaultRevalidateQueueDelayMs()
              : queueDelayMs,
          freshTheme,
          clearCaches,
          warmPaths: Boolean(warmPaths),
          expectedTheme: expectedTheme || null,
          contentChange: Boolean(contentChange),
        })
      } catch (queueError) {
        if (!isMissingRevalidateQueueTable(queueError)) throw queueError
        console.warn(
          '[admin/revalidate] queue table missing; falling back to immediate revalidate'
        )
      }

      if (queued?.configured) {
        return res.status(200).json({
          success: true,
          queued: true,
          total: queued.paths.length,
          queuedCount: queued.queued,
          paths: queued.paths,
          scheduledAt: queued.scheduledAt,
          drainAfterMs: queued.drainAfterMs,
        })
      }

      console.warn(
        '[admin/revalidate] queue requested but not configured; falling back to immediate revalidate'
      )
    }

    if (warmPaths) {
      console.log('[admin/revalidate] warmPaths', {
        scope,
        pathCount: paths.length,
        origin: resolveRevalidateOrigin(req),
        expectedTheme: expectedTheme || null,
      })
    }

    const results = await revalidateMany(res, paths, {
      freshTheme,
      clearCaches: scope === 'batch' ? clearCaches : false,
      warmPaths: Boolean(warmPaths),
      origin: warmPaths ? resolveRevalidateOrigin(req) : undefined,
      expectedTheme: expectedTheme || null,
      contentChange: Boolean(contentChange),
    })
    const failed = results.filter((item) => !item.ok)
    const succeeded = results.filter((item) => item.ok)

    return res.status(200).json({
      success: failed.length === 0,
      total: results.length,
      succeeded: succeeded.length,
      failed: failed.length,
      paths,
      results,
    })
  } catch (error) {
    console.error('admin revalidate error:', error)
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
