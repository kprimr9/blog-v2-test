import type { NextApiRequest, NextApiResponse } from 'next'
import {
  isValidAttachmentPostKey,
  listMainSiteAttachments,
  type MainSiteAttachment,
} from '@/src/lib/storage/mainStorage'

// ============================================================
// 存储基座 S3 · 文章页公开附件列表（访客下载按钮数据源）
// ------------------------------------------------------------
// - GET ?slug=<文章 slug> → 服务端持 Bearer 查主站附件列表并拼接
//   绝对下载地址（${MERCHANT_API_BASE}/files/{key}）；
// - 无 admin 鉴权（附件本身即公开下载物，/files/{key} 公开）；
//   site_id 固定取 BLOG_SITE_ID，不接受调用方指定；
// - slug 白名单校验（[a-z0-9-]{1,120}）；no-store（上传/删除即时可见）；
// - 失败一律 200 + items=[]（文章页渲染区块直接隐藏，不打扰访客），
//   服务端日志记录真实原因。
// ============================================================

type PublicAttachmentsResponse = {
  success: boolean
  items: MainSiteAttachment[]
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<PublicAttachmentsResponse>
) {
  res.setHeader('Cache-Control', 'no-store')

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ success: false, items: [] })
  }

  const raw = Array.isArray(req.query.slug) ? req.query.slug[0] : req.query.slug
  const slug = String(raw || '').trim()
  if (!slug || !isValidAttachmentPostKey(slug)) {
    return res.status(400).json({ success: false, items: [] })
  }

  const result = await listMainSiteAttachments(slug)
  if (!result.ok) {
    console.warn('[attachments] 文章附件列表读取失败:', result.error)
    // 静默降级：文章页区块隐藏，不打扰访客
    return res.status(200).json({ success: false, items: [] })
  }

  return res.status(200).json({ success: true, items: result.data.items })
}
