import { verifyAdminRequest } from '@/src/lib/admin/verifyAdminRequest'
import { getImageHostConfig } from '@/src/lib/media/imageHostConfig'
import { normalizeUploadedAssetUrl } from '@/src/lib/media/rewriteManagedAssetUrl'
import { getBlogSiteIdOrNull } from '@/src/lib/gallery/blogSite'
import {
  resolveMainStorageBase,
  resolveSiteImageBackend,
} from '@/src/lib/storage/mainStorage'

// ============================================================
// 图片上传代理（S3 双轨：存储基座 | 兰空 Lsky Pro 2.x）
// ------------------------------------------------------------
// 安全模型：浏览器永远拿不到 LSKY_TOKEN / MERCHANT_API_TOKEN。
// 浏览器 → 本接口(服务端) → 双轨分流：
//   A) image/* 且主站 image-backend 判定 storage_base
//      → ${MERCHANT_API_BASE}/api/storage/upload（Bearer + site_id，type=image）
//      → 返回 /photo/{key}，模板侧拼主站域绝对地址
//   B) 其余（legacy 站图片 / 全部 video）
//      → 兰空 /api/v1/upload（原链路，行为与历史一致）
// 判定失败/未配置一律走 B（旧链路兜底，见 src/lib/storage/mainStorage.ts）。
//
// 零新增依赖：利用 Node 18+ 原生的 fetch / FormData / Blob，
// 关闭 Next 默认 bodyParser，直接读取原始二进制流后再转发。
// ============================================================

// 关闭 Next 自带的 body 解析，改为手动读取原始二进制流
export const config = {
  api: {
    bodyParser: false,
  },
}

// 单文件大小上限（字节）。Gallery 大图库建议 50MB；可用 LSKY_MAX_UPLOAD_MB 覆盖
const MAX_UPLOAD_MB = Math.min(
  Math.max(parseInt(process.env.LSKY_MAX_UPLOAD_MB || '50', 10) || 50, 1),
  200
)
const MAX_SIZE = MAX_UPLOAD_MB * 1024 * 1024

// 把请求流完整读入 Buffer
function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
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

