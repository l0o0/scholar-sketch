# Markdown 编辑器上镜验证（md-spike）

结论先说：**能用真实的生产编辑器出片，而且可以任意前后跳转。** 推荐做法是 **(b) iframe 挂载**：用产品自己的父页面通信桥 `createMarkdownEditor()`，加载影片自己构建的编辑器页面（产品原来的 `addon/content/editor/index.html` 加原样的 `src/editor/bootstrap.ts`）。iframe 和影片同源，影片可以直接拿到 iframe 里的 `EditorView`，也可以同步发协议消息，所以每一帧都只由时间 t 决定。

(a) 直接挂载（不用 iframe）我也做通了，能渲染，也能真实输入。但 `[[` 补全弹层用的是 `position:fixed`，位置按窗口坐标和 `window.innerWidth` 算，放进 1.6 倍缩放的镜头后会**跑出画面**。它只能同时挂一个编辑器，而且和 Zotero 里的真实结构不一样。所以只留作对照（镜头 `mdx`）。

工作副本：`/tmp/claude-0/-home-user-scholar-sketch/9c397663-c3ff-50bd-93ba-f5baab301bbc/scratchpad/research/md-spike/film`（共享工程和产品仓库都没有改动，`git status` 为空）。

---

## 1. 真实入口（在产品仓库里找到的）

| 功能 | 源码 | 说明 |
|---|---|---|
| 编辑器本体 | `src/editor/bootstrap.ts` | CodeMirror 6。是 iframe 里的入口（插件打包成 `chrome://bamboo/content/editor/editor.js`）。依赖只有 `#editor-root` 和 `window.parent.postMessage`。模块级单例，一个页面只能有一个编辑器 |
| iframe 页面 | `addon/content/editor/index.html` | 影片原样复制，只把 script 改成 `md-editor.js` |
| 父页面通信桥 | `src/modules/markdown/editor.ts` → `createMarkdownEditor()`（第 165 行） | 建 iframe，收到 ready 后发 init（中文标签、字号、主题），并转发 outline / linkSearch / change |
| 协议 | `src/modules/markdown/editor-protocol.ts` | 会校验图标 URL：只允许 `chrome://zotero/skin/…` 和 `chrome://bamboo/content/icons/…` |
| 实时预览 | `src/editor/live-preview/*` | 标题、链接、表格、公式（KaTeX 输出 MathML）。脚注 `[^1]` 和 frontmatter 在实时预览里**本来就显示原文** |
| `[[` 补全弹层 | `src/editor/link-completion.ts` | 4 个筛选：全部 / 常规条目 / 笔记/附件 / 已打开。弹层是 `position:fixed`（第 84 行），用 `win.innerWidth/innerHeight` 限制位置（第 186 行） |
| 链接搜索（宿主侧） | `src/modules/markdown/document-links.ts` → `searchDocumentLinks()` | 真实的过滤和排序。影片里在 `packages/fake-zotero` 上运行 |
| 大纲侧栏 | `src/modules/markdown/outline-sidebar.ts` → `mountOutlineSidebar()` | 由编辑器发来的 outline 消息驱动 |
| 引用侧栏 | `src/modules/markdown/backlinks.ts` → `mountNoteBacklinks()` | 读取已保存的其它笔记，标题是「引用此笔记 (2)」 |
| 标签页外壳与 CSS | `src/modules/markdown/tab.ts` 的 `mountEditorUI()`（第 515 行）、`styles.ts` 的 `injectMarkdownStyles()` | 影片照搬 DOM 骨架的 class，CSS 直接调用 `injectMarkdownStyles(window)` |
| 浏览器开发入口 | `packages/whiteboard/markdown.html` + `src/dev/markdown-demo.ts` | fake Zotero 的适配写法照这里来 |

---

## 2. 可以直接用的配方

### 2.1 `integration.config.mjs`

