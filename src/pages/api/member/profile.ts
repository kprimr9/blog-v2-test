import type { NextApiRequest, NextApiResponse } from 'next'
import { getEffectiveMembershipConfig } from '@/src/lib/blog/membershipGate'
import { callCenterProfile } from '@/src/lib/blog/memberCenterClient'
import {
  MEMBER_COOKIE_NAME,
  normalizeMemberHost,
  verifyMemberPassport,
} from '@/src/lib/blog/memberPassport'
import { getBlogSiteIdOrNull } from '@/src/lib/gallery/blogSite'

/**
 * 站点会员 R14-B:会员资料转发端点(照 renew-url 模板)。
 * 流程:cookie passport → 本地验签 → 中心 profile(只读)→ 透传
 * {status, member_no, access_key, access_key_mask, qr_data_url, started_at, expires_at}。
 * 错误码全表(同 renew-url §10.3-6):无 cookie/本地验签失败/中心 invalid → 401;
 * 中心 revoked → 403;rate_limited → 429(Retry-After + retry_after_seconds);
 * unavailable/bad_response → 503。日志只打错误类别,绝不含 passport/access_key 原文。
 */

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ success: false, error: 'method_not_allowed' })
  }

  try {
    const token =
      typeof req.cookies?.[MEMBER_COOKIE_NAME] === 'string'
        ? req.cookies[MEMBER_COOKIE_NAME]
        : null
    if (!token) {
      return res.status(401).json({ success: false, error: 'guest' })
    }

    const config = await getEffectiveMembershipConfig()
    if (!config) {
      return res.status(403).json({ success: false, error: 'disabled' })
    }

    const host = normalizeMemberHost(
      String(req.headers['x-forwarded-host'] || req.headers.host || '')
    )
    const siteId = getBlogSiteIdOrNull()
    const verified =
      host && siteId
        ? await verifyMemberPassport(token, { host, siteId })
        : ({ ok: false as const, reason: 'aud_mismatch' as const })
    if (!verified.ok) {
      // 只打 reason,不打 token
      console.error('[member] profile passport verify failed:', verified.reason)
      return res.status(401).json({ success: false, error: 'guest' })
    }

    const center = await callCenterProfile(token)

    if (!center.ok) {
      if (center.error === 'invalid') {
        return res.status(401).json({ success: false, error: 'invalid' })
      }
      if (center.error === 'revoked') {
        return res.status(403).json({ success: false, error: 'revoked' })
      }
      if (center.error === 'rate_limited') {
        const retryAfterSeconds = center.retryAfterSeconds ?? 60
        res.setHeader('Retry-After', String(retryAfterSeconds))
        return res.status(429).json({
          success: false,
          error: 'rate_limited',
          retry_after_seconds: retryAfterSeconds,
        })
      }
      // unavailable / bad_response → 503(与 login 家族一致)
      return res.status(503).json({ success: false, error: 'unavailable' })
    }

    return res.status(200).json({
      success: true,
      status: center.status,
      member_no: center.memberNo,
      access_key: center.accessKey,
      access_key_mask: center.accessKeyMask,
      qr_data_url: center.qrDataUrl,
      started_at: center.startedAt,
      expires_at: center.expiresAt,
    })
  } catch (error) {
    console.error(
      '[member] profile error:',
      error instanceof Error ? error.message : error
    )
    return res.status(503).json({ success: false, error: 'unavailable' })
  }
}
