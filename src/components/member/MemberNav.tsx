'use client'

import Link from 'next/link'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  formatMemberValidityText,
  MemberLoginDialog,
} from '@/src/components/member/MemberLoginDialog'
import { useActiveTheme } from '@/src/components/theme/ActiveThemeProvider'
import { useMemberNavConfig } from '@/src/components/theme/SitePlanContext'
import { isTweetDarkTheme, isTweetLightTheme } from '@/src/themes/tweet/tweetTheme'

/**
 * 站点会员 R2-B5a:导航会员化组件族(替代 B4 的 MemberNavEntries)。
 * - 变体:standard(Navbar 桌面纵向红条+登录)/ standard-mobile(折叠菜单整行红条)
 *   / gallery(侧栏红描边次级)/ tweet、tweet-mobile(仅登录位/chip,无红条);
 * - SSG 安全:挂载后单次探测 /api/member/session;探测完成前按 guest 版式静态渲染
 *   (无跳动;不做轮询);
 * - 状态判定:active/expired → MemberChip(红条隐藏,3A);guest/错误 → 登录位;
 *   disabled → 整体不渲染(Context null 已保证,session disabled 双保险);
 * - R3-6(5A):standard/standard-mobile 未登录不渲染任何内容(登录入口移至公告卡),
 *   gallery/tweet 变体行为不变;R12-B(6A):standard/standard-mobile 登录态 chip
 *   亦移除(除 hidden 外一律不渲染;会员面/登出=首页与 about 公告卡信息块),
 *   见 resolveMemberNavStandardRender;
 * - R4-B2:挂载先同步判 sm_member_no cookie——有值且仍是初始 guest → 置临时态
 *   {status:'active', memberNo: cookie 值, expiresAt: null} chip 即显(有效期缺失
 *   走「会员生效中」兜底),随后探测补全/纠偏(实为 guest → chip 消失;active/expired
 *   → 填充有效期);探测失败且 cookie 仍含 member_no → 保留临时态(§11.1-S4 cookie
 *   判据;登出成功 cookie 已清 → 回落 guest);resolveMemberNavState/
 *   resolveMemberNavStandardRender 纯函数合同不变;
 * - member_no 来源:session 响应 > sm_member_no cookie(非 HttpOnly 展示值)> 缺省;
 * - chip 浮窗:createPortal 挂 document.body(祖先可能带 backdrop-blur/transform,
 *   仓内两次 fixed 劫持事故先例;R1 红线,禁止原位渲染);hover 与 click 均可开,
 *   点击外部/Escape 关闭;内容=欢迎行 + 有效期至 + 菜单三项 + 退出登录;
 *   R12-B(2A):w-72 实底 + 欢迎行(26px 头像档) + 实心蓝续费 + 红退出。
 *   R14-B(Q2=1A):条件续费按钮(临期 ≤7 天/已到期才显示、直达商城)去掉,
 *   统一常显「续费会员」菜单行 → 站内 /pricing;新增「我的资料」→ /profile、
 *   「加入创作者」→ 官网新开页(MEMBER_NAV_OFFICIAL_URL)。
 * - R12-B(第6条):登录弹窗 onSuccess = 整页 reload(文章页即时解锁;弹窗在
 *   standard 族已不可达,公告卡弹窗走 StatsWidget 自有 onSuccess)。
 */

export type MemberNavVariant =
  | 'standard'
  | 'standard-mobile'
  | 'gallery'
  | 'tweet'
  | 'tweet-mobile'

