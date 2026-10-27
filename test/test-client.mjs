// 浏览器半侧（设置页）的测试：不启浏览器，用真的 react + react-dom/server 把它渲染成 HTML，
// 断言注册进 settings.section 的形状，以及它读到的设置/快捷键。
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

const ASAR_MODULES = 'D:\\Program Files (x86)\\DSH\\DSH Desktop\\resources\\app.asar\\node_modules\\'
const requireAsar = createRequire(ASAR_MODULES + 'noop.js')
const React = requireAsar('react')
const { renderToStaticMarkup } = requireAsar('react-dom/server')

const CLIENT = path.resolve('lib/client.js')

let failures = 0
let TOTAL = 0
async function check(name, fn) {
  TOTAL++
  try {
    await fn()
    console.log('  ok   ' + name)
  } catch (error) {
    failures++
    console.log('  FAIL ' + name + '\n       ' + (error && error.message))
  }
}

/** 造一个最小的 window：只要 localStorage、定时器与 __ModuleLoader__。 */
function makeWindow() {
  const store = new Map()
  const win = {
    localStorage: {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => store.set(key, String(value)),
      removeItem: (key) => store.delete(key),
    },
    setInterval: () => 0,
    clearInterval: () => {},
    setTimeout: () => 0,
    clearTimeout: () => {},
    __store: store,
  }
  return win
}

/** 载入 bundle，拿到 factory，用真的 react 物化它。 */
async function loadClient(win) {
  let row = null
  win.__ModuleLoader__ = { load: (value) => (row = value) }
  globalThis.window = win
  await import(pathToFileURL(CLIENT).href + '?t=' + Date.now())
  assert.ok(row, 'bundle 应该调用 __ModuleLoader__.load')
  const exports = row.factory((id) => {
    if (id === 'react') return React
    throw new Error('未预期的模块请求: ' + id)
  })
  return { row, exports }
}

/** 跑一遍 apply，抓下注册参数（设置分区 + 底栏面板的「小说」页）。 */
function mount(exports) {
  const seen = { registers: [], injects: [], tabs: [], opened: [] }
  const tabService = {
    registerTab: (descriptor) => {
      seen.tabs.push(descriptor)
      return () => {}
    },
    openTab: (seed) => seen.opened.push(seed),
  }
  const tabCtx = {
    betterSidebar: tabService,
    get: (key) => (key === 'betterSidebar' ? tabService : undefined),
    effect: (fn) => fn(),
  }
  const ctx = {
    effect: (fn) => fn(),
    inject: (deps, callback) => {
      seen.injectServices = (seen.injectServices || []).concat(deps)
      return callback(tabCtx)
    },
    slots: {
      inject: (name, callback) => {
        seen.injects.push(name)
        return callback()
      },
      register: (spec, component) => {
        seen.registers.push({ spec, component })
        return () => {}
      },
    },
  }
  exports.apply(ctx)
  return seen
}

console.log('设置页（浏览器半侧）')

const baseWin = makeWindow()
const { row, exports } = await loadClient(baseWin)

await check('bundle 用包名注册 factory', () => {
  assert.equal(row.id, 'dsh-stealth-reader')
  assert.equal(typeof row.factory, 'function')
})

await check('模块声明依赖 slots', () => {
  assert.equal(exports.name, 'dsh-stealth-reader-client')
  assert.deepEqual(exports.inject, ['slots'])
})

const mounted = mount(exports)

await check('注册进 settings.section 且带中文标题', () => {
  assert.deepEqual(mounted.injects, ['settings.section'])
  assert.equal(mounted.registers.length, 1)
  const { spec } = mounted.registers[0]
  assert.equal(spec.name, 'settings.section')
  assert.equal(spec.id, 'dsh-stealth-reader')
  assert.equal(spec.label, '隐蔽阅读器')
  assert.ok(Number.isFinite(spec.order))
})

await check('组件渲染出显示项与默认快捷键', () => {
  const html = renderToStaticMarkup(React.createElement(mounted.registers[0].component))
  for (const needle of ['显示行数', '自动', '字号', '行距', '字体', '透明度', '文字颜色', '背景颜色', '背景浓度', '快捷键', '打开书库', '恢复默认']) {
    assert.ok(html.includes(needle), '缺少「' + needle + '」')
  }
  assert.equal((html.match(/type="color"/g) || []).length, 2, '应该有两个取色器')
  assert.equal((html.match(/type="checkbox"/g) || []).length, 2, '自动行数 + 失焦隐藏各一个')
  assert.equal((html.match(/<option/g) || []).length, 5, '字体应该有五个预设')
  for (const needle of ['Ctrl + Alt + H', 'Ctrl + Alt + J', 'Ctrl + Alt + K', 'Ctrl + Alt + O']) {
    assert.ok(html.includes(needle), '缺少快捷键 ' + needle)
  }
  assert.ok(html.includes('5 行'), '应显示当前行数')
})

await check('有「跟对话页完全一致」的入口，并显示未跟随状态', () => {
  const html = renderToStaticMarkup(React.createElement(mounted.registers[0].component))
  assert.ok(html.includes('跟随对话页'), '缺少跟随分区')
  assert.ok(html.includes('跟对话页完全一致'), '缺少跟随按钮')
  assert.ok(html.includes('1.55×'), '应显示默认行距')
  assert.ok(!html.includes('已跟随：'), '默认没跟随')
})

