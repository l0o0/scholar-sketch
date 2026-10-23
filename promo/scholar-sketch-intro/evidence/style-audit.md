# Scholar Sketch 风格审计（style-audit.md）

> 范围：整个产品（以 v0.2.9，2026-10-19 为准），平台面只有 Zotero 9/10/11 桌面插件。风格 = hybrid。
> 产品仓库只读，本文所有结论都写了来源文件。路径都相对 `/home/user/scholar-sketch`。
> 配套静帧（本机 Chromium 实际渲染）：
> - 色板与标志：`/tmp/claude-0/-home-user-scholar-sketch/9c397663-c3ff-50bd-93ba-f5baab301bbc/scratchpad/research/style/palette-sheet.png`
> - 字体样张：`/tmp/claude-0/-home-user-scholar-sketch/9c397663-c3ff-50bd-93ba-f5baab301bbc/scratchpad/research/style/font-specimen.png`

---

## 0. 真实产品长什么样（看过 docs/screenshots/*.jpg）

三张截图都是 **浅色主题、英文界面**，看起来是在浏览器开发环境（fake-zotero）里截的，外面没有 Zotero 窗口边框。

1. `docs/screenshots/research-whiteboard.jpg`（810×816）——研究白板。
   - 底色是很浅的灰白（#fbfbfc），上面铺满 **16px 间距的小灰点**（点阵网格）。
   - 顶部居中一条白色"工具岛"：圆角 12px、1px 浅灰边、很轻的阴影。图标是细线风格（选择、抓手、添加资料、笔记、框架、"Note" 下拉、文字、形状、撤销/重做、附件、更多），最右边灰字 "Saved"。
   - 画面里有两个 **框架（分组框）**："01 · Read & collect" 和 "02 · Connect & synthesize"，灰蓝 2px 边、极淡的蓝色底。
   - 左框：一张 **文献卡**（LITERATURE，书本图标，标题加粗 "A visual workflow for literature review"，下面灰字作者/年份、出处、`#knowledge work #reading` 标签，分隔线下 "4 annotations"），下面一张 **引文卡**（QUOTE，引号图标，左侧 2px 竖线的引文正文，斜体评论，右上角一个 **黄色小圆点 = PDF 批注颜色**，页脚 "Reading notes · p. 12"）。
   - 右框：**问题卡**（淡黄底、虚线边、大圆角）→ **观点卡**（淡绿底、2px 深一点的绿边）→ **总结卡**（淡紫底）。卡片之间用 **带闭合箭头的灰色直线** 连起来；引文卡到观点卡是一条 **绿色贝塞尔曲线**，标签 "Supports"。
   - 右下角是缩放控件（+ − 适配）。
   - 整体感觉：安静、规整、像纸面上的卡片和连线，没有花哨的颜色和阴影。
2. `docs/screenshots/canvas-batch-styles.jpg`（810×816）——同一张白板，选中两张卡片（蓝色 1.5px 选框 + 方形蓝色控制点 + 圆形连线端点），右侧弹出 "Selection · 2 / Connection · 2" 的批量样式面板：描边、背景色块，实线/点线，箭头"None / Forward / Reverse / Both ends"。面板圆角 12px、白底、轻阴影。
3. `docs/screenshots/markdown-linked-notes.jpg`（1280×900）——Markdown 编辑器（实时预览）。
   - 三栏：左边大纲（Connected reading / Evidence to insight / Linked notes / Next steps）；中间正文；右边 "Linked mentions (2)" 反向链接面板，带 "Refresh links" 按钮，下面两条引用片段里能看到 `[[Connected reading]]` 双链原文。
   - 正文：`# Connected reading` 一级标题（当前行显示出 `#` 号，所在行有很淡的蓝色底 = 活动行），一段带粗体的正文，一张 3 列表格（Step / Capture / Connect：Read→PDF highlights→Source，Reflect→Markdown notes→Ideas，Synthesize→Canvas cards→Argument），蓝色下划线链接 "Reading questions"、"Evidence map"，圆点列表。
   - 截图字体是 Linux 下的 Noto Sans/系统字体，正文约 14–15px，整体非常素。

> 注意：截图是英文界面。片子要求全中文，所以真组件上镜时要喂中文标签（`addon/locale/zh-CN/addon.ftl` 里都有，如 文献/引文/笔记/问题/观点/证据/总结/框架/格式刷）。浏览器开发宿主 `packages/whiteboard/src/whiteboard/app.tsx` 的 `DEFAULT_LABELS` 是英文，插件里由 `src/modules/whiteboard/tab.ts` 从 ftl 组装中文标签传进 `labels` 属性——组件接入时照这个做。

---

## 1. 色板及语义（含浅色、暗色两套）

### 1.1 全局 UI token（Markdown 和白板共用）

来源：`src/ui/theme.ts` 的 `THEME_TOKENS`（注释写明 "Shared visual primitives for Markdown and Canvas"），`DESIGN.md` 头部 colors 段与之一致。

