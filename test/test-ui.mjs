/**
 * UI 端到端自测（node test/test-ui.mjs，必须用 desktop 自带的 Electron-as-node 跑）
 *
 * 借 app.asar 里现成的 jsdom，把 reader-ui.js 真跑起来：
 *   拖文件导入 → 底栏出现 → 快捷键翻页（整行步进 / 跨段） → 隐藏/恢复 → 书库面板 → 设置写入
 *
 * 用法：node "C:\...\.desktop-bin\node.cmd" test\test-ui.mjs
 */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

const ASAR = 'D:\\Program Files (x86)\\DSH\\DSH Desktop\\resources\\app.asar'
const { JSDOM } = require(join(ASAR, 'node_modules', 'jsdom'))

const coreCode = readFileSync(join(here, '..', 'web', 'reader-core.js'), 'utf8')
const uiCode = readFileSync(join(here, '..', 'web', 'reader-ui.js'), 'utf8')

/* -------------------------------------------------- 极简 IndexedDB 垫片 */

function createIdb() {
  const databases = new Map()

  function makeRequest() {
    return { onsuccess: null, onerror: null, onupgradeneeded: null, result: null, error: null }
  }

  function makeDb(name) {
    const stores = databases.get(name)
    return {
      name,
      objectStoreNames: { contains: (storeName) => stores.has(storeName) },
      createObjectStore(storeName) {
        stores.set(storeName, new Map())
      },
      transaction(storeName) {
        const data = stores.get(storeName)
        const tx = { oncomplete: null, onerror: null, error: null }
        const run = (fn) => {
          const req = makeRequest()
          queueMicrotask(() => {
            try {
              req.result = fn()
              if (req.onsuccess) req.onsuccess()
            } catch (err) {
              req.error = err
              if (req.onerror) req.onerror(err)
              if (tx.onerror) tx.onerror(err)
              return
            }
            queueMicrotask(() => {
              try {
                if (tx.oncomplete) tx.oncomplete()
              } catch {
                /* 测试垫片，忽略 */
              }
            })
          })
          return req
        }
        const store = {
          put: (value) => run(() => void data.set(value.id, JSON.parse(JSON.stringify(value)))),
          get: (key) => run(() => data.get(key)),
          getAll: () => run(() => Array.from(data.values())),
          delete: (key) => run(() => void data.delete(key)),
        }
        return {
          objectStore: () => store,
          set oncomplete(fn) {
            tx.oncomplete = fn
          },
          get oncomplete() {
            return tx.oncomplete
          },
          set onerror(fn) {
            tx.onerror = fn
          },
          get onerror() {
            return tx.onerror
          },
          get error() {
            return tx.error
          },
        }
      },
    }
  }

  return {
    open(name) {
      const req = makeRequest()
      queueMicrotask(() => {
        const isNew = !databases.has(name)
        if (isNew) databases.set(name, new Map())
        req.result = makeDb(name)
        if (isNew && req.onupgradeneeded) req.onupgradeneeded()
        if (req.onsuccess) req.onsuccess()
      })
      return req
    },
  }
}

/* --------------------------------------------------------------- 造页面 */

const dom = new JSDOM(
  '<!doctype html><html><body><div id="app"><div class="composer"><textarea placeholder="说点什么"></textarea></div></div></body></html>',
  { url: 'http://127.0.0.1:43129/', runScripts: 'outside-only', pretendToBeVisual: true },
)

const { window } = dom
window.TextDecoder = TextDecoder
window.TextEncoder = TextEncoder
window.indexedDB = createIdb()

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function until(check, label, timeout = 3000) {
  const started = Date.now()
  let last
  while (Date.now() - started < timeout) {
    try {
      if (check()) return
    } catch (err) {
      last = err
    }
    await wait(15)
  }
  throw new Error('等待超时：' + label + (last ? '（' + last.message + '）' : ''))
}

const results = []
async function check(name, fn) {
  try {
    await fn()
    results.push(['ok  ', name])
  } catch (err) {
    results.push(['FAIL', name + ' → ' + (err && err.message ? err.message : String(err))])
  }
}

/* ------------------------------------------------------------------ 启动 */

