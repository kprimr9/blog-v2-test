import CONFIG from '@/blog.config'
import { GetStaticProps, GetStaticPropsContext, NextPage } from 'next'
import { BlockRender } from '../components/blocks/BlockRender'
import { Empty } from '../components/Empty'
import { LargeTitle } from '../components/LargeTitle'
import { BlogLayoutPure } from '../components/layout/BlogLayout'
import ContainerLayout from '../components/post/ContainerLayout'
import { Section404 } from '../components/section/Section404'
import withNavFooter from '../components/withNavFooter'
import { formatBlocks } from '../lib/blog/format/block'
import { formatPages } from '../lib/blog/format/page'
import { withNavFooterStaticProps } from '../lib/blog/withNavFooterStaticProps'
import { getAllBlocks } from '../lib/notion/getBlocks'
import { getPages } from '../lib/notion/getBlogData'
import { isTransientNotionError } from '../lib/notion/transientErrors'
import { addSubTitle } from '../lib/util'
import { buildNavPageSeo } from '@/src/lib/seo/lightSeo'
import { PricingPageContent } from '@/src/components/member/PricingPageContent'
import { MemberProfileContent } from '@/src/components/member/MemberProfileContent'
import { TweetArticlePage } from '@/src/themes/tweet/TweetArticlePage'
import { TweetShell } from '@/src/themes/tweet/TweetShell'
import { isTweetTheme } from '@/src/themes/tweet/tweetTheme'
import { pickTweetShellWidgets } from '@/src/themes/tweet/tweetShellWidgets'
import { applyThemePageLayout } from '@/src/themes/themeLayout'
import { loadHomeWidgets } from '../lib/blog/loadHomeWidgets'
import {
  NextPageWithLayout,
  Page,
  SharedNavFooterStaticProps,
} from '../types/blog'
import { BlockResponse } from '../types/notion'
import { onDemandStaticPaths } from '../lib/blog/postLimits'
import type { SiteMembershipConfig } from '../lib/blog/membershipGate'

const systemPageSlugs = new Set([
  ...Object.values(CONFIG.DEFAULT_SPECIAL_PAGES),
  'theme-config',
  'gallery-ad',
  'vending',
  'announcement-popup',
  'popup-ad',
  'click-ad',
  'social-links',
  'banner',
  'members',
])

export const getStaticPaths = async () => {
  try {
    const pages = await getPages()
    const formattedPages = formatPages(pages)

    const paths = formattedPages
      .slice(0, 20)
      .map((page) => ({
        params: { page: page.slug },
      }))
      .filter((page) => !systemPageSlugs.has(page.params?.page as string))

    return {
      paths,
      fallback: 'blocking' as const,
    }
  } catch (error) {
    if (isTransientNotionError(error)) {
      console.warn('[page] getStaticPaths Notion limit, using on-demand paths')
      return onDemandStaticPaths
    }
    throw error
  }
}

export const getStaticProps: GetStaticProps = withNavFooterStaticProps(
  async (
    context: GetStaticPropsContext,
    sharedPageStaticProps: SharedNavFooterStaticProps
  ) => {
    const slug = context.params?.page as string
    // 站点会员 B4-W6:pricing slug 且 membership enabled(双门已在 sharedProps 收敛)
    // → 下发 pricingMembership,无 Notion 页也渲染内置默认版(200 兜底)
    const pricingMembership: SiteMembershipConfig | null =
      slug === 'pricing'
        ? sharedPageStaticProps.props.membershipConfig ?? null
        : null
    // 站点会员 R14-B:profile slug 同口径(我的资料页;关会员 → null → 普通规则 404)
    const profileMembership: SiteMembershipConfig | null =
      slug === 'profile'
        ? sharedPageStaticProps.props.membershipConfig ?? null
        : null
    if (systemPageSlugs.has(slug)) {
      return {
        props: JSON.parse(
          JSON.stringify({
            ...sharedPageStaticProps.props,
            page: null,
            blocks: [],
            pricingMembership,
          })
        ),
        revalidate: CONFIG.NEXT_REVALIDATE_SECONDS,
      }
    }

    addSubTitle(sharedPageStaticProps.props, slug)
    const page =
      sharedPageStaticProps.props.navPages.find((page) => page.slug === slug) ??
      null

    if (!page) {
      // 站点会员 R5-B4:pricing 无 Notion 页兜底也补 widgets(tweet 壳 profile 依赖);
      // R14-B:profile 同口径;R1 门控:仅 pricing/profile 开通时加载
      // (未知 slug/404 不触发 loadHomeWidgets 全链)
      let widgets: Record<string, unknown> = {}
      if (pricingMembership || profileMembership) {
        try {
          widgets = await loadHomeWidgets()
        } catch (widgetError) {
          console.error(`[page/${slug}] widgets error:`, widgetError)
        }
      }
      return {
        props: JSON.parse(
          JSON.stringify({
            ...sharedPageStaticProps.props,
            page: null,
            blocks: [],
            widgets,
            pricingMembership,
            profileMembership,
          })
        ),
        revalidate: CONFIG.NEXT_REVALIDATE_SECONDS,
      }
    }

    // 站点会员 R2-B5a:pricing 已开通时正文块不再透传(PricingPageContent 自渲染
    // 文案分段);跳过 getAllBlocks 省一次 Notion 拉取(Q12,仍需 widgets 供 tweet 壳)
    if (pricingMembership) {
      let widgets: Record<string, unknown> = {}
      try {
        widgets = await loadHomeWidgets()
      } catch (widgetError) {
        console.error(`[page/${slug}] pricing widgets error:`, widgetError)
      }
      return {
        props: JSON.parse(
          JSON.stringify({
            ...sharedPageStaticProps.props,
            page: page,
            blocks: [],
            widgets,
            pricingMembership,
            profileMembership,
          })
        ),
        revalidate: CONFIG.NEXT_REVALIDATE_SECONDS,
      }
    }

    // 站点会员 R14-B:profile 同 pricing(正文零透传,MemberProfileContent 自渲染)
    if (profileMembership) {
      let widgets: Record<string, unknown> = {}
      try {
        widgets = await loadHomeWidgets()
      } catch (widgetError) {
        console.error(`[page/${slug}] profile widgets error:`, widgetError)
      }
      return {
        props: JSON.parse(
          JSON.stringify({
            ...sharedPageStaticProps.props,
            page: page,
            blocks: [],
            widgets,
            pricingMembership,
            profileMembership,
          })
        ),
        revalidate: CONFIG.NEXT_REVALIDATE_SECONDS,
      }
    }

    try {
      const blocks = await getAllBlocks(page?.id ?? '')
      const formattedBlocks = await formatBlocks(blocks)
      const widgets = await loadHomeWidgets()

      return {
        props: JSON.parse(
          JSON.stringify({
            ...sharedPageStaticProps.props,
            page: page,
            blocks: formattedBlocks,
            widgets,
            seo: buildNavPageSeo(page),
            pricingMembership,
          })
        ),
        revalidate: CONFIG.NEXT_REVALIDATE_SECONDS,
      }
    } catch (error) {
      console.error(`[page/${slug}] render error:`, error)
      if (isTransientNotionError(error)) throw error
      // 正文块格式化失败时降级为空内容，避免整页 500（自定义页如 announcement 仍可打开）
      return {
        props: JSON.parse(
          JSON.stringify({
            ...sharedPageStaticProps.props,
            page: page,
            blocks: [],
            seo: buildNavPageSeo(page),
            pricingMembership,
          })
        ),
        revalidate: CONFIG.NEXT_REVALIDATE_SECONDS,
      }
    }
  }
)