export const MEMBER_NAV_JOIN_LABEL = '加入会员'
/** R9-6:standard/standard-mobile 变体紧凑 label(「会员」;金冠图标与 /pricing 跳转不变) */
export const MEMBER_NAV_JOIN_LABEL_COMPACT = '会员'
export const MEMBER_NAV_LOGIN_LABEL = '登录'
export const MEMBER_NAV_LOGOUT_LABEL = '退出登录'
export const MEMBER_NAV_RENEW_LABEL = '续费'
/** R14-B:气泡菜单项文案(我的资料/加入创作者/续费会员) */
export const MEMBER_NAV_PROFILE_LABEL = '我的资料'
export const MEMBER_NAV_CREATOR_LABEL = '加入创作者'
export const MEMBER_NAV_RENEW_MENU_LABEL = '续费会员'
/** R14-B:官网链接(canonical www 形式;既有三处 apex 存量不动) */
export const MEMBER_NAV_OFFICIAL_URL = 'https://www.proplus.team/'
export const MEMBER_NAV_WELCOME_PREFIX = '欢迎会员'
/** 临期阈值(天):到期或 ≤N 天内到期时浮窗显示「续费」 */
export const MEMBER_NAV_EXPIRING_SOON_DAYS = 7

/** 展示用 member_no cookie 名(与 memberPassport.MEMBER_NO_COOKIE_NAME 同值;
 *  客户端组件不引 jose 链,靠 tests 交叉断言单一事实源) */
const MEMBER_NO_COOKIE_LOCAL_NAME = 'sm_member_no'

/** 「欢迎会员 {member_no}」;缺省仅「欢迎会员」 */
export function formatMemberWelcomeLabel(
  memberNo: string | null | undefined
): string {
  const trimmed = typeof memberNo === 'string' ? memberNo.trim() : ''
  return trimmed ? `${MEMBER_NAV_WELCOME_PREFIX} ${trimmed}` : MEMBER_NAV_WELCOME_PREFIX
}

/** session 状态 → 导航形态:'disabled' 不渲染;active/expired → chip;其余 → 登录位 */
export function resolveMemberNavState(
  status: unknown
): 'join' | 'chip' | 'hidden' {
  if (status === 'disabled') return 'hidden'
  if (status === 'active' || status === 'expired') return 'chip'
  // guest / 探测前 / 探测失败 → guest 版式(登录位)
  return 'join'
}

/** R3-6(5A)→R12-B(6A):standard/standard-mobile 除 hidden 外一律不渲染
 * (未登录 join=登录入口移至公告卡 StatsWidget 双按钮;R12-B 起登录态 chip 亦
 * 移除=会员面/登出移至首页与 about 页公告卡信息块);hidden 态全变体不渲染;
 * gallery/tweet 变体不受本判定约束(行为不变)。 */
export function resolveMemberNavStandardRender(
  variant: MemberNavVariant | string,
  navState: 'join' | 'chip' | 'hidden'
): boolean {
  if (navState === 'hidden') return false
  if (variant === 'standard' || variant === 'standard-mobile') {
    // R12-B(6A):join 与 chip 一律不渲染(除 hidden 外一律 false)
    return false
  }
  return true
}

/** 展示值清洗:trim → decode(写侧 encode)→ 去控制字符 → 限长 32 */
export function sanitizeMemberNo(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  let value = raw.trim()
  try {
    value = decodeURIComponent(value)
  } catch {
    // 非法编码保持原文(写侧已 encode,正常不触发)
  }
  return value
    .replace(/[\x00-\x1f\x7f]/g, '')
    .slice(0, 32)
    .trim()
}

/** 从 document.cookie 形态字符串读 sm_member_no(展示用) */
export function readMemberNoFromCookieString(cookieString: string): string {
  const prefix = `${MEMBER_NO_COOKIE_LOCAL_NAME}=`
  for (const part of cookieString.split(';')) {
    const segment = part.trim()
    if (segment.startsWith(prefix)) {
      return sanitizeMemberNo(segment.slice(prefix.length))
    }
  }
  return ''
}

/** 续费按钮可见:已到期或 N 天内到期;缺失/无效 → false */
export function isMemberExpiringSoon(
  expiresAt: string | null | undefined,
  nowMs?: number
): boolean {
  if (!expiresAt) return false
  const time = new Date(expiresAt).getTime()
  if (Number.isNaN(time)) return false
  const now = typeof nowMs === 'number' ? nowMs : Date.now()
  return time - now <= MEMBER_NAV_EXPIRING_SOON_DAYS * 86400_000
}

