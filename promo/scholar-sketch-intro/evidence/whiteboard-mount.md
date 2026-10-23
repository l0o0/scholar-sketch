# 白板挂载试验：真实 WhiteboardApp 进片子

日期：2026-10-19
试验目录：`/tmp/claude-0/-home-user-scholar-sketch/9c397663-c3ff-50bd-93ba-f5baab301bbc/scratchpad/research/wb-spike/film`（从 `promo/scholar-sketch-intro` 整个复制，含 node_modules）
产品仓库与共享视频工程都没有改动（`git status` 干净）。

## 一句话结论

能做到。生产代码里的 `WhiteboardApp`（`packages/whiteboard/src/whiteboard/app.tsx`）可以原样挂进起步工程。卡片、连线、分组、顶部工具栏、样式条、颜色菜单、格式刷、智能对齐线、批注浏览器、属性面板、文字编辑都能用真实事件驱动出来。按时间来回跳都能稳定出帧，3–7 秒的草稿 MP4 也已经导出。

有两件事必须照做，否则画面会错：
1. **放大倍数用 1.85**：卡片正文 12px，在 1080p 里变成 22.2px。
2. **装上 `src/board/local-space.js`**：它让产品在缩放层里按 1 倍坐标计算。不装的话，样式条和菜单会放错位置；外层摄像机一动，错位会更明显。

---

## 1. 要拷回共享工程的文件

都在试验目录 `film/` 下：

| 文件 | 作用 | 拷回 |
|---|---|---|
| `integration.config.mjs` | alias、tsconfigRaw、react-dom/server、字体 external | 必须（整份替换） |
| `src/film.css` | 只改了第 3 行 box-sizing（见 §4） | 必须（只改这一行） |
| `src/shots/index.js` | component 镜头换成白板 | 参考（正式片会重写） |
| `src/shots/board.jsx` | 挂载视图 + 交互脚本 + 两种摄像机 | 必须（镜头脚本按 DIRECTION 再改） |
| `src/board/library.js` | 假 Zotero 库 + **生产版** source-gateway + WhiteboardApp 回调 | 必须 |
| `src/board/fixture.js` | 用产品 model 函数搭示例白板 | 必须（内容可再改） |
| `src/board/drive.js` | 真实点击、悬停、拖动、按时间回放（可以往回跳） | 必须 |
| `src/board/local-space.js` | 坐标适配（getBoundingClientRect、innerWidth） | 必须 |
| `src/board/board-shot.css` | 镜头外框；复刻生产 `index.html` 的根样式 | 必须 |
| `src/fixtures/wb-labels.zh.json` | 产品自带的中文界面文字（自动生成） | 必须 |
| `tools/gen-wb-labels.mjs` | 从 `tab.ts` 和 `addon/locale/zh-CN/addon.ftl` 生成上面的 json | 必须 |
| `tools/gen-cjk-font.mjs` + `src/board/cjk-font.css` + `public/fonts/` | 可选：中文字体换成 Noto Sans SC（见 §8） | 可选 |
| `tools/stills-qs.mjs` | 带参数出静帧（暗色：`wbTheme=dark`） | 建议 |
| `tools/probe.mjs`、`tools/probe-shot.mjs`、`tools/platform-fonts.mjs` | 调试：量字号、跑一段点击脚本后截图、看实际用到的字体 | 建议 |

**不要拷回** `plan.json`。试验中把时长拉到 19 秒，component 镜头改成 3–16 秒，只为了测交互。

如果采用可选字体，还要在共享工程里装依赖：`npm install -D @fontsource/noto-sans-sc@5.3.1 --registry=https://registry.npmjs.org/`（许可证 OFL-1.1；试验里用的是 `--no-save`）。

## 2. 解析配置（integration.config.mjs）

