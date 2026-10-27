/**
 * 宿主半区自测（node test/test-host.mjs）
 *
 * 用假的 root / webServer 跑 apply()，验证：
 *   - index-inject 行只推一次、内容含 loader 且是同步推的
 *   - /dsh-reader/* 路由真的能把磁盘文件吐出来（且能通过 vm 解析 = 语法有效）
 *   - ping 路由、tapIndex 注入位置
 */
import assert from 'node:assert/strict'
import { runInNewContext } from 'node:vm'
import plugin from '../lib/index.js'

const routes = new Map()
const taps = []
const events = new Map()

const fakeServer = {
  register(route) {
    assert.ok(route && (route.kind === 'exact' || route.kind === 'prefix'), 'route.kind 必须是 exact/prefix')
    assert.ok(typeof route.path === 'string' && route.path.startsWith('/'), 'route.path 必须以 / 开头')
    assert.ok(typeof route.handler === 'function', 'route.handler 必须是函数')
    assert.ok(!routes.has(route.path), '重复注册：' + route.path)
    routes.set(route.path, route)
    return () => routes.delete(route.path)
  },
  tapIndex(transform) {
    taps.push(transform)
    return () => taps.splice(taps.indexOf(transform), 1)
  },
}

const fakeCtx = { webServer: fakeServer, logger: { info() {} } }

const fakeRoot = {
  on(event, handler) {
    if (!events.has(event)) events.set(event, [])
    events.get(event).push(handler)
    return () => {}
  },
  inject(deps, callback) {
    assert.deepEqual(deps, ['webServer'])
    callback(fakeCtx)
  },
  effect(setup) {
    setup()
  },
}

function fakeResponse() {
  const res = {
    status: 0,
    headers: {},
    body: '',
    writeHead(status, headers) {
      res.status = status
      res.headers = headers || {}
    },
    end(chunk) {
      res.body = chunk === undefined ? '' : String(chunk)
    },
  }
  return res
}

async function get(path) {
  const route = routes.get(path)
  assert.ok(route, '路由没有注册：' + path)
  const res = fakeResponse()
  await route.handler({ method: 'GET', url: path, headers: {} }, res)
  return res
}

plugin.apply(fakeRoot)
assert.equal(plugin.name, 'dsh-stealth-reader')

/* --------------------------------------------------------- index-inject */

const table = []
for (const handler of events.get('webserver/index-inject') || []) handler(table)

assert.equal(table.length, 1, '应该推且只推一行')
const row = table[0]
assert.equal(row.kind, 'script')
assert.equal(row.placement, 'body')
assert.ok(row.text.includes('/dsh-reader/reader-core.js'), 'loader 必须包含 core')
assert.ok(row.text.includes('/dsh-reader/reader-ui.js'), 'loader 必须包含 ui')
assert.ok(/reader-core\.js\?v=\d+/.test(row.text), 'loader 必须带版本号（刷新即生效）')
assert.ok(row.text.startsWith('(function(){'), 'loader 应该是包裹过的内联脚本')
// 同步推：handler 返回后 table 里必须已经有内容（异步 push 会错过渲染）
assert.ok(table.length === 1)

// 同一次渲染里再 emit 一遍：不能塞第二行
for (const handler of events.get('webserver/index-inject') || []) handler(table)
assert.equal(table.length, 1, '同一次渲染不能重复注入')

// 新一次渲染（新 table）必须能拿到注入，否则刷新页面就没阅读器了
const table2 = []
for (const handler of events.get('webserver/index-inject') || []) handler(table2)
assert.equal(table2.length, 1, '每次渲染都应注入一次')

/* --------------------------------------------------------------- 路由 */

const core = await get('/dsh-reader/reader-core.js')
assert.equal(core.status, 200)
assert.match(core.headers['Content-Type'], /application\/javascript/)
assert.equal(core.headers['Cache-Control'], 'no-store')
assert.ok(core.body.includes('DshReaderCore'), 'core 里应该有 DshReaderCore 导出')

const ui = await get('/dsh-reader/reader-ui.js')
assert.equal(ui.status, 200)
assert.ok(ui.body.includes('__dshStealthReaderUI__'), 'ui 里应该有防重入标记')

const ping = await get('/dsh-reader/ping')
assert.equal(ping.status, 200)
const info = JSON.parse(ping.body)
assert.equal(info.ok, true)
assert.equal(info.plugin, 'dsh-stealth-reader')
assert.match(info.version, /^\d+$/)

// 吐出来的 core 必须真的是可执行 JS（在 vm 里跑一遍）
const sandbox = { TextDecoder, Uint8Array, ArrayBuffer, DataView, Blob, Response, DecompressionStream, Number, Math, JSON, String, Object, RegExp, console }
sandbox.globalThis = sandbox
runInNewContext(core.body, sandbox)
assert.ok(sandbox.DshReaderCore, '通过路由取到的 core 必须能正常执行')

/* -------------------------------------------------------------- tapIndex */

assert.equal(taps.length, 1, '应该注册一个 tapIndex')
const html = taps[0]('<html><head></head><body><div id="root"></div></body></html>')
assert.ok(html.includes('<script defer src="/dsh-reader/reader-core.js"></script>'), 'tap 必须补 core')
assert.ok(html.includes('<script defer src="/dsh-reader/reader-ui.js"></script>'), 'tap 必须补 ui')
assert.ok(html.indexOf('/dsh-reader/reader-ui.js') < html.indexOf('</body>'), '注入必须在 </body> 之前')
// 已经注入过的 index 不重复补
assert.equal(taps[0](html), html, '已注入的 html 不能再动')

console.log('  ok    index-inject 行：单次、同步、带版本号')
console.log('  ok    路由 /dsh-reader/reader-core.js 内容可执行')
console.log('  ok    路由 /dsh-reader/reader-ui.js')
console.log('  ok    路由 /dsh-reader/ping')
console.log('  ok    tapIndex 注入位置与去重')
console.log('\n5/5 通过')
