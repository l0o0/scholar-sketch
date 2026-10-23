# Scholar Sketch 功能证据表（截至 v0.2.9）

- 产品：Scholar Sketch，Zotero 9 / 10 / 11 桌面插件（Markdown 笔记 + 研究白板）
- 版本：0.2.9（2026-10-19，`package.json` 与 CHANGELOG 一致）
- 范围：整个产品介绍；只有 Zotero 桌面插件一个平台面
- 本文件只做调研，没有改动产品仓库，也没有改动视频工程

---

## 0. 先说结论

1. 这支片子最有说服力的是一条完整的研究路线：**文献拖进白板 → 勾选 PDF 批注变成引文卡片 → 从引文写出观点 → 用 Markdown 写成笔记并互相链接 → 文件可以带走**。每一步都有真实组件，而且已经在浏览器里接通并截了中文静帧（见第 6 节）。
2. 最近的版本（v0.2.4–v0.2.9）适合做 2–3 个短镜头，不要当主线讲：**格式刷（v0.2.9）**、**形状文字自动字号（v0.2.8）**、**拖动时的智能参考线（v0.2.4）**、**`[[` 引用选择器的分类筛选（v0.2.7）**。
3. 白板组件 `WhiteboardApp` 默认是英文标签（`packages/whiteboard/src/whiteboard/app.tsx:282` 的 `DEFAULT_LABELS`），**必须传入中文 `labels`**。我已用产品自己的 `addon/locale/zh-CN/addon.ftl` 加上宿主映射 `src/modules/whiteboard/tab.ts:989-1250` 生成了 233 个中文标签，画面上的中文和真实插件一致。
4. Zotero 原生界面（条目列表、工具栏 XUL 菜单、右键菜单、条目侧栏、PDF 阅读器）不能在浏览器里挂载。这些只能做“外层取景”，文字必须用下面第 4 节列出的真实中文字符串。

---

## 1. 版本状态是怎么核对的

- 仓库是**浅克隆**：`.git/shallow` 里有 `0b14feb` 和 `eaf1930` 两个截断点，最早的提交是 2026-09-04，当时 `package.json` 已经是 0.1.7。所以 **0.1.7 以前的功能只能确定“≤0.1.7 已存在”，不能确定是哪一版首次上线**。
- 仓库**没有 git tag**。版本号是按 `package.json` 里 `version` 字段变化的提交来对应的（`git log -- package.json`）。
- CHANGELOG 只写了 0.1.0、0.1.3、0.2.7、0.2.9 四个版本。**0.2.4、0.2.5、0.2.6、0.2.8 只能从提交记录核对**。
- GitHub Release 有没有真的发布，本地无法核实（没有 tag，也没有联网查）。下表的“状态”写的是“已合并到 main + 版本号”。

| 版本 | 日期 | 对应提交 | 主要内容 |
| --- | --- | --- | --- |
| ≤0.1.7 | ≤2026-09-04 | `0b14feb` / `eaf1930`（浅克隆基线） | Markdown 编辑器、目录、表格、侧栏编辑器、白板、文献/引文卡片、批注浏览、自动布局 |
| 0.1.8 | 2026-09-25 | `69610a6` → `54f1c6f` | 反向链接、文库全文搜索、导出 Obsidian、本地历史、PDF 批注生成 Markdown、五种卡片与模板（`3a67a8a`）、示例白板（`460a67b`） |
| 0.2.0 | 2026-09-28 | `63f02ca` | 白板文件卡片（图片 / PDF / 文本等） |
| 0.2.1 | 2026-09-29 | `843ea3a` | 批量样式、Canvas API（`docs/canvas-api.md` 写的是“v0.2.2 起可用”，两处不一致） |
| 0.2.3 | 2026-09-29 | `ae266c5` | 中国传统色配色、Zotero 条目侧栏里的白板、外观设置 |
| 0.2.4 | 2026-10-09 | `87a2267` `aaadc9f` `6757a0b` `c563a5b` `b780bfa` `d9dc48a` `3796b44` → `2acdedd` | 智能吸附与对齐参考线、与 Zotero 同步协调、跨窗口保留草稿、性能 |
| 0.2.5 | 2026-10-12 | `f287cba` → `935c29c` | 支持 Zotero 11（`addon/manifest.json` `strict_max_version` 改为 `11.*`） |
| 0.2.6 | 2026-10-13 | `db8a1aa` → `1864c20` | 工具栏 Scholar Sketch 新建菜单 |
| 0.2.7 | 2026-10-15 | `7ee8390` | `[[` 引用分类筛选、拖线新建卡片、引文生成观点、加入分组、响应式工具栏、公式改进、导入/导出 Markdown |
| 0.2.8 | 2026-10-19 | `9f213a6` | 形状文字自动字号 |
| 0.2.9 | 2026-10-19 | `956fa2f` | 格式刷、复制样式 / 粘贴样式 |

---

## 2. 功能证据表

字段说明：**好处**用“谁做什么、得到什么”来写；**组件**是真正渲染这块界面的代码；**演示状态**是拍这个镜头需要准备的数据或操作；**限制**是不能证明或不能演示的部分。

### 2.1 Markdown 写作