/** 皇冠图标（R4-B3 起导出；R5-B1 改实心填充，色由调用方 className 给出） */
export const CrownIcon = ({ className = '' }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
    <path d="M3 8l4.5 4L12 5l4.5 7L21 8l-1.6 10.2a1 1 0 0 1-1 .8H5.6a1 1 0 0 1-1-.8L3 8z" />
  </svg>
)

const PersonIcon = ({ className = '' }: { className?: string }) => (
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
    <circle cx="12" cy="8" r="3.5" />
    <path d="M5 20c.8-3.2 3.6-5 7-5s6.2 1.8 7 5" />
  </svg>
)

/** R14-B:外链小图标(「加入创作者」行末缀;禁 emoji) */
const ExternalLinkIcon = ({ className = '' }: { className?: string }) => (
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
    <path d="M14 5h5v5" />
    <path d="M19 5l-9 9" />
    <path d="M19 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" />
  </svg>
)

type MemberNavSession = {
  status: unknown
  memberNo: string
  expiresAt: string | null
}

const INITIAL_SESSION: MemberNavSession = {
  status: 'guest',
  memberNo: '',
  expiresAt: null,
}

const POPOVER_HOVER_CLOSE_MS = 150

export function MemberNav({ variant }: { variant: MemberNavVariant }) {
  const config = useMemberNavConfig()
  const [session, setSession] = useState<MemberNavSession>(INITIAL_SESSION)
  const [loginOpen, setLoginOpen] = useState(false)

  const probeSession = useCallback(async () => {
    try {
      const res = await fetch('/api/member/session', { cache: 'no-store' })
      const data = await res.json().catch(() => null)
      const status = data?.status
      if (status === 'active' || status === 'expired') {
        // member_no:session 响应 > sm_member_no cookie > 缺省
        let memberNo =
          typeof data?.member_no === 'string'
            ? sanitizeMemberNo(data.member_no)
            : ''
        if (!memberNo && typeof document !== 'undefined') {
          memberNo = readMemberNoFromCookieString(document.cookie)
        }
        setSession({
          status,
          memberNo,
          expiresAt:
            typeof data?.expires_at === 'string' ? data.expires_at : null,
        })
        return
      }
      if (status === 'disabled') {
        setSession({ status: 'disabled', memberNo: '', expiresAt: null })
        return
      }
      setSession({ status: 'guest', memberNo: '', expiresAt: null })
    } catch {
      // 探测失败:cookie 仍含 member_no → 保留当前临时态(chip 不消失,§11.1-S4
      // cookie 判据;登出成功则 cookie 已清 → 落到下方 guest);否则按现状 guest
      if (readMemberNoFromCookieString(document.cookie)) return
      setSession({ status: 'guest', memberNo: '', expiresAt: null })
    }
  }, [])

  // 挂载单次探测(无轮询);R4-B2:先同步判 cookie 置临时态 chip 快显,探测仅补全/纠偏
  useEffect(() => {
    const cookieMemberNo = readMemberNoFromCookieString(document.cookie)
    if (cookieMemberNo) {
      setSession((prev) =>
        prev.status === 'guest' && !prev.memberNo
          ? { status: 'active', memberNo: cookieMemberNo, expiresAt: null }
          : prev
      )
    }
    void probeSession()
  }, [probeSession])

  if (!config) return null

  const navState = resolveMemberNavState(session.status)
  // R3-6:hidden 全变体不渲染;R12-B(6A):standard/standard-mobile 除 hidden 外
  // 一律不渲染(chip 分支已删;探测前按 guest 静态渲染=空,不闪现按钮)
  if (!resolveMemberNavStandardRender(variant, navState)) return null

  const chip = navState === 'chip' ? { memberNo: session.memberNo, expiresAt: session.expiresAt } : null

  return (
    <>
      {variant === 'gallery' ? (
        chip ? (
          <MemberChip variant="gallery" config={chip} onProbe={probeSession} />
        ) : (
          <div className="flex items-stretch gap-2">
            <JoinButton variant="gallery" />
            <LoginButton variant="gallery" onOpen={() => setLoginOpen(true)} />
          </div>
        )
      ) : null}
      {variant === 'tweet' || variant === 'tweet-mobile' ? (
        chip ? (
          <MemberChip variant={variant} config={chip} onProbe={probeSession} />
        ) : (
          <LoginButton variant={variant} onOpen={() => setLoginOpen(true)} />
        )
      ) : null}
      <MemberLoginDialog
        open={loginOpen}
        onClose={() => setLoginOpen(false)}
        onSuccess={() => window.location.reload()}
        onDisabled={() => void probeSession()}
      />
    </>
  )
}

