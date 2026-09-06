import CONFIG from '@/blog.config'
import { GetStaticProps, GetStaticPropsContext, NextPage } from 'next'
import { BlogLayoutPure } from '../../components/layout/BlogLayout'
import ContentLayout from '../../components/layout/ContentLayout'
import PostFooter from '../../components/post/PostFooter'
import { StandardPostContent } from '@/src/themes/standard/StandardPostContent'
import { StandardPostHeader } from '@/src/themes/standard/StandardPostHeader'
import { StandardAdBanner } from '@/src/themes/standard/StandardAdBanner'
import { StandardGalleryPreviewProvider } from '@/src/themes/standard/StandardGalleryPreviewContext'
import { ArticlePasswordGate } from '../../components/post/ArticlePasswordGate'
import PostMessage from '../../components/post/PostMessage'
import PostNavigation from '../../components/post/PostNavigation'
import { PostAttachments } from '../../components/post/PostAttachments'
import CommentSection from '../../components/section/CommentSection'
import { Section404 } from '../../components/section/Section404'
import withNavFooter from '../../components/withNavFooter'
import { GalleryPost } from '@/src/themes/gallery/GalleryPost'
import { ArticleProductBuyBar } from '@/src/themes/shop/ArticleProductBuyBar'
import { ShopPostPage } from '@/src/themes/shop/ShopPostPage'
import { isShopTheme } from '@/src/themes/shop/shopTheme'
import { TweetPostPage } from '@/src/themes/tweet/TweetPostPage'
import { TweetShell } from '@/src/themes/tweet/TweetShell'
import { isTweetTheme } from '@/src/themes/tweet/tweetTheme'
import { pickTweetShellWidgets } from '@/src/themes/tweet/tweetShellWidgets'
import { applyThemePageLayout } from '@/src/themes/themeLayout'
import {
  buildGalleryRecommendations,
  findGalleryAnnouncementPost,
  GalleryRecommendPost,
  withoutGalleryAnnouncement,
} from '@/src/lib/gallery/galleryRecommendations'
import {
  getAllPostStatsMap,
  getPostStats,
} from '@/src/lib/gallery/postStats'
import {
  GalleryAdBanner,
  clearGalleryAdBannerCache,
  loadGalleryAdBanner,
} from '@/src/lib/gallery/loadGalleryAdBanner'
import { loadHomeWidgets } from '../../lib/blog/loadHomeWidgets'
import { resolveActiveTheme } from '@/src/themes/getActiveTheme'
import { formatBlocks } from '../../lib/blog/format/block'
import { formatPosts, FORMAT_POST_LIST_OPTIONS, getNavigationInfo } from '../../lib/blog/format/post'
import { getArchiveNavPosts } from '../../lib/blog/archiveNavCache'
import {
  withNavFooterStaticProps,
} from '../../lib/blog/withNavFooterStaticProps'
import type { SharedNavFooterNotionData } from '../../lib/blog/withNavFooterStaticProps'
import { getAllBlocks } from '../../lib/notion/getBlocks'
import {
  BLOG_STATIC_POST_PATHS_MAX,
  buildStaticPostPaths,
  onDemandStaticPaths,
} from '../../lib/blog/postLimits'
import { getPostBySlug, getPosts } from '../../lib/notion/getBlogData'
import { isTransientNotionError } from '../../lib/notion/transientErrors'
import { addSubTitle } from '../../lib/util'
import { buildPostPageSeo } from '@/src/lib/seo/lightSeo'
import { NextPageWithLayout, Page, PartialPost, Post, SharedNavFooterStaticProps } from '../../types/blog'
import { ApiScope, BlockResponse } from '../../types/notion'