| 语义 | 浅色 | 暗色 | 用途（DESIGN.md 原意） |
|---|---|---|---|
| 背景 bg（Paper Canvas / Night Canvas） | `#fbfbfc` | `#12141a` | 编辑器外层、白板画布底色 |
| 表面 surface（Document Surface） | `#ffffff` | `#1a1d24` | 正文纸面、卡片底、工具岛 |
| 次表面 surface2（Utility Surface） | `#f3f4f6` | `#22262f` | 悬停、状态栏、侧栏底 |
| 描边 border | `#e5e7eb` | `#2e3440` | 1px 结构线 |
| 强描边 borderStrong | `#d1d5db` | `#3d4452` | 表格线、菜单边；白板暗色的 border 用这个 |
| 正文 text（Graphite Text） | `#111827` | `#e8eaed` | 主文字 |
| 弱文本 textMuted | `#6b7280` | `#9aa3b2` | 元信息、图标默认色 |
| 更弱 textFaint | `#9ca3af` | `#6b7280` | 行号、禁用 |
| 强调 accent（Research Blue） | `#2563eb` | `#60a5fa` | **只用于** 链接、焦点、选中、光标 |
| 强调淡色 accentSoft | `rgba(37,99,235,.12)` | `rgba(96,165,250,.16)` | 焦点外圈、激活按钮底 |
| 选区 selection | `rgba(37,99,235,.16)` | `rgba(96,165,250,.28)` | 文本选区 |
| 活动行 activeLine | `rgba(37,99,235,.04)` | `rgba(255,255,255,.04)` | 截图里一级标题行的淡蓝底 |
| 成功 success（Saved Green） | `#059669` | `#34d399` | 只表示"已保存" |
| 警告 warn（Pending Amber） | `#d97706` | `#d97706` | 只表示"未保存/保存中" |
| 危险 danger（Error Red） | `#dc2626` | `#dc2626` | 只表示失败/删除 |
| 阴影 shadow | `0 1px 2px rgba(16,24,40,.04)` | `0 1px 2px rgba(0,0,0,.35)` | 工具栏极轻阴影 |
| 菜单阴影 | `0 8px 20px rgba(16,24,40,.16)` | `0 8px 20px rgba(0,0,0,.4)` | 弹出菜单 |

Markdown 编辑器对浅色做了微调（`src/modules/markdown/theme-tokens.ts`）：surface2 `#f7f8fa`、border `#e6e8ec`、text `#24272c`、代码块底 `#f6f7f9`；暗色不变。

代码高亮（`src/ui/theme.ts`）：浅色 关键字 `#7c3aed`、字符串 `#047857`、数字 `#b45309`、函数 `#1d4ed8`、变量 `#0f766e`、标签 `#b91c1c`、注释 `#6b7280`；暗色 `#c084fc / #86efac / #fbbf24 / #93c5fd / #67e8f9 / #fca5a5 / #8b949e`。等宽字体栈 `"JetBrains Mono", "SFMono-Regular", Consolas, …`（本机没有 JetBrains Mono，会落到 DejaVu Sans Mono）。

### 1.2 白板专用 token

来源：`packages/whiteboard/src/whiteboard/board.css`（开头与第 2260 行附近暗色块），`app.tsx` 第 4385 行附近把 THEME_TOKENS 写进 `--zmd-board-*` 变量。

| 变量 | 浅色 | 暗色 | 说明 |
|---|---|---|---|
| `--zmd-board-bg` | `#fbfbfc` | `#12141a` | 画布底 |
| `--zmd-board-surface` | `#ffffff` | `#1a1d24` | 卡片底 |
| `--zmd-board-border` | `#e5e7eb` | `#3d4452` | 卡片 1px 边 |
| `--zmd-board-edge` | `#9ca3af` | `#6b7280` | 默认连线色 |
| `--zmd-board-literature-accent` | `#536b85`（灰蓝） | `#a2b3c8` | 文献卡头部图标+类型字 |
| `--zmd-board-note-accent` | `#816b4e`（棕） | `#bdae95` | 普通笔记卡头部 |
| 框架 frame 描边 / 底 | `#94a3b8` / `rgba(59,130,246,.05)` | `#64748b` / `rgba(96,165,250,.08)` | 分组框（`academic.ts`） |
| 点阵背景 | xyflow 默认 `#91919a`，间距 16、点 1px | xyflow 暗色 `#555` | `app.tsx` `<Background variant=Dots gap=16 size=1>`，`colorMode={theme}` |
| 选中 | 卡片 `outline 1.5px` 用正文色（不是蓝光晕） | 同 | DESIGN.md "crisp theme-aware outline instead of a blue glow" |
| 连接点悬停 | 填 accent + `0 0 0 4px accentSoft` | 同 | board.css 第 65 行 |

### 1.3 学术卡片颜色（五种笔记类型 + 文献/引文/框架）

来源：`packages/whiteboard/src/model/academic.ts` 的 `NOTE_TYPE_SURFACES` 与 `DARK_NOTE_TYPE_COLORS`（原值是 oklch，下面的 hex 是我换算的近似值）；DESIGN.md「Research Canvas Cards」。中文名来自 zh-CN ftl。

