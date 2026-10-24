# Fake Zotero 开发环境

当前插件依赖宿主注入的 `Zotero` 全局对象。`zotero-types` 只提供类型，`zotero-plugin-toolkit` 提供辅助函数，两者都不是可在浏览器启动的 Zotero。

`packages/fake-zotero` 是独立的 ESM 开发依赖，无运行时依赖；`packages/whiteboard/src/devHost.ts` 是当前白板的消费示例。包暂用 `@zotero-plugin/fake-zotero` 名称，尚未发布。

## 运行和验收

在仓库根目录运行：

```sh
pnpm install
pnpm whiteboard:dev
pnpm test:fake-zotero
pnpm whiteboard:build
```

打开 Vite 输出的网址（默认 `http://localhost:5173`）。页面使用生产 `WhiteboardApp` 和 `createZoteroSourceGateway`，替换的只有 Zotero 数据与打开动作：

1. 点击 **Import paper**。文献来自 fake Items；原有白板 **Item** 工具也选择这个固定 fixture。
2. 选中文献卡片，打开批注列表，导入高亮；批注通过真实 gateway 遍历文献 → PDF 附件 → 批注关系。
3. 点击 **Import note**，再点击 **Change library note**。卡片仍保留原内容，使用卡片的 **Refresh from Zotero** 操作才会刷新。
4. 点击 **Save board**、编辑、**Reload saved**，检查画板恢复；浏览器刷新也读取保存的画板。保存使用独立的 localStorage key，不写入真实 Zotero 文件。
5. **Reset fixture** 清空该画板缓存，并恢复初始文献、笔记、偏好和调用记录。

打开条目、笔记、PDF 会记录调用，不打开真实 Zotero 窗口。源码入口 `src/main.tsx` 只用于浏览器示例；插件构建仍使用 `src/bootstrap.tsx`，不会引入 fake。

### Markdown 浏览器测试

点击顶栏 **Markdown** 或打开 `/markdown.html`。此页通过生产 `createMarkdownEditor` 通信桥加载生产 CodeMirror 编辑器；页面没有复制一份编辑逻辑。

1. **Source / Live preview** 切换源码和预览，编辑中文、标题、任务列表；检查大纲和字数。
2. **Bold / Insert table / Undo / Redo** 检查编辑命令，也可直接编辑预览中的表格单元格。
3. 输入 `[[Demo`，选择文献候选；生成稳定的 `zotero://select/library/items/PAPER001` 链接。Ctrl/Cmd 点击链接时会记录 fake 的选中操作。
4. **Save Markdown** 等待编辑器快照，保存到独立浏览器缓存；展开 **Saved Markdown** 检查实际文本。**Reload saved** 丢弃未保存编辑，**Reset Markdown** 恢复 fixture 并清理缓存。
5. 用 **Markdown document** 切换三篇 Markdown 附件，其中两篇文件名相同。输入 `[[Research` 选择不同附件，生成 `[[Research--MDNOTE02|Research]]`；输入 `[[Reading#` 选择具体标题。别名中不需要显示 key。
6. 右侧 **Linked mentions** 显示实际已保存正文中的反向引用，点击可返回来源位置；顶栏同名按钮独立收起或展开引用侧栏。保存删除一条链接后，目标笔记的引用数随之更新。
7. **Preview Obsidian export / Preview Markdown export** 展示生产导出器生成的文件计划，便于核对文件名、链接和 frontmatter。这两个网页按钮只预览；真实 Zotero 的“更多”菜单才会选择目录并写入文件。

等待按钮启用或 `window.__fakeZoteroMarkdown.isReady === true`。这个标志来自已挂载编辑器返回的大纲消息，不把通信桥的超时 fallback 当成启动成功。`window.__fakeZoteroMarkdown.fake` 暴露 fixture 和调用记录，`.editor` 暴露生产编辑器接口。

浏览器入口是 `src/dev/markdown-demo.ts`，文件持久化、图片文件和 Zotero 窗口均由显式测试适配处理。示例保存到 localStorage；文件保存逻辑另外通过单测中的内存文件适配验证。

### 自动回归范围

