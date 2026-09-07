import type { NextApiRequest, NextApiResponse } from 'next'
import { verifyAdminRequest } from '@/src/lib/admin/verifyAdminRequest'
import { fetchMainSiteUsage } from '@/src/lib/storage/mainStorage'
import { getSiteQuotaState } from '@/src/lib/blog/quotaState'

// ============================================================
// 存储基座 S3FIX · BLOG 后台「存储用量」只读代理
// ------------------------------------------------------------
// 安全模型：浏览器永远拿不到 MERCHANT_API_TOKEN；本路由服务端持
// Bearer + BLOG_SITE_ID 转发主站 /api/storage/usage（同 /api/admin/attachments
// 代理惯例）。GET only，只读、不写任何状态（middleware 只读拦截不涉及；
// read_only 模式下用量条仍可展示）。
//
//   GET → 主站 /api/storage/usage?site_id={BLOG_SITE_ID}
//        → { success, usedBytes, quotaBytes, usedPct, filesCount, frozen }
//
// Q-FIX(2026-09-07)分域归一：响应并入共用库 blog_quota_state 的创作者级
// 容量口径（storagePct = 名下所有站图库 + B2 空间 vs 存储配额；
// storageStatus = normal|warning|full）——「空间容量」bar 以此为唯一容量
// 展示；usedBytes/quotaBytes/usedPct（B2 明细与上传 API 强制口径）继续
// 透传不变。quota state 读取失败时两字段为 null，前端降级 B2 口径展示。
//
// 调用方（附件管理用量条）对失败一律降级显示「—」，不阻断上传——
// 配额由主站后端强制（前端仅乐观预检）。
// ============================================================

type StorageUsageResponse = {
  success: boolean
  usedBytes?: number
  quotaBytes?: number
  usedPct?: number
  filesCount?: number
  /** S4-1/S4-3：账号级冻结态透传（主站返回；前端灰条+红字与上传禁用提示）。 */
  frozen?: boolean
  /** Q-FIX：创作者级合并容量占比（gallery+B2 vs 存储配额；null=未计算/不可用）。 */
  storagePct?: number | null
  /** Q-FIX：容量域状态 normal|warning|full（仅展示提示；null=未计算/不可用）。 */
  storageStatus?: string | null
  error?: string
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<StorageUsageResponse>
) {
  res.setHeader('Cache-Control', 'no-store')

  if (!verifyAdminRequest(req)) {
    return res.status(401).json({ success: false, error: '未授权' })
  }

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ success: false, error: 'Method not allowed' })
  }

  const result = await fetchMainSiteUsage()
  if (!result.ok) {
    return res.status(result.status).json({ success: false, error: result.error })
  }

  // Q-FIX：创作者级容量口径 best-effort（共用库抖动时置 null，不阻断用量条）
  let storagePct: number | null = null
  let storageStatus: string | null = null
  try {
    const quotaState = await getSiteQuotaState()
    storagePct = quotaState.storagePct
    storageStatus = quotaState.storageStatus
  } catch (e) {
    console.warn(
      '/api/admin/storage-usage quota state unavailable:',
      e?.message || e
    )
  }

  return res
    .status(200)
    .json({ success: true, ...result.data, storagePct, storageStatus })
}
