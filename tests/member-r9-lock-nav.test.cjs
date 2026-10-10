/**
 * 站点会员 R9-B:锁区改版(guest 面板)+ 导航「会员」紧凑 label 最低用例集。
 * - ① 常量:MEMBER_NAV_JOIN_LABEL 逐字不动(const 未改);新增
 *   MEMBER_NAV_JOIN_LABEL_COMPACT === '会员';
 * - ② JoinButton 函数体切片:COMPACT ×4(standard×2+standard-mobile×2);
 *   裸 MEMBER_NAV_JOIN_LABEL ×2(gallery aria+文本);
 * - ③④ MemberContentGate 源文件静态复核(正向新文案/负向档位窗口与直达链零残留);
 * - ⑤ 守护断言:expired/revoked 面板、主按钮、续费链、pricing 链不动;
 * - ⑥ R11-B:StatsWidget 公告卡红钮 label 改回全量 MEMBER_NAV_JOIN_LABEL
 *   (「加入会员」),皇冠/悬挂包裹删除;登录白钮/gallery/tweet/其余零改动。
 * - R11-B:锁区 guest 面板登录入口链整体删除(登录按钮/弹窗/state 零残留);
 *   「获取会员」按钮纯平色轻量化(方案 C·dc2626,无皇冠,文字严格居中)+间距
 *   重调(gap-5/py-7);③正向断言集翻转(登录入口/CrownIcon/FACC15/悬挂/
 *   e24a4a 转负向,新增 dc2626)+负向增补(旧标题/旧副标题零残留;「加入会员」
 *   仅剩 expired 区 2 处=块注释+回落按钮,§11-B1;旧间距 gap-4 px-5 py-8
 *   防回退);StatsWidget 陈旧页自愈(memberSession.status !== 'disabled');
 *   pricing 三 CTA 悬挂式严格居中(justify-center gap-1.5 零残留,
 *   right-full×3;ul gap-1.5 保留恰 1 处)。
 * - R12-B 追加:6A standard chip 移除(纯函数翻转+渲染分支零残留)/tweet chip
 *   flex 修复/2A 浮窗重设计(w-72 实底+欢迎行+蓝续费红退出)/3A tweet 登录按钮化
 *   (灰阶变量零硬编码)/1B 公告卡信息面板(欢迎会员+有效期+logout reload)/
 *   4C 解锁区分隔线+压线小标(容器终态/承载面底色)/登录后 reload 分文件计数。
 * gate 侧为纯静态 fs.readFileSync 断言(不 require MemberContentGate,
 * 规避 BlockRender→notion 重链;§11-B6⑤)。
 * 公开仓红线:用例内不出现真实域名/密钥。
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

// React 组件文件按 JSX 转译(babel preset 无 JSX;组件内含 tsx 语法)
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

Module._resolveFilename = originalResolveFilename
require.extensions['.js'] = originalJsLoader
if (originalTsLoader) require.extensions['.ts'] = originalTsLoader
else delete require.extensions['.ts']
delete require.extensions['.tsx']

const gateSrc = fs.readFileSync(
  path.join(repoRoot, 'src/components/post/MemberContentGate.tsx'),
  'utf8'
)
const navSrc = fs.readFileSync(
  path.join(repoRoot, 'src/components/member/MemberNav.tsx'),
  'utf8'
)
const statsSrc = fs.readFileSync(
  path.join(repoRoot, 'src/components/widget/StatsWidget.tsx'),
  'utf8'
)
const pricingSrc = fs.readFileSync(
  path.join(repoRoot, 'src/components/member/PricingPageContent.tsx'),
  'utf8'
)

test('R9-6 常量:MEMBER_NAV_JOIN_LABEL 逐字不动;COMPACT === 会员', () => {
  assert.equal(memberNav.MEMBER_NAV_JOIN_LABEL, '加入会员')
  assert.equal(memberNav.MEMBER_NAV_JOIN_LABEL_COMPACT, '会员')
})

test('R9-6 JoinButton 切片:COMPACT×4(standard×2+standard-mobile×2);裸 MEMBER_NAV_JOIN_LABEL×2(gallery)', () => {
  const start = navSrc.indexOf('function JoinButton')
  const end = navSrc.indexOf('/** 登录小字按钮')
  // B5 防御:未来重命名致 indexOf=-1 时勿静默放大切片
  assert.ok(start >= 0 && end > start)
  const joinButtonSrc = navSrc.slice(start, end)
  assert.equal(
    (joinButtonSrc.match(/MEMBER_NAV_JOIN_LABEL_COMPACT/g) || []).length,
    4
  )
  assert.equal(
    (joinButtonSrc.match(/MEMBER_NAV_JOIN_LABEL(?!_)/g) || []).length,
    2
  )
})

test('R11-B gate 源文件正向:新标题/纯平色红按钮/毛玻璃/新间距;登录入口链零残留', () => {
  assert.ok(gateSrc.includes('内容已隐藏，请订阅会员后查看'))
  assert.ok(gateSrc.includes('获取会员'))
  assert.ok(gateSrc.includes('backdrop-blur'))
  assert.ok(gateSrc.includes('font-bold'))
  assert.ok(gateSrc.includes('dc2626'))
  assert.ok(gateSrc.includes('gap-5'))
  assert.ok(gateSrc.includes('py-7'))
  assert.equal(gateSrc.includes('已有会员？立即登录→'), false)
  assert.equal(gateSrc.includes('CrownIcon'), false)
  assert.equal(gateSrc.includes('MemberLoginDialog'), false)
  assert.equal(gateSrc.includes('text-[#FACC15]'), false)
  assert.equal(gateSrc.includes('absolute right-full'), false)
  assert.equal(gateSrc.includes('e24a4a'), false)
  assert.equal(gateSrc.includes('gap-4 px-5 py-8'), false)
})

test('R10-B gate 负向:旧标题/旧副标题零残留;「加入会员」仅剩 expired 区 2 处（注释+回落按钮）', () => {
  // R12-B(4C):「会员专属内容」压线小标常量回归(旧负向断言翻转为 true)
  assert.equal(gateSrc.includes('会员专属内容'), true)
  assert.equal(gateSrc.includes('已隐藏，请登录后查看'), false)
  assert.equal((gateSrc.match(/加入会员/g) || []).length, 2)
})

test('R9-5 gate 源文件负向:档位窗口/订阅直达链零残留', () => {
  assert.equal(gateSrc.includes('已有会员码？登录'), false)
  assert.equal(gateSrc.includes('formatMembershipTierLabel'), false)
  assert.equal(gateSrc.includes('resolveStoreUrl'), false)
  assert.equal(gateSrc.includes('storeUrl'), false)
  assert.equal(gateSrc.includes('?go=1'), false)
})

test('守护:expired/revoked 面板与主按钮/pricing 链不动', () => {
  assert.ok(gateSrc.includes('会员已到期'))
  assert.ok(gateSrc.includes('该会员已被停用'))
  assert.ok(gateSrc.includes('立即续费'))
  assert.ok(gateSrc.includes('加入会员'))
  assert.ok(gateSrc.includes('href="/pricing"'))
})

test('R11-B StatsWidget 红钮全量 label+皇冠/悬挂/COMPACT 零残留+陈旧页自愈;pricing 三 CTA 悬挂居中', () => {
  assert.equal(statsSrc.includes('MEMBER_NAV_JOIN_LABEL_COMPACT'), false)
  assert.equal(statsSrc.includes('{MEMBER_NAV_JOIN_LABEL}'), true)
  assert.equal(statsSrc.includes('absolute right-full'), false)
  assert.equal(statsSrc.includes('relative inline-flex'), false)
  assert.ok(statsSrc.includes("memberSession.status !== 'disabled'"))
  assert.equal(pricingSrc.includes('justify-center gap-1.5'), false)
  assert.equal((pricingSrc.match(/gap-1\.5/g) || []).length, 1)
  assert.equal((pricingSrc.match(/right-full/g) || []).length, 3)
})

// --- R12-B:会员面细节(6A/第2条/2A/3A/1B/4C/第6条) ----------------------------------------

test('R12-B 6A:standard/standard-mobile chip 态不渲染(纯函数+渲染分支零残留)', () => {
  assert.equal(memberNav.resolveMemberNavStandardRender('standard', 'chip'), false)
  assert.equal(memberNav.resolveMemberNavStandardRender('standard-mobile', 'chip'), false)
  assert.equal(memberNav.resolveMemberNavStandardRender('standard', 'join'), false)
  // standard/standard-mobile 的 MemberChip 渲染分支整块删除
  assert.equal(navSrc.includes('<MemberChip variant="standard"'), false)
  assert.equal(navSrc.includes('<MemberChip variant="standard-mobile"'), false)
  // tweet/gallery chip 渲染保留
  assert.ok(navSrc.includes('<MemberChip variant="gallery"'))
  assert.ok(navSrc.includes('<MemberChip variant={variant}'))
})

test('R12-B 第2条:tweet chipBaseCls 弹性布局(头像与文字同行居中)', () => {
  const start = navSrc.indexOf('const chipBaseCls')
  const end = navSrc.indexOf('const avatarCls')
  assert.ok(start >= 0 && end > start)
  const chipClsSrc = navSrc.slice(start, end)
  assert.ok(chipClsSrc.includes('flex'))
  assert.ok(chipClsSrc.includes('items-center'))
  assert.ok(chipClsSrc.includes('gap-2'))
})

test('R12-B 2A→R14-B:浮窗 w-72 实底+欢迎行+菜单三项/红退出(Q2=1A 蓝续费零残留)', () => {
  assert.ok(navSrc.includes('w-72'))
  assert.ok(navSrc.includes('p-[18px]'))
  assert.ok(navSrc.includes('bg-[#1b1b1e]')) // 深态实底
  assert.ok(navSrc.includes('dark:bg-[#181818]')) // auto 分支(§11-R12-B-8 字符串形态)
  // 半透明 0 残留(限 MemberNav.tsx;gate/dialog 的 /95 为合法保留)
  assert.equal(navSrc.includes('bg-[#181818]/95'), false)
  assert.equal(navSrc.includes('bg-white/95'), false)
  // 欢迎行:26px 头像档 + 13px 加粗
  assert.ok(navSrc.includes('h-[26px] w-[26px]'))
  assert.ok(navSrc.includes('text-[13px] font-bold'))
  // R14-B(§6-Q2=1A):条件续费按钮(实心蓝)已去掉,零残留
  assert.equal(navSrc.includes('rounded-[9px] bg-[#2563eb]'), false)
  assert.equal(navSrc.includes('hover:bg-[#1d4ed8]'), false)
  assert.equal(navSrc.includes('/api/member/renew-url'), false)
  // 退出=红钮(保留)
  assert.ok(navSrc.includes('rounded-[9px] bg-[#2b2158]') === false) // 深紫面板不属本文件(StatsWidget)
  assert.ok(navSrc.includes('rounded-[9px] bg-[#dc2626]'))
  assert.ok(navSrc.includes('hover:bg-[#b91c1c]'))
  // R14-B 菜单三项(中性行 h-9 rounded-[9px])
  assert.ok(navSrc.includes('h-9 w-full items-center justify-center gap-1.5 rounded-[9px]'))
})

test('R12-B 3A:tweet LoginButton 按钮化(灰阶变量;分支内零硬编码色值)', () => {
  assert.ok(navSrc.includes('rounded-[7px]'))
  assert.ok(navSrc.includes('border-[color:var(--tweet-gray8)]'))
  assert.ok(navSrc.includes('text-[color:var(--tweet-gray12)]'))
  assert.ok(navSrc.includes('hover:bg-[color:var(--tweet-gray12)]'))
  assert.ok(navSrc.includes('hover:text-[color:var(--tweet-gray1)]'))
  // tweet 分支内零硬编码 hex(变量同形按钮)
  const start = navSrc.indexOf('// tweet / tweet-mobile:')
  const end = navSrc.indexOf('type MemberChipConfig')
  assert.ok(start >= 0 && end > start)
  assert.equal(/#[0-9a-fA-F]{3,8}/.test(navSrc.slice(start, end)), false)
})

test('R12-B 1B:StatsWidget 登录态信息面板(欢迎会员/有效期/renew-url/logout)', () => {
  // 欢迎行文案(源内注释锚定;值单点 MEMBER_NAV_WELCOME_PREFIX,见 r2-nav 常量断言)
  assert.ok(statsSrc.includes('欢迎会员'))
  assert.ok(statsSrc.includes('formatMemberWelcomeLabel'))
  assert.ok(statsSrc.includes('formatMemberValidityText'))
  assert.ok(statsSrc.includes('#2b2158')) // 实底深紫面板
  assert.ok(statsSrc.includes('bg-[#dc2626]')) // 退出红钮
  assert.ok(statsSrc.includes('/api/member/renew-url'))
  assert.ok(statsSrc.includes('/api/member/logout'))
  assert.ok(statsSrc.includes('isMemberExpiringSoon'))
})

test('R12-B 4C:解锁区分隔线+压线小标(容器终态/三态边框/承载面底色)', () => {
  assert.ok(gateSrc.includes('会员专属内容')) // 独立常量
  assert.ok(gateSrc.includes('relative my-6 border-t border-b py-5'))
  assert.ok(gateSrc.includes('-top-[9px]'))
  // 三态边框(R12-B-2 的 12% 白边框,/[0.12] 为 JIT 等价拼写;/12 裸写实测不编译)
  assert.ok(gateSrc.includes('border-white/[0.12]'))
  assert.ok(gateSrc.includes('border-black/[0.08]'))
  // 压线小标底色按主题承载面映射(R12-B-1)
  assert.ok(gateSrc.includes('bg-[color:var(--tweet-gray2)]'))
  assert.ok(gateSrc.includes('bg-white dark:bg-black'))
})

test('R12-B 第6条:登录成功整页刷新(location.reload 分文件计数 nav×1/stats×2)', () => {
  assert.ok(navSrc.includes('onSuccess={() => window.location.reload()}'))
  assert.equal((navSrc.match(/window\.location\.reload/g) || []).length, 1)
  assert.equal((statsSrc.match(/window\.location\.reload/g) || []).length, 2)
})