| 类型（中文 / 代码） | 浅色 填充 / 描边 | 暗色 填充 / 描边 | 形状区别（不只靠颜色） |
|---|---|---|---|
| 笔记 note | `#ffffff` / `#e5e7eb` | `#1a1d24` / `#3d4452` | 圆角 8，1px 实线，头部棕色 |
| 问题 question | `oklch(96% .045 88)`≈`#fef1d0` / `oklch(68% .10 85)`≈`#b5934a` | ≈`#2c2616` / ≈`#a68c54` | **圆角 16 + 1px 虚线** |
| 观点 claim（界面叫 Viewpoint/观点） | ≈`#e1f5e3` / ≈`#5f916a` | ≈`#1f2a20` / ≈`#6d9574` | 圆角 8，**2px 粗实线** |
| 证据 evidence | ≈`#e2f5ff` / ≈`#6799bc` | ≈`#1a2833` / ≈`#6795b6` | **圆角 4（近方角）** |
| 总结 summary | ≈`#f1ebff` / ≈`#9988ba` | ≈`#282332` / ≈`#9989b7` | 圆角 12 |
| 文献 literature | 白底，头部灰蓝 `#536b85` | `#a2b3c8` | 标题加粗 + 引文行 + `#标签` + 批注数页脚 |
| 引文 quote | 白底，正文左 2px 竖线 `#b8bdc5` | 竖线 `#3d4452` | 右上 8px 圆点 = PDF 批注原色（示例 `#ffd400`） |
| 框架 frame | 见 1.2 | 见 1.2 | 2px 描边分组框 |

代码注释的原话："Low-chroma paper colors distinguish roles without competing with the text." —— 低彩度纸张色，靠形状+图标+文字标签区分，不只靠颜色。

连线关系（`model/connection.ts`、`model/tutorial.ts`）：
- 支持 supports：绿 `#2f855a`，单箭头
- 反驳 contradicts：红 `#c2413a`，虚线，双箭头
- 相关 related：石板灰 `#64748b`，虚线，无箭头
- 默认连线：`#9ca3af`（暗 `#6b7280`），1.5px，悬停/选中 2.5px，`ArrowClosed` 16px，贝塞尔曲线（`ConnectionLineType.Bezier`）

### 1.4 用户可选配色方案（`packages/whiteboard/src/model/colorSchemes.ts`）

色板弹窗是 **6 个色系 × 3 个深浅**。浅色模式"浅填充在前"，暗色模式顺序反过来。默认方案是 `traditional`（`addon/prefs.js`：`whiteboardColorScheme = "traditional"`）。

- **traditional（默认，中国传统色）**——中间一档取自 zerosoul/chinese-colors（MIT），浅/深两档是派生色：
  红 `#f8c8bd / #ed5736 / #8f2f20`；金 `#fbefc9 / #f2be45 / #8f671d`；绿 `#dcece3 / #519a73 / #2b5c43`；蓝 `#d3e8f2 / #177cb0 / #0f4563`；紫 `#e7d2ef / #801dae / #4c1268`；墨 `#e1e7e9 / #50616d / #2e3940`。
  （仓库没写这些颜色的中文名，片子里如要写色名，需要另查核对。）
- **classic（旧画布配色，逐字节兼容）**：灰 `#f1f3f5/#adb5bd/#343a40`、粉 `#ffe3e3/#e599a4/#a34557`、黄 `#fff3bf/#d9b45a/#946b28`、绿 `#e3f0e4/#8eb998/#426d50`、蓝 `#e3edf7/#85a9ca/#416888`、紫 `#eee6f5/#b39aca/#75558d`。

### 1.5 品牌色（标志里的颜色，和 UI token 不是一套）

| 来源 | 墨色（主体） | 鼠尾草绿（折角） | 其他 |
|---|---|---|---|
| `docs/icons/scholar-sketch-logo.png`（实测均值） | `#1a2527`（偏绿的炭黑） | `#718b7a` | 标语灰 `#596066`，底 `#fefefe` |
| `addon/content/icons/favicon.png`（实测均值） | `#161f21` | `#657967` | 象牙色圆角底 `#f8f8f6`，有纸纹 |
| `addon/content/icons/scholar-sketch-toolbar.svg` 等矢量图标 | 浅色 `#3a5147` / 暗色 `#d9e0db` | 浅色 `#8ca58d` / 暗色 `#adc3b4` | 附件图标：Markdown "M" 橙 `#c15c25`（暗 `#ffdab5`），白板小图 紫 `#7c3aed`（暗 `#c4b5fd`） |

结论：**品牌识别色 = 墨色 + 鼠尾草绿**；**界面强调色 = Research Blue**。两套颜色分工明确：绿只出现在标志/图标的折角，蓝只出现在界面交互状态。

---

## 2. 字体

### 2.1 产品界面实际用的字体

