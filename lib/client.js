/* dsh-stealth-reader — 浏览器半侧。
 *
 * 这一份是 DSH 设置里的一页「隐蔽阅读器」：显示状态、调行数/字号/透明度、
 * 改快捷键。它不是完整的 React 应用，宿主侧 `lib/index.js` 那条注入脚本才是
 * 真正画底栏的人；两者活在同一个 window，通过 globalThis.__dshReader 共用
 * 同一份 settings，所以这边改完那边立刻重排、重画。
 *
 * 模块格式照 DSH 的浏览器模块协议：注册一个 factory，实际副作用在物化时才跑。
 */
window.__ModuleLoader__.load({
  id: 'dsh-stealth-reader',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useRef, useCallback } = React

    const CLIENT_NAME = 'dsh-stealth-reader'
    const SETTINGS_KEY = 'dsh-reader:settings'

    /** 兜底默认值：万一底栏还没挂上（比如注入脚本被挡了），设置页自己也能站住。 */
    const FALLBACK = {
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
      keys: {
        toggle: 'Ctrl+Alt+KeyH',
        next: 'Ctrl+Alt+KeyJ',
        prev: 'Ctrl+Alt+KeyK',
        lib: 'Ctrl+Alt+KeyO',
        },
    }

    const ACTIONS = [
      { id: 'toggle', label: '显示 / 隐藏', hint: '让别人看不到，也让文字带回来' },
      { id: 'next', label: '下一页', hint: '整行往下翻，到段底自动进下一段' },
      { id: 'prev', label: '上一页', hint: '往回翻' },
      { id: 'lib', label: '打开书库', hint: '书目、导入、行数、字号' },
    ]

    const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

    /** 跟底栏 web/reader-ui.js 里的 FONT_PRESETS 保持一致。 */
    const FONT_PRESETS = [
      { value: '', label: '默认（界面字体）' },
      { value: '"PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif', label: '无衬线（黑体）' },
      { value: '"Songti SC", SimSun, "Noto Serif CJK SC", serif', label: '宋体（衬线）' },
      { value: '"Kaiti SC", KaiTi, STKaiti, serif', label: '楷体' },
      { value: 'ui-monospace, "Cascadia Code", Consolas, "Courier New", monospace', label: '等宽' },
    ]

    function api() {
      return typeof window !== 'undefined' ? window.__dshReader : undefined
    }

    /** 读设置：优先问底栏要，退而求其次读同一份 localStorage。 */
    function readSettings() {
      const live = api()
      if (live && typeof live.getSettings === 'function') {
        try {
          return live.getSettings()
        } catch {
          /* 落到下面 */
        }
      }
      const merged = JSON.parse(JSON.stringify(FALLBACK))
      try {
        const raw = window.localStorage.getItem(SETTINGS_KEY)
        if (raw) {
          const saved = JSON.parse(raw)
          if (saved && typeof saved === 'object') {
            for (const key of ['lines', 'fontSize', 'opacity', 'bgAlpha']) {
              if (Number.isFinite(saved[key])) merged[key] = saved[key]
            }
            if (typeof saved.autoLines === 'boolean') merged.autoLines = saved.autoLines
            if (Number.isFinite(saved.lineHeight)) merged.lineHeight = saved.lineHeight
            if (typeof saved.fontFamily === 'string') merged.fontFamily = saved.fontFamily
            if (typeof saved.matchPage === 'boolean') merged.matchPage = saved.matchPage
            if (saved.match && typeof saved.match === 'object') merged.match = saved.match
            if (typeof saved.color === 'string') merged.color = saved.color
            if (typeof saved.bg === 'string') merged.bg = saved.bg
            if (typeof saved.hideOnBlur === 'boolean') merged.hideOnBlur = saved.hideOnBlur
            if (saved.keys && typeof saved.keys === 'object') {
              for (const action of ACTIONS) {
                if (typeof saved.keys[action.id] === 'string' && saved.keys[action.id]) {
                  merged.keys[action.id] = saved.keys[action.id]
                }
              }
            }
          }
        }
      } catch {
        /* 坏数据回默认 */
      }
      return merged
    }

    /** 写设置：有底栏就交给它（会顺带重排重画），没有就直接落盘。 */
    function writeSettings(patch) {
      const live = api()
      if (live && typeof live.setSettings === 'function') {
        try {
          return live.setSettings(patch)
        } catch {
          /* 落到下面 */
        }
      }
      const next = { ...readSettings(), ...patch }
      if (patch.keys) next.keys = { ...readSettings().keys, ...patch.keys }
      try {
        window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(next))
      } catch {
        /* 存不进去也不影响 */
      }
      return next
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

    /** 与底栏的 describeEvent 保持逐字一致，否则录下来的组合按不出来。 */
    function describeEvent(event) {
      const parts = []
      if (event.ctrlKey) parts.push('Ctrl')
      if (event.altKey) parts.push('Alt')
      if (event.shiftKey) parts.push('Shift')
      if (event.metaKey) parts.push('Meta')
      parts.push(event.code || '')
      return parts.join('+')
    }

    /** 当前在读什么：挂载时先问一次，之后靠轮询跟着底栏的变化。 */
    function readBook() {
      const live = api()
      if (!live || typeof live.currentBook !== 'function') return null
      try {
        return live.currentBook() || null
      } catch {
        return null
      }
    }

    const styles = {
      wrap: { display: 'flex', flexDirection: 'column', gap: '18px', padding: '4px 2px 32px', maxWidth: '760px' },
      block: { display: 'flex', flexDirection: 'column', gap: '10px' },
      title: { fontSize: '13px', fontWeight: 600, opacity: 0.9, margin: 0 },
      row: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' },
      label: { fontSize: '13px', minWidth: '86px', opacity: 0.85 },
      value: { fontSize: '12px', opacity: 0.6, minWidth: '52px', fontVariantNumeric: 'tabular-nums' },
      slider: { flex: '1 1 200px', accentColor: 'currentColor', minWidth: '160px' },
      button: {
        fontSize: '12px',
        padding: '5px 11px',
        borderRadius: '7px',
        border: '1px solid rgba(127,127,127,0.35)',
        background: 'rgba(127,127,127,0.10)',
        color: 'inherit',
        cursor: 'pointer',
      },
      keyButton: {
        fontSize: '12px',
        padding: '5px 11px',
        borderRadius: '7px',
        border: '1px dashed rgba(127,127,127,0.45)',
        background: 'transparent',
        color: 'inherit',
        cursor: 'pointer',
        fontVariantNumeric: 'tabular-nums',
      },
      keyButtonRecording: {
        border: '1px solid rgba(96,165,250,0.9)',
        background: 'rgba(96,165,250,0.14)',
        color: 'inherit',
        fontSize: '12px',
        padding: '5px 11px',
        borderRadius: '7px',
        cursor: 'pointer',
      },
      hint: { fontSize: '12px', opacity: 0.55, margin: 0, lineHeight: 1.6 },
      status: { fontSize: '12px', opacity: 0.75, margin: 0, lineHeight: 1.7 },
    }

    function Slider(props) {
      return h(
        'div',
        { style: styles.row },
        h('span', { style: styles.label }, props.label),
        h('input', {
          type: 'range',
          min: props.min,
          max: props.max,
          step: Number.isFinite(props.step) && props.step > 0 ? props.step : 1,
          value: props.value,
          style: styles.slider,
          onChange: (event) => props.onChange(Number(event.target.value)),
        }),
        h('span', { style: styles.value }, props.text),
      )
    }

    function ColorField(props) {
      return h(
        'label',
        { style: { ...styles.row, cursor: 'pointer' } },
        h('span', { style: styles.label }, props.label),
        h('input', {
          type: 'color',
          value: props.value,
          onChange: (event) => props.onChange(event.target.value),
          style: {
            width: '42px',
            height: '24px',
            padding: 0,
            border: '1px solid currentColor',
            borderRadius: '6px',
            background: 'transparent',
            cursor: 'pointer',
          },
        }),
        h('span', { style: { ...styles.value, minWidth: '0', opacity: 0.55 } }, String(props.value || '').toUpperCase()),
      )
    }

    function Check(props) {
      return h(
        'label',
        { style: { ...styles.row, cursor: 'pointer', alignItems: 'flex-start' } },
        h('input', {
          type: 'checkbox',
          checked: Boolean(props.checked),
          onChange: (event) => props.onChange(event.target.checked),
          style: { marginTop: '2px', cursor: 'pointer' },
        }),
        h(
          'span',
          { style: { display: 'flex', flexDirection: 'column', gap: '2px', minWidth: '0' } },
          h('span', { style: styles.label }, props.label),
          props.hint ? h('span', { style: styles.hint }, props.hint) : null,
        ),
      )
    }

    function ReaderSettingsSection() {
      const [settings, setSettings] = useState(readSettings)
      const [recording, setRecording] = useState(null)
      const [notice, setNotice] = useState('')
      const [book, setBook] = useState(readBook)
      const noticeTimer = useRef(0)

      const flash = useCallback((message) => {
        setNotice(message)
        window.clearTimeout(noticeTimer.current)
        noticeTimer.current = window.setTimeout(() => setNotice(''), 2400)
      }, [])

      /* 底栏那边的状态（有没有书、读到第几段）随时在变，轻量轮询就够了。 */
      useEffect(() => {
        const tick = () => {
          const live = api()
          if (!live || typeof live.currentBook !== 'function') {
            setBook(null)
            return
          }
          try {
            setBook(live.currentBook())
          } catch {
            setBook(null)
          }
        }
        tick()
        const timer = window.setInterval(tick, 1500)
        return () => window.clearInterval(timer)
      }, [])

      /* 录制新组合键：捕获阶段吃掉事件，免得触发到底栏或输入框。 */
      useEffect(() => {
        if (!recording) return undefined
        const onKey = (event) => {
          event.preventDefault()
          event.stopPropagation()
          if (event.key === 'Escape') {
            setRecording(null)
            return
          }
          if (event.key === 'Shift' || event.key === 'Control' || event.key === 'Alt' || event.key === 'Meta') return
          const hasModifier = event.ctrlKey || event.altKey || event.metaKey
          if (!hasModifier) {
            flash('必须带 Ctrl 或 Alt，单独的字母键会抢走输入框')
            return
          }
          const binding = describeEvent(event)
          apply({ keys: { [recording]: binding } })
          setRecording(null)
          flash('已改为 ' + bindingLabel(binding))
        }
        window.addEventListener('keydown', onKey, true)
        return () => window.removeEventListener('keydown', onKey, true)
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [recording, settings])

      function apply(patch) {
        const next = writeSettings(patch)
        setSettings({ ...readSettings(), ...next, keys: (next && next.keys) || readSettings().keys })
      }

      function openLibrary() {
        const live = api()
        if (live && typeof live.openLibrary === 'function') {
          live.openLibrary()
          flash('书库已打开（在页面底部）')
        } else {
          flash('底栏还没起来，先刷新一次页面')
        }
      }

      function openPanel() {
        const live = api()
        if (!live || typeof live.openPanelTab !== 'function') return flash('底栏还没起来，先刷新一次页面')
        flash(live.openPanelTab() ? '已在底部面板里打开「速记」' : '需要 dsh-better-sidebar：阅读器只住在那个底部面板里')
      }

      function describeMatch(match) {
        if (!match || !Number.isFinite(match.fontSize)) return '还没量到，切到对话页面再点一次'
        return (
          Number(match.fontSize).toFixed(1) +
          'px · 行距 ' +
          Number(match.lineHeight).toFixed(2) +
          '× · 左右 ' +
          Math.round(match.left) +
          '/' +
          Math.round(match.right) +
          'px'
        )
      }

      /** 跟随不是「写一批数值」，而是让底栏自己现量一次页面——所以必须走它的方法。 */
      function toggleMatch() {
        const live = api()
        if (!live || typeof live.matchPage !== 'function') return flash('底栏还没起来，先刷新一次页面')
        if (settings.matchPage && typeof live.unmatchPage === 'function') {
          live.unmatchPage()
          setSettings(readSettings())
          return flash('已取消跟随，回到自己的字号与颜色')
        }
        const ok = live.matchPage()
        setSettings(readSettings())
        flash(ok === false ? '没找到对话区，先随便发一句话再点' : '已跟对话页完全一致')
      }

      const status = book
        ? `正在读《${book.title || '未命名'}》${book.author ? ' · ' + book.author : ''}，第 ${book.index + 1} / ${book.total} 段`
        : '还没有打开的书 — 把 txt / epub 拖到页面底部，或用下面的按钮打开书库'

      return h(
        'div',
        { style: styles.wrap },
        h(
          'div',
          { style: styles.block },
          h('h3', { style: styles.title }, '隐蔽阅读器'),
          h('p', { style: styles.status }, status),
          h(
            'div',
            { style: styles.row },
            h('button', { type: 'button', style: styles.button, onClick: openLibrary }, '打开书库'),
            h(
              'button',
              {
                type: 'button',
                style: styles.button,
                onClick: () => {
                  const live = api()
                  if (live && typeof live.toggleVisible === 'function') live.toggleVisible()
                  else flash('底栏还没起来，先刷新一次页面')
                },
              },
              '收起 / 展开底栏',
            ),
            h(
              'button',
              {
                type: 'button',
                style: styles.button,
                onClick: () => {
                  const live = api()
                  if (live && typeof live.next === 'function') live.next()
                  else flash('底栏还没起来，先刷新一次页面')
                },
              },
              '翻一页试试',
            ),
            h('button', { type: 'button', style: styles.button, onClick: openPanel }, '在底栏面板打开'),
          ),
          h(
            'p',
            { style: styles.hint },
            '阅读器只住在 dsh-better-sidebar 的底部面板里：＋ 菜单多一个「速记」页，收起面板它就不显示。',
          ),
        ),

        h(
          'div',
          { style: styles.block },
          h('h3', { style: styles.title }, '跟随对话页'),
          h(
            'p',
            { style: styles.hint },
            '一次把字体、字号、行距、文字颜色、背景浓度和左右宽度全部对齐对话区正文，',
            '看起来就是页面自己多出来的一行字。窗口大小变了会自动重量。',
          ),
          settings.matchPage ? h('p', { style: styles.status }, '已跟随：' + describeMatch(settings.match)) : null,
          h(
            'div',
            { style: styles.row },
            h(
              'button',
              { type: 'button', style: styles.button, onClick: toggleMatch },
              settings.matchPage ? '取消跟随' : '跟对话页完全一致',
            ),
            h(
              'button',
              {
                type: 'button',
                style: styles.button,
                onClick: () => {
                  const live = api()
                  const measured = live && typeof live.measurePage === 'function' ? live.measurePage() : null
                  flash(measured ? '量到了：' + describeMatch(measured) : '没找到对话区，先随便发一句话')
                },
              },
              '只量一次看看',
            ),
          ),
        ),

        h(
          'div',
          { style: styles.block },
          h('h3', { style: styles.title }, '显示'),
          h(Check, {
            label: '行数跟着面板高度自动变',
            hint: '面板有多高就显示几行，余数丢掉，不会切掉半行',
            checked: settings.autoLines !== false,
            onChange: (value) => apply({ autoLines: Boolean(value) }),
          }),
          h(Slider, {
            label: '显示行数',
            min: 2,
            max: 40,
            value: settings.lines,
            text: settings.autoLines !== false ? '自动 · 上限 ' + settings.lines + ' 行' : settings.lines + ' 行',
            onChange: (value) => apply({ lines: clamp(value, 2, 40) }),
          }),
          h(Slider, {
            label: '字号',
            min: 10,
            max: 24,
            value: settings.fontSize,
            text: settings.fontSize + 'px',
            onChange: (value) => apply({ fontSize: clamp(value, 10, 24) }),
          }),
          h(Slider, {
            label: '行距',
            min: 1.1,
            max: 2.6,
            step: 0.05,
            value: Number.isFinite(settings.lineHeight) ? settings.lineHeight : 1.55,
            text: Number((Number.isFinite(settings.lineHeight) ? settings.lineHeight : 1.55).toFixed(2)) + '×',
            onChange: (value) => apply({ lineHeight: clamp(Number(value) || 1.55, 1.1, 3) }),
          }),
          h(
            'label',
            { style: styles.row },
            h('span', { style: styles.label }, '字体'),
            h(
              'select',
              {
                value: settings.fontFamily || '',
                style: {
                  flex: 1,
                  minWidth: 0,
                  font: 'inherit',
                  fontSize: '12px',
                  padding: '4px 6px',
                  borderRadius: '6px',
                  border: '1px solid rgba(127,127,127,0.35)',
                  background: 'transparent',
                  color: 'inherit',
                },
                onChange: (event) => apply({ fontFamily: String(event.target.value || '') }),
              },
              ...FONT_PRESETS.map((preset) => h('option', { key: preset.value, value: preset.value }, preset.label)),
            ),
          ),
          h(Slider, {
            label: '透明度',
            min: 20,
            max: 100,
            value: settings.opacity,
            text: settings.opacity + '%',
            onChange: (value) => apply({ opacity: clamp(value, 20, 100) }),
          }),
          h(ColorField, {
            label: '文字颜色',
            value: settings.color || '#e6e8ee',
            onChange: (value) => apply({ color: value }),
          }),
          h(ColorField, {
            label: '背景颜色',
            value: settings.bg || '#0e1016',
            onChange: (value) => apply({ bg: value }),
          }),
          h(Slider, {
            label: '背景浓度',
            min: 0,
            max: 100,
            value: Number.isFinite(settings.bgAlpha) ? settings.bgAlpha : 34,
            text: (Number.isFinite(settings.bgAlpha) ? settings.bgAlpha : 34) + '%',
            onChange: (value) => apply({ bgAlpha: clamp(value, 0, 100) }),
          }),
          h(
            'label',
            { style: { ...styles.row, cursor: 'pointer' } },
            h('input', {
              type: 'checkbox',
              checked: !!settings.hideOnBlur,
              onChange: (event) => apply({ hideOnBlur: !!event.target.checked }),
            }),
            h('span', { style: { fontSize: '13px', opacity: 0.85 } }, '切换到别的窗口时自动隐藏'),
          ),
        ),

        h(
          'div',
          { style: styles.block },
          h('h3', { style: styles.title }, '快捷键'),
          h(
            'p',
            { style: styles.hint },
            '点一下右边的组合键，然后按下新的组合（必须带 Ctrl 或 Alt）。',
            '录制时按 Esc 取消。组合键在输入框里也生效；裸字母键永远还给输入框。',
          ),
          ...ACTIONS.map((action) =>
            h(
              'div',
              { key: action.id, style: styles.row },
              h('span', { style: styles.label }, action.label),
              h(
                'button',
                {
                  type: 'button',
                  style: recording === action.id ? styles.keyButtonRecording : styles.keyButton,
                  onClick: () => setRecording(recording === action.id ? null : action.id),
                },
                recording === action.id ? '按下新的组合…（Esc 取消）' : bindingLabel(settings.keys[action.id]),
              ),
              h('span', { style: { ...styles.value, minWidth: '0', flex: '1 1 220px' } }, action.hint),
            ),
          ),
        ),

        h(
          'div',
          { style: styles.row },
          h(
            'button',
            {
              type: 'button',
              style: styles.button,
              onClick: () => {
                const live = api()
                if (live && typeof live.resetSettings === 'function') {
                  live.resetSettings()
                  setSettings(readSettings())
                  flash('已恢复默认（书和进度没动）')
                } else {
                  writeSettings({ ...FALLBACK, keys: FALLBACK.keys })
                  setSettings(readSettings())
                  flash('已恢复默认')
                }
              },
            },
            '恢复默认',
          ),
          notice ? h('span', { style: { fontSize: '12px', opacity: 0.7 } }, notice) : null,
        ),

        h(
          'p',
          { style: styles.hint },
          '所有设置只存在这台机器的浏览器存储里（localStorage 的 dsh-reader:settings），不上传、不联网。',
        ),
      )
    }

    /* ------------------------------------------------ 底栏面板里的「小说」页 */

    const PANEL_TAB_ID = 'dsh-stealth-reader:novel'
    const PANEL_OPENED_KEY = 'dsh-reader:panel-opened'

    const tabStyles = {
      box: {
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        height: '100%',
        minHeight: '96px',
        padding: '2px 0 8px',
      },
      empty: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        gap: '10px',
        padding: '14px 16px',
        fontSize: '13px',
        lineHeight: 1.6,
        opacity: 0.8,
      },
      emptyButton: {
        font: 'inherit',
        fontSize: '12px',
        padding: '5px 12px',
        borderRadius: '6px',
        border: '1px solid currentColor',
        background: 'transparent',
        color: 'inherit',
        cursor: 'pointer',
        opacity: 0.85,
      },
    }

    /** 这一页要显示什么，全靠底栏那边告诉；没底栏就当作空。 */
    function readSnapshot() {
      const live = api()
      if (!live || typeof live.hasBook !== 'function') return { hasBook: false, title: '', index: 0, total: 0 }
      let book = null
      try {
        book = typeof live.currentBook === 'function' ? live.currentBook() : null
      } catch {
        book = null
      }
      return {
        hasBook: Boolean(live.hasBook()),
        title: book ? book.title : '',
        index: book ? book.index : 0,
        total: book ? book.total : 0,
      }
    }

    /**
     * 「速记」页：它自己不画正文，而是把阅读器的宿主元素搬进来。
     * 一套排版、一套翻页、一套进度，这个页面就是阅读器本身；
     * 切走 / 收起面板时把宿主搬回 body 并藏起来——面板不在就没有阅读器。
     */
    function NovelTab(props) {
      const holder = useRef(null)
      const [snapshot, setSnapshot] = useState(readSnapshot)
      const visible = props && props.visible !== false

      useEffect(() => {
        const live = api()
        if (!live || typeof live.subscribe !== 'function') return undefined
        return live.subscribe(() => setSnapshot(readSnapshot()))
      }, [])

      useEffect(() => {
        if (!visible) return undefined
        const box = holder.current
        const live = api()
        const hostEl = live && typeof live.hostElement === 'function' ? live.hostElement() : null
        if (!box || !hostEl) return undefined

        hostEl.dataset.inTab = '1'
        hostEl.style.position = 'static'
        hostEl.style.inset = 'auto'
        hostEl.style.bottom = 'auto'
        hostEl.style.width = '100%'
        if (props && props.tab && props.tab.id) globalThis.__dshStealthTabId = props.tab.id
        box.appendChild(hostEl)
        if (typeof live.setVisible === 'function') live.setVisible(true)
        if (typeof live.syncPresence === 'function') live.syncPresence()

        return () => {
          delete hostEl.dataset.inTab
          hostEl.style.position = ''
          hostEl.style.inset = ''
          hostEl.style.bottom = ''
          hostEl.style.width = ''
          if (document.body && document.body.isConnected) document.body.appendChild(hostEl)
          const back = api()
          if (back && typeof back.syncPresence === 'function') back.syncPresence()
        }
      }, [visible])

      const empty = snapshot.hasBook
        ? null
        : h(
            'div',
            { style: tabStyles.empty },
            h('span', { style: { margin: 0, opacity: 0.6, fontSize: '12px' } }, '把 .txt / .epub 拖进窗口，或者'),
            h(
              'button',
              {
                type: 'button',
                style: tabStyles.emptyButton,
                onClick: () => {
                  const live = api()
                  if (live && typeof live.openLibrary === 'function') live.openLibrary()
                },
              },
              '打开书库导入',
            ),
          )

      return h('div', { ref: holder, style: tabStyles.box }, empty)
    }

    const memoIcon = () =>
      h(
        'svg',
        {
          width: 16,
          height: 16,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.7,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        },
        h('path', { d: 'M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7' }),
        h('path', { d: 'M18.375 2.625a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4Z' }),
      )

    /** 装好之后第一次：顺手把速记页打开一次，让用户知道它住哪儿，之后交给面板自己记。 */
    function maybeOpenPanelOnce(sidebar) {
      let tries = 0
      const tick = () => {
        try {
          if (window.localStorage.getItem(PANEL_OPENED_KEY)) return
        } catch {
          return
        }
        try {
          sidebar.openTab({ type: PANEL_TAB_ID, target: 'bottom' })
          window.localStorage.setItem(PANEL_OPENED_KEY, '1')
        } catch {
          if (tries++ < 24) setTimeout(tick, 500)
        }
      }
      setTimeout(tick, 1200)
    }

    module.exports = {
      name: CLIENT_NAME + '-client',
      inject: ['slots'],
      apply(ctx) {
        ctx.effect(
          () =>
            ctx.slots.inject('settings.section', () =>
              ctx.slots.register(
                {
                  name: 'settings.section',
                  id: CLIENT_NAME,
                  order: 96,
                  label: '隐蔽阅读器',
                },
                ReaderSettingsSection,
              ),
            ),
          'dsh-stealth-reader: settings section',
        )

        // 底栏那个面板是 dsh-better-sidebar 的，它把 ctx.betterSidebar 开给所有插件；
        // 阅读器只住在那个面板里，没装就只在设置页里说明一下。
        ctx.inject(['betterSidebar'], (sidebarCtx) => {
          const sidebar =
            sidebarCtx.betterSidebar ||
            (typeof sidebarCtx.get === 'function' ? sidebarCtx.get('betterSidebar') : undefined)
          if (!sidebar || typeof sidebar.registerTab !== 'function') return

          sidebarCtx.effect(
            () =>
              sidebar.registerTab({
                id: PANEL_TAB_ID,
                title: '速记',
                description: '随手记几行字，关掉就收起',
                icon: memoIcon(),
                order: 60,
                bottomOnly: true,
                single: true,
                component: NovelTab,
              }),
            'dsh-stealth-reader: bottom tab',
          )

          globalThis.__dshStealthPanel = {
            open: () => sidebar.openTab({ type: PANEL_TAB_ID, target: 'bottom' }),
            close: () => {
              const id = globalThis.__dshStealthTabId
              if (id && typeof sidebar.closeTab === 'function') sidebar.closeTab(id)
            },
          }
          maybeOpenPanelOnce(sidebar)
        })
      },
    }

    return module.exports
  },
})