window.eval(coreCode)
// 这里模拟「已经用过一阵」的老用户，先打上"看过介绍"的标记，
// 否则 boot 会弹 7 秒的首次使用提示，下面第一条断言就不成立了。
window.localStorage.setItem('dsh-reader:seen-intro', '1')
window.eval(uiCode)
await until(() => window.document.getElementById('dsh-stealth-reader-host'), '宿主节点挂载')

const host = window.document.getElementById('dsh-stealth-reader-host')
const shadow = host.shadowRoot
const $ = (id) => shadow.getElementById(id)
const bar = $('bar')
const hud = $('hud')
const panel = $('panel')
const view = $('view')

await check('底栏默认隐藏（没书时不占屏）', () => {
  assert.equal(bar.hidden, true)
})

/* -------------------------------------------------------------- 导入 txt */

const CHAPTERS = [
  '第一章 渡口\n\n雨停在傍晚。江面上一层薄雾，把对岸的灯揉成一片模糊的黄。',
  '第二章 江心\n\n船到江心，风忽然停了。陈舟摇橹的手停在半空。',
  '第三章 灯\n\n对岸的灯忽然亮了。整片灯火同时腾起来，把雾烧出一个洞。',
].join('\n\n')

const fakeFile = {
  name: '测试书.txt',
  type: 'text/plain',
  arrayBuffer: async () => Buffer.from(CHAPTERS, 'utf8').buffer.slice(0),
}

const dropEvent = new window.Event('drop', { bubbles: true })
dropEvent.dataTransfer = { files: [fakeFile] }
$('card').dispatchEvent(dropEvent)

await until(() => /\d+% · \d+\/\d+/.test(hud.textContent), '导入完成并渲染出进度')

await check('导入后底栏出现，高度正好 N 行', () => {
  assert.equal(bar.hidden, false)
  const line = Number(view.style.lineHeight.replace('px', ''))
  assert.equal(line, Math.round(13 * 1.55))
  assert.equal(Number(view.style.height.replace('px', '')), line * 5)
})

await check('进度显示为 百分比 · 段/总段', () => {
  assert.match(hud.textContent, /^\d+% · 1\/\d+$/)
})

await check('正文进了 view，且没有插入不可见占位字符（换行交给浏览器算）', () => {
  assert.ok(view.textContent.includes('雨停在傍晚'))
  assert.ok(!view.textContent.includes('\u00a0'))
  assert.ok(!view.innerHTML.includes('<div'), '不该用便签式排版')
})

/* ---------------------------------------------- jsdom 没有布局：造滚动几何 */

const metrics = { scrollTop: 0 }
Object.defineProperty(view, 'clientHeight', {
  configurable: true,
  get: () => Number(view.style.height.replace('px', '')) || 100,
})
Object.defineProperty(view, 'scrollHeight', {
  configurable: true,
  get: () => view.clientHeight + Math.ceil((view.textContent || '').length / 24) * 20,
})
Object.defineProperty(view, 'scrollTop', {
  configurable: true,
  get: () => metrics.scrollTop,
  set: (value) => {
    const max = Math.max(0, view.scrollHeight - view.clientHeight)
    metrics.scrollTop = Math.min(max, Math.max(0, Math.round(value)))
  },
})

const lineHeight = () => Number(view.style.lineHeight.replace('px', ''))
const step = () => lineHeight() * Number(JSON.parse(window.localStorage.getItem('dsh-reader:settings') || '{}').lines || 5)

/* ------------------------------------------------------------- 快捷键翻页 */

function press(code, options = {}) {
  const event = new window.KeyboardEvent('keydown', {
    code,
    key: code,
    bubbles: true,
    cancelable: true,
    ctrlKey: !!options.ctrl,
    altKey: !!options.alt,
    shiftKey: !!options.shift,
  })
  window.dispatchEvent(event)
  return event
}

const combo = { ctrl: true, alt: true }

await check('Ctrl+Alt+J 翻一页 = 正好 N 行，并且吃掉事件', () => {
  const before = metrics.scrollTop
  const event = press('KeyJ', combo)
  assert.equal(metrics.scrollTop, Math.min(before + step(), view.scrollHeight - view.clientHeight), 'scrollTop 应整行步进')
  assert.ok(metrics.scrollTop > before, '应该真的往下走了')
  assert.equal(event.defaultPrevented, true, '不能让宿主页面跟着滚')
})