await check('跟随时显示量到的数值，按钮变成取消', async () => {
  const win = makeWindow()
  win.__dshReader = {
    getSettings: () => ({
      lines: 5,
      fontSize: 15,
      lineHeight: 1.6,
      opacity: 62,
      color: '#111827',
      bg: '#ffffff',
      bgAlpha: 100,
      matchPage: true,
      match: { fontSize: 15, lineHeight: 1.6, color: '#111827', bg: '#ffffff', bgAlpha: 100, left: 40, right: 40 },
      hideOnBlur: true,
      keys: { toggle: 'Ctrl+Alt+KeyH', next: 'Ctrl+Alt+KeyJ', prev: 'Ctrl+Alt+KeyK', lib: 'Ctrl+Alt+KeyO' },
    }),
    currentBook: () => null,
    hasBook: () => false,
  }
  const loaded = await loadClient(win)
  const seen = mount(loaded.exports)
  const html = renderToStaticMarkup(React.createElement(seen.registers[0].component))
  assert.ok(html.includes('已跟随：'), '该显示跟随状态')
  assert.ok(html.includes('15.0px'), '该显示量到的字号')
  assert.ok(html.includes('取消跟随'), '按钮该变成取消')
})

await check('没有底栏时退回 localStorage 里的设置', async () => {
  const win = makeWindow()
  win.localStorage.setItem(
    'dsh-reader:settings',
    JSON.stringify({ lines: 7, fontSize: 16, opacity: 41, keys: { next: 'Ctrl+Alt+KeyU' } }),
  )
  const loaded = await loadClient(win)
  const seen = mount(loaded.exports)
  const html = renderToStaticMarkup(React.createElement(seen.registers[0].component))
  assert.ok(html.includes('7 行'), '行数应来自 localStorage')
  assert.ok(html.includes('16px'), '字号应来自 localStorage')
  assert.ok(html.includes('41%'), '透明度应来自 localStorage')
  assert.ok(html.includes('Ctrl + Alt + U'), '自定义快捷键应生效')
})

await check('底栏活着时以它的设置实例为准', async () => {
  const win = makeWindow()
  win.localStorage.setItem('dsh-reader:settings', JSON.stringify({ lines: 3 }))
  win.__dshReader = {
    getSettings: () => ({
      lines: 9,
      fontSize: 12,
      opacity: 80,
      hideOnBlur: false,
      keys: { next: 'Ctrl+Alt+KeyN', toggle: 'Ctrl+Alt+KeyM' },
    }),
    currentBook: () => ({ id: 'x', title: '夜行船', author: '测试', total: 12, index: 3 }),
  }
  const loaded = await loadClient(win)
  const seen = mount(loaded.exports)
  const html = renderToStaticMarkup(React.createElement(seen.registers[0].component))
  assert.ok(html.includes('9 行'), '应以底栏的 settings 为准')
  assert.ok(html.includes('Ctrl + Alt + N'))
  assert.ok(html.includes('Ctrl + Alt + M'))
})

await check('有书时显示书名与段号', () => {
  // 复用上一条的 window（底栏桩还在）
  const win = globalThis.window
  const html = renderToStaticMarkup(React.createElement(mount(exports).registers[0].component))
  assert.ok(html.includes('夜行船'), '应显示书名')
  assert.ok(html.includes('4 / 12'), '应显示 第 4 / 12 段')
  win.__dshReader = undefined
})

await check('把「速记」页注册进底栏面板，且只出现在底栏', () => {
  assert.deepEqual(mounted.injectServices, ['betterSidebar'])
  assert.equal(mounted.tabs.length, 1)
  const tab = mounted.tabs[0]
  assert.equal(tab.id, 'dsh-stealth-reader:novel')
  assert.equal(tab.title, '速记')
  assert.equal(tab.bottomOnly, true, '只在底栏出现，别去右侧栏抢位置')
  assert.equal(tab.single, true, '一本书一页就够，别开出好几个')
  assert.equal(typeof tab.component, 'function')
  assert.ok(tab.icon, '应该有个图标')
  const iconHtml = renderToStaticMarkup(tab.icon)
  assert.ok(iconHtml.includes('svg'))
  // 名字和副标题别把用途写在脸上。
  assert.ok(!tab.title.includes('小说'))
  assert.ok(!String(tab.description).includes('小说'))
  assert.ok(!String(tab.description).includes('阅读器'))
})

await check('「速记」页没书时给出导入入口', () => {
  const tab = mounted.tabs[0]
  const html = renderToStaticMarkup(React.createElement(tab.component, { visible: true }))
  assert.ok(html.includes('打开书库导入'), '应该有个导入按钮')
  assert.ok(html.includes('txt') && html.includes('epub'), '应该说清楚支持哪两种格式')
})

await check('有书时「速记」页不再显示导入提示', async () => {
  const win = makeWindow()
  win.__dshReader = {
    hasBook: () => true,
    currentBook: () => ({ id: 'x', title: '夜行船', total: 4, index: 1 }),
    subscribe: () => () => {},
    hostElement: () => null,
  }
  const loaded = await loadClient(win)
  const seen = mount(loaded.exports)
  const tab = seen.tabs[0]
  const html = renderToStaticMarkup(React.createElement(tab.component, { visible: true }))
  assert.ok(!html.includes('打开书库导入'), '有书就不该再提示导入')
  win.__dshReader = undefined
})

console.log('')
if (failures) {
  console.log(failures + ' 项失败')
  process.exit(1)
}
console.log(TOTAL + '/' + TOTAL + ' 通过')
process.exit(0)
