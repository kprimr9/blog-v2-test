import type { NextApiRequest, NextApiResponse } from 'next'
import { verifyAdminRequest } from '@/src/lib/admin/verifyAdminRequest'
import { fetchMainSiteUsage } from '@/src/lib/storage/mainStorage'

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

  return res.status(200).json({ success: true, ...result.data })
}
