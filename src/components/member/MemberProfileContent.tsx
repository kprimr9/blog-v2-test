'use client'

/* eslint-disable @next/next/no-img-element */

import Head from 'next/head'
import Link from 'next/link'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  formatMemberValidityText,
  MemberLoginDialog,
} from '@/src/components/member/MemberLoginDialog'
import {
  MEMBER_NAV_LOGIN_LABEL,
  readMemberNoFromCookieString,
  sanitizeMemberNo,
} from '@/src/components/member/MemberNav'
import { useActiveTheme } from '@/src/components/theme/ActiveThemeProvider'
import { isTweetDarkTheme, isTweetLightTheme } from '@/src/themes/tweet/tweetTheme'

/**
 * 站点会员 R14-B:我的资料页内容(由 [page].tsx profile 分支接线;双层壳)。
 * - 挂载探测 /api/member/session(状态门) + /api/member/profile(key/二维码/日期;
 *   中心只读端点经本机转发,SSG 页个性化数据一律客户端拉取);
 * - 区块:状态行(active=已开通+成功图标/expired=已到期+续费 CTA)→ 会员编号 →
 *   有效期至 → 会员key(等宽+复制)→ 会员码图片(QR+下载)→ 更换设备登录 →
 *   注意事项;guest → 页内登录引导(登录成功整页 reload 后自动呈内容);
 *   disabled → 不渲染(门控 fail-closed,页面级 gssp 已兜底 404);
 * - 文案草稿见需求档 §3.3 b2(实施可微调);禁 emoji;三态主题。
 */

export const PROFILE_DEVICE_TEXT =
  '更换设备或浏览器后：打开本站 → 点击「登录」→ 输入会员key，或上传保存的会员码图片即可。建议提前保存本页的会员码图片，换设备时可直接上传登录。'

export const PROFILE_NOTICE_ITEMS = [
  '会员key 与会员码图片即您的登录凭证，请勿分享给他人，以免被滥用',
  '会员到期后，会员专属内容将重新锁定，续费即可恢复',
  '如需帮助请联系平台客服',
] as const

/** 开通日期展示:ISO →「开通于 YYYY/MM/DD」;无效/缺失 → '' */
export function formatMemberStartedAtText(
  iso: string | null | undefined
): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `开通于 ${y}/${m}/${d}`
}

const CheckCircleIcon = ({ className = '' }: { className?: string }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="9" />
    <path d="m8.5 12.2 2.4 2.4 4.6-5" />
  </svg>
)

const CopyIcon = ({ className = '' }: { className?: string }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
)

type ProfileView = 'probing' | 'guest' | 'active' | 'expired' | 'disabled'

type ProfileData = {
  status: string
  memberNo: string | null
  accessKey: string | null
  accessKeyMask: string | null
  qrDataUrl: string | null
  startedAt: string | null
  expiresAt: string | null
}

