import { useCallback, useEffect, useRef, useState } from 'react'

// ============================================================
// 存储基座 S3 · 文章「附件」管理（编辑器 Step 区块）
// ------------------------------------------------------------
// - 上传/列表/删除全部经 /api/admin/attachments（本站服务端代理
//   → 主站存储 API；浏览器不接触 MERCHANT_API_TOKEN）；
// - 附件立即上传（不随「保存」延迟）——按文章 slug（post_key）挂载，
//   新建文章的 slug 在创建时已自动生成，无空窗；
// - 删除=主站软删（幂等）；列表自动刷新；
// - 视觉对齐 BLOG 后台暗色系（无 emoji 灰阶）；
// - S4-3：用量条文案「空间容量」；配额展示随 quotaBytes（缺省显示「—」，
//   不再硬编码 500MB）；frozen=true（账号级冻结，只禁上传）→ bar 灰态 +
//   红字「已冻结」+ 上传禁用并提示「空间已冻结，请联系平台」（后端 403 兜底）。
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
  // S3FIX：创作者存储用量（null=加载中或查询失败，降级显示「—」不阻断）
  // S4-3：quotaBytes 透传（无值时存 null，展示回退「—」）；frozen 透传冻结态
  const [usage, setUsage] = useState(null)
  const fileInputRef = useRef(null)

  const loadUsage = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/storage-usage', { credentials: 'same-origin' })
      const d = await r.json().catch(() => null)
      if (r.ok && d && d.success && typeof d.usedBytes === 'number') {
        setUsage({
          usedBytes: d.usedBytes,
          quotaBytes: typeof d.quotaBytes === 'number' ? d.quotaBytes : null,
          usedPct: Number(d.usedPct) || 0,
          filesCount: Number(d.filesCount) || 0,
          frozen: d.frozen === true,
          // Q-FIX：创作者级合并容量口径（含名下图库+B2 空间；null=未计算，降级 B2 口径展示）
          storagePct: typeof d.storagePct === 'number' ? Number(d.storagePct) : null,
          storageStatus:
            d.storageStatus === 'warning' || d.storageStatus === 'full'
              ? d.storageStatus
              : 'normal',
        })
      } else {
        setUsage(null)
      }
    } catch {
      setUsage(null)
    }
  }, [])

  useEffect(() => {
    loadUsage()
  }, [loadUsage])

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
    // S4-3：冻结前置提示（账号级冻结只禁上传；后端 403 兜底，此处仅前端双保险）
    if (usage && usage.frozen) {
      setError('空间已冻结，请联系平台')
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
    // 乐观预检：已满即提示（后端配额仍强制，此处仅前端双保险；
    // S4-3：配额随 quotaBytes 参数化，无值时不带容量数字）
    if (usage && Number(usage.usedPct) >= 100) {
      const quotaText = usage.quotaBytes ? `（${formatBytes(usage.quotaBytes)}）` : ''
      setError(`存储空间已满${quotaText}，请删除部分文件后再上传`)
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
      loadUsage()
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
      loadUsage()
    } catch (e) {
      setError(e.message || '删除失败')
    } finally {
      setDeletingKey('')
    }
  }

  // S4-3：冻结态派生（usage 为 null=查询失败/加载中时按未冻结，后端 403 兜底）
  const frozen = !!(usage && usage.frozen)
  const uploadDisabled = uploading || !slug || frozen

  // Q-FIX：唯一容量展示 = 创作者级合并容量占比（gallery+B2 vs 存储配额，
  // 来自 blog_quota_state.storage_pct）；未计算时降级 B2 明细（usedPct）。
  const capacityPct =
    usage && usage.storagePct !== null && usage.storagePct !== undefined
      ? Math.min(100, Math.max(0, Number(usage.storagePct) || 0))
      : usage
        ? Math.min(100, Math.max(0, Number(usage.usedPct) || 0))
        : 0
  const capacityIsCreatorLevel = !!(usage && usage.storagePct !== null && usage.storagePct !== undefined)
  const storageStatus = usage ? usage.storageStatus || 'normal' : 'normal'
  const capacityBarColor = frozen
    ? '#4d4d55'
    : storageStatus === 'full'
      ? '#ff6b6b'
      : storageStatus === 'warning'
        ? '#f5a623'
        : '#6f6f78'

  return (
    <div>
      <style dangerouslySetInnerHTML={{ __html: '@keyframes att-mgr-spin { to { transform: rotate(360deg); } }' }} />

      {/* S3FIX/S4-3/Q-FIX：空间容量条 —— 唯一容量展示（创作者级合并口径 =
          名下图库 + B2 空间 vs 存储配额；来自共用库 storage_pct；未计算时降级
          B2 明细 usedBytes/quotaBytes）。灰阶无 emoji；失败显示「—」不阻断上传；
          frozen=true → 灰条 + 红字「已冻结」；容量 >=70% 黄 / >=100% 红（Q-FIX 阈值） */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          padding: '8px 12px',
          borderRadius: '10px',
          border: '1px solid #2c2c33',
          background: '#16161a',
          marginBottom: '8px',
        }}
      >
        <span style={{ fontSize: '11px', color: '#999', whiteSpace: 'nowrap' }}>
          空间容量：已用{' '}
          {capacityIsCreatorLevel
            ? `${Math.round(capacityPct)}%（账号级）`
            : usage
              ? `${formatBytes(usage.usedBytes)} / ${usage && usage.quotaBytes ? formatBytes(usage.quotaBytes) : '—'}`
              : '—'}
        </span>
        <div
          style={{
            flex: 1,
            minWidth: '60px',
            height: '6px',
            borderRadius: '3px',
            background: '#2a2a30',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              width: `${usage ? capacityPct : 0}%`,
              height: '100%',
              background: capacityBarColor,
              borderRadius: '3px',
            }}
          />
        </div>
        <span style={{ fontSize: '11px', color: '#777', whiteSpace: 'nowrap' }}>
          {usage ? `${Math.round(capacityPct)}%` : '—'}
        </span>
        {frozen ? (
          <span style={{ fontSize: '11px', color: '#ff6b6b', whiteSpace: 'nowrap', fontWeight: 'bold' }}>
            已冻结
          </span>
        ) : storageStatus === 'full' ? (
          <span style={{ fontSize: '11px', color: '#ff6b6b', whiteSpace: 'nowrap' }}>
            已满，清理或升级后可恢复
          </span>
        ) : storageStatus === 'warning' ? (
          <span style={{ fontSize: '11px', color: '#f5a623', whiteSpace: 'nowrap' }}>
            即将用尽
          </span>
        ) : null}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
        <button
          type="button"
          onClick={() => fileInputRef.current && fileInputRef.current.click()}
          disabled={uploadDisabled}
          style={{
            height: '34px',
            padding: '0 16px',
            borderRadius: '8px',
            cursor: uploadDisabled ? 'not-allowed' : 'pointer',
            border: '1px solid rgba(173,255,47,0.45)',
            background: uploadDisabled ? '#2a2a2e' : '#303030',
            color: uploadDisabled ? '#777' : 'greenyellow',
            fontSize: '12px',
            fontWeight: 'bold',
            opacity: uploadDisabled ? 0.7 : 1,
          }}
        >
          上传附件
        </button>
        <span style={{ fontSize: '11px', color: frozen ? '#ff6b6b' : '#777', lineHeight: 1.5 }}>
          {frozen
            ? '空间已冻结，请联系平台'
            : uploading
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
                下载附件
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
