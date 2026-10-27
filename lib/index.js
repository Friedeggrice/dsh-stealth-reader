/**
 * dsh-stealth-reader —— 宿主半区
 *
 * 只做三件事：
 *   1. 把两个前端脚本挂到 /dsh-reader/*（exact 路由，不走 SPA fallback、不走鉴权栅栏）；
 *   2. 通过 `webserver/index-inject` 推一行内联 loader（桌面端唯一生效通道）；
 *   3. 通过 `webServer.tapIndex()` 往 http 形态的 index.html 尾部补一个 <script>。
 * 阅读器本体全部在浏览器里跑：解析、分页、持久化都不回宿主。
 */
import { readFile } from 'node:fs/promises'
import { statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const WEB_DIR = path.join(PACKAGE_ROOT, 'web')

/** 静态资源表：路由 → [文件名, MIME] */
const ASSETS = new Map([
  ['/dsh-reader/reader-core.js', ['reader-core.js', 'application/javascript; charset=utf-8']],
  ['/dsh-reader/reader-ui.js', ['reader-ui.js', 'application/javascript; charset=utf-8']],
])

const PING_PATH = '/dsh-reader/ping'
const ROUTE_PREFIX = '/dsh-reader/'

/**
 * loader 用到的版本号：文件 mtime 决定，刷新即生效。
 * 必须是同步的 —— index-inject 的 table 在 emit 后立刻被遍历渲染，
 * 异步 push（await 之后）会赶不上这一轮。
 */
function assetVersion() {
  let newest = 0
  for (const [file] of ASSETS.values()) {
    try {
      newest = Math.max(newest, Math.floor(statSync(path.join(WEB_DIR, file)).mtimeMs))
    } catch {
      /* 缺文件时退化为 0，loader 依然会请求，路由回 500 便于排查 */
    }
  }
  return String(newest)
}

/**
 * 内联 loader：先 core 再 ui（动态插入的 classic script 默认 async，所以用 onload 串行）。
 * 只做一次；任何异常都吞掉，绝不影响宿主页面启动。
 */
function loaderText(version) {
  const suffix = `?v=${encodeURIComponent(version)}`
  return [
    '(function(){try{',
    'if(globalThis.__dshStealthReaderBoot__)return;',
    'globalThis.__dshStealthReaderBoot__=1;',
    'function add(src,next){var s=document.createElement("script");s.src=src;s.async=false;',
    's.onload=function(){if(next){var f=next;next=null;try{f()}catch(e){}}};',
    's.onerror=function(){if(next){var f=next;next=null;try{f()}catch(e){}}};',
    '(document.body||document.head||document.documentElement).appendChild(s);}',
    `add("/dsh-reader/reader-core.js${suffix}",function(){add("/dsh-reader/reader-ui.js${suffix}")});`,
    '}catch(e){}})()',
  ].join('')
}

/** 每次读到磁盘内容：宿主侧不缓存，改文件后刷新页面即生效。 */
async function serveAsset(req, res, file, type) {
  try {
    const text = await readFile(path.join(WEB_DIR, file), 'utf8')
    const body = Buffer.from(text, 'utf8')
    res.writeHead(200, {
      'Content-Type': type,
      'Cache-Control': 'no-store',
      'Content-Length': String(body.length),
    })
    if (req.method === 'HEAD') res.end()
    else res.end(body)
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end(`dsh-stealth-reader: 无法读取 ${file}\n${err instanceof Error ? err.message : String(err)}`)
  }
}

export default {
  name: 'dsh-stealth-reader',
  apply(root) {
    const disposers = []
    if (typeof root.effect === 'function') {
      root.effect(() => () => {
        for (const dispose of disposers.splice(0)) {
          try {
            dispose()
          } catch {
            /* 单个 disposer 失败不影响其它资源释放 */
          }
        }
      })
    }

    // ① 结构化注入行：桌面端 index 由渲染层按行应用，这是唯一通道。
    //    apply() 立刻执行、第一件事就注册，避免注入表被提前一次性收集而错过。
    //    每次渲染 index 都是新的 table，所以按 table 去重（WeakSet），
    //    既不会在一次渲染里塞两遍，也不会让后续刷新拿不到注入。
    const seenTables = new WeakSet()
    const offInject = root.on('webserver/index-inject', (table) => {
      try {
        if (!table || typeof table !== 'object' || seenTables.has(table)) return
        seenTables.add(table)
        if (Array.isArray(table)) {
          for (const row of table) {
            if (!row) continue
            if (row.kind === 'script' && typeof row.text === 'string' && row.text.includes('/dsh-reader/reader-core.js')) return
            if (row.kind === 'script-src' && String(row.src || '').startsWith(ROUTE_PREFIX)) return
          }
        }
        table.push({ kind: 'script', placement: 'body', text: loaderText(assetVersion()) })
      } catch {
        /* 注入失败不能让宿主启动失败 */
      }
    })
    disposers.push(offInject)

    // ② HTTP 路由 + index tap：等 webServer 就绪后再注册。
    root.inject(['webServer'], (ctx) => {
      const webServer = ctx.webServer
      if (!webServer) return

      for (const [route, [file, type]] of ASSETS) {
        disposers.push(
          webServer.register({
            kind: 'exact',
            path: route,
            handler: (req, res) => serveAsset(req, res, file, type),
          }),
        )
      }

      disposers.push(
        webServer.register({
          kind: 'exact',
          path: PING_PATH,
          handler: (req, res) => {
            const payload = JSON.stringify({ ok: true, plugin: 'dsh-stealth-reader', version: assetVersion() })
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
            res.end(payload)
          },
        }),
      )

      // http 形态的 index：在 </body> 前补一行 defer 脚本；已注入则跳过。
      disposers.push(
        webServer.tapIndex((html) => {
          if (typeof html !== 'string') return html
          if (html.includes('/dsh-reader/reader-core.js')) return html
          const tag =
            '<script defer src="/dsh-reader/reader-core.js"></script>' +
            '<script defer src="/dsh-reader/reader-ui.js"></script>'
          if (html.includes('</body>')) return html.replace('</body>', tag + '</body>')
          return html + tag
        }),
      )

      ctx.logger?.info?.('dsh-stealth-reader: 阅读器路由已挂载 (/dsh-reader/*)')
    })
  },
}