| # | 功能 | 好处（白话） | 状态 / 版本 | 来源 | 组件 | 演示状态 | 限制 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| M1 | 实时预览 / 源码 / 只读预览三种模式，带目录和自动保存 | 研究者在 Zotero 里直接写 `.md` 笔记，标题、粗体、列表边写边显示成排版后的样子；需要时切到源码看原文 | 已合并；CodeMirror 6 编辑器 0.1.0，实时预览与目录 0.1.3，≤0.1.7 已有 | `CHANGELOG.md` 0.1.0 / 0.1.3；`addon/locale/zh-CN/addon.ftl:313-315`；`src/editor/bootstrap.ts:1679`（init）；`src/modules/markdown/outline-sidebar.ts:32` | 编辑器 iframe：`src/editor/bootstrap.ts` + `src/editor/live-preview/plugin.ts`；页面壳 `packages/whiteboard/markdown-editor.html`；宿主 `src/modules/markdown/editor.ts:165 createMarkdownEditor`（支持 `pageURL` 指向浏览器页面） | 已验证：把 `bootstrap.ts` 打包进 iframe，父页面用 postMessage 发 `init`（`channel` 走 URL 参数，`doc` 放中文笔记，`fontSize: 22`，`mode: "live"`）即可，静帧见第 6 节 | 模式按钮在中文界面里写的是 “Live / 源码 / 只读预览”，“Live” 本身是英文；中文上屏可用“实时预览”（`addon.ftl:260 sidebar-switch-live = 切换到实时预览`）。标签页外壳（工具栏、目录栏、状态栏）由 `src/modules/markdown/tab.ts` 依赖 Zotero 生成，没在浏览器里接通 |
| M2 | 表格、公式、任务列表、图片直接在实时预览里编辑 | 写阅读笔记时插入表格、公式和待办，看到的就是最终排版；表格可以在行列边缘增删、拖动 | 已合并；表格/图片 0.1.3，公式和脚注 ≤0.1.8，0.2.7 改进公式与图片 | `CHANGELOG.md` 0.1.3 / 0.2.7；`docs/markdown-canvas-release-features.md`（公式和脚注）；`addon.ftl:667-687`（表格操作） | `src/editor/table-menu.ts`、`src/editor/live-preview/math-syntax.ts`、`src/editor/image-controls.ts` | 已验证：中文表格、`$…$` 公式、`- [x]` 任务在 1920 宽下正常渲染 | **脚注在实时预览里仍显示源码 `[^1]`**，渲染后的脚注只在只读预览 / HTML 导出 / 白板卡片里出现。图片需要 `assetResolved` 回应才显示，演示要准备 data URL |

### 2.2 双链与引用

| # | 功能 | 好处（白话） | 状态 / 版本 | 来源 | 组件 | 演示状态 | 限制 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| L1 | `[[` 引用选择器（全部 / 常规条目 / 笔记/附件 / 已打开） | 写笔记时输入 `[[` 就能搜 Zotero 里的文献、笔记和白板，按 Tab 切换分类，回车插入链接，不用离开编辑器 | 已合并；`[[` 笔记链接 0.1.8；分类筛选、条目图标、第一作者、键盘操作 0.2.7 | `CHANGELOG.md` 0.2.7；`src/editor/link-completion.ts:63`（`createLinkCompletionPopup`，`.zmd-link-completion`）；`addon.ftl:278-283` | `src/editor/link-completion.ts`（在编辑器 iframe 内渲染） | 已验证：在编辑器里键入 `[[午睡`，iframe 发出 `linkSearch`，父页面回 `linkSearchResults`（3 条中文候选：Markdown 文档 / Zotero 条目 / Canvas 白板）后弹窗出现 | 中文分类名要通过 `init.payload.linkLabels` 传入，否则是英文默认值（`link-completion.ts:7`）。候选图标是 `chrome://` 地址，浏览器里加载不到，要换成 data URL 或不传。弹窗字号约 12px，需要放大 |
| L2 | 反向链接“引用此笔记” | 打开一篇笔记，右侧会列出所有链接到它的笔记和引用片段，点一下回到引用位置 | 已合并；0.1.8；0.2.7 加了索引诊断 | `docs/obsidian-links.md`“反向引用”；`src/modules/markdown/backlinks.ts:78 mountNoteBacklinks`；`addon.ftl:573-586` | `src/modules/markdown/backlinks.ts`（`mountBacklinksSidebar` / `mountNoteBacklinks`，样式 `src/modules/markdown/styles.ts backlinksSidebarCSS`） | 参考 `src/dev/markdown-demo.ts`：用 fake-zotero（源码 `packages/fake-zotero/src/index.ts`，dist 未构建，可以用 esbuild alias 指向源码）放 2–3 篇互相 `[[…]]` 的笔记 | 未在本次探针中接通。索引只基于已保存内容 |
| L3 | 搜索文库笔记 | 在“更多”菜单里搜整个文库的 Markdown 笔记标题和正文，点结果直接跳到命中位置 | 已合并；0.1.8 | `docs/markdown-canvas-release-features.md`“文库全文搜索”；`src/modules/markdown/search.ts:92 showNoteSearch`；`addon.ftl:629-633` | `src/modules/markdown/search.ts`（Zotero 窗口里的 DOM 对话框） | 需要用真实字符串重建对话框，或用 fake-zotero 挂载 | 依赖 Zotero 窗口；最多显示 100 条；画面价值低 |
| L4 | 导出到 Obsidian / Markdown | 一键把当前文库的笔记连同图片导出成普通文件夹，`[[链接]]` 保持可用，可以在 Obsidian 里直接打开 | 已合并；0.1.8；0.2.7 修复路径 | `docs/obsidian-links.md`“导出”；`src/modules/markdown/export-notes.ts:603 exportNoteLibrary`；`addon.ftl:588-592` | 无界面组件（导出逻辑 + 系统文件夹选择框）；`packages/whiteboard/markdown.html` 有“导出预览” | 可展示导出后的文件树（`文件名--KEY.md` + `assets/KEY/`）作为结果画面 | 不含块引用、嵌入、关系图；绝对路径和远程图片不复制，写进 `REPORT.md` |

