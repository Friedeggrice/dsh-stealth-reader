# dsh-stealth-reader

在 DSH 底部那个面板里多一页「速记」：整页只有几行字，看起来像随手记的草稿或日志尾巴。
看小说的时候，别人扫一眼只会以为你在翻面板；按快捷键翻页，收起面板就彻底没有痕迹。

- 支持 **txt**（UTF-8 / UTF-16 / GB18030 自动识别）与 **epub**（走 spine 顺序，读 NCX / nav 里的章节名）
- **只住在底部面板里**：面板收起、切到别的页，它就不显示，也不会变成浮窗留在页面上
- 行数**跟着面板高度自动算**：面板拉多高就显示几行，余数直接丢掉，不会露出半行
- 整行分页，书存在本地 IndexedDB 里，读完的位置按书记住，重开自动续读
- 无框架、无构建、无外部请求：一个宿主插件 + 两个原生 JS 文件

## 装上它

插件目录已经在 `profiles/web` 的 `dependencies`、`dsh.profile.bundles` 里登记好，
`node_modules/dsh-stealth-reader` 是指向本目录的 junction。**重启 DSH Desktop** 即可生效。

重新安装（换机器 / 换 profile）：

```powershell
& "C:\Users\Administrator\AppData\Roaming\dsh-desktop\harness\.desktop-bin\node.cmd" `
  "D:\Program Files (x86)\DSH\DSH Desktop\resources\app.asar\node_modules\@deepseek-ai\dsh\lib\bin.js" `
  plugin --profile web add "link:<本目录绝对路径>"
```

卸载：

```powershell
dsh plugin --profile web remove dsh-stealth-reader
```

## 怎么用

第一次装好之后，面板里的这一页会自己说明怎么导入（只在面板里说，不会往页面上浮东西）。

| 操作 | 默认键 | 说明 |
| --- | --- | --- |
| 收起 / 展开 | `Ctrl+Alt+H` | 一键让文字带消失或回来 |
| 立刻收起 | `Esc` | 有人过来时按这个，最快 |
| 下一屏 | `Ctrl+Alt+J` | 往下翻几行，到段底自动进下一段 |
| 上一屏 | `Ctrl+Alt+K` | 往回翻 |
| 书库 | `Ctrl+Alt+O` | 打开书目、导入、设置、改键位 |
| 行数 | 设置页或书库面板 | 默认「自动」：面板多高就显示几行；关掉自动才用手动值（2–40 行） |
| 字号 / 行距 / 字体 / 颜色 | 设置页或书库面板 | 10–24px、1.1–2.6 倍行距、五种字体、文字色 / 背景色 / 浓度，立刻重排 |
| 跟对话页完全一致 | 设置页或书库面板，一键 | 字体、字号、行距、颜色、背景全部抄对话区 |

只有这四组带修饰键的组合，没有「先进入某个模式」这一说——任何时候按都直接生效。

## 跟对话页完全一致

设置页（或书库面板）里有个「**跟对话页完全一致**」按钮。它做的不是「预置一套接近的数值」，
而是**当场量一次**对话区的 computed style，然后把自己调成同一套：

| 抄什么 | 从哪量 |
| --- | --- |
| 字体、字号、行距、文字颜色 | `[data-conversation-content]` 的 computed style（行距按 `line-height / font-size` 换成倍数） |
| 背景色与浓度 | 从正文节点往下往上找第一个不透明的祖先底色，连 alpha 一起抄 |

开了之后手动滑块会锁住（免得改一半变成四不像），窗口大小一变自动重量一次；
点同一个按钮就退出跟随，回到自己的字号与颜色。量不到对话区时（比如正停在设置页）会提示
「先随便发一句话」，不会有半截状态。

「只量一次看看」按钮只把量到的数字报给你，不改设置——想先确认一下再决定的时候用。

## 它住在哪：底部面板里的「速记」页

