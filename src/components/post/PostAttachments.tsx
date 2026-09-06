'use client'

import React, { useEffect, useState } from 'react'

type AttachmentItem = {
  key: string
  original_name: string | null
  size: number
  mime: string | null
  created_at: string
  download_url: string
}

type PostAttachmentsProps = {
  postSlug: string
}

function formatSize(bytes: number): string {
  const n = Math.max(0, Number(bytes) || 0)
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GB`
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`
  if (n >= 1024) return `${Math.round(n / 1024)} KB`
  return `${n} B`
}

function extLabel(key: string): string {
  const ext = key.split('.').pop() || ''
  return ext.toUpperCase().slice(0, 6)
}

/**
 * 存储基座 S3：文章页公开附件下载区（四主题共用）。
 *
 * - 数据源：本站公开端点 /api/attachments?slug=（服务端持主站凭据代理，
 *   拼接绝对下载地址；失败/空列表整块渲染 null，普通文章零影响）；
 * - 下载按钮直连主站 /files/{key}（公开代理 + Content-Disposition 原始文件名）；
 * - 与 ArticleProductBuyBar 同判空模式：无数据不占版面；
 *   页面为 ISR 静态，附件列表运行时拉取（上传/删除即时可见）。
 */
export function PostAttachments({ postSlug }: PostAttachmentsProps) {
  const [items, setItems] = useState<AttachmentItem[] | null>(null)

  useEffect(() => {
    let cancelled = false
    const slug = (postSlug || '').trim()
    if (!slug) return
    fetch(`/api/attachments?slug=${encodeURIComponent(slug)}`)
      .then((r) => r.json())
      .then((d: { success?: boolean; items?: AttachmentItem[] }) => {
        if (cancelled) return
        setItems(d && d.success && Array.isArray(d.items) ? d.items : [])
      })
      .catch(() => {
        if (!cancelled) setItems([])
      })
    return () => {
      cancelled = true
    }
  }, [postSlug])

  if (!items || items.length === 0) return null

  return (
    <aside
      data-testid="post-attachments"
      className="my-4 rounded-2xl border border-neutral-200 bg-white px-5 py-4 shadow-sm dark:border-white/10 dark:bg-[#1c1c1e]"
    >
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-bold text-neutral-800 dark:text-neutral-100">
          附件下载
        </h3>
        <span className="text-[11px] font-medium text-neutral-400 dark:text-neutral-500">
          共 {items.length} 个
        </span>
      </div>
      <div className="mt-3 flex flex-col gap-2">
        {items.map((item) => (
          <div
            key={item.key}
            data-testid="post-attachments-item"
            className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl border border-neutral-100 bg-neutral-50/60 px-4 py-3 dark:border-white/5 dark:bg-white/5"
          >
            <div className="flex min-w-0 items-center gap-3">
              <span className="shrink-0 rounded-md bg-neutral-900/85 px-1.5 py-0.5 text-[9px] font-black tracking-wide text-white dark:bg-white dark:text-black">
                {extLabel(item.key)}
              </span>
              <div className="min-w-0">
                <p
                  className="truncate text-sm font-semibold text-neutral-800 dark:text-neutral-100"
                  title={item.original_name || item.key}
                >
                  {item.original_name || item.key.split('/').pop()}
                </p>
                <p className="text-[11px] text-neutral-400 dark:text-neutral-500">
                  {formatSize(item.size)}
                </p>
              </div>
            </div>
            <a
              href={item.download_url}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="post-attachments-download"
              className="shrink-0 rounded-xl bg-neutral-900 px-4 py-2 text-xs font-bold text-white transition-colors duration-200 ease-out hover:bg-neutral-700 dark:bg-white dark:text-black dark:hover:bg-neutral-200"
            >
              下载
            </a>
          </div>
        ))}
      </div>
    </aside>
  )
}

export default PostAttachments