### 2.3 研究白板

| # | 功能 | 好处（白话） | 状态 / 版本 | 来源 | 组件 | 演示状态 | 限制 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| W1 | 五种卡片：笔记 / 问题 / 观点 / 证据 / 总结 + 自定义模板 | 用不同颜色和边框区分“原文”和“自己的想法”：问题是暖黄虚线，观点是浅绿实线，证据是浅蓝方角，总结是淡紫 | 已合并；0.1.8（`3a67a8a`，2026-09-07） | `docs/architecture.md`“Note templates”；`packages/whiteboard/src/model/academic.ts:312`（`NOTE_TYPE_SURFACES`）；`addon.ftl:44-46,78-85`；教程表格 `addon.ftl:506-512` | `packages/whiteboard/src/nodes/academic.tsx:220 NoteNode`、`packages/whiteboard/src/chrome/NoteTemplateControls.tsx`、顶部“笔记”下拉 `packages/whiteboard/src/chrome/TopIsland.tsx:268` | 已验证：用 `createAcademicNode("note", …, { noteType })` 建中文卡片 | 卡片类型颜色是默认外观，不是保存在 `style` 里的（影响格式刷，见 R5） |
| W2 | 分组框、连线和连线文字、加入分组 | 把一组相关卡片放进一个分组框，从卡片边缘拉线连到另一张，线上写“支持”，推理过程就摆在画布上 | 已合并；分组/连线 ≤0.1.7；“加入分组”0.2.7 | `CHANGELOG.md` 0.2.7（explicit group membership）；`packages/whiteboard/src/chrome/GroupPicker.tsx:4`；`addon.ftl:167,690-695` | `FrameNode`（`nodes/academic.tsx:224`）、`ConnectionEditor.tsx:25`、`GroupPicker.tsx` | 已验证：fixture 用 `frameId` 放进分组；连线要写 `sourceHandle/targetHandle`（`"right"/"left"/"top"/"bottom"`），否则线会绕弯 | 学术连线的关系（相关 / 支持 / 反驳）只用于显示，**界面里没有关系下拉菜单**；用户自己画的线写的是自由文字。“相关”会显示在每条 related 连线上，画面会显得乱，可设 `label: ""` 隐藏 |
| W3 | 拖线新建卡片 | 从一张卡片的边缘把线拖到空白处松手，会自动新建一张笔记并连好线，想法可以一路往下写 | 已合并；0.2.7 | `CHANGELOG.md` 0.2.7（connection continuations）；`packages/whiteboard/src/whiteboard/continuation.ts:33 createConnectedNote`；`app.tsx:2976 onConnectEnd` | `WhiteboardApp` 内部（xyflow 连线事件） | 需要真实拖拽：从 handle 按下，拖到 `.react-flow__pane` 空白处松开 | 拖到卡片上松开是普通连线，不会新建 |
| W4 | 批量样式、中国传统色、自动布局、对齐、搜索、跨白板复制 | 多选卡片一次改描边和背景；“自动布局”把选中的卡片排整齐；`Ctrl/Cmd+F` 搜卡片 | 已合并；自动布局/搜索/复制 ≤0.1.8，批量样式 0.2.1，中国传统色 0.2.3 | `docs/markdown-canvas-release-features.md`；`packages/whiteboard/src/chrome/BatchStyleMenu.tsx:19`；`packages/whiteboard/src/model/colorSchemes.ts`；`packages/whiteboard/src/whiteboard/layout.ts:110`；`addon.ftl:178,385,626,651` | `BatchStyleMenu.tsx`、`TopIsland.tsx`（“更多”菜单 456-624 行）、`WhiteboardApp` | 多选 2–3 张卡片后弹出批量样式；`colorScheme="traditional"` 是默认值 | 画面上是常见功能，单独成镜头信息量不大 |
| W5 | 文件卡片（图片、PDF、文本） | 把图片、PDF 或截图拖进白板，图片可以放大看，PDF 显示类型和页数，文件随白板一起保存 | 已合并；0.2.0 | `docs/markdown-canvas-release-features.md`“当前边界”；`packages/whiteboard/src/whiteboard/file-import.ts:129`；`packages/whiteboard/src/nodes/library.tsx:116 AttachmentNode`；`addon.ftl:49-64` | `AttachmentNode` / `PdfNode`（`nodes/library.tsx`） | fixture 里放 data URL 图片即可 | 单个文件 ≤15 MB、每批 ≤30 MB；不解析 PDF 全文 |
| W6 | 导出 PNG / SVG / Markdown，示例白板 | 整张白板可以导出成 2× 高清图片分享；第一次用可以从“帮助”菜单生成一块中文示例白板 | 已合并；PNG ≤0.1.8（`5a61343`），示例白板 0.1.8 | `packages/whiteboard/src/whiteboard/png.ts:54`、`export.ts:260,616`；`packages/whiteboard/src/model/tutorial.ts:72 tutorialCanvasDocument`；`src/modules/whiteboard/menu.ts:46`；`addon.ftl:25,192-194` | `TopIsland.tsx:575-601`（导出菜单项）、`tutorialCanvasDocument` | 已验证：`tutorialCanvasDocument(中文标签)` 直接生成一块 25 个节点的中文示例白板 | 示例白板内容是插件自带的教学文字，不适合当“研究成果”画面，适合当片头或空镜参考 |

### 2.4 Zotero 集成