```js
import path from 'node:path';
import {existsSync, readdirSync} from 'node:fs';
const repo = '/home/user/scholar-sketch';
const skinDir = new URL('./public/zotero-skin', import.meta.url).pathname;
const zoteroSkin = existsSync(skinDir) ? readdirSync(skinDir, {recursive: true}).map(f => String(f).split(path.sep).join('/')) : [];
export default {
  repoDir: repo,
  aliases: {'@zotero-plugin/fake-zotero': path.join(repo, 'packages/fake-zotero/src/index.ts')}, // dist 没装，直接用 TS 源码
  external: [],
  loaders: {'.ftl': 'text'},                                   // 读真实 zh-CN 文案
  define: {__ZOTERO_SKIN_FILES__: JSON.stringify(zoteroSkin)}, // 已提供的 Zotero 图标清单
  esbuild: {tsconfigRaw: {compilerOptions: {jsx: 'react-jsx'}}}, // 仓库 tsconfig 继承 zotero-types（没装）
  framePages: [{                                               // 编辑器自己的 iframe 页面
    entry: 'src/md/editor-frame.js', out: 'md-editor',
    html: {from: path.join(repo, 'addon/content/editor/index.html'), scriptPattern: /chrome:\/\/[^"]*\/editor\.js[^"]*/},
    css: '#editor-root .cm-editor.cm-focused{outline:none}',   // 见 §6
  }],
};
```

### 2.2 `build.mjs` 新增的一段（放在最后的 console.log 之前）

`framePages` 里的每一项都会单独打一个 IIFE 包，生成 `dist/<out>.js` 和 `dist/<out>.html`，并在 iframe 页面里注入冻结动画的 CSS。另外加了 `FILM_DEBUG=1 npm run build`，用来出不压缩、带 sourcemap 的包，方便查错。

```js
for (const pg of integration.framePages || []) {
  const r = await build({entryPoints: [pg.entry], bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic',
    outfile: path.join('dist', pg.out + '.js'), metafile: true, minify: !process.env.FILM_DEBUG, legalComments: 'none',
    nodePaths: [...(repoDir ? [path.resolve(repoDir, 'node_modules')] : []), path.resolve('node_modules')],
    alias: {...integration.aliases}, define: {'process.env.NODE_ENV': '"production"', 'process.env': '{}', ...integration.define},
    loader: {'.js': 'jsx', '.css': 'css', ...integration.loaders}, logLevel: 'error', ...(integration.esbuild || {})});
  await writeFile(`evidence/component-imports.${pg.out}.json`, JSON.stringify(r.metafile, null, 2));
  const freeze = '*,*::before,*::after{transition:none!important;animation-duration:0s!important;animation-delay:0s!important}';
  const html = (await readFile(pg.html.from, 'utf8')).replace(pg.html.scriptPattern, pg.out + '.js').replace('</style>', freeze + '\n' + (pg.css || '') + '\n</style>');
  await writeFile(path.join('dist', pg.out + '.html'), html);
}
```

### 2.3 iframe 里的入口 `src/md/editor-frame.js`

```js
import '/home/user/scholar-sketch/src/editor/bootstrap.ts';   // 原样的生产编辑器
import {EditorView} from '@codemirror/view';                   // 和 bootstrap 是同一份模块
window.__filmEditor = {view: () => { const d = document.querySelector('#editor-root .cm-editor'); return d ? EditorView.findFromDOM(d) : null; }};
import {watchLinkIcons} from './link-icons.js';
watchLinkIcons(document.documentElement);                     // chrome:// 图标 → 影片里的文件
```

### 2.4 父页面挂载 `src/md/editor-iframe.js`（要点）

```js
const handle = createMarkdownEditor(host, {             // 生产通信桥
  pageURL: new URL('md-editor.html', location.href).href, channel, doc, win: window,
  onOutline, onOutlineActive,
  onLinkSearch: (q, filter) => linkSearch(q, filter, frameView()?.state.doc.toString()), // 真实 searchDocumentLinks
});
const frameView = () => iframe.contentWindow.__filmEditor.view();
// 同步把协议消息送进 iframe（source = 影片 window = iframe 的 window.parent，能通过 bootstrap 的来源检查）
const sendSync = (type, payload) => { const W = iframe.contentWindow;
  W.dispatchEvent(new W.MessageEvent('message', {data: {source: 'zotero-markdown-editor', channel, v: 1, type, payload}, source: window})); };
// 主题：真实的偏好路径
fake.Zotero.Prefs.set('extensions.zotero.bamboo.theme', 'dark', true); applyMarkdownEditorPreferences();
// 模式：实时预览 → 源码用 handle.setMode('source')；源码 → 实时预览见 §5 的 bug，影片改为重新发一次 init
```

