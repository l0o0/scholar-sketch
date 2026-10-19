# Zotero 外壳界面审计（Scholar Sketch v0.2.9）

调查范围：产品仓库 `/home/user/scholar-sketch`（只读），skill 参考 `references/component-pipeline.md`。
所有实验只在本目录 `/tmp/claude-0/-home-user-scholar-sketch/9c397663-c3ff-50bd-93ba-f5baab301bbc/scratchpad/research/shell/` 里做，没有改产品仓库和视频工程。

---

## 0. 先说结论

1. **"Zotero 外壳"其实分两层。** 外层是 Zotero 自己的 XUL/Firefox 界面（工具栏、菜单、条目树、标签栏、条目窗格分区头、弹出提示、系统文件对话框），这一层仓库里**没有任何源码、样式或截图**，浏览器里也跑不起来，只能忠实重建。内层是插件自己塞进去的东西，大多是**普通 HTML / React**，可以在浏览器里用真代码挂载。
2. **本次实测（Chromium + 真源码 + 最少适配）：**
   - 工具栏菜单：真代码 `creation-toolbar.ts` + `whiteboard/menu.ts` 能在浏览器 DOM 里跑完，得到完整菜单树（顺序、中文标签、图标、禁用状态都对），**但画面上什么都不显示**（XUL 元素在浏览器里没有外观）。所以菜单只能"结构是真的，外观是重建的"。
   - 条目窗格 Markdown 分区：**正文能真挂载**（笔记列表卡片、实时预览编辑器 iframe、"引用此笔记"面板；选中 .md 时的专注模式和 41px 工具栏也正常），只缺 Zotero 的分区头和侧边导航外观。
   - 批注生成笔记对话框、本地历史对话框：**真代码能弹出**，但它们本身是很朴素的 `<dialog>`，浏览器里看起来像未加样式的表单，不适合当主镜头。
   - 拖论文到白板：白板落点这一半是真的。用真 `WhiteboardApp` 的 `runtime.beginAcademicDrop()`（Zotero 宿主接住拖放后调用的就是它）加真 `createZoteroSourceGateway()` 和假 Zotero 数据，**生成了真的文献卡片**，中文标签取自 zh-CN 语言文件。拖的起点（Zotero 条目树）只能重建。
3. **推荐上镜的 Zotero 外壳时刻（详见第 6 节）：**
   - 首选：**"把论文从文库拖到白板上"**。起点做成简化的"文库"示意面板，落点用真白板和真卡片。
   - 次选：**"选中论文，条目侧栏直接写 Markdown 笔记"**。正文用真组件，外框用中性重建。
   - 可选的 1.5–2 秒入口画面：**工具栏菜单 → 新建白板…**。菜单结构取自真代码的运行结果，外观做成风格化的浮动菜单卡，不冒充某个系统的截图。

---

## 1. 一览表