| # | 功能 | 好处（白话） | 状态 / 版本 | 来源 | 组件 | 演示状态 | 限制 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Z1 | 把 Zotero 文献拖进白板，生成文献卡片 | 从 Zotero 条目列表把一篇论文拖到白板上，卡片上带标题、作者、年份、期刊、标签和批注数；点“打开来源”回到 Zotero 原条目 | 已合并；≤0.1.7（`source-gateway.ts` 在基线 `eaf1930` 中） | `docs/architecture.md`“Academic source workflow”；`addon.ftl:43,126`；教程文字 `addon.ftl:30` | `packages/whiteboard/src/nodes/academic.tsx:26 LiteratureNode`；运行时接口 `runtime.beginAcademicDrop` + `runtime.resolveAcademicAcquisitionBatch`（`app.tsx:580` 一带） | 已验证文献卡片的中文渲染。拖入动作：在 `onReady` 拿到 runtime，先 `beginAcademicDrop(requestId, nodeId, position, sources)`，再用虚构的 literature acquisition 调 `resolveAcademicAcquisitionBatch`（这是真实代码路径） | Zotero 条目列表是原生界面，拖出的那一段只能做外层取景。fixture 要用虚构文献，标明“示例” |
| Z2 | 查看批注 → 添加所选批注 → 引文卡片 | 在文献卡片上点“查看批注”，弹窗列出 PDF 里的高亮和评论（带颜色和页码），勾选后点“添加所选批注”，每条变成一张引文卡片 | 已合并；≤0.1.7 / 0.1.8 | `docs/architecture.md`；`packages/whiteboard/src/chrome/AnnotationBrowser.tsx:104`；`packages/whiteboard/src/chrome/PropertiesPanel.tsx:403`；`addon.ftl:129-139` | `AnnotationBrowser.tsx`、`QuoteNode`（`nodes/academic.tsx:69`）、`PropertiesPanel.tsx` | 已验证：选中文献卡片 → 样式条最后的“详细属性” → “查看批注”；`onListLiteratureAnnotations` 回调里用 `runtime.applyAnnotationCandidates` 返回 3 条虚构批注，弹窗中文正常，已添加的显示“已添加 / 定位已有引文” | 只支持有文字的高亮和下划线；对话框字号约 13px，需放大。“打开来源”跳 PDF 阅读器只能在真实 Zotero 里看到 |
| Z3 | 从这条批注新建观点 / 证据笔记 | 右键一张引文卡片，选“从这条批注新建观点”，旁边出现一张观点卡片并自动连线，原文和自己的看法分开放 | 已合并；0.2.7 | `CHANGELOG.md` 0.2.7（annotation-to-note creation）；`packages/whiteboard/src/whiteboard/continuation.ts:94 createNoteFromQuote`；`app.tsx:5368-5399`；`addon.ftl:696-697` | `WhiteboardApp` 右键菜单 | 右键引文卡片 → 点菜单项 | 无 |
| Z4 | 从 PDF 批注生成 Markdown | 在文献或 PDF 上右键“从 PDF 批注生成 Markdown…”，勾选批注后生成一篇笔记，里面有摘录、评论和能跳回 PDF 的页码链接 | 已合并；0.1.8 | `docs/markdown-canvas-release-features.md`；`src/modules/markdown/annotations.ts:15 annotationMarkdown`、`:63 showAnnotationExport`；`src/modules/markdown/menu.ts:38`；`addon.ftl:634-641` | 对话框是 Zotero 窗口里的 DOM（`annotations.ts`）；生成的笔记可以用编辑器 iframe 展示 | 可用 `annotationMarkdown()`（纯函数）把虚构批注生成真实格式的 Markdown，再放进编辑器 | 只读文库不能创建；不导出图片批注；右键菜单是原生界面 |
| Z5 | 工具栏“Scholar Sketch”菜单、从分类新建白板、最近打开的白板 | 在 Zotero 主工具栏点 Scholar Sketch 按钮，就能新建 Markdown 笔记或白板；选中一个分类可以把整类文献一次做成白板 | 已合并；工具栏按钮 0.2.6，“从分类新建白板 / 最近打开的白板”收进工具栏 0.2.7（功能本身 ≤0.1.7） | `src/modules/creation-toolbar.ts:73-117`；`src/modules/whiteboard/menu.ts:75,125`；`addon.ftl:1-2,8-10`；图标 `addon/content/icons/scholar-sketch-toolbar.svg` | XUL 工具栏菜单（原生，不能挂载） | 用真实图标和中文菜单字符串重建菜单外形 | 原生界面，只能重建取景 |
| Z6 | Zotero 条目侧栏里的 Markdown 和白板 | 在 Zotero 右侧条目面板里直接编辑这篇文献的 Markdown 附件，或打开它的白板，不用另开标签页 | 已合并；Markdown 侧栏 0.1.3，白板侧栏 0.2.3 | `CHANGELOG.md` 0.1.3；`src/modules/markdown/sidebar.ts:112`；`src/modules/whiteboard/sidebar.ts:204`；`addon.ftl:253-268,658-665` | `Zotero.ItemPaneManager.registerSection`（原生） | 用编辑器 iframe 的 `surface: "sidebar"` 模式可以拍窄栏样子 | 侧栏外框是 Zotero 原生 |

### 2.5 文件与安全

