import type { NextApiRequest, NextApiResponse } from 'next'
import { verifyAdminRequest } from '@/src/lib/admin/verifyAdminRequest'
import {
  deleteMainSiteObject,
  listMainSiteAttachments,
  uploadMainSiteAttachment,
  type MainSiteAttachment,
} from '@/src/lib/storage/mainStorage'

// ============================================================
// 存储基座 S3 · BLOG 后台「附件」代理（编辑器附件区唯一入口）
// ------------------------------------------------------------
// 安全模型：浏览器永远拿不到 MERCHANT_API_TOKEN；本路由服务端持
// Bearer + BLOG_SITE_ID 转发主站存储 API（同 /api/admin/upload 双轨惯例）。
//
//   GET    ?slug=<文章 slug>  → 主站 /api/storage/attachments 列表
//                              （items 含模板拼接的绝对 download_url）
//   POST   ?slug=<文章 slug>  → 原始二进制流（x-file-name + content-type 头）
//                              → 主站 /api/storage/upload（type=attachment + post_key）
//   DELETE {key}              → 主站 /api/storage/delete（软删 + 幂等）
//
// 附件类型/大小白名单由主站统一裁决（pdf/zip/doc 类，≤50MB）；
// 本地仅先做粗判（非 GET 方法 + verifyAdminRequest；middleware 只读拦截清单
// 已含 /api/admin/attachments）。
// ============================================================

// 关闭 Next 自带 body 解析：POST 走原始二进制流（与 /api/admin/upload 同惯例）
export const config = {
  api: {
    bodyParser: false,
  },
}

const MAX_ATTACHMENT_MB = 50
const MAX_SIZE = MAX_ATTACHMENT_MB * 1024 * 1024

const ATTACHMENT_EXT_RE = /\.(pdf|zip|rar|7z|doc|docx|xls|xlsx|txt)$/i

type AttachmentsApiResponse = {
  success: boolean
  items?: MainSiteAttachment[]
  item?: MainSiteAttachment
  error?: string
}

function fail(res: NextApiResponse<AttachmentsApiResponse>, status: number, error: string) {
  return res.status(status).json({ success: false, error })
}

function readRawBody(req: NextApiRequest): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_SIZE) {
        reject(new Error('FILE_TOO_LARGE'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

function requestSlug(req: NextApiRequest): string {
  const raw = Array.isArray(req.query.slug) ? req.query.slug[0] : req.query.slug
  return String(raw || '').trim()
}

function readJsonBody(req: NextApiRequest): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > 1024 * 1024) {
        reject(new Error('BODY_TOO_LARGE'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}'))
      } catch {
        reject(new Error('INVALID_JSON'))
      }
    })
    req.on('error', reject)
  })
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<AttachmentsApiResponse>
) {
  res.setHeader('Cache-Control', 'no-store')

  if (!verifyAdminRequest(req)) {
    return fail(res, 401, '未授权')
  }

  // ---- GET：列表 ----
  if (req.method === 'GET') {
    const slug = requestSlug(req)
    if (!slug) return fail(res, 400, '缺少文章 slug')
    const result = await listMainSiteAttachments(slug)
    if (!result.ok) return fail(res, result.status, result.error)
    return res.status(200).json({ success: true, items: result.data.items })
  }

  // ---- POST：上传（原始二进制 + x-file-name） ----
  if (req.method === 'POST') {
    const slug = requestSlug(req)
    if (!slug) return fail(res, 400, '缺少文章 slug')

    let buffer: Buffer
    try {
      buffer = await readRawBody(req)
    } catch (error) {
      if ((error as Error).message === 'FILE_TOO_LARGE') {
        return fail(res, 413, `附件过大，单文件上限 ${MAX_ATTACHMENT_MB}MB`)
      }
      return fail(res, 400, '读取文件数据失败')
    }
    if (!buffer || buffer.length === 0) {
      return fail(res, 400, '未接收到文件数据')
    }

    const rawName = req.headers['x-file-name']
      ? decodeURIComponent(String(req.headers['x-file-name']))
      : `attachment-${Date.now()}.pdf`
    const contentType = String(req.headers['content-type'] || 'application/octet-stream')

    if (!ATTACHMENT_EXT_RE.test(rawName)) {
      return fail(
        res,
        415,
        '附件仅支持 pdf / zip / rar / 7z / doc / docx / xls / xlsx / txt 格式'
      )
    }

    const result = await uploadMainSiteAttachment({
      buffer,
      filename: rawName,
      contentType,
      postKey: slug,
    })
    if (!result.ok) return fail(res, result.status, result.error)

    const base = (
      process.env.MERCHANT_API_BASE || 'https://creator.proplus.onl'
    ).trim().replace(/\/+$/, '')
    return res.status(200).json({
      success: true,
      item: {
        key: result.data.key,
        original_name: rawName,
        size: result.data.size ?? buffer.length,
        mime: contentType,
        created_at: new Date().toISOString(),
        download_url: `${base}/files/${result.data.key}`,
      },
    })
  }

  // ---- DELETE：删除（JSON {key}；主站软删 + 幂等） ----
  if (req.method === 'DELETE') {
    let body: Record<string, unknown>
    try {
      body = await readJsonBody(req)
    } catch (error) {
      const message = (error as Error).message
      if (message === 'BODY_TOO_LARGE') return fail(res, 413, '请求体过大')
      return fail(res, 400, '请求体必须是 JSON')
    }
    const key = typeof body.key === 'string' ? body.key.trim() : ''
    if (!key) return fail(res, 400, '缺少待删除附件 key')

    const result = await deleteMainSiteObject(key)
    if (!result.ok) return fail(res, result.status, result.error)
    return res.status(200).json({ success: true })
  }

  res.setHeader('Allow', 'GET, POST, DELETE')
  return fail(res, 405, 'Method not allowed')
}
