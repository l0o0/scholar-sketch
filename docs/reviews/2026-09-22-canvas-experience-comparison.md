# Scholar Sketch 与 Obsidian Canvas：设计和交互对照

评估日期：2026-09-22。对象是当前工作区版本，包含尚未提交的现有修改。以下主体记录优化前的评估；用户随后授权多代理实施第一批优化，结果见文末。

## 结论

最值得改善的是连续操作的流畅程度，以及内容与工具的视觉主次。现有画布已经支持文献、批注、研究笔记、模板、连接与重连、缩放、框选、对齐、分布和来源操作；继续增加图形种类的收益有限。

优先把“产生想法 → 写下来 → 连到证据 → 整理成主题 → 回看来源”这一条路径做好。当前多个断点已经有底层模型，可以通过补齐入口和一致性来改善，无需重写画布。

## 评估范围与依据

- 实际运行当前 Vite 入口中的生产 `WhiteboardApp`，使用 Fake Zotero 数据，观察默认状态、创建与编辑笔记、空白双击、空白右键、选中文献以及批注列表。测试内容只在页面内操作，没有保存到原有画板。
- 检查相关组件、事件处理、数据模型与现有测试；由另一代理独立核查交互实现。没有把规划文档中的目标当作已实现功能。
- 对照 [Obsidian Canvas 官方操作说明](https://obsidian.md/help/plugins/canvas) 与[官方界面及操作示例](https://obsidian.md/canvas)。没有启动原生 Obsidian，也没有将第三方 Canvas 插件功能混入基础比较。
- 浏览器实例不等于完整 Zotero：本次没有验证原生 PDF 跳转、数据库、真实文件保存、Gecko 输入行为、深色模式或大量节点性能。预览顶部的 Fake Zotero lab 是开发工具，不纳入产品界面批评。

以下“实测”表示本次在界面中观察到；“代码确认”表示实现证据；“设计建议”表示我的判断，尚需用户任务验证。

## 主要体验差距

| 维度       | Obsidian Canvas 的参照能力              | 当前项目的情况                                                         | 建议                                                       |
| ---------- | --------------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------- |
| 即时创建   | 空白双击、右键创建、拖出连线后创建卡片  | 实测空白双击没有进入新建；空白右键只有导出。现有主路径是选工具后点画布 | 第一批补空白双击新建笔记并立即输入、右键新增；再补拖线续建 |
| 连接表达   | 连线有标签，可双击编辑，并可重连端点    | 已有重连；新连线固定为 basic，模型中的标签与研究关系没有编辑入口       | 双击连线编辑文字；选线后提供“相关／支持／反驳”             |
| 分组       | 可围绕选中的卡片创建分组                | 有 Frame 和成员移动逻辑，但没有把所选卡片编入 Frame 的 UI              | 框选 → 创建分组，支持移入和移出，再考虑嵌套                |
| 正文阅读   | 卡片可使用 Markdown，笔记可在画布内编辑 | 实测 `##`、`**`、列表标记原样显示；正文是纯文本                        | 先支持阅读态标题、列表、强调和链接，再评估完整编辑器       |
| 选区与整理 | 支持选区复制、对齐、分布等操作          | 已有对齐和分布；“Copy”只克隆一个节点，自动布局重排全部节点             | 整组选区复制并保留内部连线；整理优先作用于选区             |
| 局部导航   | 支持聚焦选区及沿连接跳转                | 通用导航只有适应全部等基础操作，尚无用户可调用的聚焦选区入口           | 先加聚焦选区、明确缩放比例；后续加画布内查找定位           |

上述 Obsidian 行为分别见[官方帮助](https://obsidian.md/help/plugins/canvas)与[官方操作示例](https://obsidian.md/canvas#protips)。画布内查找定位是针对本项目的建议，本次没有将其认定为 Obsidian Canvas 的基础能力。

### 1. 创建应该发生在思考的位置

实测：在空白处双击并未产生卡片；右键只有 PNG、SVG、Markdown 导出选项。新建笔记的现有入口会在放置后直接进入编辑，这部分可以保留。

建议给空白处双击一个稳定含义：在鼠标位置创建普通笔记并输入。右键优先提供新建笔记、添加文献、创建分组；导出移到文档操作菜单。后续实现从现有卡片拖出连接，在空白处选择新笔记类型，让“写下一条相关想法”不需要反复返回工具栏。

证据：[画布点击处理](/home/l0o0/workspace/zotero-markdown/packages/whiteboard/src/whiteboard/app.tsx:2497)、[右键菜单](/home/l0o0/workspace/zotero-markdown/packages/whiteboard/src/whiteboard/app.tsx:2627)。实现空白双击时，需要一并处理默认双击缩放，避免同一手势产生两种结果。

### 2. 把研究关系变成用户能操作的内容

代码确认：新连接固定为 `basic`。数据模型已经支持自由标签以及 `related / supports / contradicts`；UI 主要提供颜色、虚线与箭头切换。

建议开放现有三种关系和自由文本标签，选线时就地编辑。视觉上用文字说明关系，颜色与线型提供辅助，避免要求用户记住每种颜色的含义。已有重连功能应保留，不需要作为新功能重复建设。

证据：[连接创建](/home/l0o0/workspace/zotero-markdown/packages/whiteboard/src/whiteboard/app.tsx:1372)、[关系模型](/home/l0o0/workspace/zotero-markdown/packages/whiteboard/src/model/connection.ts:1)、[连接工具](/home/l0o0/workspace/zotero-markdown/packages/whiteboard/src/chrome/TopIsland.tsx:400)。

### 3. Frame 必须具有清楚的成员关系

代码确认：`assignNodeToFrame` 已存在，但调用只出现在测试；移动 Frame 仅会带动已有 `frameId` 的成员。把卡片摆进框内不等于加入分组，当前测试也明确保持这一行为。

建议第一步做“将所选卡片组成分组”，直接利用现有成员模型，同时提供移出操作。第二步才做拖入高亮与加入反馈。仅补框的颜色和标题无法解决这个操作断点。

证据：[成员分配](/home/l0o0/workspace/zotero-markdown/packages/whiteboard/src/whiteboard/frame.ts:34)、[整体移动](/home/l0o0/workspace/zotero-markdown/packages/whiteboard/src/whiteboard/frame.ts:64)、[拖动不自动归组的测试](/home/l0o0/workspace/zotero-markdown/test/whiteboard-app-state.test.ts:2644)。

### 4. 明确“笔记”与“画布文字”的区别

实测：笔记中的 Markdown 标记原样显示。代码中，Note 是正文、类型、模板和可选来源组成的研究卡片；Text 只有简单标题数据。两者现在都使用卡片外观，用户需要额外学习区别。

建议 Note 承担 Markdown 正文，Text 呈现为轻量的区域标题或旁注。笔记阅读态应有清楚的标题、正文、引用与列表层级；作者、年份、页码保持可辨认，但视觉上次于正在比较的内容。新卡片默认高度可更贴近内容，同时保留用户手动尺寸。

可以复用 [renderMarkdownCore](/home/l0o0/workspace/zotero-markdown/src/modules/markdown/preview-render-core.ts:126) 的解析和 HTML 生成能力，但仍需卡片样式、链接交互及资源适配；整套宿主 iframe 编辑器不能直接放进每张卡片。先完成基础阅读态，避免一次引入完整编辑器的复杂度。

证据：[笔记渲染](/home/l0o0/workspace/zotero-markdown/packages/whiteboard/src/nodes/academic.tsx:111)、[Text 外观](/home/l0o0/workspace/zotero-markdown/packages/whiteboard/src/nodes/shapes.tsx:30)、[正文编辑](/home/l0o0/workspace/zotero-markdown/packages/whiteboard/src/whiteboard/app.tsx:2563)。

### 5. 多选后的操作应该作用于整个选区

代码确认：“Copy”在原卡片旁克隆单个节点，并未形成剪贴板；多条连线的样式操作只取第一条选中边；自动布局把全部节点传入方阵排列，不考虑当前选区及连接意义。

建议先支持复制整组选区，保留内部连接并整体偏移；未支持剪贴板前，将现有命令准确命名为“创建副本”。批量样式应统一作用于所选对象。自动整理优先处理选区并保持分组关系，无选区时明确提示其范围。

现有对齐、分布可以继续使用。吸附单位是 16，背景点阵是 20，建议统一，让视觉位置与拖动反馈一致。

证据：[复制节点](/home/l0o0/workspace/zotero-markdown/packages/whiteboard/src/whiteboard/app.tsx:1680)、[批量边操作](/home/l0o0/workspace/zotero-markdown/packages/whiteboard/src/whiteboard/app.tsx:2299)、[自动布局](/home/l0o0/workspace/zotero-markdown/packages/whiteboard/src/whiteboard/app.tsx:1852)、[布局算法](/home/l0o0/workspace/zotero-markdown/packages/whiteboard/src/whiteboard/layout.ts:110)、[吸附配置](/home/l0o0/workspace/zotero-markdown/packages/whiteboard/src/whiteboard/app.tsx:2428)。

## 视觉与操作层级

以下是基于实际预览的设计判断，不是已测量的用户研究结论。

- **收拢常驻工具。** 顶部创建栏、左侧图形栏、右侧属性面板、右下角导航形成四个注意力区域；左侧又混合绘图、历史、保存、导出与布局。建议常驻保留选取／移动、文献、笔记、分组，将矩形、椭圆、线条与橡皮擦收入绘图菜单；文档操作和导航各归一处。左右各一处的 Fit view 也可合并。
- **减少单击选中后的遮挡。** 在约 810 像素宽的预览中，右侧属性浮层直接覆盖了另一张卡片。它的内容主要是若干操作和重复标题，适合改成选区附近的小工具条；详细属性按需展开，窄窗口提供可收起的面板。来源可用时不必常驻大段状态文字，异常时应明确显示。
- **把样式入口变得可发现。** 当前双击内部与双击边缘分别触发编辑／打开来源和样式面板。建议将颜色、样式放进明确的选中工具或右键菜单，避免用户依靠命中细小边缘来发现。
- **保留克制的卡片底色，强化内容差异。** 当前浅色背景、细边框和圆角已有清晰基础。下一步应优先调正文排版、默认尺寸、元信息密度、选中态和连接标签，而不是增加渐变、装饰或更强阴影。

证据：[工具组织](/home/l0o0/workspace/zotero-markdown/packages/whiteboard/src/chrome/TopIsland.tsx:112)、[属性浮层尺寸](/home/l0o0/workspace/zotero-markdown/packages/whiteboard/src/whiteboard/board.css:286)、[属性操作](/home/l0o0/workspace/zotero-markdown/packages/whiteboard/src/chrome/PropertiesPanel.tsx:104)、[双击命中分支](/home/l0o0/workspace/zotero-markdown/packages/whiteboard/src/whiteboard/app.tsx:2455)。

## 输入一致性：应在下一轮实装前核查

实测和代码均显示：点击外部提交正文，而 Escape 取消本次编辑。对于持续写作式卡片，建议采用即时记录、Escape 退出编辑、撤销恢复上一步；若保留当前“提交／取消”模型，界面必须明确告知，而不能让退出动作悄悄丢弃输入。

另外，生产入口全局捕获 Ctrl/Cmd+Z/Y，却未排除 textarea；画布自身的其他快捷键处理会排除编辑目标。这是代码确认的事件归属不一致，可能造成文字编辑时撤销画布。本次 Fake 入口不经过该 bootstrap，不能声称已经在真实 Zotero 中复现。

证据：[正文提交与取消](/home/l0o0/workspace/zotero-markdown/packages/whiteboard/src/whiteboard/app.tsx:2595)、[生产快捷键](/home/l0o0/workspace/zotero-markdown/packages/whiteboard/src/bootstrap.tsx:33)、[画布编辑态保护](/home/l0o0/workspace/zotero-markdown/packages/whiteboard/src/whiteboard/keyboard.ts:55)。

## 建议的实施顺序与验收场景

**第一批：让核心操作连贯。** 空白双击与右键创建、连线标签及已有关系、框选成组、聚焦选区；核查输入与画布撤销边界。工具栏做收拢，属性面板改为按需出现。这批最能改善日常操作，不依赖新增画布引擎。

验收：建立三张笔记，连接并写出“支持／反驳”，框选成组、整体移动、聚焦这一组；重复完成过程中不需要寻找隐藏入口，也不影响组外布局。

**第二批：提升阅读和整理。** Markdown 阅读态、Note／Text 视觉区分、整组选区复制、选区整理、可见网格与吸附一致。

验收：一张含标题、列表、强调和链接的长笔记能够阅读；复制一个有内部连线的主题组后，连接仍指向新副本；整理所选对象不移动其他主题。

**第三批：发挥 Zotero 的研究价值。** 从批注卡片就近创建观点／证据笔记，快速建立关系；保留作者、页码和回到原文的入口；后续增加按标题、正文与作者查找画布对象。缩放较小时简化元信息可以作为后续实验，需用实际多卡片画布验证。

验收：从一篇文献选取两条批注，分别支持和反驳一个观点，形成主题组，并能回到对应原文。浏览器验证交互后，还需在真实 Zotero 验证跳转和持久化。

暂不优先投入：更多形状、复杂自动布局、无限嵌套、完整网页／视频嵌入、额外主题系统。若实际研究任务证明需要，再追加。Obsidian 的通用素材嵌入值得参考；Scholar Sketch 当前更有价值的方向是将文献来源、批注和自己的判断连接得更顺畅。

## 第一批实施结果（2026-09-22）

由两个实施子代理分别负责核心画布交互和工具界面，另一个独立子代理审查；主代理负责本地化、快捷键边界、集成与实际浏览器验收。

- 空白双击创建笔记并进入编辑；空白右键提供笔记、文献和框架入口。节点和连线双击不会误创建笔记。
- 双击连线可编辑自由标签及相关／支持／反驳关系。默认关系文字按界面语言显示，保存的数据保留原始关系和用户标签。
- 框选后可创建有真实成员关系的 Frame，整体拖动会携带成员；可以移出成员。新分组默认选中 Frame，标题区域留出空间。
- 增加聚焦选区操作，以及 Shift+1 适应全部、Shift+2 聚焦选区。
- 合并常驻工具；绘图、对齐分布和文档操作收入菜单。选中属性改为小工具条，详情按需展开，并按窗口边界定位。
- 笔记正文按 Escape 保留输入并退出；画布撤销不抢占输入框的文本撤销。菜单方向键只在菜单内导航。背景点阵与吸附统一为 16。

最终验证：44 个白板测试文件、444 项测试全部通过；根项目及白板 TypeScript 检查通过；Vite 生产构建和 Zotero 插件打包通过。Vite 仍报告 CodeMirror 混合静态／动态导入与大体积 chunk 提示，本轮未调整 Markdown 编辑器的打包结构。

实际浏览器检查了 1280、810、600 像素窗口、中文／英文、浅色／深色、创建与退出编辑、分组整体拖动、聚焦选区、关系编辑、保存序列化后重载和菜单键盘操作。临时验收页面及服务已清理。独立审查发现的浮层越界、窄屏工具挤压、菜单与画布键盘冲突已修复并复查。

保存重载验收使用生产画布模型的序列化和内存重载；真实 Zotero 文件持久化、PDF 跳转与 Gecko 输入仍需在宿主中验证。Markdown 阅读态、整组选区复制及选区自动整理留在后续批次。
