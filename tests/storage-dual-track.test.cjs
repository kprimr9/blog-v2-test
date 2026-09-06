const assert = require('node:assert/strict')
const path = require('node:path')
const Module = require('node:module')
const { Readable } = require('node:stream')
const { after, beforeEach, test } = require('node:test')
const babel = require('@babel/core')

// ============================================================
// 存储基座 S3 双轨 + 附件 mock 测试
//  - /api/admin/upload：storage_base 转主站 / legacy+video 走兰空 / 查询失败兜底兰空
//  - /api/admin/attachments：列表（拼绝对下载地址）/ 删除转发 / 鉴权
//  - /api/attachments：公开列表 / 非法 slug 400 / 失败静默空列表
// ============================================================

const repoRoot = path.resolve(__dirname, '..')
const srcRoot = `${path.join(repoRoot, 'src')}${path.sep}`
const originalResolveFilename = Module._resolveFilename
const originalJsLoader = require.extensions['.js']
const originalTsLoader = require.extensions['.ts']
const originalFetch = global.fetch
const envKeys = [
  'AUTH_USER',
  'AUTH_PASS',
  'LSKY_TOKEN',
  'LSKY_URL',
  'BLOG_SITE_ID',
  'MERCHANT_API_BASE',
  'MERCHANT_API_TOKEN',
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
]
const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]))

process.env.AUTH_USER = 's3-test-admin'
process.env.AUTH_PASS = 's3-test-password'
process.env.LSKY_TOKEN = 's3-test-lsky-token'
process.env.LSKY_URL = 'https://images.example'
// storage_base 场景环境（部分用例内再细化）
process.env.BLOG_SITE_ID = '11111111-1111-4111-8111-111111111111'
process.env.MERCHANT_API_BASE = 'https://main.example'
process.env.MERCHANT_API_TOKEN = 's3-test-main-token'
delete process.env.NEXT_PUBLIC_SUPABASE_URL
delete process.env.SUPABASE_SERVICE_ROLE_KEY

Module._resolveFilename = function resolveFilename(request, parent, isMain, options) {
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

const uploadHandler = require('../src/pages/api/admin/upload.js').default
const attachmentsAdminHandler = require('../src/pages/api/admin/attachments.ts').default
const publicAttachmentsHandler = require('../src/pages/api/attachments.ts').default
const { __resetImageBackendCacheForTest } = require('../src/lib/storage/mainStorage')

Module._resolveFilename = originalResolveFilename
require.extensions['.js'] = originalJsLoader
if (originalTsLoader) require.extensions['.ts'] = originalTsLoader
else delete require.extensions['.ts']

let fetchCalls = []
let imageBackendResponse = { backend: 'storage_base' }
let mainUploadResponse = {
  success: true,
  key: 'blog/11111111-1111-4111-8111-111111111111/images/202609/uuid.png',
  url: '/photo/blog/11111111-1111-4111-8111-111111111111/images/202609/uuid.png',
}
let mainAttachmentsResponse = {
  success: true,
  items: [
    {
      key: 'blog/11111111-1111-4111-8111-111111111111/attachments/202609/a.pdf',
      original_name: '文档.pdf',
      size: 1024,
      mime: 'application/pdf',
      created_at: '2026-09-05T10:00:00Z',
    },
  ],
}

function authValue() {
  return Buffer.from(`${process.env.AUTH_USER}:${process.env.AUTH_PASS}`).toString('base64')
}

function createRequest({ authorization, cookie, contentType = 'image/png', fileName = 'test.png', body } = {}) {
  const req = Readable.from([Buffer.isBuffer(body) ? body : Buffer.from(body || 'fake-image-bytes')])
  req.method = 'POST'
  req.headers = {
    'content-type': contentType,
    'x-file-name': encodeURIComponent(fileName),
  }
  if (authorization) req.headers.authorization = authorization
  req.cookies = cookie ? { internal_auth: cookie } : {}
  return req
}

function createResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value
    },
    status(code) {
      this.statusCode = code
      return this
    },
    json(body) {
      this.body = body
      return this
    },
  }
}