export const getStaticPaths = async () => {
  if (!BLOG_STATIC_POST_PATHS_MAX || BLOG_STATIC_POST_PATHS_MAX <= 0) {
    return onDemandStaticPaths
  }
  try {
    const postsRaw = await getPosts(ApiScope.Archive)
    const formattedPosts = await formatPosts(postsRaw, FORMAT_POST_LIST_OPTIONS)
    const paths = buildStaticPostPaths(formattedPosts).map((post) => ({
      params: { post: post.slug },
    }))
    return { paths, fallback: 'blocking' as const }
  } catch (error) {
    if (isTransientNotionError(error)) {
      console.warn('[post] getStaticPaths Notion limit, using on-demand paths')
      return onDemandStaticPaths
    }
    throw error
  }
}

export const getStaticProps: GetStaticProps = withNavFooterStaticProps(
  async (
    context: GetStaticPropsContext,
    sharedPageStaticProps: SharedNavFooterStaticProps,
    sharedNotionData: SharedNavFooterNotionData
  ): Promise<any> => {
    const slug = context.params?.post as string

    if (!slug || slug.includes('[') || slug === 'undefined') {
      return { 
        props: JSON.parse(JSON.stringify({ ...sharedPageStaticProps.props, post: null, blocks: [] }))
      }
    }

    try {
      let navPosts: Post[] = []
      try {
        navPosts = await getArchiveNavPosts()
      } catch (navError) {
        console.warn('Post page: archive nav load failed, continuing without nav', navError)
      }

      let postForPage = navPosts.find((post) => post.slug === slug)
      if (!postForPage) {
        const rawPost = await getPostBySlug(slug, ApiScope.Archive)
        if (!rawPost) return { notFound: true }
        postForPage = (
          await formatPosts([rawPost], FORMAT_POST_LIST_OPTIONS)
        )[0]
      }

      const activeTheme =
        sharedPageStaticProps.props.activeTheme ?? (await resolveActiveTheme())

      addSubTitle(
        sharedPageStaticProps.props,
        '',
        { text: postForPage.title, color: 'gray', slug: postForPage.slug },
        false
      )

      const { previousPost, nextPost } = getNavigationInfo(navPosts, postForPage)

      const postStats = await getPostStats(slug)
      let sidebarRecommendations: GalleryRecommendPost[] = []
      let bottomRecommendations: GalleryRecommendPost[] = []
      if (activeTheme === 'gallery') {
        try {
          const statsMap = await getAllPostStatsMap()
          const recommendations = buildGalleryRecommendations(
            postForPage,
            navPosts,
            undefined,
            statsMap
          )
          sidebarRecommendations = withoutGalleryAnnouncement(recommendations)
          bottomRecommendations = withoutGalleryAnnouncement(recommendations)
        } catch (recError) {
          console.warn('Post page: gallery recommendations failed', recError)
        }
      }

      const blocks = await getAllBlocks(postForPage.id)
      const formattedBlocks = await formatBlocks(blocks)

      // 内页广告：全主题文章页均加载（关闭状态由 loadGalleryAdBanner 按 Notion status 过滤）
      clearGalleryAdBannerCache()
      const galleryAdBanner = await loadGalleryAdBanner(
        sharedNotionData.widgetPages
      )

      const widgets =
        isTweetTheme(activeTheme)
          ? await loadHomeWidgets({
              announcement: findGalleryAnnouncementPost(navPosts) ?? null,
              widgetPages: sharedNotionData.widgetPages,
            })
          : null

      // 🛡️ JSON 暴力清洗：杜绝 undefined 导致的 500 报错
      const safeData = JSON.parse(JSON.stringify({
        ...sharedPageStaticProps.props,
        post: postForPage,
        blocks: formattedBlocks,
        navigation: {
            previousPost: previousPost || null,
            nextPost: nextPost || null,
        },
        sidebarRecommendations,
        bottomRecommendations,
        postStats,
        galleryAdBanner,
        widgets,
        seo: buildPostPageSeo(postForPage),
      }))

      if (safeData.widgets?.profile && safeData.widgets.profile.links === undefined) {
        safeData.widgets.profile.links = null
      }

      return {
        props: safeData,
        revalidate: CONFIG.NEXT_REVALIDATE_SECONDS,
      }
    } catch (error) {
      console.error('Post page render error:', error)
      if (isTransientNotionError(error)) throw error
      // 非网络类错误降级，避免单篇数据异常导致全站文章页 500
      return {
        props: JSON.parse(
          JSON.stringify({
            ...sharedPageStaticProps.props,
            post: null,
            blocks: [],
            navigation: { previousPost: null, nextPost: null },
            sidebarRecommendations: [],
            bottomRecommendations: [],
            postStats: null,
            galleryAdBanner: null,
          })
        ),
        revalidate: CONFIG.NEXT_REVALIDATE_SECONDS,
      }
    }
  }
)