await check('Ctrl+Alt+K 往回翻一页', () => {
  const before = metrics.scrollTop
  press('KeyK', combo)
  assert.equal(metrics.scrollTop, Math.max(0, before - step()))
})

await check('翻到段底自动进下一段，且新段从顶开始', () => {
  let previous = metrics.scrollTop
  let crossed = false
  for (let i = 0; i < 200; i++) {
    press('KeyJ', combo)
    if (metrics.scrollTop === 0 && previous > 0) {
      crossed = true
      break
    }
    previous = metrics.scrollTop
  }
  assert.ok(crossed, '连按到底应该跨段（scrollTop 归零）')
  assert.match(hud.textContent, /· 2\/\d+$/, '段号应该 +1')
})

await check('段首再按上一页会退回上一段末尾', () => {
  assert.equal(metrics.scrollTop, 0)
  press('KeyK', combo)
  assert.match(hud.textContent, /· 1\/\d+$/, '应该回到上一段')
  assert.ok(metrics.scrollTop > 0, '回上一段要停在末尾，而不是开头')
})

/* ------------------------------------------------------------ 显示 / 隐藏 */

await check('Ctrl+Alt+H 收起，再按恢复', () => {
  press('KeyH', combo)
  assert.equal(bar.hidden, true)
  press('KeyH', combo)
  assert.equal(bar.hidden, false)
})

await check('裸 Esc 立刻收起（有人来了）', () => {
  const event = press('Escape')
  assert.equal(bar.hidden, true)
  assert.equal(event.defaultPrevented, true)
  press('KeyH', combo)
  assert.equal(bar.hidden, false)
})

await check('焦点在输入框时：组合键照翻，裸字母键还给输入框', () => {
  const textarea = window.document.querySelector('textarea')
  textarea.focus()
  const before = metrics.scrollTop
  press('KeyJ', combo)
  assert.notEqual(metrics.scrollTop, before, '带修饰键的组合不该被输入框吃掉')
  const plain = new window.KeyboardEvent('keydown', { code: 'KeyJ', key: 'j', bubbles: true, cancelable: true })
  textarea.dispatchEvent(plain)
  assert.equal(plain.defaultPrevented, false, '裸 j 必须留给用户打字')
})

/* ---------------------------------------------------------------- 书库面板 */

await check('Ctrl+Alt+O 打开书库并列出这本书', async () => {
  press('KeyO', combo)
  assert.equal(panel.hidden, false)
  await until(() => shadow.querySelectorAll('.book').length === 1, '书库列表渲染')
  assert.equal(shadow.querySelector('.book .title').textContent, '测试书')
  assert.match(shadow.querySelector('.book .sub').textContent, /TXT · .*3 段/)
})

await check('Esc 关掉书库（不顺手把底栏也藏了）', () => {
  press('Escape')
  assert.equal(panel.hidden, true)
})

/* ------------------------------------------------------------------ 设置 */

await check('设置与默认键位落到 localStorage', () => {
  const raw = window.localStorage.getItem('dsh-reader:settings')
  assert.ok(raw)
  const settings = JSON.parse(raw)
  assert.equal(settings.lines, 5)
  assert.equal(settings.fontSize, 13)
  assert.equal(settings.keys.next, 'Ctrl+Alt+KeyJ')
  assert.ok(settings.lastId, '应该记住上次读的书')
})

await check('阅读进度落到 localStorage（防抖后）', async () => {
  await wait(500)
  const settings = JSON.parse(window.localStorage.getItem('dsh-reader:settings'))
  const raw = window.localStorage.getItem('dsh-reader:pos:' + settings.lastId)
  assert.ok(raw, '应该有进度记录')
  const position = JSON.parse(raw)
  assert.ok(Number.isFinite(position.seg))
  assert.ok(position.frac >= 0 && position.frac <= 1)
})

await check('改行数后立刻按新高度重排', () => {
  press('KeyO', combo)
  const lines = $('set-lines')
  lines.value = '8'
  lines.dispatchEvent(new window.Event('input', { bubbles: true }))
  assert.equal(Number(view.style.height.replace('px', '')), lineHeight() * 8)
  assert.equal(JSON.parse(window.localStorage.getItem('dsh-reader:settings')).lines, 8)
  press('Escape')
})