```js
import path from 'node:path';
const repo = '/home/user/scholar-sketch';
export default {
  repoDir: repo,
  aliases: {
    '@wb': path.join(repo, 'packages/whiteboard/src'),        // 片子里的简写
    '@plugin': path.join(repo, 'src'),                         // 插件模块（source-gateway）
    '@zotero-plugin/fake-zotero': path.join(repo, 'packages/fake-zotero/src/index.ts'),  // dist 没构建，直接指向 TS 源码
    'react-dom/server': path.resolve('node_modules/react-dom/server.browser.js'),     // export.ts 用到 renderToStaticMarkup
  },
  external: ['/fonts/*'],                                      // 只有用可选字体时才需要
  loaders: {'.woff2': 'dataurl', '.woff': 'dataurl', '.ttf': 'dataurl'},
  define: {},
  esbuild: {tsconfigRaw: {compilerOptions: {jsx: 'react-jsx', verbatimModuleSyntax: false, useDefineForClassFields: true, target: 'ES2022'}}},
};
```

要点：
- esbuild 直接打包 TS，不用 tsc，也不用 vite。生产环境同样用 esbuild 打白板（见 `zotero-plugin.config.ts`）。
- 白板通过相对路径引用了插件代码：`src/ui/theme.ts` 和 `src/modules/markdown/preview-render-core.ts`。esbuild 能直接解析，不需要额外 alias。
- 根目录的 `tsconfig.json` 继承自 `zotero-types`，但这个 devDependency 没装，所以用 `tsconfigRaw` 绕开。
- 只有一份 React 和一份 xyflow。`evidence/component-imports.json` 里 react、react-dom 都来自视频工程；`@xyflow/react@12.11.6` 只有 pnpm 里的那一份，所以片子里引用的 `ReactFlowProvider` 和产品用的是同一个 store。
- 构建图里有 74 个产品源文件。其中有 `whiteboard/app.tsx`、`SmartGuideOverlay.tsx`、`chrome/*`（StyleBar、StyleMenu、FormatPaintButton、PropertiesPanel、AnnotationBrowser、TopIsland 等），还有 `src/modules/whiteboard/source-gateway.ts` 和 `packages/fake-zotero/src/index.ts`。

## 3. 挂载方式（src/shots/board.jsx 的核心部分）

```jsx
<div className="wb-stage">                       {/* 镜头背景 */}
  <div className="wb-cam">                       {/* 外层电影摄像机：GSAP 改 x/y/scale，transform-origin 0 0 */}
    <div className="wb-scale" style={{width: 1920/S, height: 1080/S, transform: `scale(${S})`}}>  {/* S = 1.85 */}
      <div id="whiteboard-root" className="wb-root" data-theme={THEME}>   {/* 复刻 addon/content/whiteboard/index.html */}
        <ReactFlowProvider>                      {/* 让片子能拿到 xyflow 的 useReactFlow()，产品代码不用改 */}
          <WhiteboardApp {...library.callbacks} theme={THEME} editable colorScheme="traditional"
            appearance={{fontFamily: 'system', backgroundColor: ''}} labels={labels}
            initialSnapshot={initialBoard} onReady={api => { wb.runtime = api; }} />
          <FlowBridge />                         {/* useReactFlow() → wb.flow.setViewport / getViewport */}
        </ReactFlowProvider>
      </div>
      <Cursor id="wb" />                         {/* 片子的鼠标层，和产品在同一个坐标系 */}
    </div>
  </div>
</div>
```

- 需要的 props 只有这些：`theme`、`labels`、`initialSnapshot`、`onReady`、`onChange`、`onSave`、`onPickAcademicSource`、`onDropAcademicSources`、`onOpenItem`、`onRefreshZoteroNote`、`onExportFile`。可选的有 `onResolveAcademicSources`、`onListLiteratureAnnotations`、`onOpenAcademicSource`，用来显示"来源状态：可用"和批注浏览器。
- 不需要 fake-api：白板不发 fetch，`stills.mjs` 输出的 `api` 是空的。
- 不需要额外的 provider：`WhiteboardLabelsProvider` 由 WhiteboardApp 自己提供。外面包的 `ReactFlowProvider` 是 xyflow 的公开 API，只是把 store 提到外层（xyflow 发现外层已有 store 时直接沿用）。
- 中文界面文字：`tools/gen-wb-labels.mjs` 读插件的 `tab.ts`，找出每个 label 对应的 Fluent id，再从 `zh-CN/addon.ftl` 取中文。一共 231 条，没有缺漏。界面上的"文献 / 引文 / 笔记 / 问题 / 观点 / 相关 / 支持 / 反驳 / 格式刷 / 已保存 / 查看批注……"都是产品原文。