| # | 功能 | 好处（白话） | 状态 / 版本 | 来源 | 组件 | 演示状态 | 限制 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| F1 | 普通 `.md` 和 JSON Canvas `.canvas` 文件，跟着 Zotero 同步 | 笔记和白板都是 Zotero 附件，用开放格式保存，换工具也能打开；存储附件跟着 Zotero 文件同步走 | 已合并；格式 ≤0.1.7；与同步协调 0.2.4（同步未完成时暂停写入） | `README.md`“Portable files”；`docs/canvas-api.md`（JSON Canvas 1.0）；`src/modules/attachment-sync.ts`（`b780bfa`、`c563a5b`）；`addon.ftl:616` | 无界面（附件图标 `addon/content/icons/attachment-markdown.svg`、`attachment-canvas.svg`） | 可用附件图标 + 文件名做结果画面 | 链接附件需要自己同步；`.canvas` 里的 Scholar Sketch 扩展字段别的软件不一定读 |
| F2 | 自动保存、本地历史、冲突保护、重启后恢复打开的文档 | 每次保存前留一个本地版本（最多 50 个）；文件在外面被改过时停止覆盖，草稿留在“本地历史”；重开 Zotero 时自动打开上次的文档 | 已合并；0.1.8；0.2.4 增加“同步期间保留的草稿” | `docs/file-safety.md`；`src/modules/file-safety.ts`（`HISTORY_LIMIT = 50`）；`src/modules/file-history-ui.ts:5`；`src/modules/workspace-state.ts:96`；`addon.ftl:609-624` | 对话框是 Zotero 窗口里的 DOM（`file-history-ui.ts`） | 可重建“本地历史”对话框，或只用状态栏文字“已自动保存” | 历史只在本机，不同步；不是跨进程文件锁；画面价值低 |

### 2.6 最近更新 v0.2.4–v0.2.9

| # | 功能 | 好处（白话） | 状态 / 版本 | 来源 | 组件 | 演示状态 | 限制 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R1 | 智能吸附与对齐参考线 | 拖动卡片时，靠近别的卡片边缘会出现对齐线和等距提示，松手自动贴齐；按住 Alt 可以自由移动 | 已合并；v0.2.4（`87a2267`，2026-10-06） | `packages/whiteboard/src/whiteboard/smartGuides.ts`（吸附距离 6 屏幕像素，`:53`）；`SmartGuideOverlay.tsx:10`；`chrome/shortcuts.ts`；`addon.ftl:233-235` | `SmartGuides`（`SmartGuideOverlay.tsx`），在 `app.tsx:5095` 挂载 | 已验证：从卡片标题区按下拖动并回到对齐位置，`[data-testid="smart-guides"]` 出现 | 参考线是 1px 细线，远景看不清，要近景或放大 |
| R2 | 和 Zotero 同步协调、跨窗口不丢草稿、性能改进 | 同步还没下载完的附件不会被覆盖；在标签页、独立窗口、侧栏之间切换时草稿不丢；大白板更流畅 | 已合并；v0.2.4（`b780bfa` `c563a5b` `aaadc9f` `6757a0b`） | 各提交说明；`src/modules/attachment-sync.ts`；`src/modules/whiteboard/surface-transfer.ts` | 无可见界面（只有提示文字 `addon.ftl:616`） | 不适合画面 | 只能文字说明；`6757a0b` 的性能数字是测试数量，不是速度数字，不要上屏 |
| R3 | 支持 Zotero 11；工具栏新建菜单 | 装了 Zotero 11 也能用；在工具栏一个按钮里新建笔记或白板 | 已合并；Zotero 11 v0.2.5（`f287cba`），工具栏 v0.2.6（`db8a1aa`） | `addon/manifest.json:16-17`；`src/modules/creation-toolbar.ts` | 原生 | 片尾“支持 Zotero 9 / 10 / 11”可以用 | 无 |
| R4 | v0.2.7 写作与白板细化 | `[[` 选择器分类筛选（L1）、拖线新建卡片（W3）、引文生成观点（Z3）、加入分组（W2）、窄窗口时工具栏自动分组 | 已合并；v0.2.7（`7ee8390`，2026-10-15） | `CHANGELOG.md` 0.2.7；`src/modules/markdown/responsive-toolbar.ts`；`addon.ftl:699-701`（标题 / 文本格式 / 插入） | 见各行 | 见各行 | 见各行 |
| R5 | 形状文字自动字号 | 在矩形、椭圆或菱形里写字，字号会跟着形状大小自动变（16–64），字多了会自动缩小装下 | 已合并；v0.2.8（`9f213a6`，2026-10-19） | `packages/whiteboard/src/model/text-layout.ts:81 automaticShapeFontSize`；`chrome/TextStyleBar.tsx`（字号选项“自动”）；`addon.ftl:656` | `RectNode` / `EllipseNode`（`nodes/shapes.tsx:159,192`）+ `TextStyleBar.tsx` | 建一个 `rect` 节点，不设 `fontSize`，用 runtime 改尺寸（或真实拖拽缩放）就能看到字变大变小 | 只对形状生效，卡片不变；最小 14，再长会溢出 |
| R6 | 格式刷、复制样式 / 粘贴样式 | 选中一张卡片点“格式刷”，再点另一张，颜色、边框和文字样式就复制过去，内容、文献引用和尺寸不变；双击格式刷可以连续刷，按 Esc 退出 | 已合并；v0.2.9（`956fa2f`，2026-10-19，最新版本） | `CHANGELOG.md` 0.2.9；`packages/whiteboard/src/chrome/FormatPaintButton.tsx`；`packages/whiteboard/src/model/style-transfer.ts`；`chrome/StyleBar.tsx:112`；提示条 `app.tsx:5527-5556`；光标与高亮 `whiteboard/board.css:735-770`；`addon.ftl:147-155` | `FormatPaintButton`（在 `StyleBar` 里）、`WhiteboardApp` 的格式刷状态和提示条 `.zmd-board-format-status` | 已验证：选中观点卡片 → 双击格式刷 → 提示条显示“连续格式刷 · 点击目标应用 · Esc 退出” → 依次点问题卡片和总结卡片，两张都变成同样的红色描边和底色，正文和类型不变（静帧见第 6 节） | **源卡片必须有手动样式**（`style` 里的 fill / stroke / textColor 等）。只用卡片类型默认颜色的卡片，刷过去不会有变化（`style-transfer.ts` 只复制手动覆盖值）。目标保留自己没被覆盖的属性（例如问题卡片的虚线）。直线和箭头不支持 |

