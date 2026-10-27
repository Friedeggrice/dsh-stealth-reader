/**
 * dsh-stealth-reader · UI
 *
 * 在页面底部（输入框正上方）叠一条 N 行高的半透明文字带：
 *  - 用 scrollTop 按「整行」滚动实现翻页，换行由浏览器自己算，永远对齐
 *  - Shadow DOM 隔离样式，不污染也不被宿主样式污染
 *  - 全局快捷键（默认 Ctrl+Alt+H/J/K/O），带修饰键的组合在输入框里也生效
 *  - 书库 / 阅读进度 / 设置全部存在浏览器本地（IndexedDB + localStorage）
 */
(function () {
  'use strict'

  if (globalThis.__dshStealthReaderUI__) return
  globalThis.__dshStealthReaderUI__ = 1

  const core = globalThis.DshReaderCore
  if (!core) {
    console.warn('[dsh-reader] reader-core.js 没有先加载，阅读器退出')
    return
  }

  const HOST_ID = 'dsh-stealth-reader-host'
  const SETTINGS_KEY = 'dsh-reader:settings'
  const INTRO_KEY = 'dsh-reader:seen-intro'
  const LAST_KEY = 'dsh-reader:last'
  const POS_PREFIX = 'dsh-reader:pos:'
  const DB_NAME = 'dsh-reader'
  const DB_VERSION = 1
  const STORE_META = 'meta'
  const STORE_TEXT = 'text'

  /** 没指定字体时用它：跟 DSH 界面同一套无衬线栈。 */
  const DEFAULT_FONT = '"Segoe UI", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif'

  /** 字体下拉的预设，值是 CSS font-family。 */
  const FONT_PRESETS = [
    { value: '', label: '默认（界面字体）' },
    { value: '"PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif', label: '无衬线（黑体）' },
    { value: '"Songti SC", SimSun, "Noto Serif CJK SC", serif', label: '宋体（衬线）' },
    { value: '"Kaiti SC", KaiTi, STKaiti, serif', label: '楷体' },
    { value: 'ui-monospace, "Cascadia Code", Consolas, "Courier New", monospace', label: '等宽' },
  ]

  const ACTIONS = [
    { id: 'toggle', label: '显示 / 隐藏' },
    { id: 'next', label: '下一页' },
    { id: 'prev', label: '上一页' },
    { id: 'lib', label: '打开书库' },
  ]

  /** 面板里那条带子自己的上下内边距 + 右下角 HUD 占掉的高度（自动行数要减掉）。 */
  const BAR_CHROME_PX = 30

  const DEFAULT_SETTINGS = {
    lines: 5,
    autoLines: true,
    fontSize: 13,
    lineHeight: 1.55,
    fontFamily: '',
    opacity: 62,
    color: '#e6e8ee',
    bg: '#0e1016',
    bgAlpha: 34,
    matchPage: false,
    match: null,
    hideOnBlur: true,
    visible: true,
    lastId: '',
    keys: {
      toggle: 'Ctrl+Alt+KeyH',
      next: 'Ctrl+Alt+KeyJ',
      prev: 'Ctrl+Alt+KeyK',
      lib: 'Ctrl+Alt+KeyO',
    },
  }

  /* ------------------------------------------------------------- settings */

  function clone(value) {
    return JSON.parse(JSON.stringify(value))
  }

  function loadSettings() {
    const settings = clone(DEFAULT_SETTINGS)
    try {
      const raw = localStorage.getItem(SETTINGS_KEY)
      if (raw) {
        const saved = JSON.parse(raw)
        if (saved && typeof saved === 'object') {
          for (const key of ['lines', 'fontSize', 'opacity', 'bgAlpha']) {
            if (Number.isFinite(saved[key])) settings[key] = saved[key]
          }
          if (Number.isFinite(saved.lineHeight)) settings.lineHeight = saved.lineHeight
          if (typeof saved.autoLines === 'boolean') settings.autoLines = saved.autoLines
          if (typeof saved.fontFamily === 'string') settings.fontFamily = saved.fontFamily.slice(0, 200)
          if (typeof saved.matchPage === 'boolean') settings.matchPage = saved.matchPage
          if (saved.match && typeof saved.match === 'object') settings.match = sanitizeMatch(saved.match)
          if (typeof saved.color === 'string') settings.color = normalizeHex(saved.color, settings.color)
          if (typeof saved.bg === 'string') settings.bg = normalizeHex(saved.bg, settings.bg)
          if (typeof saved.hideOnBlur === 'boolean') settings.hideOnBlur = saved.hideOnBlur
          if (typeof saved.visible === 'boolean') settings.visible = saved.visible
          if (typeof saved.lastId === 'string') settings.lastId = saved.lastId
          if (saved.keys && typeof saved.keys === 'object') {
            for (const action of ACTIONS) {
              if (typeof saved.keys[action.id] === 'string' && saved.keys[action.id]) settings.keys[action.id] = saved.keys[action.id]
            }
          }
        }
      }
    } catch {
      /* 坏设置直接回到默认 */
    }
    settings.lines = clamp(Math.round(settings.lines), 2, 40)
    settings.fontSize = clamp(Math.round(settings.fontSize), 10, 24)
    settings.lineHeight = clamp(Number(settings.lineHeight) || 1.55, 1.1, 3)
    settings.opacity = clamp(Math.round(settings.opacity), 20, 100)
    settings.bgAlpha = clamp(Math.round(settings.bgAlpha), 0, 100)
    return settings
  }

  /* ------------------------------------------------------- 跟随对话页样式 */

  /** 把从对话页量到的样式洗成一份可信的小对象；缺哪项就退回默认。 */
  function sanitizeMatch(raw) {
    if (!raw || typeof raw !== 'object') return null
    const match = {
      fontFamily: typeof raw.fontFamily === 'string' ? raw.fontFamily.slice(0, 300) : '',
      fontSize: Number.isFinite(raw.fontSize) ? clamp(Number(raw.fontSize), 8, 40) : 13,
      lineHeight: Number.isFinite(raw.lineHeight) ? clamp(Number(raw.lineHeight), 1, 3) : 1.55,
      color: normalizeHex(raw.color, '#e6e8ee'),
      bg: normalizeHex(raw.bg, '#0e1016'),
      bgAlpha: Number.isFinite(raw.bgAlpha) ? clamp(Math.round(raw.bgAlpha), 0, 100) : 34,
      left: Number.isFinite(raw.left) ? Math.max(0, Math.round(raw.left)) : 0,
      right: Number.isFinite(raw.right) ? Math.max(0, Math.round(raw.right)) : 0,
    }
    if (raw.measuredAt && Number.isFinite(raw.measuredAt)) match.measuredAt = raw.measuredAt
    return match
  }

  /** rgb()/rgba() → {hex, alpha}；拿不到就 null。 */
  function parseColor(value) {
    const text = String(value || '').trim()
    const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text)
    if (hex) return { hex: normalizeHex(text, '#000000'), alpha: 1 }
    const rgb = /^rgba?\(([^)]+)\)$/i.exec(text)
    if (!rgb) return null
    const parts = rgb[1].split(/[,/\s]+/).filter(Boolean).map(Number)
    if (parts.length < 3 || parts.slice(0, 3).some((n) => !Number.isFinite(n))) return null
    const [r, g, b] = parts.slice(0, 3).map((n) => clamp(Math.round(n), 0, 255))
    const alpha = parts.length > 3 && Number.isFinite(parts[3]) ? clamp(parts[3], 0, 1) : 1
    const to2 = (n) => n.toString(16).padStart(2, '0')
    return { hex: '#' + to2(r) + to2(g) + to2(b), alpha }
  }

  /** 从对话页当前样式里量一份「完全一致」的参数。量不到就返回 null。 */
  function measurePage() {
    if (typeof document === 'undefined' || !document.querySelector) return null
    const target =
      document.querySelector('[data-conversation-content]') ||
      document.querySelector('[data-conversation-scroll]') ||
      document.querySelector('[data-conversation-region]')
    if (!target || typeof getComputedStyle !== 'function') return null
    const style = getComputedStyle(target)
    const fontSize = Number.parseFloat(style.fontSize) || 0
    if (fontSize < 6) return null
    const rawLine = Number.parseFloat(style.lineHeight)
    const lineHeight = Number.isFinite(rawLine) && rawLine > 0 ? clamp(rawLine / fontSize, 1, 3) : 1.6

    // 背景：一层层往上找第一个不透明的底色（对话区自己通常是透明的）。
    let bg = null
    for (let el = target; el && el !== document.documentElement; el = el.parentElement) {
      const parsed = parseColor(getComputedStyle(el).backgroundColor)
      if (parsed && parsed.alpha > 0.01) {
        bg = parsed
        break
      }
    }

    const rect = target.getBoundingClientRect ? target.getBoundingClientRect() : null
    const viewport = window.innerWidth || 1200
    const match = sanitizeMatch({
      fontFamily: style.fontFamily,
      fontSize,
      lineHeight,
      color: (parseColor(style.color) || {}).hex || '#e6e8ee',
      bg: bg ? bg.hex : '#0e1016',
      bgAlpha: bg ? Math.round(bg.alpha * 100) : 34,
      // 「限制区域」：正文列自己的左右边界，浮条照抄这两条边。
      left: rect ? Math.max(0, Math.round(rect.left)) : 0,
      right: rect ? Math.max(0, Math.round(viewport - rect.right)) : 0,
      measuredAt: Date.now(),
    })
    return match
  }

  /** 只认 #rgb / #rrggbb，别的（含手输的乱码）一律退回旧值。 */
  function normalizeHex(value, fallback) {
    const text = String(value || '').trim()
    const short = /^#?([0-9a-f]{3})$/i.exec(text)
    if (short) return '#' + short[1].split('').map((c) => c + c).join('').toLowerCase()
    const long = /^#?([0-9a-f]{6})$/i.exec(text)
    if (long) return '#' + long[1].toLowerCase()
    return fallback
  }

  /** #abc + 0–100 的浓度 → rgba()，给 CSS 变量用。 */
  function tintOf(hex, alphaPercent) {
    const full = normalizeHex(hex, '#000000').slice(1)
    const num = Number.parseInt(full, 16)
    const r = (num >> 16) & 255
    const g = (num >> 8) & 255
    const b = num & 255
    const alpha = clamp(alphaPercent, 0, 100) / 100
    return `rgba(${r}, ${g}, ${b}, ${Number(alpha.toFixed(3))})`
  }

  function saveSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
    } catch {
      /* 存不进去不影响阅读 */
    }
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value))
  }

  /* ---------------------------------------------------------------- idb */

  let dbPromise = null

  function openDb() {
    if (dbPromise) return dbPromise
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION)
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains(STORE_META)) db.createObjectStore(STORE_META, { keyPath: 'id' })
        if (!db.objectStoreNames.contains(STORE_TEXT)) db.createObjectStore(STORE_TEXT, { keyPath: 'id' })
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    return dbPromise
  }

  async function dbPut(store, value) {
    const db = await openDb()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite')
      tx.objectStore(store).put(value)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  }

  async function dbGet(store, key) {
    const db = await openDb()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readonly')
      const request = tx.objectStore(store).get(key)
      request.onsuccess = () => resolve(request.result || null)
      request.onerror = () => reject(request.error)
    })
  }

  async function dbAll(store) {
    const db = await openDb()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readonly')
      const request = tx.objectStore(store).getAll()
      request.onsuccess = () => resolve(request.result || [])
      request.onerror = () => reject(request.error)
    })
  }

  async function dbDel(store, key) {
    const db = await openDb()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite')
      tx.objectStore(store).delete(key)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  }

  /* -------------------------------------------------------------- 样式 */

  const STYLE = `
    :host { all: initial; display: block; --r-font: ${DEFAULT_FONT}; --r-fg: rgba(230, 232, 238, 0.74); --r-bg: rgba(14, 16, 22, 0.34); }
    :host([hidden]) { display: none; }
    * { box-sizing: border-box; }
    #bar {
      position: relative;
      margin: 0;
      width: 100%;
      padding: 10px 42px 6px 14px;
      border-radius: 0;
      background: var(--r-bg);
      color: var(--r-fg);
      font-family: var(--r-font);
      font-size: 13px;
      letter-spacing: 0.012em;
      pointer-events: none;
      -webkit-font-smoothing: antialiased;
      text-rendering: optimizeLegibility;
      transition: opacity 120ms linear;
    }
    #bar[hidden] { display: none; }
    /* 这一页就是面板里的一段正文：没有浮条、没有圆角、没有外边距。 */
    :host([data-in-tab="1"]) { position: static; inset: auto; width: 100%; }
    :host([data-in-tab="1"]) #bar { width: 100%; margin: 0; border-radius: 0; background: transparent; padding: 10px 14px 4px; }
    :host([data-in-tab="1"]) #hud { opacity: 0.55; }
    #view {
      overflow: hidden;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      word-break: break-word;
      text-align: left;
      font-family: var(--r-font);
    }
    #view.intro {
      color: var(--r-fg); opacity: 0.68;
      font-size: 12px;
      line-height: 1.7;
      white-space: pre-line;
    }
    #hud {
      position: absolute;
      right: 9px;
      bottom: 3px;
      font-size: 10px;
      line-height: 1.2;
      color: rgba(226, 232, 240, 0.38);
      letter-spacing: 0.06em;
      transition: opacity 200ms linear;
      opacity: 0;
      font-variant-numeric: tabular-nums;
    }
    #grip {
      position: absolute;
      right: 0;
      bottom: 0;
      width: 30px;
      height: 26px;
      pointer-events: auto;
      cursor: pointer;
      opacity: 0;
      transition: opacity 120ms linear;
      background: radial-gradient(circle at 78% 78%, rgba(255,255,255,0.4), rgba(255,255,255,0.12) 44%, transparent 46%);
    }
    #bar:hover #grip { opacity: 0.55; }
    #bar.mode { box-shadow: inset 2px 0 0 rgba(120, 190, 255, 0.55); }

    #panel { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; pointer-events: auto; }
    #panel[hidden] { display: none; }
    #mask { position: absolute; inset: 0; background: rgba(6, 8, 12, 0.55); }
    #card {
      position: relative;
      width: min(620px, calc(100vw - 48px));
      max-height: min(78vh, 720px);
      display: flex;
      flex-direction: column;
      background: #171a21;
      color: #e6e9ef;
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 14px;
      box-shadow: 0 24px 70px rgba(0, 0, 0, 0.55);
      font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;
      font-size: 13px;
      overflow: hidden;
    }
    #card header { display: flex; align-items: center; gap: 8px; padding: 14px 16px 10px; }
    #card h1 { margin: 0; font-size: 14px; font-weight: 600; letter-spacing: 0.02em; flex: 1; }
    #card button {
      font: inherit;
      color: inherit;
      background: rgba(255,255,255,0.06);
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 8px;
      padding: 5px 10px;
      cursor: pointer;
    }
    #card button:hover { background: rgba(255,255,255,0.12); }
    #card button.primary { background: #2b6cd4; border-color: #2b6cd4; color: #fff; }
    #card button.primary:hover { background: #3478e6; }
    #card button.ghost { background: transparent; }
    #card .import { display: flex; align-items: center; gap: 10px; padding: 0 16px 12px; }
    #card .import .hint { color: rgba(230,233,239,0.42); font-size: 12px; }
    #card.drop { outline: 2px dashed rgba(90, 160, 255, 0.7); outline-offset: -8px; }
    #list { flex: 1; overflow: auto; padding: 4px 10px 10px; }
    .book { display: flex; align-items: center; gap: 10px; padding: 9px 10px; border-radius: 9px; }
    .book:hover { background: rgba(255,255,255,0.05); }
    .book .main { flex: 1; min-width: 0; cursor: pointer; }
    .book .title { font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .book .sub { font-size: 11px; color: rgba(230,233,239,0.4); margin-top: 3px; }
    .book.active .title { color: #7fb6ff; }
    .empty { padding: 22px 10px; text-align: center; color: rgba(230,233,239,0.38); font-size: 12px; }
    #card section { border-top: 1px solid rgba(255,255,255,0.07); padding: 10px 16px 14px; }
    #card .row { display: flex; align-items: center; gap: 10px; margin: 6px 0; }
    #card .row label { width: 82px; color: rgba(230,233,239,0.62); font-size: 12px; }
    #card .row input[type=range] { flex: 1; accent-color: #2b6cd4; }
    #card .row input[type=color] { width: 40px; height: 22px; padding: 0; border: 1px solid rgba(255,255,255,0.18); border-radius: 5px; background: transparent; cursor: pointer; flex: none; }
    #card .row select { flex: 1; min-width: 0; font: inherit; font-size: 12px; color: #e6e9ef; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12); border-radius: 6px; padding: 3px 6px; cursor: pointer; }
    #card .row input:disabled, #card .row select:disabled { opacity: 0.4; cursor: not-allowed; }
    #card .row button#set-match { flex: none; }
    #card .row output { width: 42px; text-align: right; font-size: 12px; color: rgba(230,233,239,0.55); font-variant-numeric: tabular-nums; }
    #card .keys { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
    .keychip { font-size: 11px; padding: 4px 8px; border-radius: 7px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.08); cursor: pointer; color: rgba(230,233,239,0.7); }
    .keychip b { color: #9fc4ff; font-weight: 600; }
    .keychip.rec { border-color: #2b6cd4; color: #9fc4ff; }
    #card footer { padding: 9px 16px 12px; font-size: 11px; color: rgba(230,233,239,0.35); border-top: 1px solid rgba(255,255,255,0.07); }
    #toast {
      position: fixed;
      left: 50%;
      transform: translateX(-50%);
      bottom: 26px;
      max-width: min(560px, calc(100vw - 40px));
      padding: 7px 13px;
      border-radius: 9px;
      background: rgba(18, 20, 26, 0.92);
      border: 1px solid rgba(255,255,255,0.09);
      color: rgba(232,236,244,0.9);
      font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;
      font-size: 12px;
      pointer-events: none;
      opacity: 0;
      transition: opacity 160ms linear;
    }
    #toast.on { opacity: 1; }
  `

  const MARKUP = `
    <div id="bar" hidden>
      <div id="view"></div>
      <div id="hud"></div>
      <div id="grip" title="速记 · 滚轮翻页"></div>
    </div>
    <div id="panel" hidden>
      <div id="mask"></div>
      <div id="card">
        <header>
          <h1>书库</h1>
          <button id="btn-close" class="ghost">关闭</button>
        </header>
        <div class="import">
          <button id="btn-pick" class="primary">导入 txt / epub</button>
          <span class="hint">也可以直接把文件拖进来</span>
          <input id="file" type="file" accept=".txt,.epub,text/plain,application/epub+zip" multiple hidden>
        </div>
        <div id="list"></div>
        <section>
          <div class="row"><label>自动行数</label><input id="set-autolines" type="checkbox"><span class="hint">面板有多高就显示几行（关掉才用下面的固定值）</span></div>
          <div class="row"><label>显示行数</label><input id="set-lines" type="range" min="2" max="40" step="1"><output id="out-lines"></output></div>
          <div class="row"><label>字号</label><input id="set-font" type="range" min="10" max="24" step="1"><output id="out-font"></output></div>
          <div class="row"><label>行距</label><input id="set-lineheight" type="range" min="1.1" max="2.6" step="0.05"><output id="out-lineheight"></output></div>
          <div class="row"><label>字体</label><select id="set-family"></select></div>
          <div class="row"><label>跟随页面</label><button id="set-match" class="ghost">跟对话页完全一致</button><span class="hint" id="match-state"></span></div>
          <div class="row"><label>不透明度</label><input id="set-opacity" type="range" min="20" max="100" step="2"><output id="out-opacity"></output></div>
          <div class="row"><label>文字颜色</label><input id="set-color" type="color"><span class="hint">随便挑，越接近背景越难被看出来</span></div>
          <div class="row"><label>背景颜色</label><input id="set-bg" type="color"><span class="hint">跟着主题走最自然：深色用 #0e1016，浅色用 #ffffff</span></div>
          <div class="row"><label>背景浓度</label><input id="set-bgalpha" type="range" min="0" max="100" step="2"><output id="out-bgalpha"></output></div>
          <div class="row"><label>失焦隐藏</label><input id="set-blur" type="checkbox"><span class="hint">切走窗口时自动收起</span></div>
          <div class="keys" id="keys"></div>
        </section>
        <footer>Esc 立刻收起 · 点键位可以改成自己的组合</footer>
      </div>
    </div>
    <div id="toast"></div>
  `

  /* ------------------------------------------------------------ 运行时状态 */

  let settings = loadSettings()
  const state = {
    book: null, // meta
    segments: [],
    seg: 0,
    top: 0,
    frac: 0,
  }
  let host, shadow, bar, view, hud, grip, panel, list, keysBox, toastEl, fileInput
  let panelOpen = false
  let autoHidden = false
  let recording = null
  let toastTimer = 0
  let persistTimer = 0
  let placeTimer = 0

  /** 谁在看着这块文字（底栏 tab 会订阅）：翻页、换书、开关都要通知它重画。 */
  const watchers = new Set()

  function notify() {
    for (const fn of watchers) {
      try {
        fn()
      } catch {
        /* 一个订阅者坏了不连累别的 */
      }
    }
  }

  function subscribe(fn) {
    if (typeof fn !== 'function') return () => {}
    watchers.add(fn)
    return () => watchers.delete(fn)
  }

  function $(id) {
    return shadow ? shadow.getElementById(id) : null
  }

  /* --------------------------------------------------------------- 基础量 */

  function lineHeightPx() {
    return Math.round(effectiveFontSize() * effectiveLineHeight())
  }

  /** 跟随页面时全用页面量到的值，否则全用设置里的值——不做一半一半的混合。 */
  function matching() {
    return settings.matchPage && settings.match ? settings.match : null
  }

  function effectiveFontSize() {
    const match = matching()
    return match ? match.fontSize : settings.fontSize
  }

  function effectiveLineHeight() {
    const match = matching()
    return match ? match.lineHeight : settings.lineHeight
  }

  function effectiveFontFamily() {
    const match = matching()
    if (match && match.fontFamily) return match.fontFamily
    return settings.fontFamily || DEFAULT_FONT
  }

  function effectiveColor() {
    const match = matching()
    return match ? match.color : settings.color
  }

  function effectiveBg() {
    const match = matching()
    return match ? { hex: match.bg, alpha: match.bgAlpha } : { hex: settings.bg, alpha: settings.bgAlpha }
  }

  function stepPx() {
    return linesNow() * lineHeightPx()
  }

  /**
   * 面板有多高就显示几行：拿这一页所在容器的实际高度算，减去上下的内边距，
   * 余数直接丢弃（宁可少半行，也不让最后一行被切掉）。
   * 量不到的时候（比如刚搬进来那一帧）退回手动的行数，不会闪。
   */
  function linesNow() {
    if (!settings.autoLines) return settings.lines
    const height = panelInnerHeight()
    if (!height) return settings.lines
    const lines = Math.floor((height - BAR_CHROME_PX) / lineHeightPx())
    return clamp(lines, 1, 200)
  }

  /** 这一页在面板里能用的高度（像素）；不在面板里、或者还没排版就返回 0。 */
  function panelInnerHeight() {
    if (!inPanel() || !host) return 0
    const box = host.parentElement
    if (!box) return 0

    const measure = (node) => {
      let height = 0
      try {
        const rect = node.getBoundingClientRect()
        height = rect && rect.height > 0 ? rect.height : 0
      } catch {
        height = 0
      }
      return height || node.clientHeight || 0
    }

    // tab 那一层通常撑满面板；它自己的高度可能来自 content，所以要往上找到真正有高度的祖先。
    let avail = measure(box)
    let node = box
    for (let depth = 0; depth < 6; depth += 1) {
      const parent = node.parentElement
      if (!parent) break
      const height = parent.clientHeight || measure(parent)
      if (height > 140 && height > avail + 24) {
        let offset = 0
        try {
          offset = node.getBoundingClientRect().top - parent.getBoundingClientRect().top
        } catch {
          offset = 0
        }
        let padBottom = 0
        try {
          padBottom = parseFloat(getComputedStyle(parent).paddingBottom) || 0
        } catch {
          padBottom = 0
        }
        avail = Math.max(avail, height - offset - padBottom)
        break
      }
      node = parent
    }
    return avail > 40 ? avail : 0
  }

  function maxScroll() {
    return Math.max(0, view.scrollHeight - view.clientHeight)
  }

  function applySizing() {
    const bg = effectiveBg()
    view.style.fontSize = effectiveFontSize() + 'px'
    view.style.lineHeight = lineHeightPx() + 'px'
    view.style.height = stepPx() + 'px'
    view.style.fontFamily = effectiveFontFamily()
    bar.style.opacity = String(settings.opacity / 100)
    host.style.setProperty('--r-font', effectiveFontFamily())
    host.style.setProperty('--r-fg', tintOf(effectiveColor(), 74))
    host.style.setProperty('--r-bg', tintOf(bg.hex, bg.alpha))
  }

  /* --------------------------------------------- 跟随对话页样式（一键一致） */

  /** 重量一次页面样式；follow 为真时顺手把「跟随」打开。 */
  function refreshMatch(options) {
    const opts = options || {}
    const measured = measurePage()
    if (!measured) {
      if (opts.toast !== false) toast('没找到对话区，先随便发一句话再看')
      return false
    }
    settings.match = measured
    if (opts.follow !== false) settings.matchPage = true
    saveSettings()
    applySizing()
    queuePlace()
    paint({ frac: state.frac, snap: true })
    renderStyleControls()
    if (opts.toast !== false) toast('已跟对话页对齐')
    return true
  }

  /** 关掉「跟随」，回到自己的字号 / 行距 / 颜色。 */
  function unMatch() {
    settings.matchPage = false
    saveSettings()
    applySizing()
    queuePlace()
    paint({ frac: state.frac, snap: true })
    renderStyleControls()
  }

  /* --------------------------------------------------- 只住在底部面板里 */

  /**
   * 这条带子只有一个家：dsh-better-sidebar 的底部面板（`＋` →「速记」）。
   * 面板没开、切走了、或者根本没装那个插件，它就**完全不画**——
   * 不会变成浮窗贴到输入框上方，也不会在页面上留任何痕迹。
   */
  function inPanel() {
    return Boolean(host && host.dataset.inTab === '1')
  }

  let boxObserver = null

  /** 面板被拖着改高度时，自动行数要跟着变：盯住这一页的容器。 */
  function watchPanelBox() {
    if (typeof ResizeObserver !== 'function' || !inPanel()) return
    const box = host.parentElement
    if (!box) return
    if (boxObserver && boxObserver.__box === box) return
    if (boxObserver) boxObserver.disconnect()
    boxObserver = new ResizeObserver(() => {
      applySizing()
      if (hasBook()) paint({ frac: state.frac, snap: true })
      if (panelOpen) syncSettingsControls()
    })
    boxObserver.__box = box
    try {
      boxObserver.observe(box)
    } catch {
      /* 某些环境不给观察，退回手动行数 */
    }
  }

  function stopPanelBox() {
    if (!boxObserver) return
    try {
      boxObserver.disconnect()
    } catch {
      /* 忽略 */
    }
    boxObserver = null
  }

  function applyVisibility() {
    if (!host) return
    // 还没书的时候，第一眼看到的那一页要自己说明怎么导入（只在面板里说）。
    if (inPanel() && !hasBook()) maybeIntro()
    const live = inPanel() && Boolean(bar) && !bar.hidden
    host.hidden = !live
    host.style.display = live ? '' : 'none'
    if (live) watchPanelBox()
    else stopPanelBox()
  }

  /** 兼容老调用点：以前这里是算浮窗位置，现在只是把「该不该画」同步一次。 */
  function place() {
    applyVisibility()
  }

  let placeQueued = false

  function queuePlace() {
    if (placeQueued) return
    placeQueued = true
    const run = () => {
      placeQueued = false
      applyVisibility()
    }
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run)
    else setTimeout(run, 16)
  }

  /* --------------------------------------------------------------- 渲染 */

  function currentSegment() {
    return state.segments[state.seg] || null
  }

  function percentOfBook() {
    const total = state.segments.length || 1
    return clamp((state.seg + state.frac) / total, 0, 1)
  }

  function updateHud(flash) {
    const segment = currentSegment()
    if (!segment) {
      hud.textContent = ''
      return
    }
    const percent = Math.round(percentOfBook() * 100)
    hud.textContent = `${percent}% · ${state.seg + 1}/${state.segments.length}`
    if (flash) {
      hud.style.opacity = '1'
      clearTimeout(updateHud.timer)
      updateHud.timer = setTimeout(() => {
        hud.style.opacity = '0'
      }, 1500)
    }
  }

  /** 把当前段文字放进 view，并恢复到指定位置（默认按 frac 还原）。 */
  function paint(options) {
    const opts = options || {}
    const segment = currentSegment()
    if (!segment) {
      view.textContent = ''
      return
    }
    if (view.textContent !== segment.text) view.textContent = segment.text
    const max = maxScroll()
    let target = 0
    if (typeof opts.top === 'number') target = opts.top
    else if (typeof opts.frac === 'number') target = opts.frac * max
    else target = state.frac * max
    const step = stepPx()
    if (opts.snap && step > 0) target = Math.round(target / step) * step
    view.scrollTop = clamp(target, 0, max)
    state.top = view.scrollTop
    state.frac = max > 0 ? state.top / max : 0
    updateHud(true)
    notify()
  }

  function goSegment(index, anchor) {
    const target = clamp(index, 0, state.segments.length - 1)
    state.seg = target
    state.frac = anchor === 'end' ? 1 : 0
    paint({ frac: state.frac })
    persistPosition()
  }

  /* --------------------------------------------------------------- 翻页 */

  function hasBook() {
    return !!(state.book && state.segments.length)
  }

  function nextPage() {
    if (!hasBook()) return hintNoBook()
    if (!inPanel()) openPanelTab({ toast: true })
    try {
      const before = view.scrollTop
      const max = maxScroll()
      if (before >= max - 0.5) {
        if (state.seg < state.segments.length - 1) {
          goSegment(state.seg + 1, 'start')
          return
        }
        updateHud(true)
        return
      }
      view.scrollTop = Math.min(max, before + stepPx())
      state.top = view.scrollTop
      state.frac = max > 0 ? state.top / max : 0
      updateHud(true)
      persistPosition()
    } finally {
      // 底栏 tab 只看订阅，不轮询：每次翻页（包括到头没动）都要通知它。
      notify()
    }
  }

  function prevPage() {
    if (!hasBook()) return hintNoBook()
    if (!inPanel()) openPanelTab({ toast: true })
    try {
      const before = view.scrollTop
      if (before <= 0.5) {
        if (state.seg > 0) {
          goSegment(state.seg - 1, 'end')
          return
        }
        updateHud(true)
        return
      }
      view.scrollTop = Math.max(0, before - stepPx())
      state.top = view.scrollTop
      const max = maxScroll()
      state.frac = max > 0 ? state.top / max : 0
      updateHud(true)
      persistPosition()
    } finally {
      notify()
    }
  }

  function hintNoBook() {
    toast(`还没有书：按 ${bindingLabel(settings.keys.lib)} 打开书库`)
  }

  /* --------------------------------------------------------------- 持久化 */

  function persistPosition() {
    if (!state.book) return
    clearTimeout(persistTimer)
    persistTimer = setTimeout(() => {
      try {
        localStorage.setItem(
          POS_PREFIX + state.book.id,
          JSON.stringify({ seg: state.seg, frac: state.frac, ts: Date.now() }),
        )
      } catch {
        /* 配额满了就放弃这一页的进度 */
      }
    }, 350)
  }

  function readPosition(id) {
    try {
      const raw = localStorage.getItem(POS_PREFIX + id)
      if (!raw) return { seg: 0, frac: 0 }
      const saved = JSON.parse(raw)
      return { seg: Number.isFinite(saved.seg) ? saved.seg : 0, frac: Number.isFinite(saved.frac) ? saved.frac : 0 }
    } catch {
      return { seg: 0, frac: 0 }
    }
  }

  /* --------------------------------------------------------------- 显示 */

  /** 面板那一页的开 / 关由 lib/client.js 里的桥子提供（没装 dsh-better-sidebar 就没有）。 */
  function panelBridge() {
    return globalThis.__dshStealthPanel
  }

  /** 把「速记」那一页在底部面板里打开。面板没开就顺带把面板展开。 */
  function openPanelTab(options) {
    const bridge = panelBridge()
    const quiet = options && options.toast === false
    if (!bridge || typeof bridge.open !== 'function') {
      if (!quiet) toast('这条带子只在底部面板里显示，需要 dsh-better-sidebar 的「速记」页')
      return false
    }
    try {
      bridge.open()
      return true
    } catch {
      return false
    }
  }

  function closePanelTab() {
    const bridge = panelBridge()
    if (!bridge || typeof bridge.close !== 'function') return false
    try {
      bridge.close()
      return true
    } catch {
      return false
    }
  }

  function setVisible(visible, silent) {
    settings.visible = !!visible
    saveSettings()
    if (!hasBook()) {
      bar.hidden = true
      applyVisibility()
      if (!silent) toast('还没有书：按 Ctrl+Alt+O 打开书库')
      return
    }
    bar.hidden = !settings.visible
    if (settings.visible) {
      applySizing()
      paint({ frac: state.frac })
      // 唯一能显示的地方就是面板里：没开就去开。
      if (!inPanel()) openPanelTab({ toast: !silent })
    }
    applyVisibility()
    notify()
  }

  function toggleVisible() {
    if (!bar.hidden && settings.visible) setVisible(false)
    else setVisible(true)
  }

  /**
   * 装好之后的第一次、手里又还没有书：面板里的那一页会自己说明怎么导入，
   * 这里只在**已经在面板里**时补两句快捷键提示，绝不再往页面上浮东西。
   */
  function maybeIntro() {
    if (hasBook() || !inPanel()) return
    try {
      if (localStorage.getItem(INTRO_KEY)) return
      localStorage.setItem(INTRO_KEY, '1')
    } catch {
      return
    }
    bar.hidden = false
    applyVisibility()
    view.classList.add('intro')
    view.textContent =
      '把 txt / epub 拖进窗口，或者按 Ctrl+Alt+O 打开书库\n' +
      'Ctrl+Alt+J / K 翻页 · Ctrl+Alt+H 收起 / 展开 · Esc 立刻收起'
    clearTimeout(maybeIntro.timer)
    maybeIntro.timer = setTimeout(() => {
      view.classList.remove('intro')
      view.textContent = ''
      if (!hasBook()) {
        bar.hidden = true
        applyVisibility()
      }
    }, 7000)
  }

  /* --------------------------------------------------------------- 书库 */

  async function openBook(id, options) {
    const reveal = !options || options.reveal !== false
    const meta = await dbGet(STORE_META, id)
    const text = await dbGet(STORE_TEXT, id)
    if (!meta || !text || !Array.isArray(text.segments) || !text.segments.length) {
      toast('这本书的数据不见了，请重新导入')
      return
    }
    state.book = meta
    state.segments = text.segments
    const position = readPosition(id)
    state.seg = clamp(position.seg, 0, state.segments.length - 1)
    state.frac = clamp(position.frac, 0, 1)
    settings.lastId = id
    if (reveal) settings.visible = true
    saveSettings()
    applySizing()
    paint({ frac: state.frac })
    bar.hidden = !settings.visible
    place()
    renderList()
    notify()
  }

  async function importFiles(fileList) {
    const files = Array.from(fileList || []).filter((f) => /\.(txt|epub|text)$/i.test(f.name) || /text\/plain|epub/i.test(f.type))
    if (!files.length) {
      toast('只认 .txt 和 .epub')
      return
    }
    for (const file of files) {
      try {
        toast('正在解析：' + file.name, 3000)
        const buffer = await file.arrayBuffer()
        const format = core.sniffFormat(buffer, file.name)
        let parsed
        if (format === 'epub') {
          parsed = await core.parseEpub(buffer)
        } else {
          const text = core.normalizeText(core.decodeBytes(buffer))
          if (!text) throw new Error('文件是空的')
          parsed = { title: '', author: '', segments: core.splitChapters(text) }
        }
        const fallbackTitle = file.name.replace(/\.[^.]+$/, '')
        const title = String(parsed.title || '').trim() || fallbackTitle
        const id = 'bk' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
        const meta = {
          id,
          title,
          author: parsed.author || '',
          format,
          added: Date.now(),
          chars: parsed.segments.reduce((sum, segment) => sum + segment.text.length, 0),
          segCount: parsed.segments.length,
          bytes: buffer.byteLength,
        }
        await dbPut(STORE_TEXT, { id, segments: parsed.segments })
        await dbPut(STORE_META, meta)
        await openBook(id)
        toast(`已导入《${title}》· ${meta.segCount} 段`, 2600)
        renderList()
      } catch (err) {
        toast('导入失败：' + (err && err.message ? err.message : String(err)), 5000)
      }
    }
  }

  async function removeBook(id) {
    await dbDel(STORE_META, id)
    await dbDel(STORE_TEXT, id)
    try {
      localStorage.removeItem(POS_PREFIX + id)
    } catch {
      /* ignore */
    }
    if (state.book && state.book.id === id) {
      state.book = null
      state.segments = []
      state.seg = 0
      state.frac = 0
      view.textContent = ''
      bar.hidden = true
      settings.lastId = ''
      saveSettings()
    }
    renderList()
  }

  async function renderList() {
    if (!list) return
    let books = []
    try {
      books = await dbAll(STORE_META)
    } catch {
      books = []
    }
    books.sort((a, b) => (b.added || 0) - (a.added || 0))
    list.textContent = ''
    if (!books.length) {
      const empty = document.createElement('div')
      empty.className = 'empty'
      empty.textContent = '书库是空的，导入一本 .txt 或 .epub 开始看'
      list.appendChild(empty)
      return
    }
    for (const book of books) {
      const row = document.createElement('div')
      row.className = 'book' + (state.book && state.book.id === book.id ? ' active' : '')

      const main = document.createElement('div')
      main.className = 'main'

      const title = document.createElement('div')
      title.className = 'title'
      title.textContent = book.title || '(未命名)'

      const position = readPosition(book.id)
      const total = Math.max(1, book.segCount || 1)
      const percent = Math.round(clamp((position.seg + position.frac) / total, 0, 1) * 100)
      const sub = document.createElement('div')
      sub.className = 'sub'
      sub.textContent = `${(book.format || 'txt').toUpperCase()} · ${formatSize(book)} · ${book.segCount || 1} 段 · 已读 ${percent}%`

      main.append(title, sub)
      main.addEventListener('click', () => {
        openBook(book.id).then(() => closePanel())
      })

      const remove = document.createElement('button')
      remove.className = 'ghost'
      remove.textContent = '删除'
      remove.addEventListener('click', (event) => {
        event.stopPropagation()
        removeBook(book.id)
      })

      row.append(main, remove)
      list.appendChild(row)
    }
  }

  function formatSize(book) {
    const bytes = book.bytes || (book.chars || 0) * 2
    if (bytes > 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB'
    return Math.max(1, Math.round(bytes / 1024)) + ' KB'
  }

  function openPanel() {
    panelOpen = true
    panel.hidden = false
    renderList()
    syncSettingsControls()
    renderKeyChips()
  }

  function closePanel() {
    panelOpen = false
    recording = null
    panel.hidden = true
    syncSettingsControls()
  }

  function syncSettingsControls() {
    const lines = $('set-lines')
    if (!lines) return
    const match = matching()
    const auto = $('set-autolines')
    if (auto) auto.checked = Boolean(settings.autoLines)
    lines.value = String(settings.lines)
    lines.disabled = Boolean(settings.autoLines)
    $('out-lines').textContent = settings.autoLines ? '自动 · 现在 ' + linesNow() + ' 行' : settings.lines + ' 行'
    $('set-font').value = String(effectiveFontSize())
    $('out-font').textContent = Number(effectiveFontSize().toFixed(1)) + 'px'
    $('set-lineheight').value = String(effectiveLineHeight())
    $('out-lineheight').textContent = Number(effectiveLineHeight().toFixed(2)) + '×'
    const family = $('set-family')
    if (family) family.value = match ? '' : settings.fontFamily
    family.disabled = !!match
    $('set-font').disabled = !!match
    $('set-lineheight').disabled = !!match
    $('set-color').disabled = !!match
    $('set-bg').disabled = !!match
    $('set-bgalpha').disabled = !!match
    $('set-opacity').value = String(settings.opacity)
    $('out-opacity').textContent = settings.opacity + '%'
    $('set-color').value = effectiveColor()
    const bg = effectiveBg()
    $('set-bg').value = bg.hex
    $('set-bgalpha').value = String(bg.alpha)
    $('out-bgalpha').textContent = bg.alpha + '%'
    $('set-blur').checked = !!settings.hideOnBlur
    const button = $('set-match')
    if (button) button.textContent = match ? '取消跟随' : '跟对话页完全一致'
    const note = $('match-state')
    if (note) {
      note.textContent = match
        ? `已跟随：${Number(match.fontSize.toFixed(1))}px / ${Number(match.lineHeight.toFixed(2))}× / ${match.left}–${match.right}px`
        : '把字号、行距、字体、颜色、左右宽度一次对齐对话区'
    }
    applySizing()
  }

  function renderStyleControls() {
    syncSettingsControls()
  }

  /** 字体下拉的选项只灌一次；值仍是 settings.fontFamily。 */
  function fillFontOptions() {
    const select = $('set-family')
    if (!select || select.dataset.filled === '1') return
    select.textContent = ''
    for (const preset of FONT_PRESETS) {
      const option = document.createElement('option')
      option.value = preset.value
      option.textContent = preset.label
      select.appendChild(option)
    }
    select.dataset.filled = '1'
  }

  function bindingLabel(binding) {
    return String(binding || '')
      .replace(/Key([A-Z])/g, '$1')
      .replace(/Digit(\d)/g, '$1')
      .replace(/ArrowUp/g, '↑')
      .replace(/ArrowDown/g, '↓')
      .replace(/ArrowLeft/g, '←')
      .replace(/ArrowRight/g, '→')
      .replace(/Space/g, 'Space')
      .replace(/\+/g, ' + ')
  }

  function renderKeyChips() {
    if (!keysBox) return
    keysBox.textContent = ''
    for (const action of ACTIONS) {
      const chip = document.createElement('span')
      chip.className = 'keychip' + (recording === action.id ? ' rec' : '')
      chip.dataset.action = action.id
      if (recording === action.id) {
        chip.textContent = '按下新的组合… (Esc 取消)'
      } else {
        chip.append(document.createTextNode(action.label + ' · '))
        const code = document.createElement('b')
        code.textContent = bindingLabel(settings.keys[action.id])
        chip.appendChild(code)
      }
      chip.addEventListener('click', () => {
        recording = recording === action.id ? null : action.id
        renderKeyChips()
      })
      keysBox.appendChild(chip)
    }
  }

  function describeEvent(event) {
    const parts = []
    if (event.ctrlKey) parts.push('Ctrl')
    if (event.altKey) parts.push('Alt')
    if (event.shiftKey) parts.push('Shift')
    if (event.metaKey) parts.push('Meta')
    parts.push(event.code || '')
    return parts.join('+')
  }

  /* --------------------------------------------------------------- toast */

  function toast(message, duration) {
    if (!toastEl) return
    toastEl.textContent = message
    toastEl.classList.add('on')
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => {
      toastEl.classList.remove('on')
    }, duration || 2000)
  }

  /* --------------------------------------------------------------- 键盘 */

  function isEditable(element) {
    if (!element || element.nodeType !== 1) return false
    const tag = element.tagName
    if (tag === 'TEXTAREA' || tag === 'SELECT') return true
    if (tag === 'INPUT') {
      const type = (element.getAttribute('type') || 'text').toLowerCase()
      return !['checkbox', 'radio', 'button', 'submit', 'range', 'file', 'color'].includes(type)
    }
    return element.isContentEditable === true || element.getAttribute('contenteditable') === 'true'
  }

  function parseBinding(binding) {
    const parts = String(binding || '').split('+')
    const code = parts.pop() || ''
    const flags = parts.map((part) => part.toLowerCase())
    return {
      code,
      ctrl: flags.includes('ctrl'),
      alt: flags.includes('alt'),
      shift: flags.includes('shift'),
      meta: flags.includes('meta'),
    }
  }

  function matches(event, binding) {
    const want = parseBinding(binding)
    if (!want.code || event.code !== want.code) return false
    return event.ctrlKey === want.ctrl && event.altKey === want.alt && event.shiftKey === want.shift && event.metaKey === want.meta
  }

  function onKeyDown(event) {
    if (event.isComposing) return

    if (recording) {
      event.preventDefault()
      event.stopPropagation()
      if (event.code === 'Escape') {
        recording = null
        renderKeyChips()
        return
      }
      if (!event.ctrlKey && !event.altKey && !event.metaKey) return
      settings.keys[recording] = describeEvent(event)
      recording = null
      saveSettings()
      renderKeyChips()
      return
    }

    // 书库打开时只认 Esc：别在面板里翻到后面的正文
    if (panelOpen) {
      if (event.code === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        closePanel()
      }
      return
    }

    const editable = isEditable(event.target) || isEditable(document.activeElement)

    const bindings = settings.keys
    // 带修饰键的组合即使焦点在输入框里也照常生效（Ctrl/Alt 不是打字）
    const modifierHeld = event.ctrlKey || event.altKey || event.metaKey
    if (!editable || modifierHeld) {
      if (matches(event, bindings.next)) {
        event.preventDefault()
        event.stopPropagation()
        nextPage()
        return
      }
      if (matches(event, bindings.prev)) {
        event.preventDefault()
        event.stopPropagation()
        prevPage()
        return
      }
    }

    if (matches(event, bindings.toggle)) {
      event.preventDefault()
      event.stopPropagation()
      toggleVisible()
      return
    }
    if (matches(event, bindings.lib)) {
      event.preventDefault()
      event.stopPropagation()
      if (panelOpen) closePanel()
      else openPanel()
      return
    }

    // 裸 Esc：收起文字带（最常用的「有人来了」）
    if (event.code === 'Escape' && !panelOpen && !editable && settings.visible && !bar.hidden) {
      event.preventDefault()
      event.stopPropagation()
      autoHidden = false
      setVisible(false, true)
    }
  }

  /* --------------------------------------------------------------- 装配 */

  function wire() {
    bar = $('bar')
    view = $('view')
    hud = $('hud')
    grip = $('grip')
    panel = $('panel')
    list = $('list')
    keysBox = $('keys')
    toastEl = $('toast')
    fileInput = $('file')

    $('btn-close').addEventListener('click', closePanel)
    $('mask').addEventListener('click', closePanel)
    $('btn-pick').addEventListener('click', () => fileInput.click())
    fileInput.addEventListener('change', () => {
      importFiles(fileInput.files)
      fileInput.value = ''
    })

    grip.addEventListener('click', () => {
      if (panelOpen) closePanel()
      else openPanel()
    })

    const card = $('card')
    card.addEventListener('dragover', (event) => {
      event.preventDefault()
      card.classList.add('drop')
    })
    card.addEventListener('dragleave', () => card.classList.remove('drop'))
    card.addEventListener('drop', (event) => {
      event.preventDefault()
      card.classList.remove('drop')
      if (event.dataTransfer && event.dataTransfer.files) importFiles(event.dataTransfer.files)
    })

    // 在文字带上滚轮 = 翻页
    const wheelTarget = $('bar')
    wheelTarget.addEventListener(
      'wheel',
      (event) => {
        if (!hasBook()) return
        event.preventDefault()
        if (Math.abs(event.deltaY) < 1) return
        if (event.deltaY > 0) nextPage()
        else prevPage()
      },
      { passive: false },
    )

    fillFontOptions()

    $('set-autolines').addEventListener('change', (event) => {
      settings.autoLines = Boolean(event.target.checked)
      saveSettings()
      applySizing()
      syncSettingsControls()
      paint({ frac: state.frac, snap: true })
    })
    $('set-lines').addEventListener('input', (event) => {
      settings.lines = Number(event.target.value)
      saveSettings()
      syncSettingsControls()
      paint({ frac: state.frac, snap: true })
    })
    $('set-font').addEventListener('input', (event) => {
      settings.fontSize = Number(event.target.value)
      saveSettings()
      syncSettingsControls()
      paint({ frac: state.frac, snap: true })
    })
    $('set-lineheight').addEventListener('input', (event) => {
      settings.lineHeight = clamp(Number(event.target.value) || 1.55, 1.1, 3)
      saveSettings()
      applySizing()
      syncSettingsControls()
      paint({ frac: state.frac, snap: true })
    })
    $('set-family').addEventListener('change', (event) => {
      settings.fontFamily = String(event.target.value || '')
      saveSettings()
      applySizing()
      paint({ frac: state.frac, snap: true })
    })
    $('set-match').addEventListener('click', () => {
      if (settings.matchPage) unMatch()
      else refreshMatch({ follow: true })
    })
    $('set-opacity').addEventListener('input', (event) => {
      settings.opacity = Number(event.target.value)
      saveSettings()
      syncSettingsControls()
    })
    $('set-blur').addEventListener('change', (event) => {
      settings.hideOnBlur = !!event.target.checked
      saveSettings()
    })
    $('set-color').addEventListener('input', (event) => {
      settings.color = normalizeHex(event.target.value, settings.color)
      saveSettings()
      applySizing()
    })
    $('set-bg').addEventListener('input', (event) => {
      settings.bg = normalizeHex(event.target.value, settings.bg)
      saveSettings()
      applySizing()
    })
    $('set-bgalpha').addEventListener('input', (event) => {
      settings.bgAlpha = clamp(Number(event.target.value), 0, 100)
      saveSettings()
      syncSettingsControls()
    })

    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('resize', () => {
      // 跟着页面对齐时，窗口一变就重量一次（不落盘，尺寸随窗口临时变，别写坏存储）。
      if (settings.matchPage) {
        const measured = measurePage()
        if (measured) settings.match = measured
      }
      applySizing()
      paint({ frac: state.frac, snap: true })
      place()
    })
    window.addEventListener('blur', () => {
      if (!settings.hideOnBlur || !settings.visible || panelOpen || bar.hidden || !hasBook()) return
      bar.hidden = true
      autoHidden = true
    })
    window.addEventListener('focus', () => {
      if (!autoHidden) return
      autoHidden = false
      if (settings.visible && hasBook()) {
        bar.hidden = false
        applyVisibility()
      }
    })

    // 定时器只干一件事：确保「不在面板里就绝不出现」这条规则没被别的东西破坏。
    placeTimer = setInterval(() => {
      if (!inPanel()) applyVisibility()
    }, 700)
  }

  /* ------------------------------------------- 给设置页用的同一个 settings */

  /**
   * DSH 设置页里的「隐蔽阅读器」是同一个页面里的另一个模块，和这条底栏共用一个
   * window、一份 localStorage。与其在两边各维护一套状态，不如把读写入口挂到
   * globalThis：设置页直接调，改完立刻重排、重画、落盘。
   */
  function exportApi() {
    globalThis.__dshReader = {
      version: 1,
      actions: ACTIONS.map((action) => ({ ...action })),
      defaults: clone(DEFAULT_SETTINGS),
      getSettings: () => clone(settings),
      setSettings(patch) {
        if (!patch || typeof patch !== 'object') return clone(settings)
        for (const key of ['lines', 'fontSize', 'opacity', 'bgAlpha']) {
          if (Number.isFinite(patch[key])) settings[key] = patch[key]
        }
        if (typeof patch.autoLines === 'boolean') settings.autoLines = patch.autoLines
        if (Number.isFinite(patch.lineHeight)) settings.lineHeight = patch.lineHeight
        if (typeof patch.fontFamily === 'string') settings.fontFamily = patch.fontFamily.slice(0, 200)
        if (typeof patch.matchPage === 'boolean') settings.matchPage = patch.matchPage
        if (typeof patch.color === 'string') settings.color = normalizeHex(patch.color, settings.color)
        if (typeof patch.bg === 'string') settings.bg = normalizeHex(patch.bg, settings.bg)
        if (typeof patch.hideOnBlur === 'boolean') settings.hideOnBlur = patch.hideOnBlur
        if (typeof patch.visible === 'boolean') settings.visible = patch.visible
        if (patch.keys && typeof patch.keys === 'object') {
          for (const action of ACTIONS) {
            const value = patch.keys[action.id]
            if (typeof value === 'string' && value) settings.keys[action.id] = value
          }
        }
        settings.lines = clamp(Math.round(settings.lines), 2, 40)
        settings.fontSize = clamp(Math.round(settings.fontSize), 10, 24)
        settings.lineHeight = clamp(Number(settings.lineHeight) || 1.55, 1.1, 3)
        settings.opacity = clamp(Math.round(settings.opacity), 20, 100)
        settings.bgAlpha = clamp(Math.round(settings.bgAlpha), 0, 100)
        if (settings.matchPage && !settings.match) refreshMatch({ toast: false })
        saveSettings()
        applySizing()
        syncSettingsControls()
        renderKeyChips()
        paint({ frac: state.frac, snap: true })
        place()
        return clone(settings)
      },
      resetSettings() {
        const lastId = settings.lastId
        Object.assign(settings, clone(DEFAULT_SETTINGS), { lastId })
        saveSettings()
        applySizing()
        syncSettingsControls()
        renderKeyChips()
        paint({ frac: state.frac, snap: true })
        place()
        return clone(settings)
      },
      /** 一键跟对话页完全一致（字号 / 行距 / 字体 / 颜色 / 左右宽度）。 */
      matchPage: () => refreshMatch({ follow: true }),
      unmatchPage: () => {
        unMatch()
        return clone(settings)
      },
      /** 当前量到的页面样式，没跟随时也会现量一份给设置页预览。 */
      measurePage: () => measurePage(),
      openLibrary: () => openPanel(),
      closeLibrary: () => closePanel(),
      toggleVisible: () => toggleVisible(),
      setVisible: (value) => setVisible(Boolean(value)),
      next: () => nextPage(),
      prev: () => prevPage(),
      toast: (message) => toast(message),
      hasBook: () => Boolean(state.book),
      subscribe,
      /** 底栏 tab 要的那个宿主元素：它把这个 div 搬进面板就成了内嵌阅读。 */
      hostElement: () => host || document.getElementById(HOST_ID),
      /** 把「速记」页在底部面板里打开 / 关掉（没装 dsh-better-sidebar 就没有这个能力）。 */
      openPanelTab: () => openPanelTab({ toast: true }),
      closePanelTab: () => closePanelTab(),
      /** tab 把宿主搬进搬出之后，叫一声让底栏重算「该不该画」。 */
      syncPresence: () => {
        applySizing()
        applyVisibility()
        if (hasBook()) paint({ frac: state.frac, snap: true })
      },
      /** 自动行数：面板现在这一页能放下几行。 */
      effectiveLines: () => linesNow(),
      inPanel: () => inPanel(),
      currentBook: () =>
        state.book
          ? {
              id: state.book.id,
              title: state.book.title || '',
              author: state.book.author || '',
              total: state.segments.length,
              index: state.seg,
            }
          : null,
    }
  }

  async function boot() {
    if (document.getElementById(HOST_ID)) return
    host = document.createElement('div')
    host.id = HOST_ID
    host.style.cssText = 'all:initial;display:none;pointer-events:none;'
    document.body.appendChild(host)
    shadow = host.attachShadow({ mode: 'open' })
    const style = document.createElement('style')
    style.textContent = STYLE
    shadow.appendChild(style)
    const holder = document.createElement('div')
    holder.innerHTML = MARKUP
    shadow.appendChild(holder)

    wire()
    exportApi()
    applySizing()
    renderKeyChips()
    applyVisibility()

    if (settings.lastId) {
      try {
        await openBook(settings.lastId, { reveal: false })
      } catch {
        /* 上次那本书没了就静默退出，等用户按快捷键 */
      }
    }

    maybeIntro()
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      boot().catch((err) => console.warn('[dsh-reader]', err))
    })
  } else {
    boot().catch((err) => console.warn('[dsh-reader]', err))
  }
})()