## 4. 样式链

- `app.tsx` 自己 import 了 `@xyflow/react/dist/style.css` 和 `./board.css`。esbuild 会把它们打进 `.build/client.css`，build.mjs 再写进页面。**不用另外处理。**
- `board.css` 里只有内联 data-URI 的 `url(...)`（格式刷光标），没有外部资源。图标都是内联 SVG（`whiteboard/icons.tsx`）。没有坏图片，也没有 4xx 请求。
- `src/board/board-shot.css` 复刻生产 iframe 的根样式：`position:relative; width/height:100%; box-sizing:border-box; font-family: system-ui,…"PingFang SC"…`，`color: CanvasText`（不能继承片子的白字），亮色背景 `#fbfbfc`。
- **film.css 要改一行**。起步工程的 `* { box-sizing:border-box; }` 会改掉产品的盒模型（生产 iframe 是浏览器默认值），所以改成：
  ```css
  :where(*:not(#whiteboard-root, #whiteboard-root *)) { box-sizing:border-box; }
  ```
  特异度为 0，不会压过 board.css 自己写的 border-box。
- film.css 冻结 CSS 动画的规则保留不变，产品的 transition 也一起冻结了。

## 5. 示例白板（src/board/fixture.js + library.js）

- `library.js` 照着 `devHost.ts` 写：`createFakeZotero({items})` 加上**生产版** `createZoteroSourceGateway()`。卡片的 source 和 snapshot 都由 `gateway.acquireItem(item)` 生成，字段结构和插件里完全一样。
- 库里放了：2 篇期刊文章（作者、年份、期刊、标签）、1 个 PDF 附件、2 条高亮批注（黄 / 绿，带评论和页码）、1 条子笔记。**名字和内容都是为片子编的，不是任何用户的数据。**
- `fixture.js` 只用产品的 model 函数：`createAcademicNode`（literature / quote / note / frame）、`createAcademicConnection`（related / supports / contradicts）、`colorPalette('traditional')`，最后过一遍产品自己的 `parseCanvasDocument` 校验。写法照着 `model/tutorial.ts`。
- 白板上有：分组"公园尺度"（含文献卡和引文卡）、文献卡 ×2、引文卡（黄色高亮 + 评论 + 页码 5）、问题卡、观点卡、Zotero 笔记卡（可"从 Zotero 刷新"）、4 条连线（虚线灰色无箭头 / 相关 / 支持（绿，箭头）/ 反驳（红，虚线，箭头））。
- 第二篇文献卡带了产品色板里的绿色（底 #dcece3、边 #519a73、圆角 12），给格式刷提供可以复制的样式。暗色主题下按产品取色器的顺序改用深色那一行（#2b5c43）。如果暗色下还用浅底，标题会看不清，这个和真实产品表现一致。
- 也验证了 Markdown 渲染：观点卡里写 `**粗体**` 加列表，显示正确（`stills/probe-markdown-card-crop.png`）。

## 6. 放大倍数（实测）

用 `tools/probe-shot.mjs` + `probes/fonts2.js` 量出 computed font-size：

| 元素 | 产品 CSS 字号 | 放大 1.85 后 |
|---|---|---|
| 卡片正文（引文、笔记 Markdown、批注评论、作者·年份、期刊） | 12px | **22.2px** |
| 文献标题、分组标题 | 13px | 24.1px |
| 连线标签（相关 / 支持 / 反驳）、格式刷提示条 | 12px | 22.2px |
| 卡片类型小标签（文献 / 引文）、工具栏文字（笔记） | 11px | 20.4px |
| 标签 `#城市绿地` | 10px | 18.5px |