### 2.5 宿主适配 `src/md/zotero-host.js`

- `createFakeZotero({items})` 然后 `install()`。条目和文件的适配照抄 `src/dev/markdown-demo.ts`：`attachmentFilename`、`getFilePathAsync`、`Zotero.File.getContentsAsync`、`Attachments` 常量。
- 补齐 `ItemTypes.getLocalizedString`（中文：期刊文章 / 会议论文 / 图书 / 笔记）、`CreatorTypes.getID`、`getMainWindow().Zotero_Tabs.getState()`（供「已打开」筛选用）、`item.getImageSrc()` 和 `getItemTypeIconName()`。后者每种图标的名字必须不同，因为 `document-links.ts` 按这个名字缓存图标。
- 全局补 `addon` 和 `ztoolkit`。`addon.data.locale.current.formatMessagesSync` 接到 `addon/locale/zh-CN/addon.ftl`，所以产品里所有 `getString()` 都返回真实中文文案。

### 2.6 镜头视图（`src/shots/markdown.jsx`）

DOM 骨架和 `tab.ts mountEditorUI()` 用的 class 一致，真实 CSS 才能生效：

```jsx
<div className="md-frame"><div className="md-cam" style={{width: 1100, height: 600}}>
  <div className="zotero-markdown-tab-content md-tab"><div className="zotero-markdown-root mode-live theme-light">
    <div className="zotero-markdown-body">
      <nav className="zotero-markdown-outline-sidebar"><div className="zotero-markdown-sidebar-title">目录</div>
        <div className="zotero-markdown-outline-list" role="tree" /></nav>
      <div className="zotero-markdown-workspace"><div className="zotero-markdown-editor-host" /><div className="zotero-markdown-preview-host" /></div>
      <aside className="zotero-markdown-backlinks-sidebar" />
    </div><button className="md-outline-toggle" hidden aria-expanded="true" />
  </div></div></div></div>
```

builder 的顺序是：`injectMarkdownStyles(window)` → `mountOutlineSidebar` → `mountNoteBacklinks` → `mountIframeEditor` → `await ed.ready()`（等 ready、view 出现、iframe 字体加载完）→ 先把真实交互走一遍，记录下状态（§4）→ 最后 `onDrive('md', drive)`。

### 2.7 CSS 链

1. 影片页面：`injectMarkdownStyles(window)` 注入标签页 CSS 和明暗 token（`.zotero-markdown-root` / `.theme-dark`），包括大纲、引用侧栏、`.zmd-editor-wrap`、`.zmd-codemirror-iframe`。
2. iframe 页面：产品原来的 `index.html` 样式，加 CodeMirror 主题（`src/editor/theme.ts`，由 bootstrap 注入），再加冻结动画的 CSS 和隐藏焦点框的那一行。
3. `src/film.css` 只写外层：`.md-frame{position:absolute;left:80px;top:60px;transform-origin:0 0;transform:scale(1.6)}`、`.md-cam` 的圆角和阴影、镜头背景色。

### 2.8 演示数据（`src/md/fixture.js`，内容都是编的）

```markdown
---
title: 长文本检索阅读笔记
tags: [阅读笔记, 检索]
---
# 长文本检索阅读笔记

本周精读 [稀疏注意力与长文本检索](zotero://select/library/items/PAPER001)，并对照 [[检索增强综述--MDNOTE02|检索增强综述]] 里的结论。

## 关键结论

上下文从 4k 扩到 32k 后，召回率提升约 8.6 个百分点[^1]，注意力开销约为 $O(n \log n)$。

| 方法 | 召回率 | 显存占用 |
| --- | --- | --- |
| 稠密注意力 | 71.2% | 高 |
| 稀疏注意力 | 79.8% | 中 |

## 下一步

- [ ] 复现第 4 节的消融实验
- [x] 把结论放进研究白板

[^1]: 见原文表 3，测试集为 LongQA-zh。
```