---

## 3. 片子价值排序（给第一次接触的 Zotero 用户，45–60 秒）

按“新用户看完能说出它是什么、和我的文献有什么关系、我能得到什么”排序：

| 排名 | 功能组 | 包含 | 为什么值得放 | 建议时长 |
| --- | --- | --- | --- | --- |
| 1 | **文献进白板**（Zotero 集成） | Z1 拖入文献卡片 + Z2 查看批注 → 引文卡片 + Z3 从批注新建观点 | 这是它和普通白板、普通笔记软件最不一样的地方：卡片直接来自 Zotero 文献和 PDF 高亮，带页码和来源。动作清楚（拖、勾选、添加），而且三段都已用真实组件接通 | 10–14 秒 |
| 2 | **五种卡片把思路摆出来**（研究白板） | W1 五种卡片 + W2 分组和连线（线上写“支持”）+ W3 拖线新建 | 颜色区分“原文 / 问题 / 观点 / 证据 / 总结”，一眼看懂“研究白板”是什么；画面有层次，适合做大景 | 8–10 秒 |
| 3 | **在 Zotero 里写 Markdown，并互相链接**（写作 + 双链） | M1/M2 实时预览（表格、公式、待办）+ L1 `[[` 引用选择器 + L2 引用此笔记 | 交代产品的另一半：笔记。`[[` 弹窗能同时搜到文献、笔记和白板，把“写”和“读”接起来。编辑器和弹窗已接通，反向链接需要再接 | 8–12 秒 |
| 4 | **最新版本的小改进**（v0.2.4–v0.2.9） | R6 格式刷（v0.2.9）+ R5 自动字号（v0.2.8）+ R1 对齐参考线（v0.2.4） | 证明产品一直在更新，动作短、反馈明显（一刷就变色），适合 2–3 个 2–4 秒的小镜头 | 6–9 秒 |
| 5 | **文件能带走**（文件与安全） | F1 `.md` / `.canvas` 开放格式 + L4 导出到 Obsidian + W6 导出 PNG | 研究者在意“数据锁不锁死”。可以用一个结果画面（文件夹 / 导出的图片）收尾前带过 | 3–5 秒 |
| 6（可选） | 保存与恢复 | F2 自动保存、本地历史、冲突保护 | 是信任点，但几乎没有画面，适合一行小字或直接省略 | 0–3 秒 |

建议的故事顺序（只是建议，方向由 DIRECTION.md 决定）：**读（批注）→ 整理（白板卡片）→ 写（Markdown + 双链）→ 越用越顺手（最新改进）→ 带走（开放格式 + 支持 Zotero 9/10/11）**。产品 logo 的英文副标是 “Read · Organize · Think”（`docs/icons/scholar-sketch-logo.png` 的 alt 文本），仓库里没有对应的中文版；如果片子要用“阅读 · 整理 · 思考”，要注明这是我们翻的，不是产品原文。

不建议上屏的：Canvas / Markdown API（面向开发者）、性能改进（没有可演示的数字）、同步协调细节、示例白板的教学文字。

---

## 4. 关键控件的真实中文字符串

全部来自 `addon/locale/zh-CN/addon.ftl`（行号）。上屏文字提到这些控件时请原样使用。

**入口**
- 工具栏按钮提示：`Scholar Sketch：新建 Markdown 笔记或白板`（1）
- 菜单：`新建 Markdown 笔记…`（2）、`新建白板…`（8）、`从分类新建白板…`（9）、`最近打开的白板`（10）、`导入 Markdown…`（703）、`导出选择MD文件…`（704）
- 帮助菜单：`Scholar Sketch：创建示例白板`（25）
- 右键菜单：`从 PDF 批注生成 Markdown…`（634）→ 按钮 `生成 Markdown 笔记`（637）

**白板**
- 顶部工具栏：`选择 (V)`、`抓手 (H)`、`添加 Zotero 资料`（43）、`文件`、`笔记`（下拉）、`框架 (F)`、`文字 (T)`、`形状与绘图`、`撤销`、`重做`、`更多`、保存状态 `已保存`（189）
- 卡片类型：`笔记` `问题` `观点` `证据` `总结`（44-46、78-79）；来源卡片：`文献` `引文`（73-74）；分组：`框架`（98）
- 卡片空白提示：`我想弄清楚什么？`、`我的看法是什么？为什么？`、`哪段原文、数据或案例值得保留？`、`有哪些共识、分歧和待解问题？`（82-85）
- 文献卡片底部：`3 条批注`（批注数 + `条批注`，100-104）
- 详细属性面板：`打开来源`（126）、`查看批注`（129）、`加入分组`（690）、`移出分组`
- 批注弹窗：标题 `批注`（130）、`搜索批注`（131）、`已添加`（136）、`定位已有引文`（137）、`添加所选批注`（138）、`页码`（139）
- 引文右键：`从这条批注新建观点`（696）、`从这条批注新建证据笔记`（697）
- 连线关系显示：`相关` `支持` `反驳`（175-177）
- 格式刷：按钮 `格式刷`（149），悬停提示 `单击使用一次，双击连续使用`（151），提示条 `点击目标应用样式 · Esc 退出`（152）/ `连续格式刷 · 点击目标应用 · Esc 退出`（153），关闭按钮 `退出格式刷`（154），右键 `复制样式` `粘贴样式`（147-148），反馈 `已复制样式`（155）
- 字号选项：`自动`（656）
- 更多菜单：`搜索白板`（626）、`复制选区副本`（627）、`自动布局`（178）、`导出 PNG` `导出 SVG` `导出 Markdown`（192-194）、`适应画布`（166）
- 快捷键说明：`自由移动（暂时关闭吸附）`（233）
- 批量样式：`批量样式`（651）；配色：`中国传统色` / `经典`（385-386）
- 示例白板分组标题：`五种卡片，一条思路`（37）