- **正文基准 12px，所以 S = 22 / 12 = 1.83，取 1.85。** 这样产品根节点的布局尺寸是 1038 × 584 CSS px，再整体放大到 1920 × 1080。
- 如果要求连 #标签 也 ≥ 22px，得用 S ≈ 2.2；或者在特写里再加外层摄像机推近（×1.3 之后总倍数 2.4，所有文字都 ≥ 24px）。
- 1.85 倍时，一屏大约放得下 3 列 × 2 行、280px 宽的卡片。

## 7. 交互：哪些能用真实事件，哪些要状态

全部在 `drive.js`、`board.jsx` 里，通过 `onDrive` 按时间执行。每一步只执行一次；往回跳时，用产品自己的 `runtime.loadSnapshot(initialBoard)` 恢复白板，再从头重放。**每一步执行前，会先把两台摄像机放到"这一步自己的时间点"**，所以顺着播和直接跳过去，得到的画面一样。

| 交互 | 结果 | 做法 |
|---|---|---|
| 点选卡片 → 出现浮动样式条 | ✅ 真实事件 | pointerover/down/up + mousedown/up + click |
| 点格式刷按钮（FormatPaintButton）→ 进入格式刷模式 | ✅ 真实事件 | 源卡片出现蓝色虚线框，底部出现产品提示"点击目标应用样式 · Esc 退出"，光标换成产品自己的格式刷光标（从 board.css 的 cursor 里取出那张 SVG 画到片子的鼠标层） |
| 悬停目标卡片 → 目标高亮 | ✅ 真实事件 | 派发 mouseover（React 用它模拟 onMouseEnter） |
| 点击目标 → 应用样式 | ✅ 真实事件 | 文献卡变成绿色，单次模式下自动退出（`stills/t006.00.png`） |
| 点空白处取消选择 | ✅ | 点 `.react-flow__pane` |
| 打开颜色菜单（StyleMenu，"背景"）→ 显示传统色色板 | ✅ | 点 `button[data-color-target="fill"]`；点外面会关闭（产品监听的是 window pointerdown） |
| 拖动卡片 → 智能对齐线（SmartGuideOverlay）并吸附 | ✅ 真实事件 | d3-drag：mousedown 卡片，然后在 window 上派发 mousemove / mouseup。**要先"轻推" 2px**（xyflow 第一次移动只用来判断是否超过拖动阈值，从第二次起才真正移动）。卡片从 y=330 拖到 y=300，顶边和另外两张卡对齐，出现横向和纵向参考线（`t010.90.png`） |
| 打开属性面板 → 查看批注 → 批注浏览器 → 勾选 → 添加所选 | ✅ 真实事件 + 生产 gateway | 列出假库里的 2 条批注，已在白板上的那条显示"已添加"；添加后多出一张新引文卡，文献卡显示"2 条批注"，属性面板显示"来源状态：可用"（`probe-annotation-*.png`） |
| 编辑卡片文字 | ✅ | 点样式条的"编辑"，用原生 setter 写入 textarea 并派发 input，点空白处提交 |
| 拖手柄新建连线 | ✅ | pointerdown 手柄，再在 document 上派发 mousemove / mouseup，新连线写进文档 |
| 双击进入连续格式刷 | 未测（`dblclick` 事件应该可行） | |
| 依赖 CSS `:hover` 的效果（例如悬停时才显示的手柄） | ❌ 合成事件触发不了 `:hover` | 选中状态下手柄本来就会显示，够用 |

**目前没有哪项必须改成"状态 prop"。** 需要注意的是那些按真实时间（setTimeout）运行的产品界面，它们不跟影片时钟走：
- "样式已复制"提示 2.2 秒后消失（只在右键菜单"复制样式"时出现，格式刷不会触发）；
- 分组提示 3 秒、白板通知 8 秒后自动消失。

拍这几个状态时，要么避开，要么在那个镜头里接管 `window.setTimeout`。另外，新建卡片的 id 用 `Date.now() + Math.random()` 生成，fake-api 已经把这两个固定住了。往回跳重放后 id 可能会变，但画面上看不出来。

## 8. 摄像机：xyflow 视口还是外层包裹层？

**两种都能用，也都测过，按镜头选。**

