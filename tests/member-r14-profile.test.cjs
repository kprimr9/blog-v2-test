/**
 * 站点会员 R14-B:气泡菜单三项 + 我的资料页 静态锚点单测。
 * - MemberNav 常量与源断言:菜单三项文案/官网 canonical/站内跳转;
 *   Q2=1A 去条件续费按钮(MemberNav 源不再含 /api/member/renew-url);
 * - StatsWidget 源断言:会员信息行整体可点击(/profile);
 * - memberCenterClient 源断言:中心 profile 端点与 callCenterProfile;
 * - [page].tsx 源断言:profile 分支接线(照 pricing);
 * - api/member/profile.ts 源断言:转发端点错误码全表;
 * - MemberProfileContent 纯函数:formatMemberStartedAtText;文案常量。
 * 公开仓红线:用例内不出现真实域名/密钥(官网 canonical 常量系既有先例,允许)。
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const { test } = require('node:test')
const babel = require('@babel/core')

const repoRoot = path.resolve(__dirname, '..')
const srcRoot = `${path.join(repoRoot, 'src')}${path.sep}`
const originalResolveFilename = Module._resolveFilename
const originalJsLoader = require.extensions['.js']
const originalTsLoader = require.extensions['.ts']

Module._resolveFilename = function resolveFilename(request, parent, isMain, options) {
  if (request === '@/src/lib/supabase/admin') {
    return path.join(__dirname, 'stubs', 'membership-admin-stub.cjs')
  }
  if (request === '@/src/lib/gallery/blogSite') {
    return path.join(__dirname, 'stubs', 'membership-blogsite-stub.cjs')
  }
  const resolvedRequest = request.startsWith('@/')
    ? path.join(repoRoot, request.slice(2))
    : request
  return originalResolveFilename.call(this, resolvedRequest, parent, isMain, options)
}

require.extensions['.js'] = function transpileProjectJs(module, filename) {
  if (!filename.startsWith(srcRoot)) {
    return originalJsLoader(module, filename)
  }
  const result = babel.transformFileSync(filename, {
    babelrc: false,
    configFile: false,
    presets: [
      [
        require.resolve('@babel/preset-env'),
        { targets: { node: 'current' }, modules: 'commonjs' },
      ],
    ],
  })
  return module._compile(result.code, filename)
}

require.extensions['.ts'] = function transpileProjectTs(module, filename) {
  const result = babel.transformFileSync(filename, {
    babelrc: false,
    configFile: false,
    presets: [
      require.resolve('@babel/preset-typescript'),
      [
        require.resolve('@babel/preset-env'),
        { targets: { node: 'current' }, modules: 'commonjs' },
      ],
    ],
  })
  return module._compile(result.code, filename)
}

require.extensions['.tsx'] = function transpileProjectTsx(module, filename) {
  const result = babel.transformFileSync(filename, {
    babelrc: false,
    configFile: false,
    presets: [
      [
        require.resolve('@babel/preset-typescript'),
        { isTSX: true, allExtensions: true },
      ],
      [
        require.resolve('@babel/preset-react'),
        { runtime: 'classic' },
      ],
      [
        require.resolve('@babel/preset-env'),
        { targets: { node: 'current' }, modules: 'commonjs' },
      ],
    ],
  })
  return module._compile(result.code, filename)
}

const memberNav = require('../src/components/member/MemberNav.tsx')
const statsWidget = require('../src/components/widget/StatsWidget.tsx')
const memberProfile = require('../src/components/member/MemberProfileContent.tsx')

Module._resolveFilename = originalResolveFilename
require.extensions['.js'] = originalJsLoader
if (originalTsLoader) require.extensions['.ts'] = originalTsLoader
else delete require.extensions['.ts']
delete require.extensions['.tsx']

const {
  MEMBER_NAV_PROFILE_LABEL,
  MEMBER_NAV_CREATOR_LABEL,
  MEMBER_NAV_RENEW_MENU_LABEL,
  MEMBER_NAV_OFFICIAL_URL,
} = memberNav

const {
  formatMemberStartedAtText,
  PROFILE_DEVICE_TEXT,
  PROFILE_NOTICE_ITEMS,
} = memberProfile

function readSrc(relPath) {
  return fs.readFileSync(path.join(repoRoot, relPath), 'utf8')
}

const memberNavSrc = readSrc('src/components/member/MemberNav.tsx')
const statsWidgetSrc = readSrc('src/components/widget/StatsWidget.tsx')
const centerClientSrc = readSrc('src/lib/blog/memberCenterClient.ts')
const pageSrc = readSrc('src/pages/[page].tsx')
const profileApiSrc = readSrc('src/pages/api/member/profile.ts')

// --- 常量 ------------------------------------------------------------------

test('R14 气泡菜单常量:三项文案 + 官网 canonical 单点', () => {
  assert.equal(MEMBER_NAV_PROFILE_LABEL, '我的资料')
  assert.equal(MEMBER_NAV_CREATOR_LABEL, '加入创作者')
  assert.equal(MEMBER_NAV_RENEW_MENU_LABEL, '续费会员')
  assert.equal(MEMBER_NAV_OFFICIAL_URL, 'https://www.proplus.team/')
})

// --- 气泡(§6-Q2=1A 去条件续费;三菜单行) -----------------------------------

test('MemberNav 源:三菜单行在;站内 /profile、/pricing 与官网链接齐', () => {
  assert.ok(memberNavSrc.includes('href="/profile"'))
  assert.ok(memberNavSrc.includes('href="/pricing"'))
  assert.ok(memberNavSrc.includes('MEMBER_NAV_OFFICIAL_URL'))
  assert.ok(memberNavSrc.includes('target="_blank"'))
  assert.ok(memberNavSrc.includes('rel="noopener noreferrer"'))
  assert.ok(memberNavSrc.includes('MEMBER_NAV_PROFILE_LABEL'))
  assert.ok(memberNavSrc.includes('MEMBER_NAV_CREATOR_LABEL'))
  assert.ok(memberNavSrc.includes('MEMBER_NAV_RENEW_MENU_LABEL'))
})

test('MemberNav 源:Q2=1A 条件续费按钮已去(不再引用 renew-url 直链)', () => {
  assert.ok(!memberNavSrc.includes('/api/member/renew-url'))
})

// --- standard 公告卡(§6-Q1=C 信息行可点击) ---------------------------------

test('StatsWidget 源:会员信息行整体可点击 → /profile', () => {
  assert.ok(statsWidgetSrc.includes('href="/profile"'))
})

// --- 中心转发 ----------------------------------------------------------------

test('memberCenterClient 源:profile 端点与 callCenterProfile 接线', () => {
  assert.ok(centerClientSrc.includes("'/api/public/site-member/profile'"))
  assert.ok(centerClientSrc.includes('callCenterProfile'))
  assert.ok(centerClientSrc.includes("kind: 'login' | 'refresh' | 'renew' | 'handoff' | 'profile'"))
})

test('api/member/profile 源:错误码全表(guest/invalid 401、revoked 403、rate_limited 429、unavailable 503)', () => {
  assert.ok(profileApiSrc.includes("status(401)"))
  assert.ok(profileApiSrc.includes("status(403)"))
  assert.ok(profileApiSrc.includes('retry_after_seconds'))
  assert.ok(profileApiSrc.includes('status(429)'))
  assert.ok(profileApiSrc.includes('status(503)'))
  assert.ok(profileApiSrc.includes('callCenterProfile'))
  assert.ok(profileApiSrc.includes("Cache-Control', 'no-store"))
})

// --- 页面接线 ----------------------------------------------------------------

test('[page].tsx 源:profile 分支照 pricing(双层壳 + 无 Notion 页兜底 + widgets 门控)', () => {
  assert.ok(pageSrc.includes("MemberProfileContent"))
  assert.ok(pageSrc.includes("slug === 'profile'"))
  assert.ok(pageSrc.includes('profileMembership'))
  assert.ok(pageSrc.includes('我的资料'))
})

// --- 纯函数与文案 -----------------------------------------------------------

test('formatMemberStartedAtText:ISO → 开通于 YYYY/MM/DD;无效/缺失 → 空串', () => {
  assert.equal(formatMemberStartedAtText('2026-09-01T03:00:00.000Z'), '开通于 2026/09/01')
  assert.equal(formatMemberStartedAtText(null), '')
  assert.equal(formatMemberStartedAtText(undefined), '')
  assert.equal(formatMemberStartedAtText(''), '')
  assert.equal(formatMemberStartedAtText('not-a-date'), '')
})

test('PROFILE 文案:换设备说明非空;注意事项三条', () => {
  assert.ok(PROFILE_DEVICE_TEXT.length > 0)
  assert.ok(PROFILE_DEVICE_TEXT.includes('会员码图片'))
  assert.equal(PROFILE_NOTICE_ITEMS.length, 3)
  assert.ok(PROFILE_NOTICE_ITEMS[0].includes('登录凭证'))
  assert.ok(PROFILE_NOTICE_ITEMS[1].includes('续费即可恢复'))
  assert.ok(PROFILE_NOTICE_ITEMS[2].includes('平台客服'))
})

// 组件可加载本身即模块级断言(statsWidget 引用保持有效,防 exports 断链)
test('StatsWidget 仍引用 MemberNav 导出面(续费/临期/文案单点不破)', () => {
  assert.ok(typeof statsWidget.resolveStatsWidgetMemberButtons === 'function')
})
