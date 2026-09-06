import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import {
  encodeAdminAuthCookie,
  getAdminCredentials,
  isLegacyUrlPasswordDisabled,
  verifyAdminLoginToken,
} from '@/src/lib/admin/loginToken'

// ---------------------------------------------------------------------------
// BLOG 分层 P3:只读模式拦截(配额状态来自共用库 blog_quota_state)
//
// - 状态读取:bloggallery REST(service role 仅服务端,不进前端);
//   10 秒 inflight 去重 + 结果 memo;查询失败一律视为「未只读」(防误伤)。
// - 只读时仅拦截「商户侧写操作」(非 GET/HEAD/OPTIONS 且命中下方清单),
//   redirect 到 /api/internal/read-only-blocked(最终 403 READ_ONLY JSON;
//   Next 13.0.6 middleware 不能直接带 response body);不弹任何前端 UI(P4 再做提示条)。
// - 白名单(豁免)优先于拦截清单:爬虫/TG 搬运、平台组件同步、revalidate、
//   读者侧计数等一律放行;admin 认证逻辑保持不变。
// ---------------------------------------------------------------------------

const QUOTA_STATE_CACHE_MS = 10_000
const QUOTA_STATE_FETCH_TIMEOUT_MS = 2_000

/** 商户侧写路径(精确匹配 pathname;grep 自 src/pages/api/admin 实际路由) */
const MERCHANT_WRITE_PATHS = new Set<string>([
  '/api/admin/post', // 文章发布/编辑/删除(含主题配置页写入)
  '/api/admin/config', // 站点标题等设置保存
  '/api/admin/taxonomy', // 分类/标签管理
  '/api/admin/gallery', // 图库管理
  '/api/admin/gallery-ad', // 图库广告位配置
  '/api/admin/upload', // 图片上传
  '/api/admin/social-links', // 导航社交链接保存
  '/api/admin/full-redeploy', // 整站重部署(商户触发,消耗构建资源)
  '/api/admin/attachments', // 存储基座 S3:文章附件上传/删除(GET 列表不受非 GET 拦截影响)
])

/** 白名单(前缀匹配;命中即完全豁免只读拦截) */
const READ_ONLY_EXEMPT_PREFIXES = [
  // 爬虫 / TG 搬运入库(内容供给不停)
  '/api/admin/crawler-ingest',
  '/api/cron/crawler-ingest',
  // 平台侧服务到服务调用(组件同步 / 刷新)
  '/api/admin/friends',
  '/api/admin/vending',
  '/api/admin/announcement-popup',
  '/api/admin/popup-ad',
  '/api/admin/click-ad',
  '/api/revalidate',
  '/api/admin/revalidate',
  // 只读查询(后台展示)
  '/api/admin/theme-cooldown',
  '/api/admin/gallery-storage',
  // 内部计量上报 / 读者侧 / 公开配置
  '/api/internal/pv-flush',
  '/api/post/unlock',
  '/api/gallery/post-stats',
  '/api/image-host-config',
]

const SITE_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[0-9a-f]{12}$/i