1. **产品内的摄像机（xyflow 视口）**：用 `ReactFlowProvider` 包住 WhiteboardApp，再加一个 `FlowBridge` 调 `useReactFlow()`，拿到 `setViewport({x,y,zoom}, {duration:0})`，按时间插值。画面完全是产品自己重新渲染的，卡片、点阵、连线都清晰，工具栏保持原位，和用户真实缩放时看到的一样（`t012.50.png`，放大 1.45 到引文卡）。
   - 注意：产品在 xyflow 的 `onMoveEnd` 里才重新定位浮动样式条，而这个回调由 `setTimeout(0)` 触发。所以每次 `setViewport` 后要先等一个 setTimeout(0)，再等两帧（已写进 `applyCameras`）。镜头移动时最好不要有选中卡片，否则样式条会跟着跳。
2. **外层电影摄像机（GSAP 改 `.wb-cam`）**：整体推拉，工具栏也一起放大。装了 `local-space.js` 之后，在推近状态下点选卡片，样式条仍然正好在卡片上方，菜单也被限制在白板范围内（`t015.00.png`、`t015.60.png`）。
   - 注意：白板布局区域正好等于画面。往边上推时会露出白板边界外的镜头背景（`t015.60.png` 右侧）。如果要往边上推，就把卡片布局往中间放，或者让 `.wb-scale` 比画面大一圈。

`local-space.js` 做了什么：`.wb-scale` 里面元素的 `getBoundingClientRect / getClientRects / Range.getBoundingClientRect` 返回"缩放前、原点在白板左上角"的坐标；`window.innerWidth/innerHeight` 返回白板布局尺寸（1038 × 584）。片子驱动发出的事件坐标也用这套坐标，所以 xyflow、d3 的鼠标计算是一致的。缩放层以外的元素不受影响。对照：`?wbLocal=0` 关掉适配，样式条明显偏到左上（`stills/wbLocal-0-t004.00.png`）。

## 9. 暗色主题

产品有完整的暗色主题：`theme="dark"` 会给 `.zmd-board-host[data-theme=dark]` 设置 token，`THEME_TOKENS.dark` 来自 `src/ui/theme.ts`。卡片、分组、问题卡和观点卡的暗色纸色、连线、工具栏、样式条、颜色菜单（色板换成深色在前）都正常。用 `?wbTheme=dark` 出静帧：`wbTheme-dark-t005.00.png`（格式刷进行中）、`wbTheme-dark-t006.00.png`（刷完）、`wbTheme-dark-t008.20.png`（颜色菜单）。

## 10. 字体

- 容器里没有 PingFang SC 或微软雅黑。中文会回退到文泉驿正黑，粗体是浏览器合成的。效果能看，但和 macOS 上不一样。
- 可选方案已经测通：`tools/gen-cjk-font.mjs` 把 Noto Sans SC（400 / 700，按 unicode-range 拆成 202 个 woff2，约 5 MB）注册成 "PingFang SC"。产品的字体栈里本来就有 "PingFang SC"，所以**产品 CSS 不用改**，中文就会用 Noto，标题是真粗体。builder 里会先用 `document.fonts.load` 加载所有会出现的字，避免某一帧还没加载好。这一步只是模拟 macOS 的显示效果，交付时要写明。
- 拉丁字母和数字用的是容器里的 Inter（系统 `system-ui`）。按钮默认字体是 Chromium 的 Arial；生产环境是 Firefox（Zotero），按钮字体和抗锯齿会有细微差别。

## 11. 稳定性验证

- 同一组时间点，分别按"顺序播放"、"倒序跳转"、"打乱顺序"三种方式出帧，逐像素比较：差异最大不到 24/255，全部是抗锯齿噪声，肉眼看不出。（过程中修了两个问题：步骤要在自己时间点的摄像机状态下执行；拖动要先轻推 2px。）
- `node render.mjs --from 3 --to 7 --output …` 导出了 120 帧的 1080p30 草稿，用时约 34 秒，联系表看帧序正常（`renders/board-draft-contact.png`）。
- 所有静帧都没有 pageerror、console error 或 4xx。

## 12. 阻碍与风险（没有硬阻碍）