演示文库里有 4 篇文献（作者 林知远、周可、沈一帆、陈默，都是编的），3 篇 Markdown 笔记（其中两篇反向链接到当前笔记，所以引用侧栏显示 2），1 个 PDF、1 条 Zotero 笔记、1 个 `.canvas` 白板。打开的标签页是 PDF 和当前笔记。

---

## 3. 尺寸：缩放系数是实测的

- 产品默认字号是 15px（`addon/prefs.js` 里 `fontSize 15`，通信桥默认也是 15）。编辑器内部把字号限制在 11–22px，所以不能靠调大字号来上镜，必须整体缩放。
- 要求正文 ≥ 22px，所以缩放至少 22/15 ≈ 1.47。**取 1.6**，原尺寸 1100×600 放大后是 1760×960（左右各留 80px，上下各留 60px）。
- 用 `getComputedStyle × iframe 实际缩放` 测得的画面字号：

| 元素 | 原尺寸 | 画面上 |
|---|---|---|
| 正文、表格 | 15px | **24px** |
| 一级标题 / 二级标题 | 26.25 / 21px | 42 / 33.6px |
| 大纲条目、引用正文 | 12px | 19.2px |
| 侧栏标题、引用标题 | 13px | 20.8px |
| `[[` 弹层：条目标题 / 筛选按钮 / 类型说明 | 12 / 11 / 10px | 19.2 / 17.6 / 16px |

- 侧栏和弹层的字在 1.6 倍时低于 22px。讲弹层的那一拍建议用摄像机推近到 ≥ 1.9 倍（2.0 倍时弹层标题 24px、筛选 22px），或者把取景收窄到编辑区加弹层。缩放只作用在外层包裹上，iframe 内部的位置计算不受影响，推近和平移都安全。

---

## 4. 真实交互：哪些能用、怎么做