export function MemberProfileContent() {
  const activeTheme = useActiveTheme()
  const [view, setView] = useState<ProfileView>('probing')
  const [loginOpen, setLoginOpen] = useState(false)
  const [profile, setProfile] = useState<ProfileData | null>(null)
  const [profileError, setProfileError] = useState(false)
  const [copied, setCopied] = useState(false)
  const [sessionMemberNo, setSessionMemberNo] = useState('')
  const [sessionExpiresAt, setSessionExpiresAt] = useState<string | null>(null)
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const probeSession = useCallback(async () => {
    try {
      const res = await fetch('/api/member/session', { cache: 'no-store' })
      const data = await res.json().catch(() => null)
      const status = data?.status
      if (status === 'active' || status === 'expired') {
        setSessionMemberNo(
          typeof data?.member_no === 'string'
            ? sanitizeMemberNo(data.member_no)
            : ''
        )
        setSessionExpiresAt(
          typeof data?.expires_at === 'string' ? data.expires_at : null
        )
        setView(status)
        return
      }
      if (status === 'disabled') {
        setView('disabled')
        return
      }
      setView('guest')
    } catch {
      setView('guest')
    }
  }, [])

  const fetchProfile = useCallback(async () => {
    setProfileError(false)
    try {
      const res = await fetch('/api/member/profile', { cache: 'no-store' })
      const data = await res.json().catch(() => null)
      if (res.ok && data?.success) {
        setProfile({
          status: data.status,
          memberNo:
            typeof data.member_no === 'string' ? data.member_no : null,
          accessKey:
            typeof data.access_key === 'string' ? data.access_key : null,
          accessKeyMask:
            typeof data.access_key_mask === 'string'
              ? data.access_key_mask
              : null,
          qrDataUrl:
            typeof data.qr_data_url === 'string' ? data.qr_data_url : null,
          startedAt:
            typeof data.started_at === 'string' ? data.started_at : null,
          expiresAt:
            typeof data.expires_at === 'string' ? data.expires_at : null,
        })
        return
      }
      setProfileError(true)
    } catch {
      setProfileError(true)
    }
  }, [])

  useEffect(() => {
    void probeSession()
  }, [probeSession])

  useEffect(() => {
    if (view === 'active' || view === 'expired') void fetchProfile()
  }, [view, fetchProfile])

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
    }
  }, [])

  const handleCopy = useCallback(async () => {
    const key = profile?.accessKey
    if (!key || copied) return
    try {
      await navigator.clipboard.writeText(key)
      setCopied(true)
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
      copyTimerRef.current = setTimeout(() => setCopied(false), 2000)
    } catch {
      // 剪贴板不可用:静默(无反馈)
    }
  }, [profile, copied])

  // ---- 面板主题三态(与登录弹窗/定价页同源) ----
  const panelTheme =
    isTweetLightTheme(activeTheme) || activeTheme === 'gallery'
      ? 'light'
      : isTweetDarkTheme(activeTheme)
        ? 'dark'
        : 'auto'
  const titleCls =
    panelTheme === 'dark'
      ? 'text-neutral-100'
      : panelTheme === 'light'
        ? 'text-neutral-800'
        : 'text-neutral-800 dark:text-neutral-100'
  const mutedCls =
    panelTheme === 'dark'
      ? 'text-neutral-400'
      : panelTheme === 'light'
        ? 'text-neutral-500'
        : 'text-neutral-500 dark:text-neutral-400'
  const sectionCls =
    panelTheme === 'dark'
      ? 'border-[#3a3a42]'
      : panelTheme === 'light'
        ? 'border-neutral-200'
        : 'border-neutral-200 dark:border-[#3a3a42]'
  const keyBoxCls =
    panelTheme === 'dark'
      ? 'bg-[#26262c]'
      : panelTheme === 'light'
        ? 'bg-neutral-100'
        : 'bg-neutral-100 dark:bg-[#26262c]'
  // tweet 主题 a{color:inherit}(0,1,2)压制锚点文字色 → !前缀
  const neutralButtonCls =
    'flex h-8 shrink-0 items-center justify-center gap-1 rounded-[7px] border border-neutral-300 px-2.5 text-xs font-semibold !text-neutral-600 transition-colors hover:bg-neutral-100 dark:border-neutral-600 dark:!text-neutral-300 dark:hover:bg-neutral-800 active:scale-[0.98]'
  const primaryButtonCls =
    'inline-flex items-center justify-center rounded-lg bg-[#dc2626] px-4 py-2 text-sm font-semibold !text-white transition-all hover:bg-[#b91c1c] active:scale-[0.98]'

  const memberNo = sanitizeMemberNo(profile?.memberNo ?? sessionMemberNo)
  const cookieMemberNo =
    typeof document !== 'undefined'
      ? readMemberNoFromCookieString(document.cookie)
      : ''
  const displayMemberNo = memberNo || cookieMemberNo
  const displayKey = profile?.accessKey
  const startedText = formatMemberStartedAtText(profile?.startedAt)
  const validityText = formatMemberValidityText(
    profile?.expiresAt ?? sessionExpiresAt
  )

  return (
    <div className="flex flex-col gap-3 py-2">
      <Head>
        <title>我的资料</title>
        <meta name="robots" content="noindex" />
      </Head>

      {view === 'probing' ? (
        <p className={`text-sm ${mutedCls}`}>加载中…</p>
      ) : null}

      {view === 'guest' ? (
        <div
          className={`flex flex-col items-center gap-3 rounded-xl border ${sectionCls} px-6 py-10 text-center`}
        >
          <p className={`text-sm ${mutedCls}`}>登录后即可查看会员资料</p>
          <button
            type="button"
            onClick={() => setLoginOpen(true)}
            className={primaryButtonCls}
          >
            {MEMBER_NAV_LOGIN_LABEL}
          </button>
        </div>
      ) : null}

      {view === 'active' || view === 'expired' ? (
        <>
          {/* ① 状态行 */}
          <div
            className={`flex items-center justify-between gap-3 rounded-xl border ${sectionCls} px-4 py-3`}
          >
            {view === 'active' ? (
              <span className="flex items-center gap-2">
                <CheckCircleIcon className="h-5 w-5 shrink-0 text-[#16a34a]" />
                <span className={`text-sm font-bold ${titleCls}`}>
                  会员已开通
                </span>
              </span>
            ) : (
              <span className={`text-sm font-bold ${titleCls}`}>
                会员已到期
              </span>
            )}
            {view === 'expired' ? (
              <Link href="/pricing" className={primaryButtonCls}>
                续费
              </Link>
            ) : null}
          </div>

          {/* ② 会员编号(+开通日期) */}
          <div
            className={`flex items-center justify-between gap-3 rounded-xl border ${sectionCls} px-4 py-3`}
          >
            <span className={`text-[13px] ${mutedCls}`}>会员编号</span>
            <div className="min-w-0 text-right">
              <p className={`text-[13px] font-semibold ${titleCls}`}>
                {displayMemberNo || '—'}
              </p>
              {startedText ? (
                <p className={`mt-0.5 text-[11px] ${mutedCls}`}>
                  {startedText}
                </p>
              ) : null}
            </div>
          </div>

          {/* ③ 有效期至 */}
          <div
            className={`flex items-center justify-between gap-3 rounded-xl border ${sectionCls} px-4 py-3`}
          >
            <span className={`text-[13px] ${mutedCls}`}>有效期至</span>
            <span className={`text-[13px] font-semibold ${titleCls}`}>
              {validityText || '—'}
            </span>
          </div>

          {/* ④ 会员key */}
          <div className={`rounded-xl border ${sectionCls} p-4`}>
            <div className="flex items-center justify-between gap-2">
              <span className={`text-[13px] font-semibold ${titleCls}`}>
                会员key
              </span>
              {displayKey ? (
                <button
                  type="button"
                  onClick={() => void handleCopy()}
                  disabled={copied}
                  className={neutralButtonCls}
                >
                  <CopyIcon className="h-3.5 w-3.5" />
                  <span>{copied ? '已复制' : '复制'}</span>
                </button>
              ) : null}
            </div>
            {displayKey ? (
              <p
                className={`mt-2 break-all rounded-lg px-3 py-2 font-mono text-[13px] leading-relaxed ${titleCls} ${keyBoxCls}`}
              >
                {displayKey}
              </p>
            ) : (
              <p className={`mt-2 text-[13px] ${mutedCls}`}>
                {profileError
                  ? '暂时无法加载会员key，请稍后刷新重试'
                  : profile?.accessKeyMask
                    ? profile.accessKeyMask
                    : '暂无会员key'}
              </p>
            )}
          </div>

          {/* ⑤ 会员码图片 */}
          <div className={`rounded-xl border ${sectionCls} p-4`}>
            <span className={`text-[13px] font-semibold ${titleCls}`}>
              会员码图片
            </span>
            {profile?.qrDataUrl ? (
              <div className="mt-3 flex flex-col items-start gap-3">
                <img
                  src={profile.qrDataUrl}
                  alt="会员码图片"
                  width={200}
                  height={200}
                  className="h-[200px] w-[200px] rounded-lg border border-neutral-200 dark:border-neutral-700"
                />
                <a
                  href={profile.qrDataUrl}
                  download="site-member-qr.png"
                  className={neutralButtonCls}
                >
                  下载二维码
                </a>
              </div>
            ) : (
              <p className={`mt-2 text-[13px] ${mutedCls}`}>
                {profileError
                  ? '暂时无法加载会员码，请稍后刷新重试'
                  : '暂无会员码'}
              </p>
            )}
          </div>

          {/* ⑥ 更换设备登录 */}
          <div className={`rounded-xl border ${sectionCls} p-4`}>
            <span className={`text-[13px] font-semibold ${titleCls}`}>
              更换设备登录
            </span>
            <p className={`mt-2 text-[13px] leading-relaxed ${mutedCls}`}>
              {PROFILE_DEVICE_TEXT}
            </p>
          </div>

          {/* ⑦ 注意事项 */}
          <div className={`rounded-xl border ${sectionCls} p-4`}>
            <span className={`text-[13px] font-semibold ${titleCls}`}>
              注意事项
            </span>
            {PROFILE_NOTICE_ITEMS.map((item) => (
              <p
                key={item}
                className={`mt-2 text-[13px] leading-relaxed ${mutedCls}`}
              >
                · {item}
              </p>
            ))}
          </div>
        </>
      ) : null}

      <MemberLoginDialog
        open={loginOpen}
        onClose={() => setLoginOpen(false)}
        onSuccess={() => window.location.reload()}
        onDisabled={() => void probeSession()}
      />
    </div>
  )
}
