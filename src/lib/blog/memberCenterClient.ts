import { isIP } from 'node:net'
import { resolveMerchantApiBase } from '@/src/lib/shop/merchantProducts'

/**
 * 站点会员 B1:中心验证服务(主站网关)调用 + 登录小工具。
 * - base 解析复用 merchantProducts.resolveMerchantApiBase(全仓唯一落点,不新增硬编码域);
 * - 错误语义:invalid/revoked 为中心 HTTP 200 + {ok:false,error}(不能只看状态码);
 * - 日志纪律:console 只打错误类别,绝不含 access_key / passport 原文。
 */

const CENTER_TIMEOUT_MS = 8000

// normalizeMemberAccessKey 已拆至 ./memberAccessKey(客户端安全纯函数模块);
// 此处 re-export 保持服务端既有引用零改动(B4 验收修正:顶层 node:net 禁入客户端包)
export { normalizeMemberAccessKey } from './memberAccessKey'

function firstHeaderValue(
  value: string | string[] | undefined
): string | null {
  if (Array.isArray(value)) {
    return typeof value[0] === 'string' ? value[0] : null
  }
  if (typeof value === 'string') return value
  return null
}

/** 读者真实 IP 解析:cf-connecting-ip → x-forwarded-for 首段 → x-real-ip;非法/缺失 → null */
export function resolveReaderClientIp(
  headers: Record<string, string | string[] | undefined>
): string | null {
  const cf = firstHeaderValue(headers['cf-connecting-ip'])
  if (cf && isIP(cf.trim()) !== 0) return cf.trim()

  const xff = firstHeaderValue(headers['x-forwarded-for'])
  if (xff) {
    const first = String(xff.split(',')[0] || '').trim()
    if (first && isIP(first) !== 0) return first
  }

  const real = firstHeaderValue(headers['x-real-ip'])
  if (real && isIP(real.trim()) !== 0) return real.trim()

  return null
}

export type CenterMemberResult =
  | {
      ok: true
      status: 'active'
      passport: string
      expiresAt: string | null
      memberNo: string | null
      masked: string | null
    }
  | {
      ok: true
      status: 'expired'
      passport: string | null
      expiresAt: string | null
      memberNo: string | null
      masked: string | null
    }
  | {
      ok: false
      error: 'invalid' | 'revoked' | 'rate_limited' | 'unavailable' | 'bad_response'
      retryAfterSeconds?: number
    }

type CenterHttpResult = {
  status: number
  payload: unknown
  retryAfterHeader: string | null
}