| 界面 | 源码 | 怎么构建 | 浏览器能否挂载 | 建议 |
|---|---|---|---|---|
| 工具栏按钮 + 菜单 | `src/modules/creation-toolbar.ts`（55–335 行）、`src/modules/whiteboard/menu.ts`（64–198 行） | XUL `toolbarbutton` / `menupopup` / `menuitem`（`createXULElement`） | 结构能跑，外观不能（已实测） | 用真菜单树驱动重建 |
| 条目右键菜单 | `src/modules/markdown/menu.ts`（22–235 行）、`whiteboard/menu.ts`（200–259 行）、`src/modules/file-history-ui.ts`（99–126 行） | XUL `menuitem` / `menu` | 同上 | 不建议上镜 |
| 帮助菜单 → 创建示例白板 | `whiteboard/menu.ts` 40–62 行 | XUL `menuitem` | 同上（已实测） | 菜单重建，示例白板本身是真的 |
| 条目树 .md/.canvas 图标 | `src/modules/attachment-icons.ts`、`addon/content/attachment-icons.css` | 给 `Zotero.Item.prototype.getItemTypeIconName/getImageSrc` 打补丁 + 全局样式表 | 条目树不能；图标文件能直接用 | 重建时用原 SVG |
| 条目窗格 Markdown 分区 | `src/modules/markdown/sidebar.ts`、`styles.ts`（52–246、1776–1890 行） | `Zotero.ItemPaneManager.registerSection` + 普通 HTML + CodeMirror iframe | **正文可以（已实测）**，分区头/侧边导航不行 | 次选镜头 |
| 条目窗格白板分区 | `src/modules/whiteboard/sidebar.ts`（200–224 行） | 同上，正文是 `<select>` + 按钮 + 内嵌白板 | 内嵌白板可以 | 不必单独上镜 |
| 标签页 / 独立窗口 | `markdown/tab.ts` 275 行、`whiteboard/tab.ts` 1575 行；`addon/content/*Window.xhtml` | `Zotero_Tabs.add`；独立窗口是系统窗口 | 标签栏不行；标签里的内容可以 | 标签条按需简单重建 |
| 批注 → Markdown 笔记 | `src/modules/markdown/annotations.ts` | 右键菜单 XUL + HTML `<dialog>` | 对话框可以（已实测），但很朴素 | 只展示结果（生成的笔记） |
| 导出 | 白板：`whiteboard/tab.ts` 770–815 行 + React 白板；笔记：`markdown/more-menu.ts`、`export-notes.ts` | React/HTML 按钮 → 系统文件对话框 → 进度提示 | 按钮和导出内容可以；保存对话框不行 | 展示导出成品 |
| 本地历史 / 冲突检查 | `src/modules/file-history-ui.ts`、`file-safety.ts`、`attachment-sync.ts` | HTML `<dialog>`、状态栏、进度提示 | 对话框可以（已实测），但很朴素 | 最多一句话带过 |
| 拖文献到白板 | `whiteboard/editor.ts` 127–180 行、`whiteboard/tab.ts` 532–595 行、`packages/whiteboard/src/whiteboard/app.tsx` 3963 行 | 原生拖放 → 解析 `zotero/item` → 白板 runtime | **落点可以（已实测）**，拖的起点不行 | 首选镜头 |
| 进度提示（右下角小弹窗） | `ztoolkit.ProgressWindow`（各处） | XUL 弹窗 | 不行 | 不要上镜 |
| 设置页 | `addon/content/preferences.xhtml`、`hooks.ts` 243–250 行 | Zotero 设置面板 | 不行 | 不要上镜 |

---

## 2. 逐个界面

### 2.1 工具栏按钮 + 菜单（最主要的入口）

**位置：** Zotero 条目列表上方的工具栏 `#zotero-items-toolbar`，**紧挨在 Zotero 自带"新建笔记"按钮 `#zotero-tb-note-add` 的右边**（`creation-toolbar.ts` 312 行 `anchor.after(button)`）。按 Tab 键会跳到搜索框 `#zotero-tb-search`。

**按钮：**
- Zotero 原生 `toolbarbutton`，`class="zotero-tb-button"`，`type="menu"`，`wantdropmarker="true"`，所以图标右边有 Zotero 画的小下拉箭头。
- 图标 `addon/content/icons/scholar-sketch-toolbar.svg`，显示 **20×20 px**（注入样式 `.toolbarbutton-icon {width:20px;height:20px}`）。图形是折角纸页轮廓：浅色模式描边 `#3a5147`、线宽 1.25，折角 `#8ca58d`；深色模式描边 `#d9e0db`，折角 `#adc3b4`。
- 悬停提示：**"Scholar Sketch：新建 Markdown 笔记或白板"**（`toolbar-create-document`）。

**菜单（下面是真代码跑出来的结果，见 `exp/menu-tree.json`）：**

| 顺序 | 文字（zh-CN） | 图标 | 什么时候是灰的 |
|---|---|---|---|
| 1 | 新建 Markdown 笔记… | `attachment-markdown.svg`（16×16） | 文库不可编辑时 |
| 2 | 新建白板… | `attachment-canvas.svg`（16×16） | 同上 |
| — | 分隔线 | | |
| 3 | 导入 Markdown… | 无 | 文库不可编辑时 |
| 4 | 导出选择MD文件… | 无 | 选中项不全是 .md 时（默认是灰的） |
| — | 分隔线（`whiteboard/menu.ts` 追加） | | |
| 5 | 从分类新建白板… | `favicon.png` | 没选分类时 |
| 6 | 最近打开的白板 ▸ | `favicon.png` | — |
| 6a | 子菜单：最近的 .canvas 文件名，最多 8 个（`whiteboard/open.ts` `slice(0, 8)`） | `favicon.png` | 没有记录时只有一条灰的"暂无最近白板" |

