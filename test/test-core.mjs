/**
 * 解析层自测（node test/test-core.mjs）
 *
 * 不依赖浏览器：用 vm 跑 reader-core.js，用 node:zlib 现造一个 epub，
 * 覆盖 txt 编码/切章、长文切块、epub zip→OPF→spine→正文、实体解码。
 */
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { deflateRawSync } from 'node:zlib'
import assert from 'node:assert/strict'

const coreCode = readFileSync(new URL('../web/reader-core.js', import.meta.url), 'utf8')
const sandbox = {
  TextDecoder,
  TextEncoder,
  Uint8Array,
  ArrayBuffer,
  DataView,
  Blob,
  Response,
  DecompressionStream,
  Number,
  Math,
  JSON,
  String,
  Object,
  RegExp,
  console,
}
sandbox.globalThis = sandbox
runInNewContext(coreCode, sandbox)
const core = sandbox.DshReaderCore
assert.ok(core, 'reader-core.js 应该导出 globalThis.DshReaderCore')

/* --------------------------------------------------------------- zip 构造 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let value = i
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    table[i] = value >>> 0
  }
  return table
})()

function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

/** 最小 zip 写入器：store 或 deflate。 */
function makeZip(entries) {
  const locals = []
  const centrals = []
  let offset = 0
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8')
    const raw = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, 'utf8')
    const payload = entry.store ? raw : deflateRawSync(raw)
    const method = entry.store ? 0 : 8
    const crc = crc32(raw)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 6)
    local.writeUInt16LE(method, 8)
    local.writeUInt16LE(0, 10)
    local.writeUInt16LE(0, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(payload.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)
    locals.push(local, name, payload)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0, 8)
    central.writeUInt16LE(method, 10)
    central.writeUInt16LE(0, 12)
    central.writeUInt16LE(0, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(payload.length, 20)
    central.writeUInt32LE(raw.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt16LE(0, 30)
    central.writeUInt16LE(0, 32)
    central.writeUInt16LE(0, 34)
    central.writeUInt16LE(0, 36)
    central.writeUInt32LE(0, 38)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, name)

    offset += local.length + name.length + payload.length
  }
  const centralBuffer = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(centralBuffer.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, centralBuffer, eocd])
}

/* ------------------------------------------------------------------- 用例 */

const results = []
function test(name, fn) {
  try {
    fn()
    results.push(['PASS', name])
  } catch (err) {
    results.push(['FAIL', name + ' → ' + (err && err.message ? err.message : String(err))])
  }
}

async function testAsync(name, fn) {
  try {
    await fn()
    results.push(['PASS', name])
  } catch (err) {
    results.push(['FAIL', name + ' → ' + (err && err.message ? err.message : String(err))])
  }
}

/* ---- txt ---- */

test('UTF-8 BOM 解码', () => {
  const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('第一章 起风了\n\n他推开门。', 'utf8')])
  assert.equal(core.decodeBytes(bytes), '第一章 起风了\n\n他推开门。')
})

test('UTF-16LE BOM 解码', () => {
  const text = '深夜的图书馆'
  const body = Buffer.from(text, 'utf16le')
  const bytes = Buffer.concat([Buffer.from([0xff, 0xfe]), body])
  assert.equal(core.decodeBytes(bytes), text)
})

test('切章：第X章 / 楔子 / 番外', () => {
  const text = [
    '楔子',
    '那天下了很大的雪。',
    '第一章 起风了',
    '他推开门，风灌进屋子。',
    '第二章 归途',
    '路很长。',
    '番外 那年夏天',
    '蝉鸣不止。',
  ].join('\n')
  const segments = core.splitChapters(text)
  assert.equal(segments.length, 4)
  assert.equal(segments[0].title, '楔子')
  assert.equal(segments[1].title, '第一章 起风了')
  assert.equal(segments[3].title, '番外 那年夏天')
  assert.ok(segments[1].text.includes('风灌进屋子'))
  assert.ok(!segments[1].text.includes('路很长'), '下一章内容不能串进上一章')
})

test('切章：无章节标记时整本一块', () => {
  const segments = core.splitChapters('就是一段没有任何章节标题的流水账。'.repeat(20))
  assert.equal(segments.length, 1)
})

test('长文切块：每块不超过上限且不丢字', () => {
  const paragraphs = []
  for (let i = 0; i < 400; i++) paragraphs.push('第' + i + '段，' + '文字'.repeat(60))
  const text = paragraphs.join('\n\n')
  const chunks = core.chunkText(text, 4000)
  assert.ok(chunks.length > 1)
  for (const chunk of chunks) assert.ok(chunk.length <= 4000, '块长 ' + chunk.length)
  const joined = chunks.join('').replace(/\s/g, '')
  assert.equal(joined.length, text.replace(/\s/g, '').length, '切块不能丢字')
})