await check('改字号后行高与高度一起变，仍按整行分页', () => {
  press('KeyO', combo)
  const font = $('set-font')
  font.value = '16'
  font.dispatchEvent(new window.Event('input', { bubbles: true }))
  assert.equal(Number(view.style.lineHeight.replace('px', '')), Math.round(16 * 1.55))
  assert.equal(Number(view.style.height.replace('px', '')), Math.round(16 * 1.55) * 8)
  press('Escape')
})

/* ------------------------------------------------- 首次安装的自我介绍 */

await check('首次打开、还没有书时，底栏露一次脸教人怎么用', async () => {
  const fresh = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://127.0.0.1:43129/',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  })
  fresh.window.TextDecoder = TextDecoder
  fresh.window.TextEncoder = TextEncoder
  fresh.window.indexedDB = createIdb()
  fresh.window.eval(coreCode)
  fresh.window.eval(uiCode)
  await until(() => fresh.window.document.getElementById('dsh-stealth-reader-host'), '干净环境宿主挂载')
  const freshHost = fresh.window.document.getElementById('dsh-stealth-reader-host')
  const freshShadow = freshHost.shadowRoot
  assert.equal(freshShadow.getElementById('bar').hidden, true, '没在面板里就不该冒出来')

  // 把宿主搬进「面板里的一页」，它才该露脸
  const pane = fresh.window.document.createElement('div')
  pane.getBoundingClientRect = () => ({ top: 0, bottom: 320, left: 0, right: 900, width: 900, height: 320 })
  fresh.window.document.body.appendChild(pane)
  pane.appendChild(freshHost)
  freshHost.dataset.inTab = '1'
  fresh.window.__dshReader.syncPresence()
  await until(() => freshShadow.getElementById('bar').hidden === false, '首次进面板该露脸')
  assert.match(freshShadow.getElementById('view').textContent, /拖进窗口/)
  assert.ok(fresh.window.localStorage.getItem('dsh-reader:seen-intro'), '应该记下已经看过介绍')
  // 不 close()：阅读器在窗口上挂了 MutationObserver 和 rAF，关掉的窗口再触发回调会炸在 jsdom 内部
})

/* ------------------------------------------------------- 设置页用的全局接口 */

await check('设置页通过 __dshReader 改行数会立刻重排', () => {
  const api = window.__dshReader
  assert.ok(api, '应该把接口挂到 globalThis.__dshReader')
  assert.equal(typeof api.setSettings, 'function')
  assert.equal(typeof api.getSettings, 'function')
  assert.equal(api.getSettings().lines, Number(view.style.height.replace('px', '')) / Number(view.style.lineHeight.replace('px', '')), '设置里的行数应与当前高度一致')
  const next = api.setSettings({ lines: 9 })
  assert.equal(next.lines, 9, 'setSettings 应回传新设置')
  const line = Number(view.style.lineHeight.replace('px', ''))
  assert.equal(Number(view.style.height.replace('px', '')), line * 9, '高度应按 9 行重排')
  assert.equal(JSON.parse(window.localStorage.getItem('dsh-reader:settings')).lines, 9, '应落盘')
})

await check('改键位后新组合生效、旧组合不再拦', () => {
  const api = window.__dshReader
  api.setSettings({ keys: { next: 'Ctrl+Alt+KeyU' } })
  const before = metrics.scrollTop
  press('KeyJ', { ctrl: true, alt: true })
  assert.equal(metrics.scrollTop, before, '旧的 Ctrl+Alt+J 应该不再翻页')
  press('KeyU', { ctrl: true, alt: true })
  assert.ok(metrics.scrollTop > before, '新的 Ctrl+Alt+U 应该翻页')
})

await check('恢复默认把行数与键位一起拉回，且不动当前书', () => {
  const api = window.__dshReader
  const bookBefore = api.currentBook()
  const restored = api.resetSettings()
  assert.equal(restored.lines, 5)
  assert.equal(restored.keys.next, 'Ctrl+Alt+KeyJ')
  assert.deepEqual(api.currentBook(), bookBefore, '恢复默认不该把书关掉')
})