function normalizeSupabaseUrl(raw: string | undefined): string | null {
  if (!raw) return null
  let url = raw.trim().replace(/^['"]|['"]$/g, '')
  url = url.replace(/\/+$/, '')
  url = url.replace(/\/rest\/v1$/i, '')
  return url || null
}

let quotaReadOnlyMemo: { value: boolean; at: number } | null = null
let quotaReadOnlyInflight: Promise<boolean> | null = null

/** 查询当前站点是否处于只读(共用库 blog_quota_state.read_only)。 */
async function isSiteReadOnly(): Promise<boolean> {
  const siteId = process.env.BLOG_SITE_ID?.trim()
  const url = normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL)
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim().replace(/^['"]|['"]$/g, '')
  if (!siteId || !SITE_ID_RE.test(siteId) || !url || !serviceKey) {
    return false
  }

  const now = Date.now()
  if (quotaReadOnlyMemo && now - quotaReadOnlyMemo.at < QUOTA_STATE_CACHE_MS) {
    return quotaReadOnlyMemo.value
  }
  if (quotaReadOnlyInflight) {
    return quotaReadOnlyInflight
  }

  quotaReadOnlyInflight = (async () => {
    try {
      const res = await fetch(
        `${url}/rest/v1/blog_quota_state?select=read_only&site_id=eq.${siteId}`,
        {
          headers: {
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
          },
          signal: AbortSignal.timeout(QUOTA_STATE_FETCH_TIMEOUT_MS),
          cache: 'no-store',
        }
      )
      if (!res.ok) return false
      const rows = (await res.json()) as Array<{ read_only?: boolean }>
      const value = Array.isArray(rows) && rows.length > 0 && rows[0].read_only === true
      quotaReadOnlyMemo = { value, at: Date.now() }
      return value
    } catch {
      // 静默失败:视为未只读,防误伤
      quotaReadOnlyMemo = { value: false, at: Date.now() }
      return false
    } finally {
      quotaReadOnlyInflight = null
    }
  })()

  return quotaReadOnlyInflight
}

function isExemptPath(pathname: string): boolean {
  return READ_ONLY_EXEMPT_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  )
}

function isMerchantWriteRequest(pathname: string, method: string): boolean {
  if (['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase())) return false
  return MERCHANT_WRITE_PATHS.has(pathname)
}

// Next 13.0.6 middleware 禁止修改 response body(带 body 的 403 会变 500),
// 因此只读拦截改为 redirect 到内部端点,由其返回最终 403 JSON。
function readOnlyResponse(req: NextRequest): NextResponse {
  const url = req.nextUrl.clone()
  url.pathname = '/api/internal/read-only-blocked'
  url.search = ''
  return NextResponse.redirect(url)
}

function credentialsMatch(user: string, pass: string): boolean {
  const { user: validUser, pass: validPass } = getAdminCredentials()
  return user === validUser && pass === validPass
}

function setAdminSessionCookie(response: NextResponse, user: string, pass: string) {
  response.cookies.set('internal_auth', encodeAdminAuthCookie(user, pass), {
    path: '/',
    maxAge: 86400,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  })
}

function redirectToAdminWithoutLoginQuery(req: NextRequest): NextResponse {
  const url = req.nextUrl.clone()
  url.pathname = '/admin'
  url.searchParams.delete('login_token')
  url.searchParams.delete('auth_u')
  url.searchParams.delete('auth_p')
  return NextResponse.redirect(url)
}

function unauthorized(): NextResponse {
  return new NextResponse(null, {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="Secure Area"',
    },
  })
}

export async function middleware(req: NextRequest) {
  const { pathname, searchParams } = req.nextUrl

  if (pathname.startsWith('/admin')) {
    const loginToken = searchParams.get('login_token')

    if (loginToken) {
      const result = await verifyAdminLoginToken(loginToken, req.nextUrl.host)
      if (!result.ok) {
        console.warn('admin login_token rejected:', result.reason)
        return unauthorized()
      }

      const { user, pass } = getAdminCredentials()
      const response = redirectToAdminWithoutLoginQuery(req)
      setAdminSessionCookie(response, user, pass)
      return response
    }

    if (!isLegacyUrlPasswordDisabled()) {
      const auth_u = searchParams.get('auth_u')
      const auth_p = searchParams.get('auth_p')

      if (auth_u && auth_p && credentialsMatch(auth_u, auth_p)) {
        const { user, pass } = getAdminCredentials()
        const response = redirectToAdminWithoutLoginQuery(req)
        setAdminSessionCookie(response, user, pass)
        return response
      }
    }

    const basicAuth = req.headers.get('authorization')
    const cookieAuth = req.cookies.get('internal_auth')?.value

    if (basicAuth) {
      const authValue = basicAuth.split(' ')[1]
      if (authValue) {
        const [user, pwd] = atob(authValue).split(':')
        if (credentialsMatch(user, pwd)) return NextResponse.next()
      }
    }

    if (cookieAuth) {
      const [user, pwd] = atob(cookieAuth).split(':')
      if (credentialsMatch(user, pwd)) return NextResponse.next()
    }

    return unauthorized()
  }

  // /api/admin/*:认证由各 route 内部自鉴权(verifyAdminRequest),middleware 不重复;
  // 此处仅做只读拦截(白名单豁免 → 商户侧写请求且站点只读 → 403)。
  if (await shouldBlockReadOnly(req)) return readOnlyResponse(req)

  return NextResponse.next()
}

/** 只读拦截判定:白名单豁免 → 非白名单的商户侧写请求且站点只读时拦截。 */
async function shouldBlockReadOnly(req: NextRequest): Promise<boolean> {
  const { pathname } = req.nextUrl
  if (isExemptPath(pathname)) return false
  if (!isMerchantWriteRequest(pathname, req.method)) return false
  return isSiteReadOnly()
}

export const config = {
  matcher: ['/admin/:path*', '/admin', '/api/admin/:path*'],
}
