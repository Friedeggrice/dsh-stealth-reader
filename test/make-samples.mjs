/**
 * 生成两个可直接拖进阅读器的示例文件：samples/夜行船.txt 和 samples/夜行船.epub
 * （zip 用 store 方式写入，不压缩，任何 epub 阅读器都认）
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const outDir = join(here, '..', 'samples')
mkdirSync(outDir, { recursive: true })

const CHAPTERS = [
  {
    title: '第一章 渡口',
    paragraphs: [
      '雨停在傍晚。江面上一层薄雾，把对岸的灯揉成一片模糊的黄。',
      '陈舟把船篙横在膝上，等最后一个客人。渡口空了，石阶上只剩下水痕，一级一级往江里退。',
      '他做这行十一年。十一年的规矩只有一条：天黑以后，不载不说话的客人。',
      '雾里走来一个人。青布长衫，肩上没有行李，走路时几乎没有声音，像踩在别人的影子上。',
      '“过江。”那人说。',
      '声音很轻，但从江这边一直传到江那边，雾竟往两边散开了一点。',
      '陈舟看了他一眼，把篙子往水里一插：“三文。”',
      '那人从袖中摸出三枚铜钱，放在船板上。钱是新铸的，边缘还带着毛刺，压在水里也不生锈。',
      '船离岸的时候，陈舟回头看了一眼渡口。石阶上多了一双湿脚印，从雾里出来，到水边停住，脚尖朝江。',
      '他没有说话。规矩里也没说不能看。',
    ],
  },
  {
    title: '第二章 江心',
    paragraphs: [
      '船到江心，风忽然停了。',
      '陈舟摇橹的手停在半空。江上没有风，雾气却开始旋转，一圈一圈，像有什么东西在水下翻身。',
      '“船家，”那人忽然开口，“你载过死人吗？”',
      '“载过。”陈舟说，“死人不会说话，好载。”',
      '那人笑了一下。笑声在雾里撞出回声，回声却不是他一个人的。',
      '陈舟低头看船板。三枚铜钱已经不见了，原处留下一小滩水，水面上浮着三片极薄的柳叶。',
      '他想起来了。十一年前，也是这样的雾，他载过一个不肯说话的人。那人到岸时给了他三枚铜钱，第二天江里捞起一具尸首，手里握着同样的钱。',
      '“你认得我。”那人说。不是问句。',
      '陈舟把橹放下，慢慢坐直：“认得。十一月初七，雾，三更。”',
      '“你当时没有回头。”那人说，“岸上有个人在叫你。你回头了。”',
      '陈舟不说话。他记得那声叫唤，记得自己回头，也记得船底下那一阵拖拽的力道——很轻，像有人在水里扯了扯他的衣角。',
    ],
  },
  {
    title: '第三章 灯',
    paragraphs: [
      '对岸的灯忽然亮了。',
      '不是一盏一盏地亮，是整片灯火同时腾起来，把雾烧出一个洞。陈舟眯起眼，看见岸上站满了人，都穿着青布长衫，都低着头，脚尖朝着江心。',
      '“他们要渡江。”那人说，“等了十一年。”',
      '“一条船。”陈舟说。',
      '“所以只要一趟。”',
      '陈舟看着那些人。他们站得很静，静得连衣角都不动，可是他知道——只要船靠岸，他们会一起上来，而这条船装不下。',
      '他伸手去摸船篙。篙是竹子做的，用了十一年，握上去还是凉的，凉得踏实。',
      '“三文。”他说。',
      '那人愣了一下。',
      '“一趟三文，十一年前欠的那趟，也一并算上。”陈舟把篙子伸进水里，“钱我先不收。到了岸，你替我数一数，上船的是不是都是死人。”',
      '雾里安静了很久。然后那人笑了，这一次回声只有他一个人的。',
      '“船家，”他说，“你可想清楚了。数错了，你就不是船家了。”',
      '“我本来也不是。”陈舟说，“我只是这十一年，一直在渡口等一句解释。”',
    ],
  },
  {
    title: '尾声 雾散',
    paragraphs: [
      '天快亮的时候，雾散了。',
      '渡口下游三里，有人捞到一条空船。船板干净，篙子横在船头，船底压着三枚新铸的铜钱，边缘的毛刺都磨圆了。',
      '船不见了主人。捞船的人说，他认得这条船，十一年的老船，船头那道裂口是当年撞上暗礁留下的。',
      '同一天，镇上的人发现渡口的石阶上多了一行湿脚印，从水边一直走到街上，走到一家还没开门的茶馆门前，停住。',
      '茶馆的老板后来跟人说，那天他开门，看见门槛上放着三枚铜钱，铜钱底下压着一张纸条，字迹被水泡得发胀，只认得出四个字：',
      '“还你一趟。”',
      '至于陈舟——从此再没有人见过他。有人说他下了江，有人说他去了上游，也有人说，每天傍晚雾起的时候，还能在对岸听见有人喊一声“三文”。',
      '只是那声喊，从来没有得到过回答。',
    ],
  },
]

const plain = CHAPTERS.map((chapter) => chapter.title + '\n\n' + chapter.paragraphs.join('\n\n')).join('\n\n')
writeFileSync(join(outDir, '夜行船.txt'), plain + '\n', 'utf8')

/* ------------------------------------------------------------------ epub */

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

