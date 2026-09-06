import { useCallback, useEffect, useRef, useState } from 'react'

// ============================================================
// 存储基座 S3 · 文章「附件」管理（编辑器 Step 区块）
// ------------------------------------------------------------
// - 上传/列表/删除全部经 /api/admin/attachments（本站服务端代理
//   → 主站存储 API；浏览器不接触 MERCHANT_API_TOKEN）；
// - 附件立即上传（不随「保存」延迟）——按文章 slug（post_key）挂载，
//   新建文章的 slug 在创建时已自动生成，无空窗；
// - 删除=主站软删（幂等）；列表自动刷新；
// - 视觉对齐 BLOG 后台暗色系（无 emoji 灰阶）。
// ============================================================

const ATTACHMENT_EXT_RE = /\.(pdf|zip|rar|7z|doc|docx|xls|xlsx|txt)$/i
const MAX_UPLOAD_MB = 50

function formatBytes(bytes) {
  const n = Math.max(0, Number(bytes) || 0)
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GB`
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`
  if (n >= 1024) return `${Math.round(n / 1024)} KB`
  return `${n} B`
}

function formatTime(iso) {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
  } catch {
    return ''
  }
}

export function AttachmentManager({ postSlug }) {
  const slug = (postSlug || '').trim()

  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState({ done: 0, total: 0 })
  const [deletingKey, setDeletingKey] = useState('')
  const [error, setError] = useState('')
  const fileInputRef = useRef(null)

  const loadList = useCallback(async () => {
    if (!slug) {
      setItems([])
      return
    }
    setLoading(true)
    setError('')
    try {
      const r = await fetch(`/api/admin/attachments?slug=${encodeURIComponent(slug)}`)
      const d = await r.json()
      if (!r.ok || !d.success) throw new Error(d.error || '附件列表加载失败')
      setItems(d.items || [])
    } catch (e) {
      setError(e.message || '附件列表加载失败')
    } finally {
      setLoading(false)
    }
  }, [slug])

  useEffect(() => {
    loadList()
  }, [loadList])

  const handleUpload = async (event) => {
    const files = Array.from(event.target.files || [])
    event.target.value = ''
    if (files.length === 0) return
    if (!slug) {
      setError('文章尚未初始化，请先填写标题后再上传附件')
      return
    }

    const invalid = files.find((f) => !ATTACHMENT_EXT_RE.test(f.name || ''))
    if (invalid) {
      setError(`不支持的附件格式：${invalid.name}（仅 pdf / zip / rar / 7z / doc / docx / xls / xlsx / txt）`)
      return
    }
    const tooLarge = files.find((f) => f.size > MAX_UPLOAD_MB * 1024 * 1024)
    if (tooLarge) {
      setError(`附件过大：${tooLarge.name}（单文件上限 ${MAX_UPLOAD_MB}MB）`)
      return
    }

    setUploading(true)
    setError('')
    setUploadProgress({ done: 0, total: files.length })
    try {
      for (let i = 0; i < files.length; i += 1) {
        const file = files[i]
        const r = await fetch(
          `/api/admin/attachments?slug=${encodeURIComponent(slug)}`,
          {
            method: 'POST',
            headers: {
              'content-type': file.type || 'application/octet-stream',
              'x-file-name': encodeURIComponent(file.name || 'attachment'),
            },
            body: file,
            credentials: 'same-origin',
          }
        )
        const d = await r.json().catch(() => ({}))
        if (!r.ok || !d.success) {
          throw new Error(d.error || `上传失败：${file.name}`)
        }
        setUploadProgress({ done: i + 1, total: files.length })
      }
      await loadList()
    } catch (e) {
      setError(e.message || '附件上传失败')
      await loadList()
    } finally {
      setUploading(false)
    }
  }

  const handleDelete = async (item) => {
    if (!window.confirm(`确认删除附件「${item.original_name || item.key}」？删除后文章页将不再显示。`)) {
      return
    }
    setDeletingKey(item.key)
    setError('')
    try {
      const r = await fetch('/api/admin/attachments', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: item.key }),
        credentials: 'same-origin',
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok || !d.success) throw new Error(d.error || '删除失败')
      setItems((prev) => prev.filter((it) => it.key !== item.key))
    } catch (e) {
      setError(e.message || '删除失败')
    } finally {
      setDeletingKey('')
    }
  }

  return (
    <div>
      <style dangerouslySetInnerHTML={{ __html: '@keyframes att-mgr-spin { to { transform: rotate(360deg); } }' }} />

      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
        <button
          type="button"
          onClick={() => fileInputRef.current && fileInputRef.current.click()}
          disabled={uploading || !slug}
          style={{
            height: '34px',
            padding: '0 16px',
            borderRadius: '8px',
            cursor: uploading || !slug ? 'not-allowed' : 'pointer',
            border: '1px solid rgba(173,255,47,0.45)',
            background: uploading || !slug ? '#2a2a2e' : '#303030',
            color: uploading || !slug ? '#777' : 'greenyellow',
            fontSize: '12px',
            fontWeight: 'bold',
            opacity: uploading || !slug ? 0.7 : 1,
          }}
        >
          上传附件
        </button>
        <span style={{ fontSize: '11px', color: '#777', lineHeight: 1.5 }}>
          {uploading
            ? `正在上传 ${uploadProgress.done}/${uploadProgress.total}…`
            : '支持 pdf / zip / rar / 7z / doc / docx / xls / xlsx / txt，单文件 ≤ 50MB'}
        </span>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".pdf,.zip,.rar,.7z,.doc,.docx,.xls,.xlsx,.txt"
          style={{ display: 'none' }}
          onChange={handleUpload}
        />
      </div>

      {uploading ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '10px 12px',
            borderRadius: '10px',
            border: '1px solid #3a3a42',
            background: '#1b1b20',
            fontSize: '12px',
            color: '#bbb',
            marginBottom: '8px',
          }}
        >
          <span
            style={{
              width: '14px',
              height: '14px',
              border: '2px solid rgba(173,255,47,0.25)',
              borderTopColor: 'greenyellow',
              borderRadius: '50%',
              display: 'inline-block',
              animation: 'att-mgr-spin 0.8s linear infinite',
            }}
          />
          正在上传附件（{uploadProgress.done}/{uploadProgress.total}），请勿关闭页面
        </div>
      ) : null}

      {error ? (
        <p style={{ fontSize: '11px', color: '#ff6b6b', margin: '0 0 8px', lineHeight: 1.5, wordBreak: 'break-all' }}>
          {error}
        </p>
      ) : null}

      {loading ? (
        <p style={{ fontSize: '11px', color: '#777', margin: '0 0 8px' }}>附件列表加载中…</p>
      ) : items.length === 0 ? (
        <p style={{ fontSize: '11px', color: '#666', margin: '0 0 8px', lineHeight: 1.5 }}>
          暂无附件。上传后将在此文章页展示下载按钮，读者可直接下载。
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {items.map((item) => (
            <div
              key={item.key}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '8px 12px',
                borderRadius: '10px',
                border: '1px solid #333',
                background: '#18181c',
              }}
            >
              <div style={{ minWidth: 0, flex: 1 }}>
                <p
                  style={{
                    fontSize: '12px',
                    color: '#e5e5e5',
                    margin: 0,
                    lineHeight: 1.5,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                  title={item.original_name || item.key}
                >
                  {item.original_name || item.key}
                </p>
                <p style={{ fontSize: '10px', color: '#777', margin: '2px 0 0', lineHeight: 1.4 }}>
                  {formatBytes(item.size)}
                  {item.created_at ? ` · ${formatTime(item.created_at)}` : ''}
                </p>
              </div>
              <a
                href={item.download_url}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  flexShrink: 0,
                  height: '28px',
                  lineHeight: '28px',
                  padding: '0 12px',
                  borderRadius: '7px',
                  border: '1px solid #444',
                  color: '#ccc',
                  fontSize: '11px',
                  textDecoration: 'none',
                }}
              >
                下载
              </a>
              <button
                type="button"
                onClick={() => handleDelete(item)}
                disabled={deletingKey === item.key}
                style={{
                  flexShrink: 0,
                  height: '28px',
                  padding: '0 12px',
                  borderRadius: '7px',
                  cursor: deletingKey === item.key ? 'wait' : 'pointer',
                  border: '1px solid rgba(239,68,68,0.6)',
                  background: deletingKey === item.key ? '#2a1a1a' : 'rgba(239,68,68,0.12)',
                  color: '#f87171',
                  fontSize: '11px',
                }}
              >
                {deletingKey === item.key ? '删除中…' : '删除'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default AttachmentManager