1. **起步工程的全局 box-sizing**：会改掉产品盒模型，已经用 `:where(...)` 改为跳过产品区域（必须拷回）。
2. **缩放导致产品定位错误**：浮动样式条、StyleMenu、属性面板把屏幕坐标和本地坐标混在一起算，必须装 `local-space.js`。它会改 `Element.prototype.getBoundingClientRect` 和 `window.innerWidth/innerHeight`。片子自己的代码不读 innerWidth；如果以后有第二个产品镜头用了不同倍数，要按镜头区分。
3. **按真实时间运行的产品计时器**：见 §7。
4. **xyflow 镜头移动时样式条有一帧延迟**：见 §8。镜头移动时别选中卡片，或者按现在的写法每帧等 onMoveEnd。
5. **浏览器差异**：生产环境是 Firefox，片子用 Chromium 渲染。布局一致，但字体和抗锯齿略有不同。
6. **画面安排（不算阻碍）**：文献卡默认 280×200，下半部分空着，可以把卡片高度调小；新建连线会从别的卡片后面穿过；外层推近时要注意别露出白板边界；右下角 xyflow 的 +/− 控件会挡住角落的卡片。
7. **devDependencies 没装**：不影响。fake-zotero 直接 alias 到 TS 源码；`zotero-types` 只在 tsconfig 里用到，已经用 tsconfigRaw 绕开。

## 13. 静帧清单

都在 `/tmp/claude-0/-home-user-scholar-sketch/9c397663-c3ff-50bd-93ba-f5baab301bbc/scratchpad/research/wb-spike/stills/` 下（时间是影片时间，component 镜头从 3 秒开始）：

- `t004.00.png`：点选第二篇文献卡，浮动样式条居中出现在卡片上方
- `t005.00.png`：格式刷模式。源卡蓝色虚线框，目标卡高亮，产品提示条和格式刷光标都在
- `t006.00.png`：格式刷完成，第一篇文献卡变成绿色
- `t008.20.png`：观点卡的"背景"颜色菜单，产品的传统色色板，限制在白板范围内
- `t010.30.png`、`t010.90.png`：拖动笔记卡，出现智能对齐线并吸附（顶边对齐、左边对齐）
- `t012.50.png`：产品内的摄像机（xyflow setViewport），放大 1.45 到引文卡
- `t015.00.png`、`t015.60.png`：外层摄像机推近 ×1.3 后再点选、开菜单，样式条和菜单位置都正确
- `wbTheme-dark-t005.00.png`、`wbTheme-dark-t006.00.png`、`wbTheme-dark-t008.20.png`：暗色主题
- `wbLocal-0-t004.00.png`：对照图，不装 local-space 时样式条位置错误
- `probe-annotation-browser.png`、`probe-annotation-added.png`：批注浏览器（生产 gateway + 假库），添加批注后的结果
- `probe-edit-note.png`、`probe-markdown-card.png`、`probe-markdown-card-crop.png`：编辑文字、Markdown 渲染
- `probe-connect.png`（另有 `probe-connect-unpatched.png`）：拖手柄新建连线
- 草稿视频：`/tmp/claude-0/-home-user-scholar-sketch/9c397663-c3ff-50bd-93ba-f5baab301bbc/scratchpad/research/wb-spike/renders/board-draft-3-7.mp4`，联系表 `renders/board-draft-contact.png`

## 14. 复现命令

```sh
cd /tmp/claude-0/-home-user-scholar-sketch/9c397663-c3ff-50bd-93ba-f5baab301bbc/scratchpad/research/wb-spike/film
node tools/gen-wb-labels.mjs            # 生成中文界面文字
node tools/gen-cjk-font.mjs             # 可选：Noto Sans SC 注册成 PingFang SC（要先装 @fontsource/noto-sans-sc@5.3.1）
npm run build
node stills.mjs ../stills 4 5 6
node tools/stills-qs.mjs ../stills 'wbTheme=dark' 6       # 暗色
node tools/probe-shot.mjs "" 3.5 ../probes/annotations-add.js ../stills/x.png   # 跑一段点击脚本后截图
node render.mjs --from 3 --to 7 --output ../renders/board-draft-3-7.mp4
```