/** 红条/红描边「加入会员」入口 */
function JoinButton({ variant }: { variant: MemberNavVariant }) {
  if (variant === 'standard') {
    return (
      <Link
        href="/pricing"
        aria-label={MEMBER_NAV_JOIN_LABEL_COMPACT}
        className="flex h-[26px] items-center justify-center gap-1.5 rounded-md bg-[#dc2626] px-2.5 text-xs font-semibold text-white transition-colors hover:bg-[#b91c1c]"
      >
        <CrownIcon className="h-4 w-4 shrink-0 text-[#FACC15]" />
        <span className="whitespace-nowrap">{MEMBER_NAV_JOIN_LABEL_COMPACT}</span>
      </Link>
    )
  }
  if (variant === 'standard-mobile') {
    return (
      <Link
        href="/pricing"
        aria-label={MEMBER_NAV_JOIN_LABEL_COMPACT}
        className="flex h-10 w-full items-center justify-center gap-1.5 rounded-2xl bg-[#dc2626] px-4 text-sm font-semibold text-white shadow-[0px_0px_14px_-5px_rgb(186_186_186/70%)] transition-all hover:bg-[#b91c1c] active:scale-[0.98]"
      >
        <CrownIcon className="h-4 w-4 shrink-0 text-[#FACC15]" />
        <span>{MEMBER_NAV_JOIN_LABEL_COMPACT}</span>
      </Link>
    )
  }
  if (variant === 'gallery') {
    return (
      <Link
        href="/pricing"
        aria-label={MEMBER_NAV_JOIN_LABEL}
        className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-red-500/70 py-2 text-center text-[13px] font-medium text-red-600 transition-colors hover:bg-red-50 hover:text-red-700"
      >
        <CrownIcon className="h-4 w-4 shrink-0 text-[#FACC15]" />
        <span>{MEMBER_NAV_JOIN_LABEL}</span>
      </Link>
    )
  }
  // tweet / tweet-mobile 无红条(加入会员在 profile 卡 TweetVendingButton)
  return null
}