await check('改颜色会写进 CSS 变量并落盘，非法值退回原样', () => {
  const api = window.__dshReader
  api.setSettings({ color: '#ff0044', bg: '#ffffff', bgAlpha: 12 })
  assert.equal(host.style.getPropertyValue('--r-fg'), 'rgba(255, 0, 68, 0.74)')
  assert.equal(host.style.getPropertyValue('--r-bg'), 'rgba(255, 255, 255, 0.12)')
  assert.equal(JSON.parse(window.localStorage.getItem('dsh-reader:settings')).bgAlpha, 12)
  api.setSettings({ color: 'not-a-color', bg: '#12' })
  assert.equal(api.getSettings().color, '#ff0044', '非法颜色应保持原值')
  assert.equal(api.getSettings().bg, '#ffffff')
  api.setSettings({ color: '#abc' })
  assert.equal(api.getSettings().color, '#aabbcc', '三位简写应展开成六位')
  api.setSettings({ color: '#e6e8ee', bg: '#0e1016', bgAlpha: 34 })
})

await check('面板不在的时候它一点都不画', async () => {
  // 底部面板是 dsh-better-sidebar 画的，我们不再往页面上浮东西：
  // 只要宿主没被 tab 搬进去，就算那个面板 DOM 出现了也不该冒出来。
  const dock = window.document.createElement('div')
  dock.setAttribute('data-dsh-bottom-panel', '')
  dock.getBoundingClientRect = () => ({ top: 600, bottom: 740, left: 40, right: 1200, width: 1160, height: 140 })
  window.document.body.appendChild(dock)

  window.dispatchEvent(new window.Event('resize'))
  await wait(40)
  assert.ok(!host.dataset.docked, '不该再有贴面板这一说')
  assert.ok(!host.style.left && !host.style.bottom, '不该自己算位置')
  assert.equal(host.hidden, true, '没接进面板就完全藏起来')

  dock.remove()
  window.dispatchEvent(new window.Event('resize'))
  await wait(40)
})

await check('底栏 tab 能用 subscribe 收到翻页，也能拿到宿主元素', () => {
  const api = window.__dshReader
  let hits = 0
  const off = api.subscribe(() => {
    hits++
  })
  assert.equal(api.hostElement(), host, 'hostElement 应该就是那个宿主 div')
  api.next()
  assert.ok(hits > 0, '翻页应该通知订阅者')
  const after = hits
  off()
  api.next()
  assert.equal(hits, after, '退订之后不该再收到')
})

await check('接进面板后按容器高度自动算行数', async () => {
  const api = window.__dshReader
  api.setSettings({ autoLines: true, lines: 5, lineHeight: 2 }) // 13 × 2 = 26px 一行

  const pane = window.document.createElement('div')
  pane.getBoundingClientRect = () => ({ top: 0, bottom: 300, left: 0, right: 1000, width: 1000, height: 300 })
  window.document.body.appendChild(pane)

  pane.appendChild(host)
  host.dataset.inTab = '1'
  api.syncPresence()
  await wait(20)
  assert.equal(host.hidden, false, '接进面板就该显示')
  // (300 - 30 内边距) / 26 = 10.38 → 只画 10 行，余数丢掉不切半行
  assert.equal(view.style.height, String(10 * 26) + 'px', '高度决定行数，余数丢掉')

  api.setSettings({ autoLines: false, lines: 5 })
  assert.equal(view.style.height, String(5 * 26) + 'px', '关掉自动就回到固定行数')

  host.dataset.inTab && delete host.dataset.inTab
  window.document.body.appendChild(host)
  api.syncPresence()
  api.setSettings({ autoLines: true, lineHeight: 1.55 })
  pane.remove()
  await wait(20)
})

await check('书库面板里有行距、字体、跟随三项', () => {
  const lineHeight = $('set-lineheight')
  const family = $('set-family')
  const match = $('set-match')
  assert.ok(lineHeight, '应该有行距滑块')
  assert.equal(lineHeight.min, '1.1')
  assert.equal(lineHeight.step, '0.05')
  assert.ok(family, '应该有字体下拉')
  assert.equal(family.options.length, 5, '五个字体预设')
  assert.ok(match, '应该有跟随按钮')
  assert.match(match.textContent, /对话页/)
})