**Markdown**
- 模式：`Live` / `源码` / `只读预览`（313-315）；侧栏提示 `切换到实时预览`（260）
- 工具栏分组：`标题` `文本格式` `插入`（699-701）
- 状态栏：`已自动保存`（325）、`已保存`
- 目录：`目录`（284）
- `[[` 选择器分类：`全部` `常规条目` `笔记/附件` `已打开`（278-281），空结果 `没有匹配的条目`
- 候选类型：`Markdown 文档` `Canvas 白板` `Zotero 条目` `Zotero 笔记` `附件`（273-277）
- 反向链接：`引用此笔记`（573）、`刷新链接`（575）
- 更多菜单：`搜索文库笔记…`（629）、`导出到 Obsidian…`（588）、`导出到 Markdown…`（590）、`本地历史…`（624）
- 冲突提示：`文件已在编辑器外被修改，已停止覆盖。当前草稿可在附件右键菜单的“本地历史”中恢复。`（609）

注意：
- README 中文版写的是“Live 即时预览”，界面按钮是 “Live”，侧栏写“实时预览”。全中文片子建议统一用**实时预览**。
- 白板右下角缩放按钮的提示（Zoom In / Zoom Out / Fit View）来自 xyflow，是英文，但画面上只有图标，不影响。

---

## 5. plainExplanation 草稿（未定稿）

按 story-and-copy.md 的规则写：对象 + 动作 + 看得到的结果，不写空话。标题只给中文（用户要求全中文）。都需要在 `evidence/copy-review.md` 里再做一遍试读。