- 界面 / Markdown 实时预览 / 白板：`system-ui, -apple-system, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif`（`src/ui/theme.ts --zmd-font-ui`、`src/editor/theme.ts FONT_PROSE`、DESIGN.md typography）。也就是说 **产品本身没有品牌字体，跟随系统**：macOS = 苹方 + SF，Windows = 微软雅黑 + Segoe UI。
- 用户可选：衬线 `Georgia, "Noto Serif SC", "Songti SC", serif`；等宽 `ui-monospace, "Sarasa Mono SC", "Noto Sans Mono CJK SC", …`（`preferences.ts`、白板 `app.tsx` `APPEARANCE_FONT_FAMILY`）。
- 源码模式等宽：`"JetBrains Mono", "SFMono-Regular", Consolas, …`。
- 字号与行距（DESIGN.md、`src/editor/theme.ts`、`addon/prefs.js`）：
  - Markdown 正文：默认偏好 **15px**（`prefs.js fontSize=15`，DESIGN.md 写 14px），实时预览行高 **1.75**（DESIGN 写 1.7），正文列最大宽 48–50rem，居中。
  - 标题：H1 1.75em/700，H2 1.4em/650，H3 1.2em/600，H4 1.05em/600。
  - 工具栏标签 12px/500，状态栏 11px/500（数字用等宽数字），大纲条目 12px，侧栏标题 13px/600。
  - 白板卡片：标题 13px 粗体（行高 1.35），正文/引文/元信息 12px（行高 1.45），类型标签 11px/500 大写，标签 10px；形状文字默认 16px。

### 2.2 本机（渲染机器）实际有什么字体

`fc-list :lang=zh family` 结果——中文字体只有：
- **文泉驿正黑 WenQuanYi Zen Hei**（还有 Mono / Sharp 变体），**只有 Regular 一档字重**（fc-query weight=100 只有一档）。
- 另有 Unifont（点阵，不能用）、IPAGothic（日文）。

`fc-list | grep -i -E "inter|noto|source|sarasa|lxgw"`：
- **Inter 和 Inter Display 全字重（Thin–Black，含斜体）**，包 `fonts-inter`，许可 **OFL-1.1**。
- Noto 只有 Noto Color Emoji；**没有** Source Han / 思源、Sarasa、霞鹜文楷、Noto Sans SC。

Chromium 实测（CDP `CSS.getPlatformFontsForNode`）：产品字体栈在本机落到 **Inter（拉丁）+ 文泉驿正黑（中文）**。`system-ui`、`sans-serif` 都解析为 Inter；`sans-serif:lang=zh-cn` → 文泉驿正黑。所以 **真组件在本机渲染出来，中文就是文泉驿正黑**，和用户在 Mac 上看到的苹方不一样——这是正常的平台差异，不影响"保持原设计"（原设计本来就是跟随系统字体）。

### 2.3 片子标题字体建议（全中文）

| 方案 | 字体 | 状态 | 许可 | 评价 |
|---|---|---|---|---|
| **A（本机已装，推荐保底）** | 文泉驿正黑 WenQuanYi Zen Hei | 已安装 `/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc` | **GPL-2 + 字体嵌入例外**（Debian copyright 文件） | 无衬线、字形端正。缺点：只有一个字重，粗体是浏览器合成的，大字号时笔画略粗糙。渲染成视频像素不涉及分发字体文件，用起来没问题；如果把 ttc 文件放进可分享工程，要附 GPL 许可。 |
| B（更好，需加一个 npm 依赖） | Noto Sans SC Variable（`@fontsource-variable/noto-sans-sc@5.3.1`，100–900 可变字重） | 已在 scratch 下载并验证能加载、能渲染（见字体样张 C 列），**没有装进视频工程** | **OFL-1.1** | 真正的多字重，气质接近苹方/雅黑这类"系统黑体"，和产品"跟随系统"的设计最一致。registry.npmjs.org 可用：`npm i @fontsource-variable/noto-sans-sc@5.3.1 --registry=https://registry.npmjs.org/`（约 4.6 MB，101 个分片 woff2）。 |

建议：**标题用方案 B（Noto Sans SC，600–700 做主标题，400 做说明）；若不想加依赖，用方案 A。** 拉丁字母（产品名 Scholar Sketch、Zotero、Markdown、版本号 0.2.9、`[[`、`.md`/`.canvas`）配 **Inter / Inter Display**（已装，OFL-1.1），字重与中文对齐。
不建议用衬线或手写体做标题：产品气质是"安静、精确、原生"，DESIGN 明确是系统无衬线；visual-vocabulary 也提醒"中文用衬线显得老气"。

字体样张静帧：`…/research/style/font-specimen.png`（A 列 = 产品字体栈在本机的真实效果；B 列 = 文泉驿正黑常规 + 合成粗；C 列 = Noto Sans SC Variable）。

---

## 3. 空间、形状、阴影、线宽、密度