async function postCenter(
  path: string,
  body: Record<string, unknown>,
  kind: 'login' | 'refresh' | 'renew' | 'handoff' | 'profile'
): Promise<CenterHttpResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), CENTER_TIMEOUT_MS)
  try {
    const res = await fetch(`${resolveMerchantApiBase()}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    let payload: unknown = null
    try {
      payload = await res.json()
    } catch {
      payload = null
    }
    return {
      status: res.status,
      payload,
      retryAfterHeader: res.headers.get('retry-after'),
    }
  } catch (e) {
    // 只打错误类别;绝不打印 access_key / passport
    console.error(`[member] center ${kind} failed: unavailable`)
    throw e
  } finally {
    clearTimeout(timer)
  }
}

function readNullableString(
  record: Record<string, unknown>,
  key: string
): { value: string | null; badType: boolean } {
  const raw = record[key]
  if (raw === undefined || raw === null) return { value: null, badType: false }
  if (typeof raw === 'string') return { value: raw, badType: false }
  return { value: null, badType: true }
}

function mapCenterResponse(
  kind: 'login' | 'refresh',
  http: CenterHttpResult
): CenterMemberResult {
  if (http.status === 429) {
    const body =
      http.payload && typeof http.payload === 'object'
        ? (http.payload as Record<string, unknown>)
        : null
    let retryAfterSeconds: number
    if (
      body &&
      typeof body.retry_after_seconds === 'number' &&
      Number.isFinite(body.retry_after_seconds) &&
      body.retry_after_seconds > 0
    ) {
      retryAfterSeconds = Math.floor(body.retry_after_seconds)
    } else {
      const header = Number(http.retryAfterHeader)
      retryAfterSeconds =
        Number.isFinite(header) && header > 0 ? Math.floor(header) : 60
    }
    return { ok: false, error: 'rate_limited', retryAfterSeconds }
  }

  if (!http.payload || typeof http.payload !== 'object') {
    // 非 JSON / 网络层已被上层 catch;此处兜底 5xx 非 JSON 等
    console.error(`[member] center ${kind} failed: unavailable`)
    return { ok: false, error: 'unavailable' }
  }
  const record = http.payload as Record<string, unknown>

  if (record.ok === true) {
    if (record.status !== 'active' && record.status !== 'expired') {
      console.error(`[member] center ${kind} failed: bad_response`)
      return { ok: false, error: 'bad_response' }
    }
    const expiresAt = readNullableString(record, 'expires_at')
    const memberNo = readNullableString(record, 'member_no')
    const masked = readNullableString(record, 'masked')
    if (expiresAt.badType || memberNo.badType || masked.badType) {
      console.error(`[member] center ${kind} failed: bad_response`)
      return { ok: false, error: 'bad_response' }
    }
    const passportRaw = record.passport
    if (
      passportRaw !== undefined &&
      passportRaw !== null &&
      typeof passportRaw !== 'string'
    ) {
      console.error(`[member] center ${kind} failed: bad_response`)
      return { ok: false, error: 'bad_response' }
    }
    const passport =
      typeof passportRaw === 'string' && passportRaw.length > 0
        ? passportRaw
        : null
    if (record.status === 'active') {
      if (!passport) {
        // active 必须带新证
        console.error(`[member] center ${kind} failed: bad_response`)
        return { ok: false, error: 'bad_response' }
      }
      return {
        ok: true,
        status: 'active',
        passport,
        expiresAt: expiresAt.value,
        memberNo: memberNo.value,
        masked: masked.value,
      }
    }
    // expired:login 形态带 passport(续费链会话凭据);refresh 形态无新证(置 null)
    return {
      ok: true,
      status: 'expired',
      passport,
      expiresAt: expiresAt.value,
      memberNo: memberNo.value,
      masked: masked.value,
    }
  }

  if (record.ok === false) {
    if (
      record.error === 'invalid' ||
      record.error === 'revoked' ||
      record.error === 'unavailable'
    ) {
      return { ok: false, error: record.error }
    }
    console.error(`[member] center ${kind} failed: bad_response`)
    return { ok: false, error: 'bad_response' }
  }

  console.error(`[member] center ${kind} failed: bad_response`)
  return { ok: false, error: 'bad_response' }
}

/** 中心登录:POST {base}/api/public/site-member/login */
export async function callCenterLogin(input: {
  siteId: string
  accessKey: string
  host: string
  clientIp: string | null
}): Promise<CenterMemberResult> {
  try {
    const http = await postCenter(
      '/api/public/site-member/login',
      {
        site_id: input.siteId,
        access_key: input.accessKey,
        host: input.host,
        ...(input.clientIp ? { client_ip: input.clientIp } : {}),
      },
      'login'
    )
    return mapCenterResponse('login', http)
  } catch {
    return { ok: false, error: 'unavailable' }
  }
}

/** 中心核对/换发:POST {base}/api/public/site-member/refresh(status='expired' 形态无新证) */
export async function callCenterRefresh(
  passport: string
): Promise<CenterMemberResult> {
  try {
    const http = await postCenter(
      '/api/public/site-member/refresh',
      { passport },
      'refresh'
    )
    return mapCenterResponse('refresh', http)
  } catch {
    return { ok: false, error: 'unavailable' }
  }
}

/** B4-W4(M6):中心 renew-ref 结果(独立形状,禁与 login/refresh 家族混用 mapCenterResponse) */
export type CenterRenewRefResult =
  | {
      ok: true
      renewRef: string
      expiresIn: number | null
      storeUrl: string
    }
  | {
      ok: false
      error: 'invalid' | 'revoked' | 'rate_limited' | 'unavailable' | 'bad_response'
      retryAfterSeconds?: number
    }

/** renew-ref 独立响应 mapper:{ok:true, renew_ref, expires_in, store_url} 形状;
 * 429/Retry-After 解析镜像 login 家族;错误族同 refresh */
function mapCenterRenewRefResponse(http: CenterHttpResult): CenterRenewRefResult {
  if (http.status === 429) {
    const body =
      http.payload && typeof http.payload === 'object'
        ? (http.payload as Record<string, unknown>)
        : null
    let retryAfterSeconds: number
    if (
      body &&
      typeof body.retry_after_seconds === 'number' &&
      Number.isFinite(body.retry_after_seconds) &&
      body.retry_after_seconds > 0
    ) {
      retryAfterSeconds = Math.floor(body.retry_after_seconds)
    } else {
      const header = Number(http.retryAfterHeader)
      retryAfterSeconds =
        Number.isFinite(header) && header > 0 ? Math.floor(header) : 60
    }
    return { ok: false, error: 'rate_limited', retryAfterSeconds }
  }

  if (!http.payload || typeof http.payload !== 'object') {
    console.error('[member] center renew failed: unavailable')
    return { ok: false, error: 'unavailable' }
  }
  const record = http.payload as Record<string, unknown>

  if (record.ok === true) {
    if (typeof record.renew_ref !== 'string' || !record.renew_ref.trim()) {
      console.error('[member] center renew failed: bad_response')
      return { ok: false, error: 'bad_response' }
    }
    if (typeof record.store_url !== 'string' || !record.store_url.trim()) {
      console.error('[member] center renew failed: bad_response')
      return { ok: false, error: 'bad_response' }
    }
    const expiresInRaw = record.expires_in
    if (
      expiresInRaw !== undefined &&
      expiresInRaw !== null &&
      (typeof expiresInRaw !== 'number' || !Number.isFinite(expiresInRaw))
    ) {
      console.error('[member] center renew failed: bad_response')
      return { ok: false, error: 'bad_response' }
    }
    return {
      ok: true,
      renewRef: record.renew_ref.trim(),
      expiresIn:
        typeof expiresInRaw === 'number' ? Math.floor(expiresInRaw) : null,
      storeUrl: record.store_url.trim(),
    }
  }

  if (record.ok === false) {
    if (
      record.error === 'invalid' ||
      record.error === 'revoked' ||
      record.error === 'unavailable'
    ) {
      return { ok: false, error: record.error }
    }
    console.error('[member] center renew failed: bad_response')
    return { ok: false, error: 'bad_response' }
  }

  console.error('[member] center renew failed: bad_response')
  return { ok: false, error: 'bad_response' }
}

/** 中心续费引用:POST {base}/api/public/site-member/renew-ref body {passport}
 * (BLOG 服务端持 cookie 内 passport 直调;store 域一律以中心返回为准) */
export async function callCenterRenewRef(
  passport: string
): Promise<CenterRenewRefResult> {
  try {
    const http = await postCenter(
      '/api/public/site-member/renew-ref',
      { passport },
      'renew'
    )
    return mapCenterRenewRefResponse(http)
  } catch {
    return { ok: false, error: 'unavailable' }
  }
}

/** R1:中心回跳票据消费结果(独立形状,禁与 login/refresh/renew 家族混用既有 mapper——
 * 错误族含 expired/used,login 家族透传白名单不含) */
export type CenterHandoffRedeemResult =
  | {
      ok: true
      status: 'active' | 'expired'
      passport: string
      expiresAt: string | null
      memberNo: string | null
    }
  | {
      ok: false
      error:
        | 'invalid'
        | 'expired'
        | 'used'
        | 'revoked'
        | 'rate_limited'
        | 'unavailable'
        | 'bad_response'
      retryAfterSeconds?: number
    }

/** handoff-redeem 独立响应 mapper:{ok:true, status, passport, expires_at, member_no};
 * active/expired 两态都必有非空 passport(缺 → bad_response);
 * 429/Retry-After 解析镜像 login 家族;ok:false 族 {invalid,expired,used,revoked} 透传 */
function mapCenterHandoffRedeemResponse(
  http: CenterHttpResult
): CenterHandoffRedeemResult {
  if (http.status === 429) {
    const body =
      http.payload && typeof http.payload === 'object'
        ? (http.payload as Record<string, unknown>)
        : null
    let retryAfterSeconds: number
    if (
      body &&
      typeof body.retry_after_seconds === 'number' &&
      Number.isFinite(body.retry_after_seconds) &&
      body.retry_after_seconds > 0
    ) {
      retryAfterSeconds = Math.floor(body.retry_after_seconds)
    } else {
      const header = Number(http.retryAfterHeader)
      retryAfterSeconds =
        Number.isFinite(header) && header > 0 ? Math.floor(header) : 60
    }
    return { ok: false, error: 'rate_limited', retryAfterSeconds }
  }

  if (!http.payload || typeof http.payload !== 'object') {
    console.error('[member] center handoff failed: unavailable')
    return { ok: false, error: 'unavailable' }
  }
  const record = http.payload as Record<string, unknown>

  if (record.ok === true) {
    if (record.status !== 'active' && record.status !== 'expired') {
      console.error('[member] center handoff failed: bad_response')
      return { ok: false, error: 'bad_response' }
    }
    if (typeof record.passport !== 'string' || record.passport.length === 0) {
      // 两态(active/expired)都必有非空 passport
      console.error('[member] center handoff failed: bad_response')
      return { ok: false, error: 'bad_response' }
    }
    const expiresAt = readNullableString(record, 'expires_at')
    const memberNo = readNullableString(record, 'member_no')
    if (expiresAt.badType || memberNo.badType) {
      console.error('[member] center handoff failed: bad_response')
      return { ok: false, error: 'bad_response' }
    }
    return {
      ok: true,
      status: record.status === 'active' ? 'active' : 'expired',
      passport: record.passport,
      expiresAt: expiresAt.value,
      memberNo: memberNo.value,
    }
  }

  if (record.ok === false) {
    if (
      record.error === 'invalid' ||
      record.error === 'expired' ||
      record.error === 'used' ||
      record.error === 'revoked'
    ) {
      return { ok: false, error: record.error }
    }
    console.error('[member] center handoff failed: bad_response')
    return { ok: false, error: 'bad_response' }
  }

  console.error('[member] center handoff failed: bad_response')
  return { ok: false, error: 'bad_response' }
}

/** R1:中心回跳票据消费:POST {base}/api/public/site-member/handoff-redeem
 * body {ticket, host, client_ip?}(票 URL 由中心拼装,BLOG 只做导航;单次消费即鉴权,
 * BLOG 不做本地票验签) */
export async function callCenterHandoffRedeem(input: {
  ticket: string
  host: string
  clientIp: string | null
}): Promise<CenterHandoffRedeemResult> {
  try {
    const http = await postCenter(
      '/api/public/site-member/handoff-redeem',
      {
        ticket: input.ticket,
        host: input.host,
        ...(input.clientIp ? { client_ip: input.clientIp } : {}),
      },
      'handoff'
    )
    return mapCenterHandoffRedeemResponse(http)
  } catch {
    return { ok: false, error: 'unavailable' }
  }
}

/** R14-B:中心会员资料结果(独立形状:{ok:true, status, member_no, access_key,
 *  access_key_mask, qr_data_url, started_at, expires_at};全字段可空=容错展示) */
export type CenterProfileResult =
  | {
      ok: true
      status: 'active' | 'expired'
      memberNo: string | null
      accessKey: string | null
      accessKeyMask: string | null
      qrDataUrl: string | null
      startedAt: string | null
      expiresAt: string | null
    }
  | {
      ok: false
      error: 'invalid' | 'revoked' | 'rate_limited' | 'unavailable' | 'bad_response'
      retryAfterSeconds?: number
    }

/** profile 独立响应 mapper;429/Retry-After 解析镜像 login 家族;错误族同 renew-ref */
function mapCenterProfileResponse(http: CenterHttpResult): CenterProfileResult {
  if (http.status === 429) {
    const body =
      http.payload && typeof http.payload === 'object'
        ? (http.payload as Record<string, unknown>)
        : null
    let retryAfterSeconds: number
    if (
      body &&
      typeof body.retry_after_seconds === 'number' &&
      Number.isFinite(body.retry_after_seconds) &&
      body.retry_after_seconds > 0
    ) {
      retryAfterSeconds = Math.floor(body.retry_after_seconds)
    } else {
      const header = Number(http.retryAfterHeader)
      retryAfterSeconds =
        Number.isFinite(header) && header > 0 ? Math.floor(header) : 60
    }
    return { ok: false, error: 'rate_limited', retryAfterSeconds }
  }

  if (!http.payload || typeof http.payload !== 'object') {
    console.error('[member] center profile failed: unavailable')
    return { ok: false, error: 'unavailable' }
  }
  const record = http.payload as Record<string, unknown>

  if (record.ok === true) {
    if (record.status !== 'active' && record.status !== 'expired') {
      console.error('[member] center profile failed: bad_response')
      return { ok: false, error: 'bad_response' }
    }
    const memberNo = readNullableString(record, 'member_no')
    const accessKey = readNullableString(record, 'access_key')
    const accessKeyMask = readNullableString(record, 'access_key_mask')
    const qrDataUrl = readNullableString(record, 'qr_data_url')
    const startedAt = readNullableString(record, 'started_at')
    const expiresAt = readNullableString(record, 'expires_at')
    if (
      memberNo.badType ||
      accessKey.badType ||
      accessKeyMask.badType ||
      qrDataUrl.badType ||
      startedAt.badType ||
      expiresAt.badType
    ) {
      console.error('[member] center profile failed: bad_response')
      return { ok: false, error: 'bad_response' }
    }
    return {
      ok: true,
      status: record.status === 'active' ? 'active' : 'expired',
      memberNo: memberNo.value,
      accessKey: accessKey.value,
      accessKeyMask: accessKeyMask.value,
      qrDataUrl: qrDataUrl.value,
      startedAt: startedAt.value,
      expiresAt: expiresAt.value,
    }
  }

  if (record.ok === false) {
    if (
      record.error === 'invalid' ||
      record.error === 'revoked' ||
      record.error === 'unavailable'
    ) {
      return { ok: false, error: record.error }
    }
    console.error('[member] center profile failed: bad_response')
    return { ok: false, error: 'bad_response' }
  }

  console.error('[member] center profile failed: bad_response')
  return { ok: false, error: 'bad_response' }
}

/** R14-B:中心会员资料:POST {base}/api/public/site-member/profile body {passport}
 * (BLOG 服务端持 cookie 内 passport 直调;日志绝不含 key/passport 原文) */
export async function callCenterProfile(
  passport: string
): Promise<CenterProfileResult> {
  try {
    const http = await postCenter(
      '/api/public/site-member/profile',
      { passport },
      'profile'
    )
    return mapCenterProfileResponse(http)
  } catch {
    return { ok: false, error: 'unavailable' }
  }
}
