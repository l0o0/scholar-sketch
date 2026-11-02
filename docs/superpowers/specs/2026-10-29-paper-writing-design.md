# Markdown 论文写作与 Word 导出试验

用户在当前聊天明确接受 Markdown/Pandoc 方案，并要求新建分支试用；随后明确选择“在 Markdown 中维护引文，修改后重新导出 Word”。本次分支为 `codex/markdown-paper-writing`，目标是交付可试用的本地流程，尚不合并或发布。维护阶段已完成 3/3 任务，不改变维护授权或自动发布范围。

## 可观察行为

- 在可编辑 Markdown 中，通过更多菜单选择 Zotero 常规条目，插入 Pandoc 引文，可填写页码定位。只读预览不插入，不因选择窗口而覆盖变化后的正文。
- 导出当前编辑器快照，包括尚未保存的正文；不改写原 Markdown、附件资源或 Zotero 文献。
- 可选择本机 Pandoc、Zotero 已安装 CSL 样式和可选 Word 样式参考文档。路径与选择仅存本机偏好。
- 生成可编辑的标题、段落、表格、脚注、Word 原生公式、图片及静态引文/参考文献。Mermaid 复用现有隔离渲染器，转 PNG 后交给 Pandoc。
- 任何引用或图片缺失均停止导出；剩余不支持的原始 HTML/TeX 显式报告，不悄悄省略内容。图片规范化复用编辑器现有 HTML/wiki/Markdown 解析边界，保留代码示例。
- 转换在任务独占临时目录进行。进程使用参数数组，不经过 shell。只允许论文展示元数据进入输出，不从正文元数据加载外部 bibliography、CSL、过滤器等文件。
- 写出前核对目标原字节；有外部变化则拒绝覆盖。以同目录临时文件原子写出完整 DOCX。关闭会话终止进程、清理对话框和任务目录。

## 引文契约

使用标准 Pandoc 引文语法，例如 `[@zotero-user-ABCD1234, p. 23]`；群组为 `[@zotero-group-42-ABCD1234]`。标识保存个人/群组文库身份和原生条目 key，不保存本机 libraryID 或 itemID。宿主解析引用并使用 Zotero 的 CSL 转换器导出元数据，转换时将 CSL id 绑定到源文件中的稳定标识。当前不依赖 Better BibTeX，也不将 `[[阅读链接]]` 自动当作正式引文。

Word 引文是静态文本，权威原稿在 Markdown。原生 Zotero Word 字段、Word → Markdown 回写、多篇 Markdown 装订、图表交叉引用和学校复杂封面/分节排版不在本次已接受试用范围内。Word 模板采用 Pandoc `reference.docx` 样式机制，不承诺任意现成学校文件都能直接复用全部布局。

## 验证入口与限制

`test/paper-*.test.ts` 归属 unit，覆盖转换协议、实际失败路径、目标冲突、关闭取消、Gecko 空字符串 EOF 和导出对话框。生产菜单和保存关闭测试随接入运行。真实 Pandoc 样稿见 [examples/paper-writing](../../../examples/paper-writing/README.md)，输出须检查 OOXML 结构并渲染核对。

Pandoc 3.12 实测缺少中文文档术语翻译，故在任务数据目录提供中文术语表，仍保留 `--fail-if-warnings`。浏览器验证与 Node/真实 Pandoc 转换不能替代 Zotero 原生宿主验收；未验证范围须在交付时列明。