- 菜单图标的注入样式是 `.menu-iconic-icon {width:16px;height:16px}`。
- 新建的默认文件名：笔记是 `Note-YYYYMMDD-HHMMSS.md`（`markdown/detect.ts` 35 行），白板是 `Canvas-YYYYMMDD-HHMMSS.canvas`（`whiteboard/detect.ts`）。选中论文时，新文件挂在这篇论文下面，然后马上在新标签页打开。
- 存疑：`whiteboard/menu.ts` 给"最近打开的白板"这个 `<menu>` 用的是 `menuitem-iconic` 类，而 XUL 里 `menu` 一般用 `menu-iconic`（`markdown/menu.ts` 73 行就用的 `menu-iconic`）。实机上这一项的图标**可能不显示**，需要真机确认。重建时别画得比实机更完整。
- 菜单的外观（行高、字体、悬停色、圆角、阴影）由 Zotero 和操作系统决定，macOS 上是系统原生菜单。**仓库里没有任何依据。**

### 2.2 条目右键菜单 / 帮助菜单

- **帮助菜单：** 追加 **"Scholar Sketch：创建示例白板"**（图标 `favicon.png`），点了调用 `createExampleWhiteboard()`。
- **条目右键菜单**（`#zotero-itemmenu`）追加的项：
  - "从 PDF 批注生成 Markdown…"：选中一篇论文或一个 PDF 时出现。
  - "Scholar Sketch ▸"：子菜单里有"新建白板… / 新建 Markdown… / 导出选择MD文件…"，图标是 favicon。
  - "在独立窗口打开"：只对 .md 和 .canvas 出现。
  - "打开白板"：只对 .canvas 出现。
  - "本地历史…"：只对 .md 和 .canvas 出现。
- 这些全是 XUL，和工具栏菜单一样只能重建。不建议在宣传片里出现。

### 2.3 条目树里的 .md / .canvas 附件图标

- **原理：** 启动时给 `Zotero.Item.prototype.getItemTypeIconName` 打补丁，返回 `bamboo-attachment-markdown`、`-markdown-link`、`-canvas` 或 `-canvas-link`。再注册一张全局样式表 `attachment-icons.css`，按 `data-item-type` 把 `.icon` 的背景换成对应的 SVG（`background: … center / contain`）。条目树和条目窗格里的附件行都生效。
- **选中并且列表有焦点时**，`color-scheme: dark` 会让 SVG 切到自带的深色配色，好在 Zotero 的蓝色选中行上看得清。
- **四个图标**（都是 16×16 viewBox，`addon/content/icons/`）：

| 文件 | 浅色 | 深色 |
|---|---|---|
| `attachment-markdown.svg` | 轮廓 `#3a5147`，折角 `#8ca58d`，"M" `#c15c25` | `#d9e0db` / `#adc3b4` / `#ffdab5` |
| `attachment-canvas.svg` | 轮廓 `#3a5147`，折角 `#8ca58d`，小图形 `#7c3aed` | `#d9e0db` / `#adc3b4` / `#c4b5fd` |
| `attachment-markdown-link.svg` / `attachment-canvas-link.svg` | 同上，右下角加链条（链接附件） | 同上 |

- 插件不管条目树的行高、字体和选中色。图标显示多大由 Zotero 决定（一般 16 px，需真机确认）。开发者自己做的浏览器预览图里，"有焦点的选中行"用的是 `#2f7de9`，"无焦点的选中行"用的是 `#e2e7e3`。这些**是模拟色，不是 Zotero 源码**。
- 示例白板的文件名：`Scholar Sketch 学术白板.canvas`；配套练习笔记：`开始写作.md`。

### 2.4 条目窗格里的 Markdown 分区（侧栏）

**注册：** `Zotero.ItemPaneManager.registerSection({ paneID: "zmd-markdown", ... })`（`sidebar.ts` 112 行）。

**Zotero 画的部分**（只能重建）：
- 右侧竖排导航按钮：图标 `sidebar-markdown.svg`，显示 **20×20**，深色模式用 `sidebar-markdown-dark.svg`；悬停提示"Markdown 编辑器"。
- 分区标题："Markdown"，标题图标 **16×16**。
- 分区标题右边的小摘要：`setSectionSummary` 写"已保存 / 有未保存修改 / 保存失败"。
- 分区折叠外壳 `collapsible-section`，以及 Zotero 的 CSS 变量 `--material-toolbar`、`--material-panedivider`、`--fill-secondary`。这些变量的值**仓库里没有**。