beforeEach(() => {
  fetchCalls = []
  imageBackendResponse = { backend: 'storage_base' }
  mainUploadResponse = {
    success: true,
    key: 'blog/11111111-1111-4111-8111-111111111111/images/202609/uuid.png',
    url: '/photo/blog/11111111-1111-4111-8111-111111111111/images/202609/uuid.png',
  }
  mainAttachmentsResponse = {
    success: true,
    items: [
      {
        key: 'blog/11111111-1111-4111-8111-111111111111/attachments/202609/a.pdf',
        original_name: '文档.pdf',
        size: 1024,
        mime: 'application/pdf',
        created_at: '2026-09-05T10:00:00Z',
      },
    ],
  }
  __resetImageBackendCacheForTest()
})

after(() => {
  global.fetch = originalFetch
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

function installFetchMock() {
  global.fetch = async (input, init) => {
    const url = String(input)
    fetchCalls.push({ url, init })
    if (url.includes('/api/storage/image-backend')) {
      return new Response(JSON.stringify(imageBackendResponse), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    if (url.includes('/api/storage/upload')) {
      return new Response(JSON.stringify(mainUploadResponse), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    if (url.includes('/api/storage/attachments')) {
      return new Response(JSON.stringify(mainAttachmentsResponse), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    if (url.includes('/api/storage/delete')) {
      return new Response(JSON.stringify({ success: true, key: 'deleted' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    // 兰空兜底（与 upload-auth.test.cjs 同形状）
    return new Response(
      JSON.stringify({
        status: true,
        data: {
          origin_name: 'test.png',
          mimetype: 'image/png',
          links: { url: 'https://images.example/test.png' },
        },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    )
  }
}

test('storage_base：图片转发主站存储，URL 拼主站域，不触兰空', async () => {
  installFetchMock()
  const res = createResponse()
  await uploadHandler(createRequest({ authorization: `Basic ${authValue()}` }), res)

  assert.equal(res.statusCode, 200)
  assert.equal(
    res.body.url,
    'https://main.example/photo/blog/11111111-1111-4111-8111-111111111111/images/202609/uuid.png'
  )
  assert.equal(res.body.success, true)
  const backendQuery = fetchCalls.find((c) => c.url.includes('/api/storage/image-backend'))
  assert.ok(backendQuery, '应先查询 image-backend')
  assert.match(backendQuery.url, /site_id=11111111-1111-4111-8111-111111111111/)
  assert.equal(backendQuery.init.headers.Authorization, 'Bearer s3-test-main-token')
  const mainUpload = fetchCalls.find((c) => c.url.includes('/api/storage/upload'))
  assert.ok(mainUpload, '应转发主站上传')
  assert.equal(mainUpload.init.headers.Authorization, 'Bearer s3-test-main-token')
  assert.ok(mainUpload.init.body instanceof FormData, '主站上传必须是 multipart FormData')
  assert.equal(mainUpload.init.body.get('type'), 'image')
  assert.equal(mainUpload.init.body.get('site_id'), '11111111-1111-4111-8111-111111111111')
  assert.equal(fetchCalls.filter((c) => c.url.includes('/api/v1/upload')).length, 0, '不得触兰空')
})

test('storage_base：video 不双轨，仍走兰空', async () => {
  installFetchMock()
  const res = createResponse()
  await uploadHandler(
    createRequest({
      authorization: `Basic ${authValue()}`,
      contentType: 'video/mp4',
      fileName: 'clip.mp4',
      body: Buffer.from('fake-video'),
    }),
    res
  )

  assert.equal(res.statusCode, 200)
  assert.equal(res.body.url, 'https://images.example/test.png')
  assert.equal(fetchCalls.filter((c) => c.url.includes('/api/storage/image-backend')).length, 0, 'video 不查询双轨')
  assert.equal(fetchCalls.filter((c) => c.url.includes('/api/v1/upload')).length, 1, 'video 走兰空')
})

test('legacy：backend=legacy 时图片走兰空原链路', async () => {
  installFetchMock()
  imageBackendResponse = { backend: 'legacy_landcloud' }
  const res = createResponse()
  await uploadHandler(createRequest({ authorization: `Basic ${authValue()}` }), res)

  assert.equal(res.statusCode, 200)
  assert.equal(res.body.url, 'https://images.example/test.png')
  assert.equal(fetchCalls.filter((c) => c.url.includes('/api/storage/upload')).length, 0)
  assert.equal(fetchCalls.filter((c) => c.url.includes('/api/v1/upload')).length, 1)
  const lsky = fetchCalls.find((c) => c.url.includes('/api/v1/upload'))
  assert.equal(lsky.init.headers.Authorization, 'Bearer s3-test-lsky-token')
})

test('兜底：image-backend 查询失败（500）回退兰空', async () => {
  global.fetch = async (input, init) => {
    const url = String(input)
    fetchCalls.push({ url, init })
    if (url.includes('/api/storage/image-backend')) {
      return new Response('boom', { status: 500 })
    }
    return new Response(
      JSON.stringify({
        status: true,
        data: { links: { url: 'https://images.example/test.png' } },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    )
  }
  const res = createResponse()
  await uploadHandler(createRequest({ authorization: `Basic ${authValue()}` }), res)

  assert.equal(res.statusCode, 200)
  assert.equal(res.body.url, 'https://images.example/test.png')
  assert.equal(fetchCalls.filter((c) => c.url.includes('/api/v1/upload')).length, 1)
})

test('主站存储上传失败：错误消息透传且不触兰空', async () => {
  installFetchMock()
  mainUploadResponse = { success: false, error: 'legacy_image_backend', message: '当前该站使用旧图床' }
  // 主站返回 409
  global.fetch = async (input, init) => {
    const url = String(input)
    fetchCalls.push({ url, init })
    if (url.includes('/api/storage/image-backend')) {
      return new Response(JSON.stringify(imageBackendResponse), { status: 200 })
    }
    if (url.includes('/api/storage/upload')) {
      return new Response(JSON.stringify(mainUploadResponse), { status: 409 })
    }
    return new Response(JSON.stringify({ status: true, data: { links: { url: 'x' } } }), { status: 200 })
  }
  const res = createResponse()
  await uploadHandler(createRequest({ authorization: `Basic ${authValue()}` }), res)

  assert.equal(res.statusCode, 409)
  assert.equal(res.body.success, false)
  assert.equal(res.body.error, '当前该站使用旧图床')
  assert.equal(fetchCalls.filter((c) => c.url.includes('/api/v1/upload')).length, 0)
})

test('admin attachments：未授权 GET 返回 401', async () => {
  installFetchMock()
  const res = createResponse()
  await attachmentsAdminHandler({ method: 'GET', url: '/api/admin/attachments?slug=p-1', headers: {}, cookies: {} }, res)
  assert.equal(res.statusCode, 401)
  assert.equal(fetchCalls.length, 0)
})

test('admin attachments：GET 列表拼绝对下载地址', async () => {
  installFetchMock()
  const res = createResponse()
  const req = {
    method: 'GET',
    url: '/api/admin/attachments?slug=p-abc',
    headers: { authorization: `Basic ${authValue()}` },
    cookies: {},
    query: { slug: 'p-abc' },
  }
  await attachmentsAdminHandler(req, res)

  assert.equal(res.statusCode, 200)
  assert.equal(res.body.success, true)
  assert.equal(res.body.items.length, 1)
  assert.equal(
    res.body.items[0].download_url,
    'https://main.example/files/blog/11111111-1111-4111-8111-111111111111/attachments/202609/a.pdf'
  )
  const call = fetchCalls.find((c) => c.url.includes('/api/storage/attachments'))
  assert.ok(call)
  assert.match(call.url, /post_key=p-abc/)
  assert.equal(call.init.headers.Authorization, 'Bearer s3-test-main-token')
})

test('admin attachments：POST 上传转发主站（type=attachment + post_key）', async () => {
  installFetchMock()
  const res = createResponse()
  const body = Buffer.from('%PDF-fake')
  const req = createRequest({
    authorization: `Basic ${authValue()}`,
    contentType: 'application/pdf',
    fileName: '文档.pdf',
    body,
  })
  req.method = 'POST'
  req.url = '/api/admin/attachments?slug=p-abc'
  req.query = { slug: 'p-abc' }
  await attachmentsAdminHandler(req, res)

  assert.equal(res.statusCode, 200)
  assert.equal(res.body.success, true)
  assert.ok(res.body.item.download_url.startsWith('https://main.example/files/'))
  const call = fetchCalls.find((c) => c.url.includes('/api/storage/upload'))
  assert.ok(call, '应转发主站上传')
  assert.equal(call.init.body.get('type'), 'attachment')
  assert.equal(call.init.body.get('post_key'), 'p-abc')
  assert.equal(call.init.body.get('site_id'), '11111111-1111-4111-8111-111111111111')
})

test('admin attachments：非法扩展名本地 415 拒绝', async () => {
  installFetchMock()
  const res = createResponse()
  const req = createRequest({
    authorization: `Basic ${authValue()}`,
    contentType: 'application/octet-stream',
    fileName: 'virus.exe',
    body: Buffer.from('evil'),
  })
  req.method = 'POST'
  req.url = '/api/admin/attachments?slug=p-abc'
  req.query = { slug: 'p-abc' }
  await attachmentsAdminHandler(req, res)

  assert.equal(res.statusCode, 415)
  assert.equal(fetchCalls.length, 0)
})

test('admin attachments：DELETE 转发主站删除（带 site_id）', async () => {
  installFetchMock()
  const res = createResponse()
  const key = 'blog/11111111-1111-4111-8111-111111111111/attachments/202609/a.pdf'
  const req = Readable.from([Buffer.from(JSON.stringify({ key }))])
  req.method = 'DELETE'
  req.url = '/api/admin/attachments'
  req.headers = { authorization: `Basic ${authValue()}`, 'content-type': 'application/json' }
  req.cookies = {}
  await attachmentsAdminHandler(req, res)

  assert.equal(res.statusCode, 200)
  assert.equal(res.body.success, true)
  const call = fetchCalls.find((c) => c.url.includes('/api/storage/delete'))
  assert.ok(call)
  assert.equal(call.init.method, 'POST')
  assert.deepEqual(JSON.parse(call.init.body), { key, site_id: '11111111-1111-4111-8111-111111111111' })
})

test('public attachments：合法 slug 返回列表；非法 slug 400；主站失败静默空列表', async () => {
  installFetchMock()

  const ok = createResponse()
  await publicAttachmentsHandler(
    { method: 'GET', url: '/api/attachments?slug=p-abc', query: { slug: 'p-abc' }, headers: {}, cookies: {} },
    ok
  )
  assert.equal(ok.statusCode, 200)
  assert.equal(ok.body.success, true)
  assert.equal(ok.body.items.length, 1)
  assert.ok(ok.body.items[0].download_url.startsWith('https://main.example/files/'))

  const bad = createResponse()
  await publicAttachmentsHandler(
    { method: 'GET', url: '/api/attachments?slug=BAD', query: { slug: 'BAD' }, headers: {}, cookies: {} },
    bad
  )
  assert.equal(bad.statusCode, 400)
  assert.deepEqual(bad.body.items, [])

  mainAttachmentsResponse = { success: false, error: 'boom' }
  global.fetch = async (input, init) => {
    fetchCalls.push({ url: String(input), init })
    return new Response(JSON.stringify(mainAttachmentsResponse), { status: 500 })
  }
  __resetImageBackendCacheForTest()
  const degraded = createResponse()
  await publicAttachmentsHandler(
    { method: 'GET', url: '/api/attachments?slug=p-abc', query: { slug: 'p-abc' }, headers: {}, cookies: {} },
    degraded
  )
  assert.equal(degraded.statusCode, 200)
  assert.deepEqual(degraded.body.items, [])
})
