import {
  mapWithConcurrency,
  uploadGalleryImageToLsky,
} from '@/src/lib/admin/lskyClientUpload'

const UPLOAD_CONCURRENCY = 4

/** @typedef {{ id: string, status: 'remote', url: string, fileSize?: number|null }} RemoteGalleryItem */
/** @typedef {{ id: string, status: 'pending', file: File, previewUrl: string }} PendingGalleryItem */
/** @typedef {RemoteGalleryItem | PendingGalleryItem} GalleryItem */

export function remoteFromApiImage(img) {
  return {
    id: img.id || `remote-${img.url}`,
    status: 'remote',
    url: img.url,
    fileSize:
      img.file_size != null && img.file_size > 0 ? Number(img.file_size) : null,
    isCover: false,
  }
}

export function createPendingGalleryItem(file) {
  return {
    id: `pending-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    status: 'pending',
    file,
    previewUrl: URL.createObjectURL(file),
    isCover: false,
  }
}

export function sumPendingGalleryBytes(items) {
  return (items || [])
    .filter((it) => it.status === 'pending' && it.file)
    .reduce((sum, it) => sum + (it.file.size || 0), 0)
}

export async function checkGalleryStorageBeforeAdd(pendingBytes) {
  const q = Math.max(0, Number(pendingBytes) || 0)
  const r = await fetch(
    `/api/admin/gallery-storage?pendingBytes=${encodeURIComponent(String(q))}`
  )
  const d = await r.json()
  if (!d.success) {
    throw new Error(d.error || '无法读取图库容量')
  }
  if (!d.canUpload) {
    throw new Error(d.quotaMessage || '图库容量已满，无法继续添加图片')
  }
  return d
}

export function revokePendingGalleryItems(items) {
  ;(items || [])
    .filter((it) => it.status === 'pending' && it.previewUrl)
    .forEach((it) => URL.revokeObjectURL(it.previewUrl))
}

export function countPendingGalleryItems(items) {
  return (items || []).filter((it) => it.status === 'pending').length
}

export function galleryPreviewUrl(item) {
  if (!item) return ''
  return item.status === 'pending' ? item.previewUrl : item.url
}

function imagePayloadFromItem(item, uploaded) {
  if (item.status === 'remote') {
    return {
      url: item.url,
      file_size: item.fileSize ?? null,
    }
  }
  if (!uploaded?.url) {
    throw new Error('图库上传未完成，请重试')
  }
  return {
    url: uploaded.url,
    file_size: uploaded.fileSize ?? null,
  }
}

async function persistGalleryImages({ slug, postTitle, postNotionId, images }) {
  const res = await fetch('/api/admin/gallery', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      postSlug: slug,
      postNotionId: postNotionId || null,
      title: postTitle || null,
      images,
    }),
  })
  const d = await res.json()
  if (!d.success) throw new Error(d.error || '图库保存失败')
  return d
}

/** 仅同步已上图床的图片（手动保存排序；不含 pending） */
export async function persistGalleryRemote({
  slug,
  postTitle,
  postNotionId,
  items,
}) {
  const images = (items || [])
    .filter((it) => it.status === 'remote')
    .map((it) => ({
      url: it.url,
      file_size: it.fileSize ?? null,
    }))
  return persistGalleryImages({ slug, postTitle, postNotionId, images })
}

/**
 * 发布/保存成功后：按当前顺序上传 pending，写入 Supabase，返回全 remote 列表
 */
export async function flushGalleryUploads({
  slug,
  postTitle,
  postNotionId,
  items,
  onProgress,
}) {
  const list = items || []
  const pendingEntries = list
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.status === 'pending')

  const pendingBytes = sumPendingGalleryBytes(list)
  if (pendingBytes > 0) {
    await checkGalleryStorageBeforeAdd(pendingBytes)
  }

  const uploadResults = new Map()

  if (pendingEntries.length > 0) {
    let done = 0
    await mapWithConcurrency(
      pendingEntries,
      UPLOAD_CONCURRENCY,
      async ({ item, index }) => {
        const result = await uploadGalleryImageToLsky(item.file)
        uploadResults.set(index, result)
        done += 1
        onProgress?.({ done, total: pendingEntries.length })
      }
    )
  }

  const images = list.map((item, index) =>
    imagePayloadFromItem(
      item,
      item.status === 'pending' ? uploadResults.get(index) : null
    )
  )

  await persistGalleryImages({ slug, postTitle, postNotionId, images })
  revokePendingGalleryItems(list)

  // BLOG-UI-FIX 封面修复：保留输入项的 isCover 手动封面标记。
  // 此前恒经 remoteFromApiImage 置 false：pending 图库上传后标记丢失 →
  // 发布时图库封面解析为空 → 服务端兜底误用正文首图，重开编辑重设才生效。
  return images.map((img, index) => {
    const item = remoteFromApiImage(img)
    item.isCover = !!(list[index] && list[index].isCover)
    return item
  })
}