| 项目 | 数值 | 来源 |
|---|---|---|
| 基础控件尺寸 | 36px（紧凑 32px），图标 18px（白板卡头图标 14px、线宽 1.6） | `src/ui/theme.ts UI_METRICS`，board.css |
| 圆角 | 通用 8px，小 6px，按钮 7px；白板工具岛/属性面板 12px；卡片默认 8（问题 16、证据 4、总结 12） | `UI_METRICS.radius`，DESIGN.md，board.css，academic.ts |
| 卡片内边距 | 上下 12px、左右 14px；卡头高 14px、与正文间距 8px；页脚上边 1px 分隔线 + 6px | board.css 开头 `--zmd-card-*` |
| 默认卡片尺寸 | 笔记 260×152；文献 280×200；引文 280×192 | `note-template.ts`、`academic.ts ACADEMIC_SOURCE_CARD_SIZE` |
| Markdown 版心 | 居中 48rem 列（内容 maxWidth 50rem），左内边 34px、右 30px，状态栏 5px/28px | DESIGN.md，`src/editor/theme.ts` |
| 阴影 | 卡片 `0 1px 2px rgba(16,24,40,.04)`（几乎看不见）；工具岛 `0 1px 2px rgba(16,24,40,.08)`；菜单 `0 8px 20px rgba(16,24,40,.16)`；批注浏览器、帮助面板这类弹层最大 `0 16px 40px rgba(15,23,42,.18)` | board.css、theme.ts |
| 线宽 | 结构线 1px；卡片选中 outline 1.5px；连线 1.5px（悬停 2.5px）；观点卡 2px；框架 2px；形状默认 2px；连接点 8px 圆（命中区再外扩 5px） | board.css、academic.ts |
| 点阵 | 间距 16px，点 1px | app.tsx |
| 密度 | 偏高、紧凑：控件 32–36px，正文 12–15px，分组靠 1px 分隔线而不是容器 | DESIGN.md "Dense enough for frequent writing actions" |

DESIGN.md 的禁止项：不要给编辑器外壳加浮动卡片、大阴影、渐变、玻璃效果、营销式构图；控件不要放进圆角组容器；常规按钮不用蓝色实底。

---

## 4. 品牌资产

### 4.1 文件清单

| 文件 | 尺寸 | 是什么 | 片子能不能用 |
|---|---|---|---|
| `docs/icons/scholar-sketch-logo.png` | 1672×941，RGB（**无透明**，底 ≈`#fefefe`） | **官方完整横版标志**：折角纸图形 + 两行字标 "Scholar / Sketch" + 标语 "READ · ORGANIZE · THINK"。README 和中文 README 都用它；`model/tutorial-logo.ts` 也把它内嵌进示例白板。 | ✅ 主标志。浅底上可用 `mix-blend-mode: multiply` 去掉白底。 |
| `addon/content/icons/favicon.png` | 1254×1254，**RGBA 透明** | **官方 app 图标**（manifest 48/96 用它）：象牙色带纸纹的圆角方块（实测占画布约 74%，930×930），中间是折角纸图形（466×624 px）。 | ✅ 应用图标/片尾小图标；深色底也能用。 |
| `addon/content/icons/scholar-sketch-toolbar.svg` | 20×20（viewBox 16） | 工具栏按钮图标：**细线版折角纸**，自带暗色媒体查询 | ✅ 唯一的矢量版标志图形（但比 PNG 细，见 4.3） |
| `addon/content/icons/attachment-canvas.svg` | 16×16 | 白板附件图标：折角纸 + 紫色小"流程图"（方块+圆+折线） | ✅ 可做"白板文件"的小图标 |
| `addon/content/icons/attachment-markdown.svg` | 16×16 | Markdown 附件图标：折角纸 + 橙色 "M" | ✅ "Markdown 文件"小图标 |
| `attachment-canvas-link.svg` / `attachment-markdown-link.svg` | 16×16 | 上面两个 + 链接环（链接附件） | 可选 |
| `sidebar-markdown.svg` / `sidebar-markdown-dark.svg` | 16×16 | 侧栏 Markdown 图标（固定色，无 style） | 可选 |
| `addon/content/icons/markdown/*.svg`（29 个） | 小图标 | 编辑器工具栏图标（bold/h1/h2/h3/italic/link/table/task/image/code/save/undo/redo/live/preview/source/canvas/palette/more/panel-left/right…），Lucide 风格细线 | ✅ 真界面的一部分 |
| `docs/icons/scholarCanvas-icon.png` | 1254×1254 RGB | **旧名 "Scholar Canvas" 时期**的图标（带外阴影、白底不透明） | ❌ 旧版，不用 |
| `docs/icons/scholarCanvas-vertical.png` | 1122×1402 | 旧名竖版标志 "Scholar Canvas" | ❌ 名字错 |
| `docs/icons/scholarCanvas-demo1/2/3.png` | 1672×941 / 1122×1402 / 1448×1086 | AI 生成的品牌样机图（墙面标识、笔记本封面、信纸名片），写的是旧名；demo3 里有 **虚构人物 "Alex Chen, Founder & CEO"、虚构地址和邮箱** | ❌ 绝对不用（旧名 + 虚构信息） |
| `docs/icons/attachment-icons-*-preview.png`、`plugin-icon-transparent-preview.png` | 1280×720 / 1265×712（其实是 JPEG） | 图标修改前后对比页（设计过程记录），上面也写着旧名 | ❌ 过程稿 |

来源说明：标志 PNG、favicon 和 scholarCanvas-* 都带 C2PA 元数据，签发方是 "OpenAI Media Service API"——即这些位图是用图像生成工具做的（`docs/icons/plugin-icon-background-edit.md` 也写了 favicon 是用 ImageGen 改的）。这是仓库自己的官方资产，可以用；但 **没有矢量字标，也没有字体文件**。

### 4.2 哪个是"官方"

- **完整标志（横版 lockup）**：`docs/icons/scholar-sketch-logo.png`。
- **App 图标**：`addon/content/icons/favicon.png`。
- **单色/小尺寸**：`scholar-sketch-toolbar.svg`（线稿，浅/暗两套色）。
- 没有单独的竖版新标志、没有单色 PNG、没有 SVG 字标。