| 交互 | 结果 | 做法 |
|---|---|---|
| 输入「另见 [[稀疏」 | ✅ | 每帧算出应有的文本，和当前 doc 做最小差异，用 `view.dispatch({changes, selection, userEvent:'input.type'})` 写入。产品自己的 updateListener 会触发 `requestLinkSearch`，真实弹层就出来了 |
| 补全弹层和真实搜索结果 | ✅ | 结果来自 `searchDocumentLinks`。「全部」有 6 条（期刊文章、会议论文、Markdown 文档、PDF、Canvas 白板、笔记）。弹层在 iframe 自己的视口里，位置正确（left 218px、top 235px） |
| 筛选：常规条目 / 笔记/附件 / 已打开 / 全部 | ✅ | **真实点击** `button[data-link-filter=…]`。结果分别是 2 / 4 / 2（PDF 和它的父文献）/ 6 条，都是产品逻辑算出来的 |
| 选中候选 | ✅ | **真实点击**第一行。插入 `[稀疏注意力与长文本检索](zotero://select/library/items/PAPER001)`，实时预览里显示成链接 |
| 大纲点击跳转 | ✅ | **真实点击**大纲里的「下一步」，走 `onNavigate`（和 `tab.ts navigateToOutlineItem` 一样：先 `setActive`，再 `revealPosition`）。编辑器滚到 231px |
| 实时预览 → 源码 | ✅ | `handle.setMode('source')`（生产通信桥）。显示行号和折叠箭头 |
| 源码 → 实时预览 | ⚠️ 产品报错 | 见 §5。影片用通信桥 ready 时的同一份 init 负载重建编辑器，并带上原来的选区和滚动位置 |
| 明 / 暗主题 | ✅ | 真实偏好路径：`Prefs theme=dark` 加 `applyMarkdownEditorPreferences()`。编辑器、两个侧栏、弹层一起变暗 |
| 合成键盘或输入事件 | 没有用 | CodeMirror 的文字输入走 contenteditable、DOMObserver 和 beforeinput，合成事件不可靠，**这次没测**。弹层的方向键和回车监听的是 host 上的 `keydown`，读的是 `event.key`，理论上可以用合成 KeyboardEvent，但这次用点击代替 |

**倒放和任意跳转（幂等）的做法**

- `wanted(local)` 只由时间算出：文本、光标、筛选、模式、主题、滚动位置、大纲当前项。`drive()` 逐项和实际状态比较，只在不同时才动手。
- builder 里先把真实交互按顺序走一遍，记录结果：`REC.chosen`（真实补全后的文本）、`REC.navScroll=231`、`REC.sourceScroll=81`，以及每一段的大纲当前项。往前播放到交互时刻时，是真的去点；直接跳到后面某一段时，就恢复记录下来的状态（设置 doc、`scrollTop`，或调用 `outline.setActive`）。
- 需要等的东西：
  - 弹层：等到 `aria-busy="false"` 且 `visibility:visible`，用来跳过「正在查找…」这一帧。
  - 大纲：产品在每次编辑后约 100ms 才重新发 outline（`bootstrap.ts` 第 1127 行的定时器），要等这条消息到了再点大纲，否则位置是旧的。
  - 焦点：等 `cm-focused` 出现后，光标和当前行高亮才会出来。
- 实测：12 个时间点按顺序出一遍，再打乱顺序出一遍，比较 PNG。9 帧逐像素相同；另外 3 帧只在 iframe 和镜头边缘的 1px 线上有差（最大 12/255，看不出来）。原因是 1.6 倍缩放让边缘落在小数像素上。想做到完全一致，可以把原尺寸调成放大后是整数像素。
- 速度：输入和筛选的帧每帧约 0.2–0.8 秒。`node render.mjs --from 4 --to 6` 的 60 帧草稿用了约 30 秒（含启动），成片是 `research/md-spike/renders/md-iframe-4to6.mp4`。

---

## 5. 发现的问题和阻碍

1. **阻碍：Zotero 自带的条目类型图标不在仓库里。** 期刊文章、会议论文、PDF、笔记这些图标来自 `chrome://zotero/skin/item-type/16/{light,dark}/*.svg`，是 Zotero 本体的文件，仓库里没有，npm 上也没有。插件自己的 Markdown 和 Canvas 图标在仓库里，已经正常显示。现在缺失的图标按产品自己的「没有图标」状态处理（隐藏图片、保留位置），不会出现 404，`render.mjs` 也不会因此失败。要补上，需要用户从 Zotero 安装包里提供这些 SVG（AGPL），放进 `public/zotero-skin/item-type/16/light|dark/`，重新构建就会自动用上。另外暗色主题应该用 `/dark/` 那一套，适配器现在固定返回 `light`，补图标时一起改一下。
2. **产品 bug（v0.2.9，可复现）：源码 → 实时预览会抛错。** 报错是 `RangeError: Field is not present in this state`，编辑器停在源码模式。位置在 `src/editor/live-preview/plugin.ts` 第 1015 行起的 `livePreviewMathDecorations.update`：这次重新配置的 transaction 既没有改文本也没有改选区，于是会去读 `transaction.startState.field(liveStructure)`，而源码模式的旧状态里没有这个字段。CodeMirror 在重新配置后会对新加入的字段也调用 `update(tr)`（见 `@codemirror/state` 的 `applyTransaction`）。`tab.ts setMode()` 也走同一条路，所以真实产品里应该也会出现。建议转告维护者，改成 `field(liveStructure, false)` 即可。影片里不要把「切回实时预览」当成用户操作来展示。
3. 大纲当前项在短文档里滚动时不会更新（只在 CodeMirror 视口变化时更新），这是产品本来的行为。点大纲时由 `navigateToOutlineItem` 直接设置当前项，影片照做。
4. 实时预览里 frontmatter 和脚注 `[^1]` 显示原文，这是真实行为。只有只读预览才会渲染脚注。拍「漂亮的预览」时可以把 frontmatter 滚出画面，或者拍只读预览模式。
5. 字体：容器里没有 PingFang SC 或 Noto Sans CJK。实测拉丁字母用 Inter，中文回退到 WenQuanYi Zen Hei。真实的 Windows / macOS 上会是 PingFang 或微软雅黑。要更接近真实观感，可以在影片工程里装一个 OFL 授权的中文字体（比如 Noto Sans SC），这需要导演决定，这次没做。
6. 标签页的工具栏和底部状态栏这次没有挂。它们在 `tab.ts` 里用 `ztoolkit.UI.createElement` 加 `icons.ts` 生成，下一步可以按同样的方式接入。
7. CodeMirror 基础主题的 1px 虚线焦点框，在 Chromium 里会画在 iframe 的上边和右边。产品截图里没有这条线，影片在 iframe 页面里把它隐藏了，这是纯显示层面的处理。
8. (a) 直接挂载的弹层：测得 `style.left=1301px`，但画面上落在 x≈2164，超出画面。另外 bootstrap 是单例，`document.getElementById('editor-root')` 只能找到一个编辑器。

---

## 6. 静帧（`research/md-spike/stills/`）

| 文件 | 内容 |
|---|---|
| `t004.00.png` | 首屏：大纲（目录，当前项「关键结论」）+ 实时预览（frontmatter、标题、论文链接、wiki 链接、公式、表格）+ 引用此笔记 (2) |
| `t005.00.png` | 正在输入「另见 [[稀疏」，当前行显示 Markdown 原文，真实补全弹层，筛选是「全部」，6 条 |
| `t006.00.png` | 真实点击「笔记/附件」后剩 4 条，Markdown 和 Canvas 图标是真的 |
| `t006.60.png` | 「已打开」：PDF 和它的父文献 |
| `t007.30.png` | 选中候选后插入了论文链接 |
| `t008.00.png` | 点大纲「下一步」后滚动，当前项变成「下一步」，可以看到任务列表复选框和脚注定义 |
| `t008.60.png` | 源码模式（行号、折叠箭头、等宽字体） |
| `t009.20.png` | 回到实时预览（用 init 重建的方式） |
| `t009.60.png` | 暗色主题：编辑器、大纲、引用侧栏都是产品的暗色 token |
| `x-dark-popup-t5.png` | 暗色主题下的补全弹层 |
| `t012.00.png` | 对照 (a) 直接挂载：同一时刻，弹层不在画面里 |

另外有 `research/md-spike/renders/md-iframe-4to6.mp4` 和 `md-iframe-4to6-sheet.png`（4–6 秒的草稿和联系表）。

---

## 7. 拷回共享工程的文件

前缀都是 `research/md-spike/film/`：

- `integration.config.mjs`（整份）
- `build.mjs`（新增 `framePages` 那一段和 `FILM_DEBUG` 开关，其余不变）
- `src/md/zotero-host.js`、`src/md/editor-iframe.js`、`src/md/editor-frame.js`、`src/md/link-icons.js`、`src/md/zh.js`、`src/md/fixture.js`
- `src/shots/markdown.jsx`（`makeMarkdownShot(id, 'iframe')` 是可以复用的工厂，正式片按 DIRECTION 改时间表 `T` 和取景）
- `public/addon-icons/*.svg`（从 `addon/content/icons/` 复制来的）
- `src/film.css` 末尾的 `.md-frame / .md-cam / .md-tab / #editor-root` 几条
- `evidence/component-usage.md-spike.json`（逐镜头的复用证据）
- 可选：`src/md/editor-inline.js`（只是对照，正式片不用）；`inspect-md.mjs`、`measure-md.mjs`（调试工具，用来打印某个时刻的产品状态和画面字号）

不要拷：`plan.json` 和 `src/shots/index.js`。这里是为了验证临时加了 `md` 和 `mdx` 两个镜头，时长 19 秒，正式片要按 DIRECTION.md 重写。