DSH 底部那条面板（`＋ 文件 / Git / 任务管理 / 侧边对话 / 终端`）是 `dsh-better-sidebar` 画的，
它把 `ctx.betterSidebar` 服务开放给了别的插件，所以这里走**官方口子**注册了一页：

```js
ctx.inject(['betterSidebar'], (sidebarCtx) => {
  sidebarCtx.betterSidebar.registerTab({
    id: 'dsh-stealth-reader:novel',
    title: '速记',            // 名字故意取中性一点，别把用途写在脸上
    description: '随手记几行字，关掉就收起',
    icon: memoIcon,          // 便签+笔，不是书本
    bottomOnly: true,        // 只在底栏出现
    single: true,            // 一本书一页，别开出一堆
    component: NovelTab,
  })
})
```

想换成别的名字（`备忘录` / `草稿` / `临时` 之类），改 `title` 一处即可；它只影响 `＋` 菜单里的那一行，
阅读本身不依赖这个名字。

- 面板的 `＋` 菜单里会多一项「**速记**」，点开就是正文；第一次装好时它会自己打开一次，让你知道这页在哪
- 正文会被**整块搬进面板**（同一个 Shadow DOM 宿主 append 进面板容器，`data-in-tab=1`），
  所以宽度、滚动、行数全都跟着面板走，不是「贴在面板上面」的假融合
- 面板里翻页还是那四组快捷键；抓手和右下角的进度提示照旧
- **收纳起来就是彻底没有**：切到别的页、收起面板，正文立刻从页面上消失（不会留一条浮窗）
- 没装 `dsh-better-sidebar` 就没有这一页（阅读器没有别的形态，装上它才能用）

导入也可以直接把 txt / epub **拖进面板里的这一页**。

## 在 DSH 设置里改

设置里有一个自己的分区：**设置 → 隐蔽阅读器**（和「外观」「插件」并列）。

- 顶部显示状态：正在读哪本书、第几段；旁边是「打开书库」「在底栏面板打开」「翻一页试试」
- 跟随对话页：一键对齐（见上一节），旁边能「只量一次看看」
- 显示：**自动行数**（默认开，面板多高就几行；关掉才用手动值 2–40 行）、字号（10–24px）、
  **行距（1.1–2.6 倍）**、**字体（默认 / 黑体 / 宋体 / 楷体 / 等宽）**、
  透明度（20–100%）、**文字颜色**、**背景颜色**、**背景浓度**（0–100%）、切换窗口时自动隐藏
- 快捷键：点一下右边的组合键就能重录，必须带 `Ctrl` 或 `Alt`，录制时 `Esc` 取消
- 「恢复默认」只重置设置，不会把书和阅读进度一起清掉

设置页和面板里的那一页活在同一个页面里，改完立刻重排重画，不用刷新。两边写的是同一份
`localStorage['dsh-reader:settings']`，所以在底部书库面板里改、在设置页里改，效果一致。

这些组合键在输入框里也照常生效，所以边打字边看小说不用先点别处；但裸字母键永远还给输入框。

其他操作：把 txt / epub **拖进窗口**就能导入（也可以点「打开书库」）；面板里右下角 30×26 的小热区
点一下开书库，在热区上滚滚轮就是翻页（鼠标也能偷偷翻）。

## 它长什么样

- 就是面板里的一整块：宽度 100%、没有圆角和外边距，跟「文件」「Git」那几页一个待遇；背景 `rgba(14,16,22,0.34)`，无边框无阴影
- 文字 13px、行高 1.55、颜色是 70% 白（可改），不显示滚动条、不换行号
- 行数按这一页的可用高度自动算，`(高度 - 30px 内边距) / 行高` 取整，余数丢掉——永远不会露出半行
- 整页 `pointer-events: none`，只有右下 30×26 的抓手可点，所以不会抢走面板里的点击
- 翻页时右下角浮出 1.5 秒的 `37% · 12/148` 提示，然后自动淡掉
- Shadow DOM 隔离，面板和站内的样式不会串进来，也不会被它们改掉

## 数据放在哪