### 4.3 标志几何（实测 `scholar-sketch-logo.png`，可直接当母题材料）

折角纸图形（emblem）外框 219×287 px（宽高比 ≈ **0.76，约 3:4 的竖纸**）：
- **一张竖放的纸，用粗线勾边**：线宽约 19px ≈ **宽度的 8.7%**，墨色 `#1a2527`。
- **左上、右上、左下三个角是小圆角**（外半径 ≈14px ≈ 宽 6.4%），内框角几乎是直角。
- **右下角是一个大圆弧**（半径 ≈64px ≈ 宽 29%），像纸角被"卷"过——这是整个标志最有辨识度的一笔。
- **折角**：右下内侧有一块 ≈74×77px（≈ 宽 34%）的 **鼠尾草绿方块，左上角圆角（≈20px）**，被一条 **45° 斜线**切开：斜线左上是绿色（纸背翻过来的那一面），斜线右下是墨色实心三角，和外框粗线、大圆弧连成一体。读起来就是"纸的一角向内折起"。
- 字标：图形右边 63px（≈0.29 个图形宽）起，两行 "Scholar / Sketch"，几何感的无衬线（像 Inter Display/新怪诞体一类，**但仓库里没有字体文件，只有位图**），两行字的总高度和图形高度基本对齐；墨色与图形同色。
- 标语：下方一行宽字距大写 "READ · ORGANIZE · THINK"，灰 `#596066`，从图形左边一直对齐到字标右边。

SVG 线稿版（`scholar-sketch-toolbar.svg`，viewBox 16）：外框路径 `M4.2 1.5h7.6 … a4.4 4.4 0 0 1-4.4 4.4H4.2 …`（三个 1.2 小圆角 + 右下 4.4 大圆角），折角 `M9 13.7v-2.1c0-.61.49-1.1 1.1-1.1h2.1Z`（只有绿色那一块，没有墨色三角）。**比例和 PNG 不同**（SVG 大圆角 ≈ 宽 44%，线更细），所以它是"小尺寸简化版"，不能直接放大冒充主标志。

用法建议：
- 片尾定版用 PNG 原图，**尽量 ≤1× 原始像素**（图形最高约 287px、字标宽约 493px；favicon 里的图形可到约 620px 高）。放大超过约 1.3× 会发虚。
- 如果要做"纸角折起""线条画出纸框"之类的动画，可按上面的实测比例 **重建一个粗线矢量版做过程动画，结束时交叉切回 PNG 原图**，不要让重建版成为最终定版。
- **全中文要求的冲突**：PNG 里的英文标语 "READ · ORGANIZE · THINK" 是英文。建议裁掉标语（裁剪 y < 600 的部分即可，只留图形+字标），另用片子中文字体写中文标语（例如直译"阅读 · 整理 · 思考"）——这一点需要用户确认。产品名 "Scholar Sketch" 本身是专有名词，保留英文字标是合理的。

---

## 5. 镜头适配

### 5.1 能直接复用的真界面细节

- 白板：点阵画布、顶部工具岛、五种笔记卡 + 文献卡 + 引文卡（含批注色点）+ 框架、贝塞尔连线与关系色（支持绿/反驳红/相关灰）、连接点悬停的蓝圈、选中 outline、批量样式面板、色板弹窗（传统色 6×3）、**格式刷**（v0.2.9 新功能：源/目标卡片外 4px 的蓝色虚线/实线框 + 4px 淡蓝外圈、自带的刷子光标 SVG、底部"点击目标应用样式 · Esc 退出"提示条）。
- Markdown：实时预览（当前行露出 `#`、`**` 等标记，其余渲染好）、表格、`[[` 弹出的引用选择器（带 Zotero 条目图标和 全部 / 常规条目 / 笔记/附件 / 已打开 筛选）、左侧大纲、右侧"引用此笔记"反链面板、状态栏"自动保存已开启"+ 绿色勾。
- 工具栏图标（`addon/content/icons/markdown/*.svg`）、附件图标（白板/Markdown）。

### 5.2 需要放大（目标：成片里界面正文 ≥ 22px @1080p）

倍数 ≈ 22 ÷ 产品字号：

| 界面元素 | 产品字号 | 需要的倍数 | 建议 |
|---|---|---|---|
| Markdown 正文 | 15px（偏好默认；DESIGN 写 14px） | 1.47（14px 时 1.57） | **1.6×**（正文 ≈ 24px，H1 ≈ 42px） |
| 白板卡片正文 / 引文 / 元信息 | 12px | 1.83 | **2.0×**（≈ 24px） |
| 白板卡片标题 | 13px 粗 | 1.69 | 2.0× 时 26px |
| 卡片类型标签 | 11px | 2.0 | 2.0× 时刚好 22px |
| 卡片 #标签 | 10px | 2.2 | 2.0× 时 20px（装饰性，可接受；要读就 2.2×） |
| 工具栏标签 / 菜单 | 12px | 1.83 | 2.0× |
| 状态栏 | 11px | 2.0 | 2.0×，或只做特写 |