const PostPage: NextPage<{
  post: Post
  blocks: BlockResponse[]
  navigation: { previousPost: PartialPost; nextPost: PartialPost }
  sidebarRecommendations?: GalleryRecommendPost[]
  bottomRecommendations?: GalleryRecommendPost[]
  postStats?: { viewCount: number; downloadCount: number } | null
  galleryAdBanner?: GalleryAdBanner | null
  activeTheme?: string
  navPages?: Page[]
  siteTitle?: SharedNavFooterStaticProps['props']['siteTitle']
  widgets?: Record<string, unknown>
  vendingConfig?: SharedNavFooterStaticProps['props']['vendingConfig']
}> = ({
  post,
  blocks,
  navigation,
  sidebarRecommendations = [],
  bottomRecommendations = [],
  postStats = null,
  galleryAdBanner = null,
  activeTheme,
  navPages = [],
  siteTitle,
  widgets,
  vendingConfig,
  vendingEnabled,
}) => {
  if (!post) return <Section404 />

  return (
    <ArticlePasswordGate post={post} initialBlocks={blocks}>
      {(resolvedBlocks) => {
        if (activeTheme === 'gallery') {
          return (
            <GalleryPost
              post={post}
              blocks={resolvedBlocks}
              sidebarRecommendations={sidebarRecommendations}
              bottomRecommendations={bottomRecommendations}
              postStats={postStats}
              galleryAdBanner={galleryAdBanner}
              navPages={navPages}
            />
          )
        }

        // P18-C4-7:shop 系(shop / shop-v2)内页一律复用 ShopPostPage
        if (isShopTheme(activeTheme)) {
          return (
            <ShopPostPage
              post={post}
              blocks={resolvedBlocks}
              navigation={navigation}
              galleryAdBanner={galleryAdBanner}
            />
          )
        }

        if (isTweetTheme(activeTheme)) {
          const shellWidgets = pickTweetShellWidgets(widgets)
          return (
            <TweetShell
              siteTitle={siteTitle}
              profile={shellWidgets.profile}
              vendingConfig={vendingConfig}
              vendingEnabled={vendingEnabled !== false}
            >
              <TweetPostPage
                post={post}
                blocks={resolvedBlocks}
                navigation={navigation}
                galleryAdBanner={galleryAdBanner}
              />
            </TweetShell>
          )
        }

        return (
          <StandardGalleryPreviewProvider postSlug={post.slug}>
            <StandardPostHeader post={post} blocks={resolvedBlocks} />
            <ContentLayout>
              <ArticleProductBuyBar post={post} variant="standard" />
              <PostMessage post={post} />
              <StandardPostContent
                postSlug={post.slug}
                blocks={resolvedBlocks}
              />
              {/* 存储基座 S3：文章附件下载区（空数据渲染 null，普通文章零影响） */}
              <PostAttachments postSlug={post.slug} />
              {galleryAdBanner ? <StandardAdBanner banner={galleryAdBanner} /> : null}
              <PostFooter post={post} />
              <PostNavigation navigation={navigation} />
              {CONFIG.ENABLE_COMMENT && <CommentSection />}
            </ContentLayout>
          </StandardGalleryPreviewProvider>
        )
      }}
    </ArticlePasswordGate>
  )
}

const withNavPage = withNavFooter(PostPage)
;(withNavPage as NextPageWithLayout).getLayout = (page) =>
  applyThemePageLayout(page, (p) => <BlogLayoutPure>{p}</BlogLayoutPure>)
export default withNavPage