`pnpm test:fake-zotero` 构建独立包后运行以下测试；`pnpm test:unit` 运行仓库已有回归。

| 测试                                      | 验证范围                                                                |
| ----------------------------------------- | ----------------------------------------------------------------------- |
| `packages/fake-zotero/test/index.test.js` | 实例隔离、Prefs 命名空间、快照重置、全局安装与清理                      |
| `test/fake-zotero-browser.test.ts`        | 生产白板 gateway、笔记变更、打开记录、保存重载和存储失败                |
| `test/fake-zotero-whiteboard.test.ts`     | 个人/群组同 key、文献和批注父链、缺失来源、打开失败、笔记刷新 runtime   |
| `test/fake-zotero-markdown.test.ts`       | frontmatter、正文保存与标题同步、稳定链接、加载前编辑队列、图片解析失败 |
| `test/fake-zotero-dom.test.ts`            | 浏览器已有只读 Window 全局时，生产 DOM 初始化正确复用宿主               |
| `test/fake-zotero-links.test.ts`          | 真实编辑器补全、附件 key 协议校验、反链面板保存后刷新与来源位置跳转     |

本次测试修复了浏览器全局初始化、加载前连续编辑被去重及整篇替换后旧命令残留、图片解析失败无响应的问题；白板新增场景未发现需要修改生产白板代码的问题。浏览器手工自动化还检查了批注导入、笔记刷新、画板重载、Markdown 源码/预览、中文编辑、表格直接保存、撤销重做和文献链接。

基础 fake 测试覆盖根项目/白板类型检查、网页构建和 Zotero 插件打包；双链回归另见 `test/document-links*.test.ts`。白板的 TypeScript 开发依赖已与根项目统一为 6，以兼容生产 gateway 引入的 Zotero DOM 类型。网页构建仍有 CodeMirror 分包和包体积提示。

### 原生笔记转换回归

`test/markdown-note-conversion.test.ts` 通过宿主替身与真实临时文件检查原生笔记转换、图片归属、源内容变化、批量失败和清理。`test/markdown-note-translator.test.ts` 可进一步执行本机已安装的官方 Note Markdown 转换器；它不会将第三方转换器复制到仓库。设置路径后运行完整测试：

```sh
ZOTERO_NOTE_MARKDOWN_TRANSLATOR='/path/to/Zotero/translators/Note Markdown.js' pnpm run test:unit
```

未提供路径时，六项官方转换器集成测试明确跳过。提供路径时会校验转换器标识，并通过生产转换与导入入口检查实际生成的 Markdown 和图片。DOM、Zotero 数据库及翻译沙箱边界仍是测试替身，不代表已验证原生 Zotero 窗口。

## Agent 调试入口

等待按钮可点击或 `window.__fakeZoteroDemo.isReady === true`，再操作。推荐通过 DOM 点击以覆盖实际 UI；下面的接口用于准备 fixture 和核对结果：

```js
const demo = window.__fakeZoteroDemo;
demo.fake.snapshot(); // JSON 可序列化的文献、库、偏好与选择状态
demo.fake.calls; // 打开、保存、日志等调用记录
demo.getSnapshot(); // 实际画板文档
demo.readSaved(); // 浏览器中保存的画板
demo.reset(); // 每个场景前恢复数据和画板
```

`fake.reset()` 只重置 Zotero fixture；需要同时清空 UI 时用 `demo.reset()`。实例创建不会修改全局，`install()` 显式安装并返回清理函数，拒绝覆盖已有 Zotero。具体 API、原生签名子集和限制见[包 README](../packages/fake-zotero/README.md)。

## Garden / ScholarAgent 调研

本次只读参考，没有改动这两个仓库。