- 白板用 **xyflow 自己的视口缩放（zoom=2）** 比 CSS transform 更清楚（文字按矢量重排）；但工具岛、属性面板这类"外壳"不跟视口缩放，要单独用 CSS `zoom`/scale 2×。
- 2× 时一张 260×152 的笔记卡占 520×304px，一屏（1920×1080 ÷ 2 = 960×540 产品像素）大约放 3–4 张卡和它们的连线——适合"一个镜头讲一件事"。
- 完整窗口（全景）只做交代镜头，那时字一定小于 22px，不要让观众读。
- 需要裁切/拆分的：Markdown 三栏（大纲/正文/反链）放大 1.6× 后放不下，要分镜：正文一镜、`[[` 选择器一镜、反链面板一镜。批量样式面板可单独特写。

### 5.3 暗色主题——有，可以直接启用

- 两个界面都有完整暗色 token（见 1.1–1.3），DESIGN.md 要求"明暗两套层级等价，不是简单反色"，五种卡片也有低亮度暗色版。
- 白板开启：给 `WhiteboardApp` 传 `theme="dark"`（或 `runtime.setTheme("dark")`；iframe 版本发 `{type:"setTheme", payload:{theme:"dark"}}`），宿主上会出现 `data-theme="dark"`，`html[data-theme="dark"]` 也生效；xyflow 跟着 `colorMode` 变暗（点阵 `#555`）。来源：`packages/whiteboard/src/bootstrap.tsx`、`app.tsx`。
- Markdown 开启：偏好 `extensions.zotero.bamboo.theme = "dark"`（可选 system/light/dark），或在浏览器里 `prefers-color-scheme: dark`（Playwright `colorScheme: 'dark'`），或根元素 `data-theme="dark"`/`theme-dark` 类。来源：`src/modules/markdown/editor.ts resolveEditorTheme`。
- 注意：标志 PNG 没有暗色版；暗场里用 favicon（自带象牙色底块）或 toolbar SVG 的暗色配色（`#d9e0db` + `#adc3b4`）。

---

## 6. 母题候选（都来自产品本身）

| # | 产品里有什么 | 可以长成什么画面 | 强度 |
|---|---|---|---|
| 1 | **折角纸标志**：竖纸 + 右下大圆弧 + 45° 折起的绿色纸角 | 粗线一笔画出纸框 → 右下角"折起"露出鼠尾草绿；或用"纸角翻折"做转场（前一镜从右下角折走，露出下一镜） | ★★★ 唯一的品牌图形，适合开场/片尾 |
| 2 | **点阵画布本身**（16px 点阵、无限平移缩放） | 整片的"桌面"：镜头在同一张点阵画布上平移/推拉，章节之间不换背景，只换位置（一镜到底式） | ★★★ 安静、原生 |
| 3 | **卡片 + 连线**（五种卡片、支持/反驳/相关三种关系、贝塞尔曲线、四边连接点） | 一张一张卡片落到桌面，连线从连接点"拉"出来（真实拖拽），最后组成一条论证链；引用 tutorial 里的中文"五种卡片，一条思路" | ★★★ 核心功能就是母题 |
| 4 | **`[[` 双链语法** | 打出 `[[` → 选择器弹出 → 链接成形 → 反链面板里同一句话出现；也可以把 `[[ ]]` 两个方括号当作画面里的"括号/取景框"元素 | ★★☆ |
| 5 | **Markdown 纯文本**（实时预览：当前行露出 `#` `**` 标记，离开后渲染） | "源码 ↔ 渲染"切换的匹配剪辑：同一行字从带标记的纯文本变成排好版的标题 | ★★☆ 体现"可携带、可检查" |
| 6 | **PDF 批注高亮**（引文卡右上的批注色点，Zotero 批注黄 `#ffd400`；批注 → Markdown 笔记、批注 → 观点/证据卡） | 一道高亮扫过原文 → 变成引文卡 → 连到观点卡。高亮色只用批注原色，作为"来源"的标记 | ★★☆ 讲清"来源 vs 自己的想法" |
| 7 | **JSON Canvas `.canvas` 文件 / 原生 `.md` 文件**（`fromSide`/`toSide`、导出 PNG/SVG/Markdown、导出到 Obsidian） | 卡片"翻面"露出它在 `.canvas` 里的那几行 JSON（id、x、y、width、fromSide）；或附件图标（折角纸 + M / + 流程图）表示"就是普通文件" | ★★☆ 适合"可携带"章节，别做成代码雨 |
| 8 | **研究书桌隐喻**（PRODUCT.md "dependable research desk"，DESIGN.md 北极星 "The Quiet Research Desk"） | 整片的取景逻辑：俯视一张安静的桌面，东西被整齐地放上来；不需要真实照片桌面，点阵画布就是桌面 | ★★★ 定调用 |
| 9 | **中国传统色**（默认配色方案取自中国传统色） | 在格式刷/批量样式镜头里，色板上一列传统色依次"刷"到卡片上 | ★★☆ 对中文观众是加分细节 |
| 10 | **格式刷**（v0.2.9 最新功能：刷子光标、源→目标的虚线/实线框、单次/连续） | "刷"作为动词：一张卡的样式被刷到另一组卡上，作为片中"最新一笔" | ★★☆ |
| 11 | **bamboo（竹）**——内部代号：`addonRef: "bamboo"`、偏好前缀 `extensions.zotero.bamboo.*`、模板 id `bamboo.note` 等 | 只在代码里，用户看不到。**不建议做主母题**；最多做彩蛋（比如竹节一样一节一节接上的卡片链），而且不该出现竹子图像，以免观众以为是品牌元素 | ★☆☆ |

