/**
 * dsh-stealth-reader · core
 *
 * 纯解析层：不碰 DOM，浏览器与 Node 都能跑（测试直接用 node 跑）。
 *  - decodeBytes：UTF-8 / UTF-16 BOM / GB18030 / Big5 自适应解码
 *  - normalizeText：换行与空白归一
 *  - splitChapters：按「第X章」「Chapter N」等切章，超长章节再切块
 *  - parseEpub：自己读 zip 中央目录 + DecompressionStream 解压，解析 container.xml / OPF / spine / NCX
 */
(function (global) {
  'use strict'

  const VERSION = '0.3.0'
  const EOCD_SIG = 0x06054b50
  const CEN_SIG = 0x02014b50
  const LOC_SIG = 0x04034b50

  /* ------------------------------------------------------------------ bytes */

  /**
   * 任何"字节来源"都收敛成 Uint8Array。
   * 用结构化判断而不是 instanceof：File.arrayBuffer() 在部分宿主里返回的是另一个
   * realm 的 ArrayBuffer（iframe、node vm、测试用 jsdom），instanceof 会假阴性。
   */
  function toU8(input) {
    if (!input) throw new TypeError('期望 ArrayBuffer 或 Uint8Array，收到空值')
    if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
    if (Object.prototype.toString.call(input) === '[object ArrayBuffer]') return new Uint8Array(input)
    throw new TypeError('期望 ArrayBuffer 或 Uint8Array，收到 ' + Object.prototype.toString.call(input))
  }

  function tryDecode(bytes, encoding) {
    try {
      return new TextDecoder(encoding, { fatal: true }).decode(bytes)
    } catch {
      return null
    }
  }

  function looksSane(text) {
    if (!text) return false
    let bad = 0
    for (let i = 0; i < text.length && i < 4000; i++) {
      const code = text.charCodeAt(i)
      if (code === 0xfffd) bad += 1
      else if (code < 0x09) bad += 1
      else if (code > 0x0e && code < 0x20) bad += 1
    }
    return bad / Math.min(text.length, 4000) < 0.01
  }

  /** 字节 → 文本。先严格 UTF-8，再 GB18030/Big5 等中文编码，最后宽松 UTF-8。 */
  function decodeBytes(input) {
    const bytes = toU8(input)
    if (bytes.length === 0) return ''
    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
      return new TextDecoder('utf-8').decode(bytes.subarray(3))
    }
    if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
      return new TextDecoder('utf-16le').decode(bytes.subarray(2))
    }
    if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
      return new TextDecoder('utf-16be').decode(bytes.subarray(2))
    }
    const utf8 = tryDecode(bytes, 'utf-8')
    if (utf8 !== null) return utf8
    for (const encoding of ['gb18030', 'big5', 'shift_jis', 'euc-kr']) {
      const text = tryDecode(bytes, encoding)
      if (text !== null && looksSane(text)) return text
    }
    return new TextDecoder('utf-8').decode(bytes)
  }

  /* ------------------------------------------------------------------- text */

  function normalizeText(input) {
    return String(input == null ? '' : input)
      .replace(/^\uFEFF/, '')
      .replace(/\r\n?/g, '\n')
      .replace(/\u00a0/g, ' ')
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  }

  // 「第12章」「第十二回 风起」「Chapter 7」「楔子 / 序章 / 番外」…（整行才算标题）
  const CHAPTER_LINE =
    /^[ \t\u3000]*(?:第[0-9０-９〇零一二三四五六七八九十百千万亿两]{1,12}[章节節回卷部篇集话話幕]|(?:Chapter|CHAPTER|chapter)[ \t]+[0-9]+|楔子|序章|序言|引子|前言|后记|後記|尾声|尾聲|番外)(?:[ \t\u3000:：.、\-—~～]*[^\n]{0,48})?$/

  /** 按段落边界把超长文本切成 ≤ maxLen 的块（单段过长则硬切）。 */
  function chunkText(text, maxLen) {
    const limit = Math.max(2000, maxLen || 24000)
    if (text.length <= limit) return [text]
    const out = []
    let buffer = ''
    for (const para of text.split(/\n{2,}/)) {
      if (buffer.length + para.length + 2 > limit && buffer) {
        out.push(buffer)
        buffer = ''
      }
      if (para.length > limit) {
        for (let i = 0; i < para.length; i += limit) {
          const piece = para.slice(i, i + limit)
          if (i + limit < para.length) out.push(piece)
          else buffer = piece
        }
        continue
      }
      buffer = buffer ? buffer + '\n\n' + para : para
    }
    if (buffer) out.push(buffer)
    return out
  }

  /** 纯文本 → 章节数组 [{title, text}]。识别不到章节时整本作为一块（仍会按长度切块）。 */
  function splitChapters(input, options) {
    const opts = options || {}
    const text = normalizeText(input)
    if (!text) return []
    const parts = []
    let current = { title: '', lines: [] }
    for (const line of text.split('\n')) {
      const trimmed = line.trim()
      if (trimmed && trimmed.length <= 60 && CHAPTER_LINE.test(trimmed)) {
        if (current.lines.some((l) => l.trim())) parts.push(current)
        current = { title: trimmed, lines: [line] }
        continue
      }
      current.lines.push(line)
    }
    if (current.lines.some((l) => l.trim())) parts.push(current)

    const segments = []
    for (const part of parts) {
      const body = part.lines.join('\n').trim()
      if (!body) continue
      for (const chunk of chunkText(body, opts.maxSegment)) segments.push({ title: part.title || '', text: chunk })
    }
    return segments.length ? segments : [{ title: '', text }]
  }

  /* -------------------------------------------------------------------- epub */

  function findEocd(view, length) {
    const floor = Math.max(0, length - 66000)
    for (let i = length - 22; i >= floor; i--) {
      if (view.getUint32(i, true) === EOCD_SIG) return i
    }
    return -1
  }

  async function inflateRaw(bytes) {
    if (typeof DecompressionStream !== 'function') throw new Error('当前环境不支持 DecompressionStream，无法解压 epub')
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
    return new Uint8Array(await new Response(stream).arrayBuffer())
  }

  class ZipArchive {
    constructor(input) {
      this.bytes = toU8(input)
      this.view = new DataView(this.bytes.buffer, this.bytes.byteOffset, this.bytes.byteLength)
      const eocd = findEocd(this.view, this.bytes.length)
      if (eocd < 0) throw new Error('不是有效的 zip/epub（找不到中央目录）')
      const total = this.view.getUint16(eocd + 10, true)
      let cursor = this.view.getUint32(eocd + 16, true)
      this.entries = new Map()
      for (let i = 0; i < total; i++) {
        if (cursor + 46 > this.bytes.length || this.view.getUint32(cursor, true) !== CEN_SIG) break
        const method = this.view.getUint16(cursor + 10, true)
        const compressedSize = this.view.getUint32(cursor + 20, true)
        const uncompressedSize = this.view.getUint32(cursor + 24, true)
        const nameLen = this.view.getUint16(cursor + 28, true)
        const extraLen = this.view.getUint16(cursor + 30, true)
        const commentLen = this.view.getUint16(cursor + 32, true)
        const localOffset = this.view.getUint32(cursor + 42, true)
        const name = new TextDecoder('utf-8').decode(this.bytes.subarray(cursor + 46, cursor + 46 + nameLen))
        this.entries.set(name, { method, compressedSize, uncompressedSize, localOffset })
        cursor += 46 + nameLen + extraLen + commentLen
      }
      this.names = [...this.entries.keys()]
    }

    has(name) {
      return this.entries.has(name)
    }

    async raw(name) {
      const entry = this.entries.get(name)
      if (!entry) return null
      const view = this.view
      if (view.getUint32(entry.localOffset, true) !== LOC_SIG) throw new Error('损坏的 zip 局部头：' + name)
      const nameLen = view.getUint16(entry.localOffset + 26, true)
      const extraLen = view.getUint16(entry.localOffset + 28, true)
      const start = entry.localOffset + 30 + nameLen + extraLen
      const data = this.bytes.subarray(start, start + entry.compressedSize)
      if (entry.method === 0) return data
      if (entry.method === 8) return inflateRaw(data)
      throw new Error('不支持的 zip 压缩方式 ' + entry.method + '：' + name)
    }

    async text(name) {
      const data = await this.raw(name)
      return data === null ? null : decodeBytes(data)
    }
  }

  function attr(tag, name) {
    const pattern = new RegExp('(?:^|\\s)' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*=\\s*("([^"]*)"|\'([^\']*)\')', 'i')
    const found = pattern.exec(tag)
    if (!found) return ''
    return found[2] !== undefined ? found[2] : found[3]
  }

  function resolvePath(baseDir, href) {
    if (!href) return ''
    let clean = String(href).split('#')[0]
    try {
      clean = decodeURIComponent(clean)
    } catch {
      /* 保留原始 href */
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(clean)) return clean
    const out = baseDir ? baseDir.split('/').filter(Boolean) : []
    for (const piece of clean.replace(/^\/+/, '').split('/')) {
      if (!piece || piece === '.') continue
      if (piece === '..') out.pop()
      else out.push(piece)
    }
    return out.join('/')
  }

  const ENTITIES = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ldquo: '“', rdquo: '”',
    lsquo: '‘', rsquo: '’', mdash: '—', ndash: '–', hellip: '…', middot: '·', bull: '•',
    copy: '©', reg: '®', trade: '™', times: '×', divide: '÷', laquo: '«', raquo: '»',
    deg: '°', plusmn: '±', frac12: '½', frac14: '¼', ensp: ' ', emsp: ' ', thinsp: ' ',
  }

  function decodeEntities(text) {
    return text
      .replace(/&#x([0-9a-f]+);/gi, (_, hex) => safeFromCode(parseInt(hex, 16)))
      .replace(/&#(\d+);/g, (_, dec) => safeFromCode(parseInt(dec, 10)))
      .replace(/&([a-z][a-z0-9]+);/gi, (whole, name) => {
        const key = name.toLowerCase()
        return Object.prototype.hasOwnProperty.call(ENTITIES, key) ? ENTITIES[key] : whole
      })
  }

  function safeFromCode(code) {
    if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return ''
    try {
      return String.fromCodePoint(code)
    } catch {
      return ''
    }
  }

  /** XHTML/HTML 片段 → 纯文本（保留段落换行，去掉标签与脚本）。 */
  function htmlToText(html) {
    let text = String(html || '')
    text = text.replace(/<!--[\s\S]*?-->/g, '')
    text = text.replace(/<(script|style|head|svg|math|template)\b[\s\S]*?<\/\1>/gi, '')
    text = text.replace(/<br\s*\/?>/gi, '\n')
    text = text.replace(/<\/(p|div|h[1-6]|li|tr|section|article|blockquote|pre|dd|dt|figcaption)\s*>/gi, '\n')
    text = text.replace(/<li\b[^>]*>/gi, '\n· ')
    text = text.replace(/<(hr|img|image|input|source)\b[^>]*>/gi, '')
    text = text.replace(/<[^>]+>/g, '')
    return normalizeText(decodeEntities(text))
  }

  /**
   * 从 NCX 里取 "content src → 章节名"。
   * 不能用 "<text>…</text> 后面跟 <content>" 这种整段正则：文件开头的 <docTitle> 也是
   * <text>，会把它错绑到第一章上。逐个 <content> 往回找最近的 <text> 才靠谱，
   * 嵌套 navPoint 也自然取到最深一层的名字。
   */
  function collectNcxTitles(xml, opfDir, into) {
    const from = xml.search(/<navMap\b/i)
    if (from < 0) return
    const body = xml.slice(from)

    const labels = []
    const textPattern = /<text\b[^>]*>([\s\S]*?)<\/text>/gi
    let found
    while ((found = textPattern.exec(body))) {
      const label = htmlToText(found[1]).replace(/\s+/g, ' ').trim()
      if (label) labels.push({ index: found.index, label })
    }
    if (!labels.length) return

    const contentPattern = /<content\b[^>]*>/gi
    while ((found = contentPattern.exec(body))) {
      const src = attr(found[0], 'src')
      if (!src) continue
      let label = ''
      for (let index = labels.length - 1; index >= 0; index--) {
        if (labels[index].index < found.index) {
          label = labels[index].label
          break
        }
      }
      if (!label || label.length > 60) continue
      const key = resolvePath(opfDir, src)
      if (key && !into.has(key)) into.set(key, label)
    }
  }

  function collectNavTitles(html, opfDir, into) {
    const pattern = /<a\b[^>]*href\s*=\s*("([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a>/gi
    let found
    while ((found = pattern.exec(html))) {
      const href = found[2] !== undefined ? found[2] : found[3]
      const label = htmlToText(found[4]).replace(/\s+/g, ' ').trim()
      if (!href || !label || label.length > 60) continue
      const key = resolvePath(opfDir, href)
      if (key && !into.has(key)) into.set(key, label)
    }
  }

  /**
   * epub → { title, author, segments }。
   * 自行解 zip，按 OPF spine 顺序取正文；NCX / nav 只用来给章节起名。
   */
  async function parseEpub(input, options) {
    const opts = options || {}
    const zip = new ZipArchive(input)
    const container = await zip.text('META-INF/container.xml')
    if (!container) throw new Error('epub 缺少 META-INF/container.xml')

    const rootfile = /<rootfile\b[^>]*\bfull-path\s*=\s*("([^"]*)"|'([^']*)')/i.exec(container)
    const rawOpf = rootfile ? (rootfile[2] !== undefined ? rootfile[2] : rootfile[3]) : ''
    const opfPath = rawOpf ? decodeEntities(rawOpf) : zip.names.find((name) => /\.opf$/i.test(name)) || ''
    if (!opfPath) throw new Error('epub 缺少 OPF 清单')

    const opf = await zip.text(opfPath)
    if (!opf) throw new Error('读不到 OPF：' + opfPath)
    const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/')) : ''

    const manifest = new Map()
    const itemPattern = /<item\b[^>]*>/gi
    let found
    while ((found = itemPattern.exec(opf))) {
      const tag = found[0]
      const id = attr(tag, 'id')
      const href = attr(tag, 'href')
      if (!id || !href) continue
      manifest.set(id, {
        href,
        type: attr(tag, 'media-type').toLowerCase(),
        properties: attr(tag, 'properties').toLowerCase(),
      })
    }

    const spine = []
    const refPattern = /<itemref\b[^>]*>/gi
    while ((found = refPattern.exec(opf))) {
      const idref = attr(found[0], 'idref')
      const item = idref ? manifest.get(idref) : undefined
      if (item) spine.push(item)
    }

    const titles = new Map()
    const spineTag = /<spine\b[^>]*>/i.exec(opf)
    const ncxId = spineTag ? attr(spineTag[0], 'toc') : ''
    const ncx = ncxId ? manifest.get(ncxId) : undefined
    if (ncx) {
      const xml = await zip.text(resolvePath(opfDir, ncx.href))
      if (xml) collectNcxTitles(xml, opfDir, titles)
    }
    for (const item of manifest.values()) {
      if (!item.properties.includes('nav')) continue
      if (!/xhtml|html/.test(item.type) && !/\.x?html?$/i.test(item.href)) continue
      const html = await zip.text(resolvePath(opfDir, item.href))
      if (html) collectNavTitles(html, opfDir, titles)
    }

    const maxSegment = opts.maxSegment || 24000
    const segments = []
    for (const item of spine) {
      if (item.type && !/html|xml/.test(item.type)) continue
      const itemPath = resolvePath(opfDir, item.href)
      let html = await zip.text(itemPath)
      if (html === null) continue
      const text = htmlToText(html)
      if (!text) continue
      const label = titles.get(itemPath) || titles.get(itemPath.split('/').pop()) || ''
      for (const chunk of chunkText(text, maxSegment)) segments.push({ title: label, text: chunk })
    }

    // 无标题的极短片段（版权页、封面残留）并进上一段，避免"翻一页全是空白"；
    // 有标题的短章节原样保留 —— 它自己就是一章。
    const merged = []
    for (const segment of segments) {
      const previous = merged[merged.length - 1]
      if (previous && !segment.title && segment.text.length < 40) previous.text += '\n\n' + segment.text
      else merged.push(segment)
    }
    if (!merged.length) throw new Error('epub 里没有可读正文')

    const metaTitle = /<dc:title\b[^>]*>([\s\S]*?)<\/dc:title>/i.exec(opf)
    const metaAuthor = /<dc:creator\b[^>]*>([\s\S]*?)<\/dc:creator>/i.exec(opf)
    return {
      title: metaTitle ? htmlToText(metaTitle[1]).replace(/\s+/g, ' ').trim() : '',
      author: metaAuthor ? htmlToText(metaAuthor[1]).replace(/\s+/g, ' ').trim() : '',
      segments: merged,
    }
  }

  /** 按扩展名/魔数判断格式。 */
  function sniffFormat(input, fileName) {
    const bytes = toU8(input)
    if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 0x03 || bytes[2] === 0x05)) return 'epub'
    if (/\.epub$/i.test(fileName || '')) return 'epub'
    return 'txt'
  }

  global.DshReaderCore = {
    version: VERSION,
    decodeBytes,
    normalizeText,
    splitChapters,
    chunkText,
    htmlToText,
    parseEpub,
    sniffFormat,
    ZipArchive,
  }
})(typeof globalThis !== 'undefined' ? globalThis : this)