| 项目         | 已有实现                                                                                                             | 抽取时注意                                                                                                |
| ------------ | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Garden       | `src/vue/garden-app/src/shared/testing/fakeZotero.ts`：ready Promises、Prefs、Users、日志，以及 Garden 路由/草稿业务 | Prefs 自动拼插件前缀；`Garden.api` 留在 Garden；旧的 `__gardenFake` 环境标志需要消费者继续保留            |
| ScholarAgent | `frontend/src/runtime/fakeZotero.ts`：ready Promises、Prefs、固定文献选择、六个假 MCP 工具                           | Prefs 使用原始 key；笔记更新只返回成功，不改变数据；`ScholarAgent.MCP` 和 `__scholarAgentFake` 留在消费者 |
| 当前项目     | 单测中手写 Item 和 Zotero 对象，白板 Vite 入口的宿主回调原先只打印日志                                               | 复用生产 gateway 和 UI，公共包不依赖画板模型                                                              |

新包使用 Zotero 的 Prefs `global` 参数语义，不能直接把两个旧安装函数整体替换。插件专属前缀、浏览器存储持久化、路由、网络请求和 MCP 工具协议仍由各项目适配。核心偏好默认保存在实例内存中，避免 localStorage 失败或多个测试互相污染。

手动接入其他仓库：先构建、打包，再把 tarball 作为开发依赖安装。不要把旧业务代码搬进公共包：

```sh
pnpm --filter @zotero-plugin/fake-zotero build
cd packages/fake-zotero
npm pack
# 在目标项目中手动执行（本次未执行）：
# pnpm add -D /absolute/path/to/zotero-plugin-fake-zotero-0.0.0.tgz
```

浏览器入口的最小用法：

```ts
import { createFakeZotero } from "@zotero-plugin/fake-zotero";

if (!globalThis.Zotero) {
  const fake = createFakeZotero({ items: myFixtures });
  // 在这里组合本插件的 Garden.api 或 ScholarAgent 等扩展。
  const restore = fake.install();
  // 测试结束或 HMR dispose 时调用 restore()。
}
```

## Zotero Dev MCP 借鉴

与你描述匹配的项目是 [introfini/mcp-server-zotero-dev](https://github.com/introfini/mcp-server-zotero-dev)。本次核对源码提交 `24f8f5010d5cf05f178400b096a53ba8ec75b1a0`。它通过一个 Zotero 插件开启 Firefox RDP，再由 MCP server 执行 JS、检查 DOM、截图及访问日志，运行对象是真实 Zotero。

- [ping](https://github.com/introfini/mcp-server-zotero-dev/blob/24f8f5010d5cf05f178400b096a53ba8ec75b1a0/packages/mcp-server/src/tools/ping.ts#L49) 区分连接正常与 Zotero 上下文可用。网页示例另行暴露 UI 就绪状态，避免把 ready Promise 当成组件已经挂载。
- [RDP client](https://github.com/introfini/mcp-server-zotero-dev/blob/24f8f5010d5cf05f178400b096a53ba8ec75b1a0/packages/mcp-server/src/rdp/client.ts#L605) 在断线后不会重放结果不确定的 eval；真实修改操作也应先检查状态，避免重复创建条目。
- [截图](https://github.com/introfini/mcp-server-zotero-dev/blob/24f8f5010d5cf05f178400b096a53ba8ec75b1a0/packages/mcp-server/src/tools/screenshot.ts#L130) 使用 Firefox 特权 `canvas.drawWindow`。网页端使用浏览器自动化工具截图，不把 Gecko 调试实现塞进 fake 包。
- [交互](https://github.com/introfini/mcp-server-zotero-dev/blob/24f8f5010d5cf05f178400b096a53ba8ec75b1a0/packages/mcp-server/src/tools/interact.ts#L13) 的合成事件也有 XUL 和原生模态框限制。因此 DOM 点击成功、截图正常都不能单独证明原生行为正确。

ScholarAgent 自身还已有 `zotero-plugin/src/mcp/catalog.ts` 工具契约及 `scripts/zotero-mcp-fixtures.mjs` 真实 fixture 创建/清理脚本，可在手动接入时作为契约对照。

推荐分两层验证：浏览器 fake 覆盖 UI、数据映射、错误展示、可复现状态；真实 Zotero + MCP 覆盖插件启动/卸载、XUL、数据库事务、Notifier 时序、真实文件系统和 PDF reader。本次未安装 MCP、未控制真实 Zotero，也未宣称完整插件能在网页直接运行。