/** 登录小字按钮(开全局登录弹窗) */
function LoginButton({
  variant,
  onOpen,
}: {
  variant: MemberNavVariant
  onOpen: () => void
}) {
  if (variant === 'standard') {
    return (
      <button
        type="button"
        onClick={onOpen}
        aria-label={MEMBER_NAV_LOGIN_LABEL}
        className="flex h-4 items-center justify-center whitespace-nowrap text-[11px] leading-none text-neutral-500 transition-colors hover:text-black dark:text-neutral-400 dark:hover:text-white"
      >
        {MEMBER_NAV_LOGIN_LABEL}
      </button>
    )
  }
  if (variant === 'standard-mobile') {
    return (
      <button
        type="button"
        onClick={onOpen}
        aria-label={MEMBER_NAV_LOGIN_LABEL}
        className="flex h-8 items-center justify-center rounded-2xl text-xs font-medium text-neutral-600 transition-colors hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-white"
      >
        {MEMBER_NAV_LOGIN_LABEL}
      </button>
    )
  }
  if (variant === 'gallery') {
    return (
      <button
        type="button"
        onClick={onOpen}
        aria-label={MEMBER_NAV_LOGIN_LABEL}
        className="flex-1 rounded-md border border-neutral-200 py-2 text-center text-[13px] font-medium text-neutral-600 transition-colors hover:bg-neutral-50 hover:text-neutral-900"
      >
        {MEMBER_NAV_LOGIN_LABEL}
      </button>
    )
  }
  // tweet / tweet-mobile:R12-B(3A)登录按钮化——与 .proplus-create-btn 同形;
  // 颜色随主题灰阶变量(悬停反色,浅/深自动适配;零新 CSS,禁硬编码色值)
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={MEMBER_NAV_LOGIN_LABEL}
      className="inline-flex cursor-pointer items-center justify-center whitespace-nowrap rounded-[7px] border px-3 py-2 text-[13px] font-semibold leading-[1.15] transition-colors border-[color:var(--tweet-gray8)] text-[color:var(--tweet-gray12)] hover:bg-[color:var(--tweet-gray12)] hover:text-[color:var(--tweet-gray1)]"
    >
      {MEMBER_NAV_LOGIN_LABEL}
    </button>
  )
}

type MemberChipConfig = {
  memberNo: string
  expiresAt: string | null
}