**插件画的部分**（普通 HTML，已实测能挂载）：
- **选中一篇论文时**：上面是这篇论文的 .md 附件列表卡片，下面是实时预览编辑器，再下面是"引用此笔记"面板。
  - 卡片：内边距 6×8 px，圆角 8，1px 边框；标题 12px/600；日期 11px 灰色；摘要是正文第一行。
  - 编辑器框：高度 `min(50vh, 600px)`，最小 320，最大 600，圆角 8。
  - 整体：`padding: 4px 10px 10px`，字号 13px，字体栈 `system-ui, -apple-system, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif`。
- **直接选中一个 .md 附件时**（专注模式）：这个分区占满整个条目窗格，其他分区和条目标题会被隐藏，并出现一行工具栏：
  - 工具栏高 **41px**，`padding: 2px 8px`。
  - 按钮 **35×35**，圆角 6，图标 17px（`addon/content/icons/markdown/*.svg`，用 CSS mask）。按钮依次是：粗体、斜体、一级标题、无序列表、链接，靠右是"更多"⋯。
  - "更多"菜单：最小宽 190px，每项 32px 高、12px 字，里面是"在新标签页打开 / 在独立窗口打开"。
- **空状态**：文字"当前条目没有 Markdown 附件"，下面一个按钮"新建 Markdown…"（蓝底 `#2563eb`、白字、12px、圆角 6）。
- **颜色**来自 `src/ui/theme.ts` 和 `src/modules/markdown/theme-tokens.ts`（浅色）：
  - surface `#ffffff`，surface2 `#f7f8fa`，border `#e6e8ec`
  - text `#24272c`，muted `#6b7280`，accent `#2563eb`，accent-soft `rgba(37,99,235,.12)`
  - 深色另有一套。
- 实测时发现：第一次渲染时，正在编辑的那张卡片**没有**高亮（`is-active`），这是产品本身的行为。
- 列表日期用 `toLocaleDateString`，浏览器要设成 zh-CN，才会显示成"2026/10/19"。

### 2.5 条目窗格里的白板分区

- `paneID: "scholar-sketch-whiteboard"`，标题"白板"，图标 `attachment-canvas.svg`。
- 正文第一行是 `<select>` + "↗"（在新标签页打开）+ "+"（新建白板），下面是一个 560px 高、可以纵向拉伸的内嵌白板（真白板组件）。
- 外观朴素（原生下拉框、"↗""+"字符按钮），不推荐单独上镜。

### 2.6 标签页 / 独立窗口

- 标签：`Zotero_Tabs.add({ type: "markdown" | "whiteboard", title })`。
  - 标题取附件标题或文件名，兜底是"Markdown"或"白板"。
  - **插件不设标签图标**；Zotero 对这种自定义类型显示什么图标，仓库里没法确认。
  - 标签栏是 Zotero 的，只能重建。标签里的内容（Markdown 编辑器外壳、白板）是 HTML/React，可以挂载。
- 独立窗口：`markdownWindow.xhtml` / `whiteboardWindow.xhtml`，窗口标题"Scholar Sketch"，外框是系统窗口。不建议上镜。

### 2.7 批注 → Markdown 笔记

- **入口**：条目右键"从 PDF 批注生成 Markdown…"（XUL）。
- **对话框**（`annotations.ts` 120–208 行，HTML `<dialog>`）：
  - 尺寸：宽 `min(760px, 85vw)`，最大高 85vh，内边距 24，1px `GrayText` 边框，圆角 10，背景 `Canvas`，字色 `CanvasText`。
  - 内容从上到下：标题"从 PDF 批注生成 Markdown…"（标题末尾带省略号，直接复用了菜单文字）→ 说明"选择要整理的高亮文字和评论，页码链接可返回原 PDF 批注。"→ 按钮"全选 / 全不选"→ 每条批注一个复选框 →"生成 Markdown 笔记""关闭"两个按钮。