// S3 双轨 A：转发主站存储基座上传（type=image + site_id；返回 /photo/{key} 拼主站域）
async function uploadViaStorageBase(req, res, buffer, rawName, contentType) {
  const base = resolveMainStorageBase()
  const siteId = getBlogSiteIdOrNull()
  const token = (process.env.MERCHANT_API_TOKEN || '').trim()
  if (!siteId || !token) {
    return res.status(500).json({
      success: false,
      error: '主站存储配置缺失（站点身份/凭据），请联系管理员',
    })
  }

  const form = new FormData()
  form.append('file', new Blob([buffer], { type: contentType }), rawName)
  form.append('type', 'image')
  form.append('site_id', siteId)

  let upstream
  try {
    upstream = await fetch(`${base}/api/storage/upload`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        // 不要手动设 Content-Type：fetch 会为 FormData 自动生成 boundary
      },
      body: form,
      signal: AbortSignal.timeout(30_000),
    })
  } catch (error) {
    console.error('[storage-base] 主站存储上传请求失败:', error?.message || error)
    return res.status(502).json({ success: false, error: '主站存储上传失败，请稍后重试' })
  }

  const payload = await upstream.json().catch(() => null)
  if (!upstream.ok || !payload || payload.success === false) {
    const message =
      payload?.message || payload?.error || `主站存储上传失败（HTTP ${upstream.status}）`
    const status = upstream.status >= 400 && upstream.status < 500 ? upstream.status : 502
    return res.status(status).json({ success: false, error: message })
  }

  // 主站返回 /photo/{key}（相对主站域）→ 模板拼绝对地址插入文章
  const url = typeof payload.url === 'string' && payload.url.startsWith('/')
    ? `${base}${payload.url}`
    : payload.url
  if (!url || !/^https?:\/\//i.test(url)) {
    return res.status(502).json({ success: false, error: '主站存储未返回有效图片地址' })
  }

  return res.status(200).json({
    success: true,
    url,
    name: rawName,
    mimetype: contentType,
    links: { url },
  })
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ success: false, error: '仅支持 POST 请求' })
  }

  // middleware 当前只实际保护 /admin 页面；上传代理必须自行二次鉴权。
  if (!verifyAdminRequest(req)) {
    return res.status(401).json({ success: false, error: '未授权' })
  }

  try {
    // 1. 读取浏览器发来的原始二进制数据（双轨判定需要 content-type，故先行）
    const buffer = await readRawBody(req)
    if (!buffer || buffer.length === 0) {
      return res.status(400).json({ success: false, error: '未接收到文件数据' })
    }

    // 文件名与类型由前端通过自定义头传入（见前端约定）
    const rawName = req.headers['x-file-name']
      ? decodeURIComponent(req.headers['x-file-name'])
      : `upload-${Date.now()}.png`
    const contentType = req.headers['content-type'] || 'application/octet-stream'

    // 简单的类型白名单：只允许图片 / 视频
    if (!/^(image|video)\//i.test(contentType)) {
      return res.status(415).json({
        success: false,
        error: `不支持的文件类型: ${contentType}`,
      })
    }

    // 2. S3 双轨：image 且该站生效「存储基座」→ 转发主站存储 API；
    //    video 与 legacy 站图片继续走兰空（判定失败也兜底兰空，见 mainStorage.ts）
    if (/^image\//i.test(contentType)) {
      const backend = await resolveSiteImageBackend()
      if (backend === 'storage_base') {
        return await uploadViaStorageBase(req, res, buffer, rawName, contentType)
      }
    }

    // 3. legacy 兰空链路（行为与历史一致）
    const imageHostConfig = await getImageHostConfig()
    const uploadEndpoint = `${imageHostConfig.uploadApiOrigin}/api/v1/upload`

    // 3.1 校验 token 是否配置（legacy 专用；storage_base 站不依赖兰空凭据）
    let token = process.env.LSKY_TOKEN || ''
    if (!token) {
      return res.status(500).json({
        success: false,
        error: '图片上传服务未配置，请联系管理员',
      })
    }
    // 容错：若变量里没带 "Bearer " 前缀，自动补上
    if (!/^bearer\s/i.test(token)) {
      token = `Bearer ${token}`
    }

    // 4. 用原生 FormData + Blob 重新打包，转发给兰空
    const blob = new Blob([buffer], { type: contentType })
    const form = new FormData()
    form.append('file', blob, rawName)

    const lskyRes = await fetch(uploadEndpoint, {
      method: 'POST',
      headers: {
        Authorization: token,
        Accept: 'application/json',
        // 注意：千万不要手动设置 Content-Type，
        // fetch 会自动为 FormData 生成带 boundary 的 multipart 头
      },
      body: form,
    })

    // 5. 解析兰空返回
    const text = await lskyRes.text()
    let data
    try {
      data = JSON.parse(text)
    } catch (e) {
      // 兰空返回了非 JSON（通常是网关错误页 / token 失效跳转登录页）
      return res.status(502).json({
        success: false,
        error: '图片上传服务返回异常，请稍后重试',
      })
    }

    // Lsky Pro 2.x: { status: true, message, data: { links: { url, ... } } }
    if (!lskyRes.ok || data.status === false) {
      const lskyMsg = data.message || '上传失败'
      const sizeHint = /大小|size|limit|过大/i.test(lskyMsg)
        ? `（单张上限 ${MAX_UPLOAD_MB}MB，请压缩后重试）`
        : ''
      return res.status(lskyRes.status || 502).json({
        success: false,
        error: `${lskyMsg}${sizeHint}`,
      })
    }

    const url = data?.data?.links?.url || ''
    if (!url) {
      return res.status(502).json({
        success: false,
        error: '上传失败：未获取到图片地址',
      })
    }

    let normalizedUrl
    try {
      normalizedUrl = normalizeUploadedAssetUrl(url, imageHostConfig)
    } catch (error) {
      console.error(
        '[image-host] 兰空返回 URL 校验失败：',
        error instanceof Error ? error.message : error
      )
      return res.status(502).json({
        success: false,
        error: '图片上传服务返回了未受信任的地址',
      })
    }

    // 5. 只回传公开、安全字段；浏览器不接触共享配置或原始兰空响应。
    return res.status(200).json({
      success: true,
      url: normalizedUrl,
      name: data?.data?.origin_name || rawName,
      mimetype: data?.data?.mimetype || contentType,
      links: { url: normalizedUrl },
    })
  } catch (error) {
    if (error.message === 'FILE_TOO_LARGE') {
      return res.status(413).json({
        success: false,
        error: `文件过大，本站代理单文件上限 ${MAX_UPLOAD_MB}MB`,
      })
    }
    console.error('Upload Proxy Error:', error)
    return res.status(500).json({
      success: false,
      error: '图片上传失败，请稍后重试',
    })
  }
}