/** 登录态 chip:灰阶头像 + 欢迎会员;浮窗(portal 挂 body)承载到期/续费/退出 */
function MemberChip({
  variant,
  config,
  onProbe,
}: {
  variant: MemberNavVariant
  config: MemberChipConfig
  onProbe: () => Promise<void>
}) {
  const activeTheme = useActiveTheme()
  const [popoverOpen, setPopoverOpen] = useState(false)
  const [popoverStyle, setPopoverStyle] = useState<React.CSSProperties>({})
  const [mounted, setMounted] = useState(false)
  const [renewBusy, setRenewBusy] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const chipRef = useRef<HTMLButtonElement | null>(null)
  const popoverRef = useRef<HTMLDivElement | null>(null)
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    setMounted(true)
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
    }
  }, [])

  const scheduleClose = useCallback(() => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
    closeTimerRef.current = setTimeout(() => setPopoverOpen(false), POPOVER_HOVER_CLOSE_MS)
  }, [])

  const cancelClose = useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
  }, [])

  const openPopover = useCallback(() => {
    cancelClose()
    const rect = chipRef.current?.getBoundingClientRect()
    if (rect) {
      const centered = typeof window !== 'undefined' && window.innerWidth < 640
      setPopoverStyle(
        centered
          ? {
              top: rect.bottom + 8,
              left: '50%',
              transform: 'translateX(-50%)',
            }
          : {
              top: rect.bottom + 8,
              right: (typeof window !== 'undefined' ? window.innerWidth : 0) - rect.right,
            }
      )
    }
    setPopoverOpen(true)
  }, [cancelClose])

  // 点击外部 / Escape 关闭;关闭后焦点回 chip
  useEffect(() => {
    if (!popoverOpen) return
    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null
      if (
        chipRef.current?.contains(target) ||
        popoverRef.current?.contains(target)
      ) {
        return
      }
      setPopoverOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPopoverOpen(false)
    }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('touchstart', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    popoverRef.current?.focus()
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('touchstart', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [popoverOpen])

  const handleLogout = useCallback(async () => {
    if (loggingOut) return
    setLoggingOut(true)
    try {
      await fetch('/api/member/logout', { method: 'POST', cache: 'no-store' })
    } catch {
      // 服务端清 cookie;失败也回落 guest
    }
    setLoggingOut(false)
    setPopoverOpen(false)
    await onProbe()
  }, [loggingOut, onProbe])

  // R3-3:有效期行永久映射(永久 →「永久有效」;限时 → 前缀+日期;缺失/无效 → 兜底文案)
  const validityText = formatMemberValidityText(config.expiresAt)

  // 死面登记(R12-B-9):6A 后 standard/standard-mobile 不再渲染 chip,
  // 下方 chipBaseCls/avatarCls 的 standard 分支成为死面,保留不删(最小 diff)
  const chipBaseCls =
    variant === 'tweet' || variant === 'tweet-mobile'
      ? 'flex cursor-pointer items-center gap-2 text-[1rem] leading-6 text-[color:var(--tweet-muted)] transition-colors hover:text-[color:var(--tweet-gray12)]'
      : variant === 'gallery'
        ? 'flex w-full items-center gap-1.5 rounded-md border border-neutral-200 px-2 py-1.5 text-[13px] font-medium text-neutral-600 transition-colors hover:bg-neutral-50 hover:text-neutral-900'
        : 'flex h-12 items-center gap-1.5 text-xs font-medium text-neutral-600 transition-colors hover:text-black dark:text-neutral-300 dark:hover:text-white'

  const avatarCls =
    variant === 'tweet' || variant === 'tweet-mobile'
      ? 'flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[color:var(--tweet-gray6)] bg-[color:var(--tweet-gray3)] text-[color:var(--tweet-gray11)]'
      : 'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-neutral-200 bg-neutral-100 text-neutral-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300'

  // ---- 浮窗面板主题三态(与登录弹窗同源;R12-B(2A)实底去半透明) ----
  const panelTheme =
    isTweetLightTheme(activeTheme) || activeTheme === 'gallery'
      ? 'light'
      : isTweetDarkTheme(activeTheme)
        ? 'dark'
        : 'auto'
  const panelCls =
    panelTheme === 'dark'
      ? 'border-neutral-700 bg-[#1b1b1e]'
      : panelTheme === 'light'
        ? 'border-neutral-200/80 bg-white'
        : 'border-neutral-200/80 bg-white dark:border-neutral-700 dark:bg-[#181818]'
  const mutedCls =
    panelTheme === 'dark'
      ? 'text-neutral-400'
      : panelTheme === 'light'
        ? 'text-neutral-500'
        : 'text-neutral-500 dark:text-neutral-400'
  // R12-B(2A):浮窗欢迎行(26px 头像档 + 13px 加粗;深浅/auto 三态)
  const popoverAvatarCls =
    panelTheme === 'dark'
      ? 'flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full border border-[#46464e] bg-[#2f2f36] text-[#cfcfd6]'
      : panelTheme === 'light'
        ? 'flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full border border-[#dcdce2] bg-[#f0f0f3] text-[#5a5a66]'
        : 'flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full border border-[#dcdce2] bg-[#f0f0f3] text-[#5a5a66] dark:border-[#46464e] dark:bg-[#2f2f36] dark:text-[#cfcfd6]'
  const popoverTitleCls =
    panelTheme === 'dark'
      ? 'text-[13px] font-bold text-[#f2f2f4]'
      : panelTheme === 'light'
        ? 'text-[13px] font-bold text-[#1a1a1f]'
        : 'text-[13px] font-bold text-[#1a1a1f] dark:text-[#f2f2f4]'
  // R14-B:气泡菜单行(中性行,hover 轻微提亮,三态;press 反馈体例延续;
  // !text 前缀=tweet 主题 a{color:inherit}(0,1,2)压制锚点文字色)
  const menuRowCls =
    panelTheme === 'dark'
      ? 'flex h-9 w-full items-center justify-center gap-1.5 rounded-[9px] text-[12.5px] font-bold !text-[#cfcfd6] transition-colors hover:bg-[#2f2f36] active:scale-[0.98]'
      : panelTheme === 'light'
        ? 'flex h-9 w-full items-center justify-center gap-1.5 rounded-[9px] text-[12.5px] font-bold !text-[#5a5a66] transition-colors hover:bg-[#f0f0f3] active:scale-[0.98]'
        : 'flex h-9 w-full items-center justify-center gap-1.5 rounded-[9px] text-[12.5px] font-bold !text-[#5a5a66] transition-colors hover:bg-[#f0f0f3] active:scale-[0.98] dark:!text-[#cfcfd6] dark:hover:bg-[#2f2f36]'
  // 死面登记(R12-B-9):续费改实心蓝后 primaryButtonCls 不再有消费方,保留不删
  const primaryButtonCls =
    panelTheme === 'dark'
      ? 'bg-blue-600 hover:bg-blue-500'
      : panelTheme === 'light'
        ? 'bg-neutral-900 hover:bg-neutral-700'
        : 'bg-neutral-900 hover:bg-neutral-700 dark:bg-blue-600 dark:hover:bg-blue-500'

  return (
    <>
      <button
        ref={chipRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={popoverOpen}
        aria-label={formatMemberWelcomeLabel(config.memberNo)}
        className={chipBaseCls}
        onClick={() => (popoverOpen ? setPopoverOpen(false) : openPopover())}
        onMouseEnter={openPopover}
        onMouseLeave={scheduleClose}
        onFocus={openPopover}
      >
        <span className={avatarCls}>
          <PersonIcon className="h-4 w-4" />
        </span>
        <span className="max-w-[10rem] truncate">
          {formatMemberWelcomeLabel(config.memberNo)}
        </span>
      </button>

      {mounted && popoverOpen
        ? createPortal(
            <div
              ref={popoverRef}
              role="dialog"
              aria-label="会员信息"
              tabIndex={-1}
              style={popoverStyle}
              className={`fixed z-[9997] flex w-72 flex-col gap-2.5 rounded-xl border p-[18px] shadow-xl outline-none ${panelCls}`}
              onMouseEnter={cancelClose}
              onMouseLeave={scheduleClose}
            >
              {/* R12-B(2A):欢迎行(小头像 + 欢迎会员) */}
              <div className="flex items-center gap-2.5">
                <span className={popoverAvatarCls}>
                  <PersonIcon className="h-[14px] w-[14px]" />
                </span>
                <span className={`max-w-[11rem] truncate ${popoverTitleCls}`}>
                  {formatMemberWelcomeLabel(config.memberNo)}
                </span>
              </div>
              <p className={`mb-1.5 text-xs leading-relaxed ${mutedCls}`}>
                {validityText || '会员生效中'}
              </p>
              {/* R14-B:菜单三项——我的资料→站内 /profile;加入创作者→官网新开页;
                  续费会员→站内 /pricing(Q2=1A:原条件续费按钮去掉,常显菜单行) */}
              <Link href="/profile" aria-label={MEMBER_NAV_PROFILE_LABEL} className={menuRowCls}>
                {MEMBER_NAV_PROFILE_LABEL}
              </Link>
              <a
                href={MEMBER_NAV_OFFICIAL_URL}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={MEMBER_NAV_CREATOR_LABEL}
                className={menuRowCls}
              >
                {MEMBER_NAV_CREATOR_LABEL}
                <ExternalLinkIcon className="h-3.5 w-3.5 shrink-0" />
              </a>
              <Link href="/pricing" aria-label={MEMBER_NAV_RENEW_MENU_LABEL} className={menuRowCls}>
                {MEMBER_NAV_RENEW_MENU_LABEL}
              </Link>
              <button
                type="button"
                onClick={() => void handleLogout()}
                disabled={loggingOut}
                className="h-9 w-full rounded-[9px] bg-[#dc2626] text-[12.5px] font-bold text-white transition-colors hover:bg-[#b91c1c] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loggingOut ? '退出中…' : MEMBER_NAV_LOGOUT_LABEL}
              </button>
            </div>,
            document.body
          )
        : null}
    </>
  )
}