- **已实测能弹出并生成内容**：`# 论文标题` / `## PDF 标题` / `> 引文` / 评论 / `[页码](zotero://open-pdf/library/items/KEY?page=N&annotation=KEY)`。生成的 .md 挂到论文下面，并自动打开（`createMarkdownAttachment` 默认 `open: true`）。
- 浏览器里对话框显示成默认衬线字体和浏览器默认按钮（见 `stills/probe-dialog-annotations.png`），**和 Zotero 里的样子不一样**；在 Zotero 里它会套用 Zotero 的界面皮肤。
- 建议：不拍这个对话框，拍**结果**，也就是真 Markdown 编辑器里出现的引文和页码链接。另一条更好看的批注路线在白板内部（React）："查看批注 → 添加所选批注"，以及"从这条批注新建观点 / 证据笔记"。
- 做假数据要注意：批注排序用 `annotationSortIndex` 做字符串比较，要用 Zotero 的真格式（如 `00002|000100|00050`），否则顺序会乱。

### 2.8 帮助 → 创建示例白板（以及第一次启动）

- 菜单项是 XUL，只能重建。
- 示例白板本身由纯函数 `tutorialCanvasDocument(labels, sample)`（`packages/whiteboard/src/model/tutorial.ts` 72 行）生成，可以用真白板组件渲染。中文文字来自 `whiteboard-tutorial-*`，例如"欢迎""五种卡片，一条思路""分享你的思考"。
- 示例里的文献取自用户文库里最近修改、带批注或笔记的那篇论文（`selectTutorialSample`）。卡片上写着"示例卡片来自你的文库；Scholar Sketch 不会修改来源条目。"
- **第一次启动会自动创建示例白板**（`hooks.ts` 91 行 `ensureTutorialWhiteboard()`，由偏好设置控制只做一次）。

### 2.9 导出

**白板：**
- 白板 React 界面里的按钮"导出 PNG · 2×"（右键空白处可选 1×/2×/4×）、"导出 SVG"、"导出 Markdown"都是真组件，导出内容也由真代码在浏览器里生成。
- 之后 Zotero 宿主会弹系统保存对话框（标题"导出白板"），再弹进度提示"已导出"（`whiteboard/tab.ts` 785–805 行）。这两步不能挂载。

**Markdown 笔记：**
- "更多"菜单（HTML，真的）→ 导出 ▸ PDF / HTML / Obsidian… / Markdown…（`more-menu.ts` 的 `EXPORT_OPTIONS`）。这几个子项写死为英文专有名词，可以接受。
- Obsidian 和 Markdown 导出会弹系统"选择文件夹"对话框，然后提示"已导出 N 篇笔记到 …，链接提示 M 条。"
- 真导出器 `buildNoteExport` 能在浏览器里生成"文件计划"：文件名、改写后的链接、frontmatter。仓库自带的 fake Markdown 演示页就有"Preview Obsidian export"，可以诚实地展示导出结果。
- 建议：拍**导出的成品**（真 PNG、真文件计划），不拍保存对话框。

### 2.10 本地历史 / 冲突检查

- "本地历史…"入口在条目右键菜单（XUL）和 Markdown "更多"菜单（HTML）里。
- 历史对话框（`file-history-ui.ts`）已实测能弹出：
  - 标题"本地历史…"，下面一段说明。
  - 下拉框按"时间 · 保存前版本 / 同步期间保留的草稿 / 冲突草稿"列出版本。
  - 只读预览框（等宽字体，42vh 高），按钮"另存恢复副本…""关闭"。
  - 外观同样很朴素（`stills/probe-dialog-history.png`）。
- 冲突时，写入会被拦下，提示"文件已在编辑器外被修改，已停止覆盖。当前草稿可在附件右键菜单的'本地历史'中恢复。"它出现在状态栏的"保存失败"和进度提示里。**进度提示的前缀写死了英文 `Save failed: `**（`markdown/tab.ts` 2549 行），违反"全中文"要求，**不要拍**。
- 建议：最多用一句文案带过，例如"自动保存 · 本地历史 · 冲突检查"，不演示。

### 2.11 拖论文到白板（核心联动）

链路（全部来自源码）：

1. 用户从 Zotero 条目树拖一篇论文。拖的数据类型是 `zotero/item`，内容是条目 ID，例如 `"1"`。
2. Zotero 宿主在白板 iframe 上挂的 `attachNativeAcademicDropListeners`（`whiteboard/editor.ts` 127 行）接住这次拖放。
3. `resolveNativeAcademicDrop(transfer, deps)`（`whiteboard/tab.ts` 532 行）把 ID 换成 `{library:{type:"user"}, itemKey}`。这个函数可以注入依赖。
4. 宿主向白板发出 `academicDropStarted` 消息，白板执行 `runtime.beginAcademicDrop(requestId, nodeId, 屏幕坐标, sources)`（`app.tsx` 3963 行）。
5. 白板先放一个占位，再回调 `onDropAcademicSources`。宿主用 `gateway.acquireItem()` 取到元数据后，调 `resolveAcademicAcquisitionBatch`，占位变成真文献卡片，同时弹出提示"已添加 1 个来源；0 个无法添加。"