const Page: NextPage<{
  page: Page
  blocks: BlockResponse[]
  activeTheme?: string
  siteTitle?: SharedNavFooterStaticProps['props']['siteTitle']
  widgets?: Record<string, unknown>
  pricingMembership?: SiteMembershipConfig | null
  profileMembership?: SiteMembershipConfig | null
}> = ({ page, blocks, activeTheme, siteTitle, widgets, vendingConfig, vendingEnabled, pricingMembership, profileMembership }) => {
  // 站点会员 B4-W6:开通站点 pricing 页独立渲染(R2-B5a:不再透传 Notion blocks,
  // 文案分段由 PricingPageContent 渲染);未开通(pricingMembership=null)不做特殊渲染,
  // 按普通页规则(无页 → 404)
  if (pricingMembership && (!page || page.slug === 'pricing')) {
    if (isTweetTheme(activeTheme)) {
      const shellWidgets = pickTweetShellWidgets(widgets)
      return (
        <TweetShell
          siteTitle={siteTitle}
          profile={shellWidgets.profile}
          vendingConfig={vendingConfig}
          vendingEnabled={vendingEnabled !== false}
        >
          <article className="prose-tweet overflow-hidden break-words">
            <PricingPageContent membership={pricingMembership} />
          </article>
        </TweetShell>
      )
    }
    return (
      <>
        <ContainerLayout>
          <LargeTitle className="mb-4" title="会员说明" />
          <div className="px-8 py-4 break-words bg-white rounded-2xl dark:bg-neutral-900">
            <PricingPageContent membership={pricingMembership} />
          </div>
        </ContainerLayout>
      </>
    )
  }

  // 站点会员 R14-B:我的资料页(照 pricing:双层壳+无 Notion 页兜底;
  // 会员模式关 → profileMembership=null → 不特殊渲染,按普通页规则(无页 → 404))
  if (profileMembership && (!page || page.slug === 'profile')) {
    if (isTweetTheme(activeTheme)) {
      const shellWidgets = pickTweetShellWidgets(widgets)
      return (
        <TweetShell
          siteTitle={siteTitle}
          profile={shellWidgets.profile}
          vendingConfig={vendingConfig}
          vendingEnabled={vendingEnabled !== false}
        >
          <article className="prose-tweet overflow-hidden break-words">
            <MemberProfileContent />
          </article>
        </TweetShell>
      )
    }
    return (
      <>
        <ContainerLayout>
          <LargeTitle className="mb-4" title="我的资料" />
          <div className="px-8 py-4 break-words bg-white rounded-2xl dark:bg-neutral-900">
            <MemberProfileContent />
          </div>
        </ContainerLayout>
      </>
    )
  }

  if (!page) return <Section404 />

  const { title } = page

  if (isTweetTheme(activeTheme)) {
    const shellWidgets = pickTweetShellWidgets(widgets)
    return (
      <TweetShell
        siteTitle={siteTitle}
        profile={shellWidgets.profile}
        vendingConfig={vendingConfig}
        vendingEnabled={vendingEnabled !== false}
      >
        <TweetArticlePage title={page.nav || title} blocks={blocks} />
      </TweetShell>
    )
  }

  return (
    <>
      <ContainerLayout>
        <LargeTitle className="mb-4" title={title} />
        {blocks.length > 0 ? (
          <div className="px-8 py-4 break-words bg-white rounded-2xl dark:bg-neutral-900">
            <BlockRender blocks={blocks} />
          </div>
        ) : (
          <Empty />
        )}
      </ContainerLayout>
    </>
  )
}

;(Page as NextPageWithLayout).getLayout = (page) =>
  applyThemePageLayout(page, (p) => <BlogLayoutPure>{p}</BlogLayoutPure>)

export default withNavFooter(Page)
