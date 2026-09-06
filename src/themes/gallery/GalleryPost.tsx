import { Page, Post } from '@/src/types/blog'
import { BlockResponse } from '@/src/types/notion'
import CONFIG from '@/blog.config'
import { getSubTitleInfo } from '@/src/lib/util'
import { GalleryAdBanner as GalleryAdBannerData } from '@/src/lib/gallery/loadGalleryAdBanner'
import { GalleryRecommendPost } from '@/src/lib/gallery/galleryRecommendations'
import { PostStatsSnapshot } from '@/src/lib/gallery/postStats'
import { GalleryAdBanner } from './GalleryAdBanner'
import { GalleryBreadcrumb } from './GalleryBreadcrumb'
import { GalleryPopularSidebar } from './GalleryPopularSidebar'
import { GalleryPostDownloadButton } from './GalleryPostDownloadButton'
import { GalleryPostContent } from './GalleryPostContent'
import { GalleryPostRecommendations } from './GalleryPostRecommendations'
import { GalleryPostStats } from './GalleryPostStats'
import { GalleryPostTitleLine } from './GalleryPostTitleDownloadMeta'
import { ArticleProductBuyBar } from '@/src/themes/shop/ArticleProductBuyBar'
import { PostAttachments } from '@/src/components/post/PostAttachments'
import { galleryContentContainerClass, galleryPostTitleClass } from './galleryFonts'

type GalleryPostProps = {
  post: Post
  blocks: BlockResponse[]
  sidebarRecommendations: GalleryRecommendPost[]
  bottomRecommendations: GalleryRecommendPost[]
  postStats?: PostStatsSnapshot | null
  galleryAdBanner?: GalleryAdBannerData | null
  navPages?: Page[]
}

const { CATEGORY } = CONFIG.DEFAULT_SPECIAL_PAGES

export const GalleryPost = ({
  post,
  blocks,
  sidebarRecommendations,
  bottomRecommendations,
  postStats = null,
  galleryAdBanner = null,
  navPages = [],
}: GalleryPostProps) => {
  const categorySubTitle = getSubTitleInfo(CATEGORY, {
    navPages,
    siteSubtitle: null,
  })
  const categoryParentLabel = categorySubTitle?.text || '分类'
  const categoryParentHref = categorySubTitle?.slug
    ? `/${categorySubTitle.slug}`
    : `/${CATEGORY}`

  return (
    <>
      <GalleryBreadcrumb
        items={[
          { label: '首页', href: '/' },
          { label: categoryParentLabel, href: categoryParentHref },
          {
            label: post.category?.name || '未分类',
            href: `/${CATEGORY}/${post.category?.id || ''}`,
          },
          { label: post.title },
        ]}
      />
      <main className="flex flex-1 flex-col bg-white px-4 py-6 pb-8 sm:px-6 lg:px-10">
        <div className="mx-auto flex w-full max-w-[1320px] flex-col gap-0 lg:flex-row lg:items-start lg:gap-6 xl:gap-8">
          <article className={`${galleryContentContainerClass} min-w-0 flex-1`}>
            <div className="mb-3 flex items-start justify-between gap-3 sm:gap-6">
              <GalleryPostTitleLine
                post={post}
                titleClass={galleryPostTitleClass}
                className="flex-1"
              />
              <div className="shrink-0 pt-0.5">
                <GalleryPostDownloadButton postSlug={post.slug} />
              </div>
            </div>

            <GalleryPostStats
              postSlug={post.slug}
              publishedDate={post.date?.updated || post.date?.created}
              initialStats={postStats}
              track="view"
            />

            {post.excerpt ? (
              <p className="mb-4 font-gallery text-sm font-normal leading-relaxed tracking-wide text-neutral-500">
                {post.excerpt}
              </p>
            ) : null}

            <ArticleProductBuyBar post={post} variant="gallery" />

            <GalleryPostContent postSlug={post.slug} blocks={blocks} />

            {/* 存储基座 S3：文章附件下载区（空数据渲染 null） */}
            <PostAttachments postSlug={post.slug} />

            <GalleryPostRecommendations posts={bottomRecommendations} />

            {galleryAdBanner ? <GalleryAdBanner banner={galleryAdBanner} /> : null}
          </article>

          <GalleryPopularSidebar
            posts={sidebarRecommendations}
            excludeSlug={post.slug}
            className="hidden lg:block lg:sticky lg:top-6 lg:self-start"
          />
        </div>
      </main>
    </>
  )
}