- **已实测**：4–5 步在浏览器里是真代码，见 `stills/probe-whiteboard-after-drop.png`。白板工具栏和卡片上全是中文。中文标签是从 `whiteboard/tab.ts` 989 行起的 labels 对象原样提取，再配 zh-CN 语言文件生成的。**注意：白板组件不传 labels 时默认显示英文**（`app.tsx` 433 行起）。
- 第 1 步的条目树和拖动时的残影由 Zotero 绘制，只能重建。
- 白板工具栏里"添加 Zotero 资料"按钮是一个红色描边的 "Z"（`icons.tsx` 50 行，`#cc2936`），这是产品自己的按钮，可以上镜。但点它会打开 Zotero 原生的"选择条目"对话框（`selectItemsDialog.xhtml`），那个对话框不能挂载。

### 2.12 进度提示与设置页

- 进度提示 `ztoolkit.ProgressWindow` 是 Zotero 窗口角落的小弹窗，例如启动时"Scholar Sketch已就绪"、导出时"已导出"。其中有几条写死了英文，例如"Select a collection first"（`whiteboard/create.ts` 377 行）和上面提到的 `Save failed:`。**都不要上镜。**
- 设置页（Zotero 设置 → Scholar Sketch，图标 `scholar-sketch-toolbar.svg`）里有"笔记与白板 / 打开设置 / 一起完善 Scholar Sketch"和 GitHub 链接。不建议上镜，因为片子不放网址。

---

## 3. 图标、品牌图与颜色

**可以直接用的产品原文件**（`addon/content/icons/`）：
- `scholar-sketch-toolbar.svg`：工具栏 20px、设置页图标。
- `attachment-markdown.svg`、`attachment-canvas.svg`、两个 `-link` 版本：条目树、菜单、白板分区。
- `sidebar-markdown.svg` / `sidebar-markdown-dark.svg`：条目窗格。
- `favicon.png`：1254×1254，带透明。插件正式图标是象牙白圆角方块、炭黑折角纸页、灰绿折角。它在菜单里只有 16px，看起来很淡。
- `markdown/*.svg`：29 个工具栏图标，Lucide 风格。

**品牌色：**
- 图标 SVG 里：墨绿灰 `#3a5147`、灰绿 `#8ca58d`、Markdown 橙 `#c15c25`、白板紫 `#7c3aed`。
- logo PNG 实测取色：炭黑 `#192325`、灰绿 `#728c7a`、底色近白 `#fefefe`。
- 界面强调色：蓝 `#2563eb`。

**`docs/` 下的图（都用 Read 看过）：**
- `docs/screenshots/research-whiteboard.jpg`、`canvas-batch-styles.jpg`（810×816）、`markdown-linked-notes.jpg`（1280×900）：只有白板和编辑器内容，**界面是英文**，**完全没有 Zotero 外壳**。仓库里没有任何一张"插件在 Zotero 里"的真实截图。
- `docs/icons/scholar-sketch-logo.png`（1672×941）：logo + 英文副标题"READ · ORGANIZE · THINK"。片子要求全中文，所以只能用图形和产品名部分，英文副标题要裁掉或不用。它是 AI 生成的位图，仓库里没有矢量 logo。
- `docs/icons/attachment-icons-*-preview.png`、`plugin-icon-transparent-preview.png`：开发者做的**浏览器预览**，不是 Zotero 截图（`plugin-icon-background-edit.md` 里也写明了），里面还是旧名字"Scholar Canvas"。只能参考 16px 行的观感，不能当 Zotero 外观依据。
- `docs/icons/scholarCanvas-*.png`：旧名字"Scholar Canvas"的品牌效果图，AI 生成的场景，其中一张是写给虚构人物的信，带虚构地址和域名。**不要用。**

**字体：** 产品界面用系统字体栈（见 2.4）。本容器里中文只有文泉驿正黑（WenQuanYi Zen Hei），西文有 Inter。实测截图里的中文都是文泉驿。字体请排版那边定。

---

## 4. 本次实测做了什么（证据）

