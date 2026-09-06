import CONFIG from '@/blog.config'
import ContentLayout from '@/src/components/layout/ContentLayout'
import PostFooter from '@/src/components/post/PostFooter'
import PostMessage from '@/src/components/post/PostMessage'
import PostNavigation from '@/src/components/post/PostNavigation'
import { PostAttachments } from '@/src/components/post/PostAttachments'
import CommentSection from '@/src/components/section/CommentSection'
import type { GalleryAdBanner } from '@/src/lib/gallery/loadGalleryAdBanner'
import { StandardAdBanner } from '@/src/themes/standard/StandardAdBanner'
import { StandardGalleryPreviewProvider } from '@/src/themes/standard/StandardGalleryPreviewContext'
import { StandardPostContent } from '@/src/themes/standard/StandardPostContent'
import { StandardPostHeader } from '@/src/themes/standard/StandardPostHeader'
import { PartialPost, Post } from '@/src/types/blog'
import { BlockResponse } from '@/src/types/notion'
import { ShopProductBar } from './ShopProductBar'

type ShopPostPageProps = {
  post: Post
  blocks: BlockResponse[]
  navigation: { previousPost: PartialPost; nextPost: PartialPost }
  galleryAdBanner?: GalleryAdBanner | null
}

/**
 * shop 主题文章详情：复用 standard 的头部/正文/广告/导航骨架，
 * 壳层仍走默认 BlogLayout（Navbar + Footer），统计与贩售机机制不变；
 * 文章头部下方展示关联商品条（linked_product_sku，C2 在此扩展购买按钮）。
 */
export function ShopPostPage({
  post,
  blocks,
  navigation,
  galleryAdBanner = null,
}: ShopPostPageProps) {
  return (
    <StandardGalleryPreviewProvider postSlug={post.slug}>
      <StandardPostHeader post={post} blocks={blocks} />
      <ContentLayout>
        <ShopProductBar post={post} />
        <PostMessage post={post} />
        <StandardPostContent postSlug={post.slug} blocks={blocks} />
        {/* 存储基座 S3：文章附件下载区（空数据渲染 null） */}
        <PostAttachments postSlug={post.slug} />
        {galleryAdBanner ? <StandardAdBanner banner={galleryAdBanner} /> : null}
        <PostFooter post={post} />
        <PostNavigation navigation={navigation} />
        {CONFIG.ENABLE_COMMENT && <CommentSection />}
      </ContentLayout>
    </StandardGalleryPreviewProvider>
  )
}
