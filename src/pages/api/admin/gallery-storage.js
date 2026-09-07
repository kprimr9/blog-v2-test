import { isGalleryTenantConfigured } from '@/src/lib/gallery/blogSite'
import {
  canAddGalleryPendingBytes,
  formatGalleryStorageBytes,
  resolveGalleryQuotaBytes,
  getGalleryStorageStats,
} from '@/src/lib/gallery/galleryStorage'
import { getSiteQuotaState } from '@/src/lib/blog/quotaState'

export default async function handler(req, res) {
  if (!isGalleryTenantConfigured()) {
    return res.status(503).json({
      success: false,
      configured: false,
      error: '图库容量统计暂未启用。',
    })
  }

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ success: false, error: '不支持的请求方法' })
  }

  try {
    const pendingBytes = Math.max(
      0,
      parseInt(String(req.query.pendingBytes || '0'), 10) || 0
    )

    const stats = await getGalleryStorageStats()
    const check =
      pendingBytes > 0 ? await canAddGalleryPendingBytes(pendingBytes) : null

    // BLOG 分层 P4:会员计划与本月用量百分比(只读短缓存;失败仅隐藏「本月用量」区块)
    let quota = null
    try {
      const state = await getSiteQuotaState()
      quota = {
        plan: state.plan,
        status: state.status,
        readOnly: state.readOnly,
        pvPct: state.pvPct,
        bwPct: state.bwPct,
        galleryPct: state.galleryPct,
        // Q-FIX:创作者级合并容量口径(唯一容量展示;null=未计算)
        storagePct: state.storagePct,
        storageStatus: state.storageStatus,
      }
    } catch (e) {
      console.warn('/api/admin/gallery-storage quota state unavailable:', e?.message || e)
    }

    // P2-A 修:quotaLabel 走 plan 感知配额(env 覆盖优先,否则 free 5GB / pro 50GB)
    const quotaBytesForLabel = await resolveGalleryQuotaBytes()

    return res.status(200).json({
      success: true,
      configured: true,
      ...stats,
      quota,
      quotaLabel: formatGalleryStorageBytes(quotaBytesForLabel),
      usedLabel: formatGalleryStorageBytes(stats.usedBytes),
      remainingLabel: formatGalleryStorageBytes(stats.remainingBytes),
      canUpload: check ? check.ok : stats.remainingBytes > 0,
      pendingBytes,
      quotaMessage: check && !check.ok ? check.message : undefined,
    })
  } catch (e) {
    console.error('/api/admin/gallery-storage', e)
    return res.status(500).json({
      success: false,
      error: e?.message || '读取图库容量失败',
    })
  }
}