所有实验都用视频工程里已装的 esbuild 和 playwright（只读调用），在 Chromium 里运行**产品原源码**。适配只有这些：
- 语言：用一个桩函数读真 `addon/locale/zh-CN/*.ftl`。
- `document.createXULElement` 换成 `createElement`。
- 需要文件 I/O 的模块换成桩。
- 编辑器 iframe 的地址改成本地服务（用产品自带的 `pageURL` 选项）。
- 构建时把 `chrome://bamboo/content/` 改写成本地路径（没改产品文件）。

| 实验 | 结果 | 文件 |
|---|---|---|
| 工具栏菜单结构 | 真代码跑通，没有缺失的语言键。有分类和没分类两种情况都记录了 | `exp/entry.ts`、`exp/menu-tree.json` |
| XUL 在浏览器里的真实样子 | 什么都不显示（只有占位按钮和输入框） | `stills/raw-xul-dom-in-chromium.png` |
| 菜单 + 条目树忠实重建预览 | 结构和文字来自上面的 JSON，图标是原文件，外观中性，右下角标了"忠实重建预览 · 非 Zotero 实机截图" | `stills/recon-toolbar-menu.png`、`exp/make-recon.mjs` |
| Markdown 分区（选中论文） | 真列表卡片、真实时预览编辑器、真"引用此笔记"面板 | `stills/probe-markdown-sidebar-list.png`、`exp2/` |
| Markdown 分区（选中 .md，专注模式） | 真 41px 工具栏和图标，编辑器占满 | `stills/probe-markdown-sidebar-focus.png` |
| 批注生成笔记对话框 | 真代码弹出，生成的 Markdown 正确；外观朴素 | `stills/probe-dialog-annotations.png`、`exp3/` |
| 本地历史对话框 | 真代码弹出；外观朴素 | `stills/probe-dialog-history.png` |
| 拖论文落到白板 | 真 `beginAcademicDrop` + 真 gateway → 真文献卡片 + 中文提示 | `stills/probe-whiteboard-after-drop.png`、`exp4/` |

**没有验证的：**
- Zotero 真机上的外观：本机没有 Zotero，也没有真机截图。
- `resolveNativeAcademicDrop` 这一段没有单独跑（它在 `tab.ts` 里，依赖较多）。
- 白板分区、Markdown 标签页外壳没有试。

---

## 5. 重建时仓库里**没有**、需要另找依据或明确标为示意的东西

- Zotero 工具栏的高度、背景、按钮外观，下拉箭头的样子。
- 菜单的外观（行高、字体、悬停色、阴影、圆角）。macOS / Windows / Linux 各不一样。
- 条目树：行高、字号、缩进、展开三角，以及 Zotero 自带的条目类型图标（期刊论文、PDF 等）。插件只提供 .md/.canvas 图标。
- 选中行的蓝色，有焦点和无焦点各一种（开发者预览用的 `#2f7de9` 只是模拟）。
- 条目窗格：侧边导航条、分区标题样式，CSS 变量 `--material-toolbar`、`--material-panedivider`、`--fill-secondary`。
- 标签栏的外观和自定义类型标签的图标。
- Zotero 的 logo：不应该用；也不要暗示 Zotero 官方背书。

**做法建议：** 不追求像素级模仿某个系统，做一个"简化、中性灰、只保留结构"的 Zotero 外框。产品自己的部分（图标、文字、菜单顺序、尺寸）严格按源码。在 `evidence/component-usage.json` 里把这些镜头的 `reuseMode` 记成 `reconstruction`，并写清每个细节来自哪个文件。

---

## 6. 推荐：45–60 秒介绍片里放哪 1–2 个 Zotero 外壳时刻

### 首选：把论文从文库拖到白板上（约 4–5 秒）

