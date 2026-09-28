<p align="center">
  <img src="../docs/icons/scholar-sketch-logo.png" alt="Scholar Sketch — Read · Organize · Think" width="640" />
</p>

# Scholar Sketch

**Markdown & Whiteboard for Zotero**

Zotero 中的 Markdown 编辑器与可视化白板

[![Zotero compatibility](https://img.shields.io/badge/Zotero-9%2F10-green?style=flat-square&logo=zotero&logoColor=CC2936)](https://www.zotero.org)
[![version](https://img.shields.io/badge/version-0.2.0-blue?style=flat-square)](https://github.com/l0o0/scholarcanvas/releases)
[![license](https://img.shields.io/badge/license-AGPL--3.0-orange?style=flat-square)](../LICENSE)

**在 Zotero 中书写 Markdown，用可视化白板连接文献与想法。** 创建、编辑和预览原生 `.md` 附件，并在 `.canvas` 白板上组织文献、摘录和笔记。

[English](../README.md) | [简体中文](README-zhCN.md)

---

## 为什么做这个

Zotero 擅长文献收集与组织。在 AI 时代，**纯 Markdown 文件**才是知识工具之间的通用货币（Obsidian、大模型、静态站点、Git）。

[Better Notes](https://github.com/windingwind/zotero-better-notes) 大幅增强了 Zotero 自带的 **Note**，但那仍然是 Zotero 笔记，不是磁盘上的原生 `.md` 文件。**Scholar Sketch** 补上这块短板：与 Better Notes **互补**、不触碰 Note，让 Markdown 文件成为 Obsidian 与 AI 工作流里直接可用的纯文本。

---

## 功能

### Markdown 笔记

- **原生文件**：创建和打开 `.md` 附件，在 Zotero 标签页或独立窗口中编辑，同时支持 Stored（存储附件）与 Linked（链接附件）。
- **三种模式**：Live 即时预览编辑、源码编辑和只读阅读预览，提供目录、字数统计、格式快捷操作与可编辑表格。
- **双链笔记**：支持 Obsidian 风格的 `[[文件名|别名]]`、标题补全与右侧反向链接栏；左侧目录用于文内导航。导出时使用 Markdown 附件的 item key 区分重名文件。
- **全文搜索**：按标题、文件名和正文搜索当前文库中已保存的笔记，点击结果打开并定位命中文字。
- **公式与脚注**：阅读预览、HTML 导出和 Canvas 笔记卡片支持 `$…$`、`$$…$$`、`math` 围栏代码块及 `[^name]` 脚注；编辑模式保留对应源码。
- **图片管理**：插入本地图片、导入外链图片以供离线使用，独立调整各处图片尺寸，并查看原图。
- **便携导出**：将笔记及本地图片导出为目录，使用 Wikilink 或标准 Markdown 链接，方便迁移到 Obsidian 等工具；单篇笔记也可导出 HTML 或 PDF。
- **PDF 批注转 Markdown**：从文献或 PDF 中勾选文字摘录和评论，生成包含页码、原文批注跳转链接的笔记，支持个人库与群组库。

### Canvas 白板

- 新建空白 `.canvas` 白板，或从 Zotero 分类创建白板；拖入文献、PDF 附件及其他来源。
- 使用工具栏“文件”或画布右键菜单添加本地文件，也可直接拖入文件或粘贴截图。统一文件卡片按类型展示图片、文本摘要或文件信息，支持预览、详情与打开。导入文件嵌入白板保存（单文件最多 15 MB，每批最多 30 MB）；Zotero 附件继续保留来源引用。
- 浏览来源批注，创建笔记、问题、观点、证据和总结卡片，用带标签及样式的连线组织想法。
- 在笔记卡片中直接阅读 Markdown，包括标题、列表、代码、链接、公式与脚注，并就地编辑源码。
- 使用分组框整理卡片；整组选区可连同组内成员及内部连线一起复制、跨白板粘贴，并一步撤销或重做。
- 自动布局优先整理选区或分组；未选择节点时，整理全白板前会请求确认。
- 使用 **Ctrl/Cmd+F** 搜索卡片标题与内容，并定位匹配结果。
- 导出 PNG（1×、2×、4×）、SVG 或 Markdown。PNG 保留画布实际渲染效果，SVG 使用现有文本导出排版。
- 通过内置示例学习操作：包含离线图片、可编辑的 Markdown 附件和动手练习。

### 保存与工作状态

- Markdown 防抖自动保存及 **Ctrl/Cmd+S**；Markdown 和 Canvas 均有外部文件修改冲突检查。
- **本地历史**：保留保存前版本与冲突草稿，可预览并另存恢复副本，不覆盖当前文件。
- **工作状态恢复**：重新打开上次仍打开的 Markdown / Canvas 标签页或独立窗口。Markdown 记住模式、光标与滚动位置，Canvas 保留已保存的视口。
- **多屏使用**：在 Zotero 标签页与可调整大小的独立窗口之间切换，切换与关闭前保存内容。

本地历史包含正文或卡片数据，以及已嵌入 Canvas 的文件，不备份单独引用的图片或 PDF，也不参与同步。批注转换处理文字摘录和评论，不包含纯图片摘录。跨白板粘贴携带嵌入文件并保留来源引用，不复制单独引用的原始文献或相对路径图片资源。

详见[双链与导出约定](../docs/obsidian-links.md)、[保存保护与历史恢复](../docs/file-safety.md)及[补充功能使用说明](../docs/markdown-canvas-release-features.md)。

### 规划中

- YAML frontmatter 与 Zotero 字段的双向同步
- Linked 文件被外部修改后的自动重新加载；目前通过冲突检测防止静默覆盖

---

## 安装

从 [Releases](https://github.com/l0o0/scholarcanvas/releases) 下载最新的 `scholarsketch-v{version}.xpi`，在 Zotero 中：**工具 → 插件 → 齿轮 → 从文件安装插件…**，如有提示重启 Zotero。

### 本地构建

```bash
pnpm install
pnpm run build
# 产物：.scaffold/build/scholarsketch-v{version}.xpi
```

---

## 使用

1. 选中文献 → 右键 → **新建 Markdown…**  
   会创建 Stored 的 `.md` 附件并打开。
2. 在 Tab 中编辑。输入会自动保存；**Ctrl/Cmd+S** 立即保存。
3. 使用 **Live** 或 **源码** 模式编辑；通过 **更多 → 模式** 切换到只读预览，阅读渲染后的文档。
4. 之后双击任意 `.md` 附件即可再次打开。
5. 或在 `.md` 附件上右键 → **用 Markdown 编辑器打开**。

点击 Tab 顶部的烤肉串菜单，可以查看文档元数据、重命名、打开所在文件夹，
以及修改 Markdown 专属设置。**导入外链图片**会下载 `http(s)` 图片到当前
附件的 `assets/` 目录，并把 Markdown 引用改为本地路径，文档离线时也能正常显示。

在 **Live** 模式中，单击图片显示大小工具条。拖拽四角可等比例缩放，也可选择 **小 / 中 / 大** 或输入像素宽度。**自适应** 恢复原始尺寸，并限制在正文宽度内。同一图片的不同引用可独立设置大小，原始附件不变；一次撤销即可恢复整次拖拽。

尺寸以 `<img src="assets/figure.png" alt="图像说明" width="480">` 保存到 `.md` 文件中，阅读预览和 HTML 导出会保留宽度，窄窗口中自动适配正文。工具条的 **查看原图** 或阅读预览中的单击图片，会打开临时查看窗口，可在自适应与 100% 之间切换，不改变笔记排版。

也可以把已有 `.md` 拖进 Zotero（或添加链接附件），双击同样由本插件打开。

### 双链、搜索与恢复

- 输入 `[[` 查找并链接笔记，也可使用 `[[笔记#标题|显示文字]]`；右侧引用栏显示链接到当前笔记的内容。
- 使用 **更多 → 搜索文库笔记…** 搜索当前文库已保存的 Markdown 笔记；**Ctrl/Cmd+F** 在当前文档内查找。
- 右键文献或 PDF → **从 PDF 批注生成 Markdown…**，勾选摘录和评论后创建笔记。
- 使用 **更多 → 本地历史…**，或 Markdown / Canvas 附件的右键菜单，预览历史版本并另存恢复副本。外部修改导致保存冲突时，可先恢复草稿，再重新打开文件对照合并。
- 使用 **更多 → 导出当前库笔记到 Obsidian… / 导出当前库笔记为 Markdown…** 导出文库笔记；本地图片随目录复制并改写路径，未能处理的资源记录在 `REPORT.md` 中。

---

### 白板

1. 选择 **工具 → 新建白板…** 或 **从分类新建白板…**。
2. 将 Zotero 条目拖入画布，浏览摘录并添加笔记。
3. 用分组框整理相关卡片，通过连线梳理论证关系。
4. 选中卡片或分组框，使用 **Ctrl/Cmd+C**、**Ctrl/Cmd+V** 跨白板复制；**更多 → 复制选区副本** 在当前白板生成副本。
5. 使用 **更多 → 自动布局** 整理选区，或用 **Ctrl/Cmd+F** 搜索卡片；**Enter / Shift+Enter** 定位下一条或上一条结果。
6. 从 **工具 → 最近白板** 或 `.canvas` 附件重新打开白板。

选择 **帮助 → Scholar Sketch：创建示例白板** 可生成新版教程和一份 **开始写作.md** 练习本，带你完成一句话总结、待办事项和插图三个练习，了解 Live / 源码模式与保存方式，再回到白板连接证据并导出分享。已有示例白板会保留。

分享时，使用 **更多 → 导出 PNG**（2×），或右键画布空白处选择 **导出 PNG · 1× / 2× / 4×**。图片包含整张白板及留白，沿用当前主题，不包含编辑控件。超大图片会提示尝试较低分辨率，不会静默降低清晰度。

---

## 环境要求

- Zotero **9** 或 **10**
- 桌面客户端（不支持 Zotero 网页版）

---

## 开发

基于 [zotero-plugin-scaffold](https://github.com/northword/zotero-plugin-scaffold) 与 [zotero-plugin-toolkit](https://github.com/windingwind/zotero-plugin-toolkit)。包管理器使用 **pnpm**。

### 环境准备

```bash
# 配置 Zotero 可执行文件 / 开发 profile / 数据目录（见 .env.example）
cp .env.example .env

pnpm install
pnpm start          # 构建并启动 Zotero，支持热重载
```

国内用户：项目 `.npmrc` 已配置 [npmmirror](https://npmmirror.com/) 镜像。

### 常用命令

无需安装 Zotero 即可运行 `pnpm whiteboard:dev`：`/` 为白板测试页，`/markdown.html` 为生产 Markdown 编辑器测试页，两者使用独立的 `@zotero-plugin/fake-zotero` 开发包。`pnpm test:fake-zotero` 运行对应集成测试。支持的 API、agent 调试入口与其他插件接入方式见[浏览器测试指南](../docs/fake-zotero.md)。

| 命令                    | 说明                            |
| ----------------------- | ------------------------------- |
| `pnpm start`            | 开发模式 + 热重载               |
| `pnpm run build`        | 生产构建 + 类型检查             |
| `pnpm test`             | 插件测试                        |
| `pnpm test:unit`        | 单元与 DOM 回归测试             |
| `pnpm test:fake-zotero` | fake-Zotero 包与集成测试        |
| `pnpm whiteboard:dev`   | Canvas 与 Markdown 浏览器测试页 |
| `pnpm run lint:check`   | Prettier + ESLint               |
| `pnpm run lint:fix`     | 自动修复                        |

---

## 设置

**编辑 → 设置 → Scholar Sketch**

- **使用 Markdown 编辑器打开 .md 附件** — 关闭后，`.md` 恢复为系统默认程序打开

---

## 供其他插件调用的 API

Scholar Sketch 原名 Scholar Canvas，更早名为 Bamboo。公开 API 为 `Zotero.ScholarSketch`；旧入口 `Zotero.scholarcanvas` 不再提供，集成插件需更新为新名称（破坏性变更）。新安装包使用 `scholarsketch-v{version}.xpi`。仓库仍位于 `l0o0/scholarcanvas`，下载和自动更新链接继续有效。插件 ID、偏好设置键、chrome 资源命名空间、剪贴板格式以及已有数据和历史目录保留兼容标识。

Scholar Sketch 在 `Zotero.ScholarSketch.api.markdown` 暴露进程内 API，供其他插件 / MCP 桥接层在 Zotero 内创建与编辑 `.md` 文档。所有方法均为异步、JSON 友好，失败时抛出 `MarkdownApiError`（`error.code` 稳定不变）。

```js
const md = Zotero.ScholarSketch.api.markdown;

// 列出用户文库中的 markdown 附件
const docs = await md.list({ q: "note" });

// 读取
const { content } = await md.read(docs[0].itemID);

// 在文献条目下创建，然后编辑
const created = await md.create({
  parentItemID: 123,
  initialContent: "# Title",
});
await md.update(created.itemID, { content: "# New\n\nupdated" });

// 只改 frontmatter
await md.patchFrontmatter(created.itemID, {
  set: { tags: ["ai", "draft"] },
  delete: ["old-key"],
});

// 打开 / 强制保存 / 关闭编辑器 Tab
await md.openTab(created.itemID);
await md.flush(created.itemID);
await md.closeTab(tabID);
```

方法：`list`、`stat`、`read`、`create`、`createLinked`、`update`、
`patchFrontmatter`、`rename`、`trash`、`openTab`、`closeTab`、`sessions`、
`flush`、`toHtml`、`render`、`documentTitle`。

错误码：`ITEM_NOT_FOUND`、`NOT_MARKDOWN`、`WRITE_CONFLICT`、
`WRITE_FAILED`、`INVALID_ARGUMENT`、`NOT_OPEN`。

说明：

- 所有写入都走与编辑器相同的持久化路径（写文件、图片资源清理、标题同步、Zotero 文件同步标记）。
- `update` 在编辑器 Tab 存在未保存修改时返回 `WRITE_CONFLICT`——传 `force: true` 可允许该 API 更新，但不会绕过外部文件修改检查。
- `rename` 会重命名底层文件；对 linked 附件会直接重命名磁盘上的文件。
- API 版本号：`Zotero.ScholarSketch.api.version`（当前 `2`）。

---

## 常见问题

**会取代 Better Notes 吗？**  
不会。Better Notes 增强 Zotero Note；Scholar Sketch 管理真正的 **Markdown 文件**和 **Canvas 白板**附件。可以同时安装。

**文件存在哪里？**

- **新建 Markdown…** 创建的是 Zotero storage 下的 **Stored** 附件。
- 也可以添加 **Linked** 附件，指向 Obsidian vault 或任意文件夹。

**会随 Zotero 同步吗？**  
Stored 附件遵循 Zotero 文件同步（若已开启）。Linked 文件不会随 Zotero 文件同步上传。

**识别哪些扩展名？**  
`.md`、`.markdown`、`.mdown`、`.mkd`、`.mkdn`，以及 `text/markdown` 类型。

---

## 贡献

欢迎 Issue 与 PR。较大功能请先开 Issue 对齐范围。

---

## 致谢

- 基于 [zotero-plugin-template](https://github.com/windingwind/zotero-plugin-template)
- [markdown-it](https://github.com/markdown-it/markdown-it)
- 灵感来自 Obsidian 工作流与 Zotero 社区

---

## 许可证

[AGPL-3.0-or-later](../LICENSE)