| 内容 | 位置 |
| --- | --- |
| 书目（书名、作者、段数、字数、导入时间） | IndexedDB `dsh-reader` / `meta` |
| 正文（已切好的段落数组） | IndexedDB `dsh-reader` / `text` |
| 设置（行数、字号、键位、上次那本书） | `localStorage['dsh-reader:settings']` |
| 每本书读到哪 | `localStorage['dsh-reader:pos:<id>']` |

全部在本机浏览器存储里，插件不上传、不联网、不打日志。清空：书库面板里删书，或者
在开发者工具里删掉 `dsh-reader` 这个库。

## 结构

```
lib/index.js        宿主插件：注入 loader、注册 /dsh-reader/* 静态路由、tapIndex 兜底
lib/client.js       浏览器半侧（手写模块，无构建）：DSH 设置里的「隐蔽阅读器」一页 + 底栏面板的「速记」页
web/reader-core.js  解析层：解码、切章、html→文本、epub(zip+opf+ncx) 解析
web/reader-ui.js   界面层：Shadow DOM、整行分页、快捷键、书库、IndexedDB、进出面板的搬家逻辑
cordis.patch.yml   装载声明
samples/            两本示例书（同一故事的 txt 与 epub）
test/               四套测试 + 示例书生成器
```

宿主侧没有任何构建步骤：`lib/index.js` 直接读 `web/*.js` 原文吐给浏览器，用文件 mtime 做
`?v=` 缓存戳，全程 `Cache-Control: no-store`。

## 测试

```powershell
# 解析层（11 项，纯 node）
node test\test-core.mjs

# 宿主侧（5 项）：假 root / 假 webServer，跑 apply 并请求三个路由
& "$env:APPDATA\dsh-desktop\harness\.desktop-bin\node.cmd" test\test-host.mjs

# 界面层（30 项）：jsdom 里真跑 reader-ui.js，模拟按键、滚动、进出面板、翻页订阅、跟随页面
& "$env:APPDATA\dsh-desktop\harness\.desktop-bin\node.cmd" test\test-ui.mjs

# 浏览器半侧（12 项）：真 react + react-dom/server 渲染设置页与「速记」页，验注册形状与读到的设置
& "$env:APPDATA\dsh-desktop\harness\.desktop-bin\node.cmd" test\test-client.mjs
```

四套合计 58 项，全绿。

界面测试要用 Electron 自带的 node（它才带 jsdom）；`test-ui.mjs` 结尾会 `process.exit()`，
否则 jsdom 的定时器会让进程挂着不退。

## 出问题怎么看

- **重启后什么都没出现**：面板里那一页得先有书才画正文；没书时它会自己说明怎么导入。
  按 `Ctrl+Alt+O` 看能不能打开书库；能打开说明插件活了，只是没书。
- **设置里没有「隐蔽阅读器」**：DSH 的浏览器模块图只在启动时扫一遍 `dsh.client`，所以
  新装或新加设置页之后要**退出并重开一次 DSH Desktop**。重开后设置左侧导航里就会多一项。
- **按了快捷键没反应**：别的插件可能也占了同一组键。设置 → 隐蔽阅读器 → 快捷键，点一下要改的那项，
  按下新的组合（必须带 Ctrl / Alt / Meta）。
- **面板 `＋` 里没有「速记」**：需要 `dsh-better-sidebar` 0.26 以上（`bottomOnly` 选项是那时加的）；
  页面注册同样属于浏览器模块图，**新装插件后要重开一次 DSH Desktop**。
- **导入没反应**：确认扩展名是 `.txt` / `.epub`，epub 得是标准 zip（`mimetype` + `container.xml`）。
  加密的 epub（DRM）不支持。
- **想彻底确认注入成功**：浏览器开发者工具 Console 里应有 `[dsh-reader]` 前缀的报错（正常情况下没有输出）；
  Network 里能看到 `/dsh-reader/reader-core.js` 与 `/dsh-reader/reader-ui.js` 两个 200。