| 功能组 | 标题草稿 | plainExplanation 草稿 | 依据 |
| --- | --- | --- | --- |
| Z1 文献进白板 | 文献直接拖上白板 | 把 Zotero 里的一篇文献拖到白板上，会生成一张文献卡片，标题、作者、年份和批注数都在上面。 | Z1 |
| Z2 批注变引文 | PDF 高亮，变成引文卡片 | 在文献卡片上点“查看批注”，勾选 PDF 里的高亮，再点“添加所选批注”，每条高亮都会变成一张带页码的引文卡片。 | Z2 |
| Z3 引文到观点 | 从原文，写出自己的看法 | 右键引文卡片，选“从这条批注新建观点”，旁边会多出一张观点卡片，并且自动连上线。 | Z3 |
| W1 五种卡片 | 五种卡片，一条思路 | 笔记、问题、观点、证据、总结五种卡片颜色和边框各不相同，一眼就能分清哪些是原文，哪些是自己的想法。 | W1（“五种卡片，一条思路”是产品原文 `addon.ftl:37`） |
| W2/W3 分组连线 | 把推理过程摆出来 | 把相关卡片放进同一个分组框，从卡片边缘拉一条线到另一张卡片，在线上写“支持”；拖到空白处松手，还会直接新建一张卡片。 | W2、W3 |
| M1/M2 写 Markdown | 在 Zotero 里写 Markdown | 在 Zotero 里打开一篇 Markdown 笔记，表格、公式和待办会直接显示成排好版的样子，修改会自动保存。 | M1、M2 |
| L1 `[[` 引用 | 输入 [[，引用文献和笔记 | 写笔记时输入 [[，就能搜到文库里的文献、笔记和白板，用“全部 / 常规条目 / 笔记/附件 / 已打开”筛选，按回车插入链接。 | L1 |
| L2 反向链接 | 看见谁引用了这篇笔记 | 打开一篇笔记，右侧“引用此笔记”会列出所有链接到它的笔记，点一下就回到引用的位置。 | L2 |
| R6 格式刷 | 格式刷，一点就同步样式（v0.2.9） | 选中一张卡片，点“格式刷”，再点另一张卡片，颜色、边框和文字样式就复制过去，卡片内容和文献引用不变；双击格式刷可以连续刷。 | R6 |
| R5 自动字号 | 形状里的字，自动调大小（v0.2.8） | 在矩形或椭圆里写字，拉大或缩小形状时，字号会跟着变，字多了会自动缩小装进去。 | R5 |
| R1 对齐参考线 | 拖动时自动对齐（v0.2.4） | 拖动卡片时，靠近其他卡片会出现对齐线，松手就贴齐，白板不会越摆越乱。 | R1 |
| F1/L4 开放格式 | 笔记和白板，都能带走 | 笔记是普通的 .md 文件，白板是 JSON Canvas 格式；可以把文库笔记连同图片导出到 Obsidian，也能把白板导出成 PNG 图片。 | F1、L4、W6 |
| 片尾 | 支持 Zotero 9 / 10 / 11 | Scholar Sketch 是 Zotero 9、10、11 桌面版插件，从“工具 → 插件”里安装。 | `README.md`“Install”；`addon/manifest.json` |

可能踩的坑：
- “更清晰”“更顺手”“一气呵成”这类词没有证据，不要用。
- 不要说“AI”，产品没有 AI 功能（PRODUCT.md 只说用户“常配合 AI 工具”使用）。
- 不要写同步“实时”“云端”。同步靠 Zotero 自己的文件同步，本地历史不同步。
- 不要说导出“完全兼容 Obsidian”。文档写明不含块引用、嵌入和关系图。

---

## 6. 组件接入探针（已实测）

为了确认上面的“演示状态”能做到，我在 scratch 目录里用视频工程已装好的 esbuild 0.27.3 和 playwright 1.56.1（只读引用，没有改视频工程）直接挂载了产品的真实组件。

**白板探针**：`research/features/probe/`
- `gen-labels.mjs`：从 `addon/locale/zh-CN/addon.ftl` + `src/modules/whiteboard/tab.ts:989-1250` 生成 `labels-zh.json`（233 个键），从 `src/modules/whiteboard/tutorial.ts:337-373` 生成 `tutorial-labels-zh.json`。
- `entry.tsx`：直接渲染 `WhiteboardApp`，传中文 `labels`、`initialSnapshot`、空回调；`onReady` 拿到 runtime。**没有用 `devHost.ts`**，因为它依赖 `@zotero-plugin/fake-zotero` 的 dist（没构建）。
- `fixture.ts`：只用产品自己的 `createAcademicNode` / `createAcademicConnection` 建了一块虚构的中文研究白板（“午睡对记忆巩固的影响（示例文献）”，作者“示例作者”，没有冒充真实论文）。
- `build.mjs` 要点：`nodePaths` 指向 `packages/whiteboard/node_modules` 和根 `node_modules`；`tsconfigRaw.compilerOptions.verbatimModuleSyntax = false`（白板 tsconfig 里是 true）；`jsx: automatic`；CSS 由 `app.tsx` 自己 import（`@xyflow/react/dist/style.css` + `board.css`）。
- `painter.mjs` / `annot.mjs` / `guides.mjs`：用真实点击驱动格式刷、批注弹窗和拖动参考线。

**Markdown 探针**：`research/features/probe-md/`
- `frame.ts` 只 import `src/editor/bootstrap.ts`；`editor.html?channel=demo` 是 iframe 页面；`host.html` 收到 `ready` 后发 `init`，并回应 `linkSearch`。

**静帧**（都是 1920×1080，真实组件，中文标签）：
- `probe-whiteboard-zh-light.png`：`tutorialCanvasDocument` 生成的中文示例白板（25 个节点）
- `probe-research-zh.png`：虚构研究白板（文献、引文、问题、观点、总结、分组框、“支持”连线）
- `probe-stylebar-zh.png`：选中卡片后的样式条（第二个按钮就是格式刷）
- `probe-format-painter-zh.png`：连续格式刷进行中，提示条“连续格式刷 · 点击目标应用 · Esc 退出”，源卡片虚线框、目标卡片实线高亮
- `probe-format-painter-applied-zh.png`：刷完两张卡片后的结果
- `probe-annotation-browser-zh.png`：“批注”弹窗，3 条虚构批注，含“已添加 / 定位已有引文 / 添加所选批注”
- `probe-smart-guides-zh.png`：拖动时左边缘对齐参考线
- `probe-markdown-live-zh.png`：实时预览（中文标题、表格、公式、任务列表、`[[链接]]` 显示为“综述”）
- `probe-markdown-link-picker-zh.png`：`[[` 选择器弹窗，四个中文分类和三类候选

**探针发现的问题（制作时要处理）**
1. **字号不够 22px**。白板卡片正文在 zoom 1.5 时约 19–20px；顶部工具栏、样式条、提示条、批注弹窗、`[[` 弹窗只有 12–13px。功能镜头需要把视口 zoom 提到约 1.8，界面外壳整体放大 1.7–2 倍（例如把组件放在 960×540 的容器里再 2 倍缩放）。
2. **格式刷要有手动样式才看得出变化**（见 R6）。
3. **连线**：要写 `sourceHandle` / `targetHandle`；`related` 关系会在每条线上显示“相关”，建议设 `label: ""`，只留一条“支持”。
4. **`[[` 弹窗图标**是 `chrome://` 地址，浏览器里是空的，要换 data URL（可用 `addon/content/icons/attachment-markdown.svg`、`attachment-canvas.svg`）。
5. **脚注**在实时预览里不渲染，别在实时预览镜头里放脚注。
6. 白板默认主题是浅色；有暗色主题（`theme="dark"`，`board.css:2263` 一带），是否用由风格审计决定。
7. Markdown 标签页外壳（工具栏、目录栏、反向链接栏、状态栏）没在本次接通；`src/dev/markdown-demo.ts` + `packages/whiteboard/markdown.html` 是现成的接入示范，需要把 `@zotero-plugin/fake-zotero` alias 到 `packages/fake-zotero/src/index.ts`。

---

## 7. 没覆盖、不能证明的部分

- 平台：只有 Zotero 桌面插件。没有网页版、移动端、服务端。Markdown / Canvas API 是 Zotero 进程内接口，不是网络服务（`docs/canvas-api.md`）。
- 发布：GitHub Release 是否已上线没有核实；0.2.4 / 0.2.5 / 0.2.6 / 0.2.8 没有 CHANGELOG 条目。
- 0.1.7 以前的功能只能写“≤0.1.7 已有”（浅克隆）。
- 真实 Zotero 里的行为（拖拽来源、右键菜单、PDF 阅读器跳转、条目侧栏、重启恢复）在浏览器里看不到；文档自己也写了需要装 XPI 做最终验收（`docs/markdown-canvas-release-features.md`“验证”）。
- 没有任何用户数、下载量、速度提升等数字可以上屏。