示例白板里现成的中文句子可做文案素材（`addon/locale/zh-CN/addon.ftl`）："沿着这条路径，把阅读变成相互连接的思考。""五种卡片，一条思路"；产品中文定位（`doc/README-zhCN.md`）："Zotero 中的 Markdown 编辑器与可视化白板"。

---

## 7. 决策说明（hybrid）

**为什么是 hybrid**：产品本身的视觉很克制、很"工具"，直接照搬做全片会像录屏；完全换成默认样式又会丢掉它的纸面感和卡片语言。hybrid = 界面和品牌原样保留，只重做外层的取景、字卡和节奏。

### 必须保留的品牌识别点

1. **折角纸标志**（墨色 + 鼠尾草绿折角），用仓库原图；不改形、不换色、不加光效。
2. **纸白底 + 墨色字 + 一个蓝色强调**：浅场以 `#fbfbfc` / `#ffffff` / `#111827` 为主；`#2563eb` 只出现在真实交互状态（焦点、选中、连接点、链接），不拿来铺大面积背景。
3. **五种卡片的颜色和形状**（问题=淡黄虚线大圆角，观点=淡绿粗边，证据=淡蓝方角，总结=淡紫，笔记=白），以及文献卡/引文卡/框架的样子——这是产品的"词汇表"，不能重新上色。
4. **点阵画布、1px 细线、8px 圆角、几乎没有的阴影、贝塞尔连线 + 闭合箭头**。
5. **系统黑体的界面字体**；真组件内部的字体、字号、行距不改（只整体放大）。
6. 暗色镜头直接用产品自己的暗色主题（`#12141a` / `#1a1d24` 和暗色卡片），不自己调一套。

### 可以改的外层

- 画面外的取景：大幅留白、推拉平移、局部特写、分屏，把真界面"摆"在一张更大的点阵/纸白桌面上。
- 宣传字卡：中文标题用片子自己的字体（建议 Noto Sans SC，保底文泉驿正黑），字号阶梯和位置按片子重新设计；字色用墨色 `#111827`/标志墨 `#1a2527`，副标题用 `#6b7280`。
- 节奏、转场、配乐；可以在浅场与产品暗色主题之间做明暗段落（用硬切，不做长交叉淡化）。
- 可以把卡片之间的连线、折角动作延伸到界面外的字卡上（例如字卡之间用同样的 1.5px 贝塞尔线连接），作为"外层"和"产品"之间的桥。

### 如何保持 "Quiet, precise, and native"（遵守 PRODUCT.md 反参考）

- **不要**：仪表盘式卡片网格、装饰性渐变、玻璃/毛玻璃、大阴影、发光地平线/粒子星空这类"营销大片"手法、吵闹的状态胶囊、IDE 式黑底代码墙。
- **要**：
  - 一个镜头只有一个主角，界面以外大面积留白；
  - 动效轻、短、准：位移小、缓动平稳（不回弹、不弹跳、不彩虹色），每个动作都对应一个真实操作（拖入一篇文献、拉一条连线、打一个 `[[`、刷一次格式）；
  - 颜色只来自 token 表和卡片色，强调色只做"指一下"的作用；
  - 阴影最多到产品自己的菜单阴影（`0 8px 20px rgba(16,24,40,.16)`），卡片保持几乎无阴影；
  - "来源"和"自己的想法"在画面上要分得清（文献/引文 = 白卡 + 灰蓝/批注色点；问题/观点/证据/总结 = 彩色纸卡），这正是产品原则 1 的视觉化；
  - 尊重"减少动效"的精神：不用闪白、抖动、快速频闪。

---

## 附：本次做了什么、没做什么

- 实际看过：三张产品截图、标志 PNG、favicon、旧名图标与样机图、图标对比页；读过 PRODUCT.md、DESIGN.md、`src/ui/theme.ts`、`src/editor/theme.ts`、`board.css`、`academic.ts`、`colorSchemes.ts`、`note-template.ts`、`tutorial.ts`、相关 SVG、中文 ftl。
- 实测：标志颜色与几何（PIL 像素统计）、本机字体（fc-list / fc-query / Chromium CDP 实际用字）、oklch → hex 换算。
- 渲染静帧 2 张（色板/标志、字体样张），都是本机 Chromium 实际渲染。色板静帧里的卡片是按 token **手画的色样，不是真组件**，只用来核对颜色。
- 没做：没有挂载真组件（属于组件接入阶段）；没有改动产品仓库和视频工程；Noto Sans SC 只下载在 scratch 目录 `…/research/style/dl/`，没装进视频工程。
- 未核实：traditional 配色里各色的中文色名（仓库没写）；macOS/Windows 上苹方/雅黑下的实际观感（本机没有这些字体）。