await check('改行距立刻改变每页高度', () => {
  const api = window.__dshReader
  api.setSettings({ lineHeight: 2 })
  const settings = api.getSettings()
  assert.equal(settings.lineHeight, 2)
  assert.equal(view.style.lineHeight, String(Math.round(13 * 2)) + 'px', '行高 = 字号 × 行距')
  assert.equal(view.style.height, String(5 * Math.round(13 * 2)) + 'px', '整条高度跟着行数走')
  const saved = JSON.parse(window.localStorage.getItem('dsh-reader:settings'))
  assert.equal(saved.lineHeight, 2, '行距要落盘')
})

await check('换字体写进 --r-font，也落盘', () => {
  const api = window.__dshReader
  api.setSettings({ fontFamily: 'monospace' })
  assert.equal(view.style.fontFamily, 'monospace')
  assert.equal(host.style.getPropertyValue('--r-font'), 'monospace')
  const saved = JSON.parse(window.localStorage.getItem('dsh-reader:settings'))
  assert.equal(saved.fontFamily, 'monospace')
  api.setSettings({ fontFamily: '' })
  assert.ok(host.style.getPropertyValue('--r-font').includes('Segoe UI'), '空值回到默认字体栈')
})

await check('「跟对话页完全一致」把字号、行距、颜色一起抄过来', async () => {
  const doc = window.document
  const vw = window.innerWidth
  const wrapper = doc.createElement('div')
  wrapper.style.background = '#ffffff'
  const content = doc.createElement('div')
  content.setAttribute('data-conversation-content', '')
  content.style.fontSize = '15px'
  content.style.lineHeight = '24px'
  content.style.fontFamily = '"Songti SC", serif'
  content.style.color = '#111827'
  content.getBoundingClientRect = () => ({ top: 100, bottom: 900, left: 40, right: vw - 40, width: vw - 80, height: 800 })
  wrapper.appendChild(content)
  doc.body.appendChild(wrapper)

  const api = window.__dshReader
  const ok = api.matchPage()
  assert.equal(ok, true, '应该量得到')
  const settings = api.getSettings()
  assert.equal(settings.matchPage, true)
  assert.equal(settings.match.fontSize, 15)
  assert.equal(Number(settings.match.lineHeight.toFixed(2)), 1.6, '24 / 15 = 1.6 倍')
  assert.equal(settings.match.color, '#111827')
  assert.equal(settings.match.bg, '#ffffff')
  assert.equal(settings.match.left, 40)
  assert.equal(settings.match.right, 40)

  await wait(40)
  assert.equal(view.style.fontSize, '15px', '正文字号跟着页面')
  assert.equal(view.style.fontFamily, '"Songti SC", serif')
  assert.equal(view.style.lineHeight, '24px')
  assert.equal(host.style.left, '', '不再自己定位，位置全交给面板')
  assert.equal(host.style.getPropertyValue('--r-fg'), 'rgba(17, 24, 39, 0.74)')
  assert.equal(host.style.getPropertyValue('--r-bg'), 'rgba(255, 255, 255, 1)')
  assert.equal($('set-font').disabled, true, '跟随时手动滑块该锁住')
  assert.match($('set-match').textContent, /取消跟随/)

  const saved = JSON.parse(window.localStorage.getItem('dsh-reader:settings'))
  assert.equal(saved.matchPage, true)
  assert.equal(saved.match.fontSize, 15)

  content.remove()
  wrapper.remove()
})

await check('取消跟随回到自己的字号', async () => {
  const api = window.__dshReader
  api.unmatchPage()
  await wait(40)
  const settings = api.getSettings()
  assert.equal(settings.matchPage, false)
  assert.equal(view.style.fontSize, '13px')
  assert.ok(!host.style.left, '跟随关掉也不该开始自己定位')
  assert.equal($('set-font').disabled, false)
  assert.match($('set-match').textContent, /跟对话页/)
})

/* ------------------------------------------------------------------ 汇总 */

for (const [status, name] of results) console.log('  ' + status + ' ' + name)
const failed = results.filter(([status]) => status === 'FAIL')
console.log(`\n${results.length - failed.length}/${results.length} 通过`)

// jsdom 的定时器（我的阅读器也自带一个 hideTimer）会一直拖住事件循环，显式退出
process.exit(failed.length ? 1 : 0)