function makeZip(entries) {
  const locals = []
  const centrals = []
  let offset = 0
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8')
    const raw = Buffer.from(entry.data, 'utf8')
    const crc = crc32(raw)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 6)
    local.writeUInt16LE(0, 8)
    local.writeUInt16LE(0, 10)
    local.writeUInt16LE(0, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(raw.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)
    locals.push(local, name, raw)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0, 8)
    central.writeUInt16LE(0, 10)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(raw.length, 20)
    central.writeUInt32LE(raw.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, name)

    offset += local.length + name.length + raw.length
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

const escape = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const items = CHAPTERS.map((chapter, index) => ({
  id: 'ch' + (index + 1),
  href: 'text/ch' + (index + 1) + '.xhtml',
  chapter,
}))

const opf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>夜行船</dc:title>
    <dc:creator>佚名</dc:creator>
    <dc:language>zh-CN</dc:language>
    <dc:identifier id="bookid">urn:uuid:6b1f2c9e-0d3a-4a51-9a1e-sample</dc:identifier>
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
${items.map((item) => `    <item id="${item.id}" href="${item.href}" media-type="application/xhtml+xml"/>`).join('\n')}
  </manifest>
  <spine toc="ncx">
${items.map((item) => `    <itemref idref="${item.id}"/>`).join('\n')}
  </spine>
</package>`

const ncx = `<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head><meta name="dtb:uid" content="urn:uuid:6b1f2c9e-0d3a-4a51-9a1e-sample"/></head>
  <docTitle><text>夜行船</text></docTitle>
  <navMap>
${items
  .map(
    (item, index) => `    <navPoint id="np${index + 1}" playOrder="${index + 1}">
      <navLabel><text>${escape(item.chapter.title)}</text></navLabel>
      <content src="${item.href}"/>
    </navPoint>`,
  )
  .join('\n')}
  </navMap>
</ncx>`

const xhtml = (chapter) => `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${escape(chapter.title)}</title></head>
<body>
<h2>${escape(chapter.title)}</h2>
${chapter.paragraphs.map((paragraph) => '<p>' + escape(paragraph) + '</p>').join('\n')}
</body></html>`

const epub = makeZip([
  { name: 'mimetype', data: 'application/epub+zip' },
  {
    name: 'META-INF/container.xml',
    data: `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`,
  },
  { name: 'OEBPS/content.opf', data: opf },
  { name: 'OEBPS/toc.ncx', data: ncx },
  ...items.map((item) => ({ name: 'OEBPS/' + item.href, data: xhtml(item.chapter) })),
])

writeFileSync(join(outDir, '夜行船.epub'), epub)

console.log('samples/', '夜行船.txt', plain.length + ' 字')
console.log('samples/', '夜行船.epub', epub.length + ' 字节')