- **为什么：** 这是"这是 Zotero 插件、不是普通白板"最直观的一刻，README 第一条联动功能写的就是它。它也是白板故事的开头：先有文献，再接引文、观点、连线。
- **最诚实的拍法（半真半重建）：**
  - 左边：简化的"文库"面板。几行文献，用中性灰的文档形状，**不画 Zotero 自带的条目类型图标**。论文下面的子附件行可以用真的 `attachment-markdown.svg` / `attachment-canvas.svg`。
  - 一行被拖起来，划向右边。
  - 右边：**真 `WhiteboardApp`**。松手那一刻调用真 `runtime.beginAcademicDrop()`。sources 可以用真函数 `resolveNativeAcademicDrop()` 从一个模拟的 `{types:["zotero/item"], getData:() => "1"}` 算出来，这样"解析拖放"这一步也是真代码。
  - 然后出现真占位和真文献卡片（中文 labels 要按 `whiteboard/tab.ts` 989 行的映射传入）。
  - 后面可以接白板里的"查看批注 → 添加所选批注"，引文卡片冒出来，这一段也是真组件。
  - 左侧面板在画面或证据里标成示意（如果画面上要标，只用中文"示意"）。中文假数据要有，例如论文标题、作者、期刊、一条高亮批注。
  - "已添加 1 个来源；0 个无法添加。"这条真提示可以留，也可以在它出现前切走。

### 次选：选中论文，条目侧栏直接写笔记（约 3–4 秒）

- **为什么：** 讲清楚"笔记就挂在文献旁边，不用离开 Zotero"。正文是**真组件**（已实测），诚实度高。
- **拍法：**
  - 一个中性的条目窗格外框，顶部写分区名"Markdown"，配真 `sidebar-markdown.svg`，再加一个简化的论文标题区。
  - 里面挂真 `SidebarController`（通过模拟 `ItemPaneManager.registerSection` 拿到它的 `onInit/onRender` 回调）。
  - 用真打字驱动实时预览。也可以切到专注模式（选中 .md），露出 41px 工具栏。
  - 放大到视频尺度：13px 正文 × 约 1.7–2 倍，才能 ≥ 22px。

### 可选入口画面：工具栏菜单 → 新建白板…（1.5–2 秒）

- 只在需要交代"从哪里开始"时用。菜单的顺序、文字、图标、灰色状态取自 `exp/menu-tree.json`，也就是真代码的运行结果。
- 外观做成**风格化的浮动菜单卡**，放在品牌底色上，不放进一个假的系统窗口里。这样观众不会以为是截图。
- 用一个真点击高亮"新建白板…"，接着硬切到真白板。
- 如果时间紧，可以改成片尾一行中文路径字幕："工具栏 Scholar Sketch → 新建白板…"。

### 不建议上镜

- 进度提示小弹窗（有写死的英文）、系统保存/选择文件夹对话框、Zotero"选择条目"对话框。
- 批注对话框和本地历史对话框：浏览器里是未加样式的表单；在 Zotero 里也很朴素。
- 设置页（有 GitHub 链接）。
- Zotero logo；旧名"Scholar Canvas"的任何图片；`docs/screenshots` 里的英文界面截图。
- 不要写"支持 Zotero 7"：manifest 要求 9.0–11.*，应写"Zotero 9 / 10 / 11 桌面版"。

---

## 7. 相关文件路径

- 本报告：`/tmp/claude-0/-home-user-scholar-sketch/9c397663-c3ff-50bd-93ba-f5baab301bbc/scratchpad/research/shell/zotero-shell-audit.md`
- 菜单真实结构：`/tmp/claude-0/-home-user-scholar-sketch/9c397663-c3ff-50bd-93ba-f5baab301bbc/scratchpad/research/shell/exp/menu-tree.json`
- 静帧目录：`/tmp/claude-0/-home-user-scholar-sketch/9c397663-c3ff-50bd-93ba-f5baab301bbc/scratchpad/research/shell/stills/`
- 实验代码：同目录下的 `exp/`（菜单）、`exp2/`（Markdown 分区）、`exp3/`（对话框）、`exp4/`（白板拖放落点）
- 产品关键源码：
  - `src/modules/creation-toolbar.ts`
  - `src/modules/whiteboard/menu.ts`
  - `src/modules/markdown/menu.ts`
  - `src/modules/attachment-icons.ts`
  - `addon/content/attachment-icons.css`
  - `src/modules/markdown/sidebar.ts`
  - `src/modules/markdown/styles.ts`
  - `src/modules/whiteboard/sidebar.ts`
  - `src/modules/markdown/annotations.ts`
  - `src/modules/file-history-ui.ts`
  - `src/modules/whiteboard/editor.ts`
  - `src/modules/whiteboard/tab.ts`
  - `packages/whiteboard/src/whiteboard/app.tsx`
  - `packages/whiteboard/src/devHost.ts`
  - `addon/locale/zh-CN/addon.ftl`
  - `addon/locale/zh-CN/mainWindow.ftl`
