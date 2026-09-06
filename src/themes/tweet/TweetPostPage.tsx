import Link from 'next/link'
import { GalleryAdBanner as GalleryAdBannerData } from '@/src/lib/gallery/loadGalleryAdBanner'
import { PartialPost, Post } from '@/src/types/blog'
import { BlockResponse } from '@/src/types/notion'
import { formatTweetDate } from './tweetSearch'
import { ArticleProductBuyBar } from '@/src/themes/shop/ArticleProductBuyBar'
import { PostAttachments } from '@/src/components/post/PostAttachments'
import { TweetAdBanner } from './TweetAdBanner'
import { TweetPostContent } from './TweetPostContent'
import { TweetPostFooter } from './TweetPostFooter'

type TweetPostPageProps = {
  post: Post
  blocks: BlockResponse[]
  navigation?: {
    previousPost?: PartialPost | null
    nextPost?: PartialPost | null
  }
  galleryAdBanner?: GalleryAdBannerData | null
}

export function TweetPostPage({
  post,
  blocks,
  navigation,
  galleryAdBanner = null,
}: TweetPostPageProps) {
  const dateLabel = formatTweetDate(post.date?.created)
  const previousPost = navigation?.previousPost ?? null
  const nextPost = navigation?.nextPost ?? null

  return (
    <article className="tweet-post-page">
      <Link href="/" className="tweet-article-back">
        ← 返回首页
      </Link>
      <h1 className="tweet-article-title">{post.title}</h1>
      {dateLabel ? <p className="tweet-article-meta">{dateLabel}</p> : null}
      {post.excerpt?.trim() ? (
        <p className="tweet-article-excerpt">{post.excerpt}</p>
      ) : null}
      <ArticleProductBuyBar post={post} variant="tweet" />
      <TweetPostContent postSlug={post.slug} blocks={blocks} />
      {/* 存储基座 S3：文章附件下载区（空数据渲染 null） */}
      <PostAttachments postSlug={post.slug} />
      {galleryAdBanner ? <TweetAdBanner banner={galleryAdBanner} /> : null}
      <TweetPostFooter previousPost={previousPost} nextPost={nextPost} />
    </article>
  )
}