test('章节+超长章节：仍然切块', () => {
  const body = '第一章 长夜\n' + '内容'.repeat(20000)
  const segments = core.splitChapters(body, { maxSegment: 5000 })
  assert.ok(segments.length > 3)
  assert.equal(segments[0].title, '第一章 长夜')
  for (const segment of segments) assert.ok(segment.text.length <= 5000)
})

/* ---- html ---- */

test('XHTML → 纯文本：去标签、留换行、解实体', () => {
  const text = core.htmlToText(
    '<html><head><style>p{color:red}</style></head><body><h2>第三章</h2><p>他说：&ldquo;走吧&rdquo;。</p><p>a &amp; b<br/>下一行</p><script>evil()</script></body></html>',
  )
  assert.ok(text.startsWith('第三章'))
  assert.ok(text.includes('他说：“走吧”。'))
  assert.ok(text.includes('下一行'))
  assert.ok(!text.includes('evil'))
  assert.ok(!text.includes('<'))
})

test('数字实体', () => {
  assert.equal(core.htmlToText('<p>&#26085;&#x672c;</p>'), '日本')
})

/* ---- epub ---- */

const EPUB = makeZip([
  { name: 'mimetype', data: 'application/epub+zip', store: true },
  {
    name: 'META-INF/container.xml',
    data: `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
  },
  {
    name: 'OEBPS/content.opf',
    data: `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>雪夜行</dc:title>
    <dc:creator>某作者</dc:creator>
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>
    <item id="c1" href="text/ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="c2" href="text/ch2.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine toc="ncx">
    <itemref idref="cover"/>
    <itemref idref="c1"/>
    <itemref idref="c2"/>
  </spine>
</package>`,
  },
  {
    name: 'OEBPS/toc.ncx',
    data: `<?xml version="1.0"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/"><head><meta name="dtb:uid" content="x"/></head><docTitle><text>雪夜行</text></docTitle><navMap>
      <navPoint id="n0"><navLabel><text>封面</text></navLabel><content src="cover.xhtml"/></navPoint>
      <navPoint id="n1"><navLabel><text>第一章 雪</text></navLabel><content src="text/ch1.xhtml"/></navPoint>
      <navPoint id="n2"><navLabel><text>第二章 夜</text></navLabel><content src="text/ch2.xhtml#top"/></navPoint>
    </navMap></ncx>`,
  },
  { name: 'OEBPS/cover.xhtml', data: '<html><body><img src="c.png"/></body></html>' },
  {
    name: 'OEBPS/text/ch1.xhtml',
    data: '<html><body><h1>第一章 雪</h1><p>雪落在窗台上。</p><p>他把书翻到第&nbsp;12 页。</p></body></html>',
  },
  {
    name: 'OEBPS/text/ch2.xhtml',
    data: '<html><body><h1>第二章 夜</h1><p>灯灭了。</p><p>夜里很安静。</p></body></html>',
  },
])

await testAsync('epub：标题/作者/spine 顺序/章节名/正文', async () => {
  const parsed = await core.parseEpub(EPUB)
  assert.equal(parsed.title, '雪夜行')
  assert.equal(parsed.author, '某作者')
  assert.equal(parsed.segments.length, 2, '封面段应被并进上一段或丢弃')
  assert.equal(parsed.segments[0].title, '第一章 雪')
  assert.ok(parsed.segments[0].text.includes('雪落在窗台上'))
  assert.equal(parsed.segments[1].title, '第二章 夜')
  assert.ok(parsed.segments[1].text.includes('夜里很安静'), '带 #fragment 的 href 也要能对上章节名')
})

await testAsync('epub：坏文件给出可读错误', async () => {
  await assert.rejects(() => core.parseEpub(Buffer.from('not a zip at all')), /zip|中央目录/)
})

test('sniffFormat', () => {
  assert.equal(core.sniffFormat(EPUB, 'x.bin'), 'epub')
  assert.equal(core.sniffFormat(Buffer.from('普通文本'), 'a.txt'), 'txt')
})

/* ------------------------------------------------------------------ 输出 */

for (const [status, name] of results) {
  console.log((status === 'PASS' ? '  ok   ' : '  FAIL ') + name)
}
const failed = results.filter(([status]) => status === 'FAIL')
console.log(`\n${results.length - failed.length}/${results.length} 通过`)
if (failed.length) process.exitCode = 1
